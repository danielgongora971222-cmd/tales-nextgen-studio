import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";
import { emitWalletRefresh } from "./appEvents";

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json", ...(extra || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function parseJsonOrThrow(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`El backend devolvió texto/HTML en vez de JSON. Inicio: ${text.slice(0, 80)}`);
  }
}

async function request(path: string, init?: RequestInit) {
  const resp = await fetch(apiUrl(path), init);
  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);
  if (!resp.ok || data?.ok === false) {
    const msg = data?.error?.message || `Billing failed (${resp.status})`;
    const code = data?.error?.code;
    const err: any = new Error(msg);
    err.code = code;
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}

export async function billingMe(syncStripe = false, strictSync = false) {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (syncStripe) params.set("syncStripe", "1");
  if (strictSync) params.set("strictSync", "1");
  const qs = params.toString();
  const data = await request(`/api/billing/me${qs ? `?${qs}` : ""}`, { method: "GET", headers });
  return data.subscription;
}

export async function billingPlans() {
  const data = await request("/api/billing/plans", { method: "GET", headers: { "Content-Type": "application/json" } });
  return data.plans || [];
}

export async function billingTopups() {
  const data = await request("/api/billing/topups", { method: "GET", headers: { "Content-Type": "application/json" } });
  return data.topups || [];
}

export async function mockSubscribe(planSlug: string, referralCode?: string) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const clean = referralCode ? referralCode.trim() : "";
  const data = await request("/api/billing/mock/subscribe", {
    method: "POST",
    headers,
    body: JSON.stringify({ planSlug, referralCode: clean || null }),
  });
  emitWalletRefresh();
  return data.subscription;
}

export async function mockTopup(productId: string) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/billing/mock/topup", {
    method: "POST",
    headers,
    body: JSON.stringify({ productId }),
  });
  emitWalletRefresh();
  return data;
}

export async function mockCancel(opts?: { wipeGenerationCredits?: boolean }) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/billing/mock/cancel", {
    method: "POST",
    headers,
    body: JSON.stringify({
      wipeGenerationCredits: opts?.wipeGenerationCredits === true,
    }),
  });
  emitWalletRefresh();
  return data;
}

export async function createStripeSubscriptionCheckout(planSlug: string, referralCode?: string) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const clean = referralCode ? referralCode.trim() : "";
  return request("/api/billing/stripe/checkout/subscription", {
    method: "POST",
    headers,
    body: JSON.stringify({ planSlug, referralCode: clean || null }),
  });
}

export async function createStripeTopupCheckout(productId: string) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  return request("/api/billing/stripe/checkout/topup", {
    method: "POST",
    headers,
    body: JSON.stringify({ productId }),
  });
}

export async function createStripePortal(flow: "general" | "cancel" | "payment_method_update" | "update" = "general") {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  return request("/api/billing/stripe/portal", {
    method: "POST",
    headers,
    body: JSON.stringify({ flow }),
  });
}

export async function getStripeCheckoutStatus(sessionId: string) {
  const headers = await authHeaders();
  return request(`/api/billing/stripe/checkout/status?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers,
  });
}

export async function cancelStripeSubscriptionNow() {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/billing/stripe/cancel-now", {
    method: "POST",
    headers,
  });
  emitWalletRefresh();
  return data;
}

export async function ownerForceSelfCancelLocal(opts?: { wipeGenerationCredits?: boolean }) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/billing/admin/self-cancel-local", {
    method: "POST",
    headers,
    body: JSON.stringify({
      wipeGenerationCredits: opts?.wipeGenerationCredits === true,
    }),
  });
  emitWalletRefresh();
  return data;
}

