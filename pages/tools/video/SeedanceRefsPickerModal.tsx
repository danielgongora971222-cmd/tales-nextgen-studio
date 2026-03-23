import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";

type Props = {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  historyAssets: Asset[];
  elementAssets: Asset[];
  max: number;
  isLoading?: boolean;
  onUpload: (file: File) => Promise<Asset>;
  getAssetUrl: (a: Asset) => string | null;
  title?: string;
  note?: React.ReactNode;
};

type TabKey = "history" | "elements";

const INITIAL_COUNT = 36;
const LOAD_MORE_COUNT = 36;

function sortNewestFirst(items: Asset[]) {
  return [...(items || [])].sort((a: any, b: any) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

export function SeedanceRefsPickerModal({
  open,
  onClose,
  selectedIds,
  setSelectedIds,
  historyAssets,
  elementAssets,
  max,
  isLoading,
  onUpload,
  getAssetUrl,
  title,
  note,
}: Props) {
  const [tab, setTab] = useState<TabKey>("history");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("history");
    setQuery("");
    setVisibleCount(INITIAL_COUNT);
  }, [open]);

  const sourceAssets = useMemo(
    () => (tab === "elements" ? sortNewestFirst(elementAssets || []) : sortNewestFirst(historyAssets || [])),
    [tab, historyAssets, elementAssets]
  );

  const filteredAssets = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return sourceAssets;
    return sourceAssets.filter((asset: any) => {
      const haystack = [
        String(asset?.name || ""),
        String(asset?.hint || ""),
        String(asset?.id || ""),
        JSON.stringify(asset?.meta || {}),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sourceAssets, query]);

  const visibleAssets = useMemo(() => filteredAssets.slice(0, visibleCount), [filteredAssets, visibleCount]);
  const hasMore = filteredAssets.length > visibleAssets.length;

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>{title || "Seedance Refs"}</div>
          <button className={styles.modalClose} onClick={onClose} type="button" title="Cerrar">
            ×
          </button>
        </div>

        <div className={styles.modalActions}>
          <div className={styles.segment} style={{ flexShrink: 0 }}>
            <button
              type="button"
              className={`${styles.segmentBtn} ${tab === "history" ? styles.segmentBtnActive : ""}`}
              onClick={() => setTab("history")}
            >
              History
            </button>
            <button
              type="button"
              className={`${styles.segmentBtn} ${tab === "elements" ? styles.segmentBtnActive : ""}`}
              onClick={() => setTab("elements")}
            >
              Elements
            </button>
          </div>

          <input
            className={styles.search}
            placeholder={tab === "elements" ? "Buscar elements…" : "Buscar imágenes…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <button
            className={styles.uploadBtn}
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            title="Subir imagen"
          >
            {isUploading ? "UPLOADING…" : "UPLOAD"}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setIsUploading(true);
                const uploaded = await onUpload(file);
                setTab("history");
                setSelectedIds((prev) => {
                  if (prev.includes(uploaded.id)) return prev;
                  if (prev.length >= max) return prev;
                  return [uploaded.id, ...prev];
                });
              } catch (error) {
                console.warn(error);
              } finally {
                setIsUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }
            }}
          />
        </div>

        <div className={styles.noteSmall} style={{ padding: "0 14px 10px" }}>
          {note ?? (
            <>
              Seleccionadas: <b>{selectedIds.length}</b> / {max}. Seedance admite hasta 9 imágenes totales contando Start y End frame.
            </>
          )}
        </div>

        <div className={styles.pickerGrid}>
          {isLoading ? (
            <div className={styles.pickerEmpty}>Cargando referencias…</div>
          ) : visibleAssets.length === 0 ? (
            <div className={styles.pickerEmpty}>
              {tab === "elements"
                ? "No hay elements de imagen que coincidan con tu búsqueda."
                : "No hay imágenes que coincidan con tu búsqueda."}
            </div>
          ) : (
            <>
              {visibleAssets.map((asset) => {
                const url = getAssetUrl(asset);
                const active = selectedIds.includes(asset.id);
                const disabled = !active && selectedIds.length >= max;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={`${styles.pickerTile} ${active ? styles.pickerTileActive : ""}`}
                    onClick={() => {
                      setSelectedIds((prev) => {
                        const has = prev.includes(asset.id);
                        if (has) return prev.filter((id) => id !== asset.id);
                        if (prev.length >= max) return prev;
                        return [asset.id, ...prev];
                      });
                    }}
                    disabled={disabled}
                    title={String((asset as any)?.name || asset.id)}
                    style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                  >
                    {url ? (
                      <img className={styles.pickerThumb} src={url} alt={String((asset as any)?.name || asset.id)} />
                    ) : (
                      <div className={styles.pickerThumb} style={{ display: "grid", placeItems: "center" }}>
                        IMG
                      </div>
                    )}
                    <div className={styles.pickerCap}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {String((asset as any)?.name || "Untitled")}
                      </div>
                      <div style={{ opacity: 0.72, marginTop: 4 }}>
                        {tab === "elements" ? "Element" : "History"}
                      </div>
                    </div>
                    {active && <span style={{ position: "absolute", top: 8, right: 8 }} className={styles.promptTag}>SELECTED</span>}
                  </button>
                );
              })}

              {hasMore && (
                <div className={styles.pickerLoadMoreWrap}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setVisibleCount((count) => count + LOAD_MORE_COUNT)}
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
