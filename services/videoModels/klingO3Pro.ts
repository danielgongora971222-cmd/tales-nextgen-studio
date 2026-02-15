import { apiPostJson, waitFalJob, savePendingFalJob, clearPendingFalJob } from "../videoGenApi";
import { KLING_O3_PRO } from "./ids";
import { normalizeModelId, coerceAllowedNumber } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, KlingV3Shot, VideoModelHandler } from "./types";

const KLING_O3_MULTISHOT_PROMPT_LIMIT = 512;

function uniqueStrings(xs: string[]) {
  const out: string[] = [];
  for (const x of xs) if (x && !out.includes(x)) out.push(x);
  return out;
}

function uniqueNumbers(xs: number[]) {
  const out: number[] = [];
  for (const x of xs) if (Number.isFinite(x) && !out.includes(x)) out.push(x);
  return out;
}

function refsFromIndexes(indexes: number[]) {
  const uniq = uniqueNumbers(indexes).sort((a, b) => a - b);
  return uniq.map((i) => `@Element${i}`).join(" ");
}

function injectRefsIfMissing(prompt: string, indexes: number[]) {
  const p = String(prompt || "").trim();
  if (indexes.length <= 0) return p;
  if (/@Element\s*\d+/i.test(p)) return p;
  const refs = refsFromIndexes(indexes);
  return `${p}\n\nUse ${refs}.`.trim();
}

function assertPromptLimit(prompt: string, limit: number, label: string) {
  if (prompt.length > limit) throw new Error(`${label} supera ${limit} caracteres (${prompt.length}).`);
}

function normalizeShot(s: KlingV3Shot, idx: number): KlingV3Shot {
  const basePrompt = String(s.prompt || "").trim();
  if (!basePrompt) return { ...s, prompt: "", durationSeconds: 0 };

  assertPromptLimit(basePrompt, KLING_O3_MULTISHOT_PROMPT_LIMIT, `Multishot: prompt del shot ${idx + 1}`);

  let dur = Math.trunc(Number(s.durationSeconds) || 3);
  if (dur < 3) dur = 3;
  if (dur > 15) dur = 15;

  const elementIds = Array.isArray((s as any).elementIds) ? uniqueStrings((s as any).elementIds) : [];
  return { ...s, prompt: basePrompt, durationSeconds: dur, elementIds };
}

function validShotsBase(shots: KlingV3Shot[]) {
  return (shots || [])
    .map((s, i) => normalizeShot(s, i))
    .filter((x) => x.prompt.length > 0 && x.durationSeconds > 0);
}

function totalSeconds(shots: { durationSeconds: number }[]) {
  return (shots || []).reduce((acc, s) => acc + (Number(s.durationSeconds) || 0), 0);
}

export const klingO3ProHandler: VideoModelHandler = {
  label: "Kling O3 Pro",
  matches: (m) => m === KLING_O3_PRO,

    getCapability: ({ hasFirst }) => ({
    supportsResolution: false,

    // ✅ Si hay FIRST frame: se bloquea aspect ratio (igual que Kling V3)
    supportsAspectRatio: !hasFirst,

    supportsAspectRatio1x1: true,
    durations: [3,4,5,6,7,8,9,10,11,12,13,14,15],
    supportsSound: true,
    supportsLastFrame: true,
  }),

  getSupportedResolutions: () => ["720p"],

  buildPlan: (args: BuildPlanArgs): BuildPlanResult => {
    const modelNorm = normalizeModelId(args.model);
    const hasFirst = Boolean(args.firstFrameAssetId);

    const isMulti = Boolean(args.multishotEnabled);
    const baseShots = isMulti ? validShotsBase(args.klingShots) : [];

    // Elements solo aplica cuando hay imagen base (I2V)
    // ✅ Elements: unión global (en multishot) / selección global (modo normal)
    let globalElementIds: string[] = [];
    if (isMulti) {
      for (const s of baseShots) {
        const ids = Array.isArray((s as any).elementIds) ? (s as any).elementIds : [];
        for (const id of ids) {
          if (!globalElementIds.includes(id)) globalElementIds.push(id);
          if (globalElementIds.length > 5) {
            throw new Error(
              "Kling O3: Máximo 5 Elements en total (unión global entre todos los shots). Reduce selección."
            );
          }
        }
      }
    } else {
      globalElementIds = args.selectedKlingElementIds.slice(0, 5);
    }

    const elementIndexById = new Map<string, number>(globalElementIds.map((id, idx) => [id, idx + 1]));

    const vShots = isMulti
      ? baseShots.map((s, i) => {
          const ids = Array.isArray((s as any).elementIds) ? (s as any).elementIds : [];
          const indexes = uniqueNumbers(ids.map((id: string) => elementIndexById.get(id)).filter((x: any) => typeof x === "number"));
          const injected = injectRefsIfMissing(s.prompt, indexes);
          assertPromptLimit(injected, KLING_O3_MULTISHOT_PROMPT_LIMIT, `Multishot: prompt del shot ${i + 1}`);
          return { prompt: injected, durationSeconds: s.durationSeconds };
        })
      : [];

    const effectivePrompt = isMulti ? (vShots[0]?.prompt || "multishot") : String(args.prompt || "").trim();
    if (!effectivePrompt.trim()) throw new Error("Escribe un prompt.");

    const multiTotalSeconds = isMulti ? totalSeconds(vShots) : 0;

    const effectiveDurationSeconds = isMulti
      ? (multiTotalSeconds > 0 ? multiTotalSeconds : 5)
      : coerceAllowedNumber(args.durationSeconds, [3,4,5,6,7,8,9,10,11,12,13,14,15], 5);

    const body: any = {
      prompt: effectivePrompt,
      model: modelNorm,
      tool: args.tool,
      nameHint: args.nameHint,
      count: 1,
      durationSeconds: effectiveDurationSeconds,

      klingSound: Boolean(args.klingSound),
      negativePrompt: args.negativePrompt,
      klingCfgScale: args.klingCfgScale,
    };

    if (args.firstFrameAssetId) body.firstFrameAssetId = args.firstFrameAssetId;
    if (args.lastFrameAssetId) body.lastFrameAssetId = args.lastFrameAssetId;

    body.aspectRatio = args.aspectRatio;

    if (hasFirst && globalElementIds.length > 0) body.klingElementIds = globalElementIds;

    if (args.multishotEnabled) {
      body.klingMultiPrompt = vShots;
      body.klingShotType = "customize"; // O3: solo customize
    }

    const voiceIds = args.klingVoiceIdsText.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2);
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
