// server/routes/billing.js
import express from "express";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createBillingRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser, adminAuth, stripeBilling } = ctx;
  const { requireActiveSubscription, getActiveSubscription, getIdempotencyKey } = ctx.billing;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  function publicMockBillingEnabled() {
    return String(process.env.ALLOW_PUBLIC_MOCK_BILLING || "").trim() === "1";
  }

  function planPeriodFactor(bp) {
    const v = String(bp || "month").toLowerCase();
    if (v === "week") return 4;
    if (v === "year") return 12;
    return 1;
  }

  function planTierRank(plan) {
    const slug = String(plan?.slug || "").toLowerCase();
    if (slug.includes("basic")) return 10;
    if (slug.includes("standard")) return 20;
    if (slug.includes("pro")) return 30;
    if (slug.includes("partner")) return 40;
    if (slug.includes("business")) return 50;
    return null;
  }

  function planPowerScore(plan) {
    const explicitRank = planTierRank(plan);
    const concurrency = Number(plan?.max_concurrency || 2);
    const features = (plan?.can_sell ? 1 : 0) + (plan?.can_referrals ? 1 : 0);

    if (explicitRank !== null) {
      return explicitRank * 1_000_000_000 + concurrency * 10_000 + features * 100 + Number(plan?.price_cents || 0);
    }

    const factor = planPeriodFactor(plan?.billing_period);
    const creditsEqMonth = (Number(plan?.plan_credits || 0) + Number(plan?.bonus_credits || 0)) * factor;
    return creditsEqMonth * 1_000_000 + concurrency * 10_000 + features * 100 + Number(plan?.price_cents || 0);
  }

  function requireStripeConfigured(res) {
    if (stripeBilling?.isConfigured?.()) return true;
    err(
      res,
      503,
      "STRIPE_NOT_CONFIGURED",
      "Stripe no está configurado todavía en el backend. Revisa STRIPE_SECRET_KEY y el mapeo de Price IDs en Render/Supabase."
    );
    return false;
  }

  async function requireAdmin(req, res) {
    const auth = await adminAuth.requireAdminAccess(req);
    if (!auth.ok) {
      err(
        res,
        auth.status || 403,
        auth.error?.code || "FORBIDDEN",
        auth.error?.message || "Acceso denegado.",
        auth.error?.details
      );
      return null;
    }
    return auth;
  }

  async function resolveTargetUserFromBody(req, res) {
    const target = await adminAuth.resolveTargetUser({
      userId: req.body?.userId ? String(req.body.userId) : "",
      email: req.body?.email ? String(req.body.email) : "",
    });

    if (target.error || !target.user) {
      err(
        res,
        404,
        target.error?.code || "USER_NOT_FOUND",
        target.error?.message || "Usuario no encontrado.",
        target.error?.details
      );
      return null;
    }

    return target.user;
  }

  async function fetchPlanBySlug(planSlug, opts = {}) {
    const requireStripePrice = opts.requireStripePrice === true;
    const query = supabaseAdmin
      .from("billing_plans")
      .select(
        "id, slug, name, billing_period, price_cents, plan_credits, bonus_credits, max_concurrency, can_sell, can_referrals, is_active, stripe_price_id"
      )
      .eq("slug", planSlug)
      .eq("is_active", true)
      .maybeSingle();

    const { data, error } = await query;
    if (error) throw Object.assign(new Error(error.message), { code: "DB_QUERY_FAILED", status: 500 });
    if (!data?.id) throw Object.assign(new Error("Plan no existe o está inactivo."), { code: "PLAN_NOT_FOUND", status: 404 });
    if (requireStripePrice && !normalizeString(data.stripe_price_id)) {
      throw Object.assign(
        new Error("Este plan aún no tiene Stripe Price ID configurado en billing_plans.stripe_price_id."),
        { code: "PLAN_CHECKOUT_NOT_AVAILABLE", status: 409, details: { planSlug: data.slug } }
      );
    }
    return data;
  }

  async function fetchCurrentPlan(currentSubscription) {
    if (!currentSubscription?.planId) return null;
    const { data, error } = await supabaseAdmin
      .from("billing_plans")
      .select(
        "id, slug, name, billing_period, price_cents, plan_credits, bonus_credits, max_concurrency, can_sell, can_referrals, is_active, stripe_price_id"
      )
      .eq("id", currentSubscription.planId)
      .maybeSingle();

    if (error) throw Object.assign(new Error(error.message), { code: "DB_QUERY_FAILED", status: 500 });
    return data || null;
  }

  async function fetchTopupProductById(productId, opts = {}) {
    const requireStripePrice = opts.requireStripePrice === true;
    const { data, error } = await supabaseAdmin
      .from("credit_topup_products")
      .select("id, sku, name, price_cents, credits_amount, is_active, stripe_price_id")
      .eq("id", productId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw Object.assign(new Error(error.message), { code: "DB_QUERY_FAILED", status: 500 });
    if (!data?.id) throw Object.assign(new Error("El pack de créditos no existe o está inactivo."), { code: "TOPUP_NOT_FOUND", status: 404 });
    if (requireStripePrice && !normalizeString(data.stripe_price_id)) {
      throw Object.assign(
        new Error("Este pack de créditos aún no tiene Stripe Price ID configurado en credit_topup_products.stripe_price_id."),
        { code: "TOPUP_CHECKOUT_NOT_AVAILABLE", status: 409, details: { productId: data.id } }
      );
    }
    return data;
  }

  function pickPreferredTopupRow(currentRow, candidateRow) {
    if (!currentRow) return candidateRow;
    if (!candidateRow) return currentRow;

    const currentHasStripe = !!normalizeString(currentRow.stripe_price_id);
    const candidateHasStripe = !!normalizeString(candidateRow.stripe_price_id);
    if (candidateHasStripe !== currentHasStripe) {
      return candidateHasStripe ? candidateRow : currentRow;
    }

    const currentUpdated = Date.parse(currentRow.updated_at || currentRow.created_at || "");
    const candidateUpdated = Date.parse(candidateRow.updated_at || candidateRow.created_at || "");
    if (Number.isFinite(candidateUpdated) && Number.isFinite(currentUpdated) && candidateUpdated !== currentUpdated) {
      return candidateUpdated > currentUpdated ? candidateRow : currentRow;
    }

    const currentCreated = Date.parse(currentRow.created_at || "");
    const candidateCreated = Date.parse(candidateRow.created_at || "");
    if (Number.isFinite(candidateCreated) && Number.isFinite(currentCreated) && candidateCreated !== currentCreated) {
      return candidateCreated < currentCreated ? candidateRow : currentRow;
    }

    return currentRow;
  }

  function canonicalTopupKey(row) {
    const sku = normalizeString(row?.sku);
    if (sku) return `sku:${sku.toLowerCase()}`;

    const price = Number(row?.price_cents || 0);
    const credits = Number(row?.credits_amount || row?.credits || 0);
    const name = normalizeString(row?.name).toLowerCase();
    return `${price}|${credits}|${name}`;
  }

  async function assertLegalAccepted(userId) {
    const REQUIRED_TERMS = process.env.LEGAL_TERMS_VERSION || "2026-03-03";
    const REQUIRED_PRIVACY = process.env.LEGAL_PRIVACY_VERSION || "2026-03-03";
    const REQUIRED_AUTOPAY = process.env.LEGAL_AUTOPAY_VERSION || "2026-03-03";

    const { data: acceptance, error } = await supabaseAdmin
      .from("legal_acceptances")
      .select("terms_version, privacy_version, autopay_version")
      .eq("user_id", userId)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw Object.assign(new Error(error.message), { code: "DB_QUERY_FAILED", status: 500 });
    }

    const okLegal =
      acceptance &&
      acceptance.terms_version === REQUIRED_TERMS &&
      acceptance.privacy_version === REQUIRED_PRIVACY &&
      acceptance.autopay_version === REQUIRED_AUTOPAY;

    if (!okLegal) {
      throw Object.assign(
        new Error("Debes aceptar términos, privacidad y auto-renovación antes de iniciar el cobro."),
        {
          code: "LEGAL_NOT_ACCEPTED",
          status: 403,
          details: {
            required: {
              terms: REQUIRED_TERMS,
              privacy: REQUIRED_PRIVACY,
              autopay: REQUIRED_AUTOPAY,
            },
          },
        }
      );
    }
  }

  async function validateReferralForPlan({ userId, referralCode }) {
    const code = normalizeString(referralCode).toUpperCase();
    if (!code) {
      return {
        code: "",
        buyerDiscountPct: 0,
        refRewardPct: 0,
        ownerPlanSlug: null,
        ownerPlanName: null,
      };
    }

    const { data: rc, error: rcErr } = await supabaseAdmin
      .from("community_referral_codes")
      .select("id, code, owner_id, buyer_discount_pct, ref_reward_pct, is_active")
      .eq("code", code)
      .eq("is_active", true)
      .maybeSingle();

    if (rcErr) throw Object.assign(new Error(rcErr.message), { code: "DB_QUERY_FAILED", status: 500 });
    if (!rc?.id) {
      throw Object.assign(new Error("El código de referido no es válido o está inactivo."), {
        code: "INVALID_REFERRAL_CODE",
        status: 400,
      });
    }

    if (rc.owner_id === userId) {
      throw Object.assign(new Error("No puedes usar tu propio código de referido."), {
        code: "INVALID_REFERRAL_CODE",
        status: 400,
      });
    }

    const owner = await getActiveSubscription(rc.owner_id);
    if (owner?.error) {
      throw Object.assign(new Error(owner.error.message), {
        code: owner.error.code || "DB_QUERY_FAILED",
        status: 500,
        details: owner.error.details || null,
      });
    }

    if (!owner?.subscription || !owner.subscription.canReferrals) {
      throw Object.assign(
        new Error("El dueño de este código no tiene un plan Partner/Business activo. Pídele que renueve su plan o usa otro código."),
        {
          code: "REFERRAL_OWNER_NOT_ELIGIBLE",
          status: 400,
          details: { ownerPlan: owner?.subscription?.planSlug || null },
        }
      );
    }

    return {
      code,
      buyerDiscountPct: Number(rc.buyer_discount_pct) || 0,
      refRewardPct: Number(rc.ref_reward_pct) || 0,
      ownerPlanSlug: owner.subscription.planSlug || null,
      ownerPlanName: owner.subscription.planName || null,
    };
  }

  async function activateManualPlanForUser({ userId, plan, idempotencyKey, referralCode = "" }) {
    const now = new Date();
    const periodMs = String(plan?.billing_period || "month").toLowerCase() === "week"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
    const periodStart = new Date(now.getTime()).toISOString();
    const periodEnd = new Date(now.getTime() + periodMs).toISOString();

    const { error: expireErr } = await supabaseAdmin
      .from("billing_subscriptions")
      .update({ status: "expired", current_period_end: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");

    if (expireErr) {
      throw Object.assign(new Error(expireErr.message), { code: "DB_UPDATE_FAILED", status: 500 });
    }

    const { data: sub, error: subErr } = await supabaseAdmin
      .from("billing_subscriptions")
      .insert({
        user_id: userId,
        plan_id: plan.id,
        status: "active",
        provider: "mock",
        current_period_start: periodStart,
        current_period_end: periodEnd,
      })
      .select("id, plan_id, status, provider, current_period_start, current_period_end")
      .maybeSingle();

    if (subErr) {
      throw Object.assign(new Error(subErr.message), { code: "DB_INSERT_FAILED", status: 500 });
    }

    const { error: grantErr } = await supabaseAdmin.rpc("wallet_grant_plan_credits", {
      p_user_id: userId,
      p_plan_id: plan.id,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_idempotency_key: `${idempotencyKey}:grant`,
    });

    if (grantErr) {
      await supabaseAdmin
        .from("billing_subscriptions")
        .update({ status: "expired", current_period_end: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", sub.id);

      throw Object.assign(new Error(grantErr.message), { code: "PLAN_GRANT_FAILED", status: 500 });
    }

    let referral = { applied: false };
    const cleanReferralCode = normalizeString(referralCode).toUpperCase();
    if (cleanReferralCode) {
      const { data: refData, error: refErr } = await supabaseAdmin.rpc("billing_apply_referral_on_subscribe", {
        p_buyer_id: userId,
        p_referral_code: cleanReferralCode,
        p_plan_id: plan.id,
        p_idempotency_key: `${idempotencyKey}:referral`,
      });

      if (refErr) {
        referral = {
          applied: false,
          warning: "REFERRAL_APPLY_FAILED",
          message: refErr.message,
        };
      } else {
        const row = Array.isArray(refData) ? refData[0] : null;
        referral = {
          applied: true,
          buyerBonusCredits: Number(row?.buyer_bonus_credits) || 0,
          referrerRewardCredits: Number(row?.referrer_reward_credits) || 0,
        };
      }
    }

    return { subscription: sub, referral };
  }

  async function parseCurrentSubscriptionOrError(userId, res) {
    const current = await getActiveSubscription(userId);
    if (current.error) {
      err(res, 500, current.error.code, current.error.message, current.error.details);
      return null;
    }
    return current.subscription || null;
  }

  async function reconcileStripeCustomerState(userId, logContext = "billing", opts = {}) {
    if (!stripeBilling?.isConfigured?.()) return null;

    const throwOnError = opts?.throwOnError === true;

    try {
      return await stripeBilling.reconcileCustomerSubscriptionsForUser(userId, { enforceSingleActive: true });
    } catch (syncError) {
      // eslint-disable-next-line no-console
      console.warn(`reconcileCustomerSubscriptionsForUser failed in ${logContext}:`, String(syncError?.message || syncError));
      if (throwOnError) throw syncError;
      return null;
    }
  }

  // GET /api/billing/me -> plan activo (o null)
  router.get("/billing/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const forceSyncStripe = normalizeString(req.query?.syncStripe || "") === "1";
    const strictSyncStripe = normalizeString(req.query?.strictSync || "") === "1";

    let r = await getActiveSubscription(user.id);
    if (r.error) return err(res, 500, r.error.code, r.error.message, r.error.details);

    const hasStripeManagedSubscription = r.subscription?.provider === "stripe" && !!r.subscription?.stripeSubscriptionId;

    if ((forceSyncStripe || !r.subscription || hasStripeManagedSubscription) && stripeBilling?.isConfigured?.()) {
      try {
        await reconcileStripeCustomerState(user.id, "/billing/me", { throwOnError: strictSyncStripe });
      } catch (syncError) {
        return err(
          res,
          Number(syncError?.status) || 500,
          syncError?.code || "STRIPE_SYNC_FAILED",
          syncError?.message || "No se pudo sincronizar el estado de Stripe.",
          syncError?.details || null
        );
      }

      r = await getActiveSubscription(user.id);
      if (r.error) return err(res, 500, r.error.code, r.error.message, r.error.details);
    }

    return res.json({ ok: true, subscription: r.subscription });
  });

  // POST /api/billing/mock/subscribe { planSlug }
  router.post("/billing/mock/subscribe", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    if (!publicMockBillingEnabled()) {
      return err(
        res,
        403,
        "PUBLIC_MOCK_BILLING_DISABLED",
        "La compra pública mock está desactivada. Usa Stripe Checkout para planes reales."
      );
    }

    try {
      const planSlug = req.body?.planSlug ? String(req.body.planSlug) : "";
      if (!planSlug) return err(res, 400, "BAD_REQUEST", "Falta planSlug.");

      await assertLegalAccepted(user.id);
      const plan = await fetchPlanBySlug(planSlug, { requireStripePrice: false });
      const current = await getActiveSubscription(user.id);
      if (current.error) return err(res, 500, current.error.code, current.error.message, current.error.details);

      if (current.subscription?.provider === "stripe") {
        return err(
          res,
          409,
          "STRIPE_MANAGED_SUBSCRIPTION",
          "Tu suscripción activa se gestiona en Stripe. Usa el portal de facturación para cambiarla o cancelarla.",
          { provider: "stripe", flow: "update", subscriptionId: current.subscription.stripeSubscriptionId || null }
        );
      }

      const currentPlan = await fetchCurrentPlan(current.subscription);
      if (currentPlan?.id && planPowerScore(plan) < planPowerScore(currentPlan)) {
        return err(
          res,
          403,
          "DOWNGRADE_REQUIRES_CANCEL",
          "Tienes un plan activo superior. Para bajar de plan primero debes cancelar tu suscripción y luego comprar el plan menor.",
          { currentPlanSlug: currentPlan.slug, requestedPlanSlug: plan.slug }
        );
      }

      const referralMeta = await validateReferralForPlan({
        userId: user.id,
        referralCode: req.body?.referralCode ? String(req.body.referralCode) : "",
      });

      const result = await activateManualPlanForUser({
        userId: user.id,
        plan,
        idempotencyKey: `mock-sub:${getIdempotencyKey(req)}`,
        referralCode: referralMeta.code,
      });

      return res.json({ ok: true, subscription: result.subscription, referral: result.referral });
    } catch (e) {
      return err(res, Number(e?.status) || 500, e?.code || "SUBSCRIBE_FAILED", e?.message || "No se pudo activar el plan.", e?.details || null);
    }
  });

  // POST /api/billing/mock/topup { productId }
  router.post("/billing/mock/topup", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    if (!publicMockBillingEnabled()) {
      return err(
        res,
        403,
        "PUBLIC_MOCK_BILLING_DISABLED",
        "La compra pública mock está desactivada. Usa Stripe Checkout para créditos extra reales."
      );
    }

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

    const current = await parseCurrentSubscriptionOrError(user.id, res);
    if (current === null && res.headersSent) return;

    if (current?.provider === "stripe") {
      return err(
        res,
        409,
        "STRIPE_MANAGED_SUBSCRIPTION",
        "Tu suscripción activa se gestiona en Stripe. Usa el portal de facturación para cancelarla o cambiarla.",
        { provider: "stripe", flow: "cancel", subscriptionId: current.stripeSubscriptionId || null }
      );
    }

    if (!publicMockBillingEnabled() && current && current.provider !== "mock") {
      return err(
        res,
        403,
        "PUBLIC_MOCK_BILLING_DISABLED",
        "La cancelación pública mock está desactivada porque no hay una suscripción manual activa para este usuario."
      );
    }

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

  // POST /api/billing/stripe/checkout/subscription { planSlug, referralCode? }
  router.post("/billing/stripe/checkout/subscription", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });
    if (!requireStripeConfigured(res)) return;

    try {
      const planSlug = req.body?.planSlug ? String(req.body.planSlug) : "";
      if (!planSlug) return err(res, 400, "BAD_REQUEST", "Falta planSlug.");

      await assertLegalAccepted(user.id);
      await reconcileStripeCustomerState(user.id, "/billing/stripe/checkout/subscription");
      const plan = await fetchPlanBySlug(planSlug, { requireStripePrice: true });
      const current = await getActiveSubscription(user.id);
      if (current.error) return err(res, 500, current.error.code, current.error.message, current.error.details);

      const currentPlan = await fetchCurrentPlan(current.subscription);
      const currentPower = currentPlan?.id ? planPowerScore(currentPlan) : null;
      const requestedPower = planPowerScore(plan);
      const isDowngrade = currentPower !== null && requestedPower < currentPower;
      const isUpgrade = currentPower !== null && requestedPower > currentPower;
      const isSamePlan = !!currentPlan?.id && String(currentPlan.slug || "") === String(plan.slug || "");

      if (isSamePlan) {
        return err(res, 409, "CURRENT_PLAN", "Ese ya es tu plan activo actual.");
      }

      if (isDowngrade) {
        return err(
          res,
          403,
          "DOWNGRADE_REQUIRES_CANCEL",
          "Tienes un plan activo superior. Para bajar de plan primero debes cancelar tu suscripción y luego comprar el plan menor.",
          { currentPlanSlug: currentPlan.slug, requestedPlanSlug: plan.slug }
        );
      }

      const referralMeta = await validateReferralForPlan({
        userId: user.id,
        referralCode: req.body?.referralCode ? String(req.body.referralCode) : "",
      });

      const session = await stripeBilling.createSubscriptionCheckoutSession({
        req,
        user,
        plan,
        referralCode: referralMeta.code,
        referralDiscountPct: referralMeta.buyerDiscountPct,
        replaceStripeSubscriptionId:
          current.subscription?.provider === "stripe" && isUpgrade
            ? current.subscription?.stripeSubscriptionId || ""
            : "",
        idempotencyKey: `stripe-sub:${getIdempotencyKey(req)}`,
      });

      return res.json({
        ok: true,
        sessionId: session.id,
        url: session.url,
        referral: {
          code: referralMeta.code || null,
          buyerDiscountPct: referralMeta.buyerDiscountPct || 0,
          refRewardPct: referralMeta.refRewardPct || 0,
          ownerPlanSlug: referralMeta.ownerPlanSlug,
          ownerPlanName: referralMeta.ownerPlanName,
        },
      });
    } catch (e) {
      return err(
        res,
        Number(e?.status) || 500,
        e?.code || "STRIPE_CHECKOUT_FAILED",
        e?.message || "No se pudo iniciar Stripe Checkout.",
        e?.details || null
      );
    }
  });

  // POST /api/billing/stripe/checkout/topup { productId }
  router.post("/billing/stripe/checkout/topup", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });
    if (!requireStripeConfigured(res)) return;

    try {
      await assertLegalAccepted(user.id);
      await reconcileStripeCustomerState(user.id, "/billing/stripe/checkout/topup");

      const sub = await requireActiveSubscription(user.id);
      if (sub.error) return err(res, 403, sub.error.code, sub.error.message, sub.error.details);

      const productId = req.body?.productId ? String(req.body.productId) : "";
      if (!productId) return err(res, 400, "BAD_REQUEST", "Falta productId.");

      const product = await fetchTopupProductById(productId, { requireStripePrice: true });
      const session = await stripeBilling.createTopupCheckoutSession({
        req,
        user,
        product,
        idempotencyKey: `stripe-topup:${getIdempotencyKey(req)}`,
      });

      return res.json({ ok: true, sessionId: session.id, url: session.url });
    } catch (e) {
      return err(
        res,
        Number(e?.status) || 500,
        e?.code || "STRIPE_CHECKOUT_FAILED",
        e?.message || "No se pudo iniciar Stripe Checkout para créditos extra.",
        e?.details || null
      );
    }
  });

  // POST /api/billing/stripe/cancel-now
  router.post("/billing/stripe/cancel-now", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });
    if (!requireStripeConfigured(res)) return;

    try {
      const current = await getActiveSubscription(user.id);
      if (current.error) return err(res, 500, current.error.code, current.error.message, current.error.details);

      if (!current.subscription?.stripeSubscriptionId || current.subscription?.provider !== "stripe") {
        return err(res, 409, "NO_STRIPE_SUBSCRIPTION", "No hay una suscripción activa de Stripe para cancelar.");
      }

      const stripeSubscriptionId = current.subscription.stripeSubscriptionId;
      const canceled = await stripeBilling.cancelSubscriptionImmediately(stripeSubscriptionId);
      await stripeBilling.syncSubscriptionFromStripe(canceled || stripeSubscriptionId);
      await reconcileStripeCustomerState(user.id, "/billing/stripe/cancel-now");

      let refreshed = await getActiveSubscription(user.id);
      if (refreshed.error) return err(res, 500, refreshed.error.code, refreshed.error.message, refreshed.error.details);

      const sameStripeSubStillActive =
        refreshed.subscription?.provider === "stripe" &&
        String(refreshed.subscription?.stripeSubscriptionId || "") === String(stripeSubscriptionId || "");

      if (sameStripeSubStillActive) {
        const { error: cancelLocalErr } = await supabaseAdmin.rpc("billing_cancel_subscription", {
          p_user_id: user.id,
          p_wipe_generation_credits: false,
          p_idempotency_key: `stripe-cancel-fallback:${getIdempotencyKey(req)}`,
        });

        if (cancelLocalErr) {
          // eslint-disable-next-line no-console
          console.warn("billing_cancel_subscription fallback after Stripe cancel failed:", cancelLocalErr.message);
        }

        refreshed = await getActiveSubscription(user.id);
        if (refreshed.error) return err(res, 500, refreshed.error.code, refreshed.error.message, refreshed.error.details);
      }

      return res.json({ ok: true, subscription: refreshed.subscription || null });
    } catch (e) {
      return err(
        res,
        Number(e?.status) || 500,
        e?.code || "STRIPE_CANCEL_FAILED",
        e?.message || "No se pudo cancelar la suscripción de Stripe.",
        e?.details || null
      );
    }
  });

  // POST /api/billing/admin/self-cancel-local { wipeGenerationCredits?: boolean }
  router.post("/billing/admin/self-cancel-local", async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const userId = auth.user?.id || auth.admin?.user?.id || auth.admin?.id;
    if (!userId) {
      return err(res, 403, "FORBIDDEN", "No se pudo resolver el usuario admin autenticado.");
    }

    const idem = getIdempotencyKey(req);
    const wipeGenerationCredits = req.body?.wipeGenerationCredits === true;

    const { data, error: cErr } = await supabaseAdmin.rpc("billing_cancel_subscription", {
      p_user_id: userId,
      p_wipe_generation_credits: wipeGenerationCredits,
      p_idempotency_key: `self-force-cancel:${idem}`,
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

  // POST /api/billing/stripe/portal { flow }
  router.post("/billing/stripe/portal", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });
    if (!requireStripeConfigured(res)) return;

    try {
      const flow = normalizeString(req.body?.flow || "general") || "general";
      if (!["general", "cancel", "payment_method_update", "update"].includes(flow)) {
        return err(res, 400, "BAD_REQUEST", "flow inválido. Usa general, cancel, payment_method_update o update.");
      }

      await reconcileStripeCustomerState(user.id, "/billing/stripe/portal");

      const current = await getActiveSubscription(user.id);
      if (current.error) return err(res, 500, current.error.code, current.error.message, current.error.details);

      const needsSubscription = flow === "cancel" || flow === "update";
      if (needsSubscription) {
        if (!current.subscription?.stripeSubscriptionId || current.subscription?.provider !== "stripe") {
          return err(
            res,
            409,
            "NO_STRIPE_SUBSCRIPTION",
            "No hay una suscripción activa de Stripe para ese flujo."
          );
        }
      }

      const session = await stripeBilling.createPortalSession({
        req,
        user,
        subscriptionId: current.subscription?.stripeSubscriptionId || "",
        flow,
      });

      return res.json({ ok: true, url: session.url, flow });
    } catch (e) {
      return err(
        res,
        Number(e?.status) || 500,
        e?.code || "STRIPE_PORTAL_FAILED",
        e?.message || "No se pudo abrir el portal de Stripe.",
        e?.details || null
      );
    }
  });

  // GET /api/billing/stripe/checkout/status?sessionId=cs_xxx
  router.get("/billing/stripe/checkout/status", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });
    if (!requireStripeConfigured(res)) return;

    const sessionId = req.query?.sessionId ? String(req.query.sessionId) : "";
    if (!sessionId) return err(res, 400, "BAD_REQUEST", "Falta sessionId.");

    try {
      const status = await stripeBilling.getCheckoutStatusForUser({ userId: user.id, sessionId });
      return res.json(status);
    } catch (e) {
      return err(
        res,
        Number(e?.status) || 500,
        e?.code || "STRIPE_STATUS_FAILED",
        e?.message || "No se pudo consultar el estado del checkout.",
        e?.details || null
      );
    }
  });

  // POST /api/billing/admin/assign-plan { email|userId, planSlug }
  router.post("/billing/admin/assign-plan", async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    try {
      const targetUser = await resolveTargetUserFromBody(req, res);
      if (!targetUser) return;

      const planSlug = req.body?.planSlug ? String(req.body.planSlug) : "";
      if (!planSlug) return err(res, 400, "BAD_REQUEST", "Falta planSlug.");

      const current = await getActiveSubscription(targetUser.id);
      if (current.error) return err(res, 500, current.error.code, current.error.message, current.error.details);
      if (current.subscription?.provider === "stripe") {
        return err(
          res,
          409,
          "TARGET_HAS_STRIPE_SUBSCRIPTION",
          "Ese usuario tiene una suscripción activa de Stripe. Cancélala primero para evitar cobro duplicado.",
          { subscriptionId: current.subscription.stripeSubscriptionId || null }
        );
      }

      const plan = await fetchPlanBySlug(planSlug, { requireStripePrice: false });
      const result = await activateManualPlanForUser({
        userId: targetUser.id,
        plan,
        idempotencyKey: `owner-plan:${getIdempotencyKey(req)}`,
      });

      return res.json({
        ok: true,
        user: {
          id: targetUser.id,
          email: targetUser.email || null,
        },
        plan,
        subscription: result.subscription,
      });
    } catch (e) {
      return err(res, Number(e?.status) || 500, e?.code || "ASSIGN_PLAN_FAILED", e?.message || "No se pudo asignar el plan.", e?.details || null);
    }
  });

  // POST /api/billing/admin/cancel-plan { email|userId, wipeGenerationCredits? }
  router.post("/billing/admin/cancel-plan", async (req, res) => {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const targetUser = await resolveTargetUserFromBody(req, res);
    if (!targetUser) return;

    const idem = getIdempotencyKey(req);
    const wipeGenerationCredits = req.body?.wipeGenerationCredits === true;

    const current = await getActiveSubscription(targetUser.id);
    if (current.error) return err(res, 500, current.error.code, current.error.message, current.error.details);

    if (current.subscription?.provider === "stripe") {
      if (!requireStripeConfigured(res)) return;
      try {
        if (current.subscription?.stripeSubscriptionId) {
          await stripeBilling.cancelSubscriptionImmediately(current.subscription.stripeSubscriptionId);
        }
      } catch (e) {
        return err(
          res,
          Number(e?.status) || 500,
          e?.code || "STRIPE_CANCEL_FAILED",
          e?.message || "No se pudo cancelar la suscripción de Stripe del usuario objetivo.",
          e?.details || null
        );
      }
    }

    const { data, error: cErr } = await supabaseAdmin.rpc("billing_cancel_subscription", {
      p_user_id: targetUser.id,
      p_wipe_generation_credits: wipeGenerationCredits,
      p_idempotency_key: `owner-cancel:${idem}`,
    });

    if (cErr) {
      const msg = String(cErr.message || "");
      if (msg.includes("NO_ACTIVE_SUBSCRIPTION")) {
        return err(res, 400, "NO_ACTIVE_PLAN", "Ese usuario no tiene plan activo.");
      }
      return err(res, 500, "CANCEL_FAILED", cErr.message);
    }

    const row = Array.isArray(data) ? data[0] : null;
    return res.json({
      ok: true,
      user: {
        id: targetUser.id,
        email: targetUser.email || null,
      },
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
      .select(
        "id, slug, name, billing_period, price_cents, plan_credits, bonus_credits, max_concurrency, can_sell, can_referrals, is_active, stripe_price_id"
      )
      .eq("is_active", true)
      .order("price_cents", { ascending: true });

    if (error) return err(res, 500, "DB_QUERY_FAILED", error.message);

    const plans = (data || []).map((plan) => ({
      ...plan,
      checkoutEnabled: Boolean(normalizeString(plan?.stripe_price_id)),
      stripe_price_id: undefined,
    }));

    return res.json({ ok: true, plans });
  });

  // GET /api/billing/topups
  router.get("/billing/topups", async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("credit_topup_products")
      .select("id, sku, name, price_cents, credits_amount, is_active, stripe_price_id, created_at, updated_at")
      .eq("is_active", true)
      .order("price_cents", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) return err(res, 500, "DB_QUERY_FAILED", error.message);

    const grouped = new Map();
    for (const row of data || []) {
      const key = canonicalTopupKey(row);
      grouped.set(key, pickPreferredTopupRow(grouped.get(key), row));
    }

    const topups = Array.from(grouped.values())
      .sort((a, b) => Number(a?.price_cents || 0) - Number(b?.price_cents || 0))
      .map((topup) => ({
        id: topup.id,
        sku: topup.sku,
        name: topup.name,
        price_cents: topup.price_cents,
        credits_amount: topup.credits_amount,
        is_active: topup.is_active,
        checkoutEnabled: Boolean(normalizeString(topup?.stripe_price_id)),
      }));

    return res.json({ ok: true, topups });
  });

  return router;
}
