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

export type ProfileMeResponse = {
  id: string;
  email: string | null;
  displayName: string;
  avatarStoragePath: string | null;
  avatarUrl: string | null;
  autoRefillEnabled: boolean;
};

export async function profileMe(): Promise<ProfileMeResponse> {
  const headers = await authHeaders();
  const resp = await fetch(apiUrl("/api/profile/me"), { method: "GET", headers });

  const raw = await resp.text();
  const data = parseJsonOrThrow(raw);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Profile failed (${resp.status})`);
  }

  return data.profile as ProfileMeResponse;
}