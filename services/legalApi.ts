import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";

function parseJsonOrThrow(raw: string) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("Respuesta inválida del servidor (no es JSON).");
  }
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No auth session.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function acceptLegal(input: { termsVersion: string; privacyVersion: string; autopayVersion: string }) {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl("/api/legal/accept"), {
    method: "POST",
    headers,
    body: JSON.stringify(input),
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

  return true;
}