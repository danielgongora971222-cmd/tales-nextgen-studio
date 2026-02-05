import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";


dotenv.config();

const PORT = Number(process.env.PORT || 8788);
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

async function requireUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return {
      user: null,
      error: { code: "UNAUTHENTICATED", message: "Login requerido." },
    };
  }

  if (!supabaseAdmin) {
    return {
      user: null,
      error: { code: "SUPABASE_NOT_CONFIGURED", message: "Supabase no está configurado en el backend." },
    };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    return {
      user: null,
      error: { code: "UNAUTHENTICATED", message: "Sesión inválida." },
    };
  }

  return { user: data.user, error: null };
}

function parseDataUrl(dataUrl) {
  // Espera: data:image/png;base64,AAAA...
  const match = typeof dataUrl === "string"
    ? dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    : null;

  if (!match) return { mimeType: "image/png", base64: dataUrl };
  return { mimeType: match[1], base64: match[2] };
}

function extFromMime(mimeType) {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function safeSlug(input) {
  return (input || "file")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "file";
}

function buildAssetPath({ userId, tool, mimeType, nameHint }) {
  const ext = extFromMime(mimeType || "image/png");
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ts = Date.now();
  const rand = Math.random().toString(16).slice(2, 10);
  const slug = safeSlug(nameHint || tool || "asset");
  const folder = safeSlug(tool || "generated");
  return `${userId}/${folder}/${day}/${ts}-${rand}-${slug}.${ext}`;
}

async function uploadBase64ToStorage({ userId, tool, dataUrl, nameHint }) {
  const { mimeType, base64 } = parseDataUrl(dataUrl);
  const bytes = Buffer.from(base64, "base64");
  const path = buildAssetPath({ userId, tool, mimeType, nameHint });

  const up = await supabaseAdmin.storage
    .from(SUPABASE_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false });

  if (up.error) throw new Error(up.error.message);
  return { storagePath: path, mimeType, sizeBytes: bytes.length };
}

async function signStoragePath(storagePath, expiresSeconds = 60 * 60) {
  const { data, error } = await supabaseAdmin.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(storagePath, expiresSeconds);

  if (error) throw new Error(error.message);
  return data.signedUrl;
}

async function insertAssetRow({ ownerId, type, tool, name, prompt, storagePath, isPublic, meta }) {
  const payload = {
    owner_id: ownerId,
    type: type || "image",
    tool: tool || null,
    name: name || null,
    prompt: prompt || null,
    storage_path: storagePath,
    is_public: Boolean(isPublic),
    meta: meta || {},
  };

  const { data, error } = await supabaseAdmin
    .from("assets")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

const app = express();
app.set("trust proxy", 1);

function getClientIp(req) {
  // Prioriza headers “reales” cuando estás detrás de proxies (Render/Cloudflare/Vercel)
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;

  const trueClient = req.headers["true-client-ip"];
  if (typeof trueClient === "string" && trueClient) return trueClient;

  const vercelFwd = req.headers["x-vercel-forwarded-for"];
  if (typeof vercelFwd === "string" && vercelFwd) return vercelFwd.split(",")[0].trim();

  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();

  return req.ip;
}

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
  keyGenerator: getClientIp,
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
  keyGenerator: getClientIp,
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
  keyGenerator: getClientIp,
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

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    service: "tales-nextgen-studio-api",
    env: process.env.APP_ENV || process.env.NODE_ENV || "unknown",
    version: process.env.APP_VERSION || "unknown",
    time: new Date().toISOString(),
  });
});

const ImageRequestSchema = z.object({
  prompt: z.string().min(1).max(14000),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),

  // UI nueva
  count: z.number().int().min(1).max(4).default(1),
  quality: z.enum(["1K", "2K", "4K"]).optional(),

  tool: z.string().optional(),      // ej: "image-generator"
  nameHint: z.string().optional(),  // ej: "generated"

  // Referencias por Asset IDs (opcional)
  characterAssetIds: z.array(z.string()).max(10).optional(),
  styleAssetId: z.string().optional(),
  backgroundAssetId: z.string().optional(),
});

const Base64ImageSchema = z
  .string()
  .min(10)
  .refine((v) => v.startsWith("data:image/"), "Expected a data:image/*;base64,... dataUrl");

const RestyleSchema = z.object({
  imageDataUrl: Base64ImageSchema,
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
});

