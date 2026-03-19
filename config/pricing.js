// config/pricing.js
// Fuente única de verdad para pricing de créditos (UI + backend).
// Regla global del negocio:
// - 1 USD = 222 créditos
// - Cada generación se cobra con +35% sobre el coste base del proveedor
//   (markup operativo configurable debajo)

export const CREDITS_PER_USD = 222;
export const OWNER_MARKUP_RATE = 0.35;
export const PROVIDER_TO_SELLING_MULTIPLIER = 1 + OWNER_MARKUP_RATE;
export const VIDEO_PRICE_UPLIFT_MULTIPLIER = 1.15;

function clampInt(n, min, max, fallback = min) {
  const x = Math.trunc(Number(n));
  if (Number.isNaN(x)) return fallback;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function clampNumber(n, min, max, fallback = min) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function roundCreditsFromUsd(usd) {
  const value = Number(usd || 0);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.ceil(value * CREDITS_PER_USD * PROVIDER_TO_SELLING_MULTIPLIER));
}

function normalizeImageQuality(quality) {
  const q = String(quality || "1K").toUpperCase().trim();
  if (q === "2K") return "2K";
  if (q === "4K") return "4K";
  return "1K";
}

function normalizeAspectRatio(aspectRatio) {
  const ar = String(aspectRatio || "auto").trim().toLowerCase();
  if (["1:1", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "16:9", "9:16", "21:9"].includes(ar)) return ar;
  return "auto";
}

function normalizeVideoResolution(resolution) {
  const r = String(resolution || "720p").trim().toLowerCase();
  if (r === "1080p") return "1080p";
  if (r === "4k") return "4k";
  return "720p";
}

