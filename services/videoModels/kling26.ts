import { apiPostJson } from "../videoGenApi";
import { KLING_2_6 } from "./ids";
import { clampInt, normalizeModelId } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, VideoModelHandler } from "./types";

export const kling26Handler: VideoModelHandler = {
  label: "Kling 2.6",
  matches: (m) => m === KLING_2_6,

  getCapability: ({ hasFirst, klingMode }) => ({
    supportsResolution: false,
    supportsAspectRatio: !hasFirst,
    supportsAspectRatio1x1: !hasFirst,
    durations: [5, 10],
    supportsSound: klingMode === "pro",
    supportsLastFrame: true,
  }),

  getSupportedResolutions: () => ["720p"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    if (!args.prompt.trim()) throw new Error("Escribe un prompt.");

    const hasFirst = Boolean(args.firstFrameAssetId);

    const body: any = {
      prompt: args.prompt,
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: clampInt(args.count, 1, 4, 1),
      durationSeconds: Number(args.durationSeconds),
      klingMode: args.klingMode,
    };

    // Kling 2.6: solo enviamos klingSound si el usuario tocó el toggle
    if (args.klingSoundTouched) body.klingSound = Boolean(args.klingSound);

    if (args.firstFrameAssetId) body.firstFrameAssetId = args.firstFrameAssetId;
    if (args.lastFrameAssetId) body.lastFrameAssetId = args.lastFrameAssetId;

    if (!hasFirst) body.aspectRatio = args.aspectRatio;

    return {
      modelNorm,
      pendingSlotsCount: body.count,
      effectivePrompt: args.prompt,
      effectiveDurationSeconds: body.durationSeconds,
      body,
    };
  },

  submit: async (plan) => apiPostJson("/api/ai/video", plan.body),
};
