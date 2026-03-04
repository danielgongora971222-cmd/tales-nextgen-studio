import "dotenv/config";
import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "crypto";
import {
  createImage2VideoTask,
  createText2VideoTask,
  createMotionControlTask,
  pollTaskUntilDone,
  klingPostWithRetry,
  klingGetWithRetry,
} from "./klingVideo.js";
import os from "os";
import fs from "fs/promises";
import { join as pathJoin } from "path";
import {
  Base64ImageSchema,
  ImageRequestSchema,
  VideoRequestSchema,
  RestyleSchema,
  FaceSwapSchema,
  FaceSwapMannequinSchema,
  FaceSwapInsertSchema,
  UpscaleSchema,
  UploadAssetSchema,
  KlingElementImageSchema,
  CreateKlingElementRequestSchema,
  FalJobSchema,
} from "./schemas/index.js";
import { createAuthHelpers } from "./lib/auth.js";
import { createStorageHelpers } from "./lib/storage.js";
import { apiError, httpError } from "./lib/errors.js";
import { getClientIp } from "./lib/net.js";
import { base64urlEncode, base64urlDecodeToString } from "./lib/base64url.js";
import { createHealthRouter } from "./routes/health.js";
import { createAiVideoRouter } from "./routes/ai/video.js";
import { createAiImageRouter } from "./routes/ai/image.js";
import { createAssetsRouter } from "./routes/ai/assets.js";
import { createModerationRouter } from "./routes/moderation.js";
import { createStoreRouter } from "./routes/store.js";
import { createCommunityStoreRouter } from "./routes/communityStore.js";
import { createTradesRouter } from "./routes/trades.js";
import { createWalletRouter } from "./routes/wallet.js";
import { createBillingHelpers } from "./lib/billing.js";
import { createBillingRouter } from "./routes/billing.js";
import { createReferralsRouter } from "./routes/referrals.js";
import { FalFinalizeSchema } from "./schemas/index.js";
import { assertJobLimits } from "./lib/jobLimits.js";
import { createLegalRouter } from "./routes/legal.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("[WARN] GEMINI_API_KEY is not set. AI endpoints will fail until you set it.");
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// ===============================
// Supabase (SERVER) - Storage + Auth check
// ===============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "assets";

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const billing = createBillingHelpers(supabaseAdmin);

const { requireUser: requireUserBase } = createAuthHelpers(supabaseAdmin);

async function requireUser(req) {
  const out = await requireUserBase(req);
  if (process.env.SENTRY_DSN) {
    if (out?.user) {
      Sentry.setUser({ id: out.user.id, email: out.user.email || undefined });
    } else {
      Sentry.setUser(null);
    }
  }
  return out;
}

const {
  parseDataUrl,
  extFromMime,
  safeSlug,
  buildAssetPath,
  uploadBase64ToStorage,
  uploadBufferToStorage,
  signStoragePath,
  deleteStoragePath,
  downloadStoragePath,
  createClientUploadTarget,
  insertAssetRow,
} = createStorageHelpers({ supabase: supabaseAdmin, bucket: SUPABASE_BUCKET });


const app = express();
app.set("trust proxy", 1);


// --- Security & logs ---
app.disable("x-powered-by");

// Environment helpers (compartido por middlewares)
const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || "").toLowerCase();
const isProd = appEnv === "production";

// express-rate-limit key helper (SIEMPRE debe devolver string)
function ipKeyGenerator(ip) {
  const v = typeof ip === "string" ? ip.trim() : "";
  return v || "unknown";
}

// Request ID (correlación entre logs / Sentry / cliente)
app.use((req, res, next) => {
  const incoming = req.headers["x-request-id"];
  req.id =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim()
      : randomUUID();

  res.setHeader("x-request-id", req.id);

  if (process.env.SENTRY_DSN) {
    Sentry.setTag("request_id", req.id);
  }

  next();
});

// Logs básicos (muy útil para ver requests en Render)
app.use(
  pinoHttp({
    genReqId: (req) => req.id || randomUUID(),
    customProps: (req) => ({ requestId: req.id }),
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.apiKey",
        "req.body.key",
      ],
      remove: true,
    },
  })
);

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);


// IMPORTANT: base64 payloads are large; adjust limits carefully.
// CORS:
// - Si usas Vercel rewrites (/api -> Render), normalmente no lo necesitas abierto.
// - Aun así, dejamos una lista controlable por variable de entorno.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/g, ""))
  .filter(Boolean);

const allowedOriginSuffixes = (process.env.ALLOWED_ORIGIN_SUFFIXES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      // Si no viene "origin" (ej: server-to-server), lo permitimos
      if (!origin) return cb(null, true);

      const normalizedOrigin = origin.replace(/\/+$/g, "");

      // Si no configuras ALLOWED_ORIGINS:
      // - En dev: permitimos (para no estorbar)
      // - En production: BLOQUEAMOS origins de navegador para evitar abuso directo al Render URL
      if (allowedOrigins.length === 0) {
        // Si configuras ALLOWED_ORIGIN_SUFFIXES, permitimos esos sufijos incluso en producción.
        if (allowedOriginSuffixes.length) {
          if (allowedOriginSuffixes.some((suf) => normalizedOrigin.endsWith(suf))) return cb(null, true);
          return cb(new Error("CORS blocked"));
        }

        if (isProd) return cb(new Error("CORS blocked"));
        return cb(null, true);
      }

      // Si está en la lista, ok
      if (allowedOrigins.includes(normalizedOrigin)) return cb(null, true);

      // ✅ Soporte opcional: permitir por sufijo (útil para Vercel previews)
      // Ej: ALLOWED_ORIGIN_SUFFIXES=".vercel.app,https://tu-dominio.com"
      if (allowedOriginSuffixes.length) {
        if (allowedOriginSuffixes.some((suf) => normalizedOrigin.endsWith(suf))) return cb(null, true);
      }

      // Si no, bloquea
      return cb(new Error("CORS blocked"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Endpoint simple para healthchecks de Render/uptime (GET y HEAD)
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, service: "tales-nextgen-studio-api" });
});

// Rate limit SUAVE para health (para que no moleste al refrescar)
const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  handler: (req, res) => {
    const retryAfter = Number(res.getHeader("Retry-After")) || null;
    return res.status(429).json({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Demasiadas solicitudes. Espera un momento y vuelve a intentar.",
        details: {
          scope: "health",
          retryAfterSeconds: retryAfter,
        },
      },
    });
  },
});

// Rate limit general (protección básica) EXCLUYENDO /api/health
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 requests/min por IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  skip: (req) => req.path === "/api/health" || req.originalUrl === "/api/health",
});

// Aplica limitadores
app.use("/api/health", healthLimiter);
app.use(apiLimiter);

// Rate limit más estricto para IA (protege tu key)
// IMPORTANTE: NO debe romper el polling async de Fal (/api/ai/video/fal/*)

// 1) Limitador específico para polling Fal (más alto, porque el frontend hace polling cada ~2-3s)
const falPollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60/min por IP (ajústalo si quieres más/menos)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  handler: (req, res) => {
    const retryAfter = Number(res.getHeader("Retry-After")) || null;
    return res.status(429).json({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Demasiadas solicitudes de estado (Fal). Espera un momento y vuelve a intentar.",
        details: {
          scope: "fal_poll",
          retryAfterSeconds: retryAfter,
        },
      },
    });
  },
});


// Endpoint interno para pruebas de carga (NO se habilita si no seteas INTERNAL_LOADTEST_TOKEN)
app.use("/api/_internal/loadtest", healthLimiter);

app.post("/api/_internal/loadtest/ping", async (req, res, next) => {
  try {
    const token = String(process.env.INTERNAL_LOADTEST_TOKEN || "").trim();
    if (!token) {
      return res.status(404).json({ ok: false, error: { code: "NOT_ENABLED" } });
    }

    const provided = String(req.headers["x-internal-token"] || "").trim();
    if (!provided || provided !== token) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED" } });
    }

    const t0 = Date.now();

    if (supabaseAdmin) {
      const ping = await supabaseAdmin.from("jobs").select("id").limit(1);
      if (ping.error) {
        return res.status(503).json({
          ok: false,
          error: { code: "DB_PING_FAILED", message: String(ping.error.message || ping.error) },
        });
      }
    }

    return res.json({
      ok: true,
      requestId: req.id || null,
      latencyMs: Date.now() - t0,
      ts: Date.now(),
    });
  } catch (e) {
    return next(e);
  }
});

// Se aplica SOLO a /api/ai/video/fal/*
app.use("/api/ai/video/fal", falPollLimiter);

// 2) Limitador de IA “caro” (generaciones). Saltamos /api/ai/video/fal/* para no romper polling.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  skip: (req) => {
    const p = String(req.originalUrl || "");
    return p.startsWith("/api/ai/video/fal/");
  },
  handler: (req, res) => {
    const retryAfter = Number(res.getHeader("Retry-After")) || null;
    return res.status(429).json({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Has hecho demasiadas solicitudes a la IA. Espera y vuelve a intentar.",
        details: {
          scope: "ai",
          retryAfterSeconds: retryAfter,
        },
      },
    });
  },
});

// Aplica este limitador a /api/ai/* (excepto Fal polling, por el skip)
app.use("/api/ai", aiLimiter);

// Body limits (evita DoS y picos de memoria)
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use("/api", createHealthRouter({ supabaseAdmin }));

app.use(
  "/api",
  createStoreRouter({
    supabaseAdmin,
    requireUser,
  })
);

app.use(
  "/api",
  createCommunityStoreRouter({
    supabaseAdmin,
    requireUser,
    billing,
    signStoragePath,
  })
);

app.use(
  "/api",
  createTradesRouter({
    supabaseAdmin,
    requireUser,
    signStoragePath,
  })
);

app.use(
  "/api",
  createReferralsRouter({
    supabaseAdmin,
    requireUser,
    billing,
  })
);

app.use(
  "/api",
  createWalletRouter({
    supabaseAdmin,
    requireUser,
  })
);

app.use(
  "/api",
  createLegalRouter({
    supabaseAdmin,
    requireUser,
  })
);

app.use(
  "/api",
  createBillingRouter({
    supabaseAdmin,
    requireUser,
    billing,
  })
);

app.use(
  "/api",
  createAiVideoRouter({
    // deps/core
    supabaseAdmin,
    requireUser,
    billing,
    getClientIp,
    apiError,
    httpError,
    ensureAI,

    // kling + fal helpers (se usan dentro de routes/ai/video.js)
    createImage2VideoTask,
    createText2VideoTask,
    createMotionControlTask,
    pollTaskUntilDone,
    klingPostWithRetry,
    falQueueSubmit,
    falQueueRun,
    signJobToken,
    assetIdToSignedUrl,
    assetIdToInlinePart,
    assetIdToImageObject,

    // storage helpers
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    signStoragePath,
    deleteStoragePath,
    createClientUploadTarget,
    insertAssetRow,

    // env/flags/clients
    APP_ENV: process.env.APP_ENV,
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_BUCKET: process.env.SUPABASE_BUCKET,
  })
);

app.use(
  "/api",
  createAiImageRouter({
    // deps/core
    supabaseAdmin,
    requireUser,
    billing,
    getClientIp,
    apiError,
    httpError,
    ensureAI,

    // ai helpers (estos viven en este mismo archivo y se usan en routes/ai/image.js)
    maxCountForImageModel,
    isImageGenModel,
    extractImageDataUrl,
    parseOpenAIImageModel,
    openaiSizeFromAspectRatio,
    openaiGenerateImageDataUrl,
    falDimsFromAspectQuality,
    falQueueRun,
    bflSubmit,
    bflPoll,
    bflSampleToDataUrl,
    makeKlingJwt,
    sleep,
    assetIdToSignedUrl,
    assetIdToInlinePart,
    assetIdToImageFile,

    // storage helpers
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    signStoragePath,
    insertAssetRow,

    // env/flags
    APP_ENV: process.env.APP_ENV,
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_BUCKET: process.env.SUPABASE_BUCKET,
  })
);


app.use(
  "/api",
  createAssetsRouter({
    // deps/core
    supabaseAdmin,
    requireUser,
    getClientIp,
    apiError,
    httpError,

    // storage helpers
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    signStoragePath,
    deleteStoragePath,
    downloadStoragePath,
    createClientUploadTarget,
    insertAssetRow,

    // env/flags
    APP_ENV: process.env.APP_ENV,
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_BUCKET: process.env.SUPABASE_BUCKET,

    // ⚠️ Si tus endpoints /api/assets usan otras cosas del server.js,
    // agrégalas aquí con el MISMO nombre (sin tocar el handler).
  })
);


app.use(
  "/api",
  createModerationRouter({
    supabaseAdmin,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  })
);

function cleanBase64(dataUrl) {
  return dataUrl.replace(/^data:image\/\w+;base64,/, "");
}

