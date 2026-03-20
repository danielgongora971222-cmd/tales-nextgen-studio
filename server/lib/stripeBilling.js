import { createHmac, timingSafeEqual } from "crypto";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function makeError(code, message, status = 400, details = null) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details || null;
  return err;
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function appendFormValue(form, key, value) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValue(form, `${key}[${index}]`, item));
    return;
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendFormValue(form, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  if (typeof value === "boolean") {
    form.append(key, value ? "true" : "false");
    return;
  }

  form.append(key, String(value));
}

function buildFormBody(params) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    appendFormValue(form, key, value);
  }
  return form;
}

function unixToIso(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Date(num * 1000).toISOString();
}

function parseStripeSignature(header) {
  const out = { timestamp: null, signatures: [] };
  for (const part of String(header || "").split(",")) {
    const [rawKey, rawValue] = part.split("=");
    const key = normalizeString(rawKey);
    const value = normalizeString(rawValue);
    if (!key || !value) continue;
    if (key === "t") out.timestamp = Number(value);
    if (key === "v1") out.signatures.push(value);
  }
  return out;
}

function safeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(String(a || ""), "hex");
    const bufB = Buffer.from(String(b || ""), "hex");
    if (!bufA.length || !bufB.length || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function localStatusFromStripeStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  if (normalized === "active" || normalized === "trialing") return "active";
  if (normalized === "canceled") return "canceled";
  return "expired";
}

function firstPriceIdFromSubscription(subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const first = items[0] || null;
  const price = first?.price || null;
  return normalizeString(price?.id);
}

function normalizeStripeObjectId(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value.id) return String(value.id).trim();
  return "";
}

