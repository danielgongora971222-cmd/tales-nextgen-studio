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
  return (data || null) as any;
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