async function ensureAI() {
  if (!ai) {
    const err = new Error("AI_NOT_CONFIGURED");
    err.status = 503;
    err.code = "AI_NOT_CONFIGURED";
    err.details = { hint: "Falta GEMINI_API_KEY en Render" };
    throw err;
  }
  return ai;
}

function ensureOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("OPENAI_NOT_CONFIGURED");
    err.status = 503;
    err.code = "OPENAI_NOT_CONFIGURED";
    err.details = { hint: "Falta OPENAI_API_KEY en Render" };
    throw err;
  }
  return key;
}

function openaiSizeFromAspectRatio(ar) {
  // OpenAI Images API: size puede ser "auto" o un tamaño fijo.
  if (!ar || ar === "auto") return "auto";
  if (ar === "1:1") return "1024x1024";
  if (ar === "3:2") return "1536x1024";
  if (ar === "2:3") return "1024x1536";
  return "auto";
}

function parseOpenAIImageModel(selectedModel) {
  const token = String(selectedModel || "").replace(/^openai:/, "");
  let quality = "auto";
  let model = token || "gpt-image-1.5";

  const m = model.match(/-(high|medium|low)$/);
  if (m) {
    quality = m[1];
    model = model.replace(/-(high|medium|low)$/, "");
  }
  return { model, quality };
}

async function openaiGenerateImageDataUrl({ model, prompt, size, quality = "auto", images = [] }) {
  const key = ensureOpenAIKey();
  const hasImages = Array.isArray(images) && images.length > 0;

  let r;
  let data;

  if (hasImages) {
    // Con refs: usamos /v1/images/edits (multipart/form-data)
    const fd = new FormData();
    fd.append("model", model);
    fd.append("prompt", prompt);
    fd.append("n", "1");
    if (size) fd.append("size", size);
    if (quality) fd.append("quality", quality);
    fd.append("output_format", "png");

    for (const img of images) {
      const blob = new Blob([img.buffer], { type: img.mimeType || "image/png" });
      fd.append("image[]", blob, img.filename || "ref.png");
    }

    r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });

    data = await r.json().catch(() => null);
  } else {
    // Sin refs: /v1/images/generations (JSON)
    r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: size || "auto",
        quality: quality || "auto",
        output_format: "png",
      }),
    });

    data = await r.json().catch(() => null);
  }

  if (!r.ok) {
    const msg = data?.error?.message || `OpenAI error HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = 400;
    err.code = "OPENAI_IMAGE_FAILED";
    err.details = data?.error || data;
    throw err;
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    const err = new Error("OpenAI no devolvió imagen (b64_json vacío).");
    err.status = 500;
    err.code = "OPENAI_EMPTY_IMAGE";
    throw err;
  }

  return `data:image/png;base64,${b64}`;
}

async function extractImageDataUrl(response) {
  const candidates = response?.candidates || response?.response?.candidates;
  const parts = candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data) {
      const mimeType = inline.mimeType || inline.mime_type || "image/png";
      return `data:${mimeType};base64,${inline.data}`;
    }
  }

  // fallback: si el modelo devolvió texto (ej: rechazo por safety), lo mandamos como error CLARO
  let msg = "No image generated.";
  try {
    if (typeof response?.text === "string") msg = response.text;
    // por si alguna versión lo trae como función
    if (typeof response?.text === "function") msg = String(await response.text());
  } catch (_) {}

  const err = new Error(msg);
  err.status = 400;
  err.code = "GENERATION_REJECTED";
  err.details = {
    hasCandidates: Boolean(candidates?.length),
    partsCount: parts.length,
  };
  throw err;
}

function mimeFromPath(storagePath) {
  const ext = (storagePath.split(".").pop() || "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function qualityHint(quality) {
  if (!quality) return "";
  if (quality === "1K") return "high quality, clean, sharp";
  if (quality === "2K") return "very high quality, ultra-detailed, crisp, professional lighting";
  if (quality === "4K") return "ultra high quality, 4k, hyper-detailed, cinematic lighting, razor sharp";
  return "";
}

function buildPromptText({ prompt, aspectRatio, quality, count, index }) {
  const q = qualityHint(quality);
  const ar = aspectRatio ? `\nTarget aspect ratio: ${aspectRatio}.` : "";
  const varHint =
    count > 1
      ? `\nVariation ${index + 1} of ${count}: keep identity/style/background consistent with refs, but vary pose/composition/details; do NOT duplicate previous variations.`
      : "";

  return `${q ? `QUALITY: ${q}\n` : ""}${prompt}${ar}${varHint}`.trim();
}

async function assetIdToInlineDataPart({ assetId, requesterId }) {
  // 1) Busca el asset en DB y valida acceso
  const { data: row, error: rowErr } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, is_public, storage_path, type")
    .eq("id", assetId)
    .single();

  if (rowErr || !row) {
    const e = new Error("Asset no encontrado.");
    e.status = 404;
    e.code = "ASSET_NOT_FOUND";
    throw e;
  }

  async function assetIdToGenAIImage({ assetId, requesterId }) {
    const part = await assetIdToInlineDataPart({ assetId, requesterId });
    return { imageBytes: part.inlineData.data, mimeType: part.inlineData.mimeType };
  }

  if (row.type !== "image") {
    const e = new Error("El asset referenciado no es una imagen.");
    e.status = 400;
    e.code = "ASSET_NOT_IMAGE";
    throw e;
  }

  const isOwner = row.owner_id === requesterId;
  const isPublic = Boolean(row.is_public);
  if (!isOwner && !isPublic) {
    const e = new Error("No tienes acceso a ese asset.");
    e.status = 403;
    e.code = "FORBIDDEN_ASSET";
    throw e;
  }

  // 2) Descarga desde Storage (compatible: Supabase o R2) y convierte a base64
  const dl = await downloadStoragePath(row.storage_path);
  const base64 = dl.buffer.toString("base64");
  const mimeType = dl.mimeType || mimeFromPath(String(row.storage_path).replace(/^r2:/, ""));

  return { inlineData: { mimeType, data: base64 } };
}


// ===============================
// Community Feed (public assets)
// GET /api/community?type=image&limit=50
// ===============================
app.get("/api/community", async (req, res, next) => {
  try {
    const type = String(req.query.type || "image");
    const limit = Math.min(Number(req.query.limit || 50), 100);

    // Trae SOLO públicos
    const { data, error } = await supabaseAdmin
      .from("assets")
      .select("id, url, storage_path, type, name, prompt, created_at, owner_id, is_public, meta, likes_count, comments_count")
      .eq("is_public", true)
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({
        ok: false,
        error: { code: "DB_SELECT_FAILED", message: error.message },
      });
    }

    // Firmar URLs si url está null
    const rows = data || [];
    const items = await Promise.all(
      rows.map(async (row) => {
        let url = row.url || null;
        if (!url && row.storage_path) {
          url = await signStoragePath(row.storage_path, 60 * 60);
        }

        const likesCount = Number.isFinite(Number(row.likes_count)) ? Number(row.likes_count) : 0;
        const commentsCount = Number.isFinite(Number(row.comments_count)) ? Number(row.comments_count) : 0;

        return {
          id: row.id,
          url,
          type: row.type === "video" ? "video" : "image",
          name: row.name || `Generation ${String(row.id).slice(0, 4)}`,
          prompt: row.prompt || undefined,
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          ownerId: row.owner_id,
          isPublic: !!row.is_public,

          likedByMe: false,
          likesCount,
          commentsCount,

          likes: [],
          comments: [],
        };
      })
    );

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});


function isImageGenModel(model) {
  return (
    typeof model === "string" &&
    (
      model.includes("imagen") ||
      model.endsWith("-image") ||
      model.includes("-image-") ||
      model.startsWith("fal-ai/flux-2-") ||
      model.startsWith("kling:")
    )
  );
}

function maxCountForImageModel(model) {
  // Reglas de negocio (frontend también las aplica):
  // - NanoBanana Pro, Flux 2.0 Max, GPT 1.5 / GPT 1.5-high => solo 1
  // - Flux 2.0 Pro => 1 o 2
  // - NanoBanana (flash) y Flux 2.0 Flex => hasta 4
  if (model === "gemini-3-pro-image-preview") return 1; // NanoBanana Pro
  if (model === "fal-ai/flux-2-max") return 1;
  if (model === "fal-ai/flux-2-pro") return 2;
  if (model === "fal-ai/flux-2-flex") return 4;
  if (model && model.startsWith("openai:")) return 1; // GPT Image
  if (model && model.startsWith("kling:")) return 1; // Kling Image
  if (model === "gemini-2.5-flash-image") return 4; // NanoBanana
  return 4;
}

// =============================
// Fal.ai helpers (Flux 2.0)
// =============================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeKlingJwt(accessKey, secretKey, ttlSeconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + ttlSeconds,
    nbf: now - 5,
  };

  const unsigned = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(
    JSON.stringify(payload)
  )}`;

  const sig = createHmac("sha256", secretKey).update(unsigned).digest();
  return `${unsigned}.${base64urlEncode(sig)}`;
}

function falAuthHeader() {
  const key = process.env.FAL_KEY;
  if (!key) return null;
  return `Key ${key}`;
}

// =============================
// KLING Voices Catalog (element_voice_id) - Kling-only
//
// Fuente:
// - Modo manual (default): KLING_VOICE_IDS="id1,id2,id3" (CSV o líneas)
// - Modo API: configura KLING_VOICE_CATALOG_URL (URL completa) o KLING_VOICE_CATALOG_PATH (path bajo /v1)
//
// Nota: tus docs indican que element_voice_id se obtiene via "voice-related API",
// pero no traen el endpoint exacto. Este diseño te permite enchufarlo cuando lo tengas.
// =============================

let klingVoicesCache = { ts: 0, items: null, source: null };
const KLING_VOICES_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function parseVoiceIdsEnv(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  return s
    .split(/[\n,]+/g)
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id, source: "env:KLING_VOICE_IDS" }));
}

function resolveKlingVoiceCatalogPath() {
  const urlRaw = String(process.env.KLING_VOICE_CATALOG_URL || "").trim();

  // Evita placeholders tipo "<ruta-real-de-voces>" o textos de ejemplo
  if (urlRaw && /<|>|ruta-real|example|TODO/i.test(urlRaw)) return "";

  if (urlRaw) {
    try {
      const u = new URL(urlRaw);
      let p = (u.pathname || "").trim();
      if (!p.startsWith("/")) p = "/" + p;
      if (p.startsWith("/v1/")) p = p.slice(3);
      return p.replace(/\/+$/g, "");
    } catch {
      return "";
    }
  }

  let p = String(process.env.KLING_VOICE_CATALOG_PATH || "").trim();
  if (!p) return "";
  if (!p.startsWith("/")) p = "/" + p;
  if (p.startsWith("/v1/")) p = p.slice(3);
  return p.replace(/\/+$/g, "");
}

function normalizeKlingVoiceItems(anyJson) {
  const d = anyJson?.data ?? anyJson;
  const arr =
    (Array.isArray(d?.items) && d.items) ||
    (Array.isArray(d?.voices) && d.voices) ||
    (Array.isArray(d?.data) && d.data) ||
    (Array.isArray(d) && d) ||
    [];

  return arr
    .map((v) => {
      const id = String(v?.voice_id ?? v?.id ?? v ?? "").trim();
      if (!id) return null;

      const label = String(v?.voice_name ?? v?.name ?? v?.label ?? id).trim();
      const ownedBy = v?.owned_by ? String(v.owned_by) : "kling";
      return { id, label, source: `kling:${ownedBy}` };
    })
    .filter(Boolean);
}

async function fetchKlingVoicesFromApi() {
  const path = resolveKlingVoiceCatalogPath();
  if (!path) return [];

  // usa auth de Kling ya implementada en klingGetWithRetry (server/klingVideo.js)
  const raw = await klingGetWithRetry(path, { timeoutMs: 20_000, retries: 2 });
  return normalizeKlingVoiceItems(raw);
}

async function getKlingVoicesCatalog() {
  const now = Date.now();
  if (klingVoicesCache.items && now - klingVoicesCache.ts < KLING_VOICES_CACHE_TTL_MS) {
    return klingVoicesCache.items;
  }

  const mode = String(process.env.KLING_VOICE_CATALOG_MODE || "manual").trim().toLowerCase();

  let items = [];
  let source = "manual";

  if (mode === "api") {
    items = await fetchKlingVoicesFromApi();
    source = resolveKlingVoiceCatalogPath() || "api";
  }

  if (!items.length) {
    items = parseVoiceIdsEnv(process.env.KLING_VOICE_IDS || "");
    source = items.length ? "env" : source;
  }

  klingVoicesCache = { ts: Date.now(), items, source };
  return items;
}

