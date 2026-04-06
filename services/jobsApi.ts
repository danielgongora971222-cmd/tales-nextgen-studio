import { supabase } from "./supabaseClient";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobRow = {
  id: string;
  owner_id: string;
  kind: string;
  status: JobStatus;
  params: any;
  result_asset_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  next_check_at?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
};

export function formatJobFailure(
  row: Partial<JobRow> | null | undefined,
  fallback = "Falló el job en background."
): string {
  const params: any = row?.params || {};
  const code = params?.errorCode ? `${params.errorCode}: ` : "";

  const mainMessage = String(
    row?.error ||
      params?.providerStatusMsg ||
      params?.providerStatusDetail ||
      fallback
  ).trim();

  const extra: string[] = [];

  const providerStatus = String(
    params?.providerStatusNormalized || params?.providerStatus || ""
  ).trim();
  if (providerStatus) {
    extra.push(`Estado proveedor: ${providerStatus}`);
  }

  if (params?.errorDetails) {
    try {
      extra.push(`Detalles:\n${JSON.stringify(params.errorDetails, null, 2)}`);
    } catch {
      extra.push(`Detalles:\n${String(params.errorDetails)}`);
    }
  }

  return `${code}${mainMessage}${extra.length ? `\n\n${extra.join("\n")}` : ""}`.trim();
}

type PiapiRecoveredAsset = {
  id: string;
  url: string | null;
  created_at: string;
  meta: any;
};

function getPiapiTaskId(row: JobRow | null | undefined): string {
  return String(row?.params?.taskId || row?.params?.piapiTaskId || "").trim();
}

function isRecoverablePiapiRow(row: JobRow | null | undefined): boolean {
  if (!row) return false;
  if (row.status !== "queued" && row.status !== "running") return false;
  if (row.result_asset_id) return false;
  return String(row?.params?.provider || "").trim().toLowerCase() === "piapi" && Boolean(getPiapiTaskId(row));
}

async function findOwnRecoveredPiapiAsset(taskId: string): Promise<PiapiRecoveredAsset | null> {
  const cleanTaskId = String(taskId || "").trim();
  if (!cleanTaskId) return null;

  const { data, error } = await supabase
    .from("assets")
    .select("id, url, created_at, meta")
    .eq("type", "video")
    .filter("meta->>piapiTaskId", "eq", cleanTaskId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && (error as any).code !== "PGRST116") throw error;
  return (data || null) as any;
}

async function recoverPiapiRowIfPossible(row: JobRow | null): Promise<JobRow | null> {
  if (!isRecoverablePiapiRow(row)) return row;

  const taskId = getPiapiTaskId(row);
  const asset = await findOwnRecoveredPiapiAsset(taskId);
  if (!asset?.id) return row;

  return {
    ...row,
    status: "succeeded",
    result_asset_id: asset.id,
    error: null,
    finished_at: row.finished_at || asset.created_at,
    params: {
      ...(row.params || {}),
      providerRecoveredAssetId: asset.id,
      providerFinalizePath: row?.params?.providerFinalizePath || "piapi-client-recovery",
      ...(asset?.url ? { resultUrl: asset.url } : {}),
    },
  } as JobRow;
}

export async function fetchJobById(jobId: string): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, owner_id, kind, status, params, result_asset_id, error, created_at, updated_at, finished_at, next_check_at, locked_at, locked_by"
    )
    .eq("id", jobId)
    .maybeSingle();

  // PGRST116 = 0 rows con maybeSingle()
  if (error && (error as any).code !== "PGRST116") throw error;
  return await recoverPiapiRowIfPossible((data || null) as any);
}

