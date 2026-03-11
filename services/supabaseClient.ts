import { createClient, type Session } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan variables de entorno de Supabase. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local (y también en Vercel)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const rawGetSession = supabase.auth.getSession.bind(supabase.auth);
const rawRefreshSession = supabase.auth.refreshSession.bind(supabase.auth);

function shouldRefreshSession(session: Session | null | undefined) {
  const expiresAtMs = Number(session?.expires_at || 0) * 1000;
  if (!expiresAtMs) return false;
  return expiresAtMs - Date.now() < 90_000;
}

export async function getFreshSession() {
  const current = await rawGetSession();
  const session = current.data.session;

  const mustRefresh = !session || shouldRefreshSession(session);
  if (!mustRefresh) return current;

  try {
    const refreshed = await rawRefreshSession();
    if (!refreshed.error && refreshed.data.session) return refreshed;
  } catch {
    // Silencio: si no se puede refrescar, devolvemos la sesión actual y dejamos
    // que la UI/llamada falle de forma controlada.
  }

  return current;
}

// Normaliza TODAS las llamadas existentes en el proyecto que usan supabase.auth.getSession()
// para que reciban una sesión refrescada cuando el token está por expirar.
(supabase.auth as any).getSession = getFreshSession;

export async function getAccessToken(options?: { required?: boolean }) {
  const { data } = await getFreshSession();
  const token = data.session?.access_token || null;

  if (!token && options?.required) {
    throw new Error("Sesión inválida.");
  }

  return token;
}

export async function getJsonAuthHeaders(options?: { required?: boolean }) {
  const token = await getAccessToken(options);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function getAuthHeaders(options?: { required?: boolean }) {
  const token = await getAccessToken(options);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
