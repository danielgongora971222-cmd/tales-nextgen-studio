import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
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

export async function getMyWallet() {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/wallet/me`), { method: "GET", headers });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Wallet failed (${resp.status})`);
  }

  return data.wallet;
}

export async function getWalletMe(opts?: { syncStripe?: boolean; strictSync?: boolean }): Promise<{ wallet: any; subscription: any | null }> {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (opts?.syncStripe) params.set("syncStripe", "1");
  if (opts?.strictSync) params.set("strictSync", "1");
  const qs = params.toString();
  const resp = await fetch(apiUrl(`/api/wallet/me${qs ? `?${qs}` : ""}`), { method: "GET", headers });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const code = data?.error?.code;
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const err: any = new Error(msg);
    err.code = code;
    err.details = data?.error?.details || null;
    throw err;
  }

  return { wallet: data.wallet, subscription: data.subscription || null, cashoutConfig: data.cashoutConfig || null } as any;
}

function makeIdempotencyKey(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {}
  return `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function transferEarningsToGeneration(amountCredits: number) {
  const headers = await authHeaders();
  headers["x-idempotency-key"] = makeIdempotencyKey();

  const resp = await fetch(apiUrl(`/api/wallet/earnings/transfer`), {
    method: "POST",
    headers,
    body: JSON.stringify({ amountCredits }),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const code = data?.error?.code;
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const err: any = new Error(msg);
    err.code = code;
    err.details = data?.error?.details || null;
    throw err;
  }

  return data;
}

export async function requestCashout(amountCredits: number, payoutMethod: { kind: string; handle: string; note?: string }) {
  const headers = await authHeaders();
  headers["x-idempotency-key"] = makeIdempotencyKey();

  const resp = await fetch(apiUrl(`/api/wallet/earnings/cashout`), {
    method: "POST",
    headers,
    body: JSON.stringify({ amountCredits, payoutMethod }),
  });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const code = data?.error?.code;
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const err: any = new Error(msg);
    err.code = code;
    err.details = data?.error?.details || null;
    throw err;
  }

  return data;
}

export async function listMyCashouts(params?: { limit?: number; offset?: number }) {
  const headers = await authHeaders();
  const limit = params?.limit ?? 20;
  const offset = params?.offset ?? 0;

  const resp = await fetch(
    apiUrl(`/api/wallet/cashouts?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`),
    { method: "GET", headers }
  );

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const code = data?.error?.code;
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const err: any = new Error(msg);
    err.code = code;
    err.details = data?.error?.details || null;
    throw err;
  }

  return data;
}

export async function listEarningsHistory(
  bucket: "pending" | "available",
  params?: { limit?: number; offset?: number }
) {
  const headers = await authHeaders();
  const limit = params?.limit ?? 20;
  const offset = params?.offset ?? 0;

  const resp = await fetch(
    apiUrl(
      `/api/wallet/earnings/history?bucket=${encodeURIComponent(bucket)}&limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`
    ),
    { method: "GET", headers }
  );

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const code = data?.error?.code;
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    const err: any = new Error(msg);
    err.code = code;
    err.details = data?.error?.details || null;
    throw err;
  }

  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextOffset: Number(data.nextOffset) || 0,
    hasMore: Boolean(data.hasMore),
  };
}