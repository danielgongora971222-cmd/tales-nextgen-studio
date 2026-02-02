import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";


dotenv.config();

const PORT = Number(process.env.PORT || 8788);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("[WARN] GEMINI_API_KEY is not set. AI endpoints will fail until you set it.");
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

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

app.post("/api/ai/image", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const { prompt, model, aspectRatio } = ImageRequestSchema.parse(req.body);

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
    res.json({ ok: true, dataUrl });
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
