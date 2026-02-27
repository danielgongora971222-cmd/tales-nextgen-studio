import express from "express";

export function createModerationRouter(ctx) {
  const router = express.Router();

  const { supabaseAdmin, ADMIN_TOKEN } = ctx;

  function requireAdmin(req, res) {
    const token = String(req.headers["x-admin-token"] || "");
    if (!ADMIN_TOKEN) {
      res.status(503).json({
        ok: false,
        error: { code: "ADMIN_NOT_CONFIGURED", message: "ADMIN_TOKEN no configurado en el server." },
      });
      return false;
    }
    if (!token || token !== ADMIN_TOKEN) {
      res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Admin token inválido." } });
      return false;
    }
    return true;
  }

  // GET estado moderación
  router.get("/moderation/users/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;

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

  // POST activar/desactivar shadow ban
  router.post("/moderation/users/:id/shadowban", async (req, res) => {
    if (!requireAdmin(req, res)) return;

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