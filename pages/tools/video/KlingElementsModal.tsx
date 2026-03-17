import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../ImageGeneratorTool.module.css";
import type { Asset } from "../../../types";
import { uploadUserAsset } from "../../../services/assetsApi";
import {
  KLING_ELEMENT_TAG_OPTIONS,
  createKlingElement,
  deleteKlingElement,
  listKlingVoices,
  isKlingElementReadyForVideoGenerator,
  type KlingElement,
  type KlingElementTagId,
  type KlingVoice,
} from "../../../services/klingElementsService";

const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type TabKey = "library" | "presets" | "create";

type VideoMeta = {
  durationSeconds: number;
  width: number;
  height: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  elements: KlingElement[];
  presetElements?: KlingElement[];
  query: string;
  setQuery: (v: string) => void;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  onClear: () => void;
  imageAssets: Asset[];
  videoAssets: Asset[];
  getAssetUrl: (a: Asset) => string | null;
  onRefresh: () => Promise<void> | void;
  onAssetUploaded?: (asset: Asset) => void;
  uploadToolName?: string;
  maxSelected?: number;
};

function assetThumb(a: Asset, getAssetUrl: (a: Asset) => string | null) {
  return getAssetUrl(a) || a.url || PLACEHOLDER;
}

function elementThumb(el: KlingElement) {
  return el.previewUrl || el.videoUrl || el.imageUrls?.[0] || PLACEHOLDER;
}

