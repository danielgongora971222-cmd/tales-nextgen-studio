import { useCallback, useMemo, useRef, useState } from "react";
import { invalidateMyAssetsCache } from "../services/assetsApi";
import { waitJobCompletion } from "../services/jobsApi";
import type { AsyncImageJobHooks } from "../services/geminiService";

type PendingImageToolJob = {
  jobId: string;
  tool: string;
  prompt: string;
  pendingSlotsCount: number;
  createdAt: number;
};

type UsePendingImageToolJobsArgs = {
  userId: string | null | undefined;
  tool: string;
  onCompleted?: () => Promise<void> | void;
  onError?: (error: any) => void;
};

const STORAGE_PREFIX = "tales_pending_image_tool_jobs_v1";

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function readPendingJobs(userId: string): PendingImageToolJob[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) =>
        x &&
        typeof x.jobId === "string" &&
        typeof x.tool === "string" &&
        typeof x.prompt === "string" &&
        typeof x.pendingSlotsCount === "number"
    ) as PendingImageToolJob[];
  } catch {
    return [];
  }
}

function writePendingJobs(userId: string, jobs: PendingImageToolJob[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(jobs));
  } catch {}
}

function upsertPendingJob(userId: string, job: PendingImageToolJob) {
  const prev = readPendingJobs(userId);
  const next = prev.filter((x) => x.jobId !== job.jobId);
  next.unshift(job);
  writePendingJobs(userId, next.slice(0, 50));
}

function removePendingJob(userId: string, jobId: string) {
  const prev = readPendingJobs(userId);
  const next = prev.filter((x) => x.jobId !== jobId);
  writePendingJobs(userId, next);
}

function formatImageJobFailure(row: any): string {
  const params = row?.params || {};
  const code = params?.errorCode ? `${params.errorCode}: ` : "";
  const details = params?.errorDetails
    ? `\n\nDetalles:\n${JSON.stringify(params.errorDetails, null, 2)}`
    : "";

  return `${code}${row?.error || "Falló el job de imagen."}${details}`;
}

function buildSlots(jobs: PendingImageToolJob[], localPendingCount: number) {
  const storageSlots = jobs.flatMap((job) =>
    Array.from({ length: Math.max(1, Number(job.pendingSlotsCount) || 1) }, (_, i) => `pending-${job.jobId}-${i}`)
  );

  if (!storageSlots.length && localPendingCount > 0) {
    return Array.from({ length: localPendingCount }, (_, i) => `pending-local-${i}`);
  }

  return storageSlots;
}

export function usePendingImageToolJobs({ userId, tool, onCompleted, onError }: UsePendingImageToolJobsArgs) {
  const [localPendingCount, setLocalPendingCount] = useState(0);
  const [storageTick, setStorageTick] = useState(0);
  const resumingRef = useRef(false);

  const refresh = useCallback(() => {
    setStorageTick((x) => x + 1);
  }, []);

  const jobs = useMemo(() => {
    if (!userId) return [];
    return readPendingJobs(userId).filter((x) => x.tool === tool);
  }, [userId, tool, storageTick]);

  const pendingSlots = useMemo(() => buildSlots(jobs, localPendingCount), [jobs, localPendingCount]);

  const startLocalPending = useCallback((count: number) => {
    setLocalPendingCount(Math.max(1, Number(count) || 1));
  }, []);

  const clearLocalPending = useCallback(() => {
    setLocalPendingCount(0);
  }, []);

  const makeAsyncHooks = useCallback(
    (prompt: string, pendingSlotsCount: number): AsyncImageJobHooks => ({
      onJobQueued: ({ jobId }) => {
        if (!userId) return;
        upsertPendingJob(userId, {
          jobId,
          tool,
          prompt,
          pendingSlotsCount: Math.max(1, Number(pendingSlotsCount) || 1),
          createdAt: Date.now(),
        });
        refresh();
      },
      onJobSettled: (jobId) => {
        if (!userId) return;
        removePendingJob(userId, jobId);
        refresh();
      },
    }),
    [userId, tool, refresh]
  );

  const resumePendingJobs = useCallback(async () => {
    if (!userId) {
      clearLocalPending();
      refresh();
      return;
    }

    if (resumingRef.current) return;

    const pending = readPendingJobs(userId).filter((x) => x.tool === tool);
    if (!pending.length) {
      clearLocalPending();
      refresh();
      return;
    }

    resumingRef.current = true;
    let completedAny = false;

    try {
      for (const job of pending) {
        const row = await waitJobCompletion(job.jobId, { pollMs: 15_000 });

        if (row.status === "failed") {
          removePendingJob(userId, job.jobId);
          refresh();
          throw new Error(formatImageJobFailure(row));
        }

        removePendingJob(userId, job.jobId);
        completedAny = true;
        refresh();
      }

      if (completedAny) {
        invalidateMyAssetsCache("image");
        await onCompleted?.();
      }
    } catch (error) {
      onError?.(error);
    } finally {
      clearLocalPending();
      refresh();
      resumingRef.current = false;
    }
  }, [userId, tool, onCompleted, onError, refresh, clearLocalPending]);

  return {
    jobs,
    pendingSlots,
    startLocalPending,
    clearLocalPending,
    makeAsyncHooks,
    resumePendingJobs,
    hasPending: pendingSlots.length > 0,
  };
}