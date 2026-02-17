import { GeminiModel } from "../types";
import { backend } from "./backendService";
import { supabase } from "./supabaseClient";

type ApiResponse<T> = { ok: true; dataUrl?: string; videoUrl?: string } | { ok: false; error: string };

async function apiPost<T>(path: string, body: any): Promise<T> {
  const url = path; // SIEMPRE /api/... (Vercel hará el rewrite en prod)

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // ✅ No asumas que siempre es JSON (502/HTML, etc.)
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  // ---- helpers para formatear details (Zod) ----
  const formatDetails = (details: any): string => {
    if (!details) return "";

    // Zod issues típicos: [{ path: [...], message: "..." }, ...]
    if (Array.isArray(details)) {
      const lines = details.map((d) => {
        const path = Array.isArray(d?.path) ? d.path.join(".") : "";
        const msg = d?.message ? String(d.message) : JSON.stringify(d);
        return path ? `- ${path}: ${msg}` : `- ${msg}`;
      });
      return lines.length ? `\n\nDetalles:\n${lines.join("\n")}` : "";
    }

    // Objeto cualquiera
    if (typeof details === "object") {
      return `\n\nDetalles:\n${JSON.stringify(details, null, 2)}`;
    }

    return `\n\nDetalles:\n${String(details)}`;
  };

  if (!resp.ok || data?.ok === false) {
    // backend suele devolver { ok:false, error:{ code, message, details } } o error string
    const e = data?.error ?? data;

    let msg = `Request failed: ${resp.status}`;

    if (typeof e === "string") {
      msg = e;
    } else if (e && typeof e === "object") {
      const code = e.code ? `${e.code}: ` : "";
      const message =
        e.message ||
        e.error ||
        (resp.statusText ? resp.statusText : "Unknown error");

      msg = `${code}${message}${formatDetails(e.details)}`;
    } else if (!data && resp.statusText) {
      msg = `Request failed: ${resp.status} ${resp.statusText}`;
    }

    throw new Error(msg);
  }

  return data as T;
}

export const generateImage = async (
  prompt: string,
  model: string = GeminiModel.IMAGE,
  options?: { aspectRatio?: string }
): Promise<string> => {
  const res: any = await apiPost("/api/ai/image", {
    prompt,
    model,
    aspectRatio: options?.aspectRatio,
  });
  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return out;
};

export type ImageGenQuality = "1K" | "2K" | "4K";
export type ImageGenItem = { url: string; assetId: string };

export type GenerateImageBatchOptions = {
  aspectRatio?: string;
  count?: number;
  quality?: ImageGenQuality;
  tool?: string;
  nameHint?: string;
  // Kling-only (Element Library)
  klingElementIds?: string[];

  // refs (IDs de assets guardados en tu DB)
  characterAssetIds?: string[];
  styleAssetId?: string;
  backgroundAssetId?: string;

  // ✅ Camera Angles (Qwen Multiple Angles, Fal.ai)
  horizontalAngle?: number; // 0..360
  verticalAngle?: number;   // -30..90
  zoom?: number;            // 0..10
  loraScale?: number;       // 0..4
};

export type GenerateImageBatchResult = {
  items: ImageGenItem[];
  urlExpiresInSeconds?: number;
};

export const generateImageBatch = async (
  prompt: string,
  model: string = GeminiModel.IMAGE,
  options?: GenerateImageBatchOptions
): Promise<GenerateImageBatchResult> => {
  const res: any = await apiPost("/api/ai/image", {
  prompt,
  model,
  aspectRatio: options?.aspectRatio,
  count: options?.count,
  quality: options?.quality,
  tool: options?.tool,
  nameHint: options?.nameHint,
  characterAssetIds: options?.characterAssetIds,
  styleAssetId: options?.styleAssetId,
  backgroundAssetId: options?.backgroundAssetId,

  // ✅ Camera Angles
  horizontalAngle: options?.horizontalAngle,
  verticalAngle: options?.verticalAngle,
  zoom: options?.zoom,
  loraScale: options?.loraScale,

  // Kling-only
  klingElementIds: options?.klingElementIds,
});

  const items: ImageGenItem[] = Array.isArray(res?.items) ? res.items : [];

  // fallback por si el backend devolviera solo una url (compat)
  if (!items.length) {
    const out = res.url || res.dataUrl;
    if (!out) throw new Error("No image returned from API.");
    return {
      items: [{ url: out, assetId: res.assetId || "unknown" }],
      urlExpiresInSeconds: res.urlExpiresInSeconds,
    };
  }

  return { items, urlExpiresInSeconds: res.urlExpiresInSeconds };
};

export const generateRestyle = async (assetUrl: string, prompt: string): Promise<string> => {
  const imageDataUrl = await backend.getAssetData(assetUrl);
  const res: any = await apiPost("/api/ai/restyle", {
    imageDataUrl,
    prompt,
    model: GeminiModel.IMAGE,
  });
  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return out;
};

// NOTE: "clothes_only" = Solo Ropa (mantiene identidad del base; solo reemplaza ropa en Paso 2)
export type FaceSwapType = "face" | "face_hair" | "body" | "body_clothes" | "clothes_only";

export type FaceSwapResult = { url: string; assetId: string; urlExpiresInSeconds?: number };

export const faceswapStep1MakeMannequin = async (params: {
  targetAssetId: string;
  swapType: FaceSwapType;
  quality: ImageGenQuality;
}): Promise<FaceSwapResult> => {
  const res: any = await apiPost("/api/ai/faceswap/mannequin", {
    targetAssetId: params.targetAssetId,
    swapType: params.swapType,
    quality: params.quality,
  });

  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return { url: out, assetId: res.assetId || "unknown", urlExpiresInSeconds: res.urlExpiresInSeconds };
};

export const faceswapStep2InsertFromElement = async (params: {
  baseAssetId: string;
  donorElementId: string;
  swapType: FaceSwapType;
  quality: ImageGenQuality;
}): Promise<FaceSwapResult> => {
  const res: any = await apiPost("/api/ai/faceswap/insert", {
    baseAssetId: params.baseAssetId,
    donorElementId: params.donorElementId,
    swapType: params.swapType,
    quality: params.quality,
  });

  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return { url: out, assetId: res.assetId || "unknown", urlExpiresInSeconds: res.urlExpiresInSeconds };
};


export const generateUpscale = async (assetUrl: string, scale: number): Promise<string> => {
  const imageDataUrl = await backend.getAssetData(assetUrl);
  const res: any = await apiPost("/api/ai/upscale", {
    imageDataUrl,
    scale,
    model: GeminiModel.IMAGE,
  });
  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return out;
};

export const generateVideo = async (_prompt: string): Promise<string> => {
  // Intentionally disabled until backend implements secure streaming/storage.
  throw new Error(
    "Video generation is temporarily disabled until the backend implements secure streaming/storage (so we don't expose API keys in the browser)."
  );
};
