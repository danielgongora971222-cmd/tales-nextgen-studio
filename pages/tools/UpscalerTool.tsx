import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ImageGeneratorTool.module.css";
import videoStyles from "./VideoGeneratorTool.module.css";

import ErrorModal from "../../components/ErrorModal";
import { Asset, GeminiModel } from "../../types";
import { generateImageBatch } from "../../services/geminiService";
import { deleteAsset, listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";

import { AssetPickerModal } from "./video/AssetPickerModal";

type Quality = "1K" | "2K" | "4K";
type PanelKey = "model" | "quality" | null;

const TOOL_ID = "upscaler";
const REF_TOOL_ID = "upscaler-ref";

// Para no cargar infinito (puedes subir/bajar)
const HISTORY_LIMIT = 300;

// === Bloque oculto (para que el prompt NO se muestre en UI/Feed) ===
const UPSCALE_MASTER_BLOCK_START = "[[UPSCALE_MASTER_START]]";
const UPSCALE_MASTER_BLOCK_END = "[[UPSCALE_MASTER_END]]";

// Prompt maestro (optimizado para fidelidad total)
const UPSCALE_MASTER_PROMPT = `
You are an image restoration + upscaling system.
Goal: output the SAME image at higher resolution and higher quality.

Hard constraints (do not violate):
- Treat the reference image as ground-truth. Preserve identity, face geometry, body proportions, pose, composition, camera angle, and perspective.
- Preserve every detail: hairline, freckles, makeup, jewelry, tattoos, clothing seams, patterns, logos, text, and background elements.
- Preserve the original style exactly. If the reference is photorealistic, keep it photorealistic. If it is illustration/anime/3D/cartoon, keep that style.
- Do NOT add, remove, or invent objects or details. Do NOT beautify or alter the subject.

Enhance only:
- Increase resolution and recover micro-detail without changing shapes.
- Remove compression artifacts, banding, moiré, chroma noise, dust/scratches (if present), and unwanted blur.
- Improve local contrast and sharpness naturally (no halos, no oversharpening).
- Preserve natural skin texture; avoid plastic/waxy skin.
- Maintain the original lighting and color palette; only correct exposure/white balance if it matches the original intent.

Avoid / do not:
- Creative reinterpretation, style transfer, new lighting, new color grading, new background, face reshaping, identity change.
- Over-smoothing, over-sharpening, painterly artifacts, cartoonification, extra film grain, watermark/text changes.
`.trim();

const MODEL_OPTIONS: Array<{ id: string; label: string; qualities: Quality[] }> = [
  { id: GeminiModel.IMAGE_PRO, label: "NanoBanana Pro", qualities: ["1K", "2K", "4K"] },
  { id: "fal-ai/flux-2-max", label: "Flux Max", qualities: ["1K", "2K", "4K"] },
  { id: "openai:gpt-image-1.5-high", label: "GPT 1.5 High", qualities: ["1K"] },
];

function Icon({ name }: { name: "image" | "upload" | "share" | "download" | "trash" | "reuse" | "close" }) {
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

function removeUpscaleMasterBlock(input: string) {
  const re = new RegExp(`${escapeRegExp(UPSCALE_MASTER_BLOCK_START)}[\\s\\S]*?${escapeRegExp(UPSCALE_MASTER_BLOCK_END)}\\n*`, "g");
  return (input || "").replace(re, "").trim();
}

function applyUpscaleMasterToPrompt(base: string) {
  const cleaned = removeUpscaleMasterBlock(base).trim();
  const block = `${UPSCALE_MASTER_BLOCK_START}\n${UPSCALE_MASTER_PROMPT}\n${UPSCALE_MASTER_BLOCK_END}\n\n`;
  return `${block}${cleaned}`.trim();
}

function prettyModelLabel(modelId: string | null): string {
  if (!modelId) return "Unknown";
  return MODEL_OPTIONS.find((m) => m.id === modelId)?.label || modelId;
}

function getAssetUrl(a: Asset): string | null {
  const url = (a as any)?.url;
  return typeof url === "string" && url.length ? url : null;
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

function isGeneratedUpscale(a: Asset): boolean {
  const meta = (a as any).meta || {};
  const metaTool = typeof meta.tool === "string" ? meta.tool : null;
  const source = typeof meta.source === "string" ? meta.source : null;
  const model = typeof meta.model === "string" ? meta.model : null;
  const hasPrompt = typeof a.prompt === "string" && a.prompt.trim().length > 0;

  if (source === "upload") return false;
  if (metaTool !== TOOL_ID) return false;
  if (!model) return false;
  if (!hasPrompt) return false;
  return true;
}

const UpscalerTool: React.FC = () => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);

  const [myAssets, setMyAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<Asset[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [viewer, setViewer] = useState<Asset | null>(null);

  const [baseRef, setBaseRef] = useState<Asset | null>(null);
  const [isBasePickerOpen, setIsBasePickerOpen] = useState(false);

  // ✅ Default: NanoBanana Pro
  const [model, setModel] = useState<string>(GeminiModel.IMAGE_PRO);
  const [quality, setQuality] = useState<Quality>("4K");

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);

  const modelLabel = useMemo(() => prettyModelLabel(model), [model]);

  const allowedQualities = useMemo(() => {
    const caps = MODEL_OPTIONS.find((m) => m.id === model);
    return caps?.qualities || ["1K"];
  }, [model]);

  const qualityLabel = useMemo(() => normalizeQuality(model, quality), [model, quality]);

  async function reloadHistory() {
    setIsLoadingHistory(true);
    try {
      const assets = await listMyAssets({ type: "image", limit: HISTORY_LIMIT });

      const sorted = [...assets].sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      setMyAssets(sorted);
      setHistory(sorted.filter(isGeneratedUpscale));
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
    // Ajusta quality automáticamente si el modelo no soporta la actual
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

  async function handleTogglePublish(asset: Asset) {
    try {
      if (asset.isPublic) {
        const r = await unpublishAsset(asset.id);
        setHistory((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPublic: r.isPublic } : a)));
        if (viewer?.id === asset.id) setViewer((v) => (v ? { ...v, isPublic: r.isPublic } : v));
      } else {
        const r = await publishAsset(asset.id);
        setHistory((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPublic: r.isPublic } : a)));
        if (viewer?.id === asset.id) setViewer((v) => (v ? { ...v, isPublic: r.isPublic } : v));
      }
    } catch (e: any) {
      setError(e?.message || "No se pudo cambiar visibilidad.");
    }
  }

  async function handleDownload(asset: Asset) {
    try {
      const resp = await fetch(asset.url);
      if (!resp.ok) throw new Error("No se pudo descargar la imagen.");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = asset.name || "image";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar la imagen.");
    }
  }

  async function handleDelete(asset: Asset) {
    const ok = window.confirm("¿Seguro que deseas eliminar esta imagen? Esta acción no se puede deshacer.");
    if (!ok) return;

    try {
      await deleteAsset(asset.id);
      setHistory((prev) => prev.filter((x) => x.id !== asset.id));
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

    setIsGenerating(true);
    setError(null);
    setPanel(null);

    const slotId = `pending_${Date.now()}`;
    setPendingSlots([slotId]);

    try {
      const basePrompt = "Restore and upscale the reference image.";
      const finalPrompt = applyUpscaleMasterToPrompt(basePrompt);
      const effectiveQuality = normalizeQuality(model, quality);

      await generateImageBatch(finalPrompt, model, {
        aspectRatio: "auto",
        count: 1,
        quality: effectiveQuality,
        tool: TOOL_ID,
        nameHint: `upscale_${slugName(baseRef.name || "image")}`,
        characterAssetIds: [baseRef.id],
      });

      await reloadHistory();
    } catch (e: any) {
      setError(e?.message || "Failed to upscale image.");
    } finally {
      setIsGenerating(false);
      setPendingSlots([]);
    }
  }

  function reuseFromAsset(asset: Asset) {
    const meta = (asset as any).meta || {};

    const metaModel = typeof meta.model === "string" ? meta.model : null;
    if (metaModel && MODEL_OPTIONS.some((m) => m.id === metaModel)) setModel(metaModel);

    const metaQ = typeof meta.quality === "string" ? (meta.quality as Quality) : null;
    if (metaQ) setQuality(normalizeQuality(metaModel || model, metaQ));

    const charIds = Array.isArray(meta.characterAssetIds) ? meta.characterAssetIds : [];
    const first = typeof charIds[0] === "string" ? charIds[0] : null;
    if (first) {
      const found = myAssets.find((a) => a.id === first) || null;
      setBaseRef(found);
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

    return { modelId, quality: q, refs };
  }, [viewer, myAssets]);

  return (
    <div ref={rootRef} className={styles.root}>
      {/* HISTORIAL */}
      <div className={styles.stage}>
        <div className={styles.historyHeader}>
          <div className={styles.historyTitle}>
            <span className={styles.kicker}>UPSCALE</span>
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
                <div className={styles.emptyCode}>NO UPSCALES</div>
                <div className={styles.emptyText}>Sube una imagen y genera tu primer upscale.</div>
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

              {history.map((asset) => {
                const meta = (asset as any).meta || {};
                const q = typeof meta.quality === "string" ? meta.quality : null;
                const caption = q ? `UPSCALE · ${q}` : "UPSCALE";

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
                        title="Reusar settings"
                        onClick={() => reuseFromAsset(asset)}
                      >
                        <Icon name="reuse" />
                      </button>

                      <button
                        type="button"
                        className={styles.iconBtn}
                        title={asset.isPublic ? "Quitar de público" : "Publicar"}
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
        </div>
      </div>

      {/* DOCK (estilo Lightroom) */}
      <div className={styles.dockWrap}>
        <div className={styles.dock}>
          <div className={videoStyles.frameStrip}>
            {/* Reference Image */}
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

          {/* Prompt oculto: solo status */}
          <div className={styles.promptRow}>
            <div className={styles.promptInputWrap}>
              <div className={styles.promptEditor}>
                <div style={{ padding: 10, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                  {!baseRef ? "Add a reference image." : `Ready → ${modelLabel} · ${qualityLabel}`}
                </div>
              </div>
            </div>

            <div className={styles.generateCol}>
              <button
                type="button"
                className={styles.generateBtn}
                disabled={isGenerating || !baseRef}
                onClick={handleGenerate}
                data-loading={isGenerating ? "true" : "false"}
              >
                <span className={styles.generateLabel}>{isGenerating ? "GENERATING" : "UPSCALE"}</span>
                {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Reference picker + upload */}
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

                <button className={styles.iconBtn} type="button" title={viewer.isPublic ? "Quitar de público" : "Publicar"} onClick={() => handleTogglePublish(viewer)}>
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
                    <div className={styles.recipeLabel}>Prompt</div>
                    <div className={styles.recipeValue}>Hidden</div>
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
              </div>
            </div>
          </div>
        </div>
      )}

      <ErrorModal error={error} onClose={() => setError(null)} />
    </div>
  );
};

export default UpscalerTool;
