import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ImageGeneratorTool.module.css";
import videoStyles from "./VideoGeneratorTool.module.css";

import ErrorModal from "../../components/ErrorModal";
import { Asset, GeminiModel } from "../../types";
import { generateImageBatch } from "../../services/geminiService";
import { deleteAsset, listMyAssets, uploadUserAsset, downloadAssetToDisk } from "../../services/assetsApi";
import { AssetPickerModal } from "./video/AssetPickerModal";
import { STYLE_PRESETS } from "../../config/presets/restyle";
import OneNationUpIcon from "@/components/brand/OneNationUpIcon";
import { estimateImageCostCredits } from "../../config/pricing.js";

type Quality = "1K" | "2K" | "4K";
type PanelKey = "model" | "quality" | null;

const TOOL_ID = "restyler";
const REF_TOOL_ID = "restyler-ref";

const HISTORY_INITIAL_COUNT = 24;
const HISTORY_LOAD_MORE_COUNT = 24;

const STYLE_PRESET_BLOCK_START = "[[STYLE_PRESET_START]]";
const STYLE_PRESET_BLOCK_END = "[[STYLE_PRESET_END]]";
const LEGACY_STYLE_PRESET_BLOCK_START = "/* STYLE_PRESET_START */";
const LEGACY_STYLE_PRESET_BLOCK_END = "/* STYLE_PRESET_END */";

type StylePreset = (typeof STYLE_PRESETS)[number];

const MODEL_OPTIONS: Array<{ id: string; label: string; qualities: Quality[] }> = [
  { id: GeminiModel.IMAGE_PRO, label: "NanoBanana Pro", qualities: ["1K", "2K", "4K"] },
  { id: "fal-ai/flux-2-max", label: "Flux Max", qualities: ["1K", "2K", "4K"] },
  { id: "openai:gpt-image-1.5-high", label: "GPT 1.5 High", qualities: ["1K"] },
];

