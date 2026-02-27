import { apiPostJson } from "../videoGenApi";
import { VEO_3, VEO_3_FAST } from "./ids";
import { clampInt, normalizeModelId, coerceAllowedNumber, coerceAllowedString } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, VideoModelHandler } from "./types";

export const veo3Handler: VideoModelHandler = {
  label: "Veo 3",
  matches: (m) => m === VEO_3 || m === VEO_3_FAST,

  getCapability: ({ hasFirst }) => ({
    supportsResolution: true,
    supportsAspectRatio: !hasFirst,
    supportsAspectRatio1x1: false,
    durations: [8],
    supportsSound: false,
    supportsLastFrame: true,
  }),

  getSupportedResolutions: () => ["720p", "1080p"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    if (!args.prompt.trim()) throw new Error("Escribe un prompt.");

    const hasFirst = Boolean(args.firstFrameAssetId);

    const resolution = coerceAllowedString(args.resolution, ["720p", "1080p"] as const, "720p");

    const body: any = {
      prompt: args.prompt,
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: clampInt(args.count, 1, 4, 1),
      durationSeconds: coerceAllowedNumber(args.durationSeconds, [8], 8),
      resolution,
    };

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

  submit: async (plan, opts) => {
    opts?.onProgress?.("Enviando solicitud…");
    return apiPostJson("/api/ai/video", plan.body, {
      signal: opts?.signal,
      timeoutMs: 12 * 60 * 1000,
      retries: 2,
    });
  },
};
