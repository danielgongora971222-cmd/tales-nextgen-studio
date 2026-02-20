import express from "express";

export function createHealthRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    const capabilities = {
      supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      storageProvider: (process.env.STORAGE_PROVIDER || "supabase").toString(),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      fal: Boolean(process.env.FAL_KEY),
      kling: Boolean(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY),
    };

    return res.json({
      ok: true,
      appEnv: (process.env.APP_ENV || "development").toString(),
      nodeEnv: (process.env.NODE_ENV || "development").toString(),
      capabilities,
      timestamp: Date.now(),
    });
  });

  return router;
}