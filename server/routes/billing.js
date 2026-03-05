// server/routes/billing.js
import express from "express";

export function createBillingRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser } = ctx;
  const { requireActiveSubscription, getActiveSubscription, getIdempotencyKey } = ctx.billing;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  // GET /api/billing/me -> plan activo (o null)
  router.get("/billing/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const r = await getActiveSubscription(user.id);
    if (r.error) return err(res, 500, r.error.code, r.error.message, r.error.details);

    return res.json({ ok: true, subscription: r.subscription });
  });

  // POST /api/billing/mock/subscribe { planSlug }
  router.post("/billing/mock/subscribe", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const planSlug = req.body?.planSlug ? String(req.body.planSlug) : "";
    if (!planSlug) return err(res, 400, "BAD_REQUEST", "Falta planSlug.");

    const rawReferral = req.body?.referralCode ? String(req.body.referralCode) : "";
    const referralCode = rawReferral ? rawReferral.trim().toUpperCase() : "";

    // ✅ Requiere aceptación legal previa (ETAPA 2)
    const REQUIRED_TERMS = process.env.LEGAL_TERMS_VERSION || "2026-03-03";
    const REQUIRED_PRIVACY = process.env.LEGAL_PRIVACY_VERSION || "2026-03-03";
    const REQUIRED_AUTOPAY = process.env.LEGAL_AUTOPAY_VERSION || "2026-03-03";

    const { data: acceptance, error: aErr } = await supabaseAdmin
      .from("legal_acceptances")
      .select("terms_version, privacy_version, autopay_version")
      .eq("user_id", user.id)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (aErr) return err(res, 500, "DB_QUERY_FAILED", aErr.message);

    const okLegal =
      acceptance &&
      acceptance.terms_version === REQUIRED_TERMS &&
      acceptance.privacy_version === REQUIRED_PRIVACY &&
      acceptance.autopay_version === REQUIRED_AUTOPAY;

    if (!okLegal) {
      return err(res, 403, "LEGAL_NOT_ACCEPTED", "Debes aceptar términos, privacidad y auto-renovación antes de activar un plan.", {
        required: { terms: REQUIRED_TERMS, privacy: REQUIRED_PRIVACY, autopay: REQUIRED_AUTOPAY },
      });
    }

    const { data: plan, error: pErr } = await supabaseAdmin
      .from("billing_plans")
      .select("id, slug, billing_period")
      .eq("slug", planSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (pErr) return err(res, 500, "DB_QUERY_FAILED", pErr.message);
    if (!plan?.id) return err(res, 404, "PLAN_NOT_FOUND", "Plan no existe o está inactivo.");

    // Validación temprana del código (si viene)
    // Reglas:
    // - Debe existir y estar activo
    // - No puede ser del mismo usuario
    // - El dueño debe tener un plan activo con can_referrals=true (Partner/Business)
    if (referralCode) {
      const { data: rc, error: rcErr } = await supabaseAdmin
        .from("community_referral_codes")
        .select("id, owner_id, is_active")
        .eq("code", referralCode)
        .eq("is_active", true)
        .maybeSingle();

      if (rcErr) return err(res, 500, "DB_QUERY_FAILED", rcErr.message);
      if (!rc?.id) return err(res, 400, "INVALID_REFERRAL_CODE", "El código de referido no es válido o está inactivo.");
      if (rc.owner_id === user.id) {
        return err(res, 400, "INVALID_REFERRAL_CODE", "No puedes usar tu propio código de referido.");
      }

      const owner = await getActiveSubscription(rc.owner_id);
      if (owner?.error) return err(res, 500, owner.error.code, owner.error.message, owner.error.details);

      if (!owner?.subscription || !owner.subscription.canReferrals) {
        return err(
          res,
          400,
          "REFERRAL_OWNER_NOT_ELIGIBLE",
          "El dueño de este código no tiene un plan Partner/Business activo. Pídele que renueve su plan o usa otro código.",
          { ownerPlan: owner?.subscription?.planSlug || null }
        );
      }
    }

    const now = new Date();
    const periodMs = plan.billing_period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const start = new Date(now.getTime());
    const end = new Date(now.getTime() + periodMs);

    // Expirar cualquiera previa activa (seguro)
    await supabaseAdmin
      .from("billing_subscriptions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("status", "active");

    const { data: sub, error: sErr } = await supabaseAdmin
      .from("billing_subscriptions")
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        status: "active",
        current_period_start: start.toISOString(),
        current_period_end: end.toISOString(),
        provider: "mock",
      })
      .select("id, plan_id, status, current_period_start, current_period_end")
      .maybeSingle();

    if (sErr) return err(res, 500, "DB_INSERT_FAILED", sErr.message);

    // Grant plan credits (reset del bucket plan)
    const idem = getIdempotencyKey(req);
    const { error: gErr } = await supabaseAdmin.rpc("wallet_grant_plan_credits", {
      p_user_id: user.id,
      p_plan_id: plan.id,
      p_period_start: start.toISOString(),
      p_period_end: end.toISOString(),
      p_idempotency_key: `grant:${idem}`,
    });

    if (gErr) {
      // rollback: no queremos dejar una subscripción "active" si no se pudieron otorgar créditos
      const { error: rbErr } = await supabaseAdmin
        .from("billing_subscriptions")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", sub.id);

      return err(res, 500, "PLAN_GRANT_FAILED", gErr.message, rbErr ? { rollback: rbErr.message } : null);
    }

    // Aplicar referral si viene (no rompemos la compra si el bonus falla por un deploy incompleto)
    if (referralCode) {
      const { data: refData, error: refErr } = await supabaseAdmin.rpc("billing_apply_referral_on_subscribe", {
        p_buyer_id: user.id,
        p_referral_code: referralCode,
        p_plan_id: plan.id,
        p_idempotency_key: `subref:${idem}`,
      });

      if (refErr) {
        return res.json({
          ok: true,
          subscription: sub,
          referral: { applied: false, warning: "REFERRAL_APPLY_FAILED", message: refErr.message },
        });
      }

      const rrow = Array.isArray(refData) ? refData[0] : null;

      return res.json({
        ok: true,
        subscription: sub,
        referral: {
          applied: true,
          buyerBonusCredits: Number(rrow?.buyer_bonus_credits) || 0,
          referrerRewardCredits: Number(rrow?.referrer_reward_credits) || 0,
        },
      });
    }

    return res.json({ ok: true, subscription: sub, referral: { applied: false } });
  });

  // POST /api/billing/mock/topup { productId }
  router.post("/billing/mock/topup", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // Requiere plan activo
    const sub = await requireActiveSubscription(user.id);
    if (sub.error) return err(res, 403, sub.error.code, sub.error.message, sub.error.details);

    const productId = req.body?.productId ? String(req.body.productId) : "";
    if (!productId) return err(res, 400, "BAD_REQUEST", "Falta productId.");

    const idem = getIdempotencyKey(req);

    const { data, error: tErr } = await supabaseAdmin.rpc("wallet_add_topup_credits", {
      p_user_id: user.id,
      p_product_id: productId,
      p_idempotency_key: `topup:${idem}`,
    });

    if (tErr) {
      const msg = String(tErr.message || "");
      if (msg.includes("TOPUP_REQUIRES_ACTIVE_PLAN")) {
        return err(res, 403, "NO_ACTIVE_PLAN", "Necesitas un plan activo para comprar créditos extra.");
      }
      return err(res, 500, "TOPUP_FAILED", tErr.message);
    }

    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ ok: true, creditsAdded: Number(row?.credits_added) || 0 });
  });

  // POST /api/billing/mock/cancel { wipeGenerationCredits?: boolean }
  router.post("/billing/mock/cancel", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const idem = getIdempotencyKey(req);
    const wipeGenerationCredits = req.body?.wipeGenerationCredits === true;

    const { data, error: cErr } = await supabaseAdmin.rpc("billing_cancel_subscription", {
      p_user_id: user.id,
      p_wipe_generation_credits: wipeGenerationCredits,
      p_idempotency_key: `cancel:${idem}`,
    });

    if (cErr) {
      const msg = String(cErr.message || "");
      if (msg.includes("NO_ACTIVE_SUBSCRIPTION")) return err(res, 400, "NO_ACTIVE_PLAN", "No tienes plan activo.");
      return err(res, 500, "CANCEL_FAILED", cErr.message);
    }

    const row = Array.isArray(data) ? data[0] : null;
    return res.json({
      ok: true,
      wipeGenerationCredits: Boolean(row?.wipe_generation_credits),
      balances: {
        plan: Number(row?.plan_credits) || 0,
        topup: Number(row?.topup_credits) || 0,
        bonus: Number(row?.bonus_credits) || 0,
      },
    });
  });

  // GET /api/billing/plans
  router.get("/billing/plans", async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("billing_plans")
            .select("id, slug, name, billing_period, price_cents, plan_credits, bonus_credits, max_concurrency, can_sell, can_referrals, is_active")
      .eq("is_active", true)
      .order("price_cents", { ascending: true });

    if (error) return err(res, 500, "DB_QUERY_FAILED", error.message);
    return res.json({ ok: true, plans: data || [] });
  });

  // GET /api/billing/topups
  router.get("/billing/topups", async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("credit_topup_products")
      .select("id, sku, name, price_cents, credits_amount, is_active")
      .eq("is_active", true)
      .order("price_cents", { ascending: true });

    if (error) return err(res, 500, "DB_QUERY_FAILED", error.message);
    return res.json({ ok: true, topups: data || [] });
  });

  return router;
}
