import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../ImageGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { uploadUserAsset } from "../../../services/assetsApi";
import {
  createKlingElement,
  deleteKlingElement,
  listKlingVoices,
  type KlingElement,
  type KlingVoice,
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

type VideoMeta = {
  durationSeconds: number;
  width: number;
  height: number;
};

async function readVideoMetaFromFile(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  try {
    return await readVideoMetaFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readVideoMetaFromUrl(url: string): Promise<VideoMeta> {
  return await new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timeout leyendo metadata del video."));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      try {
        video.src = "";
      } catch {}
    }

    video.onloadedmetadata = () => {
      const durationSeconds = Number(video.duration || 0);
      const width = Number(video.videoWidth || 0);
      const height = Number(video.videoHeight || 0);
      cleanup();
      resolve({ durationSeconds, width, height });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("No se pudo leer metadata del video."));
    };

    video.src = url;
  });
}

function validateKlingVideoMeta(meta: VideoMeta, sizeBytes?: number | null): string | null {
  const { durationSeconds, width, height } = meta;

  if (sizeBytes != null && Number.isFinite(Number(sizeBytes))) {
    const maxBytes = 200 * 1024 * 1024;
    if (Number(sizeBytes) > maxBytes) {
      return "El video supera 200MB. Exporta un archivo más liviano (Kling límite 200MB).";
    }
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "No pude detectar la duración del video.";
  }

  if (durationSeconds < 3 || durationSeconds > 8) {
    return `Duración inválida: ${durationSeconds.toFixed(2)}s. Kling requiere 3–8s.`;
  }

  const isLandscape1080p = width === 1920 && height === 1080;
  const isPortrait1080p = width === 1080 && height === 1920;

  if (!isLandscape1080p && !isPortrait1080p) {
    return `Resolución inválida: ${width}x${height}. Kling requiere 1920x1080 (16:9) o 1080x1920 (9:16).`;
  }

  return null;
}

