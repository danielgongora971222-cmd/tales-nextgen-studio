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
import { toggleLike } from "../../services/socialApi";
import { syncFavoriteAssetState } from "../../services/favoriteAssets";
import { waitJobCompletion } from "../../services/jobsApi";
import { useVideoGenerationLock } from "../../hooks/useVideoGenerationLock";
import { estimateVideoCostCredits } from "../../config/pricing.js";
import { HistorySection } from "./video/HistorySection";
import { AssetPickerModal } from "./video/AssetPickerModal";
import { Icon } from "./video/icon";
import {
  finalizeVideoStill,
  prepareVideoPreview,
  primeVideoStill,
} from "./video/videoPreview";
import {
  formatDurationLabel,
  resolveReferenceVideoDurationSeconds,
} from "./video/referenceVideoPricing";

type Orientation = "image" | "video";
type MotionControlModel = "kling-2.6-motion-control" | "kling-v3-motion-control";
type MotionPanelKey = "model" | "quality" | "advanced" | null;
type PickerKind = "image" | "video";

type PendingMotionControlJob = {
  clientJobId: string;
  jobId?: string;
  taskId?: string;
  prompt: string;
  imageAssetId: string;
  videoAssetId: string;
  keepOriginalSound: boolean;
  characterOrientation: Orientation;
  mode: "std" | "pro";
  model: MotionControlModel;
  referenceVideoDurationSeconds?: number | null;
  state: "submitting" | "running";
  createdAt: number;
};

const TOOL_ID = "motion-control";
const HISTORY_INITIAL_COUNT = 12;
const HISTORY_LOAD_MORE_COUNT = 9;
const UPLOAD_TOOL = "motion-control-ref";
const PENDING_MOTION_KEY = "tales_pending_motion_control_job_v2";
const PENDING_MOTION_LEGACY_KEY = "tales_pending_motion_control_job_v1";
const MOTION_CONTROL_MIN_REFERENCE_SECONDS = 3;

function getMotionControlReferenceVideoLimitSeconds(orientation: Orientation) {
  return orientation === "image" ? 10 : 30;
}

function validateMotionControlReferenceVideoDuration(
  durationSeconds: number | null | undefined,
  orientation: Orientation
): string | null {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const maxSeconds = getMotionControlReferenceVideoLimitSeconds(orientation);
  const createFromLabel = orientation === "image" ? "From image" : "From video";

  if (duration < MOTION_CONTROL_MIN_REFERENCE_SECONDS) {
    return `Kling Motion Control requiere un video de referencia de al menos ${MOTION_CONTROL_MIN_REFERENCE_SECONDS}s. Tu video actual dura ${formatDurationLabel(duration) || `${duration.toFixed(1)}s`}.`;
  }

  if (duration > maxSeconds) {
    return `Con Create from = ${createFromLabel}, Kling solo admite videos de referencia de hasta ${maxSeconds}s. Tu video actual dura ${formatDurationLabel(duration) || `${duration.toFixed(1)}s`}. Cambia la orientación o usa un clip más corto.`;
  }

  return null;
}

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

