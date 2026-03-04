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

export async function getBuyerPurchases(opts?: { limit?: number; offset?: number }) {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));

  const resp = await fetch(apiUrl(`/api/trades/buyer/purchases?${params.toString()}`), { method: "GET", headers });
  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Buyer purchases failed (${resp.status})`);
  }

  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextOffset: Number(data.nextOffset) || 0,
    hasMore: Boolean(data.hasMore),
  };
}

export async function getSellerListings(opts?: { limit?: number; offset?: number }) {
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));

  const resp = await fetch(apiUrl(`/api/trades/seller/listings?${params.toString()}`), { method: "GET", headers });
  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Seller listings failed (${resp.status})`);
  }

  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextOffset: Number(data.nextOffset) || 0,
    hasMore: Boolean(data.hasMore),
  };
}