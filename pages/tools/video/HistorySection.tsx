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

export function HistorySection({
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
          <span className={styles.kicker}>VIDEO GENERATOR</span>
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
              <div className={styles.emptyCode}>NO GENERATIONS</div>
              <div className={styles.emptyText}>Genera tu primer video para ver el historial aquí.</div>
            </div>
          </div>
        ) : (
          <div className={styles.grid}>
            {pendingSlots.map((id) => (
              <div key={id} className={`${styles.tile} ${styles.tilePending}`} aria-label="Generating...">
                <div className={styles.pendingFrame}>
                  <div className={styles.pendingShimmer} />
                  <div className={styles.pendingSpinner} />
                  <div className={styles.pendingLabel}>GENERATING</div>
                </div>
              </div>
            ))}

            {visibleHistory.map((asset) => {
              const caption = shortText((asset.prompt || asset.name || "—").trim(), 70);

              return (
                <button
                  key={asset.id}
                  type="button"
                  className={styles.tile}
                  onClick={() => onOpenViewer(asset)}
                  title="Click para ver detalles"
                  onMouseEnter={() => {
                    const el = hoverVideoEls.current[asset.id];
                    if (el) {
                      el.currentTime = 0;
                      el.play().catch(() => {});
                    }
                  }}
                  onMouseLeave={() => {
                    const el = hoverVideoEls.current[asset.id];
                    if (el) {
                      el.pause();
                      el.currentTime = 0;
                    }
                  }}
                >
                  <video
                    ref={(el) => {
                      hoverVideoEls.current[asset.id] = el;
                    }}
                    className={styles.tileVideo}
                    src={asset.url}
                    muted
                    playsInline
                    preload="metadata"
                  />

                  <div className={styles.tileMeta}>
                    <span className={styles.tileCaption}>{caption}</span>
                    {asset.isPublic && <span className={styles.publicTag}>PUBLIC</span>}
                  </div>

                  <div className={styles.tileActions} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Favoritos (próximamente)"
                      onClick={() => onShowError("Favoritos (Like) se habilita en el paso de Mis Creaciones / Favoritos.")}
                    >
                      <Icon name="heart" />
                    </button>

                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="Vender / Administrar listing"
                      onClick={() => onTogglePublish(asset)}
                    >
                      <Icon name="share" />
                    </button>

                    <button type="button" className={styles.iconBtn} title="Descargar" onClick={() => onDownload(asset)}>
                      <Icon name="download" />
                    </button>

                    <button type="button" className={styles.iconBtnDanger} title="Eliminar" onClick={() => onDelete(asset)}>
                      <Icon name="trash" />
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className={styles.historyLoadMoreWrap}>
            <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "Cargando..." : "Cargar más"}
            </button>
            <div className={styles.loadMoreHint}>
              Mostrando {visibleHistory.length} de {totalCount}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
