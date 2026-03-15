import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import ErrorModal from "../../components/ErrorModal";
import { useAuth } from "../../contexts/AuthContext";
import type { Asset } from "../../types";
import {
  deleteAsset,
  downloadAssetToDisk,
  listMyAssets,
  uploadUserAsset,
} from "../../services/assetsApi";
import { apiPostJson, formatErr } from "../../services/videoGenApi";
import { waitJobCompletion } from "../../services/jobsApi";
import { estimateVideoCostCredits } from "../../config/pricing.js";
import { HistorySection } from "./video/HistorySection";
import { AssetPickerModal } from "./video/AssetPickerModal";
import { Icon } from "./video/icon";

type Orientation = "image" | "video";
type MotionControlModel = "kling-2.6-motion-control" | "kling-v3-motion-control";
type MotionPanelKey = "model" | "quality" | null;
type PickerKind = "image" | "video";

type PendingMotionControlJob = {
  jobId: string;
  taskId?: string;
  prompt: string;
  imageAssetId: string;
  videoAssetId: string;
  keepOriginalSound: boolean;
  characterOrientation: Orientation;
  mode: "std" | "pro";
  model: MotionControlModel;
  createdAt: number;
};

const TOOL_ID = "motion-control";
const HISTORY_INITIAL_COUNT = 12;
const HISTORY_LOAD_MORE_COUNT = 9;
const UPLOAD_TOOL = "motion-control-ref";
const PENDING_MOTION_KEY = "tales_pending_motion_control_job_v1";

function normalizeMotionControlModel(value: unknown): MotionControlModel {
  return value === "kling-v3-motion-control" ? "kling-v3-motion-control" : "kling-2.6-motion-control";
}

function resolveMotionControlPricingModel(model: MotionControlModel, mode: "std" | "pro") {
  if (model === "kling-v3-motion-control") {
    return mode === "pro" ? "kling-v3-motion-control-pro" : "kling-v3-motion-control";
  }
  return mode === "pro" ? "kling-2.6-motion-control-pro" : "kling-2.6-motion-control";
}

function getMotionControlModelLabel(model: MotionControlModel) {
  return model === "kling-v3-motion-control"
    ? "Kling 3.0 Motion Control"
    : "Kling 2.6 Motion Control";
}

function getMotionQualityLabel(mode: "std" | "pro") {
  return mode === "pro" ? "1080p" : "720p";
}

function prettyMotionModelLabel(raw: unknown) {
  const value = String(raw || "").toLowerCase();
  if (value.includes("v3")) return "Kling 3.0 Motion Control";
  if (value.includes("2.6")) return "Kling 2.6 Motion Control";
  return value ? String(raw) : "—";
}

function getMetaTool(asset: Asset): string {
  const meta = (asset as any)?.meta || {};
  return typeof meta.tool === "string" ? meta.tool : "";
}

function isMotionControlAsset(asset: Asset) {
  const meta = (asset as any)?.meta || {};
  return (
    asset.type === "video" &&
    getMetaTool(asset) === TOOL_ID &&
    (meta?.motionControl || meta?.model || meta?.provider)
  );
}

function byCreatedDesc(a: Asset, b: Asset) {
  return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
}

function savePending(job: PendingMotionControlJob) {
  try {
    localStorage.setItem(PENDING_MOTION_KEY, JSON.stringify(job));
  } catch {}
}

function loadPending(): PendingMotionControlJob | null {
  try {
    const raw = localStorage.getItem(PENDING_MOTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw || "{}");
    if (!parsed?.jobId || !parsed?.imageAssetId || !parsed?.videoAssetId) return null;
    return {
      jobId: String(parsed.jobId),
      taskId: parsed?.taskId ? String(parsed.taskId) : undefined,
      prompt: typeof parsed?.prompt === "string" ? parsed.prompt : "",
      imageAssetId: String(parsed.imageAssetId),
      videoAssetId: String(parsed.videoAssetId),
      keepOriginalSound: parsed?.keepOriginalSound !== false,
      characterOrientation: parsed?.characterOrientation === "image" ? "image" : "video",
      mode: parsed?.mode === "pro" ? "pro" : "std",
      model: normalizeMotionControlModel(parsed?.model),
      createdAt: Number(parsed?.createdAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_MOTION_KEY);
  } catch {}
}

function getAssetUrl(asset: Asset | null | undefined): string | null {
  if (!asset?.url) return null;
  return asset.url;
}

function RecipeItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.recipeItem}>
      <div className={styles.recipeLabel}>{label}</div>
      <div className={styles.recipeValue}>{value}</div>
    </div>
  );
}

