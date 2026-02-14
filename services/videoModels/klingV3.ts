import { apiPostJson, waitFalJob, savePendingFalJob, clearPendingFalJob } from "../videoGenApi";
import { KLING_V3 } from "./ids";
import { normalizeModelId, coerceAllowedNumber } from "./utils";
import type { BuildPlanArgs, BuildPlanResult, KlingV3Shot, VideoModelHandler } from "./types";

const KLING_V3_MULTISHOT_PROMPT_LIMIT = 512;

// Tokens/mentions soportadas:
//  1) @{<elementId>}  (legacy)
//  2) @<uuid>         (algunas UIs insertan el id directo en el texto)
// Ambas se convierten a @ElementN antes de enviar a Fal.
// Importante: NO capturamos cosas tipo @Element1 (eso ya es la sintaxis final para Kling).
const ELEMENT_TOKEN_ANY_RE =
  /@\{([^}]+)\}|@([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi;

const ELEMENT_TOKEN_ANY_TEST_RE =
  /@\{[^}]+\}|@[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function extractTokenElementIds(text: string) {
  const out: string[] = [];
  const s = String(text || "");
  for (const m of s.matchAll(ELEMENT_TOKEN_ANY_RE)) {
    const id = String(m[1] || m[2] || "").trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function replaceTokenMentionsWithRefs(text: string, indexById: Map<string, number>) {
  const s = String(text || "");
  if (!ELEMENT_TOKEN_ANY_TEST_RE.test(s)) return s;
  return s.replace(ELEMENT_TOKEN_ANY_RE, (_full, bracedId, uuidId) => {
    const id = String(bracedId || uuidId || "").trim();
    const idx = indexById.get(id);
    return typeof idx === "number" ? `@Element${idx}` : "";
  });
}

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

  // Si el usuario ya escribió @ElementN manualmente, no tocamos el prompt
  if (/@Element\s*\d+/i.test(p)) return p;

  // Si el usuario está usando tokens con id (UI), no inyectamos refs (se reemplazan antes)
  if (ELEMENT_TOKEN_ANY_TEST_RE.test(p)) return p;


  const refs = refsFromIndexes(indexes);
  return `${p}\n\nUse ${refs}.`.trim();
}

function assertPromptLimit(prompt: string, limit: number, label: string) {
  if (prompt.length > limit) {
    throw new Error(`${label} supera ${limit} caracteres (${prompt.length}).`);
  }
}

function normalizeShot(s: KlingV3Shot, idx: number): KlingV3Shot {
  const basePrompt = String(s.prompt || "").trim();
  if (!basePrompt) return { ...s, prompt: "", durationSeconds: 0 };

  assertPromptLimit(basePrompt, KLING_V3_MULTISHOT_PROMPT_LIMIT, `Multishot: prompt del shot ${idx + 1}`);

  const dur = Math.max(3, Math.min(15, Math.trunc(Number(s.durationSeconds) || 3)));
  const elementIds = Array.isArray((s as any).elementIds) ? uniqueStrings((s as any).elementIds) : [];

  return { ...s, prompt: basePrompt, durationSeconds: dur, elementIds };
}

function validShotsBase(shots: KlingV3Shot[]) {
  return (shots || [])
    .map((s, i) => normalizeShot(s, i))
    .filter((x) => x.prompt.length > 0 && x.durationSeconds > 0);
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

    // ✅ Multishot: cada shot tiene sus elementIds; el request necesita unión global + refs correctas
    const isMulti = Boolean(args.multishotEnabled);

    const baseShots = isMulti ? validShotsBase(args.klingShots) : [];

    // Unión global (orden estable, priorizando el orden del selector).
    // Incluye:
    //  - args.selectedKlingElementIds (orden del selector global)
    //  - elementIds por shot (si aplica)
    //  - menciones en el prompt con id (tokens UI)
    let globalElementIds: string[] = uniqueStrings(
      Array.isArray(args.selectedKlingElementIds) ? args.selectedKlingElementIds : []
    );

    const addGlobal = (id: string, maxMsg: string) => {
      if (!id) return;
      if (!globalElementIds.includes(id)) globalElementIds.push(id);
      if (globalElementIds.length > 5) throw new Error(maxMsg);
    };

    if (isMulti) {
      for (const s of baseShots) {
        const fromSelection = Array.isArray((s as any).elementIds) ? (s as any).elementIds : [];
        const fromTokens = extractTokenElementIds(s.prompt);

        // Importante: primero la selección (orden UI), luego tokens (fallback)
        const ids = uniqueStrings([...fromSelection, ...fromTokens]);

        for (const id of ids) {
          addGlobal(id, "Kling V3: Máximo 5 Elements en total (unión global entre todos los shots). Reduce selección.");
        }
      }
    } else {
      const fromTokens = extractTokenElementIds(args.prompt);
      for (const id of fromTokens) {
        addGlobal(id, "Kling V3: Máximo 5 Elements. Reduce tu selección / menciones en el prompt.");
      }
    }

    const elementIndexById = new Map<string, number>(
      globalElementIds.map((id, idx) => [id, idx + 1])
    );

    // Prompts finales (por shot) con refs inyectadas solo si ese shot usa Elements
    const vShots = isMulti
      ? baseShots.map((s, i) => {
          const fromTokens = extractTokenElementIds(s.prompt);
          const fromSelection = Array.isArray((s as any).elementIds) ? (s as any).elementIds : [];
          const ids = uniqueStrings([...fromTokens, ...fromSelection]);

          const indexes = uniqueNumbers(
            ids
              .map((id: string) => elementIndexById.get(id))
              .filter((x: any) => typeof x === "number")
          );

          // 1) Convertimos @{id} -> @ElementN
          const promptWithRefs = replaceTokenMentionsWithRefs(s.prompt, elementIndexById);

          // 2) Si no hay refs explícitas, inyectamos "Use @ElementN"
          const injected = injectRefsIfMissing(promptWithRefs, indexes);

          assertPromptLimit(
            injected,
            KLING_V3_MULTISHOT_PROMPT_LIMIT,
            `Multishot: prompt del shot ${i + 1} (con Elements)`
          );

          return { prompt: injected, durationSeconds: s.durationSeconds };
        })
      : [];


    // Prompt efectivo (solo para UI/registro)
    const effectivePrompt = isMulti
      ? (vShots[0]?.prompt || "multishot")
      : injectRefsIfMissing(
          replaceTokenMentionsWithRefs(args.prompt, elementIndexById),
          globalElementIds.map((_, idx) => idx + 1)
        );


    // Duración
    const multiTotalSeconds = isMulti ? totalSeconds(vShots) : 0;

    const effectiveDurationSeconds = isMulti
      ? (multiTotalSeconds > 0 ? multiTotalSeconds : 5)
      : coerceAllowedNumber(
          args.durationSeconds,
          [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          5
        );

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

    // ✅ Elements: SIEMPRE global (unión en multishot / global en normal)
    if (globalElementIds.length > 0) body.klingElementIds = globalElementIds;

    // ✅ Multishot: prompts ya vienen con refs correctas
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
