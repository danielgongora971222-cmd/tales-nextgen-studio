import { apiPostJson, waitFalJob, savePendingFalJob, clearPendingFalJob } from "../videoGenApi";
import { KLING_V3 } from "./ids";
import { normalizeModelId, coerceAllowedNumber } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, KlingV3Shot, VideoModelHandler } from "./types";

function clampShot(s: KlingV3Shot): KlingV3Shot {
  const dur = Math.max(3, Math.min(15, Math.trunc(Number(s.durationSeconds) || 3)));
  return { prompt: (s.prompt || "").trim(), durationSeconds: dur };
}

function validShots(shots: KlingV3Shot[]) {
  return (shots || []).map(clampShot).filter((x) => x.prompt.length > 0);
}

function totalSeconds(shots: KlingV3Shot[]) {
  return shots.reduce((acc, s) => acc + s.durationSeconds, 0);
}

export const klingV3Handler: VideoModelHandler = {
  label: "Kling V3",
  matches: (m) => m === KLING_V3,

  getCapability: ({ hasFirst }) => ({
    supportsResolution: false,
    supportsAspectRatio: !hasFirst,
    supportsAspectRatio1x1: !hasFirst,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsSound: true,
    supportsLastFrame: true,
  }),

  getSupportedResolutions: () => ["720p"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    const hasFirst = Boolean(args.firstFrameAssetId);

    const vShots = args.multishotEnabled ? validShots(args.klingShots) : [];
    const tot = args.multishotEnabled ? totalSeconds(vShots) : 0;

    if (args.multishotEnabled) {
      if (vShots.length < 2) throw new Error("Multishot: necesitas 2+ shots con prompt.");
      if (tot < 3 || tot > 15) throw new Error("Multishot: la suma debe ser 3–15s.");
    } else {
      if (!args.prompt.trim()) throw new Error("Escribe un prompt.");
    }

    const effectivePrompt =
      args.multishotEnabled ? (vShots[0]?.prompt || "multishot") : args.prompt;

    const effectiveDurationSeconds =
      args.multishotEnabled ? Number(tot || 5) : coerceAllowedNumber(args.durationSeconds, [3,4,5,6,7,8,9,10,11,12,13,14,15], 5);

    const body: any = {
      prompt: effectivePrompt,
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: 1,
      durationSeconds: effectiveDurationSeconds,
      klingSound: Boolean(args.klingSound), // V3 siempre
    };

    if (args.firstFrameAssetId) body.firstFrameAssetId = args.firstFrameAssetId;
    if (args.lastFrameAssetId) body.lastFrameAssetId = args.lastFrameAssetId;

    // si NO hay first frame, se permite escoger aspect ratio
    if (!hasFirst) body.aspectRatio = args.aspectRatio;

    // Elements
    if (args.selectedKlingElementIds.length > 0) {
      if (!hasFirst) throw new Error("Kling V3: Para usar Elements debes cargar FIRST frame.");
      body.klingElementIds = args.selectedKlingElementIds.slice(0, 5);
    }

    // Multishot
    if (args.multishotEnabled) {
      body.klingMultiPrompt = vShots;
      if (!hasFirst) body.klingShotType = args.klingShotType;
    }

    // Extras V3
    if (args.negativePrompt.trim()) body.negativePrompt = args.negativePrompt.trim();
    if (Number.isFinite(Number(args.klingCfgScale))) body.klingCfgScale = Number(args.klingCfgScale);

    const voiceIds = args.klingVoiceIdsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);
    if (voiceIds.length) body.klingVoiceIds = voiceIds;

    return {
      modelNorm,
      pendingSlotsCount: 1,
      effectivePrompt,
      effectiveDurationSeconds,
      body,
    };
  },

  submit: async (plan, opts) => {
    opts?.onProgress?.("Enviando solicitud (Fal)…");

    const submit = await apiPostJson<any>(
      "/api/ai/video",
      { ...plan.body, async: true },
      { signal: opts?.signal, timeoutMs: 60_000, retries: 2 }
    );

    if (submit?.mode === "async" && submit?.jobToken) {
      const jobToken = String(submit.jobToken);

      // Guardamos para poder reanudar si el usuario recarga la página
      savePendingFalJob({
        jobToken,
        prompt: plan.effectivePrompt,
        modelNorm: plan.modelNorm,
        createdAt: Date.now(),
      });

      try {
        await waitFalJob(jobToken, {
          signal: opts?.signal,
          maxWaitMs: 15 * 60 * 1000,
          onProgress: opts?.onProgress,
        });

        opts?.onProgress?.("Finalizando (Fal)…");

        const out = await apiPostJson(
          "/api/ai/video/fal/finalize",
          { jobToken, prompt: plan.effectivePrompt },
          { signal: opts?.signal, timeoutMs: 2 * 60 * 1000, retries: 2 }
        );

        // Si terminó bien, limpiamos el job pendiente
        clearPendingFalJob();
        return out;
      } catch (e: any) {
        // Si el usuario canceló, limpiamos (cancel = no reanudar)
        if (e?.name === "AbortError" || e?.isCanceled) {
          clearPendingFalJob();
        }
        throw e;
      }
    }

    // fallback si responde sync
    return submit;
  },
};
