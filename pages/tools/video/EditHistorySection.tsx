import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { AppRoute, type Asset } from "../../../types";
import { Icon } from "./icon";
import { shortText } from "./text";


const getPosterSeekTime = (video: HTMLVideoElement) => {
  const saved = Number(video.dataset.posterTime || "");
  if (Number.isFinite(saved) && saved > 0) return saved;
  const duration = Number(video.duration || 0);
  if (Number.isFinite(duration) && duration > 0) {
    return Math.max(0.04, Math.min(0.18, duration / 12));
  }
  return 0.08;
};

const primeHistoryVideoFrame = (video: HTMLVideoElement | null) => {
  if (!video) return;
  if (video.dataset.posterPrimed === "true" || video.dataset.posterPriming === "true") return;
  video.dataset.posterPriming = "true";
  const targetTime = getPosterSeekTime(video);
  video.dataset.posterTime = String(targetTime);
  try {
    video.currentTime = targetTime;
  } catch {
    video.dataset.posterPriming = "false";
  }
};

const finalizeHistoryVideoFrame = (video: HTMLVideoElement | null) => {
  if (!video) return;
  if (video.dataset.posterPriming !== "true") return;
  video.pause();
  video.dataset.posterPriming = "false";
  video.dataset.posterPrimed = "true";
};

const resetHistoryVideoFrame = (video: HTMLVideoElement | null) => {
  if (!video) return;
  video.pause();
  const targetTime = getPosterSeekTime(video);
  try {
    video.currentTime = targetTime;
  } catch {
    try {
      video.currentTime = 0;
    } catch {}
  }
};

type Props = {
  isLoading: boolean;
  isCookOpen?: boolean;
  title?: string;
  pendingSlots: string[];
  totalCount: number;
  visibleHistory: Asset[];
  hasMore: boolean;
  isLoadingMore: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenViewer: (asset: Asset) => void;
  onTogglePublish: (asset: Asset) => void;
  onDownload: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
  onShowError: (message: string) => void;
  hoverVideoEls: React.MutableRefObject<Record<string, HTMLVideoElement | null>>;
};

export function EditHistorySection({
  isLoading,
  isCookOpen = false,
  title = "EDIT VIDEO",
  pendingSlots,
  totalCount,
  visibleHistory,
  hasMore,
  isLoadingMore,
  onRefresh,
  onLoadMore,
  onOpenViewer,
  onTogglePublish,
  onDownload,
  onDelete,
  onShowError,
  hoverVideoEls,
}: Props) {
  const goHome = () => window.dispatchEvent(new CustomEvent("tales:navigate", { detail: { route: AppRoute.HOME } }));

  return (
    <div className={`${styles.stage} ${isCookOpen ? styles.stageCookOpen : ""}`}>
      <div className={`${styles.historyHeader} ${isCookOpen ? styles.historyHeaderCookOpen : ""}`}>
        <div className={styles.historyTitle}>
          <span className={styles.kicker}>{title}</span>
          <div className={styles.historyMeta}>
            {isLoading ? (
              <span className={styles.subKicker}>Loading history...</span>
            ) : (
              <>
                <span className={styles.subKicker}>History</span>
                <span className={styles.historyCount}>{totalCount}</span>
              </>
            )}
          </div>
        </div>

        <div className={styles.historyActions}>
          <button className={styles.ghostBtn} onClick={onRefresh} type="button" disabled={isLoading}>
            Refresh
          </button>
          <button className={styles.closeHomeBtn} onClick={goHome} type="button" aria-label="Close tool and go home" title="Close">
            ×
          </button>
        </div>
      </div>

      <div className={styles.historyGrid}>
        {isLoading ? (
          <div className={styles.historyLoading}>Cargando historial…</div>
        ) : totalCount === 0 && pendingSlots.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyAnimator}>
              <div className={styles.emptyGrid} />
              <div className={styles.emptyGlow} />
              <div className={styles.emptyScan} />
              <div className={styles.emptyOrb} />
            </div>
            <div className={styles.emptyCopy}>
              <div className={styles.emptyCode}>NO EDITS YET</div>
              <div className={styles.emptyText}>Edita tu primer video para ver el historial aquí.</div>
            </div>
          </div>
        ) : (
          <div className={styles.grid}>
            {pendingSlots.map((id) => (
              <div key={id} className={`${styles.tile} ${styles.tilePending}`}>
                <div className={styles.tilePendingMedia} />
                <div className={styles.tileMeta}>
                  <div className={styles.tileTitle}>Processing…</div>
                  <div className={styles.tileSub}>Fal / Kling</div>
                </div>
              </div>
            ))}

            {visibleHistory.map((asset) => {
              const meta: any = (asset as any).meta || {};
              const isPublished = Boolean(meta?.published);

              return (
                <div
                  key={asset.id}
                  className={styles.tile}
                  onMouseEnter={() => {
                    const el = hoverVideoEls.current[asset.id];
                    if (el) {
                      try {
                        el.currentTime = 0;
                      } catch {}
                      el.play().catch(() => {});
                    }
                  }}
                  onMouseLeave={() => {
                    resetHistoryVideoFrame(hoverVideoEls.current[asset.id]);
                  }}
                >
                  <button className={styles.tileMediaBtn} type="button" onClick={() => onOpenViewer(asset)} title="Open">
                    <video
                      ref={(el) => {
                        hoverVideoEls.current[asset.id] = el;
                        if (el) {
                          primeHistoryVideoFrame(el);
                        }
                      }}
                      className={styles.tileMedia}
                      src={asset.url}
                      muted
                      playsInline
                      loop
                      preload="auto"
                      onLoadedMetadata={(e) => primeHistoryVideoFrame(e.currentTarget)}
                      onCanPlay={(e) => primeHistoryVideoFrame(e.currentTarget)}
                      onSeeked={(e) => finalizeHistoryVideoFrame(e.currentTarget)}
                    />
                    <div className={styles.playOverlay} />
                  </button>

                  <div className={styles.tileMeta}>
                    <div className={styles.tileTitle} title={String((asset as any).name || asset.id)}>
                      {shortText(String((asset as any).name || "Untitled"), 42)}
                    </div>
                    <div className={styles.tileSub}>
                      {meta?.model ? shortText(String(meta.model), 32) : "—"}
                      {meta?.durationSeconds != null ? ` · ${meta.durationSeconds}s` : ""}
                    </div>

                    <div className={styles.tileActions}>
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${isPublished ? styles.iconBtnOn : ""}`}
                        title="Vender / Administrar listing"
                        onClick={() => onTogglePublish(asset)}
                      >
                        <Icon name="share" />
                      </button>

                      <button type="button" className={styles.iconBtn} title="Download" onClick={() => onDownload(asset)}>
                        <Icon name="download" />
                      </button>

                      <button type="button" className={styles.iconBtn} title="Delete" onClick={() => onDelete(asset)}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className={styles.loadMore}>
            <button className={styles.ghostBtn} type="button" onClick={onLoadMore} disabled={isLoadingMore} title="Load more">
              {isLoadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