// Iconitos (SVG inline) — nada externo
function Icon({
  name,
}: {
  name: "image" | "upload" | "mode" | "share" | "download" | "trash" | "copy" | "reuse" | "close";
}) {
  switch (name) {
    case "image":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm2 0v10.5l2.8-2.8a1 1 0 0 1 1.4 0l2.6 2.6 3.8-3.8a1 1 0 0 1 1.4 0L20 12.7V5H6zm0 14h12v-3.6l-4.5-4.5-3.8 3.8a1 1 0 0 1-1.4 0L9.5 14.9 6 18.4V19z"
          />
        </svg>
      );
    case "upload":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1z"
          />
          <path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "mode":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M14.7 3.3a1 1 0 0 1 1.4 0l4.2 4.2a1 1 0 0 1 0 1.4l-9.9 9.9-5 1a1 1 0 0 1-1.2-1.2l1-5 9.5-9.3zM6.2 14.6l-.6 3 3-.6 8.6-8.6-2.4-2.4-8.6 8.6z"
          />
        </svg>
      );
    case "share":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18 16a3 3 0 0 0-2.4 1.2l-6.3-3.15a3.1 3.1 0 0 0 0-1.05l6.3-3.15A3 3 0 1 0 15 7a3 3 0 0 0 .1.75L8.8 10.9a3 3 0 1 0 0 2.2l6.3 3.15A3 3 0 1 0 18 16z"
          />
        </svg>
      );
    case "download":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1z"
          />
          <path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M9 3h6l1 2h4a1 1 0 1 1 0 2h-1l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4a1 1 0 1 1 0-2h4l1-2zm0 6a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0v-9a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0v-9a1 1 0 0 1 1-1z"
          />
        </svg>
      );
    case "copy":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7z"
          />
          <path
            fill="currentColor"
            d="M6 3h9a1 1 0 1 1 0 2H6a1 1 0 0 0-1 1v11a1 1 0 1 1-2 0V6a3 3 0 0 1 3-3z"
          />
        </svg>
      );
    case "reuse":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 6V3l-4 4 4 4V8c2.76 0 5 2.24 5 5a5 5 0 0 1-9.9 1 1 1 0 1 1-1.96.4A7 7 0 0 0 12 20a7 7 0 0 0 0-14z"
          />
        </svg>
      );
    case "close":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4z"
          />
        </svg>
      );
    default:
      return null;
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeStylePresetBlock(input: string) {
  let out = input;
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`, "g");
    out = out.replace(re, "");
  }
  return out.trim();
}

function applyStylePresetToPrompt(input: string, presetPrompt: string) {
  const base = removeStylePresetBlock(input).trim();
  const block = `${STYLE_PRESET_BLOCK_START}\n${presetPrompt}\n${STYLE_PRESET_BLOCK_END}\n\n`;
  return `${block}${base}`.trim();
}

function extractStyleBlock(input: string) {
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const s = input.indexOf(start);
    const e = input.indexOf(end);
    if (s !== -1 && e !== -1 && e > s) {
      const inside = input.slice(s + start.length, e).trim();
      return inside || null;
    }
  }
  return null;
}

function getStyleNameFromPrompt(prompt: string): string {
  const inside = extractStyleBlock(prompt || "");
  if (!inside) return "None";
  const match = STYLE_PRESETS.find((p) => (p.prompt || "").trim() === inside.trim());
  return match?.name || "Custom";
}

function prettyModelLabel(modelId: string | null): string {
  if (!modelId) return "Unknown";
  return MODEL_OPTIONS.find((m) => m.id === modelId)?.label || modelId;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function getAssetUrl(a: Asset): string | null {
  const url = (a as any)?.url;
  return typeof url === "string" && url.length ? url : null;
}

function isGeneratedHistoryItem(a: Asset): boolean {
  const meta = (a as any).meta || {};
  const metaTool = typeof meta.tool === "string" ? meta.tool : null;
  const source = typeof meta.source === "string" ? meta.source : null;
  const model = typeof meta.model === "string" ? meta.model : null;

  const hasPrompt = typeof a.prompt === "string" && a.prompt.trim().length > 0;

  // ✅ historial SOLO: generaciones reales de Restyler
  if (source === "upload") return false;
  if (metaTool !== TOOL_ID) return false;
  if (!model) return false;
  if (!hasPrompt) return false;
  return true;
}

function normalizeQuality(modelId: string, q: Quality): Quality {
  const caps = MODEL_OPTIONS.find((m) => m.id === modelId);
  const allowed = caps?.qualities || ["1K"];
  return allowed.includes(q) ? q : allowed[allowed.length - 1];
}

function slugName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function StylePickerModal(props: {
  open: boolean;
  selectedStyleId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { open, selectedStyleId, onSelect, onClear, onClose } = props;
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return STYLE_PRESETS;
    return STYLE_PRESETS.filter((p) => String(p.name || "").toLowerCase().includes(q));
  }, [query]);

  if (!open) return null;

  return (
    <div className={videoStyles.modalOverlay} role="dialog" aria-modal="true">
      <div className={videoStyles.modal}>
        <div className={videoStyles.modalHeader}>
          <div className={videoStyles.modalTitle}>Select style</div>
          <button className={videoStyles.modalClose} onClick={onClose} type="button" title="Cerrar">
            ×
          </button>
        </div>

        <div className={videoStyles.modalActions}>
          <input
            className={videoStyles.search}
            placeholder="Buscar estilos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <button className={videoStyles.uploadBtn} type="button" onClick={onClear}>
            CLEAR
          </button>
        </div>

        <div className={styles.presetGrid} style={{ padding: 16 }}>
          {filtered.map((p: StylePreset) => {
            const active = selectedStyleId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`${styles.presetCard} ${active ? styles.presetCardActive : ""}`}
                onClick={() => {
                  onSelect(p.id);
                  onClose();
                }}
              >
                <div className={styles.presetCover}>
                  {p.coverUrl ? <img src={p.coverUrl} alt={p.name} /> : <div className={styles.presetCoverEmpty} />}
                </div>
                <div className={styles.presetName}>{p.name}</div>
              </button>
            );
          })}

          {filtered.length === 0 && <div className={videoStyles.pickerEmpty}>No hay estilos que coincidan.</div>}
        </div>
      </div>
    </div>
  );
}

const RestylerTool: React.FC = () => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);

  const [myAssets, setMyAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<Asset[]>([]);
  const [visibleHistory, setVisibleHistory] = useState<Asset[]>([]);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_INITIAL_COUNT);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);

  const [viewer, setViewer] = useState<Asset | null>(null);

  const [baseRef, setBaseRef] = useState<Asset | null>(null);
  const [isBasePickerOpen, setIsBasePickerOpen] = useState(false);

  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [isStylePickerOpen, setIsStylePickerOpen] = useState(false);

  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].id);
  const [quality, setQuality] = useState<Quality>("1K");

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);

  const selectedStyle = useMemo(() => {
    if (!selectedStyleId) return null;
    return STYLE_PRESETS.find((p) => p.id === selectedStyleId) || null;
  }, [selectedStyleId]);

  const modelLabel = useMemo(() => prettyModelLabel(model), [model]);

  const allowedQualities = useMemo(() => {
    const caps = MODEL_OPTIONS.find((m) => m.id === model);
    return caps?.qualities || ["1K"];
  }, [model]);

  const qualityLabel = useMemo(() => {
    const q = normalizeQuality(model, quality);
    return q;
  }, [model, quality]);

  const estimatedCostCredits = useMemo(() => {
    return estimateImageCostCredits({ model, quality: qualityLabel, count: 1 });
  }, [model, qualityLabel]);

  async function reloadHistory() {
    setIsLoadingHistory(true);
    try {
      const assets = await listMyAssets({ type: "image", limit: 300 });

      const sorted = [...assets].sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      setMyAssets(sorted);

      const onlyGenerated = sorted.filter(isGeneratedHistoryItem);
      setHistory(onlyGenerated);
      setHistoryVisibleCount(HISTORY_INITIAL_COUNT);
      setVisibleHistory(onlyGenerated.slice(0, HISTORY_INITIAL_COUNT));
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el historial.");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  useEffect(() => {
    reloadHistory();
  }, []);

  useEffect(() => {
    setQuality((prev) => normalizeQuality(model, prev));
  }, [model]);

  // Click fuera cierra popover
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!panel) return;
      const t = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(t)) return;
      setPanel(null);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [panel]);

  const hasMoreHistory = visibleHistory.length < history.length;

  function handleLoadMoreHistory() {
    if (!hasMoreHistory) return;
    if (isLoadingMoreHistory) return;

    setIsLoadingMoreHistory(true);
    window.setTimeout(() => {
      setHistoryVisibleCount((prev) => {
        const next = Math.min(history.length, prev + HISTORY_LOAD_MORE_COUNT);
        setVisibleHistory(history.slice(0, next));
        return next;
      });
      setIsLoadingMoreHistory(false);
    }, 200);
  }

  function handleTogglePublish(asset: Asset) {
    window.dispatchEvent(new CustomEvent("tales:open-sell", { detail: { asset } }));
  }

  async function handleDownload(asset: Asset) {
    try {
      await downloadAssetToDisk(asset.id, asset.name || "image");
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar.");
    }
  }

  async function handleDelete(asset: Asset) {
    const ok = window.confirm("¿Seguro que deseas eliminar esta imagen? Esta acción no se puede deshacer.");
    if (!ok) return;

    try {
      await deleteAsset(asset.id);
      setHistory((prev) => {
        const next = prev.filter((x) => x.id !== asset.id);
        const nextCount = Math.min(historyVisibleCount, next.length);
        setHistoryVisibleCount(nextCount);
        setVisibleHistory(next.slice(0, nextCount));
        return next;
      });
      if (viewer?.id === asset.id) setViewer(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar.");
    }
  }

  async function uploadReference(file: File): Promise<Asset> {
    const asset = await uploadUserAsset(file, { tool: REF_TOOL_ID, type: "image", name: file.name });
    setMyAssets((prev) => [asset, ...prev]);
    return asset;
  }

  async function handleGenerate() {
    if (isGenerating) return;
    if (!baseRef) {
      setError("Sube/selecciona la imagen de referencia (Reference Image).");
      return;
    }
    if (!selectedStyle) {
      setError("Selecciona un Style.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setPanel(null);

    // placeholder (1 output)
    const slotId = `pending_${Date.now()}`;
    setPendingSlots([slotId]);

    try {
      const basePrompt = "Restyle reference image.";
      const finalPrompt = applyStylePresetToPrompt(basePrompt, selectedStyle.prompt);

      const effectiveQuality = normalizeQuality(model, quality);

      await generateImageBatch(finalPrompt, model, {
        aspectRatio: "auto",
        count: 1,
        quality: effectiveQuality,
        tool: TOOL_ID,
        nameHint: `restyle_${slugName(selectedStyle.name)}`,
        characterAssetIds: [baseRef.id],
      });

      await reloadHistory();
    } catch (e: any) {
      setError(e?.message || "Failed to restyle image.");
    } finally {
      setIsGenerating(false);
      setPendingSlots([]);
    }
  }

  function reuseFromAsset(asset: Asset) {
    const meta = (asset as any).meta || {};

    // model
    const metaModel = typeof meta.model === "string" ? meta.model : null;
    if (metaModel && MODEL_OPTIONS.some((m) => m.id === metaModel)) {
      setModel(metaModel);
    }

    // quality
    const metaQ = typeof meta.quality === "string" ? (meta.quality as Quality) : null;
    if (metaQ) setQuality(normalizeQuality(metaModel || model, metaQ));

    // baseRef from meta.characterAssetIds[0]
    const charIds = Array.isArray(meta.characterAssetIds) ? meta.characterAssetIds : [];
    const first = typeof charIds[0] === "string" ? charIds[0] : null;
    if (first) {
      const found = myAssets.find((a) => a.id === first) || null;
      setBaseRef(found);
    }

    // style from embedded style block
    const inside = extractStyleBlock(asset.prompt || "") || "";
    if (inside) {
      const match = STYLE_PRESETS.find((p) => (p.prompt || "").trim() === inside.trim());
      setSelectedStyleId(match ? match.id : null);
    } else {
      setSelectedStyleId(null);
    }
  }

  const viewerRecipeInfo = useMemo(() => {
    if (!viewer) return null;
    const meta = (viewer as any).meta || {};
    const modelId = typeof meta.model === "string" ? meta.model : null;
    const q = typeof meta.quality === "string" ? meta.quality : null;

    const charIds: string[] = Array.isArray(meta.characterAssetIds) ? meta.characterAssetIds : [];
    const refs = {
      chars: charIds
        .map((id) => myAssets.find((a) => a.id === id) || null)
        .filter(Boolean) as Asset[],
    };

    return {
      modelId,
      quality: q,
      styleName: getStyleNameFromPrompt(viewer.prompt || ""),
      refs,
    };
  }, [viewer, myAssets]);

  const previewStyleCover = selectedStyle?.coverUrl || null;

  return (
    <div ref={rootRef} className={styles.root}>
      {/* HISTORIAL */}
      <div className={styles.stage}>
        <div className={styles.historyHeader}>
          <div className={styles.historyTitle}>
            <span className={styles.kicker}>RESTYLER</span>
            <div className={styles.historyMeta}>
              {isLoadingHistory ? (
                <span className={styles.subKicker}>Loading history...</span>
              ) : (
                <>
                  <span className={styles.subKicker}>History</span>
                  <span className={styles.historyCount}>{history.length}</span>
                </>
              )}
            </div>
          </div>

          <button className={styles.ghostBtn} onClick={reloadHistory} type="button" disabled={isLoadingHistory}>
            Refresh
          </button>
        </div>

        <div className={styles.historyGrid}>
          {history.length === 0 && pendingSlots.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyAnimator}>
                <div className={styles.emptyGrid} />
                <div className={styles.emptyGlow} />
                <div className={styles.emptyScan} />
                <div className={styles.emptyOrb} />
              </div>
              <div className={styles.emptyCopy}>
                <div className={styles.emptyCode}>NO GENERATIONS</div>
                <div className={styles.emptyText}>Elige una imagen + un estilo y genera tu primer restyle.</div>
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
                const caption = removeStylePresetBlock(asset.prompt || "") || asset.name || "—";
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={styles.tile}
                    onClick={() => setViewer(asset)}
                    title="Click para ver detalles"
                  >
                    <img className={styles.tileImg} src={asset.url} alt={asset.name} loading="lazy" decoding="async" />

                    <div className={styles.tileMeta}>
                      <span className={styles.tileCaption}>{caption}</span>
                      {asset.isPublic && <span className={styles.publicTag}>PUBLIC</span>}
                    </div>

                    <div className={styles.tileActions} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        title="1NationUp Store"
                        onClick={() => window.dispatchEvent(new CustomEvent("tales:open-store", { detail: { asset } }))}
                      >
                        <OneNationUpIcon size={18} />
                      </button>

                      <button
                        type="button"
                        className={styles.iconBtn}
                        title="Vender / Administrar listing"
                        onClick={() => handleTogglePublish(asset)}
                      >
                        <Icon name="share" />
                      </button>

                      <button type="button" className={styles.iconBtn} title="Descargar" onClick={() => handleDownload(asset)}>
                        <Icon name="download" />
                      </button>

                      <button type="button" className={styles.iconBtnDanger} title="Eliminar" onClick={() => handleDelete(asset)}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {hasMoreHistory && (
            <div className={styles.historyLoadMoreWrap}>
              <button type="button" className={styles.loadMoreBtn} onClick={handleLoadMoreHistory} disabled={isLoadingMoreHistory}>
                {isLoadingMoreHistory ? "Cargando..." : "Cargar más"}
              </button>
              <div className={styles.loadMoreHint}>
                Mostrando {visibleHistory.length} de {history.length}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DOCK */}
      <div className={styles.dockWrap}>
        <div className={styles.dock}>
          <div className={videoStyles.frameStrip}>
            {/* Reference Image (like FIRST FRAME) */}
            <button
              type="button"
              className={videoStyles.frameCard}
              onClick={() => setIsBasePickerOpen(true)}
              title="Select reference image"
            >
              {baseRef ? (
                <img className={videoStyles.frameCardImg} src={baseRef.url} alt={baseRef.name || "Reference"} />
              ) : (
                <div className={videoStyles.frameCardEmpty}>
                  <div className={videoStyles.frameCardIcons}>
                    <Icon name="image" />
                    <Icon name="upload" />
                  </div>
                  <div className={videoStyles.frameCardEmptyText}>SELECT IMAGE</div>
                </div>
              )}

              <span className={videoStyles.frameCardBadge}>REF</span>

              {baseRef && (
                <button
                  type="button"
                  className={videoStyles.frameCardRemove}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBaseRef(null);
                  }}
                  title="Remove"
                >
                  ×
                </button>
              )}
            </button>

            {/* Style (like LAST FRAME slot, but opens style presets) */}
            <button
              type="button"
              className={videoStyles.frameCard}
              onClick={() => setIsStylePickerOpen(true)}
              title="Select style"
            >
              {previewStyleCover ? (
                <img className={videoStyles.frameCardImg} src={previewStyleCover} alt={selectedStyle?.name || "Style"} />
              ) : (
                <div className={videoStyles.frameCardEmpty}>
                  <div className={videoStyles.frameCardIcons}>
                    <Icon name="mode" />
                  </div>
                  <div className={videoStyles.frameCardEmptyText}>SELECT STYLE</div>
                </div>
              )}

              <span className={videoStyles.frameCardBadge}>STYLE</span>

              {selectedStyleId && (
                <button
                  type="button"
                  className={videoStyles.frameCardRemove}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedStyleId(null);
                  }}
                  title="Clear"
                >
                  ×
                </button>
              )}
            </button>
          </div>

          <div className={styles.controlsRow}>
            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
            >
              <span>Model</span>
              <span className={styles.controlBtnMeta}>{modelLabel}</span>
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "quality" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "quality" ? null : "quality"))}
            >
              <span>Quality</span>
              <span className={styles.controlBtnMeta}>{qualityLabel}</span>
            </button>
          </div>

          {panel && (
            <div className={styles.popover} ref={popoverRef}>
              {panel === "model" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Model</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      <Icon name="close" />
                    </button>
                  </div>

                  <div className={styles.modelGrid}>
                    <div className={styles.modelGroup}>
                      <div className={styles.modelGroupLabel}>Available</div>
                      <div className={styles.modelGroupOptions}>
                        {MODEL_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className={`${styles.modelOption} ${model === opt.id ? styles.modelOptionActive : ""}`}
                            onClick={() => {
                              setModel(opt.id);
                              setPanel(null);
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {panel === "quality" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Quality</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      <Icon name="close" />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Quality</label>
                    <select
                      className={styles.select}
                      value={qualityLabel}
                      onChange={(e) => {
                        setQuality(e.target.value as Quality);
                        setPanel(null);
                      }}
                    >
                      {allowedQualities.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sin prompt editable: solo estado + botón */}
          <div className={styles.promptRow}>
            <div className={styles.promptInputWrap}>
              <div className={styles.promptEditor}>
                <div style={{ padding: 10, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                  {!baseRef ? "Add a reference image." : ""}
                  {baseRef && !selectedStyle ? "Select a style preset." : ""}
                  {baseRef && selectedStyle ? `Restyle → ${selectedStyle.name}` : ""}
                </div>
              </div>
            </div>

            <div className={styles.generateCol}>
              <button
                type="button"
                className={styles.generateBtn}
                disabled={isGenerating || !baseRef || !selectedStyleId}
                onClick={handleGenerate}
                data-loading={isGenerating ? "true" : "false"}
              >
                <span className={styles.generateLabel}>{isGenerating ? "GENERATING" : "RESTYLE"}</span>
                {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
              </button>

              <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.65)", textAlign: "center" }}>
                Coste estimado: <b>{estimatedCostCredits}</b> créditos
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AssetPickerModal
        open={isBasePickerOpen}
        title="Reference Image"
        kind="image"
        assets={myAssets.filter((a: any) => (a?.type ? a.type === "image" : true))}
        selectedId={baseRef?.id || null}
        onSelect={(a) => setBaseRef(a)}
        onClose={() => setIsBasePickerOpen(false)}
        onUpload={uploadReference}
        getAssetUrl={getAssetUrl}
      />

      <StylePickerModal
        open={isStylePickerOpen}
        selectedStyleId={selectedStyleId}
        onSelect={(id) => setSelectedStyleId(id)}
        onClear={() => setSelectedStyleId(null)}
        onClose={() => setIsStylePickerOpen(false)}
      />

      {/* VIEWER */}
      {viewer && (
        <div className={styles.viewerBackdrop} onClick={() => setViewer(null)}>
          <div className={styles.viewer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.viewerTop}>
              <div className={styles.viewerTitle}>
                <span className={(styles as any).viewerKicker}>GENERATION</span>
                <span className={(styles as any).viewerSub}>{viewer.isPublic ? "PUBLIC" : "PRIVATE"}</span>
              </div>

              <div className={styles.viewerTopActions}>
                <button className={styles.iconBtn} type="button" title="Copiar prompt" onClick={() => copyToClipboard(viewer.prompt || "")}>
                  <Icon name="copy" />
                </button>

                <button
                  className={styles.iconBtn}
                  type="button"
                  title="Reusar settings"
                  onClick={() => {
                    reuseFromAsset(viewer);
                    setViewer(null);
                  }}
                >
                  <Icon name="reuse" />
                </button>

                <button className={styles.iconBtn} type="button" title="Vender / Administrar listing" onClick={() => handleTogglePublish(viewer)}>
                  <Icon name="share" />
                </button>

                <button className={styles.iconBtn} type="button" title="Descargar" onClick={() => handleDownload(viewer)}>
                  <Icon name="download" />
                </button>

                <button className={styles.iconBtnDanger} type="button" title="Eliminar" onClick={() => handleDelete(viewer)}>
                  <Icon name="trash" />
                </button>

                <button className={styles.closeBtn} type="button" onClick={() => setViewer(null)} title="Cerrar">
                  <Icon name="close" />
                </button>
              </div>
            </div>

            <div className={styles.viewerBody}>
              <div className={styles.viewerImageWrap}>
                <img className={styles.viewerImage} src={viewer.url} alt={viewer.name} />
              </div>

              <div className={styles.viewerRecipe}>
                <div className={styles.viewerRecipeTitle}>RECIPE</div>

                <div className={styles.recipeGrid}>
                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Model</div>
                    <div className={styles.recipeValue}>{prettyModelLabel(viewerRecipeInfo?.modelId || null)}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Quality</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.quality || "—"}</div>
                  </div>

                  <div className={styles.recipeItemWide}>
                    <div className={styles.recipeLabel}>Style</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.styleName || "None"}</div>
                  </div>
                </div>

                <div className={styles.recipeRefs}>
                  <div className={styles.recipeLabel}>Reference</div>
                  <div className={styles.recipeRefStrip}>
                    {(viewerRecipeInfo?.refs?.chars?.length || 0) > 0 ? (
                      viewerRecipeInfo!.refs.chars.map((a, i) => (
                        <div key={a.id} className={styles.recipeRefThumb} title={`Reference ${i + 1}`}>
                          <img src={a.url} alt={`Reference ${i + 1}`} />
                          <span className={styles.recipeRefTag}>R{i + 1}</span>
                        </div>
                      ))
                    ) : (
                      <div className={(styles as any).recipeEmpty}>No saved refs (legacy)</div>
                    )}
                  </div>
                </div>

                <div className={styles.recipeBlock}>
                  <div className={styles.recipeLabel}>Prompt</div>
                  <div className={styles.recipeValue}>{removeStylePresetBlock(viewer.prompt || "") || "—"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ErrorModal error={error} onClose={() => setError(null)} />
    </div>
  );
};

export default RestylerTool;
