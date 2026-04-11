// services/videoModels/index.ts
export * from "./ids";
export * from "./types";
export * from "./utils";

import type { Resolution, VideoCapability } from "./types";
import {
  DEFAULT_VIDEO_MODEL,
  KLING_2_5_TURBO,
  KLING_2_6,
  KLING_V3,
  KLING_O3_PRO,
  SEEDANCE_2,
  SEEDANCE_2_FAST,
  SEEDANCE_2_PREVIEW,
  SEEDANCE_2_FAST_PREVIEW,
  SEEDANCE_2_PREVIEW_VIP,
  SEEDANCE_2_MAX,
  VEO_3,
  VEO_3_1,
  VEO_3_1_FAST,
} from "./ids";
import { normalizeModelId } from "./utils";

import { veo3Handler } from "./veo3";
import { veo31Handler } from "./veo31";
import { kling25Handler } from "./kling25";
import { kling26Handler } from "./kling26";
import { klingV3Handler } from "./klingV3";
import { klingO3ProHandler } from "./klingO3Pro";
import { seedanceHandler } from "./seedance";
import { seedancePreviewHandler } from "./seedancePreview";

const HANDLERS = [seedancePreviewHandler, seedanceHandler, klingO3ProHandler, klingV3Handler, kling26Handler, kling25Handler, veo31Handler, veo3Handler];

export function getVideoModelHandler(modelRaw: string) {
  const modelNorm = normalizeModelId(modelRaw);
  return HANDLERS.find((h) => h.matches(modelNorm)) ?? veo31Handler;
}

export function prettyVideoModelLabel(modelId: string | null) {
  const m = modelId ? normalizeModelId(modelId) : "";
  if (!m) return "—";
  if (m === VEO_3) return "Veo 3";
  if (m === VEO_3_1 || m === VEO_3_1_FAST) return "Veo 3.1";
  if (m === KLING_2_5_TURBO) return "Kling 2.5 Turbo";
  if (m === KLING_2_6) return "Kling 2.6";
  if (m === KLING_V3) return "Kling V3";
  if (m === KLING_O3_PRO) return "Kling O3 Pro";
  if (m === SEEDANCE_2) return "Seedance 2";
  if (m === SEEDANCE_2_FAST) return "Seedance 2 Fast";
  if (m === SEEDANCE_2_PREVIEW) return "Seedance 2.0 Cinema";
  if (m === SEEDANCE_2_FAST_PREVIEW) return "Seedance 2.0 Cinema Fast";
  if (m === SEEDANCE_2_PREVIEW_VIP) return "Seedance 2.0 Pro";
  if (m === SEEDANCE_2_MAX) return "Seedance 2.0 Max";
  if (m === "kling-o3-ref-to-video-pro") return "Kling O3 Pro — Reference to Video";
  if (m === "kling-o3-edit-video-pro") return "Kling O3 Pro — Edit Video";
  if (m === "kling-o3-ref-video-to-video-pro") return "Kling O3 Pro — Reference Video→Video";
  return m;
}

export function coerceResolutionForModel(
  modelRaw: string,
  capability: VideoCapability,
  resolution: Resolution
): Resolution {
  const m = normalizeModelId(modelRaw);
  if (!capability.supportsResolution) return "720p";
  if (m.startsWith("veo-3.0") && resolution === "4k") return "1080p";
  return resolution;
}

export function coerceAspectRatioForModel(
  modelRaw: string,
  capability: VideoCapability,
  hasFirst: boolean,
  resolution: Resolution,
  aspectRatio: any
): any {
  const m = normalizeModelId(modelRaw);
  const isSeedance = m === SEEDANCE_2 || m === SEEDANCE_2_FAST || m === SEEDANCE_2_PREVIEW || m === SEEDANCE_2_FAST_PREVIEW || m === SEEDANCE_2_PREVIEW_VIP || m === SEEDANCE_2_MAX;

  if (m.startsWith("veo-3.0") && !hasFirst && resolution === "1080p" && aspectRatio === "9:16") {
    return "16:9";
  }

  if (m === SEEDANCE_2_PREVIEW_VIP) {
    return (["16:9", "4:3", "3:4", "9:16"] as const).includes(aspectRatio as any)
      ? aspectRatio
      : "16:9";
  }

  if (isSeedance) {
    return (["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const).includes(aspectRatio as any)
      ? aspectRatio
      : "16:9";
  }

  if (aspectRatio === "21:9") return "16:9";
  if (aspectRatio === "4:3") return "16:9";
  if (aspectRatio === "3:4") return "9:16";
  if (!capability.supportsAspectRatio1x1 && aspectRatio === "1:1") return "16:9";

  return aspectRatio;
}

export function coerceModelForLastFrame(modelRaw: string, hasLast: boolean): string {
  const m = normalizeModelId(modelRaw);
  if (!hasLast) return m;

  if (m.startsWith("veo-3.0")) {
    const wantsFast = m.includes("-fast-");
    return wantsFast ? VEO_3_1_FAST : VEO_3_1;
  }

  return m;
}

export { DEFAULT_VIDEO_MODEL };
