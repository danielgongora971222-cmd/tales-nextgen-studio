import express from "express";
import { randomUUID } from "crypto";

export function createWalletRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser, adminAuth, billing } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  // Wallet del usuario (tambien ejecuta maturation global)
  router.get("/wallet/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // asegura row wallet
    await supabaseAdmin.from("wallet_balances").upsert({ user_id: user.id }, { onConflict: "user_id" });

    // maturation (safe para repetirse)
    await supabaseAdmin.rpc("billing_mature_due_referrals", {});

    // maturation (ventas community store) - NO bloquea si falla
    try {
      const { error: pMatErr } = await supabaseAdmin.rpc("community_mature_due_purchases", {});
      if (pMatErr) {
        // eslint-disable-next-line no-console
        console.warn("community_mature_due_purchases failed:", pMatErr.message);
      }
    } catch {
      // ignore
    }

    const { data, error: qErr } = await supabaseAdmin
      .from("wallet_balances")
      .select("gen_plan_credits, gen_topup_credits, gen_bonus_credits, earnings_pending_credits, earnings_matured_credits")
      .eq("user_id", user.id)
      .maybeSingle();

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    // plan activo (si existe)
    const { data: sub, error: sErr } = await supabaseAdmin.rpc("get_active_subscription", { p_user_id: user.id });
    if (sErr) return err(res, 500, "DB_RPC_FAILED", sErr.message);
    const active = Array.isArray(sub) ? sub[0] : null;

    const gen_plan_credits = Number(data?.gen_plan_credits) || 0;
    const gen_topup_credits = Number(data?.gen_topup_credits) || 0;
    const gen_bonus_credits = Number(data?.gen_bonus_credits) || 0;

    // Config de cashout (puedes cambiar por ENV en Render)
    const usdMicrosPerCredit = Math.max(1, Math.trunc(Number(process.env.EARNINGS_USD_MICROS_PER_CREDIT || 4990)));
    const feeBps = Math.min(10000, Math.max(0, Math.trunc(Number(process.env.EARNINGS_CASHOUT_FEE_BPS || 3700))));
    const minCashoutCredits = Math.max(1, Math.trunc(Number(process.env.EARNINGS_CASHOUT_MIN_CREDITS || 1)));

    return res.json({
      ok: true,
      wallet: {
        gen_plan_credits,
        gen_topup_credits,
        gen_bonus_credits,
        generationCredits: gen_plan_credits + gen_topup_credits + gen_bonus_credits,

        earnings_pending_credits: Number(data?.earnings_pending_credits) || 0,
        earnings_matured_credits: Number(data?.earnings_matured_credits) || 0,
      },
      cashoutConfig: {
        usdMicrosPerCredit,
        feeBps,
        minCashoutCredits,
      },
      subscription: active?.subscription_id
        ? {
            subscription_id: active.subscription_id,
            status: active.status || null,
            provider: active.provider || "mock",
            stripe_subscription_id: active.stripe_subscription_id || null,
            cancel_at_period_end: active.cancel_at_period_end === true,
            plan_slug: active.plan_slug,
            plan_name: active.plan_name,
            can_sell: !!active.can_sell,
            can_referrals: !!active.can_referrals,
            current_period_end: active.current_period_end,
          }
        : null,
    });
  });

  function toMillis(value) {
    if (!value) return null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  }

  function normalizeWalletRow(row) {
    const gen_plan_credits = Number(row?.gen_plan_credits) || 0;
    const gen_topup_credits = Number(row?.gen_topup_credits) || 0;
    const gen_bonus_credits = Number(row?.gen_bonus_credits) || 0;

    return {
      gen_plan_credits,
      gen_topup_credits,
      gen_bonus_credits,
      generationCredits: gen_plan_credits + gen_topup_credits + gen_bonus_credits,
      earnings_pending_credits: Number(row?.earnings_pending_credits) || 0,
      earnings_matured_credits: Number(row?.earnings_matured_credits) || 0,
    };
  }

  // Transferir earnings disponibles -> créditos de generación (SIN fee)
  router.post("/wallet/earnings/transfer", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const amount = Math.trunc(Number(req.body?.amountCredits));
    if (!Number.isFinite(amount) || amount <= 0) {
      return err(res, 400, "BAD_REQUEST", "amountCredits debe ser > 0.");
    }

    const active = await billing.getActiveSubscription(user.id);
    if (active.error) return err(res, 500, active.error.code, active.error.message, active.error.details);
    if (!active.subscription || !active.subscription.canSell) {
      return err(res, 403, "PLAN_REQUIRED_PRO", "Necesitas plan Pro o superior activo para gestionar earnings de ventas.");
    }

    const idempotencyKey = req.headers["x-idempotency-key"] ? String(req.headers["x-idempotency-key"]) : randomUUID();

    const { data, error: rpcErr } = await supabaseAdmin.rpc("wallet_transfer_earnings_to_generation", {
      p_user_id: user.id,
      p_amount: amount,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcErr) {
      const msg = String(rpcErr.message || "");
      if (msg.includes("INSUFFICIENT_EARNINGS")) {
        return err(res, 400, "INSUFFICIENT_EARNINGS", "No tienes earnings suficientes disponibles para transferir.");
      }
      if (msg.includes("INVALID_AMOUNT")) {
        return err(res, 400, "INVALID_AMOUNT", "Monto inválido.");
      }
      return err(res, 500, "TRANSFER_FAILED", rpcErr.message || "Transfer failed.");
    }

    const row = Array.isArray(data) ? data[0] : data;
    return res.json({
      ok: true,
      idempotencyKey,
      wallet: normalizeWalletRow(row),
    });
  });
  

  // Solicitar cashout (fee 37% se aplica aquí)
  router.post("/wallet/earnings/cashout", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const amount = Math.trunc(Number(req.body?.amountCredits));
    if (!Number.isFinite(amount) || amount <= 0) {
      return err(res, 400, "BAD_REQUEST", "amountCredits debe ser > 0.");
    }

    const active = await billing.getActiveSubscription(user.id);
    if (active.error) return err(res, 500, active.error.code, active.error.message, active.error.details);
    if (!active.subscription || !active.subscription.canSell) {
      return err(res, 403, "PLAN_REQUIRED_PRO", "Necesitas plan Pro o superior activo para gestionar earnings de ventas.");
    }

    const payoutMethodRaw = req.body?.payoutMethod || {};
    const payoutMethod = {
      kind: payoutMethodRaw?.kind ? String(payoutMethodRaw.kind) : "",
      handle: payoutMethodRaw?.handle ? String(payoutMethodRaw.handle) : "",
      note: payoutMethodRaw?.note ? String(payoutMethodRaw.note) : "",
    };

    if (!payoutMethod.kind || !payoutMethod.handle) {
      return err(res, 400, "BAD_REQUEST", "Debes ingresar un método de pago válido (kind + handle).", {
        required: ["payoutMethod.kind", "payoutMethod.handle"],
      });
    }

    const idempotencyKey = req.headers["x-idempotency-key"] ? String(req.headers["x-idempotency-key"]) : randomUUID();

    const usdMicrosPerCredit = Math.max(1, Math.trunc(Number(process.env.EARNINGS_USD_MICROS_PER_CREDIT || 4990)));
    const feeBps = Math.min(10000, Math.max(0, Math.trunc(Number(process.env.EARNINGS_CASHOUT_FEE_BPS || 3700))));

    const { data, error: rpcErr } = await supabaseAdmin.rpc("wallet_request_cashout", {
      p_user_id: user.id,
      p_amount_credits: amount,
      p_payout_method: payoutMethod,
      p_usd_micros_per_credit: usdMicrosPerCredit,
      p_fee_bps: feeBps,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcErr) {
      const msg = String(rpcErr.message || "");
      if (msg.includes("INSUFFICIENT_EARNINGS")) {
        return err(res, 400, "INSUFFICIENT_EARNINGS", "No tienes earnings suficientes disponibles para cashout.");
      }
      if (msg.includes("INVALID_AMOUNT") || msg.includes("INVALID_RATE") || msg.includes("INVALID_FEE")) {
        return err(res, 400, "BAD_REQUEST", "Parámetros inválidos.", { message: rpcErr.message });
      }
      return err(res, 500, "CASHOUT_FAILED", rpcErr.message || "Cashout failed.");
    }

    const row = Array.isArray(data) ? data[0] : data;

    return res.json({
      ok: true,
      idempotencyKey,
      cashout: {
        id: row?.cashout_id || null,
        status: row?.status || "requested",
        amountCredits: Number(row?.amount_credits) || 0,
        usdMicrosPerCredit: Number(row?.usd_micros_per_credit) || usdMicrosPerCredit,
        feeBps: Number(row?.fee_bps) || feeBps,
        grossUsdMicros: Number(row?.gross_usd_micros) || 0,
        feeUsdMicros: Number(row?.fee_usd_micros) || 0,
        netUsdMicros: Number(row?.net_usd_micros) || 0,
      },
      wallet: normalizeWalletRow(row),
    });
  });

  // Listar cashouts del usuario (para UI)
  router.get("/wallet/cashouts", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const limit = Math.min(50, Math.max(1, Math.trunc(Number(req.query.limit || 20))));
    const offset = Math.min(1_000_000, Math.max(0, Math.trunc(Number(req.query.offset || 0))));

    const { data, error: qErr } = await supabaseAdmin
      .from("wallet_cashout_requests")
      .select("id, status, amount_credits, usd_micros_per_credit, fee_bps, gross_usd_micros, fee_usd_micros, net_usd_micros, payout_method, created_at, processed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    const items = (data || []).map((r) => ({
      id: r.id,
      status: r.status,
      amountCredits: Number(r.amount_credits) || 0,
      usdMicrosPerCredit: Number(r.usd_micros_per_credit) || 0,
      feeBps: Number(r.fee_bps) || 0,
      grossUsdMicros: Number(r.gross_usd_micros) || 0,
      feeUsdMicros: Number(r.fee_usd_micros) || 0,
      netUsdMicros: Number(r.net_usd_micros) || 0,
      payoutMethod: r.payout_method || {},
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      processedAt: r.processed_at ? new Date(r.processed_at).getTime() : null,
    }));

    return res.json({
      ok: true,
      items,
      nextOffset: offset + items.length,
      hasMore: items.length === limit,
    });
  });

  router.get("/wallet/earnings/history", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const bucket = req.query.bucket === "available" ? "available" : req.query.bucket === "pending" ? "pending" : null;
    if (!bucket) {
      return err(res, 400, "BAD_REQUEST", "bucket debe ser pending o available.");
    }

    const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit || 20))));
    const offset = Math.min(1_000_000, Math.max(0, Math.trunc(Number(req.query.offset || 0))));
    const entryTypes = bucket === "pending" ? ["sale_pending", "referral_reward_pending"] : ["sale_matured", "referral_reward_matured"];

    const { data: ledgerRows, error: ledgerErr } = await supabaseAdmin
      .from("wallet_ledger")
      .select("id, entry_type, amount_credits, ref_type, ref_id, created_at")
      .eq("user_id", user.id)
      .in("entry_type", entryTypes)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (ledgerErr) return err(res, 500, "DB_QUERY_FAILED", ledgerErr.message);

    const rows = Array.isArray(ledgerRows) ? ledgerRows : [];

    const communityPurchaseIds = [...new Set(rows.filter((r) => r.ref_type === "community_purchase" && r.ref_id).map((r) => r.ref_id))];
    const billingReferralIds = [...new Set(rows.filter((r) => r.ref_type === "billing_referral" && r.ref_id).map((r) => r.ref_id))];

    let purchaseRows = [];
    if (communityPurchaseIds.length > 0) {
      const { data, error: qErr } = await supabaseAdmin
        .from("community_purchases")
        .select("id, listing_id, referral_code_id, created_at, matures_at, is_matured")
        .in("id", communityPurchaseIds);
      if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);
      purchaseRows = Array.isArray(data) ? data : [];
    }

    let billingRows = [];
    if (billingReferralIds.length > 0) {
      const { data, error: qErr } = await supabaseAdmin
        .from("billing_referrals")
        .select("id, referral_code_snapshot, referred_username_snapshot, plan_slug_snapshot, created_at, matures_at, is_matured")
        .in("id", billingReferralIds);
      if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);
      billingRows = Array.isArray(data) ? data : [];
    }

    const listingIds = [...new Set(purchaseRows.map((r) => r.listing_id).filter(Boolean))];
    const referralCodeIds = [...new Set(purchaseRows.map((r) => r.referral_code_id).filter(Boolean))];

    let listingRows = [];
    if (listingIds.length > 0) {
      const { data, error: qErr } = await supabaseAdmin
        .from("community_listings")
        .select("id, name, description")
        .in("id", listingIds);
      if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);
      listingRows = Array.isArray(data) ? data : [];
    }

    let referralCodeRows = [];
    if (referralCodeIds.length > 0) {
      const { data, error: qErr } = await supabaseAdmin
        .from("community_referral_codes")
        .select("id, code")
        .in("id", referralCodeIds);
      if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);
      referralCodeRows = Array.isArray(data) ? data : [];
    }

    const purchaseById = new Map((purchaseRows || []).map((r) => [r.id, r]));
    const billingById = new Map((billingRows || []).map((r) => [r.id, r]));
    const listingById = new Map((listingRows || []).map((r) => [r.id, r]));
    const referralCodeById = new Map((referralCodeRows || []).map((r) => [r.id, r]));

    const items = rows.map((row) => {
      const base = {
        id: row.id,
        entryType: row.entry_type,
        bucket,
        amountCredits: Number(row.amount_credits) || 0,
        sourceKind: "other",
        sourceLabel: "Ingreso",
        sourceName: null,
        sourceCode: null,
        planSlug: null,
        referredUsername: null,
        createdAt: toMillis(row.created_at),
        availableAt: null,
        ledgerCreatedAt: toMillis(row.created_at),
      };

      if (row.ref_type === "community_purchase") {
        const purchase = purchaseById.get(row.ref_id) || null;
        const listing = purchase?.listing_id ? listingById.get(purchase.listing_id) || null : null;
        const referralCode = purchase?.referral_code_id ? referralCodeById.get(purchase.referral_code_id) || null : null;

        if (row.entry_type === "sale_pending" || row.entry_type === "sale_matured") {
          return {
            ...base,
            sourceKind: "sale",
            sourceLabel: "Venta de creación",
            sourceName: listing?.name || listing?.description || "Creación sin nombre",
            createdAt: toMillis(purchase?.created_at) ?? base.createdAt,
            availableAt: toMillis(purchase?.matures_at),
          };
        }

        return {
          ...base,
          sourceKind: "referral",
          sourceLabel: "Referido por venta",
          sourceName: listing?.name || "Compra con referido",
          sourceCode: referralCode?.code || null,
          createdAt: toMillis(purchase?.created_at) ?? base.createdAt,
          availableAt: toMillis(purchase?.matures_at),
        };
      }

      if (row.ref_type === "billing_referral") {
        const referral = billingById.get(row.ref_id) || null;
        return {
          ...base,
          sourceKind: "referral",
          sourceLabel: "Referido de plan",
          sourceName: referral?.plan_slug_snapshot || "Plan",
          sourceCode: referral?.referral_code_snapshot || null,
          referredUsername: referral?.referred_username_snapshot || null,
          planSlug: referral?.plan_slug_snapshot || null,
          createdAt: toMillis(referral?.created_at) ?? base.createdAt,
          availableAt: toMillis(referral?.matures_at),
        };
      }

      return base;
    });

    return res.json({
      ok: true,
      bucket,
      items,
      nextOffset: offset + items.length,
      hasMore: items.length === limit,
    });
  });

  // Admin: grant credits (para testing / soporte owner)
  router.post("/wallet/admin/grant", async (req, res) => {
    const auth = await adminAuth.requireAdminAccess(req);
    if (!auth.ok) return err(res, auth.status || 403, auth.error?.code || "FORBIDDEN", auth.error?.message || "Acceso denegado.", auth.error?.details);

    const target = await adminAuth.resolveTargetUser({
      userId: req.body?.userId ? String(req.body.userId) : "",
      email: req.body?.email ? String(req.body.email) : "",
    });
    if (target.error || !target.user) {
      return err(res, 404, target.error?.code || "USER_NOT_FOUND", target.error?.message || "Usuario no encontrado.", target.error?.details);
    }

    const userId = String(target.user.id);
    const amount = Number(req.body?.amountCredits);

    if (!Number.isFinite(amount) || amount <= 0) return err(res, 400, "BAD_REQUEST", "amountCredits debe ser > 0.");

    await supabaseAdmin.from("wallet_balances").upsert({ user_id: userId }, { onConflict: "user_id" });

    const { data: row, error: qErr } = await supabaseAdmin
      .from("wallet_balances")
      .select("gen_plan_credits, gen_topup_credits, gen_bonus_credits")
      .eq("user_id", userId)
      .maybeSingle();

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    const gen_plan_credits = Number(row?.gen_plan_credits) || 0;
    const gen_topup_credits = Number(row?.gen_topup_credits) || 0;
    const currentBonus = Number(row?.gen_bonus_credits) || 0;

    const add = Math.floor(amount);
    const nextBonus = currentBonus + add;

    const { error: saveErr } = await supabaseAdmin
      .from("wallet_balances")
      .update({ gen_bonus_credits: nextBonus })
      .eq("user_id", userId);

    if (saveErr) return err(res, 500, "DB_UPDATE_FAILED", saveErr.message);

    await supabaseAdmin.from("wallet_ledger").insert({
      user_id: userId,
      entry_type: "admin_grant_gen_bonus_credits",
      amount_credits: add,
      ref_type: "admin",
      ref_id: null,
    });

    const generationCredits = gen_plan_credits + gen_topup_credits + nextBonus;

    return res.json({
      ok: true,
      userId,
      email: target.user.email || null,
      wallet: {
        gen_plan_credits,
        gen_topup_credits,
        gen_bonus_credits: nextBonus,
        generationCredits,
      },
    });
  });

  return router;
}