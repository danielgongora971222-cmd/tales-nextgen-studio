import { SEEDANCE_2_PREVIEW } from "./ids";
import { clampInt, normalizeModelId, coerceAllowedString } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, VideoModelHandler } from "./types";

const SEEDANCE_PREVIEW_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const SEEDANCE_PREVIEW_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const SEEDANCE_PREVIEW_MAX_REFS = 9;

export const seedancePreviewHandler: VideoModelHandler = {
  label: "Seedance 2.0 Cinema",
  matches: (m) => m === SEEDANCE_2_PREVIEW,

  getCapability: () => ({
    supportsResolution: false,
    supportsAspectRatio: true,
    supportsAspectRatio1x1: true,
    durations: SEEDANCE_PREVIEW_DURATIONS,
    supportsSound: false,
    supportsLastFrame: false,
  }),

  getSupportedResolutions: () => ["720p"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    const prompt = String(args.prompt || "").trim();
    if (!prompt) throw new Error("Escribe un prompt.");

    const durationSeconds = clampInt(args.durationSeconds, 4, 15, 5);
    const referenceImageAssetIds = Array.isArray(args.referenceImageAssetIds)
      ? args.referenceImageAssetIds.filter(Boolean).slice(0, SEEDANCE_PREVIEW_MAX_REFS)
      : [];

    const body: any = {
      prompt,
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: 1,
      durationSeconds,
      aspectRatio: coerceAllowedString(args.aspectRatio, SEEDANCE_PREVIEW_ASPECT_RATIOS, "16:9"),
      referenceImageAssetIds,
    };

    return {
      modelNorm,
      pendingSlotsCount: body.count,
      effectivePrompt: body.prompt,
      effectiveDurationSeconds: durationSeconds,
      body,
    };
  },

  submit: async () => {
    throw new Error("Seedance Preview usa la cola de generación y no se envía desde el handler directamente.");
  },
};
