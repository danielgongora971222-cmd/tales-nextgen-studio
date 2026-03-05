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

async function request(path: string, init?: RequestInit) {
  const resp = await fetch(apiUrl(path), init);
  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error?.message || `Referrals failed (${resp.status})`;
    const code = data?.error?.code;
    const err: any = new Error(msg);
    err.code = code;
    err.details = data?.error?.details || null;
    throw err;
  }

  return data;
}

export async function getMyReferralCodes() {
  const headers = await authHeaders();
  const data = await request(`/api/referrals/me`, { method: "GET", headers });
  return Array.isArray(data.codes) ? data.codes : [];
}

export async function getMyReferralSummary(): Promise<{
  isConfigured: boolean;
  referrals: any[];
  totals: any;
}> {
  const headers = await authHeaders();
  const data = await request(`/api/referrals/summary`, { method: "GET", headers });

  return {
    isConfigured: data.isConfigured !== false,
    referrals: Array.isArray(data.referrals) ? data.referrals : [],
    totals: data.totals || {
      count: 0,
      totalRewardCredits: 0,
      totalBuyerBonusCredits: 0,
      pendingRewardCredits: 0,
      maturedRewardCredits: 0,
    },
  };
}

export async function validateReferralCode(code: string): Promise<{
  valid: boolean;
  eligible: boolean;
  reason: string | null;
  code: string | null;
  variant: string | null;
  buyerDiscountPct: number;
  refRewardPct: number;
  ownerPlanSlug: string | null;
  ownerPlanName: string | null;
}> {
  const headers = await authHeaders();
  const clean = code ? code.trim().toUpperCase() : "";

  if (!clean) {
    return {
      valid: false,
      eligible: false,
      reason: "EMPTY",
      code: null,
      variant: null,
      buyerDiscountPct: 0,
      refRewardPct: 0,
      ownerPlanSlug: null,
      ownerPlanName: null,
    };
  }

  const data = await request(`/api/referrals/validate?code=${encodeURIComponent(clean)}`, { method: "GET", headers });

  return {
    valid: data.valid === true,
    eligible: data.eligible === true,
    reason: data.reason ? String(data.reason) : null,
    code: data.code ? String(data.code) : null,
    variant: data.variant ? String(data.variant) : null,
    buyerDiscountPct: Number(data.buyerDiscountPct) || 0,
    refRewardPct: Number(data.refRewardPct) || 0,
    ownerPlanSlug: data.ownerPlanSlug ? String(data.ownerPlanSlug) : null,
    ownerPlanName: data.ownerPlanName ? String(data.ownerPlanName) : null,
  };
}