function falDimsFromAspectQuality(aspectRatio, quality) {
  // Map your UI quality to a base long-side pixel size
  const base =
    quality === "4K" ? 2048 :
    quality === "2K" ? 1536 :
    1024;

  if (typeof aspectRatio !== "string" || !aspectRatio.includes(":")) {
    return { width: base, height: base };
  }

  const [wStr, hStr] = aspectRatio.split(":");
  const w = Number(wStr);
  const h = Number(hStr);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: base, height: base };
  }

  const long = base;
  const shortRaw = Math.round((base * Math.min(w, h)) / Math.max(w, h));

  // Fal performs best with sizes divisible by 8
  const short = Math.max(64, Math.round(shortRaw / 8) * 8);

  if (w >= h) return { width: long, height: short };
  return { width: short, height: long };
}

// =============================
// JobToken (HMAC) - stateless
// =============================
const envNameForSecrets = String(process.env.APP_ENV || process.env.NODE_ENV || "").toLowerCase();
const isProdEnvForSecrets = envNameForSecrets === "production";

// En producción: exige un secreto dedicado (no reusar SERVICE_ROLE)
if (isProdEnvForSecrets && !process.env.JOB_TOKEN_SECRET) {
  throw new Error(
    "Missing JOB_TOKEN_SECRET in production. Set a dedicated secret (do NOT reuse SUPABASE_SERVICE_ROLE_KEY)."
  );
}

// En dev/local: permitimos fallback para no bloquearte
const JOB_TOKEN_SECRET = process.env.JOB_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

function signJobToken(payloadObj) {
  if (!JOB_TOKEN_SECRET) {
    throw httpError(
      500,
      "JOB_TOKEN_SECRET_MISSING",
      "Missing JOB_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  const payloadB64 = base64urlEncode(JSON.stringify(payloadObj));
  const sigB64 = createHmac("sha256", JOB_TOKEN_SECRET).update(payloadB64).digest("base64");
  const sig = sigB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${payloadB64}.${sig}`;
}

function verifyJobToken(token) {
  if (!JOB_TOKEN_SECRET) {
    throw httpError(
      500,
      "JOB_TOKEN_SECRET_MISSING",
      "Missing JOB_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw httpError(400, "BAD_JOB_TOKEN", "Job token inválido.");
  const [payloadB64, sig] = parts;

  const expectedSigB64 = createHmac("sha256", JOB_TOKEN_SECRET).update(payloadB64).digest("base64");
  const expectedSig = expectedSigB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (sig !== expectedSig) throw httpError(401, "BAD_JOB_TOKEN_SIG", "Job token inválido (firma).");

  const payload = JSON.parse(base64urlDecodeToString(payloadB64));

  // exp opcional
  if (payload?.exp && Date.now() > payload.exp) {
    throw httpError(401, "JOB_TOKEN_EXPIRED", "Job token expiró.");
  }
  return payload;
}

// ---- Fal helpers: evita "[object Object]" en errores ----
function falStringify(value, maxLen = 800) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, maxLen);
  try {
    const s = JSON.stringify(value);
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  } catch {
    const s = String(value);
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  }
}


async function falQueueSubmit(endpointId, input) {
  const auth = falAuthHeader();
  if (!auth) throw httpError(500, "FAL_KEY_MISSING", "Missing FAL_KEY env var (Fal.ai)");

  const submitUrl = `https://queue.fal.run/${endpointId}`;
  const submitResp = await fetch(submitUrl, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const submitText = await submitResp.text();
  let submitJson;
  try {
    submitJson = JSON.parse(submitText);
  } catch {
    throw httpError(502, "FAL_BAD_RESPONSE", `Fal submit invalid JSON: ${submitText.slice(0, 200)}`);
  }

  if (!submitResp.ok) {
    const upstream = submitJson?.detail ?? submitJson?.message ?? submitJson ?? submitText;
    const mapped = submitResp.status >= 400 && submitResp.status < 500 ? 400 : 502;

    throw httpError(
      mapped,
      "FAL_SUBMIT_FAILED",
      `Fal submit HTTP ${submitResp.status}: ${falStringify(upstream, 900)}`.slice(0, 400),
      { upstreamStatus: submitResp.status, upstream }
    );
  }

  const statusUrl = submitJson?.status_url;
  const responseUrl = submitJson?.response_url;
  const requestId = submitJson?.request_id;

  if (!statusUrl || !responseUrl || !requestId) {
    throw httpError(502, "FAL_SUBMIT_MISSING_FIELDS", "Fal submit missing status_url/response_url/request_id");
  }

  return { requestId, statusUrl, responseUrl };
}

async function falQueueStatus(statusUrl) {
  const auth = falAuthHeader();
  if (!auth) throw httpError(500, "FAL_KEY_MISSING", "Missing FAL_KEY env var (Fal.ai)");

  const statusResp = await fetch(statusUrl, { headers: { Authorization: auth } });
  const statusText = await statusResp.text();

  let statusJson;
  try {
    statusJson = JSON.parse(statusText);
  } catch {
    throw httpError(502, "FAL_BAD_STATUS", `Fal status invalid JSON: ${statusText.slice(0, 200)}`);
  }

  if (!statusResp.ok) {
    const upstream = statusJson?.detail ?? statusJson?.message ?? statusJson ?? statusText;
    const mapped = statusResp.status >= 400 && statusResp.status < 500 ? 400 : 502;

    throw httpError(
      mapped,
      "FAL_STATUS_FAILED",
      `Fal status HTTP ${statusResp.status}: ${falStringify(upstream, 900)}`.slice(0, 400),
      { upstreamStatus: statusResp.status, upstream }
    );
  }
  return statusJson;
}

async function falQueueResult(responseUrl) {
  const auth = falAuthHeader();
  if (!auth) throw httpError(500, "FAL_KEY_MISSING", "Missing FAL_KEY env var (Fal.ai)");

  const resultResp = await fetch(responseUrl, { headers: { Authorization: auth } });
  const resultText = await resultResp.text();

  let falJson;
  try {
    falJson = resultText ? JSON.parse(resultText) : null;
  } catch {
    throw httpError(502, "FAL_BAD_RESULT", `Fal result invalid JSON: ${resultText.slice(0, 200)}`);
  }

  if (!resultResp.ok) {
    const upstream = falJson?.detail ?? falJson?.message ?? falJson ?? resultText;
    const mapped = resultResp.status >= 400 && resultResp.status < 500 ? 400 : 502;

    throw httpError(
      mapped,
      "FAL_RESULT_FAILED",
      `Fal result HTTP ${resultResp.status}: ${falStringify(upstream, 900)}`.slice(0, 400),
      { upstreamStatus: resultResp.status, upstream }
    );
  }

  return falJson;
}

async function falQueueRun(endpointId, input) {
  const auth = falAuthHeader();
  if (!auth) {
    throw httpError(500, "FAL_KEY_MISSING", "Missing FAL_KEY env var (Fal.ai)");
  }

  const submitUrl = `https://queue.fal.run/${endpointId}`;
  const submitResp = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const submitText = await submitResp.text();
  let submitJson;
  try {
    submitJson = JSON.parse(submitText);
  } catch {
    throw httpError(502, "FAL_BAD_RESPONSE", `Fal submit invalid JSON: ${submitText.slice(0, 200)}`);
  }

  if (!submitResp.ok) {
    throw httpError(
      502,
      "FAL_SUBMIT_FAILED",
      `Fal submit HTTP ${submitResp.status}: ${submitJson?.detail || submitJson?.message || submitText}`.slice(0, 400)
    );
  }

  const statusUrl = submitJson?.status_url;
  const responseUrl = submitJson?.response_url; // ✅ USAR ESTA
  const requestId = submitJson?.request_id;

  if (!statusUrl || !responseUrl || !requestId) {
    throw httpError(502, "FAL_SUBMIT_MISSING_FIELDS", "Fal submit missing status_url/response_url/request_id");
  }

  // Poll until COMPLETED
  const t0 = Date.now();
  while (true) {
    const statusResp = await fetch(statusUrl, {
      headers: { Authorization: auth },
    });

    const statusText = await statusResp.text();
    let statusJson;
    try {
      statusJson = JSON.parse(statusText);
    } catch {
      throw httpError(502, "FAL_BAD_STATUS", `Fal status invalid JSON: ${statusText.slice(0, 200)}`);
    }

    if (!statusResp.ok) {
      throw httpError(
        502,
        "FAL_STATUS_FAILED",
        `Fal status HTTP ${statusResp.status}: ${statusJson?.detail || statusJson?.message || statusText}`.slice(0, 400)
      );
    }

    const st = statusJson?.status;
    if (st === "COMPLETED") break;
    if (st === "FAILED") {
      throw httpError(502, "FAL_FAILED", statusJson?.error || statusJson?.detail || "Fal request failed");
    }

    if (Date.now() - t0 > 120000) {
      throw httpError(504, "FAL_TIMEOUT", "Fal request timed out");
    }
    await sleep(800);
  }

  // ✅ Fetch final result usando response_url (NO construirla)
  const resultResp = await fetch(responseUrl, { headers: { Authorization: auth } });
  const resultText = await resultResp.text();

  if (!resultResp.ok) {
    throw httpError(502, "FAL_RESULT_FAILED", `Fal result HTTP ${resultResp.status}: ${resultText.slice(0, 200)}`);
  }

  let resultJson;
  try {
    resultJson = JSON.parse(resultText);
  } catch {
    throw httpError(502, "FAL_BAD_RESULT", `Fal result invalid JSON: ${resultText.slice(0, 200)}`);
  }

  // Fal Queue result normalmente devuelve:
  // { status: "COMPLETED", request_id, response: { ...output } }
  // Nosotros queremos devolver directamente el output para que el resto del server use:
  // falJson.video.url / falJson.images / etc.
  if (resultJson && typeof resultJson === "object" && resultJson.response) {
    return resultJson.response;
  }

  return resultJson;
}

async function falResultImageToDataUrl(img) {
  if (!img) throw httpError(502, "FAL_NO_IMAGE", "Fal result missing image");
  const contentType = img.content_type || "image/png";

  // When sync_mode=true, fal may return file_data (data URI or base64)
  if (img.file_data) {
    if (typeof img.file_data === "string" && img.file_data.startsWith("data:")) return img.file_data;
    if (typeof img.file_data === "string") return `data:${contentType};base64,${img.file_data}`;
  }

  // Otherwise, download from url
  if (!img.url) throw httpError(502, "FAL_NO_URL", "Fal image has no url");
  const r = await fetch(img.url);
  if (!r.ok) throw httpError(502, "FAL_IMAGE_DOWNLOAD_FAILED", `Failed to fetch fal image: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || contentType;
  return `data:${ct};base64,${buf.toString("base64")}`;
}

function bflApiKey() {
  return process.env.BFL_API_KEY || process.env.BFL_KEY || "";
}

async function bflSubmit(modelSlug, payload) {
  const key = bflApiKey();
  if (!key) throw httpError(500, "BFL_KEY_MISSING", "Missing BFL_API_KEY env var (Black Forest Labs)");

  const submitUrl = `https://api.bfl.ai/v1/${modelSlug}`;
  const resp = await fetch(submitUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "x-key": key,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw httpError(502, "BFL_BAD_RESPONSE", `BFL submit invalid JSON: ${text.slice(0, 200)}`);
  }

  if (!resp.ok) {
    throw httpError(502, "BFL_SUBMIT_FAILED", json?.detail || json?.message || text);
  }

  if (!json?.polling_url) {
    throw httpError(502, "BFL_SUBMIT_MISSING_FIELDS", "BFL submit missing polling_url");
  }

  return json;
}

async function bflPoll(pollingUrl, { timeoutMs = 180000 } = {}) {
  const key = bflApiKey();
  if (!key) throw httpError(500, "BFL_KEY_MISSING", "Missing BFL_API_KEY env var (Black Forest Labs)");

  const started = Date.now();
  let delay = 500;

  while (true) {
    const resp = await fetch(pollingUrl, {
      method: "GET",
      headers: { accept: "application/json", "x-key": key },
    });

    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw httpError(502, "BFL_BAD_RESPONSE", `BFL poll invalid JSON: ${text.slice(0, 200)}`);
    }

    if (!resp.ok) {
      throw httpError(502, "BFL_POLL_FAILED", json?.detail || json?.message || text);
    }

    const status = json?.status;

    if (status === "Ready" || status === "completed") return json;
    if (status === "Error" || status === "Failed") {
      throw httpError(502, "BFL_GENERATION_FAILED", "BFL generation failed", json);
    }

    if (Date.now() - started > timeoutMs) {
      throw httpError(504, "BFL_TIMEOUT", "BFL generation timed out");
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.5), 2000);
  }
}

async function bflSampleToDataUrl(sampleUrl) {
  if (!sampleUrl) throw httpError(502, "BFL_NO_SAMPLE_URL", "BFL result missing result.sample");

  const r = await fetch(sampleUrl);
  if (!r.ok) throw httpError(502, "BFL_IMAGE_DOWNLOAD_FAILED", `Failed to fetch BFL image: ${r.status}`);

  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/png";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

async function assetIdToInlinePart(assetId, userId) {
  const { data, error } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, is_public, storage_path, type")
    .eq("id", assetId)
    .maybeSingle();

  if (error) apiError(500, "DB_ERROR", error.message);
  if (!data) apiError(404, "ASSET_NOT_FOUND", `Asset ${assetId} no existe.`);
  if (data.owner_id !== userId && !data.is_public) {
    apiError(403, "ASSET_FORBIDDEN", `No tienes acceso al asset ${assetId}.`);
  }
  if (data.type !== "image") {
    apiError(400, "ASSET_NOT_IMAGE", `El asset ${assetId} no es una imagen.`);
  }

  const signedUrl = await signStoragePath(data.storage_path, 60 * 10);
  const r = await fetch(signedUrl);
  if (!r.ok) apiError(502, "ASSET_FETCH_FAILED", `No pude leer el asset ${assetId} desde storage.`);

  const mimeType = r.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await r.arrayBuffer());

  return { inlineData: { mimeType, data: buf.toString("base64") } };
}

async function assetIdToImageObject(assetId, userId) {
  const part = await assetIdToInlinePart(assetId, userId);
  return {
    imageBytes: part.inlineData.data,
    mimeType: part.inlineData.mimeType,
  };
}


async function assetIdToSignedUrl(assetId, userId, expiresInSeconds = 600) {
  const { data, error } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, is_public, storage_path, type")
    .eq("id", assetId)
    .single();

  if (error || !data) throw httpError(404, "ASSET_NOT_FOUND", "Asset not found");

  const isOwner = data.owner_id === userId;
  if (!isOwner && !data.is_public) {
    throw httpError(403, "FORBIDDEN", "You do not have access to this asset");
  }

  // signed URL so Fal.ai can fetch it
  return await signStoragePath(data.storage_path, expiresInSeconds);
}


async function assetIdToImageFile(assetId, userId) {
  const part = await assetIdToInlinePart(assetId, userId);
  const mimeType = part?.inlineData?.mimeType || "image/png";
  const buffer = Buffer.from(part.inlineData.data, "base64");

  let ext = "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
  else if (mimeType.includes("webp")) ext = "webp";
  else if (mimeType.includes("png")) ext = "png";

  return { mimeType, buffer, filename: `${assetId}.${ext}` };
}



// ===============================
// KLING - Element Library (per user)
// ===============================

async function deleteStoragePaths(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!unique.length) return;

  const settled = await Promise.allSettled(unique.map((p) => deleteStoragePath(p)));
  const failures = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "rejected") {
      failures.push({
        storagePath: unique[i],
        message: r.reason?.message || String(r.reason),
      });
    }
  }

  if (failures.length) {
    throw httpError(
      500,
      "STORAGE_DELETE_FAILED",
      "No se pudo eliminar uno o más archivos del Storage.",
      { failures }
    );
  }
}

