import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { KLING_2_5_TURBO, KLING_2_6, KLING_O3_PRO, KLING_V3 } from "../services/videoModels";
import { apiPostJson, clearPendingFalJob, formatErr, loadPendingFalJobs, savePendingFalJob, waitFalJob } from "../services/videoGenApi";
import { waitJobCompletion, findRecentRunningKlingJob } from "../services/jobsApi";
import { invalidateMyAssetsCache } from "../services/assetsApi";
type QueueJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type VideoQueuePayload = {
  kind: "video-generate";
  modelNorm: string;
  planBody: any;
  prompt: string;
  pendingSlotsCount: number;

  // Fal async resume
  falJobToken?: string | null;

  // Row id en public.jobs (Supabase). El background worker escribe aquí cuando termina.
  supabaseJobId?: string | null;
};

export type QueueJob = {
  id: string;
  type: "video_generate";
  label: string;
  status: QueueJobStatus;
  createdAt: number;
  updatedAt: number;

  progressText?: string | null;
  error?: string | null;

  // placeholders para HistorySection (no son assets reales)
  placeholders: string[];

  payload: VideoQueuePayload;

  result?: {
    assetIds: string[];
    urls: string[];
  };
};

type EnqueueVideoArgs = {
  label: string;
  modelNorm: string;
  planBody: any;
  prompt: string;
  pendingSlotsCount: number;
};

type Ctx = {
  jobs: QueueJob[];
  maxActive: number;
  activeCount: number;
  enqueueVideoGeneration: (args: EnqueueVideoArgs) => { ok: true; jobId: string } | { ok: false; error: string };
  cancelJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  clearFinished: () => void;
};

const GenerationQueueContext = createContext<Ctx | undefined>(undefined);

