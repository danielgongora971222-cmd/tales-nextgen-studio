import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { Icon } from "./icon";
import { shortText } from "./text";

type Props = {
  isLoading: boolean;
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
  return (
    <div className={styles.stage}>
      <div className={styles.historyHeader}>
        <div className={styles.historyTitle}>
          <span className={styles.kicker}>EDIT VIDEO</span>
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

        <button className={styles.ghostBtn} onClick={onRefresh} type="button" disabled={isLoading}>
          Refresh
        </button>
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
                      el.currentTime = 0;
                      el.play().catch(() => {});
                    }
                  }}
                  onMouseLeave={() => {
                    const el = hoverVideoEls.current[asset.id];
                    if (el) el.pause();
                  }}
                >
                  <button className={styles.tileMediaBtn} type="button" onClick={() => onOpenViewer(asset)} title="Open">
                    <video
                      ref={(el) => {
                        hoverVideoEls.current[asset.id] = el;
                      }}
                      className={styles.tileMedia}
                      src={asset.url}
                      muted
                      playsInline
                      loop
                      preload="metadata"
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
                        title={isPublished ? "Unpublish" : "Publish"}
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
