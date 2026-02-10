import express from "express";

export function createHealthRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      hasKey: Boolean(process.env.GEMINI_API_KEY),
      service: "tales-nextgen-studio-api",
      env: process.env.APP_ENV || process.env.NODE_ENV || "unknown",
      version: process.env.APP_VERSION || "unknown",
      time: new Date().toISOString(),
    });
  });

  return router;
}