const QUEUE_VERSION = 1;
const MAX_ACTIVE_JOBS = 5;        // total activos (queued + running)
const CONCURRENCY = 1;            // 1 a la vez (evita 429/Kling parallel limits)
const SUBMIT_TIMEOUT_MS = 3 * 60 * 1000; // 3 min (cubre retries con Retry-After)
const SUBMIT_RETRIES = 4;              // reintentos (429 con Retry-After)
const STORAGE_PREFIX = "tales_generation_queue_v";

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${QUEUE_VERSION}:${userId}`;
}

function safeJsonParse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function now() {
  return Date.now();
}

function sleepAbortable(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const err: any = new Error("Cancelado.");
      err.name = "AbortError";
      err.isCanceled = true;
      reject(err);
      return;
    }

    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      const err: any = new Error("Cancelado.");
      err.name = "AbortError";
      err.isCanceled = true;
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort as any);
    };

    if (signal) signal.addEventListener("abort", onAbort as any, { once: true });
  });
}

function isFalModel(modelNorm: string) {
  return modelNorm === KLING_O3_PRO;
}

function asArray(v: any) {
  return Array.isArray(v) ? v : [];
}

function extractResult(res: any) {
  const items = asArray(res?.items);
  const assetIds = items.map((x: any) => String(x?.assetId || "")).filter(Boolean);
  const urls = items.map((x: any) => String(x?.url || "")).filter(Boolean);
  return { assetIds, urls };
}

function pickUrlFromJobRow(row: any) {
  const p = row?.params || {};
  const url =
    p?.resultUrl ||
    p?.result_url ||
    p?.url ||
    p?.videoUrl ||
    p?.video_url ||
    p?.providerVideoUrl ||
    p?.provider_video_url ||
    "";
  const s = String(url || "").trim();
  return s || null;
}

export const GenerationQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const maxActive = MAX_ACTIVE_JOBS;

  const activeCount = useMemo(() => jobs.filter((j) => j.status === "queued" || j.status === "running").length, [jobs]);

  // ========== LOAD (por usuario) ==========
  useEffect(() => {
    if (!userId) {
      setJobs([]);
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
      return;
    }

    const raw = typeof window !== "undefined" ? localStorage.getItem(storageKey(userId)) : null;
    const parsed = safeJsonParse(raw);

    const loaded = Array.isArray(parsed?.jobs) ? (parsed.jobs as QueueJob[]) : [];

    // Si había jobs "running" no-resumibles (no Fal), los marcamos como fallidos al recargar
    const normalized = loaded.map((j) => {
      if (j.status !== "running") return j;

      const modelNorm = String(j.payload?.modelNorm || "");
      const token = j.payload?.falJobToken;
      const supaId = j.payload?.supabaseJobId ? String(j.payload.supabaseJobId) : "";

      // ✅ Reanudable: Fal (token)
      if (token && isFalModel(modelNorm)) {
        return {
          ...j,
          status: "queued" as const,
          updatedAt: now(),
          progressText: "Reanudando job pendiente…",
        };
      }

      // ✅ Reanudable: Kling (Tasks) (supabaseJobId)
      if ((modelNorm === KLING_V3 || modelNorm === KLING_2_6 || modelNorm === KLING_2_5_TURBO) && supaId) {
        return {
          ...j,
          status: "queued" as const,
          updatedAt: now(),
          progressText: "Reanudando (Kling, background)…",
        };
      }

      return {
        ...j,
        status: "failed" as const,
        error: "La página se recargó mientras se generaba. Vuelve a intentar.",
        updatedAt: now(),
        progressText: null,
      };
    });

    // Recuperar jobs Fal pendientes (de otras herramientas o de antes de implementar Queue)
    const pending = loadPendingFalJobs();
    const existingTokens = new Set<string>();
    for (const j of normalized) {
      const t = j.payload?.falJobToken;
      if (t) existingTokens.add(String(t));
    }

    const recovered: QueueJob[] = [];
    for (const p of pending) {
      const token = String(p.jobToken || "");
      if (!token || existingTokens.has(token)) continue;

      const id = makeId();
      recovered.push({
        id,
        type: "video_generate",
        label: `Recovered video job (${p.modelNorm || "Fal"})`,
        status: "queued",
        createdAt: typeof p.createdAt === "number" ? p.createdAt : now(),
        updatedAt: now(),
        progressText: "Reanudando job pendiente…",
        placeholders: [],
        payload: {
          kind: "video-generate",
          modelNorm: String(p.modelNorm || KLING_V3),
          planBody: null,
          prompt: String(p.prompt || ""),
          pendingSlotsCount: 0,
          falJobToken: token,
          supabaseJobId: p.jobId ? String(p.jobId) : null,
        },
      });
    }

    setJobs([...recovered, ...normalized]);
  }, [userId]);

  // ========== SAVE ==========
  useEffect(() => {
    if (!userId) return;
    if (typeof window === "undefined") return;

    const data = { v: QUEUE_VERSION, jobs };
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(data));
    } catch {}
  }, [jobs, userId]);

  // ========== HELPERS ==========
  const enqueueVideoGeneration = (args: EnqueueVideoArgs) => {
    if (!userId) return { ok: false as const, error: "No hay usuario autenticado." };

    const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
    if (active >= maxActive) {
      return { ok: false as const, error: `Límite de cola alcanzado (${maxActive}). Espera a que terminen o cancela alguno.` };
    }

    const id = makeId();
    const stamp = now();
    const placeholders = Array.from({ length: Math.max(0, args.pendingSlotsCount || 0) }, (_, i) => `pending-${id}-${stamp}-${i}`);

    const job: QueueJob = {
      id,
      type: "video_generate",
      label: args.label,
      status: "queued",
      createdAt: stamp,
      updatedAt: stamp,
      progressText: null,
      error: null,
      placeholders,
      payload: {
        kind: "video-generate",
        modelNorm: args.modelNorm,
        planBody: args.planBody,
        prompt: args.prompt,
        pendingSlotsCount: args.pendingSlotsCount,
        falJobToken: null,
        supabaseJobId: null,
      },
    };

    setJobs((prev) => [job, ...prev]);
    return { ok: true as const, jobId: id };
  };

  const cancelJob = (jobId: string) => {
    const c = controllersRef.current.get(jobId);
    if (c) c.abort();

    const token = jobs.find((j) => j.id === jobId)?.payload?.falJobToken;
    if (token) clearPendingFalJob(String(token));

    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? { ...j, status: "canceled" as const, progressText: null, updatedAt: now(), error: null }
          : j
      )
    );
  };

  const removeJob = (jobId: string) => {
    const c = controllersRef.current.get(jobId);
    if (c) c.abort();

    const token = jobs.find((j) => j.id === jobId)?.payload?.falJobToken;
    if (token) clearPendingFalJob(String(token));

    controllersRef.current.delete(jobId);

    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  };

  const clearFinished = () => {
    setJobs((prev) => prev.filter((j) => j.status === "queued" || j.status === "running"));
  };

  // ========== RUNNER ==========
  useEffect(() => {
    if (!userId) return;

    const running = jobs.filter((j) => j.status === "running").length;
    if (running >= CONCURRENCY) return;

    const next = jobs.find((j) => j.status === "queued");
    if (!next) return;

    const controller = new AbortController();
    controllersRef.current.set(next.id, controller);

    // marcar running
    setJobs((prev) =>
      prev.map((j) =>
        j.id === next.id ? { ...j, status: "running", updatedAt: now(), progressText: "Iniciando…" } : j
      )
    );

    (async () => {
      try {
        const res = await runVideoJob(
          next,
          (msg) => {
            setJobs((prev) =>
              prev.map((j) => (j.id === next.id ? { ...j, progressText: msg, updatedAt: now() } : j))
            );
          },
          (patch) => {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === next.id
                  ? { ...j, payload: { ...j.payload, ...patch }, updatedAt: now() }
                  : j
              )
            );
          },
          controller.signal
        );

        const result = extractResult(res);

        setJobs((prev) =>
          prev.map((j) =>
            j.id === next.id
              ? { ...j, status: "succeeded", progressText: null, updatedAt: now(), result }
              : j
          )
        );
      } catch (e: any) {
        if (e?.name === "AbortError" || e?.isCanceled) {
          // cancelJob ya marca canceled, aquí solo limpiamos
        } else {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === next.id
                ? { ...j, status: "failed", progressText: null, updatedAt: now(), error: formatErr(e) }
                : j
            )
          );
        }
      } finally {
        controllersRef.current.delete(next.id);
      }
    })();
  }, [jobs, userId]);

  const value = useMemo<Ctx>(
    () => ({ jobs, maxActive, activeCount, enqueueVideoGeneration, cancelJob, removeJob, clearFinished }),
    [jobs, maxActive, activeCount]
  );

  return <GenerationQueueContext.Provider value={value}>{children}</GenerationQueueContext.Provider>;
};

async function runVideoJob(
  job: QueueJob,
  onProgress: (msg: string) => void,
  onPayloadPatch: (patch: Partial<VideoQueuePayload>) => void,
  signal: AbortSignal
) {
  const payload = job.payload;
  const modelNorm = String(payload?.modelNorm || "");
  const prompt = String(payload?.prompt || "");

    // ===============================
  // ✅ Kling V3 (API oficial): esperar al worker por public.jobs
  // ===============================
  if (modelNorm === KLING_V3 || modelNorm === KLING_2_6 || modelNorm === KLING_2_5_TURBO) {
    const existingJobId = payload?.supabaseJobId ? String(payload.supabaseJobId) : "";

    // Reanudar si ya tenemos jobId
    if (existingJobId) {
      onProgress("Reanudando (Kling, background)…");
      const row = await waitJobCompletion(existingJobId, { signal, onProgress, pollMs: 15_000 });

      if (row.status === "failed") {
        throw new Error(row.error || "Falló el job de Kling en background.");
      }

      if (row.status === "succeeded" && row.result_asset_id) {
        const url = pickUrlFromJobRow(row);
        invalidateMyAssetsCache("video");
        return { ok: true, items: [{ assetId: row.result_asset_id, ...(url ? { url } : {}) }] };
      }
      throw new Error("Job Kling terminó pero no devolvió result_asset_id.");
    }

// Submit async
onProgress("Enviando solicitud (Kling)…");
const body = payload?.planBody || {};
const clientJobId = job.id;

// Si Kling responde 429 (límite paralelo), NO marcamos el job como Failed:
// - Puede ser un reintento (reload/red) del mismo job.
// - O puede ser que haya otro job corriendo y necesitamos esperar cupo.
const BUSY_WAIT_MAX_MS = 20 * 60 * 1000;
const busyStartedAt = Date.now();

const getErrStatus = (e: any) => Number(e?.status || 0);
const getErrCode = (e: any) =>
  String(e?.response?.data?.code || e?.response?.data?.error?.code || "");

let submit: any;

while (true) {
  try {
    submit = await apiPostJson<any>(
      "/api/ai/video",
      { ...body, async: true, clientJobId },
      { signal, timeoutMs: SUBMIT_TIMEOUT_MS, retries: SUBMIT_RETRIES }
    );
    break;
  } catch (e: any) {
    const msg = String(e?.message || "");
    const status = getErrStatus(e);
    const code = getErrCode(e);

    const isBusy = status === 429 && code === "KLING_V3_PARALLEL_LIMIT";

    const recoverableNetwork =
      msg.includes("Timeout:") ||
      msg.includes("Failed to fetch") ||
      msg.toLowerCase().includes("networkerror") ||
      msg.toLowerCase().includes("load failed");

    if (recoverableNetwork || isBusy) {
      if (isBusy) onProgress("Kling al límite… verificando si ya existe el job…");
      else onProgress("Reconectando (Kling)…");

      // Si el backend alcanzó a crear un job en Supabase pero la respuesta se cortó,
      // lo recuperamos por (model + prompt) en una ventana amplia (pero segura).
      const recovered = await findRecentRunningKlingJob({
        model: modelNorm,
        prompt,
        windowMs: 15 * 60 * 1000,
      });

      if (recovered?.id) {
        const supabaseJobId = String(recovered.id);
        onPayloadPatch({ supabaseJobId });

        onProgress("Procesando (Kling, background)…");
        const row = await waitJobCompletion(supabaseJobId, { signal, onProgress, pollMs: 15_000 });

        if (row.status === "failed") {
          throw new Error(row.error || "Falló el job de Kling en background.");
        }

        if (row.status === "succeeded" && row.result_asset_id) {
          const url = pickUrlFromJobRow(row);
          invalidateMyAssetsCache("video");
          return { ok: true, items: [{ assetId: row.result_asset_id, ...(url ? { url } : {}) }] };
        }

        throw new Error("Job Kling terminó pero no devolvió result_asset_id.");
      }

      // Si fue busy 429 y NO encontramos job, esperamos y reintentamos el submit.
      if (isBusy) {
        const raSec = Number(e?.response?.data?.details?.retryAfterSeconds || 30);
        const elapsed = Date.now() - busyStartedAt;

        if (elapsed > BUSY_WAIT_MAX_MS) {
          throw e;
        }

        const waitMs =
          Math.max(5_000, Math.min(120_000, raSec * 1000)) + Math.floor(Math.random() * 350);

        onProgress(`Kling al límite… reintentando en ${Math.round(waitMs / 1000)}s…`);
        await sleepAbortable(waitMs, signal);
        continue;
      }
    }

    throw e;
  }
}

// fallback si responde sync
if (!(submit?.mode === "async" && submit?.jobId)) return submit;

const supabaseJobId = String(submit.jobId);
onPayloadPatch({ supabaseJobId });

onProgress("Procesando (Kling, background)…");
const row = await waitJobCompletion(supabaseJobId, { signal, onProgress, pollMs: 15_000 });

    if (row.status === "failed") {
      throw new Error(row.error || "Falló el job de Kling en background.");
    }

    if (row.status === "succeeded" && row.result_asset_id) {
      const url = pickUrlFromJobRow(row);
      invalidateMyAssetsCache("video");
      return { ok: true, items: [{ assetId: row.result_asset_id, ...(url ? { url } : {}) }] };
    }
    throw new Error("Job Kling terminó pero no devolvió result_asset_id.");
  }

  if (isFalModel(modelNorm)) {
    // 1) Si ya tenemos jobToken → reanudar
    const existingToken = payload?.falJobToken ? String(payload.falJobToken) : "";
    if (existingToken) {
      const existingJobId = payload?.supabaseJobId ? String(payload.supabaseJobId) : "";

      // ✅ Camino robusto: esperar por el row en public.jobs (background worker)
      if (existingJobId) {
        onProgress("Reanudando (background)…");
        const row = await waitJobCompletion(existingJobId, { signal, onProgress, pollMs: 15_000 });

        if (row.status === "failed") {
          clearPendingFalJob(existingToken);
          throw new Error(row.error || "Falló el job en background.");
        }

        if (row.status === "succeeded" && row.result_asset_id) {
          invalidateMyAssetsCache("video");
          clearPendingFalJob(existingToken);
          return { ok: true, items: [{ assetId: row.result_asset_id }] };
        }

        // Fallback raro: el job terminó pero no dejó assetId
        onProgress("Finalizando (Fal)…");
        const out = await apiPostJson<any>(
          "/api/ai/video/fal/finalize",
          { jobToken: existingToken, prompt },
          { signal, timeoutMs: 2 * 60 * 1000, retries: 2 }
        );

        invalidateMyAssetsCache("video");
        clearPendingFalJob(existingToken);
        return out;
      }

      // ✅ Fallback (compat): sin jobId, volvemos al polling clásico a Fal.
      onProgress("Reanudando (Fal)…");
      await waitFalJob(existingToken, { signal, maxWaitMs: 6 * 60 * 60 * 1000, onProgress });
      onProgress("Finalizando (Fal)…");
      const out = await apiPostJson<any>(
        "/api/ai/video/fal/finalize",
        { jobToken: existingToken, prompt },
        { signal, timeoutMs: 2 * 60 * 1000, retries: 2 }
      );

      invalidateMyAssetsCache("video");
      clearPendingFalJob(existingToken);
      return out;
    }

    // 2) Submit async
    onProgress("Enviando solicitud (Fal)…");

    const body = payload?.planBody || {};
    const submit = await apiPostJson<any>(
      "/api/ai/video",
      { ...body, async: true },
      { signal, timeoutMs: SUBMIT_TIMEOUT_MS, retries: SUBMIT_RETRIES }
    );

    // fallback si responde sync
    if (!(submit?.mode === "async" && submit?.jobToken)) return submit;

    const jobToken = String(submit.jobToken);
    const supabaseJobId = submit?.jobId ? String(submit.jobId) : "";

    onPayloadPatch({ falJobToken: jobToken, supabaseJobId: supabaseJobId || null });

    // Guardamos para poder reanudar si recarga
    savePendingFalJob({
      jobToken,
      jobId: supabaseJobId || undefined,
      prompt,
      modelNorm,
      createdAt: now(),
      clientJobId: job.id,
    });

    // ✅ Camino robusto: esperar al worker (public.jobs)
    if (supabaseJobId) {
      onProgress("Procesando (background)…");
      const row = await waitJobCompletion(supabaseJobId, { signal, onProgress, pollMs: 15_000 });

      if (row.status === "failed") {
        clearPendingFalJob(jobToken);
        throw new Error(row.error || "Falló el job en background.");
      }

      if (row.status === "succeeded" && row.result_asset_id) {
        invalidateMyAssetsCache("video");
        clearPendingFalJob(jobToken);
        return { ok: true, items: [{ assetId: row.result_asset_id }] };
      }

      // Fallback raro: el job terminó pero no dejó assetId
      onProgress("Finalizando (Fal)…");
      const out = await apiPostJson<any>(
        "/api/ai/video/fal/finalize",
        { jobToken, prompt },
        { signal, timeoutMs: 2 * 60 * 1000, retries: 2 }
      );

      invalidateMyAssetsCache("video");
      clearPendingFalJob(jobToken);
      return out;
    }

    // Fallback compat: backend no devolvió jobId
    onProgress("Procesando (Fal)…");
    await waitFalJob(jobToken, { signal, maxWaitMs: 6 * 60 * 60 * 1000, onProgress });
    onProgress("Finalizando (Fal)…");

    const out = await apiPostJson<any>(
      "/api/ai/video/fal/finalize",
      { jobToken, prompt },
      { signal, timeoutMs: 2 * 60 * 1000, retries: 2 }
    );

    invalidateMyAssetsCache("video");
    clearPendingFalJob(jobToken);
    return out;
  }

  // No-Fal / sync
  onProgress("Enviando solicitud…");
  const body = payload?.planBody || {};
  return apiPostJson<any>("/api/ai/video", body, { signal, timeoutMs: 10 * 60 * 1000, retries: 2 });
}

export const useGenerationQueue = () => {
  const ctx = useContext(GenerationQueueContext);
  if (!ctx) throw new Error("useGenerationQueue must be used within GenerationQueueProvider");
  return ctx;
};