const FaceSwapSchema = z.object({
  sourceDataUrl: Base64ImageSchema,
  targetDataUrl: Base64ImageSchema,
  model: z.string().optional(),
});

const UpscaleSchema = z.object({
  imageDataUrl: Base64ImageSchema,
  scale: z.number().int().min(2).max(8).default(2),
  model: z.string().optional(),
});

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
// Assets: historial del usuario (DB)
// GET /api/assets?type=image&limit=50
// ===============================
app.get("/api/assets", async (req, res) => {
  // 1) exigir login
  const scope = typeof req.query.scope === "string" ? req.query.scope : "my";
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  // 2) leer filtros simples
  const type = typeof req.query.type === "string" ? req.query.type : null;
  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

  // 3) pedir assets del usuario a la DB
  let q = supabaseAdmin
    .from("assets")
    .select("id, url, storage_path, type, name, prompt, created_at, owner_id, is_public, meta")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope === "public") {
    q = q.eq("is_public", true);
  } else {
    q = q.eq("owner_id", user.id);
  }

  if (type) q = q.eq("type", type);

  const { data, error: dbErr } = await q;

  if (dbErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_QUERY_FAILED", message: dbErr.message },
    });
  }

  // 4) convertir a la forma que el frontend espera (Asset de types.ts)
  //    + generar signed URLs cuando url está null pero hay storage_path
  const rows = data || [];

  const items = await Promise.all(
    rows.map(async (row) => {
      let url = row.url || null;

      // Si no hay url guardada, la generamos firmada desde storage_path
      if (!url && row.storage_path) {
        url = await signStoragePath(row.storage_path, 60 * 60); // 1 hora
      }

      // createdAt: soporta string timestamp o number (ms)
      const createdAt =
        typeof row.created_at === "string"
          ? new Date(row.created_at).getTime()
          : row.created_at || Date.now();

      return {
        id: row.id,
        url,
        type: row.type === "video" ? "video" : "image",
        name: row.name || `Generation ${String(row.id).slice(0, 4)}`,
        prompt: row.prompt || undefined,
        meta: row.meta ?? null,
        createdAt,
        ownerId: row.owner_id,
        isPublic: !!row.is_public,
        likes: [],
        comments: [],
      };
    })
  );

    return res.json({ ok: true, items });
});

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

// ===============================
// Assets visibility: publish / unpublish
// POST /api/assets/:id/publish

// ===============================
// Assets visibility: publish / unpublish
// POST /api/assets/:id/publish
// POST /api/assets/:id/unpublish
// ===============================

app.post("/api/assets/:id/publish", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  const { data, error: upErr } = await supabaseAdmin
    .from("assets")
    .update({ is_public: true })
    .eq("id", assetId)
    .eq("owner_id", user.id)
    .select("id,is_public")
    .single();

  if (upErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_UPDATE_FAILED", message: upErr.message },
    });
  }

  if (!data) {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Asset no encontrado o no es tuyo." },
    });
  }

  return res.json({ ok: true, id: data.id, isPublic: !!data.is_public });
});

const UploadAssetSchema = z.object({
  dataUrl: Base64ImageSchema,
  name: z.string().max(200).optional(),
  tool: z.string().max(50).optional(),
  type: z.enum(["image","video"]).optional(),
});

app.post("/api/assets/upload", async (req, res, next) => {
  try {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const { dataUrl, name, tool, type } = UploadAssetSchema.parse(req.body);

    const toolName = tool || "upload";
    const assetType = type || "image";

    const { storagePath, mimeType, sizeBytes } = await uploadBase64ToStorage({
      userId: user.id,
      tool: toolName,
      dataUrl,
      nameHint: name || "upload",
    });

    // Este endpoint es SOLO para subir un asset (por ejemplo, una referencia).
    // No está ligado a la generación.
    const meta = {
      source: "upload",
      tool: toolName,
      mimeType: mimeType || null,
      sizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
      uploadedAt: new Date().toISOString(),
    };

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: assetType,
      tool: toolName,
      name: name || "upload",
      prompt: null,
      storagePath,
      isPublic: false,
      meta,
    });

    const url = await signStoragePath(storagePath);

    return res.json({
      ok: true,
      item: {
        id: assetId,
        url,
        type: assetType,
        tool: toolName,
        name: name || "upload",
        ownerId: user.id,
        isPublic: false,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/assets/:id/unpublish", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  const { data, error: upErr } = await supabaseAdmin
    .from("assets")
    .update({ is_public: false })
    .eq("id", assetId)
    .eq("owner_id", user.id)
    .select("id,is_public")
    .single();

  if (upErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_UPDATE_FAILED", message: upErr.message },
    });
  }

  if (!data) {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Asset no encontrado o no es tuyo." },
    });
  }

  return res.json({ ok: true, id: data.id, isPublic: !!data.is_public });
});

