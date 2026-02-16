import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";

type Props = {
  open: boolean;
  title: string;
  kind: "image" | "video";
  assets: Asset[];
  selectedId: string | null;
  onSelect: (asset: Asset) => void;
  onClose: () => void;
  isLoading?: boolean;
  onUpload: (file: File) => Promise<Asset>;
  getAssetUrl: (a: Asset) => string | null;
};

const INITIAL_COUNT = 24;
const LOAD_MORE_COUNT = 24;

export function AssetPickerModal({
  open,
  title,
  kind,
  assets,
  selectedId,
  onSelect,
  onClose,
  isLoading,
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

  const accept = kind === "image" ? "image/*" : "video/*";

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
            placeholder={kind === "image" ? "Buscar imágenes…" : "Buscar videos…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <button
            className={styles.uploadBtn}
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            title={kind === "image" ? "Subir imagen" : "Subir video"}
          >
            {isUploading ? "UPLOADING…" : "UPLOAD"}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setIsUploading(true);
                const uploaded = await onUpload(f);
                onSelect(uploaded);
                onClose();
              } catch (err: any) {
                console.warn(err);
              } finally {
                setIsUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }
            }}
          />
        </div>

        <div className={styles.pickerGrid}>
          {isLoading ? (
            <div className={styles.pickerEmpty}>Cargando…</div>
          ) : visibleAssets.length === 0 ? (
            <div className={styles.pickerEmpty}>No hay elementos que coincidan con tu búsqueda.</div>
          ) : (
            <>
              {visibleAssets.map((a) => {
                const url = getAssetUrl(a);
                const active = selectedId === a.id;

                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`${styles.pickerTile} ${active ? styles.pickerTileActive : ""}`}
                    onClick={() => {
                      onSelect(a);
                      onClose();
                    }}
                    title={String((a as any)?.name || a.id)}
                  >
                    {url ? (
                      kind === "image" ? (
                        <img className={styles.pickerThumb} src={url} alt={String((a as any)?.name || a.id)} />
                      ) : (
                        <video
                          className={styles.pickerThumb}
                          src={url}
                          muted
                          playsInline
                          loop
                          style={{ objectFit: "cover" }}
                        />
                      )
                    ) : (
                      <div className={styles.pickerThumbFallback}>{kind === "image" ? "IMG" : "VID"}</div>
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
      </div>
    </div>
  );
}