function formatVideoMeta(meta: VideoMeta | null) {
  if (!meta) return "";
  const d = Number.isFinite(meta.durationSeconds) ? meta.durationSeconds.toFixed(2) : "?";
  return `${meta.width}x${meta.height} • ${d}s`;
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
  videoAssets,
  getAssetUrl,
  onRefresh,
  onAssetUploaded,
  uploadToolName = "video-elements",
  maxSelected = 5,
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
  videoAssets: Asset[];
  getAssetUrl: (a: Asset) => string | null;
  onRefresh: () => Promise<void> | void;

  // ✅ Permite que el padre inserte el asset recién subido sin recargar toda la librería
  onAssetUploaded?: (asset: Asset) => void;

  // ✅ tool/meta para distinguir uploads hechos desde este modal
  uploadToolName?: string;
  maxSelected?: number;
}) {

  const [mode, setMode] = useState<Mode>("library");

  // Historial de imágenes dentro del creador de Elements
  const ASSET_INITIAL_COUNT = 12;
  const ASSET_LOAD_MORE_COUNT = 9;

  // Create form
  const [newName, setNewName] = useState("");
  const [newTag, setNewTag] = useState("character");
  const [newDescription, setNewDescription] = useState("");
  const [voicePickerValue, setVoicePickerValue] = useState("");
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [newReferenceType, setNewReferenceType] = useState<"image_refer" | "video_refer">("image_refer");

  const [videoQuery, setVideoQuery] = useState("");
  const [pickedVideoAssetId, setPickedVideoAssetId] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const [pickedAssetIds, setPickedAssetIds] = useState<string[]>([]);
  const [assetVisibleCount, setAssetVisibleCount] = useState(ASSET_INITIAL_COUNT);
  const [isLoadingMoreAssets, setIsLoadingMoreAssets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [voices, setVoices] = useState<KlingVoice[]>([]);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const [pickedVideoMeta, setPickedVideoMeta] = useState<VideoMeta | null>(null);
  const [uploadingSlotIdx, setUploadingSlotIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredVoices = useMemo(() => {
    const q = voiceQuery.trim().toLowerCase();
    const base = Array.isArray(voices) ? voices : [];
    if (!q) return base;

    return base.filter((v) => {
      const t = `${v.label || ""} ${v.id || ""}`.toLowerCase();
      return t.includes(q);
    });
  }, [voices, voiceQuery]);

  async function loadVoices(force = false) {
    if (voicesLoading) return;

    setVoicesLoading(true);
    setVoicesError(null);

    try {
      const items = await listKlingVoices({ force });
      setVoices(Array.isArray(items) ? items : []);
    } catch (e: any) {
      console.error(e);
      setVoices([]);
      setVoicesError(e?.message || "No pude cargar voces.");
    } finally {
      setVoicesLoading(false);
    }
  }

  // Auto-carga de voces cuando el usuario cambia a video_refer
  useEffect(() => {
    if (!open) return;
    if (newReferenceType !== "video_refer") return;
    if (voices.length > 0) return;
    void loadVoices(false);
  }, [open, newReferenceType, voices.length]);

  useEffect(() => {
    if (!open) return;
    setMode("library");
    setLocalError(null);

    // Reset create form
    setNewName("");
    setNewTag("character");
    setNewDescription("");
    setVoicePickerValue("");
    setCustomVoiceId("");
    setNewReferenceType("image_refer");

    // Reset pickers
    setAssetQuery("");
    setVideoQuery("");
    setPickedAssetIds([]);
    setPickedVideoAssetId(null);
    setPickedVideoMeta(null);

    // Reset pagination
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
      const next = prev.filter((id) => id !== uploaded.id);

      // Si el slot existe, reemplaza ahí
      if (slotIdx >= 0 && slotIdx < next.length) {
        next[slotIdx] = uploaded.id;
        return next.slice(0, 4);
      }

      // Si no existe (slot fuera de rango), lo tratamos como "append"
      if (next.length >= 4) return next.slice(0, 4);
      return [...next, uploaded.id].slice(0, 4);
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
async function handleUploadVideo(file: File) {
  setLocalError(null);
  setBusy(true);

  try {
    const isMp4 = file.type === "video/mp4";
    const isMov = file.type === "video/quicktime";
    if (!isMp4 && !isMov && !file.type.startsWith("video/")) {
      throw new Error("Sube un video .mp4 o .mov para crear un Video Character Element.");
    }

    // ✅ Validación real antes de subir (Kling video_refer)
    const meta = await readVideoMetaFromFile(file);
    const metaErr = validateKlingVideoMeta(meta, file.size);
    setPickedVideoMeta(meta);
    if (metaErr) throw new Error(metaErr);

    const uploaded = await uploadUserAsset(file, {
      tool: uploadToolName,
      category: "video",
      type: "video",
      name: file.name,
    });

    onAssetUploaded?.(uploaded);
    setPickedVideoAssetId(uploaded.id);
  } catch (e: any) {
    console.error(e);
    setLocalError(e?.message || "No se pudo subir el video.");
  } finally {
    setBusy(false);
    if (videoInputRef.current) videoInputRef.current.value = "";
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

    const filteredVideoAssets = useMemo(() => {
    const q = videoQuery.trim().toLowerCase();
    const base = Array.isArray(videoAssets) ? videoAssets : [];
    if (!q) return base;
    return base.filter((a) => {
      const t = `${a.name || ""} ${String((a as any)?.prompt || "")}`.toLowerCase();
      return t.includes(q);
    });
  }, [videoQuery, videoAssets]);

  const sortedVideoAssets = useMemo(() => {
    const base = Array.isArray(filteredVideoAssets) ? [...filteredVideoAssets] : [];
    base.sort((a: any, b: any) => {
      const taRaw = a?.createdAt ?? a?.created_at ?? a?.insertedAt ?? a?.updatedAt ?? a?.updated_at ?? 0;
      const tbRaw = b?.createdAt ?? b?.created_at ?? b?.insertedAt ?? b?.updatedAt ?? b?.updated_at ?? 0;
      const ta = typeof taRaw === "string" ? new Date(taRaw).getTime() : Number(taRaw) || 0;
      const tb = typeof tbRaw === "string" ? new Date(tbRaw).getTime() : Number(tbRaw) || 0;
      return tb - ta;
    });
    return base;
  }, [filteredVideoAssets]);

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
      if (prev.length >= maxSelected) return prev; // max
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
    if (newReferenceType === "video_refer") {
      if (!pickedVideoAssetId) {
        setLocalError("Selecciona o sube 1 video (mp4/mov).");
        return;
      }
    } else {
      // docs: frontal + 1..3 refer_images (mínimo 2)
      if (pickedAssetIds.length < 2) {
        setLocalError("Para image_refer, selecciona mínimo 2 imágenes (frontal + 1 referencia).");
        return;
      }
    }

    setBusy(true);
    try {
      if (newReferenceType === "video_refer") {
        await createKlingElement({
          name,
          tag: newTag.trim() || "character",
          description: newDescription.trim() || undefined,
          voiceId: (voicePickerValue === "__custom__" ? customVoiceId : voicePickerValue).trim() || undefined,
          referenceType: "video_refer",
          video: { assetId: pickedVideoAssetId },
        });
      } else {
        await createKlingElement({
          name,
          tag: newTag.trim() || "character",
          description: newDescription.trim() || undefined,
          voiceId: (voicePickerValue === "__custom__" ? customVoiceId : voicePickerValue).trim() || undefined,
          referenceType: "image_refer",
          images: pickedAssetIds.map((id) => ({ assetId: id })),
        });
      }

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
  const createCountLabel =
    newReferenceType === "video_refer"
      ? (pickedVideoAssetId ? "1/1" : "0/1")
      : `${pickedCount}/4`;

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
                Selected: <b>{selectedCount}</b>/{maxSelected}
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
                  onClick={async () => {
                    setLocalError(null);
                    setBusy(true);
                    try {
                      await onRefresh();
                    } catch (e: any) {
                      setLocalError(e?.message || "No pude refrescar el estado de los Elements.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  title="Fuerza polling de Elements en estado creating"
                >
                  Refresh status
                </button>
              </div>

              <div className={styles.elementAllGrid}>
                {filteredElements.map((el) => {
                const active = selectedIds.includes(el.id);
                const src = elementThumb(el);

                const status = (el.status ?? (el.klingElementId ? "ready" : "creating")) as any;
                const isReady = status === "ready" && Boolean(el.klingElementId);
                const isCreating = status === "creating";
                const isFailed = status === "failed";

                // Bloqueamos seleccionar si no está listo (pero permitimos DESELECCIONAR si ya estaba activo)
                const selectionBlocked = !isReady;

                const statusLabel = isReady ? "READY" : isCreating ? "CREATING" : "FAILED";

                return (
                  <div key={el.id} className={`${styles.elementAllCard} ${active ? styles.elementAllCardActive : ""}`}>
                    <button
                      type="button"
                      className={styles.elementAllThumb}
                      onClick={() => {
                        if (!active && selectionBlocked) {
                          setLocalError(
                            isCreating
                              ? `El Element "${el.name}" todavía se está creando. Usa "Refresh status" o espera.`
                              : `El Element "${el.name}" falló. Crea uno nuevo o bórralo.`
                          );
                          return;
                        }
                        toggleSelectElement(el.id);
                      }}
                      disabled={busy || (!active && selectionBlocked)}
                      title={!active && selectionBlocked ? `${statusLabel}: no usable todavía` : el.name}
                    >
                      <img src={src} alt={el.name} />

                      <span
                        className={`${styles.elementStatusBadge} ${
                          isReady ? styles.elementStatusReady : isCreating ? styles.elementStatusCreating : styles.elementStatusFailed
                        }`}
                      >
                        {statusLabel}
                      </span>

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
                      onClick={() => {
                        if (!active && selectionBlocked) {
                          setLocalError(
                            isCreating
                              ? `El Element "${el.name}" todavía se está creando. Usa "Refresh status" o espera.`
                              : `El Element "${el.name}" falló. Crea uno nuevo o bórralo.`
                          );
                          return;
                        }
                        toggleSelectElement(el.id);
                      }}
                      disabled={busy || (!active && selectionBlocked)}
                      title={active ? "Deselect" : selectionBlocked ? `${statusLabel}: no usable` : "Select"}
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

              <div className={styles.elementFormRow}>
                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Reference type</div>
                  <select
                    className={styles.select}
                    value={newReferenceType}
                    onChange={(e) => setNewReferenceType(e.target.value as any)}
                    disabled={busy}
                    title="reference_type"
                  >
                    <option value="image_refer">image_refer (Multi-Image Element)</option>
                    <option value="video_refer">video_refer (Video Character Element)</option>
                  </select>
                </div>

                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Description (max 100)</div>
                  <input
                    className={styles.search}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder='Ej: "Personaje principal, estilo realista, rasgos constantes..."'
                    maxLength={100}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className={styles.elementFormRow}>
                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Voice (optional)</div>

                  {newReferenceType !== "video_refer" ? (
                    <div className={styles.elementHint}>
                      La voz solo se puede bindear en <b>video_refer</b> (Video Character Element).
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <input
                          className={styles.search}
                          value={voiceQuery}
                          onChange={(e) => setVoiceQuery(e.target.value)}
                          placeholder={voicesLoading ? "Loading voices..." : "Search voices..."}
                          disabled={busy}
                        />

                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => loadVoices(true)}
                          disabled={busy || voicesLoading}
                          title="Refresh voices"
                        >
                          {voicesLoading ? "..." : "Refresh"}
                        </button>
                      </div>

                      {newReferenceType === "video_refer" && pickedVideoMeta && (
                        <div className={styles.elementHint}>
                          Video seleccionado: <b>{formatVideoMeta(pickedVideoMeta)}</b>
                        </div>
                      )}

                      <select
                        className={styles.select}
                        value={voicePickerValue}
                        onChange={(e) => setVoicePickerValue(e.target.value)}
                        disabled={busy || voicesLoading}
                        title="element_voice_id"
                      >
                        <option value="">No voice</option>
                        <option value="__custom__">Custom voice ID…</option>
                        {filteredVoices.slice(0, 250).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label || v.id}
                          </option>
                        ))}
                      </select>

                      {voicePickerValue === "__custom__" && (
                        <input
                          className={styles.search}
                          style={{ marginTop: 10 }}
                          value={customVoiceId}
                          onChange={(e) => setCustomVoiceId(e.target.value)}
                          placeholder="Pega aquí tu voice_id personalizado"
                          maxLength={128}
                          disabled={busy}
                        />
                      )}

                      {!!voicesError && (
                        <div className={styles.elementHint} style={{ color: "rgba(255,160,160,0.9)" }}>
                          {voicesError}
                        </div>
                      )}

                    <div className={styles.elementHint}>
                      Nota: selecciona una voz de la librería de Kling (si tu backend la tiene configurada) o usa “Custom voice ID…”
                      para pegar un <b>voice_id</b> obtenido desde la API de voces de Kling.
                    </div>
                    </>
                  )}
                </div>
              </div>

              {newReferenceType === "image_refer" ? (
                <div className={styles.elementLabel}>Images (2–4)</div>
              ) : (
                <div className={styles.elementLabel}>Video (1) — mp4/mov (con audio si quieres voz)</div>
              )}

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

              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (!f) return;
                  handleUploadVideo(f);
                }}
              />

              {newReferenceType === "image_refer" ? (
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
              ) : (
                <div className={styles.elementSlots}>
                  <div className={styles.elementSlotCard}>
                    <div className={styles.elementSlotThumb} data-empty={pickedVideoAssetId ? "false" : "true"}>
                      {pickedVideoAssetId ? (
                        (() => {
                          const a = (videoAssets || []).find((x) => x.id === pickedVideoAssetId) || null;
                          const src = a ? assetThumb(a, getAssetUrl) : PLACEHOLDER;
                          return <video src={src} muted playsInline controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
                        })()
                      ) : (
                        <div className={styles.elementSlotEmpty}>Video slot</div>
                      )}
                    </div>

                    <div className={styles.elementSlotActions}>
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => {
                          document.getElementById("kling-elements-video-picker")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
                          videoInputRef.current?.click();
                        }}
                        title={busy ? "Subiendo…" : "Subir un video (se agregará a tu librería)."}
                      >
                        Upload
                      </button>

                      {pickedVideoAssetId && (
                        <button
                          type="button"
                          className={styles.smallBtnGhost}
                          onClick={() => setPickedVideoAssetId(null)}
                          disabled={busy}
                          title="Clear"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

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

              {newReferenceType === "video_refer" && (
                <div id="kling-elements-video-picker" className={styles.elementPicker}>
                  <div className={styles.elementPickerTop}>
                    <div className={styles.elementPickerTitle}>Pick a video from your library</div>
                  </div>

                  <input
                    className={styles.search}
                    value={videoQuery}
                    onChange={(e) => setVideoQuery(e.target.value)}
                    placeholder="Search videos..."
                  />

                  <div className={styles.pickerArea}>
                    <div className={styles.pickerGrid}>
                      {sortedVideoAssets.length === 0 ? (
                        <div className={styles.elementPickerEmpty}>No videos found</div>
                      ) : (
                        sortedVideoAssets.slice(0, 24).map((a) => {
                          const picked = pickedVideoAssetId === a.id;
                          const src = assetThumb(a, getAssetUrl);

                          return (
                            <button
                              key={a.id}
                              type="button"
                              className={styles.pickerTile}
                              onClick={() => setPickedVideoAssetId(a.id)}
                              disabled={busy}
                              title={a.name || "Video"}
                            >
                              <video src={src} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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

                <div className={styles.elementHint}>
                  Requisitos Kling para video_refer: mp4/mov, 1080p, 3–8s, 16:9 o 9:16, max 200MB.
                </div>
                </div>
              )}

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
                  {busy ? "Creating..." : `Create (${createCountLabel})`}
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