function apiError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details) err.details = details;
  throw err;
}

function httpError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details) err.details = details;
  return err;
}

function isImageGenModel(model) {
  return (
    typeof model === "string" &&
    (
      model.includes("imagen") ||
      model.endsWith("-image") ||
      model.includes("-image-") ||
      model.startsWith("fal-ai/flux-2-")
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
  if (model === "gemini-2.5-flash-image") return 4; // NanoBanana
  return 4;
}

// =============================
// Fal.ai helpers (Flux 2.0)
// =============================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    throw httpError(502, "FAL_SUBMIT_FAILED", submitJson?.detail || submitJson?.message || submitText);
  }

  const statusUrl = submitJson?.status_url;
  const requestId = submitJson?.request_id;
  if (!statusUrl || !requestId) {
    throw httpError(502, "FAL_SUBMIT_MISSING_FIELDS", "Fal submit missing status_url/request_id");
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
      throw httpError(502, "FAL_STATUS_FAILED", statusJson?.detail || statusJson?.message || statusText);
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

  // Fetch final result
  const resultUrl = `https://queue.fal.run/${endpointId}/requests/${requestId}`;
  const resultResp = await fetch(resultUrl, { headers: { Authorization: auth } });
  const resultText = await resultResp.text();
  let resultJson;
  try {
    resultJson = JSON.parse(resultText);
  } catch {
    throw httpError(502, "FAL_BAD_RESULT", `Fal result invalid JSON: ${resultText.slice(0, 200)}`);
  }
  if (!resultResp.ok) {
    throw httpError(502, "FAL_RESULT_FAILED", resultJson?.detail || resultJson?.message || resultText);
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
// Assets: delete (owner only)
// DELETE /api/assets/:id
// ===============================
app.delete("/api/assets/:id", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  // 1) Buscar asset y validar dueño
  const { data: row, error: qErr } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, storage_path")
    .eq("id", assetId)
    .maybeSingle();

  if (qErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_QUERY_FAILED", message: qErr.message },
    });
  }

  if (!row) {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Asset no encontrado." },
    });
  }

  if (row.owner_id !== user.id) {
    return res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "No tienes permiso para eliminar este asset." },
    });
  }

  // 2) Borrar del storage si existe
  if (row.storage_path) {
    const { error: rmErr } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .remove([row.storage_path]);

    // Si falla, reportamos error (para evitar DB sin archivo o viceversa)
    if (rmErr) {
      return res.status(500).json({
        ok: false,
        error: { code: "STORAGE_DELETE_FAILED", message: rmErr.message },
      });
    }
  }

  // 3) Borrar fila en DB
  const { error: delErr } = await supabaseAdmin
    .from("assets")
    .delete()
    .eq("id", assetId)
    .eq("owner_id", user.id);

  if (delErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_DELETE_FAILED", message: delErr.message },
    });
  }

  return res.json({ ok: true, id: assetId });
});


