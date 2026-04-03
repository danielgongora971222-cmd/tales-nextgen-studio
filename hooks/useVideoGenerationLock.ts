import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGenerationQueue } from "../contexts/GenerationQueueContext";
import { listMyActiveVideoJobs, type JobRow } from "../services/jobsApi";

export const VIDEO_SLOT_BUSY_MESSAGE =
  "Ya tienes un video en proceso. Espera a que termine antes de lanzar otro.";

export const SEEDANCE_REPAIR_MESSAGE =
  "Seedance 2.0 está temporalmente en reparación. Usa Kling o Veo mientras terminamos el ajuste.";

export function useVideoGenerationLock(opts?: {
  pollMs?: number;
  activeWindowMs?: number;
}) {
  const { user } = useAuth();
  const { jobs } = useGenerationQueue();

  const pollMs = Math.max(4_000, Number(opts?.pollMs || 8_000));
  const activeWindowMs = Math.max(60_000, Number(opts?.activeWindowMs || 45 * 60 * 1000));

  const [remoteJobs, setRemoteJobs] = useState<JobRow[]>([]);

  const refresh = useCallback(async () => {
    if (!user) {
      setRemoteJobs([]);
      return;
    }

    try {
      const rows = await listMyActiveVideoJobs({ limit: 20, activeWindowMs });
      setRemoteJobs(rows);
    } catch {
      setRemoteJobs([]);
    }
  }, [activeWindowMs, user]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!user) {
        if (!cancelled) setRemoteJobs([]);
        return;
      }

      try {
        const rows = await listMyActiveVideoJobs({ limit: 20, activeWindowMs });
        if (!cancelled) setRemoteJobs(rows);
      } catch {
        if (!cancelled) setRemoteJobs([]);
      }
    };

    void load();

    if (typeof window === "undefined") {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void load();
    }, pollMs);

    const onFocus = () => {
      void load();
    };

    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [activeWindowMs, pollMs, user]);

  const localJobs = useMemo(
    () => jobs.filter((job) => job.type === "video_generate" && (job.status === "queued" || job.status === "running")),
    [jobs]
  );

  const localActiveCount = localJobs.length;
  const remoteActiveCount = remoteJobs.length;
  const hasActiveVideoJob = localActiveCount > 0 || remoteActiveCount > 0;

  return {
    hasActiveVideoJob,
    activeVideoJobCount: Math.max(localActiveCount, remoteActiveCount),
    busyMessage: hasActiveVideoJob ? VIDEO_SLOT_BUSY_MESSAGE : null,
    refresh,
    localJobs,
    remoteJobs,
  };
}
