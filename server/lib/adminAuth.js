function csvToSet(raw, { lower = false } = {}) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .map((v) => (lower ? v.toLowerCase() : v))
  );
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || "").trim();
}

export function createAdminAuthHelpers({ requireUser, adminToken, ownerEmails, ownerUserIds, supabaseAdmin }) {
  const normalizedAdminToken = String(adminToken || "").trim();
  const ownerEmailSet = csvToSet(ownerEmails, { lower: true });
  const ownerUserIdSet = csvToSet(ownerUserIds, { lower: false });

  function isOwnerIdentity(user) {
    if (!user) return false;

    const email = normalizeEmail(user.email);
    const userId = normalizeId(user.id);

    if (email && ownerEmailSet.has(email)) return true;
    if (userId && ownerUserIdSet.has(userId)) return true;
    return false;
  }

  function adminConfigured() {
    return Boolean(normalizedAdminToken || ownerEmailSet.size || ownerUserIdSet.size);
  }

  async function requireAdminAccess(req) {
    if (!adminConfigured()) {
      return {
        ok: false,
        status: 503,
        mode: null,
        user: null,
        error: {
          code: "ADMIN_NOT_CONFIGURED",
          message: "Configura ADMIN_TOKEN o OWNER_ADMIN_EMAILS/OWNER_ADMIN_USER_IDS en el backend.",
        },
      };
    }

    const token = String(req.headers["x-admin-token"] || "").trim();
    if (normalizedAdminToken && token && token === normalizedAdminToken) {
      return { ok: true, status: 200, mode: "token", user: null, error: null };
    }

    const out = await requireUser(req);
    if (out.error || !out.user) {
      return {
        ok: false,
        status: 401,
        mode: null,
        user: null,
        error: out.error || { code: "UNAUTHENTICATED", message: "Login requerido." },
      };
    }

    if (!isOwnerIdentity(out.user)) {
      return {
        ok: false,
        status: 403,
        mode: null,
        user: out.user,
        error: { code: "FORBIDDEN", message: "Acceso restringido al owner." },
      };
    }

    return { ok: true, status: 200, mode: "owner", user: out.user, error: null };
  }

  async function resolveTargetUser({ userId, email }) {
    if (!supabaseAdmin) {
      return {
        user: null,
        error: {
          code: "SUPABASE_NOT_CONFIGURED",
          message: "Supabase no está configurado en el backend.",
        },
      };
    }

    const normalizedUserId = normalizeId(userId);
    if (normalizedUserId) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(normalizedUserId);
      if (error || !data?.user) {
        return {
          user: null,
          error: {
            code: "USER_NOT_FOUND",
            message: "No encontré un usuario con ese ID.",
            details: error ? String(error.message || error) : null,
          },
        };
      }
      return { user: data.user, error: null };
    }

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return {
        user: null,
        error: {
          code: "BAD_REQUEST",
          message: "Debes indicar userId o email.",
        },
      };
    }

    const perPage = 200;
    let page = 1;

    while (page <= 25) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) {
        return {
          user: null,
          error: {
            code: "USER_LOOKUP_FAILED",
            message: "No se pudo buscar el usuario por email.",
            details: String(error.message || error),
          },
        };
      }

      const users = Array.isArray(data?.users) ? data.users : [];
      const found = users.find((row) => normalizeEmail(row?.email) === normalizedEmail) || null;
      if (found) return { user: found, error: null };

      const lastPage = Number(data?.lastPage || 0);
      const nextPage = Number(data?.nextPage || 0);

      if (Number.isFinite(lastPage) && lastPage > 0 && page >= lastPage) break;
      if (Number.isFinite(nextPage) && nextPage > page) {
        page = nextPage;
        continue;
      }
      if (users.length < perPage) break;

      page += 1;
    }

    return {
      user: null,
      error: {
        code: "USER_NOT_FOUND",
        message: "No encontré un usuario con ese email.",
      },
    };
  }

  return {
    adminConfigured,
    isOwnerIdentity,
    requireAdminAccess,
    resolveTargetUser,
  };
}