function toTime(raw: any) {
  if (typeof raw === "number") return raw;
  const ts = new Date(raw || "").getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function formatElementSource(el: KlingElement) {
  return el.isPreset || el.source === "preset" ? "Official preset" : "My element";
}

function formatReferenceType(el: KlingElement) {
  return el.referenceType === "video_refer" ? "Video" : "Image";
}

function getElementStatus(el: KlingElement) {
  const ready = isKlingElementReadyForVideoGenerator(el);
  const status = String(el.status || (ready ? "ready" : "creating")).toLowerCase();

  if (status === "corrupted") {
    return {
      status,
      label: "CORRUPTED",
      className: `${styles.elementStatusBadge} ${styles.elementStatusFailed}`,
      ready: false,
      actionable: true,
    };
  }

  if (status === "failed") {
    return {
      status,
      label: "FAILED",
      className: `${styles.elementStatusBadge} ${styles.elementStatusFailed}`,
      ready: false,
      actionable: true,
    };
  }

  if (status === "creating" || status === "submitted" || status === "processing") {
    return {
      status,
      label: "CREATING",
      className: `${styles.elementStatusBadge} ${styles.elementStatusCreating}`,
      ready: false,
      actionable: true,
    };
  }

  if (!ready) {
    return {
      status: "corrupted",
      label: "CORRUPTED",
      className: `${styles.elementStatusBadge} ${styles.elementStatusFailed}`,
      ready: false,
      actionable: true,
    };
  }

  return {
    status: "ready",
    label: el.isPreset || el.source === "preset" ? "READY" : "READY VERIFIED",
    className: `${styles.elementStatusBadge} ${styles.elementStatusReady}`,
    ready: true,
    actionable: false,
  };
}

async function readVideoMetaFromUrl(url: string): Promise<VideoMeta> {
  return await new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.muted = true;

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

async function readVideoMetaFromFile(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  try {
    return await readVideoMetaFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function validateKlingVideoMeta(meta: VideoMeta, sizeBytes?: number | null): string | null {
  const { durationSeconds, width, height } = meta;

  if (sizeBytes != null && Number.isFinite(Number(sizeBytes))) {
    const maxBytes = 200 * 1024 * 1024;
    if (Number(sizeBytes) > maxBytes) {
      return "El video supera 200MB. Kling admite hasta 200MB por Element video_refer.";
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
    return `Resolución inválida: ${width}x${height}. Kling requiere 1920x1080 o 1080x1920.`;
  }

  return null;
}

function formatVideoMeta(meta: VideoMeta | null) {
  if (!meta) return "";
  const secs = Number.isFinite(meta.durationSeconds) ? meta.durationSeconds.toFixed(2) : "?";
  return `${meta.width}x${meta.height} • ${secs}s`;
}

function MediaThumb({ src, type, alt }: { src: string; type?: "image" | "video"; alt: string }) {
  if (type === "video") {
    return <video src={src} muted playsInline preload="metadata" autoPlay loop />;
  }
  return <img src={src} alt={alt} />;
}

export function KlingElementsModal({
  open,
  onClose,
  elements,
  presetElements = [],
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
}: Props) {
  const [tab, setTab] = useState<TabKey>("library");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newReferenceType, setNewReferenceType] = useState<"image_refer" | "video_refer">("image_refer");
  const [newTagIds, setNewTagIds] = useState<KlingElementTagId[]>(["o_102"]);
  const [assetQuery, setAssetQuery] = useState("");
  const [videoQuery, setVideoQuery] = useState("");
  const [pickedAssetIds, setPickedAssetIds] = useState<string[]>([]);
  const [pickedVideoAssetId, setPickedVideoAssetId] = useState<string | null>(null);
  const [pickedVideoMeta, setPickedVideoMeta] = useState<VideoMeta | null>(null);

  const [voices, setVoices] = useState<KlingVoice[]>([]);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicePickerValue, setVoicePickerValue] = useState("");
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("library");
    setLocalError(null);
    setNewName("");
    setNewDescription("");
    setNewReferenceType("image_refer");
    setNewTagIds(["o_102"]);
    setAssetQuery("");
    setVideoQuery("");
    setPickedAssetIds([]);
    setPickedVideoAssetId(null);
    setPickedVideoMeta(null);
    setVoiceQuery("");
    setVoicePickerValue("");
    setCustomVoiceId("");
    setVoicesError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (newReferenceType !== "video_refer") return;
    if (voices.length > 0 || voicesLoading) return;
    void loadVoices(false);
  }, [open, newReferenceType, voices.length, voicesLoading]);

  useEffect(() => {
    if (!open) return;
    if (newReferenceType !== "video_refer") {
      setPickedVideoMeta(null);
      return;
    }
    if (!pickedVideoAssetId) {
      setPickedVideoMeta(null);
      return;
    }

    const asset = videoAssets.find((item) => item.id === pickedVideoAssetId);
    const src = asset ? assetThumb(asset, getAssetUrl) : "";
    if (!src) {
      setPickedVideoMeta(null);
      return;
    }

    let cancelled = false;
    readVideoMetaFromUrl(src)
      .then((meta) => {
        if (!cancelled) setPickedVideoMeta(meta);
      })
      .catch(() => {
        if (!cancelled) setPickedVideoMeta(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, newReferenceType, pickedVideoAssetId, videoAssets, getAssetUrl]);

  async function loadVoices(force = false) {
    if (voicesLoading) return;
    setVoicesLoading(true);
    setVoicesError(null);
    try {
      const items = await listKlingVoices({ force });
      setVoices(Array.isArray(items) ? items : []);
    } catch (e: any) {
      setVoices([]);
      setVoicesError(e?.message || "No pude cargar voces.");
    } finally {
      setVoicesLoading(false);
    }
  }

  const selectedCount = Array.isArray(selectedIds) ? selectedIds.length : 0;
  const selectedIdSet = useMemo(() => new Set((selectedIds || []).map(String)), [selectedIds]);

  const filteredCustomElements = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [...(Array.isArray(elements) ? elements : [])].sort((a, b) => toTime(b.updatedAt || b.createdAt) - toTime(a.updatedAt || a.createdAt));
    if (!q) return base;
    return base.filter((el) => {
      const haystack = `${el.name || ""} ${el.description || ""} ${(el.tagLabels || []).join(" ")} ${el.tag || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [elements, query]);

  const filteredPresetElements = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [...(Array.isArray(presetElements) ? presetElements : [])].sort((a, b) => toTime(b.updatedAt || b.createdAt) - toTime(a.updatedAt || a.createdAt));
    if (!q) return base;
    return base.filter((el) => {
      const haystack = `${el.name || ""} ${el.description || ""} ${(el.tagLabels || []).join(" ")} ${el.tag || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [presetElements, query]);

  const filteredAssets = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const base = [...(Array.isArray(imageAssets) ? imageAssets : [])].sort((a, b) => toTime((b as any).updatedAt || b.createdAt) - toTime((a as any).updatedAt || a.createdAt));
    if (!q) return base;
    return base.filter((asset) => `${asset.name || ""} ${String(asset.prompt || "")}`.toLowerCase().includes(q));
  }, [assetQuery, imageAssets]);

  const filteredVideoAssets = useMemo(() => {
    const q = videoQuery.trim().toLowerCase();
    const base = [...(Array.isArray(videoAssets) ? videoAssets : [])].sort((a, b) => toTime((b as any).updatedAt || b.createdAt) - toTime((a as any).updatedAt || a.createdAt));
    if (!q) return base;
    return base.filter((asset) => `${asset.name || ""} ${String(asset.prompt || "")}`.toLowerCase().includes(q));
  }, [videoAssets, videoQuery]);

  const filteredVoices = useMemo(() => {
    const q = voiceQuery.trim().toLowerCase();
    const base = Array.isArray(voices) ? voices : [];
    if (!q) return base;
    return base.filter((voice) => `${voice.label || ""} ${voice.id || ""}`.toLowerCase().includes(q));
  }, [voiceQuery, voices]);

  const pickedImageAssets = useMemo(() => {
    const byId = new Map((imageAssets || []).map((asset) => [String(asset.id), asset]));
    return pickedAssetIds.map((id) => byId.get(id)).filter(Boolean) as Asset[];
  }, [imageAssets, pickedAssetIds]);

  const pickedVideoAsset = useMemo(
    () => (pickedVideoAssetId ? (videoAssets || []).find((asset) => asset.id === pickedVideoAssetId) || null : null),
    [videoAssets, pickedVideoAssetId]
  );

  const effectiveVoiceId = useMemo(() => {
    if (voicePickerValue === "__custom__") return customVoiceId.trim();
    return voicePickerValue.trim();
  }, [voicePickerValue, customVoiceId]);

  const toggleSelectElement = (id: string) => {
    setLocalError(null);
    setSelectedIds((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      if (base.includes(id)) return base.filter((item) => item !== id);
      if (base.length >= maxSelected) {
        setLocalError(`Solo puedes usar ${maxSelected} Elements al mismo tiempo en este modelo.`);
        return base;
      }
      return [...base, id];
    });
  };

  const toggleTag = (tagId: KlingElementTagId) => {
    setNewTagIds((prev) => {
      if (prev.includes(tagId)) {
        const next = prev.filter((id) => id !== tagId);
        return next.length ? next : ["o_102"];
      }
      if (prev.length >= 8) return prev;
      return [...prev, tagId];
    });
  };

  const togglePickAsset = (assetId: string) => {
    setPickedAssetIds((prev) => {
      if (prev.includes(assetId)) return prev.filter((item) => item !== assetId);
      if (prev.length >= 4) {
        setLocalError("Kling admite hasta 4 imágenes por Element (1 frontal + hasta 3 referencias).");
        return prev;
      }
      return [...prev, assetId];
    });
  };

  const moveAssetToFront = (assetId: string) => {
    setPickedAssetIds((prev) => {
      if (!prev.includes(assetId)) return prev;
      return [assetId, ...prev.filter((id) => id !== assetId)].slice(0, 4);
    });
  };

  async function handleUploadImage(file: File) {
    setLocalError(null);
    setBusy(true);
    try {
      if (!file.type.startsWith("image/")) {
        throw new Error("Solo puedes subir imágenes para un Element image_refer.");
      }
      const uploaded = await uploadUserAsset(file, {
        tool: uploadToolName,
        category: "image",
        type: "image",
        name: file.name,
      });
      onAssetUploaded?.(uploaded);
      setPickedAssetIds((prev) => {
        const deduped = [uploaded.id, ...prev.filter((id) => id !== uploaded.id)];
        return deduped.slice(0, 4);
      });
    } catch (e: any) {
      setLocalError(e?.message || "No se pudo subir la imagen.");
    } finally {
      setBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleUploadVideo(file: File) {
    setLocalError(null);
    setBusy(true);
    try {
      const isMp4 = file.type === "video/mp4";
      const isMov = file.type === "video/quicktime";
      if (!isMp4 && !isMov && !file.type.startsWith("video/")) {
        throw new Error("Sube un .mp4 o .mov para un Video Character Element.");
      }

      const meta = await readVideoMetaFromFile(file);
      setPickedVideoMeta(meta);
      const metaErr = validateKlingVideoMeta(meta, file.size);
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
      setLocalError(e?.message || "No se pudo subir el video.");
    } finally {
      setBusy(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleCreate() {
    setLocalError(null);

    const name = newName.trim();
    if (!name) return void setLocalError("Debes poner un nombre al Element.");
    if (name.length > 20) return void setLocalError("El nombre no puede superar 20 caracteres.");

    const description = newDescription.trim();
    if (description.length > 100) {
      return void setLocalError("La descripción no puede superar 100 caracteres.");
    }

    if (newReferenceType === "image_refer") {
      if (pickedAssetIds.length < 2) {
        return void setLocalError("image_refer requiere mínimo 2 imágenes: frontal + una referencia adicional.");
      }
    } else {
      if (!pickedVideoAssetId) {
        return void setLocalError("video_refer requiere 1 video referencial.");
      }
      if (pickedVideoMeta) {
        const metaErr = validateKlingVideoMeta(pickedVideoMeta, null);
        if (metaErr) return void setLocalError(metaErr);
      }
    }

    setBusy(true);
    try {
      await createKlingElement(
        newReferenceType === "video_refer"
          ? {
              name,
              description: description || undefined,
              tagIds: newTagIds.length ? newTagIds : undefined,
              voiceId: effectiveVoiceId || undefined,
              referenceType: "video_refer",
              video: { assetId: pickedVideoAssetId as string },
            }
          : {
              name,
              description: description || undefined,
              tagIds: newTagIds.length ? newTagIds : undefined,
              referenceType: "image_refer",
              images: pickedAssetIds.map((assetId) => ({ assetId })),
            },
        { waitForReady: false }
      );

      await onRefresh();
      setTab("library");
      setNewName("");
      setNewDescription("");
      setNewTagIds(["o_102"]);
      setPickedAssetIds([]);
      setPickedVideoAssetId(null);
      setPickedVideoMeta(null);
      setVoicePickerValue("");
      setCustomVoiceId("");
    } catch (e: any) {
      setLocalError(e?.message || "No pude crear el Element.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(el: KlingElement) {
    const name = el.name || "Element";
    const ok = window.confirm(`¿Borrar Element "${name}"?`);
    if (!ok) return;

    setBusy(true);
    setLocalError(null);
    try {
      await deleteKlingElement(String(el.id));
      setSelectedIds((prev) => (Array.isArray(prev) ? prev.filter((item) => item !== String(el.id)) : []));
      await onRefresh();
    } catch (e: any) {
      setLocalError(e?.message || "No pude borrar el Element.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshLibrary() {
    setLocalError(null);
    setBusy(true);
    try {
      await onRefresh();
    } catch (e: any) {
      setLocalError(e?.message || "No pude refrescar la librería de Elements.");
    } finally {
      setBusy(false);
    }
  }


  async function handleRefreshElement(el: KlingElement) {
    setLocalError(null);
    setBusy(true);
    try {
      await onRefresh();
    } catch (e: any) {
      setLocalError(e?.message || `No pude refrescar el estado de "${el.name || "Element"}".`);
    } finally {
      setBusy(false);
    }
  }

  function renderElementCard(el: KlingElement) {
    const active = selectedIdSet.has(String(el.id));
    const statusMeta = getElementStatus(el);
    const isPreset = Boolean(el.isPreset || el.source === "preset");
    const src = elementThumb(el);
    const type = el.previewType === "video" || el.referenceType === "video_refer" ? "video" : "image";
    const blockedMessage =
      statusMeta.status === "corrupted"
        ? `El Element "${el.name}" tiene un ID remoto inválido o no verificado. Usa Refresh status o recréalo.`
        : statusMeta.status === "failed"
          ? `El Element "${el.name}" falló y no se puede usar.`
          : `El Element "${el.name}" todavía no está listo.`;

    return (
      <div key={el.id} className={`${styles.elementAllCard} ${active ? styles.elementAllCardActive : ""}`}>
        <button
          type="button"
          className={styles.elementAllThumb}
          onClick={() => {
            if (!active && !statusMeta.ready) {
              setLocalError(blockedMessage);
              return;
            }
            toggleSelectElement(String(el.id));
          }}
          disabled={busy}
          title={el.name}
        >
          <MediaThumb src={src} type={type} alt={el.name || "Element"} />
          <span className={statusMeta.className}>{statusMeta.label}</span>
          <span className={styles.elementSourceBadge}>{formatElementSource(el)}</span>
          <span className={styles.elementAllBadge}>{active ? "SELECTED" : statusMeta.ready ? "SELECT" : statusMeta.status === "corrupted" ? "INVALID" : "PENDING"}</span>
        </button>

        {active && (
          <button
            type="button"
            className={styles.elementAllDeselect}
            onClick={() => toggleSelectElement(String(el.id))}
            aria-label={`Deselect ${el.name}`}
            title="Deselect"
          >
            ×
          </button>
        )}

        <div className={styles.elementAllName}>{el.name}</div>
        <div className={styles.elementCardMeta}>
          <span>{formatReferenceType(el)}</span>
          <span>{formatElementSource(el)}</span>
        </div>

        {!!el.description && <div className={styles.elementCardDescription}>{el.description}</div>}
        {!!el.statusDetail && !statusMeta.ready && (
          <div className={styles.elementCardDescription}>{el.statusDetail}</div>
        )}

        {!!(el.tagLabels || []).length && (
          <div className={styles.elementTagRail}>
            {(el.tagLabels || []).slice(0, 4).map((tag) => (
              <span key={`${el.id}-${tag}`} className={styles.elementTagChip}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {!!el.voiceInfo?.voiceName && (
          <div className={styles.elementVoiceRow}>
            <span>Voice</span>
            <b>{el.voiceInfo.voiceName}</b>
          </div>
        )}

        <div className={styles.elementAllActions}>
          {statusMeta.ready ? (
            <button
              type="button"
              className={styles.smallBtn}
              onClick={() => {
                if (!active && !statusMeta.ready) {
                  setLocalError(blockedMessage);
                  return;
                }
                toggleSelectElement(String(el.id));
              }}
              disabled={busy}
            >
              {active ? "Deselect" : "Select"}
            </button>
          ) : !isPreset ? (
            <button type="button" className={styles.smallBtn} onClick={() => handleRefreshElement(el)} disabled={busy}>
              Refresh status
            </button>
          ) : (
            <button type="button" className={styles.smallBtn} disabled>
              Unavailable
            </button>
          )}

          {!isPreset ? (
            <button type="button" className={styles.smallBtnGhost} onClick={() => handleDelete(el)} disabled={busy}>
              Delete
            </button>
          ) : (
            <button type="button" className={styles.smallBtnGhost} disabled>
              Preset
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!open) return null;

  const currentElements = tab === "presets" ? filteredPresetElements : filteredCustomElements;
  const voiceBindingAllowed = newReferenceType === "video_refer";

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
          <div>
            <div className={styles.elementTitle}>Kling Elements</div>
            <div className={styles.elementAllMeta}>Selected: <b>{selectedCount}</b>/{maxSelected}</div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className={styles.elementBody}>
          <div className={styles.elementTabs}>
            <button
              type="button"
              className={`${styles.elementTabBtn} ${tab === "library" ? styles.elementTabBtnActive : ""}`}
              onClick={() => setTab("library")}
            >
              My Elements ({elements.length})
            </button>
            <button
              type="button"
              className={`${styles.elementTabBtn} ${tab === "presets" ? styles.elementTabBtnActive : ""}`}
              onClick={() => setTab("presets")}
            >
              Presets ({presetElements.length})
            </button>
            <button
              type="button"
              className={`${styles.elementTabBtn} ${tab === "create" ? styles.elementTabBtnActive : ""}`}
              onClick={() => setTab("create")}
            >
              Create Element
            </button>
          </div>

          {(tab === "library" || tab === "presets") && (
            <>
              <div className={styles.elementAllTop}>
                <input
                  className={styles.search}
                  placeholder={tab === "presets" ? "Search presets..." : "Search your Elements..."}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="button" className={styles.smallBtnGhost} onClick={handleRefreshLibrary} disabled={busy}>
                  Refresh
                </button>
                <button type="button" className={styles.smallBtnGhost} onClick={onClear} disabled={!selectedCount || busy}>
                  Clear selected
                </button>
              </div>

              <div className={styles.elementHint}>
                Usa el botón <b>Elements</b> para abrir esta biblioteca y luego menciona tus Elements en el prompt con <b>@</b>. Solo los custom Elements con estado <b>READY VERIFIED</b> pueden insertarse o enviarse a Kling; los demás deben refrescarse o recrearse.
              </div>

              <div className={styles.elementAllGrid}>
                {currentElements.map((el) => renderElementCard(el))}
              </div>

              {currentElements.length === 0 && (
                <div className={styles.elementEmptyHero}>
                  {tab === "presets"
                    ? "No encontré presets con esa búsqueda."
                    : "Todavía no tienes Elements propios. Crea uno con imágenes o video para empezar."}
                </div>
              )}
            </>
          )}

          {tab === "create" && (
            <>
              <div className={styles.elementCreateIntro}>
                Crea Elements avanzados para Kling 3.0 / O3 usando <b>image_refer</b> o <b>video_refer</b>. Luego podrás invocarlos desde el prompt mediante menciones <b>@</b>.
              </div>

              <div className={styles.elementFormRow}>
                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Name *</div>
                  <input
                    className={styles.search}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder='Ej: "Wow Poppy"'
                    maxLength={20}
                    disabled={busy}
                  />
                  <div className={styles.elementHint}>{newName.length}/20</div>
                </div>

                <div className={styles.elementField}>
                  <div className={styles.elementLabel}>Reference type</div>
                  <div className={styles.elementTabs}>
                    <button
                      type="button"
                      className={`${styles.elementTabBtn} ${newReferenceType === "image_refer" ? styles.elementTabBtnActive : ""}`}
                      onClick={() => setNewReferenceType("image_refer")}
                      disabled={busy}
                    >
                      image_refer
                    </button>
                    <button
                      type="button"
                      className={`${styles.elementTabBtn} ${newReferenceType === "video_refer" ? styles.elementTabBtnActive : ""}`}
                      onClick={() => setNewReferenceType("video_refer")}
                      disabled={busy}
                    >
                      video_refer
                    </button>
                  </div>
                </div>
              </div>

              <div className={styles.elementField}>
                <div className={styles.elementLabel}>Description</div>
                <input
                  className={styles.search}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Describe el sujeto, estilo, detalles y consistencia visual"
                  maxLength={100}
                  disabled={busy}
                />
                <div className={styles.elementHint}>{newDescription.length}/100</div>
              </div>

              <div className={styles.elementField}>
                <div className={styles.elementLabel}>Tags</div>
                <div className={styles.elementTagPicker}>
                  {KLING_ELEMENT_TAG_OPTIONS.map((tag) => {
                    const active = newTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`${styles.elementTagPickerChip} ${active ? styles.elementTagPickerChipActive : ""}`}
                        onClick={() => toggleTag(tag.id)}
                        disabled={busy}
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
                <div className={styles.elementHint}>Puedes combinar hasta 8 tags oficiales por Element.</div>
              </div>

              {newReferenceType === "image_refer" ? (
                <>
                  <div className={styles.elementSectionTitle}>Selected image references</div>
                  <div className={styles.elementSlots}>
                    {pickedImageAssets.map((asset, idx) => (
                      <div key={asset.id} className={styles.elementSlotCard}>
                        <div className={styles.elementSlotThumb}>
                          <img src={assetThumb(asset, getAssetUrl)} alt={asset.name || `Reference ${idx + 1}`} />
                        </div>
                        <div className={styles.elementSlotActions}>
                          <button type="button" className={styles.smallBtnGhost} disabled>
                            {idx === 0 ? "Front" : `Ref ${idx}`}
                          </button>
                          {idx > 0 && (
                            <button type="button" className={styles.smallBtnGhost} onClick={() => moveAssetToFront(asset.id)} disabled={busy}>
                              Set front
                            </button>
                          )}
                          <button type="button" className={styles.smallBtnGhost} onClick={() => togglePickAsset(asset.id)} disabled={busy}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}

                    {pickedImageAssets.length < 4 && (
                      <button type="button" className={styles.elementSlotCard} onClick={() => imageInputRef.current?.click()} disabled={busy}>
                        <div className={styles.elementSlotThumb}>
                          <div className={styles.elementSlotEmpty}>Upload image</div>
                        </div>
                      </button>
                    )}
                  </div>

                  <div className={styles.elementHint}>
                    image_refer usa la primera imagen como frontal y de 1 a 3 imágenes extra como referencias laterales o de detalle.
                  </div>

                  <div className={styles.elementPicker}>
                    <div className={styles.elementPickerTop}>
                      <div className={styles.elementPickerTitle}>Image library</div>
                      <div className={styles.elementAllMeta}>Selected: {pickedAssetIds.length}/4</div>
                    </div>
                    <div className={styles.elementAllTop}>
                      <input
                        className={styles.search}
                        placeholder="Search images..."
                        value={assetQuery}
                        onChange={(e) => setAssetQuery(e.target.value)}
                      />
                      <button type="button" className={styles.smallBtnGhost} onClick={() => imageInputRef.current?.click()} disabled={busy}>
                        Upload image
                      </button>
                    </div>
                    <div className={styles.elementAllGrid}>
                      {filteredAssets.map((asset) => {
                        const active = pickedAssetIds.includes(asset.id);
                        return (
                          <div key={asset.id} className={`${styles.elementAllCard} ${active ? styles.elementAllCardActive : ""}`}>
                            <button type="button" className={styles.elementAllThumb} onClick={() => togglePickAsset(asset.id)}>
                              <img src={assetThumb(asset, getAssetUrl)} alt={asset.name || "Asset"} />
                              <span className={styles.elementAllBadge}>{active ? "SELECTED" : "SELECT"}</span>
                            </button>
                            <div className={styles.elementAllName}>{asset.name || "Untitled image"}</div>
                            <div className={styles.elementAllActions}>
                              <button type="button" className={styles.smallBtn} onClick={() => togglePickAsset(asset.id)}>
                                {active ? "Remove" : "Use"}
                              </button>
                              {active && pickedAssetIds[0] !== asset.id && (
                                <button type="button" className={styles.smallBtnGhost} onClick={() => moveAssetToFront(asset.id)}>
                                  Set front
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.elementSectionTitle}>Video reference</div>
                  {pickedVideoAsset ? (
                    <div className={styles.elementSlotCard}>
                      <div className={styles.elementSlotThumb}>
                        <video src={assetThumb(pickedVideoAsset, getAssetUrl)} muted playsInline preload="metadata" autoPlay loop />
                      </div>
                      <div className={styles.elementSlotActions}>
                        <button type="button" className={styles.smallBtnGhost} disabled>
                          {pickedVideoMeta ? formatVideoMeta(pickedVideoMeta) : "Selected video"}
                        </button>
                        <button type="button" className={styles.smallBtnGhost} onClick={() => setPickedVideoAssetId(null)} disabled={busy}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className={styles.elementSlotCard} onClick={() => videoInputRef.current?.click()} disabled={busy}>
                      <div className={styles.elementSlotThumb}>
                        <div className={styles.elementSlotEmpty}>Upload or choose video</div>
                      </div>
                    </button>
                  )}

                  <div className={styles.elementHint}>
                    video_refer admite un solo video 1080p, 16:9 o 9:16, con duración entre 3 y 8 segundos. Si el video contiene voz, puede vincularse con voice customization.
                  </div>

                  <div className={styles.elementField}>
                    <div className={styles.elementLabel}>Bind voice (optional)</div>
                    <div className={styles.elementAllTop}>
                      <input
                        className={styles.search}
                        placeholder="Search voices..."
                        value={voiceQuery}
                        onChange={(e) => setVoiceQuery(e.target.value)}
                        disabled={!voiceBindingAllowed}
                      />
                      <button type="button" className={styles.smallBtnGhost} onClick={() => loadVoices(true)} disabled={voicesLoading || busy}>
                        {voicesLoading ? "Loading..." : "Refresh voices"}
                      </button>
                    </div>
                    <select
                      className={styles.select}
                      value={voicePickerValue}
                      onChange={(e) => setVoicePickerValue(e.target.value)}
                      disabled={!voiceBindingAllowed || busy}
                    >
                      <option value="">No voice binding</option>
                      {filteredVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.label}
                        </option>
                      ))}
                      <option value="__custom__">Custom voice ID…</option>
                    </select>
                    {voicePickerValue === "__custom__" && (
                      <input
                        className={styles.search}
                        placeholder="Paste element_voice_id"
                        value={customVoiceId}
                        onChange={(e) => setCustomVoiceId(e.target.value)}
                        disabled={busy}
                      />
                    )}
                    {voicesError && <div className={styles.elementHint}>{voicesError}</div>}
                  </div>

                  <div className={styles.elementPicker}>
                    <div className={styles.elementPickerTop}>
                      <div className={styles.elementPickerTitle}>Video library</div>
                    </div>
                    <div className={styles.elementAllTop}>
                      <input
                        className={styles.search}
                        placeholder="Search videos..."
                        value={videoQuery}
                        onChange={(e) => setVideoQuery(e.target.value)}
                      />
                      <button type="button" className={styles.smallBtnGhost} onClick={() => videoInputRef.current?.click()} disabled={busy}>
                        Upload video
                      </button>
                    </div>
                    <div className={styles.elementAllGrid}>
                      {filteredVideoAssets.map((asset) => {
                        const active = pickedVideoAssetId === asset.id;
                        const src = assetThumb(asset, getAssetUrl);
                        return (
                          <div key={asset.id} className={`${styles.elementAllCard} ${active ? styles.elementAllCardActive : ""}`}>
                            <button type="button" className={styles.elementAllThumb} onClick={() => setPickedVideoAssetId(active ? null : asset.id)}>
                              <video src={src} muted playsInline preload="metadata" autoPlay loop />
                              <span className={styles.elementAllBadge}>{active ? "SELECTED" : "SELECT"}</span>
                            </button>
                            <div className={styles.elementAllName}>{asset.name || "Untitled video"}</div>
                            <div className={styles.elementAllActions}>
                              <button type="button" className={styles.smallBtn} onClick={() => setPickedVideoAssetId(active ? null : asset.id)}>
                                {active ? "Remove" : "Use"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className={styles.elementFooter}>
                <button type="button" className={styles.smallBtnGhost} onClick={() => setTab("library")} disabled={busy}>
                  Back to library
                </button>
                <button type="button" className={styles.elementPrimaryBtn} onClick={handleCreate} disabled={busy}>
                  {busy ? "Creating..." : "Create Element"}
                </button>
              </div>
            </>
          )}

          {!!localError && (
            <div className={styles.elementHint} style={{ color: "rgba(255,160,160,0.9)" }}>
              {localError}
            </div>
          )}

          <div className={styles.elementFooter}>
            <button type="button" className={styles.smallBtnGhost} onClick={onClear} disabled={!selectedCount || busy}>
              Clear selection
            </button>
            <button type="button" className={styles.elementPrimaryBtn} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUploadImage(file);
        }}
      />

      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUploadVideo(file);
        }}
      />
    </div>
  );
}
