// services/videoModels/types.ts
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Resolution = "720p" | "1080p" | "4k";
export type KlingMode = "std" | "pro";
export type KlingShotType = "customize" | "intelligent";

export type KlingV3Shot = {
  prompt: string;
  durationSeconds: number;
  elementIds?: string[]; // ✅ AGREGADO: ids de Elements seleccionados para ESTE shot
};

export type VideoGenItem = { url: string; assetId: string };

export type VideoGenResponse =
  | { ok: true; items: VideoGenItem[]; urlExpiresInSeconds?: number }
  | { ok: false; error: any };

export type VideoCapability = {
  supportsResolution: boolean;
  supportsAspectRatio: boolean;
  supportsAspectRatio1x1: boolean;
  durations: readonly number[];
  supportsSound: boolean;
  supportsLastFrame: boolean;
};

export type BuildPlanArgs = {
  model: string;            // raw (puede venir con models/)
  prompt: string;
  tool: string;
  nameHint: string;

  count: number;
  durationSeconds: number;
  aspectRatio: AspectRatio;
  resolution: Resolution;

  firstFrameAssetId?: string | null;
  lastFrameAssetId?: string | null;

  klingMode: KlingMode;
  klingSound: boolean;
  klingSoundTouched: boolean;

  // Kling V3 extras
  selectedKlingElementIds: string[];
  multishotEnabled: boolean;
  klingShots: KlingV3Shot[];
  klingShotType: KlingShotType;

  negativePrompt: string;
  klingCfgScale: number;
  klingVoiceIdsText: string;
};

export type BuildPlanResult = {
  modelNorm: string;
  pendingSlotsCount: number;
  effectivePrompt: string;
  effectiveDurationSeconds: number;
  body: any;
};

export type VideoModelHandler = {
  label: string;
  matches: (modelNorm: string) => boolean;

  getCapability: (args: {
    modelNorm: string;
    hasFirst: boolean;
    hasLast: boolean;
    resolution: Resolution;
    klingMode: KlingMode;
  }) => VideoCapability;

  getSupportedResolutions: (args: { modelNorm: string }) => readonly Resolution[];

  buildPlan: (args: BuildPlanArgs) => BuildPlanResult;

  submit: (
    plan: BuildPlanResult,
    opts?: { signal?: AbortSignal; onProgress?: (msg: string) => void }
  ) => Promise<VideoGenResponse>;
};
