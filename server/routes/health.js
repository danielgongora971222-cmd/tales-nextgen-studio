import express from "express";

export function createHealthRouter({ supabaseAdmin, requireAdminAccess, HEALTHCHECK_SECRET } = {}) {
  const router = express.Router();

  function hasDeepHealthSecret(req) {
    const expected = String(HEALTHCHECK_SECRET || "").trim();
    if (!expected) return false;

    const provided = String(req.headers["x-health-secret"] || "").trim();
    return Boolean(provided && provided === expected);
  }

  router.get("/health", async (req, res) => {
    const wantsDeep = String(req.query.deep || "").trim() === "1";
    let deep = false;

    if (wantsDeep) {
      let allowed = hasDeepHealthSecret(req);

      if (!allowed && typeof requireAdminAccess === "function") {
        const auth = await requireAdminAccess(req);
        allowed = Boolean(auth?.ok);
      }

      if (!allowed) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: "El health profundo requiere acceso admin u x-health-secret.",
          },
        });
      }

      deep = true;
    }

    const capabilities = {
      supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      storageProvider: (process.env.STORAGE_PROVIDER || "supabase").toString(),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      fal: Boolean(process.env.FAL_KEY),
      kling: Boolean(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY),
      sentry: Boolean(process.env.SENTRY_DSN),
      upstash: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    };

    const checks = {
      db: { ok: null, latencyMs: null, error: null },
      workers: { ok: null, active: {}, latest: [], error: null },
    };

    if (deep && supabaseAdmin) {
      const t0 = Date.now();
      const ping = await supabaseAdmin.from("jobs").select("id").limit(1);
      checks.db.latencyMs = Date.now() - t0;
      checks.db.ok = !ping.error;
      checks.db.error = ping.error ? String(ping.error.message || ping.error) : null;

      const hb = await supabaseAdmin
        .from("worker_heartbeats")
        .select("worker_id,kind,updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);

      if (hb.error) {
        checks.workers.ok = false;
        checks.workers.error = String(hb.error.message || hb.error);
      } else {
        const now = Date.now();
        const activeWindowMs = 90_000;
        const active = {};
        for (const row of hb.data || []) {
          const ts = Date.parse(row.updated_at);
          const isActive = Number.isFinite(ts) && now - ts <= activeWindowMs;
          if (!active[row.kind]) active[row.kind] = { active: 0, total: 0, latestAt: row.updated_at };
          active[row.kind].total += 1;
          if (isActive) active[row.kind].active += 1;
          if (Date.parse(active[row.kind].latestAt) < ts) active[row.kind].latestAt = row.updated_at;
        }
        checks.workers.active = active;
        checks.workers.latest = hb.data || [];
        checks.workers.ok = true;
      }
    }

    return res.json({
      ok: true,
      appEnv: (process.env.APP_ENV || "development").toString(),
      nodeEnv: (process.env.NODE_ENV || "development").toString(),
      capabilities,
      deep,
      checks,
      timestamp: Date.now(),
    });
  });

  return router;
}
