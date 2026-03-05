import express from "express";

// ===============================
// Profile
// GET /api/profile/me
// - Devuelve info del usuario (email + displayName)
// - Si hay avatar_storage_path, devuelve avatarUrl firmado
// ===============================

export function createProfileRouter(ctx) {
  const router = express.Router();
  const { requireUser, signStoragePath } = ctx;

  function safeDisplayName(user) {
    const meta = user?.user_metadata || {};
    const raw = (meta.username || meta.display_name || "").toString().trim();
    if (raw) return raw;
    const email = (user?.email || "").toString();
    return email ? email.split("@")[0] : "user";
  }

  router.get("/profile/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const meta = user.user_metadata || {};
    const avatarStoragePath = meta.avatar_storage_path ? String(meta.avatar_storage_path) : null;

    let avatarUrl = null;
    if (avatarStoragePath) {
      try {
        avatarUrl = await signStoragePath(avatarStoragePath, 60 * 60 * 6);
      } catch {
        avatarUrl = null;
      }
    }

    return res.json({
      ok: true,
      profile: {
        id: user.id,
        email: user.email || null,
        displayName: safeDisplayName(user),
        avatarStoragePath,
        avatarUrl,
        autoRefillEnabled: !!meta.autorefill_enabled,
      },
    });
  });

  return router;
}