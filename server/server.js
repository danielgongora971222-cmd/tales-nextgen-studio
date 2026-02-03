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

async function insertAssetRow({ ownerId, type, tool, name, prompt, storagePath, isPublic }) {
  const payload = {
    owner_id: ownerId,
    type: type || "image",
    tool: tool || null,
    name: name || null,
    prompt: prompt || null,
    storage_path: storagePath,
    is_public: Boolean(isPublic),
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
  prompt: z.string().min(1).max(4000),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
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

async function extractImageDataUrl(response) {
  const candidates = response?.candidates;
  const parts = candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      return `data:${mimeType};base64,${part.inlineData.data}`;
    }
  }
  // fallback to text
  const msg = response?.text || "No image generated.";
  throw new Error(msg);
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
    .select("id, url, storage_path, type, name, prompt, created_at, owner_id, is_public")
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

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: toolName,
      dataUrl,
      nameHint: name || "upload",
    });

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: assetType,
      tool: toolName,
      name: name || "upload",
      prompt: null,
      storagePath,
      isPublic: false,
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

app.post("/api/ai/image", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const { prompt, model, aspectRatio } = ImageRequestSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const selectedModel = model || "imagen-3.0-generate-002";
    const config = {};
    if (aspectRatio && selectedModel.includes("imagen")) {
      config.imageConfig = { aspectRatio };
    }

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: [{ role: "user", parts: [{ text: `Generate an image: ${prompt}` }] }],
      config,
    });

    const dataUrl = await extractImageDataUrl(response);

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: "generator",
      dataUrl,
      nameHint: "generated",
    });

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "generator",
      name: "generated",
      prompt,
      storagePath,
      isPublic: false,
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({ ok: true, url, assetId, urlExpiresInSeconds });
  } catch (err) {
    next(err);
  }
});

app.post("/api/ai/restyle", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const { imageDataUrl, prompt, model } = RestyleSchema.parse(req.body);
    const selectedModel = model || "imagen-3.0-generate-002";

    const imagePart = {
      inlineData: {
        mimeType: "image/png",
        data: cleanBase64(imageDataUrl),
      },
    };

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: { parts: [imagePart, { text: prompt }] },
    });

    const dataUrl = await extractImageDataUrl(response);
    res.json({ ok: true, dataUrl });
  } catch (err) {
    next(err);
  }
});

app.post("/api/ai/faceswap", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const { sourceDataUrl, targetDataUrl, model } = FaceSwapSchema.parse(req.body);
    const selectedModel = model || "imagen-3.0-generate-002";

    const sourcePart = {
      inlineData: {
        mimeType: "image/png",
        data: cleanBase64(sourceDataUrl),
      },
    };
    const targetPart = {
      inlineData: {
        mimeType: "image/png",
        data: cleanBase64(targetDataUrl),
      },
    };

    const prompt =
      "Image 1 is the 'Source Face'. Image 2 is the 'Target Scene'. Create a new image that is exactly Image 2, but replace the main character's face with the face from Image 1. Maintain the lighting, skin tone, expression, and art style of Image 2. High fidelity, seamless blend.";

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: { parts: [sourcePart, targetPart, { text: prompt }] },
    });

    const dataUrl = await extractImageDataUrl(response);
    res.json({ ok: true, dataUrl });
  } catch (err) {
    next(err);
  }
});

app.post("/api/ai/upscale", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const { imageDataUrl, scale, model } = UpscaleSchema.parse(req.body);
    const selectedModel = model || "imagen-3.0-generate-002";

    const imagePart = {
      inlineData: {
        mimeType: "image/png",
        data: cleanBase64(imageDataUrl),
      },
    };

    const prompt = `Highly detailed, ${scale}x super-resolution version of this image. Enhance texture, sharpen edges, de-noise, 8k resolution. Do not change the composition or subject matter; only increase fidelity.`;

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: { parts: [imagePart, { text: prompt }] },
    });

    const dataUrl = await extractImageDataUrl(response);
    res.json({ ok: true, dataUrl });
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