function MotionReferenceCard({
  title,
  kind,
  asset,
  onChoose,
  onUploadClick,
  onClear,
}: {
  title: string;
  kind: PickerKind;
  asset: Asset | null;
  onChoose: () => void;
  onUploadClick: () => void;
  onClear: () => void;
}) {
  return (
    <div className={styles.motionReferenceCard}>
      <div
        className={styles.motionReferenceMediaButton}
        onClick={onChoose}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onChoose();
          }
        }}
        role="button"
        tabIndex={0}
        title={asset ? title : `${title} · abrir historial`}
      >
        <div className={styles.motionReferenceMedia}>
          {asset ? (
            kind === "video" ? (
              <video
                className={styles.motionReferencePreview}
                src={asset.url}
                muted
                playsInline
                autoPlay
                loop
                preload="metadata"
              />
            ) : (
              <img className={styles.motionReferencePreview} src={asset.url} alt={asset.name || title} />
            )
          ) : (
            <div className={styles.motionReferenceEmpty}>
              <div className={styles.motionReferenceEmptyIcon}>
                <Icon name={kind === "video" ? "video" : "image"} />
              </div>
              <div className={styles.motionReferenceEmptyTitle}>{title}</div>
            </div>
          )}

          <span className={styles.motionReferenceBadge}>{kind === "video" ? "MOTION" : "CHARACTER"}</span>

          {asset && (
            <button
              type="button"
              className={styles.frameCardRemove}
              aria-label={`Remove ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClear();
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className={styles.motionReferenceFooter}>
        <div className={styles.motionReferenceTitle}>{title}</div>
        <div className={styles.motionReferenceName}>{asset?.name || "From history or upload"}</div>
      </div>

      <div className={styles.motionReferenceActions}>
        <button type="button" className={styles.ghostBtn} onClick={onChoose}>
          History
        </button>
        <button type="button" className={styles.ghostBtn} onClick={onUploadClick}>
          Upload
        </button>
      </div>
    </div>
  );
}

export default function MotionControlTool() {
  const { user } = useAuth();

  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<Asset[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_INITIAL_COUNT);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [viewer, setViewer] = useState<Asset | null>(null);
  const [viewerRefImage, setViewerRefImage] = useState<Asset | null>(null);
  const [viewerRefVideo, setViewerRefVideo] = useState<Asset | null>(null);

  const [refImage, setRefImage] = useState<Asset | null>(null);
  const [refVideo, setRefVideo] = useState<Asset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [characterOrientation, setCharacterOrientation] = useState<Orientation>("video");
  const [mode, setMode] = useState<"std" | "pro">("std");
  const [model, setModel] = useState<MotionControlModel>("kling-v3-motion-control");
  const [advancedOpen, setAdvancedOpen] = useState(true);

  const [panel, setPanel] = useState<MotionPanelKey>(null);
  const [isCookOpen, setIsCookOpen] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<PickerKind>("image");
  const [imageLibrary, setImageLibrary] = useState<Asset[]>([]);
  const [videoLibrary, setVideoLibrary] = useState<Asset[]>([]);
  const [imageLibraryLoading, setImageLibraryLoading] = useState(false);
  const [videoLibraryLoading, setVideoLibraryLoading] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [pendingJob, setPendingJob] = useState<PendingMotionControlJob | null>(null);

  const hoverVideoEls = useRef<Record<string, HTMLVideoElement | null>>({});
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const imageUploadRef = useRef<HTMLInputElement | null>(null);
  const videoUploadRef = useRef<HTMLInputElement | null>(null);

  const visibleHistory = useMemo(
    () => history.slice(0, Math.min(historyVisibleCount, history.length)),
    [history, historyVisibleCount]
  );
  const hasMoreHistory = historyVisibleCount < history.length;
  const pendingSlots = useMemo(() => (pendingJob ? [pendingJob.jobId] : []), [pendingJob]);

  const pickerAssets = pickerKind === "image" ? imageLibrary : videoLibrary;
  const pickerSelectedId = pickerKind === "image" ? refImage?.id || null : refVideo?.id || null;
  const pickerLoading = pickerKind === "image" ? imageLibraryLoading : videoLibraryLoading;
  const pickerTitle = pickerKind === "image" ? "Choose your character" : "Choose motion to copy";

  const canGenerate = Boolean(user && refImage && refVideo && !isGenerating);
  const selectedModelLabel = getMotionControlModelLabel(model);
  const selectedQualityLabel = getMotionQualityLabel(mode);
  const estimatedCostCredits = useMemo(() => {
    const pricingModelNorm = resolveMotionControlPricingModel(model, mode);
    return estimateVideoCostCredits({
      modelNorm: pricingModelNorm,
      durationSeconds: 5,
      resolution: mode === "pro" ? "1080p" : "720p",
      klingMode: mode,
    });
  }, [model, mode]);

  const isCookSidebarVisible = isCookOpen && !panel;
  const isCookLayerVisible = isCookOpen || !!panel;

  const setRootGlow = useCallback((xPct: number, yPct: number) => {
    const element = rootRef.current;
    if (!element) return;
    element.style.setProperty("--mx", `${xPct}%`);
    element.style.setProperty("--my", `${yPct}%`);
  }, []);

  const handleRootMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const element = rootRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      setRootGlow(x, y);
    },
    [setRootGlow]
  );

  const handleRootMouseLeave = useCallback(() => {
    setRootGlow(50, 20);
  }, [setRootGlow]);

  const openCook = useCallback(() => {
    setPanel(null);
    setAdvancedOpen(true);
    setIsCookOpen(true);
  }, []);

  const closeCook = useCallback(() => {
    setPanel(null);
    setIsCookOpen(false);
  }, []);

  const restoreCookFromPanel = useCallback(() => {
    setPanel(null);
    setIsCookOpen(true);
  }, []);

  const reloadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const videos = await listMyAssets({ type: "video", limit: 200, fresh: true });
      const next = videos.filter(isMotionControlAsset).sort(byCreatedDesc);
      setHistory(next);
      setHistoryVisibleCount((prev) => {
        const base = Math.max(HISTORY_INITIAL_COUNT, prev);
        return Math.min(base, Math.max(next.length, HISTORY_INITIAL_COUNT));
      });
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar el historial.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const loadLibrary = useCallback(async (kind: PickerKind, force = false) => {
    if (kind === "image") {
      if (imageLibraryLoading) return;
      if (!force && imageLibrary.length > 0) return;
      setImageLibraryLoading(true);
      try {
        const items = await listMyAssets({ type: "image", limit: 200, fresh: force });
        setImageLibrary(items.sort(byCreatedDesc));
      } catch (err: any) {
        setError(err?.message || "No se pudo cargar tu librería de imágenes.");
      } finally {
        setImageLibraryLoading(false);
      }
      return;
    }

    if (videoLibraryLoading) return;
    if (!force && videoLibrary.length > 0) return;
    setVideoLibraryLoading(true);
    try {
      const items = await listMyAssets({ type: "video", limit: 200, fresh: force });
      setVideoLibrary(items.sort(byCreatedDesc));
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar tu librería de videos.");
    } finally {
      setVideoLibraryLoading(false);
    }
  }, [imageLibrary.length, imageLibraryLoading, videoLibrary.length, videoLibraryLoading]);

  const openPicker = useCallback(async (kind: PickerKind) => {
    setPickerKind(kind);
    setPickerOpen(true);
    await loadLibrary(kind);
  }, [loadLibrary]);

  const handlePickerSelect = useCallback((asset: Asset) => {
    if (pickerKind === "image") setRefImage(asset);
    else setRefVideo(asset);
  }, [pickerKind]);

  const handleDirectUpload = useCallback(async (kind: PickerKind, file: File) => {
    const uploaded = await uploadUserAsset(file, {
      tool: UPLOAD_TOOL,
      category: "reference",
      type: kind,
      meta: { toolContext: TOOL_ID },
    });

    if (kind === "image") {
      setImageLibrary((prev) => [uploaded, ...prev.filter((asset) => asset.id !== uploaded.id)].sort(byCreatedDesc));
      setRefImage(uploaded);
    } else {
      setVideoLibrary((prev) => [uploaded, ...prev.filter((asset) => asset.id !== uploaded.id)].sort(byCreatedDesc));
      setRefVideo(uploaded);
    }

    return uploaded;
  }, []);

  const handleDownload = useCallback(async (asset: Asset) => {
    try {
      await downloadAssetToDisk(asset.id, asset.name || "motion-control-video");
    } catch (err: any) {
      setError(err?.message || "No se pudo descargar.");
    }
  }, []);

  const handleDelete = useCallback(async (asset: Asset) => {
    const confirmed = window.confirm("¿Seguro que deseas eliminar este video? Esta acción no se puede deshacer.");
    if (!confirmed) return;

    try {
      await deleteAsset(asset.id);
      setHistory((prev) => prev.filter((item) => item.id !== asset.id));
      if (viewer?.id === asset.id) setViewer(null);
    } catch (err: any) {
      setError(err?.message || "No se pudo eliminar.");
    }
  }, [viewer?.id]);

  const handleTogglePublish = useCallback((asset: Asset) => {
    window.dispatchEvent(new CustomEvent("tales:open-sell", { detail: { asset } }));
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    const next = String(text || "").trim();
    if (!next) {
      setError("Este video no tiene prompt guardado.");
      return;
    }

    try {
      await navigator.clipboard.writeText(next);
    } catch {
      setError("No se pudo copiar el prompt.");
    }
  }, []);

  const reusePromptFromAsset = useCallback((asset: Asset) => {
    setPrompt(String(asset.prompt || ""));
    setAdvancedOpen(true);
    setViewer(null);
    openCook();
  }, [openCook]);

  const cancelWaitOnly = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setProgressMsg("Cancelled. You can resume later.");
  }, []);

  const restorePendingAssets = useCallback(async (job: PendingMotionControlJob) => {
    try {
      const [images, videos] = await Promise.all([
        listMyAssets({ type: "image", limit: 200 }),
        listMyAssets({ type: "video", limit: 200 }),
      ]);

      const sortedImages = images.sort(byCreatedDesc);
      const sortedVideos = videos.sort(byCreatedDesc);

      setImageLibrary(sortedImages);
      setVideoLibrary(sortedVideos);
      setRefImage(sortedImages.find((asset) => asset.id === job.imageAssetId) || null);
      setRefVideo(sortedVideos.find((asset) => asset.id === job.videoAssetId) || null);
    } catch {
      // noop
    }
  }, []);

  const runMotionControlJob = useCallback(async (job: PendingMotionControlJob) => {
    setIsGenerating(true);
    setProgressMsg(`Processing (${getMotionControlModelLabel(job.model)})…`);
    abortRef.current = new AbortController();

    try {
      const row = await waitJobCompletion(job.jobId, {
        signal: abortRef.current.signal,
        onProgress: (message) => setProgressMsg(message),
        pollMs: 12_000,
      });

      if (row.status === "failed") {
        throw new Error(row.error || "The job failed in background.");
      }

      await reloadHistory();
      clearPending();
      setPendingJob(null);
      setProgressMsg("Done.");
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.isCanceled) {
        setProgressMsg("Cancelled. You can resume later.");
        return;
      }
      setError(formatErr(err));
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [reloadHistory]);

  const handleGenerate = useCallback(async () => {
    if (!user) {
      setError("Necesitas iniciar sesión para usar esta herramienta.");
      return;
    }

    if (!refImage || !refVideo) {
      setError("Selecciona un video de movimiento y una imagen de personaje antes de generar.");
      return;
    }

    const rawPrompt = String(prompt || "").trim();
    const finalPrompt = rawPrompt || "Motion Control";
    const keepOriginalSound = true;

    setIsGenerating(true);
    setProgressMsg(`Queueing (${selectedModelLabel})…`);
    abortRef.current = new AbortController();

    try {
      const start = await apiPostJson<any>(
        "/api/ai/video/motion-control",
        {
          tool: TOOL_ID,
          nameHint: TOOL_ID,
          prompt: finalPrompt,
          imageAssetId: refImage.id,
          videoAssetId: refVideo.id,
          keepOriginalSound,
          characterOrientation,
          mode,
          model,
          async: true,
        },
        { timeoutMs: 60_000, retries: 0 }
      );

      const jobId = String(start?.jobId || "").trim();
      if (!jobId) throw new Error("No llegó jobId.");

      const job: PendingMotionControlJob = {
        jobId,
        taskId: start?.taskId ? String(start.taskId) : undefined,
        prompt: rawPrompt,
        imageAssetId: refImage.id,
        videoAssetId: refVideo.id,
        keepOriginalSound,
        characterOrientation,
        mode,
        model,
        createdAt: Date.now(),
      };

      savePending(job);
      setPendingJob(job);
      await runMotionControlJob(job);
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.isCanceled) {
        setProgressMsg("Cancelled. You can resume later.");
        return;
      }
      setError(formatErr(err));
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [characterOrientation, mode, model, prompt, refImage, refVideo, runMotionControlJob, selectedModelLabel, user]);

  const openViewer = useCallback(async (asset: Asset) => {
    setViewer(asset);
    setViewerRefImage(null);
    setViewerRefVideo(null);

    const meta = (asset as any)?.meta || {};
    const motionControl = meta?.motionControl || {};
    const imageAssetId = typeof motionControl?.imageAssetId === "string" ? motionControl.imageAssetId : "";
    const videoAssetId = typeof motionControl?.videoAssetId === "string" ? motionControl.videoAssetId : "";

    if (!imageAssetId && !videoAssetId) return;

    try {
      const [images, videos] = await Promise.all([
        listMyAssets({ type: "image", limit: 200 }),
        listMyAssets({ type: "video", limit: 200 }),
      ]);
      setViewerRefImage(images.find((item) => item.id === imageAssetId) || null);
      setViewerRefVideo(videos.find((item) => item.id === videoAssetId) || null);
    } catch {
      setViewerRefImage(null);
      setViewerRefVideo(null);
    }
  }, []);

  const handleLoadMoreHistory = useCallback(() => {
    setIsLoadingMoreHistory(true);
    setHistoryVisibleCount((prev) => Math.min(history.length, prev + HISTORY_LOAD_MORE_COUNT));
    window.setTimeout(() => setIsLoadingMoreHistory(false), 140);
  }, [history.length]);

  useEffect(() => {
    void reloadHistory();

    const pending = typeof window !== "undefined" ? loadPending() : null;
    if (!pending) return;

    setPendingJob(pending);
    setPrompt(pending.prompt || "");
    setCharacterOrientation(pending.characterOrientation === "image" ? "image" : "video");
    setMode(pending.mode === "pro" ? "pro" : "std");
    setModel(normalizeMotionControlModel(pending.model));
    void restorePendingAssets(pending);
    void runMotionControlJob(pending);
  }, [reloadHistory, restorePendingAssets, runMotionControlJob]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (viewer) {
        setViewer(null);
        return;
      }
      if (panel) {
        restoreCookFromPanel();
        return;
      }
      if (isCookOpen) {
        closeCook();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCook, isCookOpen, panel, restoreCookFromPanel, viewer]);

  const viewerMeta: any = (viewer as any)?.meta || {};
  const viewerMotion = viewerMeta?.motionControl || {};
  const viewerQuality = viewerMotion?.mode === "pro" || String(viewerMeta?.model || "").includes("-pro") ? "1080p" : "720p";
  const viewerModelLabel = prettyMotionModelLabel(viewerMotion?.modelFamily || viewerMeta?.model);

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${isCookOpen ? styles.rootCookOpen : ""}`}
      onMouseMove={handleRootMouseMove}
      onMouseLeave={handleRootMouseLeave}
    >
      <ErrorModal error={error} onClose={() => setError(null)} />

      <HistorySection
        isCookOpen={isCookOpen}
        title="MOTION CONTROL"
        isLoading={isLoadingHistory}
        pendingSlots={pendingSlots}
        totalCount={history.length}
        visibleHistory={visibleHistory}
        hasMore={hasMoreHistory}
        isLoadingMore={isLoadingMoreHistory}
        onRefresh={reloadHistory}
        onLoadMore={handleLoadMoreHistory}
        onOpenViewer={openViewer}
        onTogglePublish={handleTogglePublish}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onShowError={(message) => setError(message)}
        hoverVideoEls={hoverVideoEls}
      />

      {pendingJob && !isGenerating && !isCookLayerVisible && (
        <div className={styles.motionResumeBannerWrap}>
          <div className={styles.resumeBanner}>
            <div className={styles.motionResumeBannerText}>Pending motion generation detected.</div>
            <div className={styles.motionResumeBannerActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => void runMotionControlJob(pendingJob)}>
                Resume
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => {
                  clearPending();
                  setPendingJob(null);
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {panel === null && (
        <button
          type="button"
          className={`${styles.cookToggle} ${isCookSidebarVisible ? styles.cookToggleOpen : styles.cookTogglePulse}`}
          onClick={() => {
            if (isCookSidebarVisible) closeCook();
            else openCook();
          }}
          aria-expanded={isCookSidebarVisible}
          aria-controls="motion-control-start-create"
          aria-label={isCookSidebarVisible ? "Close Start Create" : "Open Start Create"}
        >
          <span className={styles.cookToggleLabel}>Start Create</span>
          <span className={styles.cookToggleGlyph} aria-hidden="true">
            {isCookSidebarVisible ? "×" : "+"}
          </span>
        </button>
      )}

      {isCookLayerVisible && (
        <div id="motion-control-start-create" className={`${styles.cookOverlay} ${styles.cookOverlayOpen}`} aria-hidden={!isCookLayerVisible}>
          <button
            type="button"
            className={styles.cookBackdrop}
            aria-label={panel ? "Back to Start Create" : "Close Start Create"}
            tabIndex={isCookLayerVisible ? 0 : -1}
            onClick={() => {
              if (panel) restoreCookFromPanel();
              else closeCook();
            }}
          />

          {panel && (
            <div className={styles.cookPanelShell}>
              <div className={styles.cookPanel}>
                <div className={styles.popoverHeader}>
                  <div className={styles.popoverTitle}>{panel === "model" ? "Model" : "Quality"}</div>
                  <button className={styles.closeBtn} onClick={restoreCookFromPanel} type="button" title="Close">
                    <Icon name="close" />
                  </button>
                </div>

                <div className={styles.cookPanelScroll}>
                  {panel === "model" ? (
                    <div className={styles.modelGrid}>
                      <button
                        type="button"
                        className={`${styles.modelOption} ${model === "kling-v3-motion-control" ? styles.modelOptionActive : ""}`}
                        onClick={() => {
                          setModel("kling-v3-motion-control");
                          restoreCookFromPanel();
                        }}
                      >
                        <div className={styles.modelName}>Kling 3.0 Motion Control</div>
                        <div className={styles.modelDesc}>Latest motion pipeline for the new flow.</div>
                      </button>

                      <button
                        type="button"
                        className={`${styles.modelOption} ${model === "kling-2.6-motion-control" ? styles.modelOptionActive : ""}`}
                        onClick={() => {
                          setModel("kling-2.6-motion-control");
                          restoreCookFromPanel();
                        }}
                      >
                        <div className={styles.modelName}>Kling 2.6 Motion Control</div>
                        <div className={styles.modelDesc}>Fallback model with the legacy motion stack.</div>
                      </button>
                    </div>
                  ) : (
                    <div className={styles.durationGrid}>
                      <button
                        type="button"
                        className={`${styles.durationOption} ${mode === "std" ? styles.durationOptionActive : ""}`}
                        onClick={() => {
                          setMode("std");
                          restoreCookFromPanel();
                        }}
                      >
                        720p
                      </button>
                      <button
                        type="button"
                        className={`${styles.durationOption} ${mode === "pro" ? styles.durationOptionActive : ""}`}
                        onClick={() => {
                          setMode("pro");
                          restoreCookFromPanel();
                        }}
                      >
                        1080p
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {isCookSidebarVisible && (
            <div className={styles.cookSidebarShell}>
              <div className={styles.cookSidebar}>
                <div className={`${styles.dock} ${styles.cookSectionCard} ${styles.cookPromptCard} ${styles.motionCookCard}`}>
                  <div className={styles.motionCookScroll}>
                    {pendingJob && !isGenerating && (
                      <div className={styles.resumeBanner}>
                        <div className={styles.motionResumeBannerText}>Pending motion generation detected.</div>
                        <div className={styles.motionResumeBannerActions}>
                          <button type="button" className={styles.ghostBtn} onClick={() => void runMotionControlJob(pendingJob)}>
                            Resume
                          </button>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => {
                              clearPending();
                              setPendingJob(null);
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}

                    <div className={styles.motionReferenceGrid}>
                      <MotionReferenceCard
                        title="Add motion to copy"
                        kind="video"
                        asset={refVideo}
                        onChoose={() => void openPicker("video")}
                        onUploadClick={() => videoUploadRef.current?.click()}
                        onClear={() => setRefVideo(null)}
                      />

                      <MotionReferenceCard
                        title="Add your character"
                        kind="image"
                        asset={refImage}
                        onChoose={() => void openPicker("image")}
                        onUploadClick={() => imageUploadRef.current?.click()}
                        onClear={() => setRefImage(null)}
                      />
                    </div>

                    <input
                      ref={videoUploadRef}
                      type="file"
                      accept="video/*"
                      style={{ display: "none" }}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          await handleDirectUpload("video", file);
                        } catch (err: any) {
                          setError(formatErr(err));
                        } finally {
                          if (videoUploadRef.current) videoUploadRef.current.value = "";
                        }
                      }}
                    />

                    <input
                      ref={imageUploadRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          await handleDirectUpload("image", file);
                        } catch (err: any) {
                          setError(formatErr(err));
                        } finally {
                          if (imageUploadRef.current) imageUploadRef.current.value = "";
                        }
                      }}
                    />

                    <div className={styles.motionSettingsStack}>
                      <button
                        type="button"
                        className={styles.motionSettingRow}
                        onClick={() => setPanel("model")}
                        aria-label="Choose model"
                      >
                        <span className={styles.motionSettingText}>
                          <span className={styles.motionSettingLabel}>Model</span>
                          <span className={styles.motionSettingValue}>{selectedModelLabel}</span>
                        </span>
                        <span className={styles.motionSettingChevron}>›</span>
                      </button>

                      <button
                        type="button"
                        className={styles.motionSettingRow}
                        onClick={() => setPanel("quality")}
                        aria-label="Choose quality"
                      >
                        <span className={styles.motionSettingText}>
                          <span className={styles.motionSettingLabel}>Quality</span>
                          <span className={styles.motionSettingValue}>{selectedQualityLabel}</span>
                        </span>
                        <span className={styles.motionSettingChevron}>›</span>
                      </button>
                    </div>

                    <details
                      className={styles.motionAdvanced}
                      open={advancedOpen}
                      onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}
                    >
                      <summary className={styles.motionAdvancedSummary}>Advanced settings</summary>
                      <div className={styles.motionAdvancedBody}>
                        <div className={styles.motionField}>
                          <label className={styles.formLabel}>Prompt · optional</label>
                          <textarea
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            placeholder="Describe the character or scene details."
                            className={`${styles.textarea} ${styles.motionPromptTextarea}`}
                            maxLength={14_000}
                          />
                        </div>

                        <div className={styles.motionField}>
                          <label className={styles.formLabel}>Create from</label>
                          <div className={styles.motionChoiceGrid}>
                            <button
                              type="button"
                              className={`${styles.motionChoiceCard} ${characterOrientation === "video" ? styles.motionChoiceCardActive : ""}`}
                              onClick={() => setCharacterOrientation("video")}
                            >
                              <span className={styles.motionChoiceTitle}>From video</span>
                              <span className={styles.motionChoiceHint}>Best for complex body motion and action.</span>
                            </button>
                            <button
                              type="button"
                              className={`${styles.motionChoiceCard} ${characterOrientation === "image" ? styles.motionChoiceCardActive : ""}`}
                              onClick={() => setCharacterOrientation("image")}
                            >
                              <span className={styles.motionChoiceTitle}>From image</span>
                              <span className={styles.motionChoiceHint}>Best when camera moves matter more than pose.</span>
                            </button>
                          </div>
                          <div className={styles.motionFieldHint}>Match the source that should define the character orientation.</div>
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className={styles.motionCookFooter}>
                    <button
                      type="button"
                      className={styles.motionGenerateBtn}
                      onClick={() => {
                        if (isGenerating) return;
                        void handleGenerate();
                      }}
                      disabled={!canGenerate}
                      data-loading={isGenerating ? "true" : "false"}
                    >
                      <span className={styles.motionGenerateLabel}>{isGenerating ? "Generating" : "Generate"}</span>
                      {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
                      <span className={styles.motionGenerateCost}>✦ {estimatedCostCredits}</span>
                    </button>

                    {isGenerating ? (
                      <button type="button" className={styles.cancelBtn} onClick={cancelWaitOnly}>
                        Cancel wait
                      </button>
                    ) : progressMsg ? (
                      <div className={styles.progressText}>{progressMsg}</div>
                    ) : null}

                    {isGenerating && progressMsg && <div className={styles.progressText}>{progressMsg}</div>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <AssetPickerModal
        open={pickerOpen}
        title={pickerTitle}
        kind={pickerKind}
        assets={pickerAssets}
        selectedId={pickerSelectedId}
        onSelect={handlePickerSelect}
        onClose={() => setPickerOpen(false)}
        isLoading={pickerLoading}
        onUpload={(file) => handleDirectUpload(pickerKind, file)}
        getAssetUrl={getAssetUrl}
      />

      {viewer && (
        <div className={styles.viewerBackdrop} onClick={() => setViewer(null)}>
          <div className={styles.viewer} onClick={(event) => event.stopPropagation()}>
            <div className={styles.viewerTop}>
              <div className={styles.viewerTitle}>
                <span className={styles.viewerKicker}>MOTION CONTROL</span>
                <span className={styles.viewerSub}>{viewer.isPublic ? "PUBLIC" : "PRIVATE"}</span>
              </div>

              <div className={styles.viewerTopActions}>
                <button className={styles.iconBtn} type="button" title="Copy prompt" onClick={() => void copyToClipboard(viewer.prompt || "") }>
                  <Icon name="copy" />
                </button>
                <button className={styles.iconBtn} type="button" title="Reuse prompt" onClick={() => reusePromptFromAsset(viewer)}>
                  <Icon name="reuse" />
                </button>
                <button className={styles.iconBtn} type="button" title="Sell / manage listing" onClick={() => handleTogglePublish(viewer)}>
                  <Icon name="share" />
                </button>
                <button className={styles.iconBtn} type="button" title="Download" onClick={() => void handleDownload(viewer)}>
                  <Icon name="download" />
                </button>
                <button className={styles.iconBtnDanger} type="button" title="Delete" onClick={() => void handleDelete(viewer)}>
                  <Icon name="trash" />
                </button>
                <button className={styles.closeBtn} type="button" onClick={() => setViewer(null)} title="Close">
                  <Icon name="close" />
                </button>
              </div>
            </div>

            <div className={styles.viewerBody}>
              <div className={styles.viewerVideoWrap}>
                <video className={styles.viewerVideo} src={viewer.url} controls autoPlay loop playsInline />
              </div>

              <div className={styles.viewerRecipe}>
                <div className={styles.viewerRecipeTitle}>RECIPE</div>

                <div className={styles.recipeGrid}>
                  <RecipeItem label="Model" value={viewerModelLabel} />
                  <RecipeItem label="Quality" value={viewerQuality} />
                  <RecipeItem label="Orientation" value={viewerMotion?.characterOrientation || "—"} />
                  <RecipeItem label="Sound" value={viewerMotion?.keepOriginalSound === false ? "Off" : "On"} />
                </div>

                <div className={styles.recipeRefs}>
                  <div className={styles.recipeLabel}>References</div>
                  <div className={styles.recipeRefStrip}>
                    {viewerRefVideo ? (
                      <div className={styles.recipeRefThumb} title={viewerRefVideo.name || "Motion video"}>
                        <video
                          src={viewerRefVideo.url}
                          muted
                          playsInline
                          autoPlay
                          loop
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                        <span className={styles.recipeRefTag}>MOTION</span>
                      </div>
                    ) : viewerMotion?.videoAssetId ? (
                      <div className={styles.recipeEmpty}>Motion asset: {String(viewerMotion.videoAssetId)}</div>
                    ) : (
                      <div className={styles.recipeEmpty}>No motion reference</div>
                    )}

                    {viewerRefImage ? (
                      <div className={styles.recipeRefThumb} title={viewerRefImage.name || "Character image"}>
                        <img src={viewerRefImage.url} alt={viewerRefImage.name || "Character image"} />
                        <span className={styles.recipeRefTag}>CHARACTER</span>
                      </div>
                    ) : viewerMotion?.imageAssetId ? (
                      <div className={styles.recipeEmpty}>Character asset: {String(viewerMotion.imageAssetId)}</div>
                    ) : (
                      <div className={styles.recipeEmpty}>No character reference</div>
                    )}
                  </div>
                </div>

                <div className={styles.recipeBlock}>
                  <div className={styles.recipeLabel}>Prompt</div>
                  <div className={styles.recipeValue} style={{ whiteSpace: "pre-wrap" }}>
                    {viewer.prompt || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
