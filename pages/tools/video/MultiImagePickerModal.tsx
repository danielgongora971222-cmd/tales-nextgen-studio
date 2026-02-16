import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";

type Props = {
  open: boolean;
  title: string;
  assets: Asset[];
  isLoading?: boolean;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  max: number;
  onClose: () => void;
  onUpload: (file: File) => Promise<Asset>;
  getAssetUrl: (a: Asset) => string | null;
};

const INITIAL_COUNT = 36;
const LOAD_MORE_COUNT = 36;

export function MultiImagePickerModal({
  open,
  title,
  assets,
  isLoading,
  selectedIds,
  setSelectedIds,
  max,
  onClose,
  onUpload,
  getAssetUrl,
}: Props) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setVisibleCount(INITIAL_COUNT);
  }, [open]);

  const sorted = useMemo(() => {
    const arr = Array.isArray(assets) ? [...assets] : [];
    arr.sort((a: any, b: any) => {
      const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    return arr;
  }, [assets]);

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((a: any) => {
      const name = String(a?.name || "");
      const hint = String(a?.hint || "");
      const id = String(a?.id || "");
      const meta = JSON.stringify(a?.meta || {});
      return (
        name.toLowerCase().includes(q) ||
        hint.toLowerCase().includes(q) ||
        id.toLowerCase().includes(q) ||
        meta.toLowerCase().includes(q)
      );
    });
  }, [sorted, query]);

  const visibleAssets = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visibleAssets.length;

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>{title}</div>
          <button className={styles.modalClose} onClick={onClose} type="button" title="Cerrar">
            ×
          </button>
        </div>

        <div className={styles.modalActions}>
          <input
            className={styles.search}
            placeholder="Buscar imágenes…"
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
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setIsUploading(true);
                const uploaded = await onUpload(f);
                setSelectedIds((prev) => {
                  if (prev.includes(uploaded.id)) return prev;
                  if (prev.length >= max) return prev;
                  return [uploaded.id, ...prev];
                });
              } catch (err: any) {
                console.warn(err);
              } finally {
                setIsUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }
            }}
          />
        </div>

        <div className={styles.noteSmall} style={{ padding: "0 14px 10px" }}>
          Seleccionadas: <b>{selectedIds.length}</b> / {max} · Kling permite máximo{" "}
          <b>4 referencias combinadas</b> (Elements + imágenes).
        </div>

        <div className={styles.pickerGrid}>
          {isLoading ? (
            <div className={styles.pickerEmpty}>Cargando…</div>
          ) : visibleAssets.length === 0 ? (
            <div className={styles.pickerEmpty}>No hay imágenes que coincidan con tu búsqueda.</div>
          ) : (
            <>
              {visibleAssets.map((a) => {
                const url = getAssetUrl(a);
                const active = selectedIds.includes(a.id);
                const disabled = !active && selectedIds.length >= max;

                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.pickerTile} ${active ? styles.pickerTileActive : ""}`}
                    onClick={() => {
                      setSelectedIds((prev) => {
                        const has = prev.includes(a.id);
                        if (has) return prev.filter((x) => x !== a.id);
                        if (prev.length >= max) return prev;
                        return [a.id, ...prev];
                      });
                    }}
                    disabled={disabled}
                    title={String((a as any)?.name || a.id)}
                    style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                  >
                    {url ? (
                      <img className={styles.pickerThumb} src={url} alt={String((a as any)?.name || a.id)} />
                    ) : (
                      <div className={styles.pickerThumbFallback}>IMG</div>
                    )}

                    <div className={styles.pickerMeta}>
                      <div className={styles.pickerName}>{String((a as any)?.name || "Untitled")}</div>
                      <div className={styles.pickerSub}>{String((a as any)?.createdAt || "")}</div>
                    </div>

                    {active && <span className={styles.pickerBadge}>SELECTED</span>}
                  </button>
                );
              })}

              {hasMore && (
                <div className={styles.pickerLoadMoreWrap}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setVisibleCount((c) => c + LOAD_MORE_COUNT)}
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
