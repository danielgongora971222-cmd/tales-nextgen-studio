import { SEEDANCE_2_PRO, SEEDANCE_2_STANDARD } from "./ids";
import { clampInt, normalizeModelId, coerceAllowedNumber, coerceAllowedString } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, VideoModelHandler } from "./types";

const SEEDANCE_DURATIONS = [5, 10] as const;

export const seedanceHandler: VideoModelHandler = {
  label: "Seedance 2.0",
  matches: (m) => m === SEEDANCE_2_PRO || m === SEEDANCE_2_STANDARD,

  getCapability: () => ({
    supportsResolution: false,
    supportsAspectRatio: true,
    supportsAspectRatio1x1: true,
    durations: SEEDANCE_DURATIONS,
    supportsSound: false,
    supportsLastFrame: true,
  }),

  getSupportedResolutions: () => ["720p"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    if (!String(args.prompt || "").trim()) throw new Error("Escribe un prompt.");

    const hasFirst = Boolean(args.firstFrameAssetId);
    if (!hasFirst && args.lastFrameAssetId) {
      throw new Error("Last frame requiere first frame.");
    }

    const body: any = {
      prompt: String(args.prompt || "").trim(),
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: clampInt(args.count, 1, 1, 1),
      durationSeconds: coerceAllowedNumber(args.durationSeconds, SEEDANCE_DURATIONS, 5),
      aspectRatio: coerceAllowedString(args.aspectRatio, ["16:9", "9:16", "1:1"] as const, "16:9"),
    };

    if (args.firstFrameAssetId) body.firstFrameAssetId = args.firstFrameAssetId;
    if (args.lastFrameAssetId) body.lastFrameAssetId = args.lastFrameAssetId;

    return {
      modelNorm,
      pendingSlotsCount: body.count,
      effectivePrompt: body.prompt,
      effectiveDurationSeconds: body.durationSeconds,
      body,
    };
  },

  submit: async () => {
    throw new Error("Seedance usa la cola de generación y no se envía desde el handler directamente.");
  },
};
