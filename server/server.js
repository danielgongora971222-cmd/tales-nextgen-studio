import express from "express";
import cors from "cors";
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

// IMPORTANT: base64 payloads are large; adjust limits carefully.
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    service: "tales-nextgen-studio-api",
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
  if (!ai) throw new Error("AI not configured (missing GEMINI_API_KEY).");
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

app.post("/api/ai/image", async (req, res) => {
  try {
    const aiClient = await ensureAI();
    const { prompt, model, aspectRatio } = ImageRequestSchema.parse(req.body);

    // Defaults match your frontend enums
    const selectedModel = model || "imagen-3.0-generate-002";
    const config = {};
    if (aspectRatio && selectedModel.includes("imagen")) {
      // Imagen supports aspectRatio in imageConfig (only for some models)
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
    const message = err?.message || "Unknown error";
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/ai/restyle", async (req, res) => {
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
    const message = err?.message || "Unknown error";
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/ai/faceswap", async (req, res) => {
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
    const message = err?.message || "Unknown error";
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/ai/upscale", async (req, res) => {
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
    const message = err?.message || "Unknown error";
    res.status(400).json({ ok: false, error: message });
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

app.listen(PORT, () => {
  console.log(`[API] listening on http://0.0.0.0:${PORT}`);
});