app.post("/api/ai/image", async (req, res, next) => {
  try {

    const {
      prompt,
      model,
      aspectRatio,
      count,
      quality,
      tool,
      nameHint,
      characterAssetIds,
      styleAssetId,
      backgroundAssetId,
    } = ImageRequestSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const selectedModel = model || "gemini-2.5-flash-image";
    const maxCount = maxCountForImageModel(selectedModel);
    if (count > maxCount) {
      throw httpError(
        400,
        "COUNT_NOT_SUPPORTED",
        `This model supports up to ${maxCount} image(s) per request.`
      );
    }

    // "auto" en UI = dejar que el modelo use su default (excepto OpenAI, que sí soporta size="auto")
    const arNonOpenAI = aspectRatio === "auto" ? undefined : aspectRatio;

    // =============================
    // OPENAI GPT IMAGE
    // =============================
        if (selectedModel.startsWith("openai:")) {
      const { model: openaiModel, quality: openaiQuality } = parseOpenAIImageModel(selectedModel);

      const refs = [
        ...((characterAssetIds || []).map((id, i) => ({ label: `Character reference ${i + 1}`, id }))),
        ...(styleAssetId ? [{ label: "Style reference", id: styleAssetId }] : []),
        ...(backgroundAssetId ? [{ label: "Background reference", id: backgroundAssetId }] : []),
      ];

      // Limitar aspect ratios soportados
      if (aspectRatio && aspectRatio !== "auto" && !["1:1", "3:2", "2:3"].includes(aspectRatio)) {
        throw httpError(
          400,
          "ASPECT_RATIO_NOT_SUPPORTED",
          `GPT 1.5 solo soporta 1:1, 3:2, 2:3. Recibí: ${aspectRatio}`
        );
      }

      // Quality/resolución UI: por ahora 1K solamente
      if (quality && quality !== "1K") {
        throw httpError(400, "QUALITY_NOT_SUPPORTED", "GPT 1.5 en esta tool solo usará 1K por ahora.");
      }

      const nRequested = Math.min(Number(count || 1), maxCount);
      const toolName = tool || "image-generator";
      const hint = nameHint || "generated";
      const items = [];
      const urlExpiresInSeconds = 60 * 60;

      const size = openaiSizeFromAspectRatio(aspectRatio);

      // ✅ Si hay referencias, las mandamos como images[] usando /v1/images/edits
      const imageFiles = refs.length
        ? await Promise.all(refs.map((r) => assetIdToImageFile(r.id, user.id)))
        : [];

      for (let i = 0; i < nRequested; i++) {
        const dataUrl = await openaiGenerateImageDataUrl({
          model: openaiModel,         // gpt-image-1.5
          prompt,
          size,
          quality: openaiQuality,     // auto | high
          images: imageFiles,         // refs
        });

        const { storagePath } = await uploadBase64ToStorage({
          userId: user.id,
          tool: toolName,
          dataUrl,
          nameHint: hint,
        });

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "image",
          tool: toolName,
          name: hint,
          prompt,
          storagePath,
          isPublic: false,
          meta: {
            tool: toolName,
            model: selectedModel,
            aspectRatio: aspectRatio || null,
            quality: quality || "1K",
            count: nRequested,
            characterAssetIds: characterAssetIds || [],
            styleAssetId: styleAssetId || null,
            backgroundAssetId: backgroundAssetId || null,
          },
        });

        const url = await signStoragePath(storagePath, urlExpiresInSeconds);
        items.push({ url, assetId });
      }

      return res.json({
        ok: true,
        items,
        url: items[0]?.url,
        assetId: items[0]?.assetId,
        urlExpiresInSeconds,
      });
    }

    // =============================
    // BFL / FLUX 2.0 (Max / Pro / Flex)  ✅ usa tu API key de Black Forest Labs
    // =============================
    if (selectedModel.startsWith("fal-ai/flux-2-")) {
      const bflModel = selectedModel.replace("fal-ai/", ""); // flux-2-max | flux-2-pro | flux-2-flex

      const nRequested = Math.min(Number(count || 1), maxCount);
      const toolName = tool || "image-generator";
      const hint = nameHint || "generated";
      const urlExpiresInSeconds = 60 * 60;

      const dims = falDimsFromAspectQuality(aspectRatio, quality);

      // BFL soporta hasta 8 imágenes de referencia por request
      const refIds = [
        ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
        ...(backgroundAssetId ? [backgroundAssetId] : []),
        ...(styleAssetId ? [styleAssetId] : []),
      ].filter(Boolean);

      const refUrls = refIds.length
        ? await Promise.all(refIds.slice(0, 8).map((id) => assetIdToSignedUrl(id, user.id, 60 * 10)))
        : [];

      let bflPrompt = prompt;
      if (refUrls.length) {
        // En BFL puedes referenciar "image 1", "image 2", etc.
        bflPrompt =
          `${prompt}\n\n` +
          `Reference images by number: ${refUrls.map((_, i) => `image ${i + 1}`).join(", ")}.`;
      }

      const payload = {
        prompt: bflPrompt,
        width: dims.width,
        height: dims.height,
        output_format: "png",
        safety_tolerance: 2,
      };

      if (refUrls[0]) payload.input_image = refUrls[0];
      for (let i = 1; i < refUrls.length && i < 8; i++) {
        payload[`input_image_${i + 1}`] = refUrls[i];
      }

      const items = [];
      for (let i = 0; i < nRequested; i++) {
        const submit = await bflSubmit(bflModel, payload);
        const done = await bflPoll(submit.polling_url, { timeoutMs: 180000 });

        const sampleUrl = done?.result?.sample || done?.result?.url;
        const dataUrl = await bflSampleToDataUrl(sampleUrl);

        const { storagePath } = await uploadBase64ToStorage({
          userId: user.id,
          tool: toolName,
          dataUrl,
          nameHint: hint,
        });

        const meta = {
          tool: toolName,
          provider: "bfl",
          model: selectedModel,
          bflModel,
          aspectRatio: aspectRatio || null,
          quality: quality || null,
          count: nRequested,
          characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
          styleAssetId: styleAssetId || null,
          backgroundAssetId: backgroundAssetId || null,
        };

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "image",
          tool: toolName,
          name: hint,
          prompt,
          storagePath,
          isPublic: false,
          meta,
        });

        const url = await signStoragePath(storagePath, urlExpiresInSeconds);
        items.push({ url, assetId });
      }

      return res.json({
        ok: true,
        items,
        url: items[0]?.url,
        assetId: items[0]?.assetId,
        urlExpiresInSeconds,
      });
    }

    // 1) Validar que el modelo sea de imagen
    if (!isImageGenModel(selectedModel)) {
      apiError(
        400,
        "MODEL_NOT_IMAGE",
        `El modelo "${selectedModel}" no genera imágenes. Usa "gemini-2.5-flash-image" o "gemini-3-pro-image-preview".`
      );
    }

    // 2) Validar quality según modelo
    if (quality) {
      if (selectedModel === "gemini-2.5-flash-image" && quality !== "1K") {
        apiError(
          400,
          "QUALITY_NOT_SUPPORTED",
          `Gemini 2.5 Flash Image solo soporta 1K. Usa 1K o cambia a gemini-3-pro-image-preview para 2K/4K.`
        );
      }
      if (selectedModel.includes("imagen") && quality === "4K") {
        apiError(
          400,
          "QUALITY_NOT_SUPPORTED",
          `Imagen no soporta 4K aquí. Para 4K usa gemini-3-pro-image-preview.`
        );
      }
    }

    // 3) Config correcta para que DEVUELVA IMAGEN
    const config = {
      responseModalities: ["Image"],
      imageConfig: {},
    };

    if (arNonOpenAI) config.imageConfig.aspectRatio = arNonOpenAI;

    // imageSize SOLO en gemini-3-pro-image-preview (y en imagen para 1K/2K)
    if (selectedModel === "gemini-3-pro-image-preview" && quality) {
      config.imageConfig.imageSize = quality; // "1K" | "2K" | "4K"
    } else if (selectedModel.includes("imagen") && quality && quality !== "4K") {
      config.imageConfig.imageSize = quality; // "1K" | "2K"
    }

    // 4) Referencias opcionales (IDs de assets guardados en tu DB)
    const refs = [
      ...((characterAssetIds || []).map((id, i) => ({ label: `Character reference ${i + 1}`, id }))),
      ...(styleAssetId ? [{ label: "Style reference", id: styleAssetId }] : []),
      ...(backgroundAssetId ? [{ label: "Background reference", id: backgroundAssetId }] : []),
    ];
    const hasRefs = refs.length > 0;

    // 5) Generar N imágenes (1..4)
    const nRequested = Math.min(Number(count || 1), maxCount);
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const items = [];
    const urlExpiresInSeconds = 60 * 60;

    // --- Imagen models: usar generateImages (generateContent NO devuelve bytes de imagen) ---
    const aiClient = await ensureAI();
    if (selectedModel.includes("imagen")) {
      if (hasRefs) {
        throw httpError(
          400,
          "REFS_NOT_SUPPORTED",
          "Los modelos Imagen no aceptan imágenes de referencia en este endpoint. Selecciona NanoBanana / NanoBanana Pro para usar referencias."
        );
      }

      const n = selectedModel.includes("ultra") ? 1 : nRequested;

      const imgConfig = {
        numberOfImages: n,
      };

      if (aspectRatio) imgConfig.aspectRatio = aspectRatio;
      if (quality && quality !== "4K") imgConfig.imageSize = quality; // Imagen: 1K | 2K

      const response = await aiClient.models.generateImages({
        model: selectedModel,
        prompt,
        config: imgConfig,
      });

      const generated = Array.isArray(response?.generatedImages) ? response.generatedImages : [];
      if (!generated.length) {
        throw httpError(500, "GENERATION_REJECTED", "No image generated.", {
          hasGeneratedImages: false,
          generatedCount: 0,
        });
      }

      for (const g of generated) {
        const b64 = g?.image?.imageBytes;
        if (!b64) continue;

        const dataUrl = `data:image/png;base64,${b64}`;

        const { storagePath } = await uploadBase64ToStorage({
          userId: user.id,
          tool: toolName,
          dataUrl,
          nameHint: hint,
        });

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "image",
          tool: toolName,
          name: hint,
          prompt,
          storagePath,
          isPublic: false,
          meta: {
            tool: toolName,
            model: selectedModel,
            aspectRatio: aspectRatio || null,
            quality: quality || null,
            count: generated.length,
            characterAssetIds: [],
            styleAssetId: null,
            backgroundAssetId: null,
          },
        });

        const url = await signStoragePath(storagePath, urlExpiresInSeconds);
        items.push({ url, assetId });
      }

      if (!items.length) {
        throw httpError(500, "GENERATION_REJECTED", "No image generated.", {
          hasGeneratedImages: true,
          generatedCount: generated.length,
          savedCount: 0,
        });
      }

      return res.json({
        ok: true,
        items,
        url: items[0]?.url,
        assetId: items[0]?.assetId,
        urlExpiresInSeconds,
      });
    }

    // --- Gemini image models: generateContent con partes (texto + refs) ---
    const parts = [];
    for (const ref of refs) {
      parts.push({ text: `${ref.label}:` });
      parts.push(await assetIdToInlinePart(ref.id, user.id));
    }
    parts.push({ text: prompt });

    const n = nRequested;

    for (let i = 0; i < n; i++) {
      const response = await aiClient.models.generateContent({
        model: selectedModel,
        contents: [{ role: "user", parts }],
        config,
      });

      const dataUrl = await extractImageDataUrl(response);

      const { storagePath } = await uploadBase64ToStorage({
        userId: user.id,
        tool: toolName,
        dataUrl,
        nameHint: hint,
      });

      const assetId = await insertAssetRow({
        ownerId: user.id,
        type: "image",
        tool: toolName,
        name: hint,
        prompt,
        storagePath,
        isPublic: false,
        meta: {
          tool: toolName,
          model: selectedModel,
          aspectRatio: aspectRatio || null,
          quality: quality || null,
          count: n,
          characterAssetIds: characterAssetIds || [],
          styleAssetId: styleAssetId || null,
          backgroundAssetId: backgroundAssetId || null,
        },
      });

      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    return res.json({
      ok: true,
      items,
      url: items[0]?.url,
      assetId: items[0]?.assetId,
      urlExpiresInSeconds,
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/ai/restyle", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const body = RestyleSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const selectedModel = body.model || "imagen-3.0-generate-002";

    const { mimeType, base64 } = parseDataUrl(body.imageDataUrl);
    const prompt = body.prompt || "Restyle this image with high quality.";

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
      tool: "restyler",
      dataUrl,
      nameHint: "restyle",
    });

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "restyler",
      name: "restyle",
      prompt,
      storagePath,
      isPublic: false,
      meta: {
        toolVersion: 1,
      },
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({ ok: true, url, assetId, urlExpiresInSeconds });
  } catch (err) {
    next(err);
  }
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

// Note: video generation is intentionally not exposed yet because returning URLs can leak API keys.
// Add it once we implement server-side streaming/proxy storage.
app.post("/api/ai/video", (_req, res) => {
  res.status(501).json({
    ok: false,
    error:
      "Video generation is disabled in the backend proxy for now. Enable it after implementing server-side streaming/storage to avoid exposing API keys.",
  });
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
  req?.log?.error?.({ err }, "Unhandled error");
  return res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Error inesperado en el servidor.",
    },
  });
});

app.listen(PORT, () => {
  console.log(`[API] listening on http://0.0.0.0:${PORT}`);
});