function normalizeVideoModelId(raw) {
  const v = String(raw || "").trim().replace(/^models\//i, "");
  if (v === "kling-v3-0" || v === "kling-v3.0") return "kling-v3";
  if (v === "kling-v2.6") return "kling-v2-6";
  if (v === "kling-video-o3") return "kling-o3-pro";
  if (v === "kling-v3-omni") return "kling-v3";
  if (v === "veo-3.0") return "veo-3.0-generate-001";
  if (v === "veo-3.1") return "veo-3.1-generate-preview";
  return v;
}

const IMAGE_OUTPUT_MEGAPIXELS = Object.freeze({
  "1K": 1024 * 1024 / 1_000_000,
  "2K": 1536 * 1536 / 1_000_000,
  "4K": 2048 * 2048 / 1_000_000,
});

function imageMegapixelsForQuality(quality) {
  const q = normalizeImageQuality(quality);
  return IMAGE_OUTPUT_MEGAPIXELS[q] || IMAGE_OUTPUT_MEGAPIXELS["1K"];
}

function qualityMultiplier(quality) {
  const q = normalizeImageQuality(quality);
  if (q === "2K") return 1.5;
  if (q === "4K") return 2;
  return 1;
}

function openAiAspectBucket(aspectRatio) {
  const ar = normalizeAspectRatio(aspectRatio);
  if (ar === "3:2") return "1536x1024";
  if (ar === "2:3") return "1024x1536";
  return "1024x1024";
}

function openAiImageUsd({ aspectRatio, tier }) {
  const size = openAiAspectBucket(aspectRatio);
  const qualityTier = String(tier || "medium").trim().toLowerCase();

  if (qualityTier === "high") {
    if (size === "1024x1536") return 0.2;
    if (size === "1536x1024") return 0.199;
    return 0.133;
  }

  if (qualityTier === "low") {
    if (size === "1024x1536" || size === "1536x1024") return 0.0135;
    return 0.009;
  }

  // `openai:gpt-image-1.5` usa quality=auto; para pricing lo tratamos como MEDIUM.
  if (size === "1024x1536" || size === "1536x1024") return 0.051;
  return 0.034;
}

function klingImageUsd(quality) {
  return normalizeImageQuality(quality) === "4K" ? 0.056 : 0.028;
}

function flux2MaxUsd(quality) {
  const mp = imageMegapixelsForQuality(quality);
  return 0.07 + Math.max(0, mp - 1) * 0.03;
}

function flux2ProUsd(quality) {
  const mp = imageMegapixelsForQuality(quality);
  return 0.03 + Math.max(0, mp - 1) * 0.015;
}

function flux2FlexUsd(quality) {
  const mp = imageMegapixelsForQuality(quality);
  // Fal factura por MP en input y output. Sin conocer refs exactas en todas las pantallas,
  // usamos el output como baseline estable para no romper UX/backend con estados extra.
  return mp * 0.05;
}

function fixedImageUnitCredits({ model, quality } = {}) {
  const selectedModel = String(model || "").trim();
  const q = normalizeImageQuality(quality);

  if (!selectedModel) return null;

  // Cambio solicitado:
  // - Nano Banana conserva ahora el precio que antes tenía Nano Banana 2.
  // - Nano Banana 2 se iguala a Nano Banana Pro.
  if (selectedModel === "gemini-2.5-flash-image") {
    return 24;
  }

  if (
    selectedModel === "gemini-3.1-flash-image-preview" ||
    selectedModel === "gemini-3-pro-image-preview"
  ) {
    if (q === "4K") return 90;
    if (q === "2K") return 68;
    return 45;
  }

  if (selectedModel === "fal-ai/flux-2-max" || selectedModel.startsWith("fal-ai/flux-2-max")) {
    if (q === "4K") return 250;
    if (q === "2K") return 222;
    return 175;
  }

  if (
    selectedModel === "fal-ai/flux-2-pro" ||
    selectedModel.startsWith("fal-ai/flux-2-pro") ||
    selectedModel === "fal-ai/flux-2-flex" ||
    selectedModel.startsWith("fal-ai/flux-2-flex")
  ) {
    if (q === "4K") return 200;
    if (q === "2K") return 178;
    return 140;
  }

  if (
    selectedModel === "kling:kling-image-o1" ||
    selectedModel === "kling-image-o1" ||
    selectedModel === "fal-ai/kling-image/v3/text-to-image" ||
    selectedModel === "fal-ai/kling-image/v3/image-to-image" ||
    selectedModel === "fal-ai/kling-image/o3/image-to-image" ||
    selectedModel.startsWith("fal-ai/kling-image/")
  ) {
    return 45;
  }

  return null;
}

function imageUnitUsd({ model, quality, aspectRatio }) {
  const selectedModel = String(model || "").trim();
  const q = normalizeImageQuality(quality);

  if (!selectedModel) {
    return 0.08 * qualityMultiplier(q);
  }

  if (selectedModel === "gemini-2.5-flash-image") {
    return 0.039;
  }

  if (selectedModel === "gemini-3.1-flash-image-preview") {
    return 0.08 * qualityMultiplier(q);
  }

  if (selectedModel === "gemini-3-pro-image-preview") {
    return 0.15 * qualityMultiplier(q);
  }

  if (selectedModel === "imagen-3.0-generate-002" || selectedModel.includes("imagen-3")) {
    return 0.05;
  }

  if (selectedModel === "openai:gpt-image-1.5") {
    return openAiImageUsd({ aspectRatio, tier: "medium" });
  }

  if (selectedModel === "openai:gpt-image-1.5-high") {
    return openAiImageUsd({ aspectRatio, tier: "high" });
  }

  if (selectedModel === "fal-ai/flux-2-max") {
    return flux2MaxUsd(q);
  }

  if (selectedModel === "fal-ai/flux-2-pro") {
    return flux2ProUsd(q);
  }

  if (selectedModel === "fal-ai/flux-2-flex") {
    return flux2FlexUsd(q);
  }

  if (
    selectedModel === "kling:kling-image-o1" ||
    selectedModel === "kling-image-o1" ||
    selectedModel === "fal-ai/kling-image/v3/text-to-image" ||
    selectedModel === "fal-ai/kling-image/v3/image-to-image" ||
    selectedModel === "fal-ai/kling-image/o3/image-to-image"
  ) {
    return klingImageUsd(q);
  }

  if (selectedModel === "fal-ai/qwen-image-edit-2511-multiple-angles") {
    return imageMegapixelsForQuality(q) * 0.035;
  }

  if (selectedModel.startsWith("openai:")) {
    return openAiImageUsd({ aspectRatio, tier: selectedModel.includes("high") ? "high" : "medium" });
  }

  if (selectedModel.startsWith("fal-ai/flux-2-max")) {
    return flux2MaxUsd(q);
  }

  if (selectedModel.startsWith("fal-ai/flux-2-pro")) {
    return flux2ProUsd(q);
  }

  if (selectedModel.startsWith("fal-ai/flux-2-flex")) {
    return flux2FlexUsd(q);
  }

  if (selectedModel.startsWith("fal-ai/kling-image/")) {
    return klingImageUsd(q);
  }

  // Fallback prudente para modelos de imagen no catalogados aún.
  return 0.08 * qualityMultiplier(q);
}

export function estimateImageUnitCredits({ model, quality, aspectRatio } = {}) {
  const fixedCredits = fixedImageUnitCredits({ model, quality });
  if (fixedCredits != null) return fixedCredits;

  return roundCreditsFromUsd(imageUnitUsd({ model, quality, aspectRatio }));
}

export function estimateImageCostCredits({ model, quality, count, aspectRatio } = {}) {
  const n = Math.max(1, Number(count || 1));
  const fixedCredits = fixedImageUnitCredits({ model, quality });
  if (fixedCredits != null) return Math.max(1, Math.ceil(fixedCredits * n));

  const usd = imageUnitUsd({ model, quality, aspectRatio }) * n;
  return roundCreditsFromUsd(usd);
}

function klingModeOrDefault(modelNorm, klingMode) {
  const mode = String(klingMode || "").trim().toLowerCase();
  if (mode === "pro") return "pro";
  if (mode === "std") return "std";
  if (String(modelNorm || "").includes("motion-control-pro")) return "pro";
  if (String(modelNorm || "").includes("-pro") && !String(modelNorm || "").includes("ref-video-to-video") && !String(modelNorm || "").includes("edit-video")) {
    return "pro";
  }
  return "std";
}

const MOTION_CONTROL_STD_CREDITS_PER_SECOND = 650 / 15;
const MOTION_CONTROL_26_STD_CREDITS_PER_SECOND = 35;
const MOTION_CONTROL_PRO_CREDITS_PER_SECOND = 55;

function fixedVideoTotalCredits({
  modelNorm,
  durationSeconds,
  resolution,
  klingMode,
} = {}) {
  const model = normalizeVideoModelId(modelNorm);
  const seconds = clampNumber(durationSeconds != null ? durationSeconds : 0, 0.01, 3600, 0);
  if (!seconds) return null;

  const reso = normalizeVideoResolution(resolution);
  const mode = klingModeOrDefault(model, klingMode);
  const prefersStdLikePricing = mode === "std" || reso === "720p";
  const prefersProLikePricing = mode === "pro" || reso === "1080p";

  let perSecondCredits = null;

  switch (model) {
    case "kling-v3-motion-control":
      perSecondCredits = MOTION_CONTROL_STD_CREDITS_PER_SECOND;
      break;
    case "kling-v3-motion-control-pro":
      perSecondCredits = MOTION_CONTROL_PRO_CREDITS_PER_SECOND;
      break;
    case "kling-2.6-motion-control":
      perSecondCredits = MOTION_CONTROL_26_STD_CREDITS_PER_SECOND;
      break;
    case "kling-2.6-motion-control-pro":
      perSecondCredits = MOTION_CONTROL_STD_CREDITS_PER_SECOND;
      break;
    case "kling-o3-edit-video-pro":
    case "kling-o3-ref-video-to-video-pro":
      if (prefersStdLikePricing && !prefersProLikePricing) {
        perSecondCredits = MOTION_CONTROL_STD_CREDITS_PER_SECOND;
      } else {
        perSecondCredits = MOTION_CONTROL_PRO_CREDITS_PER_SECOND;
      }
      break;
    default:
      return null;
  }

  if (!Number.isFinite(perSecondCredits) || perSecondCredits <= 0) return null;
  return Math.max(1, Math.ceil(seconds * perSecondCredits));
}

function videoUnitUsd({
  modelNorm,
  durationSeconds,
  resolution,
  generateAudio,
  klingMode,
  voiceControl,
} = {}) {
  const model = normalizeVideoModelId(modelNorm);
  const dur = clampInt(durationSeconds != null ? durationSeconds : 5, 1, 60, 5);
  const reso = normalizeVideoResolution(resolution);
  const audioOn = Boolean(generateAudio);
  const mode = klingModeOrDefault(model, klingMode);
  const hasVoiceControl = Boolean(voiceControl);

  let perSecondUsd = 0;

  switch (model) {
    case "veo-3.0-generate-001":
      perSecondUsd = audioOn ? 0.4 : 0.2;
      break;
    case "veo-3.0-fast-generate-001":
      perSecondUsd = audioOn ? 0.15 : 0.1;
      break;
    case "veo-3.1-generate-preview":
      if (reso === "4k") perSecondUsd = audioOn ? 0.6 : 0.4;
      else perSecondUsd = audioOn ? 0.4 : 0.2;
      break;
    case "veo-3.1-fast-generate-preview":
      if (reso === "4k") perSecondUsd = audioOn ? 0.35 : 0.3;
      else perSecondUsd = audioOn ? 0.15 : 0.1;
      break;
    case "kling-v2-5-turbo":
      perSecondUsd = 0.07;
      break;
    case "kling-v2-6":
      if (hasVoiceControl) perSecondUsd = 0.168;
      else perSecondUsd = audioOn ? 0.14 : 0.07;
      break;
    case "kling-v3":
      if (mode === "pro") {
        if (hasVoiceControl) perSecondUsd = 0.196;
        else perSecondUsd = audioOn ? 0.168 : 0.112;
      } else {
        if (hasVoiceControl) perSecondUsd = 0.154;
        else perSecondUsd = audioOn ? 0.126 : 0.084;
      }
      break;
    case "kling-o3-pro":
      perSecondUsd = mode === "pro"
        ? (audioOn ? 0.14 : 0.112)
        : (audioOn ? 0.112 : 0.084);
      break;
    case "kling-o3-ref-to-video-pro":
      perSecondUsd = audioOn ? 0.14 : 0.112;
      break;
    case "kling-o3-edit-video-pro":
    case "kling-o3-ref-video-to-video-pro":
      perSecondUsd = 0.168;
      break;
    case "kling-v3-motion-control":
      perSecondUsd = 0.126;
      break;
    case "kling-v3-motion-control-pro":
      perSecondUsd = 0.168;
      break;
    case "seedance-2-preview":
      perSecondUsd = 0.15;
      break;
    case "seedance-2-fast-preview":
      perSecondUsd = 0.08;
      break;
    case "kling-2.6-motion-control":
      perSecondUsd = 0.07;
      break;
    case "kling-2.6-motion-control-pro":
      perSecondUsd = 0.112;
      break;
    default: {
      const looksKling = model.includes("kling");
      perSecondUsd = looksKling ? 0.084 : 0.2;
      break;
    }
  }

  return perSecondUsd * dur;
}

export function estimateVideoCostCredits({
  modelNorm = undefined,
  durationSeconds = undefined,
  resolution = undefined,
  generateAudio = undefined,
  klingMode = undefined,
  voiceControl = undefined,
  count = 1,
  isKling = undefined, // compat legacy (ya no hace falta, pero lo aceptamos)
} = {}) {
  const n = clampInt(count || 1, 1, 8, 1);

  const fixedCredits = fixedVideoTotalCredits({
    modelNorm,
    durationSeconds,
    resolution,
    klingMode,
  });
  if (fixedCredits != null) {
    return Math.max(1, Math.ceil(fixedCredits * n));
  }

  const usd = videoUnitUsd({
    modelNorm,
    durationSeconds,
    resolution,
    generateAudio,
    klingMode,
    voiceControl,
    isKling,
  }) * VIDEO_PRICE_UPLIFT_MULTIPLIER * n;

  return roundCreditsFromUsd(usd);
}

const FACESWAP_ANALYSIS_STAGES = 3;

export function estimateFaceSwapCostCredits({ quality = "2K", phase = "full" } = {}) {
  const q = normalizeImageQuality(quality);
  const analysisCredits = estimateImageCostCredits({
    model: "gemini-3.1-flash-image-preview",
    quality: q,
    count: FACESWAP_ANALYSIS_STAGES,
  });
  const insertCredits = estimateImageCostCredits({
    model: "gemini-3-pro-image-preview",
    quality: q,
    count: 1,
  });

  if (phase === "analysis") return analysisCredits;
  if (phase === "insert") return insertCredits;
  return analysisCredits + insertCredits;
}

function upscaleQualityFromScale(scale, fallbackQuality) {
  if (fallbackQuality) return normalizeImageQuality(fallbackQuality);
  const s = clampInt(scale || 2, 2, 8, 2);
  if (s >= 4) return "4K";
  return "2K";
}

export function estimateUpscaleCostCredits({ model, quality, scale } = {}) {
  const effectiveQuality = upscaleQualityFromScale(scale, quality);
  return estimateImageCostCredits({ model, quality: effectiveQuality, count: 1 });
}
