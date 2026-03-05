import express from "express";
import { randomUUID } from "crypto";

export function createWalletRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser, ADMIN_TOKEN, billing } = ctx;

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
            plan_slug: active.plan_slug,
            plan_name: active.plan_name,
            can_sell: !!active.can_sell,
            can_referrals: !!active.can_referrals,
            current_period_end: active.current_period_end,
          }
        : null,
    });
  });

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

  // Admin: grant credits (para testing)
  router.post("/wallet/admin/grant", async (req, res) => {
    if (!ADMIN_TOKEN) return err(res, 503, "ADMIN_NOT_CONFIGURED", "ADMIN_TOKEN no configurado en el server.");

    const token = req.headers["x-admin-token"] ? String(req.headers["x-admin-token"]) : "";
    if (!token || token !== ADMIN_TOKEN) return err(res, 401, "UNAUTHORIZED", "Admin token inválido.");

    const userId = req.body?.userId ? String(req.body.userId) : "";
    const amount = Number(req.body?.amountCredits);

    if (!userId) return err(res, 400, "BAD_REQUEST", "Falta userId.");
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