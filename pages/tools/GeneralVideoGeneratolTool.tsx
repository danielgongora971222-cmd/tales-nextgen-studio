import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ImageGeneratorTool.module.css";
import { useAuth } from "../../contexts/AuthContext";
import { deleteAsset, listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { generateVideo } from "../../services/geminiService";
import { Asset } from "../../types";
import ErrorModal from "../../components/ErrorModal";

type Panel = null | "reference" | "model" | "duration";
type RefSlot = "primary" | "secondary";
type RefType = "image" | "video";

type RefConfig = {
  label: string;
  type: RefType;
  enabled: boolean;
};

type VideoModelConfig = {
  id: string;
  label: string;
  group: string;
  hint: string;
  durations: string[];
  refs: {
    primary: RefConfig;
    secondary: RefConfig;
  };
};

const TOOL_ID = "general-video-generator";
const REF_TOOL_ID = "general-video-generator-ref";

const VIDEO_MODELS: VideoModelConfig[] = [
  {
    id: "openai:video",
    label: "OpenAI Video",
    group: "OpenAI",
    hint: "Fortalezas: escenas consistentes con personajes, movimientos suaves y narrativa cinematográfica.",
    durations: ["4s", "8s", "12s"],
    refs: {
      primary: { label: "Frame inicial", type: "image", enabled: true },
      secondary: { label: "Frame final", type: "image", enabled: true },
    },
  },
  {
    id: "openai:sora-2",
    label: "Sora 2 Video",
    group: "OpenAI",
    hint: "Fortalezas: realismo, cámara dinámica y efectos cinematográficos avanzados.",
    durations: ["4s", "8s", "15s"],
    refs: {
      primary: { label: "Frame inicial", type: "image", enabled: true },
      secondary: { label: "Frame final", type: "image", enabled: true },
    },
  },
  {
    id: "google:veo-3",
    label: "Veo 3",
    group: "Google Veo",
    hint: "Fortalezas: iluminación natural, cámaras estables y detalle en movimiento.",
    durations: ["5s", "10s", "20s"],
    refs: {
      primary: { label: "Frame inicial", type: "image", enabled: true },
      secondary: { label: "Frame final", type: "image", enabled: true },
    },
  },
  {
    id: "google:veo-3.1",
    label: "Veo 3.1",
    group: "Google Veo",
    hint: "Fortalezas: continuidad visual, texturas ricas y escenas de acción fluidas.",
    durations: ["5s", "10s", "20s"],
    refs: {
      primary: { label: "Frame inicial", type: "image", enabled: true },
      secondary: { label: "Frame final", type: "image", enabled: true },
    },
  },
  {
    id: "kling:2.6",
    label: "Kling 2.6",
    group: "Kling",
    hint: "Fortalezas: control preciso de escenas con frames iniciales y finales.",
    durations: ["4s", "8s", "12s"],
    refs: {
      primary: { label: "Frame inicial", type: "image", enabled: true },
      secondary: { label: "Frame final", type: "image", enabled: true },
    },
  },
  {
    id: "kling:2.6-audio",
    label: "Kling 2.6 + Audio nativo",
    group: "Kling",
    hint: "Fortalezas: sincronía con audio y transiciones suaves desde un frame inicial.",
    durations: ["4s", "8s"],
    refs: {
      primary: { label: "Frame inicial", type: "image", enabled: true },
      secondary: { label: "Frame final (no disponible)", type: "image", enabled: false },
    },
  },
  {
    id: "kling:o1-image-to-video",
    label: "o1 Image to Video",
    group: "Kling Omni Reference 01",
    hint: "Fortalezas: convertir imágenes clave en clips con continuidad de estilo.",
    durations: ["4s", "8s", "12s"],
    refs: {
      primary: { label: "Frame inicial", type: "image", enabled: true },
      secondary: { label: "Frame final", type: "image", enabled: true },
    },
  },
  {
    id: "kling:o1-transformation",
    label: "o1 Transformation",
    group: "Kling Omni Reference 01",
    hint: "Fortalezas: transformar un video existente con guía de imagen y prompt.",
    durations: ["4s", "8s"],
    refs: {
      primary: { label: "Video inicial", type: "video", enabled: true },
      secondary: { label: "Imagen de transformación", type: "image", enabled: true },
    },
  },
  {
    id: "kling:o1-video-reference",
    label: "o1 Video Reference",
    group: "Kling Omni Reference 01",
    hint: "Fortalezas: continuar escenas desde video de referencia con apoyo de imágenes.",
    durations: ["4s", "8s", "12s"],
    refs: {
      primary: { label: "Video de referencia", type: "video", enabled: true },
      secondary: { label: "Imagen extra", type: "image", enabled: true },
    },
  },
];

const getModelConfig = (modelId: string) => VIDEO_MODELS.find((model) => model.id === modelId) || VIDEO_MODELS[0];

const GeneralVideoGeneratolTool: React.FC = () => {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(VIDEO_MODELS[0].id);
  const [duration, setDuration] = useState(VIDEO_MODELS[0].durations[0]);
  const [refs, setRefs] = useState<Record<RefSlot, Asset | null>>({
    primary: null,
    secondary: null,
  });

  const [panel, setPanel] = useState<Panel>(null);
  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const [history, setHistory] = useState<Asset[]>([]);
  const [visibleHistory, setVisibleHistory] = useState<Asset[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const historyLoadMoreRef = useRef<HTMLDivElement | null>(null);

  const [myAssets, setMyAssets] = useState<Asset[]>([]);
  const [viewer, setViewer] = useState<Asset | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);

  const activeModel = useMemo(() => getModelConfig(model), [model]);

  useEffect(() => {
    if (!activeModel.durations.includes(duration)) {
      setDuration(activeModel.durations[0]);
    }

    setRefs((prev) => {
      const next = { ...prev };
      if (prev.primary && prev.primary.type !== activeModel.refs.primary.type) {
        next.primary = null;
      }
      if (!activeModel.refs.secondary.enabled) {
        next.secondary = null;
      } else if (prev.secondary && prev.secondary.type !== activeModel.refs.secondary.type) {
        next.secondary = null;
      }
      return next;
    });

    setPanel(null);
    setPickerSlot(null);
    setPickerQuery("");
  }, [activeModel, duration]);

  const modelGroups = useMemo(() => {
    const grouped = VIDEO_MODELS.reduce<Record<string, VideoModelConfig[]>>((acc, entry) => {
      acc[entry.group] = acc[entry.group] ? [...acc[entry.group], entry] : [entry];
      return acc;
    }, {});
    return Object.entries(grouped).map(([label, options]) => ({ label, options }));
  }, []);

  const slotConfig = (slot: RefSlot) => activeModel.refs[slot];

  const refLabel =
    [refs.primary ? "R1" : null, refs.secondary ? "R2" : null].filter(Boolean).join(" ") || "None";

  const durationLabel = duration || "—";

  const pickerCandidates = useMemo(() => {
    if (!pickerSlot) return [];
    const config = slotConfig(pickerSlot);
    const query = pickerQuery.trim().toLowerCase();

    return myAssets
      .filter((asset) => asset.type === config.type)
      .filter((asset) => {
        if (!query) return true;
        const name = String(asset.name || "").toLowerCase();
        const promptText = String(asset.prompt || "").toLowerCase();
        return name.includes(query) || promptText.includes(query);
      });
  }, [myAssets, pickerQuery, pickerSlot, activeModel]);

  function setRootGlow(xPct: number, yPct: number) {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--mx", `${xPct}%`);
    el.style.setProperty("--my", `${yPct}%`);
  }

  function handleRootMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setRootGlow(x, y);
  }

  function handleRootMouseLeave() {
    setRootGlow(50, 20);
  }

  function setRefSlot(slot: RefSlot, asset: Asset | null) {
    setRefs((prev) => ({ ...prev, [slot]: asset }));
  }

  async function handleUploadToSlot(slot: RefSlot, file: File) {
    const config = slotConfig(slot);
    const isVideo = file.type.startsWith("video");
    const isImage = file.type.startsWith("image");
    if ((config.type === "video" && !isVideo) || (config.type === "image" && !isImage)) {
      setError(`Este slot solo acepta archivos ${config.type}.`);
      return;
    }

    try {
      const uploaded = await uploadUserAsset(file, REF_TOOL_ID);
      setRefSlot(slot, uploaded);
      setPanel(null);
      setPickerSlot(null);
      setPickerQuery("");
    } catch (err: any) {
      setError(err?.message || "Upload falló.");
    }
  }

  async function handleGenerate() {
    if (!user) {
      setError("Debes iniciar sesión para generar.");
      return;
    }

    const basePrompt = prompt.trim();
    if (!basePrompt) return;

    setIsGenerating(true);
    setError(null);
    try {
      await generateVideo(basePrompt);
      await reloadHistory();
    } catch (err: any) {
      setError(err?.message || "No se pudo generar el video.");
    } finally {
      setIsGenerating(false);
    }
  }

  function isGeneratedHistoryItem(asset: Asset): boolean {
    const meta = (asset as any)?.meta || {};
    const tool = typeof meta.tool === "string" ? meta.tool : null;
    if (tool && tool !== TOOL_ID) return false;
    return asset.type === "video";
  }

  async function reloadHistory() {
    setIsLoadingHistory(true);
    try {
      const assets = await listMyAssets({ limit: 300 });
      const sorted = [...assets].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setMyAssets(sorted);
      const onlyVideos = sorted.filter(isGeneratedHistoryItem);
      setHistory(onlyVideos);
      setHistoryPage(1);
      setVisibleHistory(onlyVideos.slice(0, 12));
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar el historial.");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  useEffect(() => {
    reloadHistory();
  }, []);

  const hasMoreHistory = visibleHistory.length < history.length;

  useEffect(() => {
    const target = historyLoadMoreRef.current;
    if (!target || !hasMoreHistory) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || isLoadingMore) return;
        setIsLoadingMore(true);
        window.setTimeout(() => {
          setHistoryPage((prev) => {
            const nextPage = prev + 1;
            setVisibleHistory(history.slice(0, nextPage * 12));
            return nextPage;
          });
          setIsLoadingMore(false);
        }, 600);
      },
      { threshold: 0.2 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreHistory, history, isLoadingMore]);

  async function handleTogglePublish(asset: Asset) {
    try {
      if (asset.isPublic) {
        await unpublishAsset(asset.id);
      } else {
        await publishAsset(asset.id);
      }
      await reloadHistory();
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar la visibilidad.");
    }
  }

  async function handleDelete(asset: Asset) {
    try {
      await deleteAsset(asset.id);
      await reloadHistory();
      setViewer(null);
    } catch (err: any) {
      setError(err?.message || "No se pudo eliminar el asset.");
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("No se pudo copiar el prompt.");
    }
  }

  function reusePromptFromAsset(asset: Asset) {
    setPrompt(asset.prompt || "");
    const meta = (asset as any)?.meta || {};
    if (typeof meta.model === "string") {
      setModel(meta.model);
    }
    if (typeof meta.duration === "string") {
      setDuration(meta.duration);
    }
    setViewer(null);
  }

  const promptPlaceholder = prompt.trim().length === 0 ? activeModel.hint : "";

  const renderAssetThumb = (asset: Asset) => {
    if (asset.type === "video") {
      return <video src={asset.url} muted playsInline preload="metadata" />;
    }
    return <img src={asset.url} alt={asset.name} />;
  };

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onMouseMove={handleRootMouseMove}
      onMouseLeave={handleRootMouseLeave}
    >
      <ErrorModal error={error} onClose={() => setError(null)} />

      <div className={styles.stage}>
        <div className={styles.historyHeader}>
          <div className={styles.historyTitle}>
            <span className={styles.kicker}>GENERAL VIDEO GENERATOR</span>
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
          {history.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyAnimator}>
                <div className={styles.emptyGrid} />
                <div className={styles.emptyGlow} />
                <div className={styles.emptyScan} />
                <div className={styles.emptyOrb} />
              </div>
              <div className={styles.emptyCopy}>
                <div className={styles.emptyCode}>NO VIDEOS</div>
                <div className={styles.emptyText}>Genera tu primer video para ver el historial aquí.</div>
              </div>
            </div>
          ) : (
            <div className={styles.grid}>
              {visibleHistory.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className={styles.tile}
                  onClick={() => setViewer(asset)}
                  title="Click para ver detalles"
                >
                  <video className={styles.tileImg} src={asset.url} muted playsInline preload="metadata" />

                  <div className={styles.tileMeta}>
                    <span className={styles.tileCaption}>{asset.prompt || asset.name || "—"}</span>
                    {asset.isPublic && <span className={styles.publicTag}>PUBLIC</span>}
                  </div>

                  <div className={styles.tileActions} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title={asset.isPublic ? "Quitar de público" : "Publicar"}
                      onClick={() => handleTogglePublish(asset)}
                    >
                      <span>↗</span>
                    </button>

                    <button
                      type="button"
                      className={styles.iconBtnDanger}
                      title="Eliminar"
                      onClick={() => handleDelete(asset)}
                    >
                      <span>✕</span>
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}

          {hasMoreHistory && (
            <div className={styles.historyLoader} ref={historyLoadMoreRef}>
              <div className={styles.historyLoaderSpinner} aria-hidden="true" />
              <span>{isLoadingMore ? "Cargando más..." : "Desliza para cargar más"}</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.dockWrap}>
        <div className={styles.dock}>
          {(refs.primary || refs.secondary) && (
            <div className={styles.refThumbStrip}>
              {refs.primary && (
                <div className={styles.refMini} title={activeModel.refs.primary.label}>
                  {renderAssetThumb(refs.primary)}
                  <span className={styles.refMiniIcon}>R1</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Reference 1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRefSlot("primary", null);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              {refs.secondary && (
                <div className={styles.refMini} title={activeModel.refs.secondary.label}>
                  {renderAssetThumb(refs.secondary)}
                  <span className={styles.refMiniIcon}>R2</span>
                  <button
                    type="button"
                    className={styles.refMiniRemove}
                    aria-label="Remove Reference 2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRefSlot("secondary", null);
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={styles.promptRow}>
            <div className={styles.promptInputWrap}>
              <div className={styles.promptEditor}>
                <textarea
                  className={styles.prompt}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={promptPlaceholder}
                  rows={2}
                />
                {prompt.trim().length === 0 && <div className={styles.promptHint}>{activeModel.hint}</div>}
              </div>
            </div>

            <div className={styles.generateCol}>
              <button
                type="button"
                className={styles.generateBtn}
                disabled={isGenerating || !prompt.trim()}
                onClick={handleGenerate}
                data-loading={isGenerating ? "true" : "false"}
              >
                <span className={styles.generateLabel}>{isGenerating ? "GENERATING" : "GENERATE"}</span>
                {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
              </button>
            </div>
          </div>

          <div className={styles.controlsRow}>
            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "reference" ? styles.controlBtnActive : ""}`}
              onClick={() => {
                setPanel((prev) => (prev === "reference" ? null : "reference"));
                setPickerSlot(null);
              }}
            >
              <span>Reference</span>
              <span className={styles.controlBtnMeta}>{refLabel}</span>
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((prev) => (prev === "model" ? null : "model"))}
            >
              <span>Model</span>
              <span className={styles.controlBtnMeta}>{activeModel.label}</span>
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "duration" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((prev) => (prev === "duration" ? null : "duration"))}
            >
              <span>Duration</span>
              <span className={styles.controlBtnMeta}>{durationLabel}</span>
            </button>
          </div>

          {panel && (
            <div className={styles.popover}>
              {panel === "reference" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Reference</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      ✕
                    </button>
                  </div>

                  <div className={styles.refSlots}>
                    {(["primary", "secondary"] as RefSlot[]).map((slot) => {
                      const config = slotConfig(slot);
                      const asset = refs[slot];
                      const isDisabled = !config.enabled;

                      return (
                        <div key={slot} className={`${styles.refSlot} ${isDisabled ? styles.refSlotDisabled : ""}`}>
                          <div className={styles.refSlotLeft}>
                            <div className={styles.refSlotLabel}>{config.label}</div>
                            <div className={styles.refSlotThumb}>
                              {asset ? (
                                renderAssetThumb(asset)
                              ) : (
                                <div className={styles.refSlotEmpty}>{isDisabled ? "NO DISPONIBLE" : "EMPTY"}</div>
                              )}
                            </div>
                          </div>

                          <div className={styles.refSlotRight}>
                            <button
                              type="button"
                              className={styles.smallBtn}
                              onClick={() => {
                                setPickerSlot(slot);
                                setPickerQuery("");
                              }}
                              disabled={isDisabled}
                            >
                              Pick
                            </button>

                            <label className={styles.smallBtn}>
                              Upload
                              <input
                                type="file"
                                accept={config.type === "video" ? "video/*" : "image/*"}
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleUploadToSlot(slot, file);
                                  e.currentTarget.value = "";
                                }}
                                disabled={isDisabled}
                              />
                            </label>

                            <button
                              type="button"
                              className={styles.smallBtnGhost}
                              onClick={() => setRefSlot(slot, null)}
                              disabled={!asset || isDisabled}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {pickerSlot && (
                    <div className={styles.pickerArea}>
                      <div className={styles.pickerTop}>
                        <input
                          className={styles.search}
                          value={pickerQuery}
                          onChange={(e) => setPickerQuery(e.target.value)}
                          placeholder="Buscar en tu librería..."
                        />
                      </div>
                      <div className={styles.pickerGrid}>
                        {pickerCandidates.map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
                            className={styles.pickerTile}
                            onClick={() => {
                              setRefSlot(pickerSlot, asset);
                              setPanel(null);
                              setPickerSlot(null);
                              setPickerQuery("");
                            }}
                          >
                            {asset.type === "video" ? (
                              <video className={styles.pickerVideo} src={asset.url} muted playsInline preload="metadata" />
                            ) : (
                              <img src={asset.url} alt={asset.name} />
                            )}
                            <div className={styles.pickerTileCap}>{asset.prompt || asset.name || "Untitled"}</div>
                          </button>
                        ))}
                        {pickerCandidates.length === 0 && (
                          <div className={styles.emptyText}>No hay assets compatibles todavía.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {panel === "model" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Model</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      ✕
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Model</label>
                    <div className={styles.modelGrid}>
                      {modelGroups.map((group) => (
                        <div key={group.label} className={styles.modelGroup}>
                          <div className={styles.modelGroupLabel}>{group.label}</div>
                          <div className={styles.modelGroupOptions}>
                            {group.options.map((opt) => (
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
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {panel === "duration" && (
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>Duration</div>
                    <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button">
                      ✕
                    </button>
                  </div>

                  <div className={styles.paramGrid}>
                    <div className={styles.formRow}>
                      <label className={styles.formLabel}>Tiempo de video</label>
                      <select
                        className={styles.select}
                        value={duration}
                        onChange={(e) => {
                          setDuration(e.target.value);
                          setPanel(null);
                        }}
                      >
                        {activeModel.durations.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {viewer && (
        <div className={styles.viewerBackdrop} onClick={() => setViewer(null)}>
          <div className={styles.viewer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.viewerTop}>
              <div className={styles.viewerTitle}>
                <span className={styles.viewerKicker}>GENERATION</span>
                <span className={styles.viewerSub}>{viewer.isPublic ? "PUBLIC" : "PRIVATE"}</span>
              </div>

              <div className={styles.viewerTopActions}>
                <button className={styles.iconBtn} type="button" title="Copiar prompt" onClick={() => copyToClipboard(viewer.prompt || "")}
                >
                  ⧉
                </button>

                <button className={styles.iconBtn} type="button" title="Reusar prompt" onClick={() => reusePromptFromAsset(viewer)}>
                  ↺
                </button>

                <button
                  className={styles.iconBtn}
                  type="button"
                  title={viewer.isPublic ? "Quitar de público" : "Publicar"}
                  onClick={() => handleTogglePublish(viewer)}
                >
                  ↗
                </button>

                <button className={styles.iconBtnDanger} type="button" title="Eliminar" onClick={() => handleDelete(viewer)}>
                  ✕
                </button>

                <button className={styles.closeBtn} type="button" onClick={() => setViewer(null)} title="Cerrar">
                  ✕
                </button>
              </div>
            </div>

            <div className={styles.viewerBody}>
              <div className={styles.viewerImageWrap}>
                <video className={styles.viewerImage} src={viewer.url} controls autoPlay loop />
              </div>

              <div className={styles.viewerRecipe}>
                <div className={styles.viewerRecipeTitle}>RECIPE</div>

                <div className={styles.recipeGrid}>
                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Model</div>
                    <div className={styles.recipeValue}>{(viewer as any)?.meta?.model || "—"}</div>
                  </div>
                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Duration</div>
                    <div className={styles.recipeValue}>{(viewer as any)?.meta?.duration || "—"}</div>
                  </div>
                </div>

                <div className={styles.recipeBlock}>
                  <div className={styles.recipeLabel}>Prompt</div>
                  <div className={styles.recipeValue}>{viewer.prompt || "—"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GeneralVideoGeneratolTool;