export function createStripeBillingHelpers({ supabaseAdmin, billing }) {
  const STRIPE_SECRET_KEY = normalizeString(process.env.STRIPE_SECRET_KEY);
  const STRIPE_WEBHOOK_SECRET = normalizeString(process.env.STRIPE_WEBHOOK_SECRET);
  const STRIPE_API_BASE = normalizeString(process.env.STRIPE_API_BASE) || "https://api.stripe.com";
  const STRIPE_API_VERSION = normalizeString(process.env.STRIPE_API_VERSION);
  const STRIPE_BILLING_PORTAL_CONFIGURATION_ID = normalizeString(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID);
  const APP_PUBLIC_URL = normalizeString(process.env.APP_PUBLIC_URL).replace(/\/+$/g, "");
  const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Math.max(
    60,
    Math.trunc(Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300))
  );
  const STRIPE_ENABLE_AUTOMATIC_TAX = String(process.env.STRIPE_ENABLE_AUTOMATIC_TAX || "").trim() === "1";

  function isConfigured() {
    return Boolean(STRIPE_SECRET_KEY);
  }

  function assertConfigured() {
    if (!STRIPE_SECRET_KEY) {
      throw makeError(
        "STRIPE_NOT_CONFIGURED",
        "Stripe no está configurado todavía en el backend. Falta STRIPE_SECRET_KEY.",
        503
      );
    }
  }

  function resolveAppBaseUrl(req) {
    if (APP_PUBLIC_URL) return APP_PUBLIC_URL;

    const origin = normalizeString(req?.headers?.origin).replace(/\/+$/g, "");
    if (origin && /^https?:\/\//i.test(origin)) return origin;

    const referer = normalizeString(req?.headers?.referer);
    if (referer) {
      try {
        const url = new URL(referer);
        return url.origin.replace(/\/+$/g, "");
      } catch {
        // ignore
      }
    }

    return "";
  }

  function buildAppReturnUrl(req, { route = "paywall", status = null, sessionId = null, portal = null } = {}) {
    const base = resolveAppBaseUrl(req);
    if (!base) {
      throw makeError(
        "APP_PUBLIC_URL_MISSING",
        "No pude calcular la URL pública de la app. Configura APP_PUBLIC_URL en Render con la URL de Vercel.",
        500
      );
    }

    const url = new URL(base.startsWith("http") ? base : `https://${base}`);
    if (route) url.searchParams.set("route", route);
    if (status) url.searchParams.set("stripe_status", status);
    if (sessionId) url.searchParams.set("session_id", sessionId);
    if (portal) url.searchParams.set("portal", portal);
    return url.toString();
  }

  async function stripeRequest(method, path, params = null, opts = {}) {
    assertConfigured();

    const headers = {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    };

    if (STRIPE_API_VERSION) {
      headers["Stripe-Version"] = STRIPE_API_VERSION;
    }

    if (opts.idempotencyKey) {
      headers["Idempotency-Key"] = String(opts.idempotencyKey);
    }

    let url = `${STRIPE_API_BASE}${path}`;
    let body = undefined;

    if (method === "GET") {
      if (params && Object.keys(params).length) {
        const form = buildFormBody(params);
        const qs = form.toString();
        if (qs) url += `?${qs}`;
      }
    } else if (params && Object.keys(params).length) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = buildFormBody(params).toString();
    }

    const resp = await fetch(url, { method, headers, body });
    const raw = await resp.text();
    const data = parseJsonSafe(raw);

    if (!resp.ok) {
      const stripeError = data?.error || null;
      throw makeError(
        stripeError?.code || stripeError?.type || "STRIPE_REQUEST_FAILED",
        stripeError?.message || `Stripe request failed (${resp.status}).`,
        resp.status,
        {
          path,
          type: stripeError?.type || null,
          decline_code: stripeError?.decline_code || null,
          param: stripeError?.param || null,
          request_id: resp.headers.get("request-id") || null,
        }
      );
    }

    return data;
  }

  async function getCustomerRowByUserId(userId) {
    const { data, error } = await supabaseAdmin
      .from("billing_customers")
      .select("user_id, stripe_customer_id, email")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw makeError("DB_QUERY_FAILED", error.message, 500);
    }

    return data || null;
  }

  async function getCustomerRowByStripeCustomerId(stripeCustomerId) {
    const { data, error } = await supabaseAdmin
      .from("billing_customers")
      .select("user_id, stripe_customer_id, email")
      .eq("stripe_customer_id", stripeCustomerId)
      .maybeSingle();

    if (error) {
      throw makeError("DB_QUERY_FAILED", error.message, 500);
    }

    return data || null;
  }

  async function upsertCustomerRow({ userId, stripeCustomerId, email }) {
    const payload = {
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
      email: email || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("billing_customers")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      throw makeError("DB_UPSERT_FAILED", error.message, 500);
    }

    return payload;
  }

  async function ensureCustomerForUser(user) {
    const existing = await getCustomerRowByUserId(user.id);
    if (existing?.stripe_customer_id) {
      if (user?.email && user.email !== existing.email) {
        await upsertCustomerRow({
          userId: user.id,
          stripeCustomerId: existing.stripe_customer_id,
          email: user.email,
        });
      }
      return existing.stripe_customer_id;
    }

    const customer = await stripeRequest(
      "POST",
      "/v1/customers",
      {
        email: user?.email || undefined,
        name:
          user?.user_metadata?.display_name ||
          user?.user_metadata?.username ||
          user?.email ||
          undefined,
        metadata: {
          app_user_id: user.id,
        },
      },
      { idempotencyKey: `stripe-customer:${user.id}` }
    );

    await upsertCustomerRow({
      userId: user.id,
      stripeCustomerId: customer.id,
      email: user?.email || null,
    });

    return customer.id;
  }

  async function resolveUserIdFromStripeContext({ metadata, clientReferenceId, stripeCustomerId }) {
    const fromMetadata = normalizeString(metadata?.app_user_id || metadata?.user_id);
    if (fromMetadata) return fromMetadata;

    const fromClientReference = normalizeString(clientReferenceId);
    if (fromClientReference) return fromClientReference;

    const customerId = normalizeString(stripeCustomerId);
    if (customerId) {
      const row = await getCustomerRowByStripeCustomerId(customerId);
      if (row?.user_id) return row.user_id;
    }

    return "";
  }

  async function getPlanByPriceId(priceId) {
    const { data, error } = await supabaseAdmin
      .from("billing_plans")
      .select("id, slug, name, billing_period, price_cents, plan_credits, bonus_credits, max_concurrency, can_sell, can_referrals, stripe_price_id")
      .eq("stripe_price_id", priceId)
      .maybeSingle();

    if (error) {
      throw makeError("DB_QUERY_FAILED", error.message, 500);
    }

    return data || null;
  }

  async function getTopupProductById(productId) {
    const { data, error } = await supabaseAdmin
      .from("credit_topup_products")
      .select("id, sku, name, price_cents, credits_amount, stripe_price_id, is_active")
      .eq("id", productId)
      .maybeSingle();

    if (error) {
      throw makeError("DB_QUERY_FAILED", error.message, 500);
    }

    return data || null;
  }

  function getReferralCouponId(discountPct) {
    const pct = Math.trunc(Number(discountPct || 0));
    if (!Number.isFinite(pct) || pct <= 0) return "";
    const envKey = `STRIPE_COUPON_REFERRAL_${pct}`;
    return normalizeString(process.env[envKey]);
  }

  async function createSubscriptionCheckoutSession({ req, user, plan, referralCode = "", referralDiscountPct = 0, idempotencyKey }) {
    const customerId = await ensureCustomerForUser(user);
    const successUrl = buildAppReturnUrl(req, { route: "paywall", status: "success", sessionId: "{CHECKOUT_SESSION_ID}" });
    const cancelUrl = buildAppReturnUrl(req, { route: "paywall", status: "cancel" });

    const cleanReferralCode = normalizeString(referralCode).toUpperCase();
    const couponId = getReferralCouponId(referralDiscountPct);
    if (cleanReferralCode && Number(referralDiscountPct || 0) > 0 && !couponId) {
      throw makeError(
        "REFERRAL_COUPON_NOT_CONFIGURED",
        `El código de referido requiere un cupón de Stripe para ${referralDiscountPct}% y no está configurado en Render.`
      );
    }

    const metadata = {
      app_user_id: user.id,
      app_plan_id: String(plan.id),
      app_plan_slug: String(plan.slug),
      referral_code: cleanReferralCode || undefined,
    };

    const params = {
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: "auto",
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      metadata,
      subscription_data: {
        metadata,
      },
    };

    if (couponId) {
      params.discounts = [{ coupon: couponId }];
    }

    if (STRIPE_ENABLE_AUTOMATIC_TAX) {
      params.automatic_tax = { enabled: true };
    }

    return stripeRequest("POST", "/v1/checkout/sessions", params, {
      idempotencyKey,
    });
  }

  async function createTopupCheckoutSession({ req, user, product, idempotencyKey }) {
    const customerId = await ensureCustomerForUser(user);
    const successUrl = buildAppReturnUrl(req, { route: "paywall", status: "success", sessionId: "{CHECKOUT_SESSION_ID}" });
    const cancelUrl = buildAppReturnUrl(req, { route: "paywall", status: "cancel" });

    const metadata = {
      app_user_id: user.id,
      topup_product_id: String(product.id),
      topup_sku: product?.sku ? String(product.sku) : undefined,
    };

    const params = {
      mode: "payment",
      customer: customerId,
      client_reference_id: user.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: "auto",
      line_items: [{ price: product.stripe_price_id, quantity: 1 }],
      metadata,
      payment_intent_data: {
        metadata,
      },
    };

    if (STRIPE_ENABLE_AUTOMATIC_TAX) {
      params.automatic_tax = { enabled: true };
    }

    return stripeRequest("POST", "/v1/checkout/sessions", params, {
      idempotencyKey,
    });
  }

  async function createPortalSession({ req, user, subscriptionId = "", flow = "general" }) {
    const customerId = await ensureCustomerForUser(user);
    const returnUrl = buildAppReturnUrl(req, { route: "profile", portal: "return" });

    const params = {
      customer: customerId,
      return_url: returnUrl,
    };

    if (STRIPE_BILLING_PORTAL_CONFIGURATION_ID) {
      params.configuration = STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
    }

    if (flow === "cancel") {
      if (!subscriptionId) {
        throw makeError("NO_STRIPE_SUBSCRIPTION", "No hay una suscripción de Stripe activa para cancelar.");
      }

      params.flow_data = {
        type: "subscription_cancel",
        after_completion: {
          type: "redirect",
          redirect: { return_url: returnUrl },
        },
        subscription_cancel: {
          subscription: subscriptionId,
        },
      };
    } else if (flow === "payment_method_update") {
      params.flow_data = {
        type: "payment_method_update",
        after_completion: {
          type: "redirect",
          redirect: { return_url: returnUrl },
        },
      };
    } else if (flow === "update") {
      if (!subscriptionId) {
        throw makeError("NO_STRIPE_SUBSCRIPTION", "No hay una suscripción de Stripe activa para cambiar.");
      }

      params.flow_data = {
        type: "subscription_update",
        after_completion: {
          type: "redirect",
          redirect: { return_url: returnUrl },
        },
        subscription_update: {
          subscription: subscriptionId,
        },
      };
    }

    return stripeRequest("POST", "/v1/billing_portal/sessions", params);
  }

  async function fetchCheckoutSession(sessionId) {
    return stripeRequest("GET", `/v1/checkout/sessions/${sessionId}`, {
      expand: ["subscription", "payment_intent"],
    });
  }

  async function fetchSubscription(subscriptionId) {
    return stripeRequest("GET", `/v1/subscriptions/${subscriptionId}`, {
      expand: ["items.data.price"],
    });
  }

  async function cancelSubscriptionImmediately(subscriptionId) {
    return stripeRequest("DELETE", `/v1/subscriptions/${subscriptionId}`);
  }

  async function syncSubscriptionFromStripe(subscriptionLike) {
    const stripeSubscriptionId = normalizeStripeObjectId(subscriptionLike?.id || subscriptionLike);
    if (!stripeSubscriptionId) {
      throw makeError("STRIPE_SUBSCRIPTION_ID_MISSING", "Stripe no devolvió el id de la suscripción.", 500);
    }

    const subscription = typeof subscriptionLike === "object" && subscriptionLike?.items?.data
      ? subscriptionLike
      : await fetchSubscription(stripeSubscriptionId);

    const stripeCustomerId = normalizeStripeObjectId(subscription?.customer);
    const userId = await resolveUserIdFromStripeContext({
      metadata: subscription?.metadata || {},
      stripeCustomerId,
    });

    if (!userId) {
      throw makeError(
        "STRIPE_USER_NOT_RESOLVED",
        "No pude relacionar la suscripción de Stripe con un usuario interno.",
        500,
        { stripeSubscriptionId, stripeCustomerId }
      );
    }

    const priceId = firstPriceIdFromSubscription(subscription);
    if (!priceId) {
      throw makeError("STRIPE_PRICE_NOT_FOUND", "No encontré el Stripe Price de la suscripción.", 500, {
        stripeSubscriptionId,
      });
    }

    const plan = await getPlanByPriceId(priceId);
    if (!plan?.id) {
      throw makeError(
        "PLAN_NOT_MAPPED",
        "Esta suscripción de Stripe usa un Price ID que no está mapeado en billing_plans.stripe_price_id.",
        500,
        { stripeSubscriptionId, priceId }
      );
    }

    const localStatus = localStatusFromStripeStatus(subscription?.status);

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("billing_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .maybeSingle();

    if (existingErr) {
      throw makeError("DB_QUERY_FAILED", existingErr.message, 500);
    }

    const payload = {
      user_id: userId,
      plan_id: plan.id,
      status: localStatus,
      provider: "stripe",
      current_period_start: unixToIso(subscription?.current_period_start) || new Date().toISOString(),
      current_period_end: unixToIso(subscription?.current_period_end) || new Date().toISOString(),
      stripe_customer_id: stripeCustomerId || null,
      stripe_subscription_id: stripeSubscriptionId,
      cancel_at_period_end: subscription?.cancel_at_period_end === true,
      canceled_at: unixToIso(subscription?.canceled_at),
      ended_at: unixToIso(subscription?.ended_at),
      updated_at: new Date().toISOString(),
    };

    if (localStatus === "active") {
      let expireQuery = supabaseAdmin
        .from("billing_subscriptions")
        .update({
          status: "expired",
          current_period_end: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("status", "active");

      if (existing?.id) {
        expireQuery = expireQuery.neq("id", existing.id);
      }

      const { error: expireErr } = await expireQuery;

      if (expireErr) {
        throw makeError("DB_UPDATE_FAILED", expireErr.message, 500);
      }
    }

    let finalRow = null;
    if (existing?.id) {
      const { data, error } = await supabaseAdmin
        .from("billing_subscriptions")
        .update(payload)
        .eq("id", existing.id)
        .select("id, user_id, plan_id, status, provider, current_period_start, current_period_end, stripe_subscription_id, cancel_at_period_end")
        .maybeSingle();
      if (error) {
        throw makeError("DB_UPDATE_FAILED", error.message, 500);
      }
      finalRow = data || null;
    } else {
      const { data, error } = await supabaseAdmin
        .from("billing_subscriptions")
        .insert(payload)
        .select("id, user_id, plan_id, status, provider, current_period_start, current_period_end, stripe_subscription_id, cancel_at_period_end")
        .maybeSingle();
      if (error) {
        throw makeError("DB_INSERT_FAILED", error.message, 500);
      }
      finalRow = data || null;
    }

    if (stripeCustomerId) {
      const existingCustomer = await getCustomerRowByUserId(userId);
      await upsertCustomerRow({ userId, stripeCustomerId, email: existingCustomer?.email || null });
    }

    return {
      userId,
      plan,
      subscription,
      row: finalRow,
    };
  }

  async function applyPlanGrantFromInvoice(invoice) {
    const stripeSubscriptionId = normalizeStripeObjectId(invoice?.subscription);
    if (!stripeSubscriptionId) return { skipped: true, reason: "invoice_without_subscription" };

    const synced = await syncSubscriptionFromStripe(stripeSubscriptionId);
    if (!synced?.row?.id || !synced?.plan?.id) {
      throw makeError("SUBSCRIPTION_SYNC_FAILED", "No se pudo sincronizar la suscripción pagada.", 500);
    }

    const periodStart = synced.row.current_period_start || unixToIso(synced.subscription?.current_period_start) || new Date().toISOString();
    const periodEnd = synced.row.current_period_end || unixToIso(synced.subscription?.current_period_end) || new Date().toISOString();

    const { error: grantErr } = await supabaseAdmin.rpc("wallet_grant_plan_credits", {
      p_user_id: synced.userId,
      p_plan_id: synced.plan.id,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_idempotency_key: `stripe:invoice_paid:${invoice.id}`,
    });

    if (grantErr) {
      throw makeError("PLAN_GRANT_FAILED", grantErr.message, 500);
    }

    const billingReason = normalizeString(invoice?.billing_reason).toLowerCase();
    const referralCode = normalizeString(synced.subscription?.metadata?.referral_code).toUpperCase();
    if (billingReason === "subscription_create" && referralCode) {
      const { error: referralErr } = await supabaseAdmin.rpc("billing_apply_referral_on_subscribe", {
        p_buyer_id: synced.userId,
        p_referral_code: referralCode,
        p_plan_id: synced.plan.id,
        p_idempotency_key: `stripe:subref:${invoice.id}`,
      });

      if (referralErr) {
        throw makeError("REFERRAL_APPLY_FAILED", referralErr.message, 500);
      }
    }

    return { ok: true, synced };
  }

  async function applyTopupFromCheckoutSession(sessionLike) {
    const session = typeof sessionLike === "object" && sessionLike?.id ? sessionLike : await fetchCheckoutSession(String(sessionLike));

    if (normalizeString(session?.mode) !== "payment") {
      return { skipped: true, reason: "session_not_payment_mode" };
    }

    if (normalizeString(session?.payment_status).toLowerCase() !== "paid") {
      return { skipped: true, reason: "session_not_paid_yet" };
    }

    const userId = await resolveUserIdFromStripeContext({
      metadata: session?.metadata || {},
      clientReferenceId: session?.client_reference_id,
      stripeCustomerId: normalizeStripeObjectId(session?.customer),
    });

    if (!userId) {
      throw makeError("STRIPE_USER_NOT_RESOLVED", "No pude resolver el usuario del topup de Stripe.", 500, {
        sessionId: session?.id,
      });
    }

    const productId = normalizeString(session?.metadata?.topup_product_id);
    if (!productId) {
      throw makeError("TOPUP_PRODUCT_NOT_FOUND", "Falta topup_product_id en el Checkout Session de Stripe.", 500, {
        sessionId: session?.id,
      });
    }

    const product = await getTopupProductById(productId);
    if (!product?.id) {
      throw makeError("TOPUP_PRODUCT_NOT_FOUND", "El topup configurado ya no existe en la base de datos.", 500, {
        productId,
      });
    }

    const { error: topupErr } = await supabaseAdmin.rpc("wallet_add_topup_credits_from_stripe", {
      p_user_id: userId,
      p_product_id: product.id,
      p_checkout_session_id: String(session.id),
      p_payment_intent_id: normalizeStripeObjectId(session?.payment_intent) || null,
      p_idempotency_key: `stripe:topup:${session.id}`,
    });

    if (topupErr) {
      throw makeError("TOPUP_FAILED", topupErr.message, 500);
    }

    return { ok: true, userId, product };
  }

  async function getWebhookEventRecord(eventId) {
    const { data, error } = await supabaseAdmin
      .from("stripe_webhook_events")
      .select("event_id, processed_at, processing_error")
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) {
      throw makeError("DB_QUERY_FAILED", error.message, 500);
    }

    return data || null;
  }

  async function insertWebhookEventRecord(event) {
    const object = event?.data?.object || {};
    const objectId = normalizeStripeObjectId(object?.id || object?.subscription || object?.payment_intent || "");
    const { error } = await supabaseAdmin
      .from("stripe_webhook_events")
      .insert({
        event_id: event.id,
        event_type: event.type,
        object_id: objectId || null,
        livemode: event.livemode === true,
        payload: event,
        received_at: new Date().toISOString(),
      });

    const errorCode = normalizeString(error?.code);
    const errorMessage = String(error?.message || "").toLowerCase();
    if (error && errorCode !== "23505" && !errorMessage.includes("duplicate")) {
      throw makeError("DB_INSERT_FAILED", error.message, 500);
    }
  }

  async function markWebhookProcessed(eventId) {
    const { error } = await supabaseAdmin
      .from("stripe_webhook_events")
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("event_id", eventId);

    if (error) {
      throw makeError("DB_UPDATE_FAILED", error.message, 500);
    }
  }

  async function markWebhookError(eventId, error) {
    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({ processing_error: String(error?.message || error || "Unknown webhook error") })
      .eq("event_id", eventId);
  }

  function verifyWebhookPayload(rawBody, signatureHeader) {
    if (!STRIPE_WEBHOOK_SECRET) {
      throw makeError(
        "STRIPE_WEBHOOK_NOT_CONFIGURED",
        "Falta STRIPE_WEBHOOK_SECRET en Render. No se puede verificar el webhook de Stripe.",
        503
      );
    }

    const parsed = parseStripeSignature(signatureHeader);
    if (!parsed.timestamp || !parsed.signatures.length) {
      throw makeError("STRIPE_BAD_SIGNATURE", "La firma del webhook de Stripe no es válida.", 400);
    }

    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
    if (ageSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
      throw makeError("STRIPE_BAD_SIGNATURE", "La firma del webhook de Stripe llegó fuera de la ventana permitida.", 400, {
        ageSeconds,
      });
    }

    const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
    const signedPayload = `${parsed.timestamp}.${payloadString}`;
    const expected = createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(signedPayload, "utf8").digest("hex");

    const isValid = parsed.signatures.some((candidate) => safeEqualHex(candidate, expected));
    if (!isValid) {
      throw makeError("STRIPE_BAD_SIGNATURE", "La firma del webhook de Stripe no coincide.", 400);
    }

    const event = parseJsonSafe(payloadString);
    if (!event?.id || !event?.type) {
      throw makeError("STRIPE_BAD_PAYLOAD", "El webhook de Stripe no trae un evento JSON válido.", 400);
    }

    return event;
  }

  async function handleWebhook(req, res) {
    try {
      const event = verifyWebhookPayload(req.body, req.headers["stripe-signature"]);
      const existing = await getWebhookEventRecord(event.id);
      if (existing?.processed_at) {
        return res.json({ ok: true, duplicate: true, eventId: event.id });
      }

      if (!existing) {
        await insertWebhookEventRecord(event);
      }

      try {
        switch (event.type) {
          case "invoice.paid":
            await applyPlanGrantFromInvoice(event.data?.object || {});
            break;
          case "invoice.payment_failed":
            if (event.data?.object?.subscription) {
              await syncSubscriptionFromStripe(event.data.object.subscription);
            }
            break;
          case "customer.subscription.created":
          case "customer.subscription.updated":
          case "customer.subscription.deleted":
            await syncSubscriptionFromStripe(event.data?.object || {});
            break;
          case "checkout.session.completed":
          case "checkout.session.async_payment_succeeded":
            await applyTopupFromCheckoutSession(event.data?.object || {});
            break;
          default:
            break;
        }

        await markWebhookProcessed(event.id);
        return res.json({ ok: true, eventId: event.id });
      } catch (innerError) {
        await markWebhookError(event.id, innerError);
        throw innerError;
      }
    } catch (error) {
      const status = Number(error?.status) || 500;
      return res.status(status).json({
        ok: false,
        error: {
          code: error?.code || "STRIPE_WEBHOOK_FAILED",
          message: error?.message || "Stripe webhook failed.",
          details: error?.details || null,
        },
      });
    }
  }

  async function getCheckoutStatusForUser({ userId, sessionId }) {
    const session = await fetchCheckoutSession(sessionId);

    const sessionUserId = await resolveUserIdFromStripeContext({
      metadata: session?.metadata || {},
      clientReferenceId: session?.client_reference_id,
      stripeCustomerId: normalizeStripeObjectId(session?.customer),
    });

    if (!sessionUserId || sessionUserId !== userId) {
      throw makeError("FORBIDDEN", "Ese Checkout Session no pertenece al usuario autenticado.", 403);
    }

    let fulfilled = false;
    let localRef = null;

    if (normalizeString(session?.mode) === "subscription") {
      const stripeSubscriptionId = normalizeStripeObjectId(session?.subscription);
      if (stripeSubscriptionId) {
        const { data, error } = await supabaseAdmin
          .from("billing_subscriptions")
          .select("id, status, current_period_end, cancel_at_period_end")
          .eq("stripe_subscription_id", stripeSubscriptionId)
          .maybeSingle();

        if (error) throw makeError("DB_QUERY_FAILED", error.message, 500);
        localRef = data || null;
        fulfilled = Boolean(data?.id && data?.status === "active");
      }
    } else if (normalizeString(session?.mode) === "payment") {
      const { data, error } = await supabaseAdmin
        .from("credit_topup_purchases")
        .select("id, credits_amount, created_at")
        .eq("stripe_checkout_session_id", session.id)
        .maybeSingle();

      if (error) throw makeError("DB_QUERY_FAILED", error.message, 500);
      localRef = data || null;
      fulfilled = Boolean(data?.id);
    }

    const sessionStatus = normalizeString(session?.status).toLowerCase();
    const paymentStatus = normalizeString(session?.payment_status).toLowerCase();
    const state = fulfilled
      ? "fulfilled"
      : sessionStatus === "expired"
        ? "expired"
        : sessionStatus === "complete"
          ? "pending_fulfillment"
          : "open";

    return {
      ok: true,
      state,
      fulfilled,
      mode: session?.mode || null,
      sessionStatus: sessionStatus || null,
      paymentStatus: paymentStatus || null,
      sessionId: session.id,
      subscriptionId: normalizeStripeObjectId(session?.subscription) || null,
      paymentIntentId: normalizeStripeObjectId(session?.payment_intent) || null,
      localRef,
    };
  }

  return {
    isConfigured,
    ensureCustomerForUser,
    createSubscriptionCheckoutSession,
    createTopupCheckoutSession,
    createPortalSession,
    getCheckoutStatusForUser,
    handleWebhook,
    syncSubscriptionFromStripe,
    cancelSubscriptionImmediately,
    getReferralCouponId,
  };
}