function resolveKlingCreateElementUrl() {
    const directRaw = (process.env.KLING_ELEMENT_CREATE_URL || "").toString().trim();

    // Si te dieron una URL completa, úsala.
    if (directRaw) {
      if (/^https?:\/\//i.test(directRaw)) return directRaw.replace(/\/+$/g, "");
      if (/^api\.klingai\.com/i.test(directRaw)) return `https://${directRaw}`.replace(/\/+$/g, "");

      // Si parece PATH, SOLO lo usamos si NO existe KLING_ELEMENT_CREATE_PATH (evita pisadas accidentales)
      const explicitPath = String(process.env.KLING_ELEMENT_CREATE_PATH || "").trim();
      if (!explicitPath) {
        process.env.KLING_ELEMENT_CREATE_PATH = directRaw;
      } else {
        console.warn(
          `[WARN] KLING_ELEMENT_CREATE_URL parece un PATH pero KLING_ELEMENT_CREATE_PATH ya está seteado. Ignorando CREATE_URL="${directRaw}".`
        );
      }
    }

    let baseUrl = (process.env.KLING_BASE_URL || "https://api.klingai.com")
      .toString()
      .trim()
      .replace(/\/+$/g, "");

    // Fuerza /v1 en base
    if (!/\/v1$/i.test(baseUrl)) baseUrl += "/v1";

    let pathRaw = (process.env.KLING_ELEMENT_CREATE_PATH || "/general/advanced-custom-elements")
      .toString()
      .trim()
      .replace(/\s+/g, "");

    // Si alguien pone una URL completa aquí, la usamos.
    if (/^https?:\/\//i.test(pathRaw)) return pathRaw.replace(/\/+$/g, "");

    // Asegura slash inicial
    if (!pathRaw.startsWith("/")) pathRaw = "/" + pathRaw;

    // Evita duplicar /v1 si el path viene como "/v1/..."
    if (pathRaw.startsWith("/v1/")) pathRaw = pathRaw.slice(3);

    return `${baseUrl}${pathRaw}`.replace(/\/+$/g, "");
  }

function resolveKlingCreateElementPath() {
  const url = resolveKlingCreateElementUrl();

  // Si tenemos URL completa, extraemos el pathname
  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url);
    let p = (u.pathname || "").trim();
    if (!p.startsWith("/")) p = "/" + p;
    if (p.startsWith("/v1/")) p = p.slice(3); // "/v1" => ""
        return p.replace(/\/+$/g, "") || "/general/advanced-custom-elements";
  }

  // Si nos llega un PATH
  let p = String(url || "").trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (p.startsWith("/v1/")) p = p.slice(3);
      return p.replace(/\/+$/g, "") || "/general/advanced-custom-elements";
}

function normalizeKlingTaskStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return s;
}

function isKlingSuccessStatus(status) {
  const s = normalizeKlingTaskStatus(status);
  return (
    s === "succeed" ||
    s === "succeeded" ||
    s === "success" ||
    s === "completed" ||
    s === "done" ||
    s === "finished"
  );
}

function isKlingFailureStatus(status) {
  const s = normalizeKlingTaskStatus(status);
  return (
    s === "failed" ||
    s === "fail" ||
    s === "error" ||
    s === "canceled" ||
    s === "cancelled" ||
    s === "timeout"
  );
}

function resolveKlingElementTaskStatusPaths({ createPath, taskId }) {
  const paths = [];

  // Override opcional (PATH), soporta "{taskId}"
  const override = String(process.env.KLING_ELEMENT_TASK_STATUS_PATH || "").trim();
  if (override) {
    const tpl = override.includes("{taskId}")
      ? override
      : `${override.replace(/\/+$/g, "")}/{taskId}`;
    const out = tpl.replace("{taskId}", encodeURIComponent(String(taskId)));
    paths.push(out.startsWith("/") ? out : "/" + out);
  }

  const base = String(createPath || "/general/custom-elements")
    .split("?")[0]
    .replace(/\/+$/g, "");
  const safeTask = encodeURIComponent(String(taskId));

  // ✅ Prioriza endpoint documentado: /v1/general/advanced-custom-elements/{task_id}
  // (En algunos tenants existe también /tasks/{task_id}, pero puede NO incluir task_result.element_id)
  paths.push(`${base}/${safeTask}`);
  paths.push(`${base}/tasks/${safeTask}`);

  // Fallbacks
  paths.push(`/general/custom-elements/tasks/${safeTask}`);
  paths.push(`/general/custom-elements/${safeTask}`);
  paths.push(`/general/advanced-custom-elements/tasks/${safeTask}`);
  paths.push(`/general/advanced-custom-elements/${safeTask}`);

  return [
    ...new Set(
      paths
        .map((p) => (p.startsWith("/v1/") ? p.slice(3) : p))
        .map((p) => p.replace(/\/+$/g, ""))
    ),
  ];
}

function extractElementIdFromAny(obj) {
  if (!obj) return null;
  const d = obj?.data || obj;

  // 1) Directo
  const direct =
    d?.element_id ||
    d?.elementId ||
    d?.element?.element_id ||
    d?.element?.elementId ||
    d?.element?.id;

  if (direct) return String(direct);

  // 2) Task result (advanced)
  const tr = d?.task_result || d?.taskResult || d?.result || null;

  const fromTaskResult =
    tr?.element_id ||
    tr?.elementId ||
    tr?.id ||
    tr?.element?.element_id ||
    tr?.element?.elementId ||
    tr?.element?.id ||
    tr?.element_info?.element_id ||
    tr?.element_info?.elementId ||
    tr?.element_info?.id;

  if (fromTaskResult) return String(fromTaskResult);

  // 3) Variantes con listas dentro del task_result
  const arr =
    (Array.isArray(tr?.elements) && tr.elements) ||
    (Array.isArray(tr?.element_list) && tr.element_list) ||
    (Array.isArray(tr?.items) && tr.items) ||
    null;

  const first = arr?.[0];
  const fromArray =
    first?.element_id ||
    first?.elementId ||
    first?.id ||
    first?.element?.element_id ||
    first?.element?.elementId ||
    first?.element?.id;

  if (fromArray) return String(fromArray);

  return null;
}
function extractTaskStatusFromAny(obj) {
  const d = obj?.data || obj;
  return (
    d?.task_status ||
    d?.taskStatus ||
    d?.status ||
    d?.task?.status ||
    d?.result?.status ||
    d?.state ||
    ""
  );
}

function extractTaskStatusMsgFromAny(obj) {
  const d = obj?.data || obj;
  return (
    d?.task_status_msg ||
    d?.taskStatusMsg ||
    d?.message ||
    d?.msg ||
    d?.error?.message ||
    ""
  );
}

