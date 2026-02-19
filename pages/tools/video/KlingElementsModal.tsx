import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../ImageGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { uploadUserAsset } from "../../../services/assetsApi";
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
  setSelectedIds,
  onClear,
  imageAssets,
  getAssetUrl,
  onRefresh,
  onAssetUploaded,
  uploadToolName = "video-elements",
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
  getAssetUrl: (a: Asset) => string | null;
  onRefresh: () => Promise<void> | void;

  // ✅ Permite que el padre inserte el asset recién subido sin recargar toda la librería
  onAssetUploaded?: (asset: Asset) => void;

  // ✅ tool/meta para distinguir uploads hechos desde este modal
  uploadToolName?: string;
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
  const [uploadingSlotIdx, setUploadingSlotIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


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

async function handleUploadForSlot(slotIdx: number, file: File) {
  setLocalError(null);
  setBusy(true);

  try {
    if (!file.type.startsWith("image/")) {
      throw new Error("Solo puedes subir imágenes para crear un Element.");
    }

    const uploaded = await uploadUserAsset(file, {
      tool: uploadToolName,
      category: "image",
      type: "image",
      name: file.name,
    });

    onAssetUploaded?.(uploaded);

    setPickedAssetIds((prev) => {
      const withoutNew = prev.filter((id) => id !== uploaded.id);

      if (slotIdx >= 0 && slotIdx < withoutNew.length) {
        const next = [...withoutNew];
        next[slotIdx] = uploaded.id;
        return next.slice(0, 4);
      }

      if (withoutNew.length >= 4) return withoutNew;
      return [...withoutNew, uploaded.id].slice(0, 4);
    });
  } catch (e: any) {
    console.error(e);
    setLocalError(e?.message || "No se pudo subir la imagen.");
  } finally {
    setBusy(false);
    setUploadingSlotIdx(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
}


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

  const toggleSelectElement = (id: string) => {
    setSelectedIds((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev; // max 5
      return [...prev, id];
    });
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

      // si estaba seleccionado, lo quitamos
      setSelectedIds((prev) => prev.filter((x) => x !== id));

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
    <div
      className={styles.elementBackdrop}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.elementModal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.elementHeader}>
          <div className={styles.elementTitle}>
            {mode === "create" ? "Create Element/Person" : "All Elements"}
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className={styles.elementBody}>
          {mode === "library" ? (
            <>
              <div className={styles.elementAllTop}>
                <div className={styles.elementAllMeta}>
                  Selected: <b>{selectedCount}</b>/5
                </div>

                <input
                  className={styles.search}
                  placeholder="Search elements..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />

                <button
                  type="button"
                  className={styles.smallBtn}
                  onClick={() => setMode("create")}
                  disabled={busy}
                  title="Create a new Element"
                >
                  Create
                </button>

                <button
                  type="button"
                  className={styles.smallBtnGhost}
                  onClick={onClear}
                  disabled={busy || selectedCount === 0}
                  title="Clear selection"
                >
                  Clear
                </button>

                <button
                  type="button"
                  className={styles.smallBtnGhost}
                  onClick={async () => {
                    setLocalError(null);
                    setBusy(true);
                    try {
                      await onRefresh();
                    } catch (e: any) {
                      setLocalError(e?.message || "No pude refrescar los Elements.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  title="Refresh"
                >
                  Refresh
                </button>
              </div>

              <div className={styles.elementAllGrid}>
                {filteredElements.map((el) => {
                  const active = selectedIds.includes(el.id);
                  const src = elementThumb(el);

                  return (
                    <div
                      key={el.id}
                      className={`${styles.elementAllCard} ${active ? styles.elementAllCardActive : ""}`}
                    >
                      <button
                        type="button"
                        className={styles.elementAllThumb}
                        onClick={() => toggleSelectElement(el.id)}
                        title={el.name}
                      >
                        <img src={src} alt={el.name} />
                        <span className={styles.elementAllBadge}>{active ? "SELECTED" : "SELECT"}</span>
                      </button>

                      {active && (
                        <button
                          type="button"
                          className={styles.elementAllDeselect}
                          onClick={() => setSelectedIds((prev) => prev.filter((x) => x !== el.id))}
                          aria-label={`Deselect ${el.name}`}
                          title="Deselect"
                        >
                          ×
                        </button>
                      )}

                      <div className={styles.elementAllName}>{el.name}</div>

                      <div className={styles.elementAllActions}>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => toggleSelectElement(el.id)}
                          disabled={busy}
                          title={active ? "Deselect" : "Select"}
                        >
                          {active ? "Deselect" : "Select"}
                        </button>

                        <button
                          type="button"
                          className={styles.smallBtnGhost}
                          onClick={() => handleDelete(el.id, el.name)}
                          disabled={busy}
                          title="Delete"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredElements.length === 0 && (
                <div className={styles.elementPickerEmpty}>
                  <div style={{ maxWidth: 640 }}>
                    <div style={{ marginBottom: 10 }}>
                      No tienes Elements todavía. Crea uno con 1–4 imágenes (ej: tu personaje).
                    </div>
                    <button
                      type="button"
                      className={styles.elementPrimaryBtn}
                      onClick={() => setMode("create")}
                      disabled={busy}
                    >
                      Create first Element
                    </button>
                  </div>
                </div>
              )}

              {!!localError && (
                <div className={styles.elementHint} style={{ color: "rgba(255,160,160,0.9)" }}>
                  {localError}
                </div>
              )}

              <div className={styles.elementHint}>
                Seleccionados: <b>{selectedCount}</b> / 5. <br />
                En Kling (V3/O3), los Elements se referencian en el prompt como <b>@Element1</b>, <b>@Element2</b>, etc.
                Si no escribes esas referencias, el sistema puede inyectarlas automáticamente al enviar la generación.
              </div>

              <div className={styles.elementFooter}>
                <button type="button" className={styles.elementPrimaryBtn} onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.elementFormRow}>
                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Name *</div>
                  <input
                    className={styles.search}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder='Ej: "Wow Poppy"'
                    maxLength={20}
                  />
                </div>

                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Tag</div>
                  <select
                    className={styles.select}
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    title="Tag"
                  >
                    <option value="character">character</option>
                    <option value="object">object</option>
                    <option value="scene">scene</option>
                  </select>
                </div>
              </div>

              <div className={styles.elementLabel}>Images (1–4)</div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  const idx = uploadingSlotIdx;
                  if (!f || idx == null) return;
                  handleUploadForSlot(idx, f);
                }}
              />

              <div className={styles.elementSlots}>
                {[0, 1, 2, 3].map((idx) => {
                  const assetId = pickedAssetIds[idx] || null;
                  const asset = assetId ? imageAssets.find((x) => x.id === assetId) : null;
                  const src = asset ? assetThumb(asset, getAssetUrl) : PLACEHOLDER;

                  return (
                    <div key={idx} className={styles.elementSlotCard}>
                      <div className={styles.elementSlotThumb} data-empty={asset ? "false" : "true"}>
                        {asset ? (
                          <img src={src} alt={asset.name || `slot-${idx + 1}`} />
                        ) : (
                          <div className={styles.elementSlotEmpty}>Slot {idx + 1}</div>
                        )}
                      </div>

                      <div className={styles.elementSlotActions}>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => {
                            document.getElementById("kling-elements-picker")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          disabled={busy}
                          title="Elegir desde tu librería"
                        >
                          Library
                        </button>

                        <button
                          type="button"
                          className={styles.smallBtn}
                          disabled={busy}
                          onClick={() => {
                            setUploadingSlotIdx(idx);
                            fileInputRef.current?.click();
                          }}
                          title={busy ? "Subiendo…" : "Subir una imagen (se agregará a tu librería)."}
                        >
                          Upload
                        </button>

                        {assetId && (
                          <button
                            type="button"
                            className={styles.smallBtnGhost}
                            onClick={() => setPickedAssetIds((prev) => prev.filter((x) => x !== assetId))}
                            disabled={busy}
                            title="Clear"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div id="kling-elements-picker" className={styles.elementPicker}>
                <div className={styles.elementPickerTop}>
                  <div className={styles.elementPickerTitle}>Pick from your library</div>
                  <button
                    type="button"
                    className={styles.smallBtnGhost}
                    onClick={() => {
                      setMode("library");
                      setLocalError(null);
                    }}
                    disabled={busy}
                    title="Back"
                  >
                    Back
                  </button>
                </div>

                <input
                  className={styles.search}
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                  placeholder="Search images..."
                />

                {hasMoreAssets && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={handleLoadMoreAssets}
                      disabled={busy || isLoadingMoreAssets}
                      title="Load more"
                    >
                      {isLoadingMoreAssets ? "Loading..." : "Load more"}
                    </button>
                    <div className={styles.elementAllMeta}>
                      Showing <b>{visibleAssets.length}</b> of <b>{sortedAssets.length}</b>
                    </div>
                  </div>
                )}

                <div className={styles.pickerArea}>
                  <div className={styles.pickerGrid}>
                    {sortedAssets.length === 0 ? (
                      <div className={styles.elementPickerEmpty}>No images found</div>
                    ) : (
                      visibleAssets.map((a) => {
                        const picked = pickedAssetIds.includes(a.id);
                        const src = assetThumb(a, getAssetUrl);

                        return (
                          <button
                            key={a.id}
                            type="button"
                            className={styles.pickerTile}
                            onClick={() => togglePickAsset(a.id)}
                            disabled={busy}
                            title={a.name || "Image"}
                          >
                            <img src={src} alt={a.name || "asset"} />
                            <div className={styles.pickerTileCap}>
                              {a.name || "Untitled"}
                              {picked ? " ✓" : ""}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {!!localError && (
                <div className={styles.elementHint} style={{ color: "rgba(255,160,160,0.9)" }}>
                  {localError}
                </div>
              )}

              <div className={styles.elementFooter}>
                <button
                  type="button"
                  className={styles.smallBtnGhost}
                  onClick={() => setMode("library")}
                  disabled={busy}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className={styles.elementPrimaryBtn}
                  onClick={handleCreate}
                  disabled={busy}
                >
                  {busy ? "Creating..." : `Create (${pickedCount}/4)`}
                </button>
              </div>

              <div className={styles.elementHint}>
                Tip: elige imágenes consistentes del personaje/objeto (cara y cuerpo claros, buena luz). Kling usa estas referencias para mantener identidad y coherencia en el video.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
