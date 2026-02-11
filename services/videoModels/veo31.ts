import { apiPostJson } from "../videoGenApi";
import { VEO_3_1, VEO_3_1_FAST } from "./ids";
import { clampInt, normalizeModelId, coerceAllowedNumber, coerceAllowedString } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, VideoModelHandler } from "./types";

function getDurations(hasFirst: boolean, hasLast: boolean, resolution: "720p" | "1080p" | "4k") {
  if (hasFirst || hasLast) return [8] as const;
  if (resolution === "720p") return [4, 6, 8] as const;
  return [8] as const;
}

export const veo31Handler: VideoModelHandler = {
  label: "Veo 3.1",
  matches: (m) => m === VEO_3_1 || m === VEO_3_1_FAST,

  getCapability: ({ hasFirst, hasLast, resolution }) => ({
    supportsResolution: true,
    supportsAspectRatio: !hasFirst,
    supportsAspectRatio1x1: false,
    durations: getDurations(hasFirst, hasLast, resolution),
    supportsSound: false,
    supportsLastFrame: true,
  }),

  getSupportedResolutions: () => ["720p", "1080p", "4k"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    if (!args.prompt.trim()) throw new Error("Escribe un prompt.");

    const hasFirst = Boolean(args.firstFrameAssetId);
    const hasLast = Boolean(args.lastFrameAssetId);

    const resolution = coerceAllowedString(args.resolution, ["720p", "1080p", "4k"] as const, "720p");
    const allowedDurations = getDurations(hasFirst, hasLast, resolution);

    const body: any = {
      prompt: args.prompt,
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: clampInt(args.count, 1, 4, 1),
      durationSeconds: coerceAllowedNumber(args.durationSeconds, allowedDurations, allowedDurations[0]),
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
