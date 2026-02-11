import React from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";
import type { KlingElement } from "../../../services/klingElementsService";

const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export function KlingElementsModal({
  open,
  onClose,
  elements,
  query,
  setQuery,
  selectedIds,
  setSelectedIds,
  onClear,
  imageAssets,
  hasFirstFrame,
  getAssetUrl,
}: {
  open: boolean;
  onClose: () => void;
  elements: KlingElement[];
  query: string;
  setQuery: (v: string) => void;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  onClear: () => void;
  imageAssets: Asset[];
  hasFirstFrame: boolean;
  getAssetUrl: (a: Asset) => string | null;
}) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Kling Elements</div>
          <button className={styles.modalClose} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className={styles.modalActions}>
          <input
            className={styles.search}
            placeholder="Search elements..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className={styles.swapBtn} onClick={onClear}>
            Clear
          </button>
        </div>

        <div className={styles.pickerGrid}>
          {elements
            .filter((el) => {
              const q = query.trim().toLowerCase();
              if (!q) return true;
              const t = `${el.elementName} ${el.elementDescription}`.toLowerCase();
              return t.includes(q);
            })
            .map((el) => {
              const selected = selectedIds.includes(el.id);
              const thumbAsset = imageAssets.find((a) => a.id === el.frontalAssetId) || null;
              const src = thumbAsset ? getAssetUrl(thumbAsset) || thumbAsset.url : PLACEHOLDER;

              return (
                <button
                  key={el.id}
                  type="button"
                  className={`${styles.pickerTile} ${selected ? styles.pickerTileActive : ""}`}
                  onClick={() => {
                    setSelectedIds((prev) => {
                      const has = prev.includes(el.id);
                      if (has) return prev.filter((x) => x !== el.id);
                      if (prev.length >= 5) return prev; // max 5
                      return [...prev, el.id];
                    });
                  }}
                >
                  <img src={src} alt={el.elementName} />
                  <div className={styles.pickerCap}>
                    {el.elementName}
                    {selected ? " ✓" : ""}
                  </div>
                </button>
              );
            })}
        </div>

        {!hasFirstFrame && (
          <div className={styles.modalNote}>Para usar Elements en Kling V3 primero debes cargar FIRST frame.</div>
        )}
      </div>
    </div>
  );
}
