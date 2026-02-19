import React, { useMemo, useState } from "react";
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

  const sorted = useMemo(() => {
    return [...jobs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [jobs]);

  const top = sorted.slice(0, 8);

  const hasFinished = jobs.some((j) => j.status === "succeeded" || j.status === "failed" || j.status === "canceled");

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="glass-panel border border-white/10 rounded-2xl px-4 py-3 shadow-2xl hover:scale-[1.02] transition-transform"
        title="Generation Queue"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tracking-widest text-white/80">QUEUE</span>
          <span className="text-xs text-white/60">
            {activeCount}/{maxActive}
          </span>
          <span className="w-2 h-2 rounded-full bg-white/70" />
        </div>
      </button>

      {open && (
        <div className="mt-3 w-[360px] max-w-[90vw] glass-panel border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold tracking-tight">Generations</div>
              <div className="text-[11px] text-white/50">Max active: {maxActive}. Active now: {activeCount}.</div>
            </div>

            {hasFinished && (
              <button
                type="button"
                onClick={clearFinished}
                className="text-[11px] px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                Clear finished
              </button>
            )}
          </div>

          {top.length === 0 ? (
            <div className="p-4 text-sm text-white/50">No jobs yet.</div>
          ) : (
            <div className="max-h-[340px] overflow-auto">
              {top.map((j) => (
                <div key={j.id} className="px-4 py-3 border-b border-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold truncate">{j.label}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-white/60">{statusLabel(j.status)}</span>
                        {j.progressText && j.status === "running" && (
                          <span className="text-[11px] text-white/40 truncate">{j.progressText}</span>
                        )}
                      </div>

                      {j.status === "failed" && j.error && (
                        <div className="mt-2 text-[11px] text-red-200/80 whitespace-pre-wrap">{j.error}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {(j.status === "queued" || j.status === "running") && (
                        <button
                          type="button"
                          onClick={() => cancelJob(j.id)}
                          className="text-[11px] px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                      {(j.status === "succeeded" || j.status === "failed" || j.status === "canceled") && (
                        <button
                          type="button"
                          onClick={() => removeJob(j.id)}
                          className="text-[11px] px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {jobs.length > top.length && (
                <div className="px-4 py-3 text-[11px] text-white/40">Showing latest {top.length} of {jobs.length}.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
