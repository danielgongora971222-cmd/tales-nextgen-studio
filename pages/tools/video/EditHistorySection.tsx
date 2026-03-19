import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import { AppRoute, type Asset } from "../../../types";
import ToolExitMenu from "../../../components/ToolExitMenu";
import { Icon } from "./icon";
import { shortText } from "./text";
import {
  finalizeVideoStill,
  prepareVideoPreview,
  primeVideoStill,
  resetVideoStill,
  startVideoHoverPreview,
} from "./videoPreview";


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
  onToggleLike?: (asset: Asset) => void;
  likeBusyById?: Record<string, boolean>;
  onTogglePublish?: (asset: Asset) => void;
  onDownload: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
  onShowError: (message: string) => void;
  hoverVideoEls: React.MutableRefObject<Record<string, HTMLVideoElement | null>>;
  onBeforeNavigate?: (route: AppRoute) => void;
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
  onToggleLike,
  likeBusyById = {},
  onTogglePublish,
  onDownload,
  onDelete,
  onShowError,
  hoverVideoEls,
  onBeforeNavigate,
}: Props) {
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
          <ToolExitMenu
            className={styles.closeHomeBtn}
            title="Close"
            ariaLabel="Open tool exit menu"
            onBeforeNavigate={onBeforeNavigate}
          >
            ×
          </ToolExitMenu>
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
              <div key={id} className={`${styles.tile} ${styles.tilePending}`} aria-label="Generating video...">
                <div className={styles.pendingFrame}>
                  <div className={styles.pendingShimmer} />
                  <div className={styles.pendingSpinner} />
                  <div className={styles.pendingLabel}>GENERATING</div>
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
                    startVideoHoverPreview(hoverVideoEls.current[asset.id]);
                  }}
                  onMouseLeave={() => {
                    resetVideoStill(hoverVideoEls.current[asset.id]);
                  }}
                >
                  <button className={styles.tileMediaBtn} type="button" onClick={() => onOpenViewer(asset)} title="Open">
                    <video
                      ref={(el) => {
                        hoverVideoEls.current[asset.id] = el;
                        if (el) {
                          prepareVideoPreview(el);
                        }
                      }}
                      className={styles.tileMedia}
                      src={asset.url}
                      muted
                      playsInline
                      loop
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        prepareVideoPreview(e.currentTarget);
                        primeVideoStill(e.currentTarget);
                      }}
                      onLoadedData={(e) => primeVideoStill(e.currentTarget)}
                      onCanPlay={(e) => primeVideoStill(e.currentTarget)}
                      onCanPlayThrough={(e) => primeVideoStill(e.currentTarget)}
                      onSeeked={(e) => finalizeVideoStill(e.currentTarget)}
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
                      {onToggleLike ? (
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnHeart} ${asset.likedByMe ? styles.iconBtnHeartActive : ""}`}
                          title={asset.likedByMe ? "Quitar Like" : "Dar Like"}
                          disabled={Boolean(likeBusyById[asset.id])}
                          onClick={() => onToggleLike(asset)}
                        >
                          <Icon name="heart" />
                        </button>
                      ) : null}

                      {onTogglePublish ? (
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnMoney} ${isPublished ? styles.iconBtnOn : ""}`}
                          title="Vender / Administrar listing"
                          onClick={() => onTogglePublish(asset)}
                        >
                          <Icon name="money" />
                        </button>
                      ) : null}

                      <button type="button" className={styles.iconBtn} title="Download" onClick={() => onDownload(asset)}>
                        <Icon name="download" />
                      </button>

                      <button type="button" className={styles.iconBtnDanger} title="Delete" onClick={() => onDelete(asset)}>
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
