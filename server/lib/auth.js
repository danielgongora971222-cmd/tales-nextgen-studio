export function createAuthHelpers(supabaseAdmin) {
  async function requireUser(req) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return {
        user: null,
        error: { code: "UNAUTHENTICATED", message: "Login requerido." },
      };
    }

    if (!supabaseAdmin) {
      return {
        user: null,
        error: {
          code: "SUPABASE_NOT_CONFIGURED",
          message: "Supabase no está configurado en el backend.",
        },
      };
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return {
        user: null,
        error: { code: "UNAUTHENTICATED", message: "Sesión inválida." },
      };
    }

    return { user: data.user, error: null };
  }

  return { requireUser };
}
