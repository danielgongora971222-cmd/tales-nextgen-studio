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

export async function billingMe() {
  const headers = await authHeaders();
  const data = await request("/api/billing/me", { method: "GET", headers });
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

export async function mockSubscribe(planSlug: string) {
  const headers = await authHeaders();
  const data = await request("/api/billing/mock/subscribe", {
    method: "POST",
    headers,
    body: JSON.stringify({ planSlug }),
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

export async function mockCancel() {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/billing/mock/cancel", {
    method: "POST",
    headers,
  });
  emitWalletRefresh();
  return data;
}
