import React, { useEffect, useMemo, useState } from "react";
import styles from "../VideoGeneratorTool.module.css";
import type { Asset } from "../../../types";
import {
  createKlingElement,
  deleteKlingElement,
  type KlingElement,
} from "../../../services/klingElementsService";

const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type Mode = "library" | "create";

function assetThumb(a: Asset, getAssetUrl: (a: Asset) => string | null) {
  return getAssetUrl(a) || a.url || PLACEHOLDER;
}

function elementThumb(el: KlingElement) {
  return el.previewUrl || el.imageUrls?.[0] || PLACEHOLDER;
}

export function KlingElementsModal({
  open,
  onClose,
  elements,
  query,
  setQuery,
  selectedIds,
  onToggleElement,
  onClear,
  imageAssets,
  getAssetUrl,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  elements: KlingElement[];
  query: string;
  setQuery: (v: string) => void;
  selectedIds: string[];
  onToggleElement: (el: KlingElement, nextSelected: boolean) => void;
  onClear: () => void;
  imageAssets: Asset[];
  getAssetUrl: (a: Asset) => string | null;
  onRefresh: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<Mode>("library");

  // Historial de imágenes dentro del creador de Elements
  const ASSET_INITIAL_COUNT = 12;
  const ASSET_LOAD_MORE_COUNT = 9;

  // Create form
  const [newName, setNewName] = useState("");
  const [newTag, setNewTag] = useState("character");
  const [assetQuery, setAssetQuery] = useState("");
  const [pickedAssetIds, setPickedAssetIds] = useState<string[]>([]);
  const [assetVisibleCount, setAssetVisibleCount] = useState(ASSET_INITIAL_COUNT);
  const [isLoadingMoreAssets, setIsLoadingMoreAssets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);


  useEffect(() => {
    if (!open) return;
    setMode("library");
    setLocalError(null);
    setNewName("");
    setNewTag("character");
    setAssetQuery("");
    setPickedAssetIds([]);
    setAssetVisibleCount(ASSET_INITIAL_COUNT);
    setIsLoadingMoreAssets(false);
  }, [open, ASSET_INITIAL_COUNT]);


  const filteredElements = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = Array.isArray(elements) ? elements : [];
    if (!q) return base;
    return base.filter((el) => {
      const t = `${el.name || ""}`.toLowerCase();
      return t.includes(q);
    });
  }, [elements, query]);

    const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const base = Array.isArray(imageAssets) ? imageAssets : [];
    if (!q) return base;
    return base.filter((a) => {
      const t = `${a.name || ""} ${String((a as any)?.prompt || "")}`.toLowerCase();
      return t.includes(q);
    });
  }, [assetQuery, imageAssets]);

  const sortedAssets = useMemo(() => {
    const base = Array.isArray(filteredAssets) ? [...filteredAssets] : [];
    base.sort((a: any, b: any) => {
      const taRaw = a?.createdAt ?? a?.created_at ?? a?.insertedAt ?? a?.updatedAt ?? a?.updated_at ?? 0;
      const tbRaw = b?.createdAt ?? b?.created_at ?? b?.insertedAt ?? b?.updatedAt ?? b?.updated_at ?? 0;
      const ta = typeof taRaw === "string" ? new Date(taRaw).getTime() : Number(taRaw) || 0;
      const tb = typeof tbRaw === "string" ? new Date(tbRaw).getTime() : Number(tbRaw) || 0;
      return tb - ta;
    });
    return base;
  }, [filteredAssets]);

  const visibleAssets = useMemo(
    () => sortedAssets.slice(0, Math.min(assetVisibleCount, sortedAssets.length)),
    [sortedAssets, assetVisibleCount]
  );
  const hasMoreAssets = assetVisibleCount < sortedAssets.length;

  async function handleLoadMoreAssets() {
    if (isLoadingMoreAssets) return;
    setIsLoadingMoreAssets(true);
    try {
      await new Promise((r) => setTimeout(r, 120));
      setAssetVisibleCount((c) => Math.min(c + ASSET_LOAD_MORE_COUNT, sortedAssets.length));
    } finally {
      setIsLoadingMoreAssets(false);
    }
  }

  const toggleSelectElement = (el: KlingElement) => {
    const selected = selectedIds.includes(el.id);
    if (!selected && selectedIds.length >= 5) return;
    onToggleElement(el, !selected);
  };

  const togglePickAsset = (assetId: string) => {
    setPickedAssetIds((prev) => {
      const has = prev.includes(assetId);
      if (has) return prev.filter((x) => x !== assetId);
      if (prev.length >= 4) return prev; // Kling: 1-4 imágenes por Element
      return [...prev, assetId];
    });
  };

  const handleCreate = async () => {
    setLocalError(null);

    const name = newName.trim();
    if (!name) {
      setLocalError("Debes asignarle un nombre a tu Elemento (campo obligatorio).");
      return;
    }
    if (name.length > 20) {
      setLocalError("El nombre debe tener máximo 20 caracteres (requisito de Kling).");
      return;
    }
    if (pickedAssetIds.length < 1) {
      setLocalError("Selecciona al menos 1 imagen (máx 4).");
      return;
    }

    setBusy(true);
    try {
      await createKlingElement({
        name,
        tag: newTag.trim() || "character",
        images: pickedAssetIds.map((id) => ({ assetId: id })),
      });

      await onRefresh();

      // volver a la librería
      setMode("library");
      setNewName("");
      setNewTag("character");
      setAssetQuery("");
      setPickedAssetIds([]);
    } catch (e: any) {
      setLocalError(e?.message || "No pude crear el Element.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    setLocalError(null);
    const ok = window.confirm(
      `¿Borrar Element "${name}"? Esto también elimina sus imágenes guardadas.`
    );
    if (!ok) return;

    setBusy(true);
    try {
      await deleteKlingElement(id);

      // si estaba seleccionado, lo desmarcamos (y el padre también lo quitará del prompt)
    if (selectedIds.includes(id)) {
      const el = elements.find((e) => e.id === id);
      if (el) onToggleElement(el, false);
    }

      await onRefresh();
    } catch (e: any) {
      setLocalError(e?.message || "No pude borrar el Element.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const selectedCount = selectedIds.length;
  const pickedCount = pickedAssetIds.length;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Kling Elements</div>
          <button className={styles.modalClose} onClick={onClose} type="button">
            ×
          </button>
        </div>

        {mode === "library" ? (
          <>
            <div className={styles.modalActions}>
              <input
                className={styles.search}
                placeholder="Search elements..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() => setMode("create")}
                disabled={busy}
              >
                NEW
              </button>
              <button
                type="button"
                className={styles.swapBtn}
                onClick={onClear}
                disabled={busy}
              >
                Clear
              </button>
            </div>

            <div className={styles.pickerGrid}>
              {filteredElements.length === 0 ? (
                <div className={styles.pickerEmpty}>
                  <div style={{ maxWidth: 520 }}>
                    <div
                      style={{
                        marginBottom: 10,
                        fontFamily: "var(--mono)",
                        letterSpacing: "0.10em",
                      }}
                    >
                      No tienes Elements todavía.
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      Crea uno con 1–4 imágenes (ej: tu personaje). Luego, al
                      seleccionar Elements, Kling los referenciará como{" "}
                      <b>@Element1</b>, <b>@Element2</b>, etc.
                    </div>
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      onClick={() => setMode("create")}
                      disabled={busy}
                    >
                      CREATE FIRST ELEMENT
                    </button>
                  </div>
                </div>
              ) : (
                filteredElements.map((el) => {
                  const selected = selectedIds.includes(el.id);
                  const src = elementThumb(el);

                  return (
                    <div
                      key={el.id}
                      role="button"
                      tabIndex={0}
                      className={`${styles.pickerTile} ${
                        selected ? styles.pickerTileActive : ""
                      }`}
                      style={{ position: "relative" }}
                      onClick={() => toggleSelectElement(el)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          toggleSelectElement(el.id);
                      }}
                      aria-pressed={selected}
                    >
                      <img src={src} alt={el.name} />
                      <div className={styles.pickerCap}>
                        {el.name}
                        {selected ? " ✓" : ""}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(el.id, el.name);
                        }}
                        disabled={busy}
                        aria-label={`Delete ${el.name}`}
                        title="Delete"
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          width: 34,
                          height: 34,
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(0,0,0,0.35)",
                          color: "rgba(255,255,255,0.85)",
                          cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {!!localError && (
              <div
                className={styles.modalNote}
                style={{ color: "rgba(255,160,160,0.9)" }}
              >
                {localError}
              </div>
            )}

            <div className={styles.modalNote}>
              Seleccionados: <b>{selectedCount}</b> / 5. <br />
              En Fal/Kling V3, los Elements se referencian en el prompt como{" "}
              <b>@Element1</b>, <b>@Element2</b>, etc. Si no escribes esas
              referencias, el sistema las inyecta automáticamente al enviar la
              generación.
            </div>
          </>
        ) : (
          <>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() => setMode("library")}
                disabled={busy}
              >
                BACK
              </button>

              <input
                className={styles.search}
                placeholder="Element name (required)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={20}
              />

              <select
                className={styles.search}
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                title="Tag"
                style={{ maxWidth: 180 }}
              >
                <option value="character">character</option>
                <option value="object">object</option>
                <option value="scene">scene</option>
              </select>

              <button
                type="button"
                className={styles.uploadBtn}
                onClick={handleCreate}
                disabled={busy}
              >
                {busy ? "CREATING…" : `CREATE (${pickedCount}/4)`}
              </button>
            </div>

            <div
              className={styles.modalActions}
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <input
                className={styles.search}
                placeholder="Search your images..."
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
              />
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                Selecciona 1–4 imágenes
              </div>
            </div>

            {hasMoreAssets && (
              <div className={styles.pickerLoadMoreWrap}>
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={handleLoadMoreAssets}
                  disabled={busy || isLoadingMoreAssets}
                >
                  {isLoadingMoreAssets ? "CARGANDO…" : "Cargar más"}
                </button>
                <div className={styles.loadMoreHint}>
                  Mostrando {visibleAssets.length} de {sortedAssets.length}
                </div>
              </div>
            )}

            <div className={styles.pickerGrid}>
              {sortedAssets.length === 0 ? (
                <div className={styles.pickerEmpty}>
                  No veo imágenes en tu librería...
                </div>
              ) : (
                visibleAssets.map((a) => {
                  const picked = pickedAssetIds.includes(a.id);
                  const src = assetThumb(a, getAssetUrl);

                  return (
                    <div
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      className={`${styles.pickerTile} ${
                        picked ? styles.pickerTileActive : ""
                      }`}
                      onClick={() => togglePickAsset(a.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          togglePickAsset(a.id);
                      }}
                      aria-pressed={picked}
                    >
                      <img src={src} alt={a.name || "asset"} />
                      <div className={styles.pickerCap}>
                        {a.name || "Image"}
                        {picked ? " ✓" : ""}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {!!localError && (
              <div
                className={styles.modalNote}
                style={{ color: "rgba(255,160,160,0.9)" }}
              >
                {localError}
              </div>
            )}

            <div className={styles.modalNote}>
              Consejo: elige imágenes consistentes del personaje/objeto (cara y
              cuerpo claros, buena luz). Kling V3 usa estas referencias para
              mantener identidad y coherencia en el video.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
