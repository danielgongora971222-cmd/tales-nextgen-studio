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
    const msg = data?.error?.message || `Owner admin failed (${resp.status})`;
    const err: any = new Error(msg);
    err.code = data?.error?.code;
    err.details = data?.error?.details;
    throw err;
  }

  return data;
}

export async function ownerAssignMockPlanByEmail(email: string, planSlug: string) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/billing/admin/assign-plan", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: email.trim(), planSlug }),
  });
  emitWalletRefresh();
  return data;
}

export async function ownerCancelPlanByEmail(email: string, opts?: { wipeGenerationCredits?: boolean }) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/billing/admin/cancel-plan", {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: email.trim(),
      wipeGenerationCredits: opts?.wipeGenerationCredits === true,
    }),
  });
  emitWalletRefresh();
  return data;
}

export async function ownerGrantCreditsByEmail(email: string, amountCredits: number) {
  const headers = await authHeaders({ "x-idempotency-key": crypto.randomUUID() });
  const data = await request("/api/wallet/admin/grant", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: email.trim(), amountCredits }),
  });
  emitWalletRefresh();
  return data;
}
