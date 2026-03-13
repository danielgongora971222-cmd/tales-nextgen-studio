import express from "express";

export function createModerationRouter(ctx) {
  const router = express.Router();

  const { supabaseAdmin, adminAuth } = ctx;

  async function requireAdmin(req, res) {
    const auth = await adminAuth.requireAdminAccess(req);
    if (!auth.ok) {
      res.status(auth.status || 403).json({ ok: false, error: auth.error });
      return null;
    }
    return auth;
  }

  router.get("/moderation/users/:id", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const userId = req.params.id;

    const { data, error } = await supabaseAdmin
      .from("user_moderation")
      .select("user_id, shadow_banned, reason, created_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: error.message } });
    }

    return res.json({ ok: true, moderation: data || null });
  });

  router.post("/moderation/users/:id/shadowban", async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const userId = req.params.id;
    const enabled = Boolean(req.body?.enabled);
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;

    const { error } = await supabaseAdmin
      .from("user_moderation")
      .upsert({ user_id: userId, shadow_banned: enabled, reason: reason || null }, { onConflict: "user_id" });

    if (error) {
      return res.status(500).json({ ok: false, error: { code: "DB_UPSERT_FAILED", message: error.message } });
    }

    return res.json({ ok: true });
  });

  return router;
}
