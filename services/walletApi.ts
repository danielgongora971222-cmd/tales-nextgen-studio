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

export async function getWalletMe(): Promise<{ wallet: any; subscription: any | null }> {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl(`/api/wallet/me`), { method: "GET", headers });

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

  return { wallet: data.wallet, subscription: data.subscription || null };
}