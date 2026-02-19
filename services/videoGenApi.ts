// services/videoGenApi.ts
import { supabase } from "./supabaseClient";
import { invalidateMyAssetsCache } from "./assetsApi";

const PENDING_FAL_KEY = "tales_pending_fal_job_v1";

export type PendingFalJob = {
  jobToken: string;
  prompt: string;
  modelNorm: string;
  createdAt: number;

  // Opcional: para vincularlo con nuestro Queue client-side
  clientJobId?: string;
};

function readPendingFalStorage(): PendingFalJob[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(PENDING_FAL_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // compat: antes era un objeto único
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.jobToken) {
      return [parsed as PendingFalJob];
    }

    if (Array.isArray(parsed)) {
      return parsed.filter((x) => x && x.jobToken && x.prompt) as PendingFalJob[];
    }

    return [];
  } catch {
    return [];
  }
}

function writePendingFalStorage(list: PendingFalJob[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PENDING_FAL_KEY, JSON.stringify(list));
  } catch {}
}

export function loadPendingFalJobs(): PendingFalJob[] {
  const list = readPendingFalStorage();
  // newest first
  return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// compat: devuelve el más reciente
export function loadPendingFalJob(): PendingFalJob | null {
  const list = loadPendingFalJobs();
  return list[0] || null;
}

export function savePendingFalJob(job: PendingFalJob) {
  const list = readPendingFalStorage();

  const token = String(job.jobToken || "");
  if (!token) return;

  const next = list.filter((x) => String(x.jobToken || "") !== token);
  next.unshift(job);

  writePendingFalStorage(next.slice(0, 50)); // cap para no crecer infinito
}

export function clearPendingFalJob(jobToken?: string) {
  const list = readPendingFalStorage();

  if (!jobToken) {
    writePendingFalStorage([]);
    return;
  }

  const token = String(jobToken || "");
  const next = list.filter((x) => String(x.jobToken || "") !== token);

  writePendingFalStorage(next);
}

export async function resumeFalFinalize(
  job: PendingFalJob,
  opts?: { signal?: AbortSignal; onProgress?: (msg: string) => void; maxWaitMs?: number }
) {
  opts?.onProgress?.("Reanudando (Fal)…");

  await waitFalJob(job.jobToken, {
    signal: opts?.signal,
    // Subimos el máximo de espera para Kling V3 (Fal)
    maxWaitMs: opts?.maxWaitMs ?? 60 * 60 * 1000, // 60 min
    onProgress: opts?.onProgress,
  });

  opts?.onProgress?.("Finalizando (Fal)…");

  return apiPostJson(
    "/api/ai/video/fal/finalize",
    { jobToken: job.jobToken, prompt: job.prompt },
    { signal: opts?.signal, timeoutMs: 2 * 60 * 1000, retries: 2 }
  );
}


function getStatus(err: any): number | null {
  return typeof err?.status === "number"
    ? err.status
    : typeof err?.response?.status === "number"
      ? err.response.status
      : null;
}

function getErrMsg(err: any): string {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    (typeof err === "string" ? err : "Failed to generate video.")
  );
}

export function formatErr(err: any): string {
  const s = getStatus(err);
  const m = getErrMsg(err);
  return s ? `${m} (HTTP ${s})` : m;
}

function makeHttpError(message: string, resp: Response, extra?: any) {
  const err: any = new Error(message);
  err.status = resp.status;
  err.response = { status: resp.status, data: extra };
  return err;
}

