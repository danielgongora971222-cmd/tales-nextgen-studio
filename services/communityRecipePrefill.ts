import { AppRoute } from "../types";

export type CommunityRecipePrefillPayload = {
  listingId: string;
  recipe: any;
  recipeHash?: string | null;
  createdAt?: number | null;
  resolvedAssets?: any[];
};

type PrefillTarget = {
  route: AppRoute;
  key: string;
  event: string;
};

const TOOL_TARGETS: Record<string, PrefillTarget> = {
  "image-generator": {
    route: AppRoute.TOOL_GENERATOR,
    key: "tales.prefill.imageGenerator",
    event: "tales:prefill-image-generator",
  },
  "editor-pro": {
    route: AppRoute.TOOL_EDITOR,
    key: "tales.prefill.editorPro",
    event: "tales:prefill-editor-pro",
  },
  "video-generator": {
    route: AppRoute.TOOL_VIDEO_GENERATOR,
    key: "tales.prefill.videoGenerator",
    event: "tales:prefill-video-generator",
  },
  "video-edit": {
    route: AppRoute.TOOL_VIDEO_EDIT,
    key: "tales.prefill.videoEdit",
    event: "tales:prefill-video-edit",
  },
  "ingredients-to-video": {
    route: AppRoute.TOOL_INGREDIENTS_TO_VIDEO,
    key: "tales.prefill.ingredientsToVideo",
    event: "tales:prefill-ingredients-to-video",
  },
  "extend-video": {
    route: AppRoute.TOOL_EXTEND_VIDEO,
    key: "tales.prefill.extendVideo",
    event: "tales:prefill-extend-video",
  },
  "motion-control": {
    route: AppRoute.TOOL_MOTION_CONTROL,
    key: "tales.prefill.motionControl",
    event: "tales:prefill-motion-control",
  },
};

export function normalizePrefillToolId(toolId: unknown): string {
  const raw = String(toolId || "").trim().toLowerCase();
  if (!raw) return "image-generator";
  if (raw === "editor" || raw === "editor-pro") return "editor-pro";
  if (raw === "generator" || raw === "image-generator") return "image-generator";
  if (raw === "video" || raw === "video-generator") return "video-generator";
  return raw;
}

export function getCommunityPrefillTarget(toolId: unknown): PrefillTarget {
  const normalized = normalizePrefillToolId(toolId);
  return TOOL_TARGETS[normalized] || TOOL_TARGETS["image-generator"];
}

export function writeCommunityRecipePrefill(toolId: unknown, payload: CommunityRecipePrefillPayload): PrefillTarget {
  const target = getCommunityPrefillTarget(toolId);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(target.key, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent(target.event));
  }
  return target;
}

export function readCommunityRecipePrefill(toolId: unknown): CommunityRecipePrefillPayload | null {
  const target = getCommunityPrefillTarget(toolId);
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(target.key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CommunityRecipePrefillPayload;
  } catch {
    window.localStorage.removeItem(target.key);
    return null;
  }
}

export function clearCommunityRecipePrefill(toolId: unknown) {
  if (typeof window === "undefined") return;
  const target = getCommunityPrefillTarget(toolId);
  window.localStorage.removeItem(target.key);
}
