import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "crypto";
import {
  createImage2VideoTask,
  createText2VideoTask,
  pollTaskUntilDone,
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
import { FalFinalizeSchema } from "./schemas/index.js";


dotenv.config();

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

const { requireUser } = createAuthHelpers(supabaseAdmin);

const {
  parseDataUrl,
  extFromMime,
  safeSlug,
  buildAssetPath,
  uploadBase64ToStorage,
  uploadBufferToStorage,
  signStoragePath,
  insertAssetRow,
} = createStorageHelpers(supabaseAdmin, SUPABASE_BUCKET);


const app = express();
app.set("trust proxy", 1);


// --- Security & logs ---
app.disable("x-powered-by");

// Logs básicos (muy útil para ver requests en Render)
app.use(
  pinoHttp({
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
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      // Si no viene "origin" (ej: server-to-server), lo permitimos
      if (!origin) return cb(null, true);

      // Si no configuras ALLOWED_ORIGINS, permitimos (modo simple)
      if (allowedOrigins.length === 0) return cb(null, true);

      // Si está en la lista, ok
      if (allowedOrigins.includes(origin)) return cb(null, true);

      // Si no, bloquea
      return cb(new Error("CORS blocked"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)
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
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
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

// Aplica este limitador a TODAS las rutas /api/ai/*
app.use("/api/ai", aiLimiter);
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use("/api", createHealthRouter());

app.use(
  "/api",
  createAiVideoRouter({
    // deps/core
    supabaseAdmin,
    requireUser,
    getClientIp,
    apiError,
    httpError,
    ensureAI,

  // kling + fal helpers (se usan dentro de routes/ai/video.js)
    createImage2VideoTask,
    createText2VideoTask,
    pollTaskUntilDone,
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
    insertAssetRow,

    // env/flags
    APP_ENV: process.env.APP_ENV,
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_BUCKET: process.env.SUPABASE_BUCKET,

    // ⚠️ Si tus endpoints /api/assets usan otras cosas del server.js,
    // agrégalas aquí con el MISMO nombre (sin tocar el handler).
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

  // 2) Descarga desde Storage y convierte a base64
  const dl = await supabaseAdmin.storage.from(SUPABASE_BUCKET).download(row.storage_path);
  if (dl.error || !dl.data) {
    const e = new Error(dl.error?.message || "No se pudo descargar el asset desde Storage.");
    e.status = 500;
    e.code = "ASSET_DOWNLOAD_FAILED";
    throw e;
  }

  const blob = dl.data;
  const ab = await blob.arrayBuffer();
  const base64 = Buffer.from(ab).toString("base64");
  const mimeType = blob.type || mimeFromPath(row.storage_path);

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
      .select("id, url, storage_path, type, name, prompt, created_at, owner_id, is_public, meta")
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

        return {
          id: row.id,
          url,
          type: row.type === "video" ? "video" : "image",
          name: row.name || `Generation ${String(row.id).slice(0, 4)}`,
          prompt: row.prompt || undefined,
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          ownerId: row.owner_id,
          isPublic: !!row.is_public,
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
const JOB_TOKEN_SECRET = process.env.JOB_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

function signJobToken(payloadObj) {
  if (!JOB_TOKEN_SECRET) throw httpError(500, "JOB_TOKEN_SECRET_MISSING", "Missing JOB_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY)");
  const payloadB64 = base64urlEncode(JSON.stringify(payloadObj));
  const sigB64 = createHmac("sha256", JOB_TOKEN_SECRET).update(payloadB64).digest("base64");
  const sig = sigB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${payloadB64}.${sig}`;
}

function verifyJobToken(token) {
  if (!JOB_TOKEN_SECRET) throw httpError(500, "JOB_TOKEN_SECRET_MISSING", "Missing JOB_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY)");
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
  // ---- Fal helpers: formateo de errores para evitar mensajes tipo "[object Object]" ----
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


function buildKlingElementStoragePath({ userId, elementUuid, index, mimeType }) {
  const ext = extFromMime(mimeType || "image/png");
  return `${userId}/kling-element/${elementUuid}-${index}.${ext}`;
}

async function uploadBytesToStorageAtPath({ storagePath, bytes, mimeType }) {
  const up = await supabaseAdmin.storage
    .from(SUPABASE_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType || "image/png", upsert: false });

  if (up.error) throw new Error(up.error.message);
  return storagePath;
}

async function deleteStoragePaths(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!unique.length) return;

  const { error } = await supabaseAdmin.storage
    .from(SUPABASE_BUCKET)
    .remove(unique);

  if (error) throw new Error(error.message);
}

  function resolveKlingCreateElementUrl() {
    const directRaw = (process.env.KLING_ELEMENT_CREATE_URL || "").toString().trim();

    // Si te dieron una URL completa, úsala.
    if (directRaw) {
      if (/^https?:\/\//i.test(directRaw)) return directRaw.replace(/\/+$/g, "");
      // Si pusiste "api.klingai.com/v1/..." sin https, lo arreglamos.
      if (/^api\.klingai\.com/i.test(directRaw)) return `https://${directRaw}`.replace(/\/+$/g, "");
      // Si pusiste un PATH (ej: "/v1/general/custom-elements"), lo tratamos como PATH.
      process.env.KLING_ELEMENT_CREATE_PATH = directRaw;
    }

    let baseUrl = (process.env.KLING_BASE_URL || "https://api.klingai.com")
      .toString()
      .trim()
      .replace(/\/+$/g, "");

    // Fuerza /v1 en base
    if (!/\/v1$/i.test(baseUrl)) baseUrl += "/v1";

    let pathRaw = (process.env.KLING_ELEMENT_CREATE_PATH || "/general/custom-elements")
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


async function klingCreateElement({ name, tag, imageUrls }) {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw httpError(500, "KLING_NOT_CONFIGURED", "Faltan KLING_ACCESS_KEY / KLING_SECRET_KEY en el backend.");
  }

  const url = resolveKlingCreateElementUrl();

  const base = { name };
  const payloads = [
    // Formato común (lista)
    {
      ...base,
      ...(tag ? { tag } : {}),
      image_list: imageUrls.map((u) => ({ image: u })),
    },

        {
      ...base,
      ...(tag ? { tag } : {}),
      image_list: imageUrls.map((u) => ({ url: u })),
    },

    // Alternativa (cover + extras)
    {
      ...base,
      ...(tag ? { tag } : {}),
      coverImage: imageUrls[0],
      images: imageUrls,
    },
    // Alternativa (array simple)
    {
      ...base,
      ...(tag ? { tag } : {}),
      image_urls: imageUrls,
    },
  ];

  let lastErr = null;

    for (const payload of payloads) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${makeKlingJwt(accessKey, secretKey, 300)}`,
        },
        body: JSON.stringify(payload),
      });

      const text = await resp.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}

      if (resp.ok && json && (json.code === 0 || json.code === undefined || json.success === true)) {
        const data = json.data || json;
        const elementId =
          data.element_id ||
          data.elementId ||
          data.id ||
          data.element?.id ||
          data.element?.element_id;

        if (elementId) return { elementId, raw: json };
      }

      const msgFromJson =
        json?.message ||
        json?.msg ||
        json?.error?.message ||
        json?.error ||
        null;

      const statusLine = `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`;
      const snippet = (text || "").slice(0, 280);

      lastErr = new Error(`${msgFromJson || statusLine}${snippet ? ` | body: ${snippet}` : ""}`);
    } catch (e) {
      lastErr = e;
    }
  }

  throw httpError(
    502,
    "KLING_CREATE_ELEMENT_FAILED",
    `Kling no aceptó el payload para crear el Element. URL usada: ${url}. Detalles: ${lastErr?.message || "unknown"}`
  );
}

// GET /api/kling/elements  -> lista elementos del usuario
app.get("/api/kling/elements", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const { data, error: dbErr } = await supabaseAdmin
    .from("kling_elements")
    .select("id, name, kling_element_id, preview_path, image_paths, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (dbErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_SELECT_FAILED", message: dbErr.message } });
  }

  const items = await Promise.all(
    (data || []).map(async (row) => {
      const previewUrl = row.preview_path ? await signStoragePath(row.preview_path, 60 * 60) : null;
      const imageUrls = Array.isArray(row.image_paths)
        ? await Promise.all(row.image_paths.map((p) => signStoragePath(p, 60 * 60)))
        : [];

      return {
        id: row.id,
        name: row.name,
        klingElementId: row.kling_element_id || null,
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

    const { name, tag, images } = CreateKlingElementRequestSchema.parse(req.body);

    const elementUuid = randomUUID();

    // 1) Subir imágenes a Storage bajo /<userId>/kling-element/<uuid>-N.ext
    const imagePaths = [];
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

      const storagePath = buildKlingElementStoragePath({
        userId: user.id,
        elementUuid,
        index: i + 1,
        mimeType,
      });

      await uploadBytesToStorageAtPath({ storagePath, bytes, mimeType });
      imagePaths.push(storagePath);
    }

    // 2) Firmar URLs (para que Kling pueda descargar)
    const signedImageUrls = await Promise.all(imagePaths.map((p) => signStoragePath(p, 60 * 30)));

    // 3) Crear Element en Kling (endpoint configurable via env)
    const { elementId } = await klingCreateElement({
      name,
      tag: tag || "character",
      imageUrls: signedImageUrls,
    });

    // 4) Guardar en DB (paths, no URLs firmadas)
    const previewPath = imagePaths[0];

    const { data: row, error: insErr } = await supabaseAdmin
      .from("kling_elements")
      .insert({
        owner_id: user.id,
        name,
        kling_element_id: String(elementId),
        image_paths: imagePaths,
        preview_path: previewPath,
      })
      .select("id, name, kling_element_id, preview_path, image_paths, created_at")
      .single();

    if (insErr) {
      // Si falla DB, intentamos limpiar storage para no dejar basura
      try {
        await deleteStoragePaths(imagePaths);
      } catch {}
      return res.status(500).json({ ok: false, error: { code: "DB_INSERT_FAILED", message: insErr.message } });
    }

    const previewUrl = await signStoragePath(row.preview_path, 60 * 60);
    const imageUrls = await Promise.all((row.image_paths || []).map((p) => signStoragePath(p, 60 * 60)));

    return res.status(201).json({
      ok: true,
      item: {
        id: row.id,
        name: row.name,
        klingElementId: row.kling_element_id,
        createdAt: row.created_at,
        previewUrl,
        imageUrls,
      },
    });
  } catch (err) {
    return next(err);
  }
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


app.post("/api/ai/faceswap", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const body = FaceSwapSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const selectedModel = body.model || "imagen-3.0-generate-002";

    const src = parseDataUrl(body.sourceDataUrl);
    const tgt = parseDataUrl(body.targetDataUrl);

    const prompt =
      body.prompt ||
      "Swap the face from the SOURCE onto the TARGET naturally. Match lighting, skin tone, and preserve realism.";

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: [
        {
          role: "user",
          parts: [
            { text: "SOURCE IMAGE (face to copy):" },
            { inlineData: { mimeType: src.mimeType, data: src.base64 } },
            { text: "TARGET IMAGE (face to replace):" },
            { inlineData: { mimeType: tgt.mimeType, data: tgt.base64 } },
            { text: `INSTRUCTIONS: ${prompt}` },
          ],
        },
      ],
    });

    const dataUrl = await extractImageDataUrl(response);

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: "faceswap",
      dataUrl,
      nameHint: "faceswap",
    });

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "faceswap",
      name: "faceswap",
      prompt,
      storagePath,
      isPublic: false,
      meta: { toolVersion: 1 },
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
    const aiClient = await ensureAI();
    const body = UpscaleSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const selectedModel = body.model || "imagen-3.0-generate-002";
    const scale = body.scale || 2;

    const { mimeType, base64 } = parseDataUrl(body.imageDataUrl);

    const prompt = `Upscale this image by ${scale}x. Preserve detail, avoid artifacts, keep it photorealistic.`;

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
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
      meta: { toolVersion: 1, scale },
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

    const storagePath = buildAssetPath({
      userId: user.id,
      tool: toolName,
      mimeType,
      nameHint: hint,
    });

    await uploadBytesToStorageAtPath({ storagePath, bytes, mimeType });

    const meta = {
      tool: toolName,
      provider: "fal",
      model: selectedModelNorm,
      falEndpointId: endpointId || null,
      aspectRatio: t.ar || null,
      durationSeconds: t.totalDur || null,
      firstFrameAssetId: t.firstFrameAssetId || null,
      lastFrameAssetId: t.lastFrameAssetId || null,
      klingSound: Boolean(t.generateAudio),
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

    return res.json({
      ok: true,
      items: [{ url, assetId }],
      url,
      assetId,
      urlExpiresInSeconds,
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

  // 4) Cualquier otro error inesperado
  const errorId = randomUUID();
  req?.log?.error?.({ err, errorId }, "Unhandled error");

  const isDebug = (process.env.APP_ENV || "").toLowerCase() !== "production";

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
