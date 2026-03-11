import React, { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";
import { useGenerationQueue } from "../contexts/GenerationQueueContext";

function statusLabel(status: string) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "succeeded") return "Done";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return status;
}

export default function GenerationQueueWidget() {
  const { jobs, activeCount, maxActive, cancelJob, removeJob, clearFinished } = useGenerationQueue();
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => [...jobs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [jobs]);
  const visibleJobs = sorted.slice(0, 6);
  const finishedCount = jobs.filter(
    (job) => job.status === "succeeded" || job.status === "failed" || job.status === "canceled"
  ).length;

  if (!open && jobs.length === 0) return null;

  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] right-3 z-50 md:bottom-[calc(env(safe-area-inset-bottom)+5.6rem)] md:right-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[rgba(10,10,12,0.78)] text-white shadow-[0_14px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:bg-[rgba(15,15,18,0.9)]"
        title="Generation Queue"
      >
        {activeCount > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        <span className="absolute -right-1 -top-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-[rgba(241,225,148,0.98)] px-1.5 py-0.5 text-[10px] font-black text-black shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
          {activeCount > 0 ? activeCount : jobs.length}
        </span>
      </button>

      {open ? (
        <div className="mt-3 w-[320px] max-w-[84vw] overflow-hidden rounded-[26px] border border-white/10 bg-[rgba(8,8,10,0.94)] shadow-[0_26px_60px_rgba(0,0,0,0.44)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
            <div>
              <div className="text-sm font-black tracking-tight text-white">Generation Queue</div>
              <div className="mt-1 text-[11px] text-white/48">
                {activeCount} active · {finishedCount} finished · max {maxActive}
              </div>
            </div>

            {finishedCount > 0 ? (
              <button
                type="button"
                onClick={clearFinished}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/76 transition hover:bg-white/10"
              >
                Clear
              </button>
            ) : null}
          </div>

          {visibleJobs.length === 0 ? (
            <div className="px-4 py-5 text-sm text-white/52">No generations yet.</div>
          ) : (
            <div className="max-h-[340px] overflow-y-auto">
              {visibleJobs.map((job) => {
                const isFinished =
                  job.status === "succeeded" || job.status === "failed" || job.status === "canceled";

                return (
                  <div key={job.id} className="border-b border-white/6 px-4 py-4 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{job.label}</div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/58">
                          {job.status === "succeeded" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                          ) : job.status === "failed" || job.status === "canceled" ? (
                            <XCircle className="h-3.5 w-3.5 text-rose-300" />
                          ) : (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-white/74" />
                          )}
                          <span>{statusLabel(job.status)}</span>
                          {job.progressText && job.status === "running" ? (
                            <span className="truncate text-white/42">· {job.progressText}</span>
                          ) : null}
                        </div>
                        {job.error ? <div className="mt-2 text-[11px] text-rose-200/78">{job.error}</div> : null}
                      </div>

                      <div className="shrink-0">
                        {isFinished ? (
                          <button
                            type="button"
                            onClick={() => removeJob(job.id)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/76 transition hover:bg-white/10"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => cancelJob(job.id)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/76 transition hover:bg-white/10"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
