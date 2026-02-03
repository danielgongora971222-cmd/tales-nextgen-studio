import { GeminiModel } from "../types";
import { backend } from "./backendService";
import { supabase } from "./supabaseClient";

type ApiResponse<T> = { ok: true; dataUrl?: string; videoUrl?: string } | { ok: false; error: string };

async function apiPost<T>(path: string, body: any): Promise<T> {
  // In dev: Vite proxies /api -> local backend.
  // In prod (Vercel): set VITE_API_BASE_URL to your Render API base URL.
  // Example: https://tales-api.onrender.com
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

    const data = (await resp.json()) as any;

  if (!resp.ok || data?.ok === false) {
    const e = data?.error;

    let msg = `Request failed: ${resp.status}`;
    if (typeof e === "string") {
      msg = e;
    } else if (e && typeof e === "object") {
      const code = e.code ? `${e.code}: ` : "";
      const message = e.message ? e.message : JSON.stringify(e);
      msg = `${code}${message}`;
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

export const generateRestyle = async (assetUrl: string, prompt: string): Promise<string> => {
  const imageDataUrl = await backend.getAssetData(assetUrl);
  const res: any = await apiPost("/api/ai/restyle", {
    imageDataUrl,
    prompt,
    model: GeminiModel.IMAGE,
  });
  if (!res.dataUrl) throw new Error("No image returned from API.");
  return res.dataUrl;
};

export const generateFaceSwap = async (sourceUrl: string, targetUrl: string): Promise<string> => {
  const sourceDataUrl = await backend.getAssetData(sourceUrl);
  const targetDataUrl = await backend.getAssetData(targetUrl);

  const res: any = await apiPost("/api/ai/faceswap", {
    sourceDataUrl,
    targetDataUrl,
    model: GeminiModel.IMAGE,
  });
  if (!res.dataUrl) throw new Error("No image returned from API.");
  return res.dataUrl;
};

export const generateUpscale = async (assetUrl: string, scale: number): Promise<string> => {
  const imageDataUrl = await backend.getAssetData(assetUrl);
  const res: any = await apiPost("/api/ai/upscale", {
    imageDataUrl,
    scale,
    model: GeminiModel.IMAGE,
  });
  if (!res.dataUrl) throw new Error("No image returned from API.");
  return res.dataUrl;
};

export const generateVideo = async (_prompt: string): Promise<string> => {
  // Intentionally disabled until backend implements secure streaming/storage.
  throw new Error(
    "Video generation is temporarily disabled until the backend implements secure streaming/storage (so we don't expose API keys in the browser)."
  );
};