function makeCanceledError() {
  const err: any = new Error("Cancelado.");
  err.name = "AbortError";
  err.isCanceled = true;
  return err;
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((r) => setTimeout(r, ms));
  if (signal.aborted) throw makeCanceledError();

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(makeCanceledError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export async function apiPostJson<T>(
  path: string,
  body: any,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    retries?: number;
    retryBaseDelayMs?: number;
  }
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000; // 10 min por defecto
  const retries = opts?.retries ?? 2;
  const retryBaseDelayMs = opts?.retryBaseDelayMs ?? 900;

  // Abort controller interno + “enganche” al signal externo (para Cancel)
  const controller = new AbortController();
  let didTimeout = false;

  const onExternalAbort = () => controller.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) throw makeCanceledError();
    opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const t = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (controller.signal.aborted) {
        if (didTimeout) throw new Error(`Timeout: el servidor tardó más de ${timeoutMs}ms.`);
        throw makeCanceledError();
      }

      try {
        const resp = await fetch(path, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const rawText = await resp.text();
        const contentType = (resp.headers.get("content-type") || "").toLowerCase();
        const looksJson =
          contentType.includes("application/json") || contentType.includes("+json");

        let data: any = null;

        if (rawText) {
          if (looksJson) {
            try {
              data = JSON.parse(rawText);
            } catch {
              throw makeHttpError(
                `Respuesta inválida: se esperaba JSON pero llegó algo no-JSON (HTTP ${resp.status}).`,
                resp,
                rawText.slice(0, 600)
              );
            }
          } else {
            // Intentamos parsear igual por si faltó header
            try {
              data = JSON.parse(rawText);
            } catch {
              data = rawText; // texto/HTML
            }
          }
        } else {
          if (resp.status === 204) return null as T;
          data = null;
        }

        // HTTP error -> puede reintentar si es retryable
        if (!resp.ok) {
          const e =
            (data && typeof data === "object" ? data.error ?? data : null) ??
            { message: rawText ? rawText.slice(0, 600) : `Request failed: ${resp.status}` };

          const msg =
            typeof e === "string"
              ? e
              : e?.message || e?.error || `Request failed: ${resp.status}`;

          const details =
            e?.details ? `\n\nDetalles:\n${JSON.stringify(e.details, null, 2)}` : "";

          const httpErr = makeHttpError(
            `${e?.code ? `${e.code}: ` : ""}${msg}${details}`,
            resp,
            e
          );

          if (attempt < retries && isRetryableStatus(resp.status)) {
            // Retry-After si viene (especialmente 429)
            const ra = resp.headers.get("retry-after");
            const raMs = ra && !isNaN(Number(ra)) ? Number(ra) * 1000 : null;

            const backoff =
              (raMs ?? retryBaseDelayMs * Math.pow(2, attempt)) +
              Math.floor(Math.random() * 250);

            await sleep(backoff, opts?.signal);
            continue;
          }

          throw httpErr;
        }

        // 200 OK pero texto/HTML -> error claro (antes se rompía después)
        if (typeof data === "string") {
          throw makeHttpError(
            `Respuesta inesperada: el servidor devolvió texto/HTML en vez de JSON (HTTP ${resp.status}). ` +
              `Inicio: ${data.slice(0, 120)}`,
            resp,
            data.slice(0, 600)
          );
        }

        // JSON ok:false
        if (data?.ok === false) {
          const e = data?.error ?? data;
          const msg =
            typeof e === "string" ? e : e?.message || e?.error || "Request failed";
          const details =
            e?.details ? `\n\nDetalles:\n${JSON.stringify(e.details, null, 2)}` : "";

          throw makeHttpError(`${e?.code ? `${e.code}: ` : ""}${msg}${details}`, resp, e);
        }

        if (data === null) {
          throw makeHttpError(
            `Respuesta vacía o inválida: se esperaba JSON (HTTP ${resp.status}).`,
            resp,
            rawText.slice(0, 600)
          );
        }

        // Si esta respuesta creó assets nuevos, invalida cache (historial/pickers)
        // (ej: /api/ai/video/*, /api/ai/video/fal/finalize)
        try {
          const createsAsset =
            path.startsWith("/api/ai/") &&
            (Boolean((data as any)?.assetId) || Array.isArray((data as any)?.items));
          if (createsAsset) invalidateMyAssetsCache();
        } catch {}

        return data as T;

      } catch (err: any) {
        // Cancel
        if (err?.name === "AbortError" || err?.isCanceled) {
          if (didTimeout) throw new Error(`Timeout: el servidor tardó más de ${timeoutMs}ms.`);
          throw makeCanceledError();
        }

        // Errores de red (fetch a veces lanza TypeError)
        const maybeNetwork = err instanceof TypeError;

        if (attempt < retries && maybeNetwork) {
          const backoff =
            retryBaseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
          await sleep(backoff, opts?.signal);
          continue;
        }

        throw err;
      }
    }

    throw new Error("Request failed after retries.");
  } finally {
    clearTimeout(t);
    if (opts?.signal) opts.signal.removeEventListener("abort", onExternalAbort as any);
  }
}

export async function waitFalJob(
  jobToken: string,
  opts?: {
    maxWaitMs?: number;
    signal?: AbortSignal;
    onProgress?: (msg: string) => void;
  }
) {
  const maxWaitMs = opts?.maxWaitMs ?? 60 * 60 * 1000; // 60 min
  const t0 = Date.now();

  let pollMs = 1500;

  while (true) {
    if (opts?.signal?.aborted) throw makeCanceledError();

    const elapsed = Math.round((Date.now() - t0) / 1000);
    opts?.onProgress?.(`Procesando (Fal) · ${elapsed}s`);

    let st: any;
    try {
     const st = await apiPostJson<any>(
        "/api/ai/video/fal/status",
        { jobToken },
        // subimos a 2 minutos; y si igual falla, NO marcamos failed por timeout
        { signal: opts?.signal, timeoutMs: 2 * 60 * 1000, retries: 2 }
      );
    } catch (err: any) {
      const msg = getErrMsg(err);
      const httpStatus = getStatus(err);

      const transient =
        msg.startsWith("Timeout:") ||
        httpStatus === 408 ||
        httpStatus === 429 ||
        httpStatus === 502 ||
        httpStatus === 503 ||
        httpStatus === 504;

      if (transient) {
        opts?.onProgress?.("Conexión lenta… reintentando.");
        await sleep(pollMs, opts?.signal);
        pollMs = Math.min(4500, pollMs + 500 + Math.floor(Math.random() * 250));
        continue;
      }

      throw err;
    }

    const status = st?.status;

    if (status === "COMPLETED") {
      opts?.onProgress?.("Finalizando…");
      return;
    }

    if (status === "FAILED") {
      throw new Error(st?.error || "Fal job FAILED");
    }

    if (Date.now() - t0 > maxWaitMs) {
      throw new Error("Timeout esperando Kling V3 (Fal).");
    }

    // backoff suave (evita spamear backend)
    await sleep(pollMs, opts?.signal);
    pollMs = Math.min(3500, pollMs + 250 + Math.floor(Math.random() * 150));
  }
}
