import { GeminiModel } from "../types";
import { backend } from "./backendService";
import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";
import { invalidateMyAssetsCache } from "./assetsApi";
import { waitJobCompletion, JobRow } from "./jobsApi";
import { emitInsufficientCredits, emitWalletRefresh } from "./appEvents";

type ApiResponse<T> = { ok: true; dataUrl?: string; videoUrl?: string } | { ok: false; error: string };

function formatJobFailure(row: JobRow): string {
  const p: any = (row as any)?.params || {};
  const code = p?.errorCode ? `${p.errorCode}: ` : "";
  const details =
    p?.errorDetails ? `\n\nDetalles:\n${JSON.stringify(p.errorDetails, null, 2)}` : "";
  return `${code}${row.error || "Job failed."}${details}`;
}

function jobRowToItems(row: JobRow): ImageGenItem[] {
  const p: any = (row as any)?.params || {};
  const urls: string[] = Array.isArray(p.resultUrls)
    ? p.resultUrls
    : p.resultUrl
      ? [p.resultUrl]
      : [];
  const ids: string[] = Array.isArray(p.resultAssetIds)
    ? p.resultAssetIds
    : row.result_asset_id
      ? [row.result_asset_id]
      : [];

  const items: ImageGenItem[] = [];
  for (let i = 0; i < urls.length; i++) {
    items.push({
      url: urls[i],
      assetId: ids[i] || ids[0] || row.result_asset_id || "unknown",
    });
  }
  return items;
}

async function waitImageJob(jobId: string, onProgress?: (msg: string) => void): Promise<JobRow> {
  const row = await waitJobCompletion(jobId, { onProgress });
  if (row.status === "failed") throw new Error(formatJobFailure(row));
  return row;
}


async function apiPost<T>(path: string, body: any): Promise<T> {
  const url = apiUrl(path);

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

    const code = e?.code;
    const details = e?.details || null;

    // "msg" ya tiene el texto final del error (incluye code + message + details)
    const err: any = new Error(msg);
    err.code = code;
    err.details = details;

    if (code === "INSUFFICIENT_CREDITS" && details) {
      emitInsufficientCredits(details);
    }

    throw err;
  }

  // Si esta llamada creó un asset nuevo en el backend, invalida cache para que
  // cualquier herramienta/picker vea el nuevo resultado sin recargar toda la página.
  // (ej: /api/ai/image, /api/ai/faceswap/*, /api/ai/upscale)
  try {
    const createsAsset =
      path.startsWith("/api/ai/") &&
      (Boolean((data as any)?.assetId) || Array.isArray((data as any)?.items));
    if (createsAsset) invalidateMyAssetsCache();
  } catch {}

  emitWalletRefresh();
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

  // ✅ Async (background job)
  if (res?.jobId) {
    const row = await waitImageJob(String(res.jobId));
    invalidateMyAssetsCache();

    const items = jobRowToItems(row);
    const out = items[0]?.url || (row as any)?.params?.resultUrl;
    if (!out) throw new Error("No image returned from job.");
    return out;
  }

  // ✅ Sync (compat)
  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return out;
};


export type ImageGenQuality = "1K" | "2K" | "4K";
export type ImageGenItem = { url: string; assetId: string };

// Token -> Asset binding for prompts that use @mentions (e.g. "add @logo to @img2").
// The backend uses this to order refs and adapt the prompt per provider/model.
export type PromptReferenceRole = "character" | "background" | "element";
export type PromptReference = {
  token: string;   // e.g. "@img1" | "@bg" | "@logo"
  assetId: string; // UUID from your assets table
  role: PromptReferenceRole;
};

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

  // ✅ Token bindings (robust @mentions)
  promptReferences?: PromptReference[];

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

    // ✅ @mentions bindings
    promptReferences: options?.promptReferences,

    // ✅ Camera Angles
    horizontalAngle: options?.horizontalAngle,
    verticalAngle: options?.verticalAngle,
    zoom: options?.zoom,
    loraScale: options?.loraScale,

    // Kling-only
    klingElementIds: options?.klingElementIds,
  });

  // ✅ Async (background job)
  if (res?.jobId) {
    const row = await waitImageJob(String(res.jobId));
    invalidateMyAssetsCache();

    const items = jobRowToItems(row);
    if (!items.length) throw new Error("No image returned from job.");

    const urlExpiresInSeconds =
      (row as any)?.params?.urlExpiresInSeconds ||
      (row as any)?.params?.expiresInSeconds ||
      res.urlExpiresInSeconds;

    return { items, urlExpiresInSeconds };
  }

  // ✅ Sync (compat)
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

  // ✅ Async (background job)
  if (res?.jobId) {
    const row = await waitImageJob(String(res.jobId));
    invalidateMyAssetsCache();

    const items = jobRowToItems(row);
    const first = items[0] || null;
    const out = first?.url || (row as any)?.params?.resultUrl;
    if (!out) throw new Error("No image returned from job.");

    return {
      url: out,
      assetId: first?.assetId || row.result_asset_id || "unknown",
      urlExpiresInSeconds: (row as any)?.params?.urlExpiresInSeconds,
    };
  }

  // ✅ Sync (compat)
  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return {
    url: out,
    assetId: res.assetId || "unknown",
    urlExpiresInSeconds: res.urlExpiresInSeconds,
  };
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

  // ✅ Async (background job)
  if (res?.jobId) {
    const row = await waitImageJob(String(res.jobId));
    invalidateMyAssetsCache();

    const items = jobRowToItems(row);
    const first = items[0] || null;
    const out = first?.url || (row as any)?.params?.resultUrl;
    if (!out) throw new Error("No image returned from job.");

    return {
      url: out,
      assetId: first?.assetId || row.result_asset_id || "unknown",
      urlExpiresInSeconds: (row as any)?.params?.urlExpiresInSeconds,
    };
  }

  // ✅ Sync (compat)
  const out = res.url || res.dataUrl;
  if (!out) throw new Error("No image returned from API.");
  return {
    url: out,
    assetId: res.assetId || "unknown",
    urlExpiresInSeconds: res.urlExpiresInSeconds,
  };
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
