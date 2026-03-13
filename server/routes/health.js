import { getQueueOpsSnapshot } from "../lib/queueOps.js";
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
      queue: { ok: null, summary: null, error: null },
    };

    if (deep && supabaseAdmin) {
      const t0 = Date.now();
      const ping = await supabaseAdmin.from("jobs").select("id").limit(1);
      checks.db.latencyMs = Date.now() - t0;
      checks.db.ok = !ping.error;
      checks.db.error = ping.error ? String(ping.error.message || ping.error) : null;

      try {
        const queueSnapshot = await getQueueOpsSnapshot({ supabaseAdmin, activeWindowMs: 90_000 });
        checks.workers.active = queueSnapshot.workers || {};
        checks.workers.latest = [];
        checks.workers.ok = true;
        checks.queue.ok = true;
        checks.queue.summary = queueSnapshot.queues || null;
      } catch (queueErr) {
        const msg = String(queueErr?.message || queueErr);
        checks.workers.ok = false;
        checks.workers.error = msg;
        checks.queue.ok = false;
        checks.queue.error = msg;
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