export async function findRecentRunningKlingJob({
  model,
  prompt,
  windowMs = 2 * 60 * 1000,
}: {
  model: string;
  prompt: string;
  windowMs?: number;
}): Promise<JobRow | null> {
  const sinceIso = new Date(Date.now() - windowMs).toISOString();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, owner_id, kind, status, params, result_asset_id, error, created_at, updated_at, finished_at, next_check_at, locked_at, locked_by"
    )
    .eq("kind", "video")
    .eq("status", "running")
    .filter("params->>provider", "eq", "kling")
    .filter("params->>model", "eq", model)
    .filter("params->>prompt", "eq", prompt)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // PGRST116 = 0 rows con maybeSingle()
  if (error && (error as any).code !== "PGRST116") throw error;

  return (data || null) as any;
}

export async function listMyActiveVideoJobs(opts?: {
  limit?: number;
  activeWindowMs?: number;
}): Promise<JobRow[]> {
  const limit = Math.max(1, Math.min(50, Number(opts?.limit || 20)));
  const activeWindowMs = Math.max(60_000, Number(opts?.activeWindowMs || 45 * 60 * 1000));
  const sinceIso = new Date(Date.now() - activeWindowMs).toISOString();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, owner_id, kind, status, params, result_asset_id, error, created_at, updated_at, finished_at, next_check_at, locked_at, locked_by"
    )
    .eq("kind", "video")
    .in("status", ["queued", "running"])
    .is("result_asset_id", null)
    .gte("updated_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = Array.isArray(data) ? ((data as any) as JobRow[]) : [];
  const recovered = await Promise.all(rows.map((row) => recoverPiapiRowIfPossible(row)));
  return recovered.filter((row): row is JobRow => Boolean(row) && (row.status === "queued" || row.status === "running"));
}

export function subscribeJobById({
  jobId,
  onUpsert,
}: {
  jobId: string;
  onUpsert: (row: JobRow) => void;
}) {
  const channel = supabase
    .channel(`jobs:${jobId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "jobs",
        filter: `id=eq.${jobId}`,
      },
      (payload) => {
        const next = (payload as any)?.new || null;
        if (!next) return;
        onUpsert(next as JobRow);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
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

/**
 * Espera a que un job (public.jobs) termine.
 * - Usa realtime para enterarse rápido.
 * - Tiene polling “suave” como backup (por si realtime se cae).
 */
export async function waitJobCompletion(
  jobId: string,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (msg: string) => void;
    pollMs?: number;
  }
): Promise<JobRow> {
  const pollMs = Math.max(5_000, Number(opts?.pollMs || 15_000));

  const startedAt = Date.now();
  let lastRow: JobRow | null = await fetchJobById(jobId);

  const isTerminal = (row: JobRow | null) =>
    row && (row.status === "succeeded" || row.status === "failed");

  if (isTerminal(lastRow)) return lastRow as JobRow;

  let unsub: null | (() => void) = null;
  try {
    const p = new Promise<JobRow>(async (resolve, reject) => {
      const done = (row: JobRow) => {
        if (unsub) {
          try { unsub(); } catch {}
          unsub = null;
        }
        resolve(row);
      };

      const fail = (err: any) => {
        if (unsub) {
          try { unsub(); } catch {}
          unsub = null;
        }
        reject(err);
      };

      unsub = subscribeJobById({
        jobId,
        onUpsert: (row) => {
          lastRow = row;

          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          const providerStatus =
            (row?.params as any)?.providerStatus || (row?.params as any)?.lastStatus;

          opts?.onProgress?.(
            providerStatus
              ? `Procesando (background) · ${providerStatus} · ${elapsed}s`
              : `Procesando (background) · ${elapsed}s`
          );

          if (isTerminal(row)) done(row);
        },
      });

      // backup polling
      while (true) {
        if (opts?.signal?.aborted) return fail(makeCanceledError());
        await sleep(pollMs, opts?.signal);

        const row = await fetchJobById(jobId);
        if (row) lastRow = row;
        if (isTerminal(row)) return done(row as JobRow);
      }
    });

    return await p;
  } finally {
    if (unsub) {
      try { unsub(); } catch {}
    }
  }
}