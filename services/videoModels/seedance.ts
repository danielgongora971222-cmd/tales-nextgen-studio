import { SEEDANCE_2, SEEDANCE_2_FAST } from "./ids";
import { clampInt, normalizeModelId, coerceAllowedString } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, VideoModelHandler } from "./types";

const SEEDANCE_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const SEEDANCE_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

export const seedanceHandler: VideoModelHandler = {
  label: "Seedance 2",
  matches: (m) => m === SEEDANCE_2 || m === SEEDANCE_2_FAST,

  getCapability: ({ hasFirst }) => ({
    supportsResolution: false,
    supportsAspectRatio: !hasFirst,
    supportsAspectRatio1x1: true,
    durations: SEEDANCE_DURATIONS,
    supportsSound: false,
    supportsLastFrame: true,
  }),

  getSupportedResolutions: () => ["720p"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    const prompt = String(args.prompt || "").trim();
    if (!prompt) throw new Error("Escribe un prompt.");

    const hasFirst = Boolean(args.firstFrameAssetId);
    if (!hasFirst && args.lastFrameAssetId) {
      throw new Error("Last frame requiere first frame.");
    }

    const durationSeconds = clampInt(args.durationSeconds, 4, 15, 5);
    const body: any = {
      prompt,
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: clampInt(args.count, 1, 1, 1),
      durationSeconds,
      aspectRatio: hasFirst
        ? "auto"
        : coerceAllowedString(args.aspectRatio, SEEDANCE_ASPECT_RATIOS, "16:9"),
    };

    if (args.firstFrameAssetId) body.firstFrameAssetId = args.firstFrameAssetId;
    if (args.lastFrameAssetId) body.lastFrameAssetId = args.lastFrameAssetId;

    return {
      modelNorm,
      pendingSlotsCount: body.count,
      effectivePrompt: body.prompt,
      effectiveDurationSeconds: durationSeconds,
      body,
    };
  },

  submit: async () => {
    throw new Error("Seedance usa la cola de generación y no se envía desde el handler directamente.");
  },
};