// ✅ Fallback: cuando Kling responde succeed pero NO incluye task_result.element_id,
// buscamos el elemento en el LIST endpoint (que según la doc incluye task_result.element_id).
async function klingFindElementIdInAdvancedList({ createPath, taskId }) {
  const base = String(createPath || "/general/advanced-custom-elements")
    .split("?")[0]
    .replace(/\/+$/g, "")
    .replace(/\/tasks$/i, "");

  if (!/advanced-custom-elements/i.test(base)) return null;

  const targetTaskId = String(taskId);

  // Doc: pageSize permite hasta 500 → usamos 500 por defecto para minimizar páginas.
  const pageSize = Math.max(1, Math.min(500, Number(process.env.KLING_ELEMENT_LIST_PAGE_SIZE || 500)));
  const maxPages = Math.max(1, Math.min(30, Number(process.env.KLING_ELEMENT_LIST_MAX_PAGES || 10)));

  function normalizeList(raw) {
    const v = raw?.data ?? raw;

    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.data)) return v.data;
    if (Array.isArray(v?.list)) return v.list;
    if (Array.isArray(v?.items)) return v.items;
    if (Array.isArray(v?.records)) return v.records;
    if (Array.isArray(v?.result)) return v.result;

    return null;
  }

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const path = `${base}?pageNum=${pageNum}&pageSize=${pageSize}`;

    try {
      const raw = await klingGetWithRetry(path, { timeoutMs: 20_000, retries: 2 });
      const list = normalizeList(raw);

      if (!Array.isArray(list)) continue;

      for (const entry of list) {
        const d = entry?.data || entry;

        // En la doc es task_id; evitamos usar d.id como fallback para no confundir con element_id
        const tid = d?.task_id || d?.taskId;
        if (!tid) continue;

        if (String(tid) === targetTaskId) {
          const elementId = extractElementIdFromAny(entry);
          if (elementId) return { elementId: String(elementId), raw: entry, pathUsed: path };
          return null;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function klingGetElementTaskStatusOnce({ createPath, taskId }) {
  const paths = resolveKlingElementTaskStatusPaths({ createPath, taskId });

  let lastErr = null;
  let firstOk = null;

  for (const p of paths) {
    try {
      const raw = await klingGetWithRetry(p, { timeoutMs: 20_000, retries: 2 });
      const status = extractTaskStatusFromAny(raw);
      const msg = extractTaskStatusMsgFromAny(raw);
      const elementId = extractElementIdFromAny(raw);

      const out = { ok: true, pathUsed: p, raw, status, msg, elementId };
      if (!firstOk) firstOk = out;

      // ✅ Bug real observado: hay endpoints que devuelven task_status=succeed
      // pero NO incluyen task_result.element_id. En ese caso seguimos probando
      // otros paths (por ejemplo el endpoint documentado /advanced-custom-elements/{id}).
      const statusNorm = normalizeKlingTaskStatus(status);
      if (isKlingSuccessStatus(statusNorm) && !elementId) {
        continue;
      }

      return out;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  if (firstOk) {
    const statusNorm = normalizeKlingTaskStatus(firstOk.status);

    // ✅ Si succeed pero sin element_id, fallback al LIST endpoint
    if (isKlingSuccessStatus(statusNorm) && !firstOk.elementId) {
      let found = await klingFindElementIdInAdvancedList({ createPath, taskId });

      // ✅ Consistencia eventual: a veces task_status ya es succeed pero task_result aparece un poco después
      if (!found?.elementId) {
        await new Promise((r) => setTimeout(r, 1500));
        found = await klingFindElementIdInAdvancedList({ createPath, taskId });
      }

      if (found?.elementId) {
        return {
          ...firstOk,
          elementId: String(found.elementId),
          raw: found.raw || firstOk.raw,
          pathUsed: `${firstOk.pathUsed} -> ${found.pathUsed}`,
        };
      }
    }

    return firstOk;
  }

  return {
    ok: false,
    error: lastErr ? String(lastErr?.message || lastErr) : "unknown",
    pathsTried: paths,
  };
}


async function klingCreateElement({ name, tag, description, referenceType, voiceId, imageUrls, videoUrl }) {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw httpError(
      500,
      "KLING_NOT_CONFIGURED",
      "Faltan KLING_ACCESS_KEY / KLING_SECRET_KEY en el backend."
    );
  }

  const t = String(tag || "").trim().toLowerCase();
  const tagId =
    t === "scene"
      ? "o_106"
      : t === "object" || t === "item"
        ? "o_104"
        : t === "character"
          ? "o_102"
          : "o_102";

  const elementDescription = (() => {
    const raw = String(description || "").trim();
    if (raw) return raw.slice(0, 100);

    const base = t ? `${t} element` : "custom element";
    const desc = `${base} created in Tales NextGen Studio.`;
    return desc.slice(0, 100);
  })();

  const ref = referenceType || (videoUrl ? "video_refer" : "image_refer");

  let createPath = resolveKlingCreateElementPath();

  // ✅ Hardening: video_refer SIEMPRE requiere advanced-custom-elements
  if (ref === "video_refer" && !/advanced-custom-elements/i.test(createPath)) {
    console.warn(
      `[WARN] video_refer requiere advanced-custom-elements. Path actual="${createPath}". Forzando "/general/advanced-custom-elements".`
    );
    createPath = "/general/advanced-custom-elements";
  }

  const isAdvanced = /advanced-custom-elements/i.test(createPath);

  let payload;

  if (isAdvanced) {
    // ✅ Kling advanced (image_refer / video_refer)
    if (ref === "video_refer") {
      if (!videoUrl) {
        throw httpError(400, "KLING_ELEMENT_NO_VIDEO", "referenceType=video_refer requiere un video_url.");
      }

      payload = {
        element_name: name,
        element_description: elementDescription,
        reference_type: "video_refer",
        element_video_list: {
          refer_videos: [{ video_url: videoUrl }],
        },
        ...(voiceId ? { element_voice_id: voiceId } : {}),
        ...(tagId ? { tag_list: [{ tag_id: tagId }] } : {}),
      };
    } else {
      const frontal = imageUrls?.[0];
      const refer = (imageUrls || []).slice(1, 4);

      // docs: frontal + 1..3 refer_images :contentReference[oaicite:7]{index=7}
      if (!frontal || refer.length < 1) {
        throw httpError(
          400,
          "KLING_ELEMENT_NEEDS_2_IMAGES",
          "Kling advanced image_refer requiere mínimo 2 imágenes (frontal + 1 referencia)."
        );
      }

      payload = {
        element_name: name,
        element_description: elementDescription,
        reference_type: "image_refer",
        element_image_list: {
          frontal_image: frontal,
          refer_images: refer.map((u) => ({ image_url: u })),
        },
        ...(voiceId ? { element_voice_id: voiceId } : {}),
        ...(tagId ? { tag_list: [{ tag_id: tagId }] } : {}),
      };
    }
  } else {
    // ✅ Legacy (solo imágenes)
    if (ref === "video_refer") {
      throw httpError(
        400,
        "KLING_ELEMENT_ADVANCED_REQUIRED",
        "Para crear Elements con video (video_refer) debes usar /v1/general/advanced-custom-elements (configura KLING_ELEMENT_CREATE_PATH=/general/advanced-custom-elements)."
      );
    }

    const frontal = imageUrls?.[0];
    if (!frontal) {
      throw httpError(400, "KLING_ELEMENT_NO_IMAGES", "No hay imágenes para crear el Element.");
    }

    const refer = (imageUrls || []).slice(1, 4);
    const referList = refer.length ? refer : [frontal];

    payload = {
      element_name: name,
      element_description: elementDescription,
      element_frontal_image: frontal,
      element_refer_list: referList.map((u) => ({ image_url: u })),
      ...(tagId ? { tag_list: [{ tag_id: tagId }] } : {}),
    };
  }
  const apiVersion = /advanced-custom-elements/i.test(createPath) ? "advanced" : "legacy";

  let json;
  try {
    json = await klingPostWithRetry(createPath, payload, { timeoutMs: 60_000, retries: 3 });
  } catch (e) {
    throw httpError(
      502,
      "KLING_CREATE_ELEMENT_FAILED",
      `Kling no aceptó el payload para crear el Element. Path usado: ${createPath}. Detalles: ${e?.message || "unknown"}`
    );
  }

  const data = json?.data || json;

  const elementId =
    data?.element_id ||
    data?.elementId ||
    data?.id ||
    data?.element?.id ||
    data?.element?.element_id;

  if (elementId) {
    return { mode: "ready", apiVersion, elementId: String(elementId), taskId: null, raw: json };
  }

  const taskId =
    data?.task_id ||
    data?.taskId ||
    data?.data?.task_id ||
    json?.task_id ||
    json?.taskId;

  if (taskId) {
    return { mode: "creating", apiVersion: `${apiVersion}-task`, elementId: null, taskId: String(taskId), raw: json };
  }

  throw httpError(
    502,
    "KLING_BAD_RESPONSE",
    "Kling no devolvió element_id ni task_id al crear el Element.",
    { response: json }
  );
}

// GET /api/kling/voices -> catálogo de voces para selector (element_voice_id)
app.get("/api/kling/voices", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  try {
    const items = await getKlingVoicesCatalog();
    return res.json({ ok: true, items });
  } catch (e) {
    // ✅ Voces son opcionales: no rompas el creador de Elements por esto
    return res.json({
      ok: true,
      items: [],
      warning: {
        code: "KLING_VOICES_FETCH_FAILED",
        message: e?.message || "No pude obtener el catálogo de voces.",
      },
    });
  }
});

// GET /api/kling/elements  -> lista elementos del usuario
app.get("/api/kling/elements", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const { data, error: dbErr } = await supabaseAdmin
    .from("kling_elements")
    .select("id, name, tag, description, reference_type, voice_id, video_asset_id, kling_element_id, status, status_detail, api_version, kling_task_id, preview_path, image_paths, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (dbErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_SELECT_FAILED", message: dbErr.message } });
  }

  const items = await Promise.all(
    (data || []).map(async (row) => {
      const previewUrl = row.preview_path
        ? await signStoragePath(row.preview_path, 60 * 60)
        : row.video_asset_id
          ? await assetIdToSignedUrl(row.video_asset_id, user.id, 60 * 60)
          : null;
      const imageUrls = Array.isArray(row.image_paths)
        ? await Promise.all(row.image_paths.map((p) => signStoragePath(p, 60 * 60)))
        : [];

      return {
        id: row.id,
        name: row.name,
        klingElementId: row.kling_element_id || null,

        tag: row.tag || null,
        description: row.description || null,
        referenceType: row.reference_type || "image_refer",
        voiceId: row.voice_id || null,
        previewType: row.video_asset_id ? "video" : "image",

        status: row.status || "ready",
        statusDetail: row.status_detail || null,
        apiVersion: row.api_version || null,
        taskId: row.kling_task_id || null,
        updatedAt: row.updated_at || null,

        createdAt: row.created_at,
        previewUrl,
        imageUrls,
      };
    })
  );

  return res.json({ ok: true, items });
});