function makeMotionClientJobId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `motion-${crypto.randomUUID()}`;
    }
  } catch {}
  return `motion-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildMotionIdempotencyKey(clientJobId: string) {
  return `motion-control:${clientJobId}`;
}

function savePending(job: PendingMotionControlJob) {
  try {
    localStorage.setItem(PENDING_MOTION_KEY, JSON.stringify(job));
    localStorage.removeItem(PENDING_MOTION_LEGACY_KEY);
  } catch {}
}

function loadPending(): PendingMotionControlJob | null {
  try {
    const raw = localStorage.getItem(PENDING_MOTION_KEY) || localStorage.getItem(PENDING_MOTION_LEGACY_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw || "{}");
    if (!parsed?.imageAssetId || !parsed?.videoAssetId) return null;

    const jobId = typeof parsed?.jobId === "string" && parsed.jobId.trim() ? String(parsed.jobId) : undefined;
    const clientJobIdRaw = typeof parsed?.clientJobId === "string" && parsed.clientJobId.trim() ? String(parsed.clientJobId) : "";

    return {
      clientJobId: clientJobIdRaw || jobId || makeMotionClientJobId(),
      jobId,
      taskId: parsed?.taskId ? String(parsed.taskId) : undefined,
      prompt: typeof parsed?.prompt === "string" ? parsed.prompt : "",
      imageAssetId: String(parsed.imageAssetId),
      videoAssetId: String(parsed.videoAssetId),
      keepOriginalSound: parsed?.keepOriginalSound !== false,
      characterOrientation: parsed?.characterOrientation === "image" ? "image" : "video",
      mode: parsed?.mode === "pro" ? "pro" : "std",
      model: normalizeMotionControlModel(parsed?.model),
      referenceVideoDurationSeconds:
        typeof parsed?.referenceVideoDurationSeconds === "number"
          ? Number(parsed.referenceVideoDurationSeconds)
          : null,
      state: parsed?.state === "submitting" || !jobId ? "submitting" : "running",
      createdAt: Number(parsed?.createdAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_MOTION_KEY);
    localStorage.removeItem(PENDING_MOTION_LEGACY_KEY);
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
                ref={(el) => {
                  if (el) prepareVideoPreview(el);
                }}
                onLoadedMetadata={(e) => {
                  prepareVideoPreview(e.currentTarget);
                  primeVideoStill(e.currentTarget);
                }}
                onLoadedData={(e) => primeVideoStill(e.currentTarget)}
                onCanPlay={(e) => primeVideoStill(e.currentTarget)}
                onSeeked={(e) => finalizeVideoStill(e.currentTarget)}
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

      {asset?.name ? (
        <div className={styles.motionReferenceFooter}>
          <div className={styles.motionReferenceName} title={asset.name}>{asset.name}</div>
        </div>
      ) : null}

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
  const [likeBusyById, setLikeBusyById] = useState<Record<string, boolean>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_INITIAL_COUNT);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [viewer, setViewer] = useState<Asset | null>(null);
  const [viewerRefImage, setViewerRefImage] = useState<Asset | null>(null);
  const [viewerRefVideo, setViewerRefVideo] = useState<Asset | null>(null);

  const [refImage, setRefImage] = useState<Asset | null>(null);
  const [refVideo, setRefVideo] = useState<Asset | null>(null);
  const [referenceVideoDurationSeconds, setReferenceVideoDurationSeconds] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [characterOrientation, setCharacterOrientation] = useState<Orientation>("video");
  const [mode, setMode] = useState<"std" | "pro">("std");
  const [model, setModel] = useState<MotionControlModel>("kling-v3-motion-control");

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

  const { hasActiveVideoJob, busyMessage: activeVideoBusyMessage } = useVideoGenerationLock();
  const videoSlotBusy = hasActiveVideoJob && !isGenerating;

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
  const pendingSlots = useMemo(
    () => (pendingJob ? [pendingJob.jobId || `pending-${pendingJob.clientJobId}`] : []),
    [pendingJob]
  );

  const pickerAssets = pickerKind === "image" ? imageLibrary : videoLibrary;
  const pickerSelectedId = pickerKind === "image" ? refImage?.id || null : refVideo?.id || null;
  const pickerLoading = pickerKind === "image" ? imageLibraryLoading : videoLibraryLoading;
  const pickerTitle = pickerKind === "image" ? "Choose your character" : "Choose motion to copy";

  const canGenerate = Boolean(user && refImage && refVideo && !isGenerating && !videoSlotBusy);
  const selectedModelLabel = getMotionControlModelLabel(model);
  const selectedQualityLabel = getMotionQualityLabel(mode);
  const selectedCreateFromLabel = characterOrientation === "image" ? "From image" : "From video";
  const selectedAdvancedLabel = `${prompt.trim() ? "Prompt added" : "Prompt optional"} · ${selectedCreateFromLabel}`;
  const isPendingSubmission = Boolean(isGenerating && pendingJob && pendingJob.state === "submitting" && !pendingJob.jobId);
  const generateButtonLabel = isGenerating ? (isPendingSubmission ? "Starting" : "Generating") : "Generate";
  const referenceDurationLabel = useMemo(
    () => formatDurationLabel(referenceVideoDurationSeconds),
    [referenceVideoDurationSeconds]
  );
  const estimatedCostCredits = useMemo(() => {
    const pricingModelNorm = resolveMotionControlPricingModel(model, mode);
    return estimateVideoCostCredits({
      modelNorm: pricingModelNorm,
      durationSeconds: referenceVideoDurationSeconds || 5,
      resolution: mode === "pro" ? "1080p" : "720p",
      klingMode: mode,
    });
  }, [model, mode, referenceVideoDurationSeconds]);

  const isCookSidebarVisible = isCookOpen && !panel;
  const isCookLayerVisible = isCookOpen || !!panel;

  useEffect(() => {
    let cancelled = false;

    if (!refVideo) {
      setReferenceVideoDurationSeconds(null);
      return;
    }

    const storedDuration = (refVideo as any)?.meta?.durationSeconds;
    if (typeof storedDuration === "number" && Number.isFinite(storedDuration) && storedDuration > 0) {
      setReferenceVideoDurationSeconds(storedDuration);
    } else {
      setReferenceVideoDurationSeconds(null);
    }

    void (async () => {
      const resolved = await resolveReferenceVideoDurationSeconds(refVideo);
      if (!cancelled) {
        setReferenceVideoDurationSeconds(resolved);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refVideo]);

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

  const reloadHistory = useCallback(async (fresh = false) => {
    setIsLoadingHistory(true);
    try {
      const videos = await listMyAssets({ type: "video", limit: 200, fresh });
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

  const handleToggleLike = useCallback(async (asset: Asset) => {
    if (!user) {
      setError("Debes iniciar sesión para dar Like.");
      return;
    }
    if (likeBusyById[asset.id]) return;

    setLikeBusyById((prev) => ({ ...prev, [asset.id]: true }));
    try {
      const res = await toggleLike(asset.id);
      syncFavoriteAssetState(asset.id, res.liked);
      setHistory((prev) => prev.map((entry) => (entry.id === asset.id ? { ...entry, likedByMe: res.liked, likesCount: res.likesCount } : entry)));
      setViewer((prev) => (prev && prev.id === asset.id ? { ...prev, likedByMe: res.liked, likesCount: res.likesCount } : prev));
    } catch (err: any) {
      setError(formatErr(err));
    } finally {
      setLikeBusyById((prev) => ({ ...prev, [asset.id]: false }));
    }
  }, [likeBusyById, user]);

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
    setPanel("advanced");
    setViewer(null);
    openCook();
  }, [openCook]);

  const cancelWaitOnly = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setProgressMsg("Still generating in background. Resume anytime.");
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

  const submitMotionControlJob = useCallback(async (job: PendingMotionControlJob) => {
    setProgressMsg(`Queueing (${getMotionControlModelLabel(job.model)})…`);

    const start = await apiPostJson<any>(
      "/api/ai/video/motion-control",
      {
        tool: TOOL_ID,
        nameHint: TOOL_ID,
        prompt: job.prompt || undefined,
        imageAssetId: job.imageAssetId,
        videoAssetId: job.videoAssetId,
        keepOriginalSound: job.keepOriginalSound,
        characterOrientation: job.characterOrientation,
        mode: job.mode,
        model: job.model,
        clientJobId: job.clientJobId,
        referenceVideoDurationSeconds: job.referenceVideoDurationSeconds || undefined,
        async: true,
      },
      {
        timeoutMs: 12 * 60 * 1000,
        retries: 10,
        idempotencyKey: buildMotionIdempotencyKey(job.clientJobId),
      }
    );

    const jobId = String(start?.jobId || "").trim();
    if (!jobId) throw new Error("No llegó jobId.");

    const nextJob: PendingMotionControlJob = {
      ...job,
      jobId,
      taskId: start?.taskId ? String(start.taskId) : undefined,
      state: "running",
    };

    savePending(nextJob);
    setPendingJob(nextJob);
    return nextJob;
  }, []);

  const runMotionControlJob = useCallback(async (job: PendingMotionControlJob) => {
    setIsGenerating(true);

    try {
      const runnableJob = job.jobId ? job : await submitMotionControlJob(job);

      setPendingJob(runnableJob);
      setProgressMsg(`Processing (${getMotionControlModelLabel(runnableJob.model)})…`);
      abortRef.current = new AbortController();

      const row = await waitJobCompletion(runnableJob.jobId!, {
        signal: abortRef.current.signal,
        onProgress: (message) => setProgressMsg(message),
        pollMs: 12_000,
      });

      if (row.status === "failed") {
        const terminalErr: any = new Error(row.error || "The job failed in background.");
        terminalErr.clearPending = true;
        throw terminalErr;
      }

      await reloadHistory(true);
      clearPending();
      setPendingJob(null);
      setProgressMsg("Done.");
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.isCanceled) {
        setProgressMsg("Still generating in background. Resume anytime.");
        return;
      }
      if (err?.clearPending || !job.jobId) {
        clearPending();
        setPendingJob(null);
      }
      setError(formatErr(err));
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [reloadHistory, submitMotionControlJob]);

  const resumePendingJob = useCallback(async (job: PendingMotionControlJob) => {
    openCook();
    setPendingJob(job);
    setIsGenerating(true);
    setProgressMsg(
      job.jobId
        ? `Resuming (${getMotionControlModelLabel(job.model)})…`
        : `Restoring (${getMotionControlModelLabel(job.model)})…`
    );
    await runMotionControlJob(job);
  }, [openCook, runMotionControlJob]);

  const handleGenerate = useCallback(async () => {
    if (!user) {
      setError("Necesitas iniciar sesión para usar esta herramienta.");
      return;
    }

    if (videoSlotBusy) {
      setError(activeVideoBusyMessage || "Ya tienes un video en proceso. Espera a que termine antes de lanzar otro.");
      return;
    }

    if (!refImage || !refVideo) {
      setError("Selecciona un video de movimiento y una imagen de personaje antes de generar.");
      return;
    }

    const rawPrompt = String(prompt || "").trim();
    const keepOriginalSound = true;
    const resolvedReferenceVideoDurationSeconds =
      referenceVideoDurationSeconds || (await resolveReferenceVideoDurationSeconds(refVideo));
    if (resolvedReferenceVideoDurationSeconds) {
      setReferenceVideoDurationSeconds(resolvedReferenceVideoDurationSeconds);
    }

    const durationValidationError = validateMotionControlReferenceVideoDuration(
      resolvedReferenceVideoDurationSeconds,
      characterOrientation
    );
    if (durationValidationError) {
      setError(durationValidationError);
      return;
    }

    const draftJob: PendingMotionControlJob = {
      clientJobId: makeMotionClientJobId(),
      prompt: rawPrompt,
      imageAssetId: refImage.id,
      videoAssetId: refVideo.id,
      keepOriginalSound,
      characterOrientation,
      mode,
      model,
      referenceVideoDurationSeconds: resolvedReferenceVideoDurationSeconds,
      state: "submitting",
      createdAt: Date.now(),
    };

    setPendingJob(draftJob);
    savePending(draftJob);
    setIsGenerating(true);
    setProgressMsg(`Queueing (${selectedModelLabel})…`);
    openCook();

    try {
      await runMotionControlJob(draftJob);
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.isCanceled) {
        setProgressMsg("Still generating in background. Resume anytime.");
        return;
      }
      clearPending();
      setPendingJob(null);
      setError(formatErr(err));
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [activeVideoBusyMessage, characterOrientation, mode, model, openCook, prompt, refImage, refVideo, runMotionControlJob, selectedModelLabel, user, videoSlotBusy]);

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
    void reloadHistory(false);

    const pending = typeof window !== "undefined" ? loadPending() : null;
    if (!pending) return;

    setPendingJob(pending);
    setPrompt(pending.prompt || "");
    setCharacterOrientation(pending.characterOrientation === "image" ? "image" : "video");
    setMode(pending.mode === "pro" ? "pro" : "std");
    setModel(normalizeMotionControlModel(pending.model));
    openCook();
    void restorePendingAssets(pending);
    void resumePendingJob(pending);
  }, [openCook, reloadHistory, restorePendingAssets, resumePendingJob]);

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


  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

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
        onRefresh={() => void reloadHistory(true)}
        onLoadMore={handleLoadMoreHistory}
        onOpenViewer={openViewer}
        onToggleLike={handleToggleLike}
        likeBusyById={likeBusyById}
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
              <button type="button" className={styles.ghostBtn} onClick={() => void resumePendingJob(pendingJob)}>
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
        <div className={styles.motionBottomActions}>
          <button
            type="button"
            className={`${styles.cookToggle} ${styles.motionCookToggle} ${isCookSidebarVisible ? styles.cookToggleOpen : styles.cookTogglePulse}`}
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

          {isCookSidebarVisible && (
            <button
              type="button"
              className={`${styles.motionGenerateBtn} ${styles.motionGenerateDockBtn}`}
              onClick={() => {
                if (isGenerating) return;
                void handleGenerate();
              }}
              disabled={!canGenerate}
              title={!canGenerate && videoSlotBusy ? activeVideoBusyMessage || undefined : undefined}
              data-loading={isGenerating ? "true" : "false"}
            >
              <span className={styles.motionGenerateLabel}>{generateButtonLabel}</span>
              {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
              <span className={styles.motionGenerateCost}>✦ {estimatedCostCredits}</span>
            </button>
          )}
        </div>
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
                  <div className={styles.popoverTitle}>{panel === "model" ? "Model" : panel === "quality" ? "Quality" : "Advanced settings"}</div>
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
                  ) : panel === "quality" ? (
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
                  ) : (
                    <div className={styles.motionAdvancedBody}>
                      <div className={styles.motionField}>
                        <label className={styles.formLabel}>Prompt optional</label>
                        <textarea
                          value={prompt}
                          onChange={(event) => setPrompt(event.target.value)}
                          placeholder="Describe the character or scene (optional)."
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
                            <span className={styles.motionChoiceHint}>Use the video as the motion reference.</span>
                          </button>
                          <button
                            type="button"
                            className={`${styles.motionChoiceCard} ${characterOrientation === "image" ? styles.motionChoiceCardActive : ""}`}
                            onClick={() => setCharacterOrientation("image")}
                          >
                            <span className={styles.motionChoiceTitle}>From image</span>
                            <span className={styles.motionChoiceHint}>Use the image as the character orientation source.</span>
                          </button>
                        </div>
                        <div className={styles.motionFieldHint}>Choose whether the final orientation should follow the video or the image.</div>
                      </div>
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
                          <button type="button" className={styles.ghostBtn} onClick={() => void resumePendingJob(pendingJob)}>
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

                      <button
                        type="button"
                        className={styles.motionSettingRow}
                        onClick={() => setPanel("advanced")}
                        aria-label="Open advanced settings"
                      >
                        <span className={styles.motionSettingText}>
                          <span className={styles.motionSettingLabel}>Advanced settings</span>
                          <span className={styles.motionSettingValue}>{selectedAdvancedLabel}</span>
                        </span>
                        <span className={styles.motionSettingChevron}>›</span>
                      </button>
                    </div>
                  </div>

                  <div className={styles.motionCookFooter}>
                    {refVideo && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.65)",
                          textAlign: "center",
                        }}
                      >
                        Precio según la duración del video de referencia
                        {referenceDurationLabel ? ` · ${referenceDurationLabel}` : " · calculando duración..."}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.56)",
                        textAlign: "center",
                      }}
                    >
                      Límite Kling Motion Control para el video guía: 3–{getMotionControlReferenceVideoLimitSeconds(characterOrientation)}s con {selectedCreateFromLabel}.
                    </div>

                    {isGenerating && progressMsg && (
                      <div className={styles.motionGeneratingStatus}>
                        <span className={styles.generateSpinner} aria-hidden="true" />
                        <span>{progressMsg}</span>
                      </div>
                    )}

                    {videoSlotBusy && !isGenerating && activeVideoBusyMessage && (
                      <div className={styles.progressText}>{activeVideoBusyMessage}</div>
                    )}

                    {isGenerating ? (
                      <button type="button" className={styles.cancelBtn} onClick={cancelWaitOnly}>
                        Cancel wait
                      </button>
                    ) : progressMsg ? (
                      <div className={styles.progressText}>{progressMsg}</div>
                    ) : null}
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
