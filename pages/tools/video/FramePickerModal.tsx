import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { shortText } from "./text";

type FrameSlotKey = "first" | "last";

export function FramePickerModal({
  open,
  slot,
  query,
  setQuery,
  isLoading,
  visibleAssets,
  totalCount,
  hasMore,
  onLoadMore,
  onClose,
  onPick,
  onUpload,
  hasFirst,
  getAssetUrl,
}: {
  open: boolean;
  slot: FrameSlotKey;
  query: string;
  setQuery: (v: string) => void;
  isLoading: boolean;
  visibleAssets: Asset[];
  totalCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onClose: () => void;
  onPick: (a: Asset) => void;
  onUpload: (file: File) => void;
  hasFirst: boolean;
  getAssetUrl: (a: Asset) => string | null;
}) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Pick {slot === "first" ? "FIRST" : "LAST"} Frame</div>
          <button className={styles.modalClose} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className={styles.modalActions}>
          <input
            className={styles.search}
            placeholder="Search in history..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <label className={styles.uploadBtn}>
            Upload
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {hasMore && (
          <div className={styles.pickerLoadMoreWrap}>
            <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore}>
              Cargar más
            </button>
            <div className={styles.loadMoreHint}>
              Mostrando {visibleAssets.length} de {totalCount}
            </div>
          </div>
        )}

        <div className={styles.pickerGrid}>
          {isLoading ? (
            <div className={styles.pickerEmpty}>Cargando imágenes…</div>
          ) : visibleAssets.length === 0 ? (
            <div className={styles.pickerEmpty}>No hay imágenes en tu historial. Genera una imagen o usa Upload.</div>
          ) : (
            visibleAssets.map((a) => (
              <button key={a.id} type="button" className={styles.pickerTile} onClick={() => onPick(a)}>
                <img src={getAssetUrl(a) || a.url} alt={a.name} />
                <div className={styles.pickerCap}>{shortText(a.prompt || a.name, 56)}</div>
              </button>
            ))
          )}
        </div>

        {slot === "last" && !hasFirst && (
          <div className={styles.modalNote}>LAST está bloqueado: primero carga FIRST.</div>
        )}
      </div>
    </div>
  );
}