// POST /api/kling/elements  -> crea elemento (1-4 imágenes) + crea en Kling + guarda en DB
app.post("/api/kling/elements", async (req, res, next) => {
  try {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const { name, tag, images, referenceType, description, voiceId, video } = CreateKlingElementRequestSchema.parse(req.body);

    const elementUuid = randomUUID();

    const ref = referenceType || (video?.assetId ? "video_refer" : "image_refer");

    let imagePaths = [];
    let previewPath = null;
    let videoAssetId = null;

    let created = null;

    if (ref === "video_refer") {
      // ✅ Video Character Element (advanced)
      if (!video?.assetId) {
        throw httpError(400, "KLING_ELEMENT_NO_VIDEO", "Selecciona o sube 1 video (mp4/mov) para crear el Element.");
      }

      // Kling descarga el video desde una URL firmada
      const signedVideoUrl = await assetIdToSignedUrl(video.assetId, user.id, 60 * 30);

      created = await klingCreateElement({
        name,
        tag: tag || "character",
        description,
        referenceType: "video_refer",
        voiceId,
        videoUrl: signedVideoUrl,
      });

      videoAssetId = video.assetId;
      imagePaths = [];
      previewPath = "";
    } else {
      // ✅ Multi-Image Element (image_refer)
      if (!images || images.length < 1) {
        throw httpError(400, "KLING_ELEMENT_NO_IMAGES", "Selecciona imágenes para crear el Element.");
      }

      // 1) Subir imágenes a Storage bajo /<userId>/kling-element/<uuid>-N.ext
      imagePaths = [];
      for (let i = 0; i < images.length; i++) {
        const item = images[i];

        let bytes;
        let mimeType = "image/png";

        if ("assetId" in item) {
          const file = await assetIdToImageFile(item.assetId, user.id);
          bytes = file.buffer;
          mimeType = file.mimeType || "image/png";
        } else {
          const parsed = parseDataUrl(item.dataUrl);
          mimeType = parsed.mimeType || "image/png";
          bytes = Buffer.from(parsed.base64, "base64");
        }

        const uploaded = await uploadBufferToStorage({
          userId: user.id,
          tool: "kling-element",
          buffer: bytes,
          mimeType,
          nameHint: `${name || "element"}-${elementUuid}-${i + 1}`,
        });

        imagePaths.push(uploaded.storagePath);
      }

      // 2) Firmar URLs (para que Kling pueda descargar)
      const signedImageUrls = await Promise.all(imagePaths.map((p) => signStoragePath(p, 60 * 30)));

      // 3) Crear Element en Kling
      created = await klingCreateElement({
        name,
        tag: tag || "character",
        description,
        referenceType: "image_refer",
        voiceId,
        imageUrls: signedImageUrls,
      });

      previewPath = imagePaths[0] || null;
    }

    // 4) Guardar en DB (paths, no URLs firmadas)
    const insertPayload = {
      owner_id: user.id,
      name,

      // metadata (nuevo)
      reference_type: referenceType || (videoAssetId ? "video_refer" : "image_refer"),
      description: description ? String(description).slice(0, 100) : null,
      tag: tag ? String(tag).slice(0, 50) : null,
      voice_id: voiceId ? String(voiceId).slice(0, 128) : null,
      video_asset_id: videoAssetId,

      kling_element_id: created.elementId ? String(created.elementId) : null,

      status: created.mode === "creating" ? "creating" : "ready",
      status_detail: null,
      api_version: created.apiVersion || "legacy",
      kling_task_id: created.taskId ? String(created.taskId) : null,
      kling_raw: created.raw || null,

      image_paths: imagePaths,
      preview_path: previewPath,
    };

    const { data: row, error: insErr } = await supabaseAdmin
      .from("kling_elements")
      .insert(insertPayload)
            .select("id, name, tag, description, reference_type, voice_id, video_asset_id, kling_element_id, status, status_detail, api_version, kling_task_id, preview_path, image_paths, created_at, updated_at")
      .single();

    if (insErr) {
      // Si falla DB, intentamos limpiar storage para no dejar basura
      try {
        await deleteStoragePaths(imagePaths);
      } catch {}
      return res.status(500).json({ ok: false, error: { code: "DB_INSERT_FAILED", message: insErr.message } });
    }

    const previewUrl = row.preview_path
      ? await signStoragePath(row.preview_path, 60 * 60)
      : row.video_asset_id
        ? await assetIdToSignedUrl(row.video_asset_id, user.id, 60 * 60)
        : null;

    const imageUrls = await Promise.all((row.image_paths || []).map((p) => signStoragePath(p, 60 * 60)));

    return res.status(row.status === "creating" ? 202 : 201).json({
      ok: true,
      pending: row.status === "creating",
      item: {
        id: row.id,
        name: row.name,
        klingElementId: row.kling_element_id || null,

        status: row.status || "ready",
        statusDetail: row.status_detail || null,
        apiVersion: row.api_version || null,
        taskId: row.kling_task_id || null,
        updatedAt: row.updated_at || null,

        createdAt: row.created_at,
        previewUrl,
        imageUrls,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/kling/elements/:id -> devuelve 1 Element y (si está creating) hace 1 poll a Kling para refrescar status
app.get("/api/kling/elements/:id", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const id = req.params.id;

  const { data: row, error: getErr } = await supabaseAdmin
    .from("kling_elements")
    .select("id, owner_id, name, tag, description, reference_type, voice_id, video_asset_id, kling_element_id, status, status_detail, api_version, kling_task_id, kling_raw, preview_path, image_paths, created_at, updated_at")
    .eq("id", id)
    .single();

  if (getErr || !row) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Element no encontrado." } });
  }
  if (row.owner_id !== user.id) {
    return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No tienes permiso." } });
  }

  // Si está creando, hacemos 1 poll por request
  if (row.status === "creating" && row.kling_task_id) {
    const createPath = resolveKlingCreateElementPath();

    const polled = await klingGetElementTaskStatusOnce({
      createPath,
      taskId: row.kling_task_id,
    });

    if (polled.ok) {
      const statusNorm = normalizeKlingTaskStatus(polled.status);

      // Success (si ya hay element_id)
      if (isKlingSuccessStatus(statusNorm) && polled.elementId) {
        const upd = await supabaseAdmin
          .from("kling_elements")
          .update({
            status: "ready",
            status_detail: null,
            kling_element_id: String(polled.elementId),
            kling_raw: polled.raw || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .select("id, owner_id, name, kling_element_id, status, status_detail, api_version, kling_task_id, preview_path, image_paths, created_at, updated_at")
          .single();

        if (!upd.error && upd.data) {
          row.status = upd.data.status;
          row.status_detail = upd.data.status_detail;
          row.kling_element_id = upd.data.kling_element_id;
          row.updated_at = upd.data.updated_at;
        }
      } else if (isKlingFailureStatus(statusNorm)) {
        await supabaseAdmin
          .from("kling_elements")
          .update({
            status: "failed",
            status_detail: polled.msg || `Task failed (${statusNorm})`,
            kling_raw: polled.raw || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        row.status = "failed";
        row.status_detail = polled.msg || `Task failed (${statusNorm})`;
    } else {
      // Sigue corriendo (o succeed sin element_id)
      const detail =
        polled.msg ||
        (isKlingSuccessStatus(statusNorm) && !polled.elementId
          ? "succeed (pending element_id)"
          : (statusNorm || "running"));

      await supabaseAdmin
        .from("kling_elements")
        .update({
          status_detail: detail,
          kling_raw: polled.raw || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      row.status_detail = detail;
    }
    } else {
      // Poll falló (no matamos el row), solo dejamos detalle
      await supabaseAdmin
        .from("kling_elements")
        .update({
          status_detail: `poll_error: ${polled.error || "unknown"}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      row.status_detail = `poll_error: ${polled.error || "unknown"}`;
    }
  }

    const previewUrl = row.preview_path
    ? await signStoragePath(row.preview_path, 60 * 60)
    : row.video_asset_id
      ? await assetIdToSignedUrl(row.video_asset_id, user.id, 60 * 60)
      : null;
  const imageUrls = Array.isArray(row.image_paths)
    ? await Promise.all(row.image_paths.map((p) => signStoragePath(p, 60 * 60)))
    : [];

  return res.json({
    ok: true,
    item: {
      id: row.id,
      name: row.name,
      klingElementId: row.kling_element_id || null,

      status: row.status || "ready",
      statusDetail: row.status_detail || null,
      apiVersion: row.api_version || null,
      taskId: row.kling_task_id || null,
      updatedAt: row.updated_at || null,

      createdAt: row.created_at,
      previewUrl,
      imageUrls,
    },
  });
});

// DELETE /api/kling/elements/:id -> borra fila (solo owner) + borra archivos (recomendado)
app.delete("/api/kling/elements/:id", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const id = req.params.id;

  // 1) Buscar fila (para conocer paths) y validar ownership
  const { data: row, error: getErr } = await supabaseAdmin
    .from("kling_elements")
    .select("id, owner_id, preview_path, image_paths")
    .eq("id", id)
    .single();

  if (getErr || !row) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Element no encontrado." } });
  }
  if (row.owner_id !== user.id) {
    return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No tienes permiso." } });
  }

  // 2) Borrar fila en DB
  const { error: delErr } = await supabaseAdmin
    .from("kling_elements")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (delErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_DELETE_FAILED", message: delErr.message } });
  }

  // 3) Borrar archivos en Storage (opcional pero recomendado)
  const pathsToDelete = [
    row.preview_path,
    ...(Array.isArray(row.image_paths) ? row.image_paths : []),
  ];
  try {
    await deleteStoragePaths(pathsToDelete);
  } catch (e) {
    return res.json({
      ok: true,
      id,
      storageDeleted: false,
      warning: "Fila borrada, pero falló el borrado de archivos en Storage.",
    });
  }

  return res.json({ ok: true, id, storageDeleted: true });
});


// ===============================
// FACE SWAP (2 pasos)
//  - Paso 1: convertir a maniquí
//  - Paso 2: insertar identidad desde Element/Person SIN contaminar estilo
// Modelo fijo: NanoBanana Pro (gemini-3-pro-image-preview)
// ===============================

const FACESWAP_MODEL = "gemini-3-pro-image-preview";

function faceswapQualityHint(q) {
  if (q === "1K") return "high quality, clean, sharp";
  if (q === "2K") return "very high quality, ultra-detailed, crisp";
  if (q === "4K") return "ultra high quality, 4k, hyper-detailed, razor sharp";
  return "";
}

function mannequinSwapPrompt(swapType) {
  switch (swapType) {
    case "face":
      return `
MODE: FACE ONLY (KEEP HAIR/NECK/BODY/SCENE).
- Convert ONLY the face region into a basic matte-white mannequin surface.
- KEEP hair, neck, body, clothing, accessories, background EXACTLY unchanged.
- Preserve the original expression/pose and camera.
- CRITICAL: If there are wounds, dirt, stains, makeup smears, blood marks on the original face, preserve them EXACTLY (same position/shape/scale). Do NOT smear into a single red blob.
`.trim();

    case "face_hair":
      return `
MODE: FACE + HAIR (MANNEQUIN HEAD, NO HAIR).
- Convert the face into a matte-white mannequin AND remove all hair (render a mannequin scalp).
- KEEP neck, body, clothing, accessories, background EXACTLY unchanged.
- Preserve expression/pose and camera.
- CRITICAL: Preserve wounds/dirt/stains EXACTLY (same position/shape/scale). Do NOT turn them into one big stain.
`.trim();

    case "body":
      return `
MODE: FULL SUBJECT INCLUDING FACE + HAIR (KEEP CLOTHING/ACCESSORIES).
- Convert the entire visible human anatomy (face + hair + neck + limbs/skin) into a matte-white mannequin.
- KEEP clothing and accessories EXACTLY unchanged: same garments, textures, logos, folds, placement.
- Keep background/lighting/camera identical.
- CRITICAL: Preserve any visible wounds/dirt/stains on the person EXACTLY (position/shape/scale).
`.trim();

case "clothes_only":
  return `
MODE: CLOTHES ONLY (KEEP PERSON IDENTITY/PHYSIQUE).
- KEEP the person's face, hair, skin, body shape, hands, and pose EXACTLY unchanged.
- Convert ONLY the clothing/garments into a matte-white neutral placeholder (like a mannequin cloth surface).
- Keep accessories that are not clothing (jewelry, glasses) unless they are part of the garment.
- Keep background/lighting/camera identical.
- CRITICAL: Do NOT remove/change any skin. Preserve modesty and coverage.
`.trim();

    case "body_clothes":
    default:
      return `
MODE: FULL SUBJECT INCLUDING FACE + HAIR, REMOVE CLOTHING (MANNEQUIN BODY).
- Convert the entire visible human anatomy (face + hair + neck + body) into a matte-white mannequin.
- Remove clothing from the subject (mannequin should not wear the clothes), but keep the rest of the scene identical.
- Keep background/lighting/camera identical.
- Preserve any visible wounds/dirt/stains EXACTLY (position/shape/scale) as surface marks on the mannequin.
`.trim();
  }
}

function insertSwapPrompt(swapType) {
  switch (swapType) {
    case "face":
      return `
MODE: FACE ONLY (KEEP HAIR FROM IMAGE 1).
- Replace ONLY the mannequin facial structure in IMAGE 1 with the donor person's face identity.
- KEEP hair from IMAGE 1 EXACTLY: same silhouette, strands, volume, hairline and integration.
- Preserve the mannequin base essence: if IMAGE 1 has stains/dirt/wounds on the face area, keep them as an overlay in the exact same places.
- Match face size to the mannequin skull EXACTLY (NO big head / NO shrink head).
- FINAL CHECK: There must be ZERO visible mannequin surface on the face. Replace any remaining mannequin material with natural skin.
`.trim();

    case "face_hair":
      return `
MODE: FACE + HAIR (FULL HEAD).
- Replace the entire mannequin head region in IMAGE 1 with the donor person's full head (including hair).
- Preserve base essence: keep stains/dirt/wounds from IMAGE 1 in the same places (overlay them naturally).
- Match head size, neck thickness, and alignment to IMAGE 1 EXACTLY (no disproportion).
- FINAL CHECK: There must be ZERO visible mannequin surface on head/neck. Replace any remaining mannequin material with natural skin.
`.trim();

    case "body":
      return `
MODE: FULL SUBJECT (INCLUDING FACE + HAIR), KEEP CLOTHING & ACCESSORIES FROM IMAGE 1.
- Replace mannequin anatomy (head/face/hair/neck/arms/hands/legs as visible) with the donor person's anatomy.
- CRITICAL: Keep clothing and accessories from IMAGE 1 EXACTLY as they are (same garments, logos, folds, placement).
- Preserve base essence: keep stains/dirt/wounds from IMAGE 1 in the same places over the inserted anatomy.
- Match proportions/pose exactly (no resizing body parts).
- FINAL CHECK: There must be ZERO visible mannequin surface anywhere. Replace any remaining mannequin material with natural skin.
`.trim();

    case "body_clothes":
    default:
      return `
MODE: FULL SUBJECT (INCLUDING FACE + HAIR) WITH CLOTHING REMOVED IN BASE.
- Replace mannequin body with the donor person, preserving pose/scale exactly.
- IMPORTANT SAFETY: Do NOT produce explicit nudity. If needed, render a neutral seamless base-layer (plain bodysuit) to preserve modesty.
- Preserve base essence: keep stains/dirt/wounds from IMAGE 1 in the same places over the inserted anatomy.
- Match proportions exactly (no disproportion).
- FINAL CHECK: There must be ZERO visible mannequin surface anywhere. Replace any remaining mannequin material with natural skin.
`.trim();

    case "clothes_only":
      return `
MODE: CLOTHES ONLY (KEEP PERSON FROM IMAGE 1).
- Replace ONLY the clothing/garment placeholder region in IMAGE 1 with the donor outfit/clothing identity from IMAGE 2.
- KEEP the person's face, hair, skin, body shape, hands, and pose from IMAGE 1 EXACTLY unchanged.
- Match garment scale, folds and drape to the pose in IMAGE 1 (no floating clothes).
- IMPORTANT SAFETY: Do NOT produce explicit nudity. Keep modesty. If needed, keep a neutral base-layer under the outfit.
- FINAL CHECK: There must be ZERO visible mannequin/placeholder material anywhere. If any remains, replace it with realistic fabric or skin.
`.trim();
  }
}

function tryGetImageDimsFromBuffer(buf, mimeType) {
  try {
    const mt = String(mimeType || "").toLowerCase();

    if (mt.includes("png") && buf.length >= 24) {
      const isPng =
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
      if (isPng) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          return { width, height };
        }
      }
    }

    if ((mt.includes("jpeg") || mt.includes("jpg")) && buf.length >= 4) {
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;

      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }

        const marker = buf[i + 1];

        if (marker === 0xd9 || marker === 0xd8) {
          i += 2;
          continue;
        }

        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }

        const length = buf.readUInt16BE(i + 2);
        if (!length || length < 2) break;

        const isSOF =
          marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
          marker === 0xc5 || marker === 0xc6 || marker === 0xc7 ||
          marker === 0xc9 || marker === 0xca || marker === 0xcb ||
          marker === 0xcd || marker === 0xce || marker === 0xcf;

        if (isSOF) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            return { width, height };
          }
          return null;
        }

        i += 2 + length;
      }
    }
  } catch {
    return null;
  }

  return null;
}


async function klingElementIdToInlineParts({ donorElementId, requesterId, max = 4 }) {
  const { data: row, error: dbErr } = await supabaseAdmin
    .from("kling_elements")
    .select("id, owner_id, image_paths")
    .eq("id", donorElementId)
    .single();

  if (dbErr || !row) {
    throw httpError(404, "ELEMENT_NOT_FOUND", "Element/person no encontrado.");
  }
  if (row.owner_id !== requesterId) {
    throw httpError(403, "ELEMENT_FORBIDDEN", "No tienes acceso a ese Element/person.");
  }

  const paths = Array.isArray(row.image_paths) ? row.image_paths.slice(0, max) : [];
  if (!paths.length) {
    throw httpError(400, "ELEMENT_NO_IMAGES", "El Element/person no tiene imágenes.");
  }

  const signedUrls = await Promise.all(paths.map((p) => signStoragePath(p, 60 * 10)));

  const parts = [];
  for (let i = 0; i < signedUrls.length; i++) {
    const u = signedUrls[i];
    const r = await fetch(u);
    if (!r.ok) {
      throw httpError(502, "ELEMENT_IMAGE_FETCH_FAILED", `No pude descargar una imagen del Element/person (HTTP ${r.status}).`);
    }
    const mimeType = r.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await r.arrayBuffer());
    parts.push({ inlineData: { mimeType, data: buf.toString("base64") } });
  }

  return parts;
}

// -------------------------------
// PASO 1: convertir imagen a MANIQUÍ
// -------------------------------
app.post("/api/ai/faceswap/mannequin", async (req, res, next) => {
  try {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // ✅ Requiere plan activo
    const active = await billing.requireActiveSubscription(user.id);
    if (active.error) return res.status(403).json({ ok: false, error: active.error });

    const body = FaceSwapMannequinSchema.parse(req.body);
    const { targetAssetId, swapType, quality } = body;

    const wantsSync = Boolean(body.sync) || body.async === false;
    const wantsAsync = !wantsSync;

    if (wantsAsync) {
      await assertJobLimits({ supabaseAdmin, httpError, ownerId: user.id, kind: "image" });

      const { data: jobRow, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .insert({
          owner_id: user.id,
          kind: "image",
          status: "running",
          next_check_at: new Date().toISOString(),
          params: {
            task: "faceswap_mannequin",
            targetAssetId,
            swapType,
            quality,
          },
        })
        .select("id")
        .single();

      if (jobErr) {
        throw httpError(500, "JOB_INSERT_FAILED", "No se pudo crear el job de faceswap.", { jobErr });
      }

      const costCredits = 1; // faceswap: 1 imagen (ajustable si quieres por quality)
      const spend = await billing.spendCredits({
        userId: user.id,
        amountCredits: costCredits,
        entryType: "ai_faceswap_mannequin",
        refType: "job",
        refId: jobRow.id,
        idempotencyKey: billing.getIdempotencyKey(req),
      });

      if (!spend.ok) {
        await supabaseAdmin.from("jobs").delete().eq("id", jobRow.id);
        return res.status(402).json({ ok: false, error: spend.error });
      }

      return res.json({ ok: true, jobId: jobRow.id });
    }
    const costCredits = 1; // faceswap: 1 imagen (ajustable)
    const spend = await billing.spendCredits({
      userId: user.id,
      amountCredits: costCredits,
      entryType: "ai_faceswap_mannequin",
      refType: "sync",
      refId: null,
      idempotencyKey: billing.getIdempotencyKey(req),
    });

    if (!spend.ok) {
      return res.status(402).json({ ok: false, error: spend.error });
    }

    const aiClient = await ensureAI();

    const qHint = faceswapQualityHint(quality);
    const systemText = `
You are a senior, high-end PHOTO-REALISTIC VFX compositor.

GOAL:
- IMAGE 1 is the ORIGINAL photo. You must edit it as instructed.
- Keep camera, framing, lighting, background, props, mood and composition pixel-consistent.
- Output a SINGLE image (never a collage/grid). No text/logos/watermarks/UI.

HARD RULES:
- Do NOT change scene lighting or color grading.
- Do NOT change hair/clothes/background unless the mode explicitly says so.
- Preserve micro-details (dirt, wounds, stains, makeup, scratches) with exact placement.
${qHint ? `QUALITY: ${qHint}` : ""}
`.trim();

    const swapSpecific = mannequinSwapPrompt(swapType);

    const imgPart = await assetIdToInlinePart(targetAssetId, user.id);

    const config = {
      responseModalities: ["Image"],
      imageConfig: { imageSize: quality },
      temperature: 0.1,
      topP: 0.5,
      topK: 16,
    };

    const response = await aiClient.models.generateContent({
      model: FACESWAP_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: systemText },
            { text: "IMAGE 1 — ORIGINAL (edit this image):" },
            imgPart,
            { text: swapSpecific },
          ],
        },
      ],
      config,
    });

    const dataUrl = await extractImageDataUrl(response);

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: "faceswap",
      dataUrl,
      nameHint: `faceswap-mannequin-${swapType}-${quality}`,
    });

    const meta = {
      tool: "faceswap",
      step: 1,
      mode: "mannequin",
      provider: "google",
      model: FACESWAP_MODEL,
      swapType,
      quality,
      sourceAssetId: targetAssetId,
    };

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "faceswap",
      name: `faceswap-step1-${swapType}`,
      prompt: `faceswap step1 mannequin (${swapType})`,
      storagePath,
      isPublic: false,
      meta,
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({ ok: true, url, assetId, urlExpiresInSeconds });
  } catch (err) {
    next(err);
  }
});

// -------------------------------
// PASO 2: insertar identidad desde Element/Person EN el MANIQUÍ
// -------------------------------
app.post("/api/ai/faceswap/insert", async (req, res, next) => {
  try {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // ✅ Requiere plan activo
    const active = await billing.requireActiveSubscription(user.id);
    if (active.error) return res.status(403).json({ ok: false, error: active.error });

  const body = FaceSwapInsertSchema.parse(req.body);
  const { baseAssetId, donorElementId } = body;
  let { swapType, quality } = body;

  const wantsSync = Boolean(body.sync) || body.async === false;
  const wantsAsync = !wantsSync;

  if (wantsAsync) {
    await assertJobLimits({ supabaseAdmin, httpError, ownerId: user.id, kind: "image" });

    const { data: jobRow, error: jobErr } = await supabaseAdmin
      .from("jobs")
      .insert({
        owner_id: user.id,
        kind: "image",
        status: "running",
        next_check_at: new Date().toISOString(),
        params: {
          task: "faceswap_insert",
          baseAssetId,
          donorElementId,
          swapType,
          quality,
        },
      })
      .select("id")
      .single();

    if (jobErr) {
      throw httpError(500, "JOB_INSERT_FAILED", "No se pudo crear el job de faceswap insert.", { jobErr });
    }

    const costCredits = 1;
    const spend = await billing.spendCredits({
      userId: user.id,
      amountCredits: costCredits,
      entryType: "ai_faceswap_insert",
      refType: "job",
      refId: jobRow.id,
      idempotencyKey: billing.getIdempotencyKey(req),
    });

    if (!spend.ok) {
      await supabaseAdmin.from("jobs").delete().eq("id", jobRow.id);
      return res.status(402).json({ ok: false, error: spend.error });
    }

    return res.json({ ok: true, jobId: jobRow.id });
  }

    const costCredits = 1;
  const spend = await billing.spendCredits({
    userId: user.id,
    amountCredits: costCredits,
    entryType: "ai_faceswap_insert",
    refType: "sync",
    refId: null,
    idempotencyKey: billing.getIdempotencyKey(req),
  });

  if (!spend.ok) {
    return res.status(402).json({ ok: false, error: spend.error });
  }

  // -----------------------------
  // 🔒 BLOQUEO (Paso 2 hereda SIEMPRE swapType + quality del Paso 1)
  // -----------------------------
  const { data: baseRow, error: baseErr } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, is_public, type, meta")
    .eq("id", baseAssetId)
    .maybeSingle();

  if (baseErr) throw httpError(500, "DB_ERROR", baseErr.message);
  if (!baseRow) throw httpError(404, "ASSET_NOT_FOUND", "Base asset no encontrado.");
  if (baseRow.type !== "image") throw httpError(400, "ASSET_NOT_IMAGE", "El baseAssetId no es una imagen.");
  if (baseRow.owner_id !== user.id && !baseRow.is_public) {
    throw httpError(403, "ASSET_FORBIDDEN", "No tienes acceso al baseAssetId.");
  }

  const baseMeta = baseRow.meta || {};
  const lockedSwapType = baseMeta?.swapType || swapType;
  const lockedQuality = baseMeta?.quality || quality;
  swapType = lockedSwapType;
  quality = lockedQuality;

  // -----------------------------
  // ✅ Donor debe venir de Element Library (General Image Generator)
  // -----------------------------
  const { data: donorRow, error: donorErr } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, is_public, type, meta")
    .eq("id", donorElementId)
    .maybeSingle();

  if (donorErr) throw httpError(500, "DB_ERROR", donorErr.message);
  if (!donorRow) throw httpError(404, "ASSET_NOT_FOUND", "Donor element no encontrado.");
  if (donorRow.type !== "image") throw httpError(400, "ASSET_NOT_IMAGE", "El donorElementId no es una imagen.");
  if (donorRow.owner_id !== user.id && !donorRow.is_public) {
    throw httpError(403, "ASSET_FORBIDDEN", "No tienes acceso al donorElementId.");
  }

  const donorMeta = donorRow.meta || {};
  const isElementLibrary = donorMeta?.tool === "element-library" || donorMeta?.isElement === true;
  if (!isElementLibrary) {
    throw httpError(
      400,
      "DONOR_NOT_ELEMENT_LIBRARY",
      "El donante debe ser un Element creado en General Image Generator (tool: element-library)."
    );
  }

  const aiClient = await ensureAI();

  const qHint = faceswapQualityHint(quality);
  const basePart = await assetIdToInlinePart(baseAssetId, user.id);
  const donorPart = await assetIdToInlinePart(donorElementId, user.id);

  const baseBuf = Buffer.from(basePart.inlineData.data, "base64");
  const dims = tryGetImageDimsFromBuffer(baseBuf, basePart.inlineData.mimeType);
  const sizeRule = dims
    ? `OUTPUT SIZE: EXACTLY ${dims.width}x${dims.height} pixels (same as IMAGE 1). Do NOT crop or resize.`
    : "OUTPUT SIZE: Keep EXACT pixel dimensions and aspect ratio of IMAGE 1. Do NOT crop or resize.";

  const systemText = `
  You are a senior, high-end PHOTO-REALISTIC VFX compositor.

  GOAL:
  - IMAGE 1 is the BASE from Step 1 and defines the final canvas, lighting, camera, environment and composition.
  - IMAGE 2 is the DONOR Element reference. Use it ONLY for identity/appearance/clothing.
  - Replace ONLY the placeholder/mannequin region indicated by the mode with donor identity/clothing.
  - Everything else must remain pixel-consistent with IMAGE 1.

  GLOBAL HARD RULES:
  - Keep EXACT framing, crop, perspective, lens look and composition from IMAGE 1.
  - ${sizeRule}
  - Do NOT import donor lighting, background, composition, or camera.
  - Output a SINGLE image (never a collage/grid). No text/logos/watermarks/UI.
  - Preserve the "essence" of IMAGE 1: dirt/wounds/stains/marks should remain in the same locations after insertion (overlay naturally).
  - Avoid proportion errors: match head size/neck thickness/body scale to IMAGE 1 EXACTLY (no big head, no tiny head).
  - ABSOLUTE: There must be ZERO visible mannequin/plastic/ceramic surface anywhere in the final image.
  - If any mannequin material remains, you MUST replace it with realistic human skin (or realistic fabric for clothes).
  ${qHint ? `QUALITY: ${qHint}` : ""}
  `.trim();

  const swapSpecific = insertSwapPrompt(swapType);

    const parts = [
    { text: systemText },
    { text: "IMAGE 1 — BASE (Paso 1, define el canvas final):" },
    basePart,
    { text: "IMAGE 2 — DONOR Element (Element Library, identidad/ropa solamente):" },
    donorPart,
    { text: swapSpecific },
  ];

  const config = {
    responseModalities: ["Image"],
    imageConfig: { imageSize: quality },
    temperature: 0.1,
    topP: 0.5,
    topK: 16,
  };

    const response = await aiClient.models.generateContent({
      model: FACESWAP_MODEL,
      contents: [{ role: "user", parts }],
      config,
    });

    const dataUrl = await extractImageDataUrl(response);

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: "faceswap",
      dataUrl,
      nameHint: `faceswap-insert-${swapType}-${quality}`,
    });

    const meta = {
      tool: "faceswap",
      step: 2,
      mode: "insert",
      provider: "google",
      model: FACESWAP_MODEL,
      swapType,
      quality,
      baseAssetId,
      donorElementId,
    };

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "faceswap",
      name: `faceswap-step2-${swapType}`,
      prompt: `faceswap step2 insert (${swapType})`,
      storagePath,
      isPublic: false,
      meta,
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({ ok: true, url, assetId, urlExpiresInSeconds });
  } catch (err) {
    next(err);
  }
});

// -------------------------------
// (Opcional) Compat: endpoint viejo /api/ai/faceswap (NO lo usamos en el nuevo tool)
// -------------------------------
app.post("/api/ai/faceswap", async (req, res, next) => {
  try {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const body = FaceSwapSchema.parse(req.body);
    const { sourceDataUrl, targetDataUrl } = body;

    const aiClient = await ensureAI();

    const response = await aiClient.models.generateContent({
      model: FACESWAP_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: "Replace the face from the source image into the target image. Keep target style/lighting." },
            { inlineData: { data: sourceDataUrl.split(",")[1], mimeType: "image/png" } },
            { inlineData: { data: targetDataUrl.split(",")[1], mimeType: "image/png" } },
          ],
        },
      ],
      config: { responseModalities: ["Image"], imageConfig: { imageSize: "2K" } },
    });

    const dataUrl = await extractImageDataUrl(response);

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: "faceswap",
      dataUrl,
      nameHint: "faceswap-legacy",
    });

    const meta = { tool: "faceswap", step: 0, mode: "legacy", provider: "google", model: FACESWAP_MODEL };

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "faceswap",
      name: "faceswap-legacy",
      prompt: "faceswap legacy",
      storagePath,
      isPublic: false,
      meta,
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({ ok: true, url, assetId, urlExpiresInSeconds });
  } catch (err) {
    next(err);
  }
});

app.post("/api/ai/upscale", async (req, res, next) => {
  try {
    const body = UpscaleSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // ✅ Requiere plan activo
    const active = await billing.requireActiveSubscription(user.id);
    if (active.error) return res.status(403).json({ ok: false, error: active.error });

    const selectedModel = body.model || "imagen-3.0-generate-002";
    const scale = body.scale || 2;

    const wantsSync = Boolean(body.sync) || body.async === false;
    const wantsAsync = !wantsSync;

    // ✅ ASYNC: devolver jobId rápido (sin riesgo de timeout)
    if (wantsAsync) {
      if (!body.imageAssetId) {
        throw httpError(
          400,
          "IMAGE_ASSET_REQUIRED",
          "Para upscale async, envía imageAssetId (no imageDataUrl)."
        );
      }

      await assertJobLimits({ supabaseAdmin, httpError, ownerId: user.id, kind: "image" });

      const { data: jobRow, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .insert({
          owner_id: user.id,
          kind: "image",
          status: "running",
          next_check_at: new Date().toISOString(),
          params: {
            task: "upscale",
            imageAssetId: body.imageAssetId,
            scale,
            model: selectedModel,
          },
        })
        .select("id")
        .single();

      if (jobErr) {
        throw httpError(500, "JOB_INSERT_FAILED", "No se pudo crear el job de upscale.", { jobErr });
      }

      const costCredits = 1; // upscale: 1 imagen (ajustable por scale si quieres)
      const spend = await billing.spendCredits({
        userId: user.id,
        amountCredits: costCredits,
        entryType: "ai_upscale",
        refType: "job",
        refId: jobRow.id,
        idempotencyKey: billing.getIdempotencyKey(req),
      });

      if (!spend.ok) {
        await supabaseAdmin.from("jobs").delete().eq("id", jobRow.id);
        return res.status(402).json({ ok: false, error: spend.error });
      }

      return res.json({ ok: true, jobId: jobRow.id });
    }

    // ✅ SYNC (legacy): ejecuta en request (puede tardar)
    const costCredits = 1;
    const spend = await billing.spendCredits({
      userId: user.id,
      amountCredits: costCredits,
      entryType: "ai_upscale",
      refType: "sync",
      refId: null,
      idempotencyKey: billing.getIdempotencyKey(req),
    });

    if (!spend.ok) {
      return res.status(402).json({ ok: false, error: spend.error });
    }

    const aiClient = await ensureAI();

    const inlinePart = body.imageAssetId
      ? await assetIdToInlinePart(body.imageAssetId, user.id, 10 * 60)
      : (() => {
          if (!body.imageDataUrl) {
            throw httpError(400, "IMAGE_REQUIRED", "Missing imageDataUrl or imageAssetId.");
          }
          const { mimeType, base64 } = parseDataUrl(body.imageDataUrl);
          return { inlineData: { mimeType, data: base64 } };
        })();

    const prompt = `Upscale this image by ${scale}x. Preserve detail, avoid artifacts, keep it photorealistic.`;

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, inlinePart],
        },
      ],
    });

    const dataUrl = await extractImageDataUrl(response);

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: "upscaler",
      dataUrl,
      nameHint: `upscale_${scale}x`,
    });

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "upscaler",
      name: `upscale_${scale}x`,
      prompt,
      storagePath,
      isPublic: false,
      meta: { toolVersion: 2, scale },
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({ ok: true, url, assetId, urlExpiresInSeconds });
  } catch (err) {
    next(err);
  }
});


app.post("/api/ai/video/fal/status", async (req, res, next) => {
  try {
    const { jobToken } = FalJobSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const t = verifyJobToken(jobToken);
    if (t.uid !== user.id) throw httpError(403, "JOB_NOT_YOURS", "Este job no pertenece a tu usuario.");

    const st = await falQueueStatus(t.statusUrl);
    const status = st?.status || "UNKNOWN";

    if (status === "FAILED") {
      return res.json({ ok: true, status, error: st?.error || st?.detail || "Fal job failed" });
    }

    return res.json({ ok: true, status });
  } catch (e) {
    return next(e);
  }
});

app.post("/api/ai/video/fal/finalize", async (req, res, next) => {
  try {
    const { jobToken, prompt } = FalFinalizeSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const t = verifyJobToken(jobToken);
    if (t.uid !== user.id) throw httpError(403, "JOB_NOT_YOURS", "Este job no pertenece a tu usuario.");

    // Idempotencia: si el Background Worker ya finalizó este requestId, devolvemos el asset existente.
    let jobRow = null;
    if (t.requestId) {
      const jr = await supabaseAdmin
        .from("jobs")
        .select("id,status,result_asset_id")
        .eq("owner_id", user.id)
        .eq("kind", "video")
        .filter("params->>requestId", "eq", String(t.requestId))
        .maybeSingle();

      if (!jr.error) jobRow = jr.data;
    }

    if (jobRow?.status === "succeeded" && jobRow.result_asset_id) {
      const urlExpiresInSeconds = 60 * 60;
      const url = await assetIdToSignedUrl(jobRow.result_asset_id, user.id, urlExpiresInSeconds);
      return res.json({
        ok: true,
        items: [{ url, assetId: jobRow.result_asset_id }],
        url,
        assetId: jobRow.result_asset_id,
        urlExpiresInSeconds,
      });
    }

    const st = await falQueueStatus(t.statusUrl);
    const status = st?.status || "UNKNOWN";

    if (status !== "COMPLETED") {
      return res.status(202).json({ ok: true, status });
    }

    const falJson = await falQueueResult(t.responseUrl);

    const videoUrl =
      falJson?.video?.url ||
      falJson?.data?.video?.url ||
      falJson?.videos?.[0]?.url ||
      falJson?.output?.video?.url;

    if (!videoUrl) {
      throw httpError(502, "FAL_KLING_V3_NO_VIDEO", "Fal/Kling V3 no devolvió video.", {
        response: falJson,
      });
    }

    // Descarga y guarda en Storage como asset (igual que tu path sync)
    const toolName = t.toolName || "VideoGeneratorTool";
    const hint = t.hint || "kling-v3";
    const selectedModelNorm = t.model || "kling-v3";
    const endpointId = t.endpointId;

    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw httpError(
        502,
        "FAL_KLING_V3_VIDEO_DOWNLOAD_FAILED",
        `No pude descargar el video de Fal (${videoResp.status}).`
      );
    }

    const bytes = Buffer.from(await videoResp.arrayBuffer());
    const mimeType = videoResp.headers.get("content-type") || "video/mp4";

    const uploaded = await uploadBufferToStorage({
      userId: user.id,
      tool: toolName,
      buffer: bytes,
      mimeType,
      nameHint: hint,
    });

    const storagePath = uploaded.storagePath;

    const meta = {
      tool: toolName,
      provider: "fal",
      model: selectedModelNorm,
      falEndpointId: endpointId || null,
      requestId: t.requestId || null,

      // Kling V3 recipe (si aplica)
      aspectRatio: t.ar || null,
      durationSeconds: t.totalDur || null,
      firstFrameAssetId: t.firstFrameAssetId || null,
      lastFrameAssetId: t.lastFrameAssetId || null,
      klingSound: Boolean(t.generateAudio),

      // Motion Control recipe (si aplica)
      motionControl: t.motionControl || null,

      // Video Edit recipe (si aplica)
      editVideo: t.editVideo || null,
    };


    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "video",
      tool: toolName,
      name: hint,
      prompt,
      storagePath,
      isPublic: false,
      meta,
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    // ✅ IMPORTANTÍSIMO:
    // Si el usuario llegó acá por el flujo "async" (Fal) y el frontend finalizó manualmente,
    // necesitamos actualizar la fila en public.jobs. Si no, queda eterna en "running".
    if (t.requestId) {
      const { error: upErr } = await supabaseAdmin
        .from("jobs")
        .update({
          status: "succeeded",
          result_asset_id: assetId,
          finished_at: new Date().toISOString(),
          error: null,
          next_check_at: null,
          locked_at: null,
          locked_by: null,
        })
        .eq("owner_id", user.id)
        .eq("kind", "video")
        .filter("params->>requestId", "eq", String(t.requestId));

      // No bloqueamos al usuario si falla este update.
      if (upErr) console.warn("[FAL_FINALIZE][JOB_UPDATE_FAILED]", upErr);
    }

    return res.json({
      ok: true,
      items: [{ url, assetId }],
      url,
      assetId,
      createdAt: Date.now(),
    });
  } catch (e) {
    return next(e);
  }
});

// In production, the API can also serve the built frontend (dist/) with static hosting.
// We'll keep this optional so dev stays fast.
if (process.env.SERVE_CLIENT === "1") {
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

// Si alguien llama una ruta /api que no existe
app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Esa ruta /api no existe.",
    },
  });
});

Sentry.setupExpressErrorHandler(app);

// Manejador global de errores (aquí caen TODOS los errores)
app.use((err, req, res, _next) => {
  // 1) Zod (validaciones)
  if (err?.name === "ZodError") {
    const details = err.errors?.map((e) => ({
      field: e.path?.join("."),
      message: e.message,
    }));

    return res.status(400).json({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Datos inválidos.",
        details,
      },
    });
  }

  // 2) Error controlado (como el de ensureAI)
  if (err?.status && err?.code) {
    return res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message === "AI_NOT_CONFIGURED"
          ? "La IA no está configurada en el servidor."
          : err.message,
        details: err.details,
      },
    });
  }

    // 2.5) Google GenAI SDK (ApiError)
  // Suele venir como:
  // ApiError: {"error":{"code":"http_error","message":"Not Found"}}
  // Si no lo normalizamos, cae en INTERNAL_ERROR y no vemos la causa real.
  if (
    err?.name === "ApiError" ||
    (typeof err?.message === "string" && err.message.startsWith("ApiError:"))
  ) {
    const raw = String(err?.message || "").replace(/^ApiError:\s*/, "").trim();
    let parsed = null;
    try {
      // A veces el SDK mete texto extra; intentamos aislar el JSON.
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const jsonStr = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = null;
    }

    const e = parsed?.error || parsed || {};
    const providerCode = (e?.code || "genai_error").toString();
    const providerMsg = (e?.message || err?.message || "Error del proveedor de IA").toString();
    const status = Number(e?.status) || Number(e?.statusCode) || 502;

    // Hint útil para Veo (muchos casos son falta de plan/billing o modelo no disponible)
    const hint =
      providerMsg.toLowerCase().includes("not found")
        ? "El modelo/endpoint no se encontró o tu API key no tiene acceso. Veo suele requerir Paid Tier/Billing habilitado."
        : providerMsg.toLowerCase().includes("permission") || providerMsg.toLowerCase().includes("unauth")
          ? "Tu API key no tiene permisos para este modelo. Revisa que el proyecto tenga billing y acceso a Veo."
          : undefined;

    return res.status(status).json({
      ok: false,
      error: {
        code: `GENAI_${providerCode.toUpperCase()}`,
        message: providerMsg,
        details: {
          ...(parsed ? { provider: parsed } : {}),
          ...(hint ? { hint } : {}),
        },
      },
    });
  }

  // 3) CORS
  if (err?.message === "CORS blocked") {
    return res.status(403).json({
      ok: false,
      error: {
        code: "CORS_BLOCKED",
        message: "Origen no permitido.",
      },
    });
  }

  // 3.5) Payload demasiado grande (body parser / express.json)
  // Esto pasa cuando mandamos un dataURL enorme (croppedImageDataUrl).
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      ok: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message:
          "El pedido contiene demasiados datos (probablemente el recorte). Vuelve a intentar: se enviará el recorte como preview más liviano.",
      },
    });
  }

  // 4) Cualquier otro error inesperado
  const errorId = randomUUID();
  req?.log?.error?.({ err, errorId }, "Unhandled error");

  const isDebug = !isProd;

  return res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: `Error inesperado en el servidor. (ID: ${errorId})`,
      details: {
        errorId,
        ...(isDebug
          ? {
              message: err?.message,
              stack: err?.stack,
            }
          : {}),
      },
    },
  });
});


const PORT = Number(process.env.PORT || 8080);


app.listen(PORT, "0.0.0.0", () => {
  console.log(`[API] listening on http://0.0.0.0:${PORT}`);
});
