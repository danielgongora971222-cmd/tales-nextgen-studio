import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import type { Asset } from "../../types";
import ErrorModal from "../../components/ErrorModal";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteAsset,
  listMyAssets,
  publishAsset,
  unpublishAsset,
  uploadUserAsset,
} from "../../services/assetsApi";
import { apiPostJson, formatErr, waitFalJob } from "../../services/videoGenApi";
import { EditHistorySection } from "./video/EditHistorySection";
import { ViewerModal } from "./video/viewermodal";
import { Icon } from "./video/icon";
import { KlingElementsModal } from "./video/KlingElementsModal";
import { listKlingElements, type KlingElement } from "../../services/klingElementsService";
import { AssetPickerModal } from "./video/AssetPickerModal";
import { MultiImagePickerModal } from "./video/MultiImagePickerModal";
import {
  O3MultishotModal,
  O3_SHOT_PROMPT_LIMIT,
  type O3Shot,
} from "./video/O3MultishotModal";
import { LimitedTextarea } from "./video/LimitedTextarea";

type EditModelId =
  | "kling-o3-ref-to-video-pro"
  | "kling-o3-edit-video-pro"
  | "kling-o3-ref-video-to-video-pro";

type AspectRatio = "auto" | "16:9" | "9:16" | "1:1";

const TOOL_NAME = "video-edit";
const PENDING_KEY = "tales_pending_video_edit_job_v1";

type PendingVideoEditJob = {
  jobToken: string;
  prompt: string;
  model: EditModelId;
  createdAt: number;
};

const MODEL_OPTIONS: Array<{
  id: EditModelId;
  uiName: string;
  uiDesc: string;
  uiHint: string;
}> = [
    {
    id: "kling-o3-ref-to-video-pro",
    uiName: "Imagen/Referencias → Video (Pro)",
    uiDesc:
      "Crea un video nuevo desde una imagen START (y opcionalmente una END), más referencias visuales para consistencia.",
    uiHint:
      "Ideal para crear escenas desde cero. START fija el primer frame (identidad/escena) y END puede fijar el último. En el prompt puedes referenciar: @Image1.. (refs) y @Element1.. (Elements).",
  },
  {
    id: "kling-o3-edit-video-pro",
    uiName: "Editar Video (Pro)",
    uiDesc:
      "Edita un video existente siguiendo tu prompt (cambios de estilo, objetos, ambiente, correcciones).",
    uiHint:
      "Ideal para retoques: cambia estilo/objetos/ambiente sin perder coherencia. En el prompt, el video base es @Video1. También puedes usar @Image1.. y @Element1.. como referencias.",
  },
  {
    id: "kling-o3-ref-video-to-video-pro",
    uiName: "Video → Video con Referencias (Pro)",
    uiDesc:
      "Genera una nueva versión guiada por un video base + referencias (continuidad de movimiento/cámara + identidad/estilo).",
    uiHint:
      "Ideal para continuidad: conserva motion/cámara del video base (@Video1) y usa @Image1.. / @Element1.. para identidad/estilo. Máximo 4 referencias combinadas.",
  },
];

function getMetaTool(a: Asset): string | null {
  const meta: any = (a as any)?.meta || {};
  return meta?.tool ?? null;
}

function getAssetUrl(a: Asset): string | null {
  const u = (a as any)?.url;
  return typeof u === "string" && u.length > 0 ? u : null;
}

function downloadFromUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function nowHint(model: EditModelId) {
  const short = model.replaceAll("kling-", "").replaceAll("-pro", "");
  return `edit_${short}_${Date.now()}`;
}

function buildPromptFromShots(shots: O3Shot[]) {
  const safe = (shots || []).filter((s) => (s.prompt || "").trim().length > 0);
  return safe
    .map((s, i) => `[SHOT ${i + 1} · ${s.durationSeconds}s] ${s.prompt.trim()}`)
    .join("\n");
}

function sumSeconds(shots: O3Shot[]) {
  return (shots || []).reduce(
    (acc, s) => acc + (Number.isFinite(s.durationSeconds) ? Number(s.durationSeconds) : 0),
    0
  );
}

export default function EditVideoTool() {
  const { user } = useAuth();

  // ===== Root glow =====
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRootMouseMove = useCallback((e: React.MouseEvent) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = Math.round(e.clientX - r.left);
    const my = Math.round(e.clientY - r.top);
    el.style.setProperty("--mx", String(mx));
    el.style.setProperty("--my", String(my));
  }, []);

  // ===== History + assets =====
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [history, setHistory] = useState<Asset[]>([]);
  const [visibleCount, setVisibleCount] = useState(18);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [imageAssets, setImageAssets] = useState<Asset[]>([]);
  const [videoAssets, setVideoAssets] = useState<Asset[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);

  // ===== UI state =====
  const [panel, setPanel] = useState<null | "model" | "params">(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);

  const [model, setModel] = useState<EditModelId>("kling-o3-ref-to-video-pro");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [durationSeconds, setDurationSeconds] = useState<number>(8);

  const [startImage, setStartImage] = useState<Asset | null>(null);
  const [endImage, setEndImage] = useState<Asset | null>(null);
  const [inputVideo, setInputVideo] = useState<Asset | null>(null);

  const [referenceImageIds, setReferenceImageIds] = useState<string[]>([]);
  const [klingElementIds, setKlingElementIds] = useState<string[]>([]);
  const [klingElements, setKlingElements] = useState<KlingElement[]>([]);
  const [isLoadingElements, setIsLoadingElements] = useState(false);
  const [elementsQuery, setElementsQuery] = useState("");

  const [generateAudio, setGenerateAudio] = useState(false);
  const [keepAudio, setKeepAudio] = useState(true);

  const [multishotEnabled, setMultishotEnabled] = useState(false);
  const [shots, setShots] = useState<O3Shot[]>([{ prompt: "", durationSeconds: 5 }]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progressText, setProgressText] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Viewer
  const [viewer, setViewer] = useState<Asset | null>(null);
  const hoverVideoEls = useRef<Record<string, HTMLVideoElement | null>>({});

  // Modals
  const [pickerOpen, setPickerOpen] = useState<null | "start" | "end" | "video">(null);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [elementsOpen, setElementsOpen] = useState(false);
  const [multishotOpen, setMultishotOpen] = useState(false);

  // Pending resume
  const [pendingJob, setPendingJob] = useState<PendingVideoEditJob | null>(null);

  const selectedModel = useMemo(() => MODEL_OPTIONS.find((m) => m.id === model)!, [model]);

  const shotsWithPrompt = useMemo(
    () => shots.filter((s) => (s.prompt || "").trim().length > 0),
    [shots]
  );

  const multishotTotalSeconds = useMemo(
    () => sumSeconds(shotsWithPrompt),
    [shotsWithPrompt]
  );

  const combinedRefsCount = referenceImageIds.length + klingElementIds.length;
  const maxRefImages = Math.max(0, 4 - klingElementIds.length);
  const maxElements = Math.max(0, 4 - referenceImageIds.length);

  const multishotReady = useMemo(() => {
    if (!multishotEnabled) return true;
    if (shotsWithPrompt.length === 0) return false;
    if (multishotTotalSeconds < 3 || multishotTotalSeconds > 15) return false;
    if (shotsWithPrompt.some((s) => (s.prompt || "").length > O3_SHOT_PROMPT_LIMIT)) return false;
    return true;
  }, [multishotEnabled, shotsWithPrompt, multishotTotalSeconds]);

  const visibleHistory = useMemo(() => history.slice(0, visibleCount), [history, visibleCount]);
  const hasMore = history.length > visibleHistory.length;

    const pendingSlots = useMemo(() => (isGenerating ? ["pending-1"] : []), [isGenerating]);

  const viewerRecipeInfo = useMemo(() => {
    if (!viewer) return null;

    const meta: any = (viewer as any).meta || {};

    const modelId = typeof meta.model === "string" ? meta.model : null;
    const aspect = typeof meta.aspectRatio === "string" ? meta.aspectRatio : null;
    const resolutionSaved = typeof meta.resolution === "string" ? meta.resolution : null;
    const dur = typeof meta.durationSeconds === "number" ? meta.durationSeconds : null;

    const firstId = typeof meta.firstFrameAssetId === "string" ? meta.firstFrameAssetId : null;
    const lastId = typeof meta.lastFrameAssetId === "string" ? meta.lastFrameAssetId : null;

    const first = firstId ? imageAssets.find((a) => a.id === firstId) || null : null;
    const last = lastId ? imageAssets.find((a) => a.id === lastId) || null : null;

    const editRaw = meta.editVideo && typeof meta.editVideo === "object" ? meta.editVideo : null;

    const referenceImageAssetIds: string[] = Array.isArray(editRaw?.referenceImageAssetIds)
      ? editRaw.referenceImageAssetIds.map(String)
      : [];

    const klingElementIds: string[] = Array.isArray(editRaw?.klingElementIds)
      ? editRaw.klingElementIds.map(String)
      : [];

    const referenceImages = referenceImageAssetIds
      .map((id) => imageAssets.find((a) => a.id === id) || null)
      .filter(Boolean) as Asset[];

    const elements = klingElementIds
      .map((id) => klingElements.find((e) => e.id === id) || null)
      .filter(Boolean) as KlingElement[];

    const startImage =
      typeof editRaw?.startImageAssetId === "string"
        ? imageAssets.find((a) => a.id === editRaw.startImageAssetId) || null
        : null;

    const endImage =
      typeof editRaw?.endImageAssetId === "string"
        ? imageAssets.find((a) => a.id === editRaw.endImageAssetId) || null
        : null;

    const inputVideoResolved =
      typeof editRaw?.videoAssetId === "string"
        ? videoAssets.find((a) => a.id === editRaw.videoAssetId) || null
        : null;

    const editVideo = editRaw
      ? {
          ...editRaw,
          referenceImages,
          elements,
          startImage,
          endImage,
          inputVideo: inputVideoResolved,
        }
      : null;

    return {
      modelId,
      aspectRatio: aspect || "—",
      resolution: resolutionSaved || "—",
      durationSeconds: dur,
      first,
      last,
      klingMode: typeof meta.klingMode === "string" ? meta.klingMode : null,
      klingShotType: typeof meta.klingShotType === "string" ? meta.klingShotType : null,
      klingSound: typeof meta.klingSound === "boolean" ? meta.klingSound : null,
      editVideo,
    };
  }, [viewer, imageAssets, videoAssets, klingElements]);

  // ===== Local storage (pending) =====
  const loadPending = useCallback((): PendingVideoEditJob | null => {

    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.jobToken || !parsed?.prompt || !parsed?.model) return null;
      return parsed as PendingVideoEditJob;
    } catch {
      return null;
    }
  }, []);

  const savePending = useCallback((job: PendingVideoEditJob) => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(job));
    } catch {}
  }, []);

  const clearPending = useCallback(() => {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {}
  }, []);

  // ===== Fetchers =====
  const reloadImages = useCallback(async () => {
    if (!user) return;
    setIsLoadingImages(true);
    try {
      const imgs = await listMyAssets({ type: "image", limit: 500 });
      setImageAssets(imgs);
    } catch (err: any) {
      console.warn(err);
    } finally {
      setIsLoadingImages(false);
    }
  }, [user]);

  const reloadVideos = useCallback(async () => {
    if (!user) return;
    setIsLoadingVideos(true);
    try {
      const vids = await listMyAssets({ type: "video", limit: 250 });
      setVideoAssets(vids);
    } catch (err: any) {
      console.warn(err);
    } finally {
      setIsLoadingVideos(false);
    }
  }, [user]);

  const reloadHistory = useCallback(async () => {
    if (!user) return;
    setIsLoadingHistory(true);
    try {
      const vids = await listMyAssets({ type: "video", limit: 250 });
      const filtered = vids.filter((a) => getMetaTool(a) === TOOL_NAME);
      setHistory(filtered);
      setVisibleCount(18);
    } catch (err: any) {
      setError(formatErr(err));
    } finally {
      setIsLoadingHistory(false);
    }
  }, [user]);

  const reloadKlingElements = useCallback(async () => {
    if (!user) return;
    setIsLoadingElements(true);
    try {
      const els = await listKlingElements();
      setKlingElements(els);
    } catch (err: any) {
      console.warn(err);
    } finally {
      setIsLoadingElements(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    reloadImages();
    reloadVideos();
    reloadHistory();
    reloadKlingElements();
    setPendingJob(loadPending());
  }, [user, reloadImages, reloadVideos, reloadHistory, reloadKlingElements, loadPending]);

  // Close popover on outside click
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!panel) return;
      const t = e.target as Node | null;
      if (!t) return;

      const pop = popoverRef.current;
      const ctr = controlsRef.current;

      if (pop && pop.contains(t)) return;
      if (ctr && ctr.contains(t)) return;

      setPanel(null);
    }

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [panel]);

  // Keep state coherent when switching models
  useEffect(() => {
    if (model !== "kling-o3-ref-to-video-pro") {
      setMultishotEnabled(false);
    }
    if (model === "kling-o3-ref-to-video-pro") {
      setAspectRatio((prev) => (prev === "auto" ? "16:9" : prev));
    }
  }, [model]);

  // ===== Upload helpers =====
  const uploadImage = useCallback(async (file: File) => {
    const a = await uploadUserAsset(file, { tool: TOOL_NAME, category: "image", type: "image" });
    setImageAssets((prev) => [a, ...prev]);
    return a;
  }, []);

  const uploadVideo = useCallback(async (file: File) => {
    const a = await uploadUserAsset(file, { tool: TOOL_NAME, category: "video", type: "video" });
    setVideoAssets((prev) => [a, ...prev]);
    return a;
  }, []);

  // ===== Actions (history) =====
  const onTogglePublish = useCallback(
    async (asset: Asset) => {
      try {
        const meta: any = (asset as any).meta || {};
        const published = Boolean(meta?.published);
        if (published) {
          await unpublishAsset(asset.id);
        } else {
          await publishAsset(asset.id);
        }
        await reloadHistory();
      } catch (err: any) {
        setError(formatErr(err));
      }
    },
    [reloadHistory]
  );

  const onDownload = useCallback((asset: Asset) => {
    const url = getAssetUrl(asset);
    if (!url) return;
    const name = String((asset as any).name || "video").replaceAll(" ", "_");
    downloadFromUrl(url, `${name}.mp4`);
  }, []);

  const onDelete = useCallback(
    async (asset: Asset) => {
      const ok = window.confirm("¿Eliminar este video? Esta acción no se puede deshacer.");
      if (!ok) return;
      try {
        await deleteAsset(asset.id);
        await reloadHistory();
      } catch (err: any) {
        setError(formatErr(err));
      }
    },
    [reloadHistory]
  );

  // ===== Limits for references (Elements modal + images modal) =====
  const setKlingElementIdsLimited = useCallback<React.Dispatch<React.SetStateAction<string[]>>>(
    (next) => {
      setKlingElementIds((prev) => {
        const value = typeof next === "function" ? (next as any)(prev) : next;
        if (value.length > maxElements) {
          setError(
            `Máximo ${maxElements} Elements porque ya tienes ${referenceImageIds.length} imágenes de referencia (máx 4 combinado).`
          );
          return prev;
        }
        return value;
      });
    },
    [maxElements, referenceImageIds.length]
  );

  // ===== Generation =====
  const validateAndBuildRequest = useCallback(() => {
    if (combinedRefsCount > 4) {
      return { ok: false as const, error: "Kling permite máximo 4 referencias combinadas (Elements + imágenes)." };
    }

    const ar: AspectRatio =
      model === "kling-o3-ref-to-video-pro" && aspectRatio === "auto" ? "16:9" : aspectRatio;

    if (model === "kling-o3-ref-to-video-pro") {
      if (!startImage) {
        return { ok: false as const, error: "Selecciona una imagen START (obligatoria) para Reference→Video." };
      }

      if (multishotEnabled) {
        const clean = shots.filter((s) => (s.prompt || "").trim().length > 0);
        if (clean.length === 0) {
          return { ok: false as const, error: "Agrega al menos 1 shot con prompt para el Storyboard." };
        }
        const total = sumSeconds(clean);
        if (total < 3 || total > 15) {
          return { ok: false as const, error: "El Storyboard debe sumar entre 3s y 15s en total." };
        }
        const anyTooLong = clean.some((s) => (s.prompt || "").length > O3_SHOT_PROMPT_LIMIT);
        if (anyTooLong) {
          return { ok: false as const, error: `Un shot supera el límite de ${O3_SHOT_PROMPT_LIMIT} caracteres.` };
        }

        const finalPrompt = buildPromptFromShots(clean);

        return {
          ok: true as const,
          finalPrompt,
          body: {
            model,
            klingMultiPrompt: clean,
            startImageAssetId: startImage.id,
            endImageAssetId: endImage?.id || null,
            referenceImageAssetIds: referenceImageIds,
            klingElementIds: klingElementIds,
            durationSeconds: total,
            aspectRatio: ar,
            generateAudio,
            toolName: TOOL_NAME,
            hint: nowHint(model),
            async: true,
          },
        };
      }

      const p = (prompt || "").trim();
      if (!p) return { ok: false as const, error: "Escribe un prompt (obligatorio) para editar el video." };

      // ✅ Kling O3 Edit Video no expone duration/aspect en el API: usa los del video de entrada.
      if (model === "kling-o3-edit-video-pro") {
        return {
          ok: true as const,
          finalPrompt: p,
          body: {
            model,
            prompt: p,
            videoAssetId: inputVideo.id,
            referenceImageAssetIds: referenceImageIds,
            klingElementIds: klingElementIds,
            keepAudio,
            toolName: TOOL_NAME,
            hint: nowHint(model),
            async: true,
          },
        };
      }

      // ✅ Reference Video→Video sí permite duration/aspect.
      if (durationSeconds < 3 || durationSeconds > 15) {
        return { ok: false as const, error: "Duración inválida: usa 3–15 segundos." };
      }

      return {
        ok: true as const,
        finalPrompt: p,
        body: {
          model,
          prompt: p,
          videoAssetId: inputVideo.id,
          referenceImageAssetIds: referenceImageIds,
          klingElementIds: klingElementIds,
          durationSeconds,
          aspectRatio: ar,
          keepAudio,
          toolName: TOOL_NAME,
          hint: nowHint(model),
          async: true,
        },
      };
    }

    if (!inputVideo) {
      return { ok: false as const, error: "Selecciona un VIDEO de entrada (obligatorio) para este modelo." };
    }

    const p = (prompt || "").trim();
    if (!p) return { ok: false as const, error: "Escribe un prompt (obligatorio) para editar el video." };

    if (durationSeconds < 3 || durationSeconds > 15) {
      return { ok: false as const, error: "Duración inválida: usa 3–15 segundos." };
    }

    return {
      ok: true as const,
      finalPrompt: p,
      body: {
        model,
        prompt: p,
        videoAssetId: inputVideo.id,
        referenceImageAssetIds: referenceImageIds,
        klingElementIds: klingElementIds,
        durationSeconds,
        aspectRatio: ar,
        keepAudio,
        toolName: TOOL_NAME,
        hint: nowHint(model),
        async: true,
      },
    };
  }, [
    model,
    prompt,
    aspectRatio,
    durationSeconds,
    startImage,
    endImage,
    inputVideo,
    referenceImageIds,
    klingElementIds,
    generateAudio,
    keepAudio,
    multishotEnabled,
    shots,
    combinedRefsCount,
  ]);

  const runFinalizeFlow = useCallback(
    async (jobToken: string, finalPrompt: string) => {
      setProgressText("Procesando (Fal)…");
      await waitFalJob(jobToken, {
        signal: abortRef.current?.signal,
        onProgress: (msg) => setProgressText(msg),
      });

      setProgressText("Finalizando…");
      const fin = await apiPostJson<any>(
        "/api/ai/video/fal/finalize",
        { jobToken, prompt: finalPrompt },
        { signal: abortRef.current?.signal, timeoutMs: 120_000, retries: 1 }
      );

      if (!fin?.ok) throw new Error(fin?.error || "Finalize failed.");

      clearPending();
      setPendingJob(null);
      setProgressText("");

      await reloadVideos();
      await reloadHistory();
    },
    [reloadHistory, reloadVideos, clearPending]
  );

  const onGenerate = useCallback(async () => {
    if (isGenerating) return;
    setError(null);

    const built = validateAndBuildRequest();
    if (!built.ok) {
      setError(built.error);
      return;
    }

    const { body, finalPrompt } = built;
    setIsGenerating(true);
    setProgressText("Enviando a Kling O3…");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await apiPostJson<any>(
        "/api/ai/video/edit",
        body,
        { signal: ctrl.signal, timeoutMs: 120_000, retries: 0 }
      );

      if (!resp?.ok || resp?.mode !== "async" || !resp?.jobToken) {
        throw new Error(resp?.error || "Respuesta inválida del backend (esperaba async + jobToken).");
      }

      const jobToken = String(resp.jobToken);

      const pj: PendingVideoEditJob = {
        jobToken,
        prompt: finalPrompt,
        model: model,
        createdAt: Date.now(),
      };
      savePending(pj);
      setPendingJob(pj);

      await runFinalizeFlow(jobToken, finalPrompt);
      await reloadHistory();
    } catch (err: any) {
      setError(formatErr(err));
      setProgressText("");
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [isGenerating, validateAndBuildRequest, model, runFinalizeFlow, savePending, reloadHistory]);

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
    setProgressText("");
    setIsGenerating(false);
  }, []);

  const onResumePending = useCallback(async () => {
    const pj = loadPending();
    if (!pj) {
      setPendingJob(null);
      return;
    }
    setError(null);
    setIsGenerating(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await runFinalizeFlow(pj.jobToken, pj.prompt);
      await reloadHistory();
    } catch (err: any) {
      setError(formatErr(err));
      setProgressText("");
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [loadPending, runFinalizeFlow, reloadHistory]);

  const onDiscardPending = useCallback(() => {
    clearPending();
    setPendingJob(null);
  }, [clearPending]);

  // ===== Labels =====
  const paramsLabelParts: string[] = [];

  if (model === "kling-o3-edit-video-pro") {
    paramsLabelParts.push("Aspect: input");
    paramsLabelParts.push("Duration: input");
    paramsLabelParts.push(keepAudio ? "Keep audio: yes" : "Keep audio: no");
  } else {
    paramsLabelParts.push(aspectRatio === "auto" ? "Aspect: auto" : `Aspect: ${aspectRatio}`);
    paramsLabelParts.push(multishotEnabled ? `Duration: ${multishotTotalSeconds}s` : `Duration: ${durationSeconds}s`);
    if (model === "kling-o3-ref-to-video-pro") paramsLabelParts.push(generateAudio ? "Audio: on" : "Audio: off");
    if (model !== "kling-o3-ref-to-video-pro") paramsLabelParts.push(keepAudio ? "Keep audio: yes" : "Keep audio: no");
  }
  const paramsLabel = paramsLabelParts.join(" · ");

  return (
    <div ref={rootRef} className={styles.root} onMouseMove={handleRootMouseMove}>
      <ErrorModal error={error} onClose={() => setError(null)} />

      <EditHistorySection
        isLoading={isLoadingHistory}
        pendingSlots={pendingSlots}
        totalCount={history.length}
        visibleHistory={visibleHistory}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onRefresh={() => reloadHistory()}
        onLoadMore={async () => {
          if (isLoadingMore) return;
          setIsLoadingMore(true);
          try {
            setVisibleCount((c) => c + 18);
          } finally {
            setIsLoadingMore(false);
          }
        }}
        onOpenViewer={(asset) => setViewer(asset)}
        onTogglePublish={onTogglePublish}
        onDownload={onDownload}
        onDelete={onDelete}
        onShowError={(msg) => setError(msg)}
        hoverVideoEls={hoverVideoEls}
      />

      {/* ===== Dock ===== */}
      <div className={styles.dockWrap}>
        <div className={styles.dock}>
          <div className={styles.promptRow}>
            {/* Inputs */}
            {model === "kling-o3-ref-to-video-pro" ? (
              <div className={styles.frameStrip}>
                <div
                  className={styles.frameCard}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPickerOpen("start")}
                  onKeyDown={(e) => e.key === "Enter" && setPickerOpen("start")}
                  title="START"
                >
                  {startImage ? (
                    <>
                      <img className={styles.frameCardImg} src={getAssetUrl(startImage) || ""} alt="START" />
                      <span className={styles.frameCardBadge}>START</span>
                      <button
                        type="button"
                        className={styles.frameCardRemove}
                        onClick={(e) => {
                          e.stopPropagation();
                          setStartImage(null);
                          setEndImage(null);
                        }}
                        aria-label="Remove START"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <div className={styles.frameCardEmpty}>
                      <div className={styles.frameCardIcons}>
                        <Icon name="image" />
                        <Icon name="upload" />
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className={`${styles.frameCard} ${!startImage ? styles.frameCardLocked : ""}`}
                  role="button"
                  tabIndex={startImage ? 0 : -1}
                  onClick={() => startImage && setPickerOpen("end")}
                  onKeyDown={(e) => e.key === "Enter" && startImage && setPickerOpen("end")}
                  aria-disabled={!startImage}
                  title={!startImage ? "Primero START" : "END"}
                >
                  {endImage ? (
                    <>
                      <img className={styles.frameCardImg} src={getAssetUrl(endImage) || ""} alt="END" />
                      <span className={styles.frameCardBadge}>END</span>
                      <button
                        type="button"
                        className={styles.frameCardRemove}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEndImage(null);
                        }}
                        aria-label="Remove END"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <div className={styles.frameCardEmpty}>
                      <div className={styles.frameCardIcons}>
                        <Icon name="image" />
                        <Icon name="upload" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.frameStrip}>
                <div
                  className={styles.frameCard}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPickerOpen("video")}
                  onKeyDown={(e) => e.key === "Enter" && setPickerOpen("video")}
                  title="VIDEO"
                >
                  {inputVideo ? (
                    <>
                      <video className={styles.frameCardImg} src={getAssetUrl(inputVideo) || ""} muted playsInline loop />
                      <span className={styles.frameCardBadge}>VIDEO</span>
                      <button
                        type="button"
                        className={styles.frameCardRemove}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInputVideo(null);
                        }}
                        aria-label="Remove VIDEO"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <div className={styles.frameCardEmpty}>
                      <div className={styles.frameCardIcons}>
                        <Icon name="upload" />
                        <Icon name="video" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Prompt */}
            <div className={styles.promptInputWrap}>
              <div className={styles.promptEditor}>
                {(referenceImageIds.length > 0 || klingElementIds.length > 0 || multishotEnabled) && (
                  <div className={styles.promptTags}>
                    {referenceImageIds.length > 0 && (
                      <button type="button" className={styles.promptTag} onClick={() => setRefPickerOpen(true)}>
                        Refs: {referenceImageIds.length}
                        <span
                          className={styles.promptTagRemove}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReferenceImageIds([]);
                          }}
                        >
                          ×
                        </span>
                      </button>
                    )}

                    {klingElementIds.length > 0 && (
                      <button type="button" className={styles.promptTag} onClick={() => setElementsOpen(true)}>
                        Elements: {klingElementIds.length}
                        <span
                          className={styles.promptTagRemove}
                          onClick={(e) => {
                            e.stopPropagation();
                            setKlingElementIds([]);
                          }}
                        >
                          ×
                        </span>
                      </button>
                    )}

                    <button type="button" className={styles.promptTag} title="Límite Kling">
                      Total refs: {combinedRefsCount}/4
                    </button>

                    {multishotEnabled && (
                      <button type="button" className={styles.promptTag} onClick={() => setMultishotOpen(true)}>
                        Storyboard: {multishotTotalSeconds}s
                      </button>
                    )}
                  </div>
                )}

                {multishotEnabled ? (
                  <div className={styles.multishotInline}>
                    <div className={styles.multishotTop}>
                      <div className={styles.multishotTitle}>
                        <Icon name="multishot" /> Storyboard (Kling O3)
                      </div>

                      <div className={styles.multishotTopActions}>
                        <button
                          type="button"
                          className={styles.multishotAddBtn}
                          onClick={() => setShots((prev) => (prev.length >= 10 ? prev : [...prev, { prompt: "", durationSeconds: 3 }]))}
                          title="Agregar shot (máx 10)"
                        >
                          + Shot
                        </button>

                        <button type="button" className={styles.multishotExpandBtn} onClick={() => setMultishotOpen(true)} title="Editor">
                          <Icon name="sliders" />
                        </button>

                        <button type="button" className={styles.multishotExpandBtn} onClick={() => setMultishotEnabled(false)} title="Volver a prompt único">
                          <Icon name="swap" />
                        </button>
                      </div>
                    </div>

                    <div className={styles.multishotMeta}>
                      Total: {multishotTotalSeconds}s · Shots: {shots.length} · Límite: {O3_SHOT_PROMPT_LIMIT} chars
                    </div>

                    <div className={styles.multishotShots}>
                      {shots.map((s, idx) => (
                        <div key={idx} className={styles.multishotShotRow}>
                          <div className={styles.multishotShotHeader}>
                            <div className={styles.multishotShotName}>
                              Shot {idx + 1} · {s.durationSeconds}s
                            </div>

                            <button
                              type="button"
                              className={styles.multishotRemoveBtn}
                              onClick={() => setShots((prev) => prev.filter((_, i) => i !== idx))}
                              disabled={shots.length <= 1}
                              title={shots.length <= 1 ? "Debe existir al menos 1 shot" : "Eliminar shot"}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>

                          <LimitedTextarea
                            value={s.prompt || ""}
                            onChange={(next) => setShots((prev) => prev.map((x, i) => (i === idx ? { ...x, prompt: next } : x)))}
                            placeholder="Prompt del shot… (sujeto, acción, cámara, estilo)"
                            rows={2}
                            limit={O3_SHOT_PROMPT_LIMIT}
                            surfaceClassName={styles.multishotTextarea}
                            inputResize="vertical"
                          />
                        </div>
                      ))}
                    </div>

                    {!multishotReady && (
                      <div className={styles.multishotWarn}>
                        Para generar: mínimo 1 shot con prompt, total 3–15s, y ningún shot supera {O3_SHOT_PROMPT_LIMIT} caracteres.
                      </div>
                    )}
                  </div>
                ) : (
                  <textarea
                    className={styles.prompt}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      model === "kling-o3-ref-to-video-pro"
                        ? "Describe la escena… (personaje, acción, cámara, estilo)."
                        : model === "kling-o3-edit-video-pro"
                          ? "Describe qué cambiar y qué conservar… (El video base es @Video1. Ej: “cambia el ambiente a nieve, conserva la identidad y el movimiento”)."
                          : "Describe la nueva versión… (El video base es @Video1. Usa @Image1/@Element1 para identidad/estilo)."
                    }

                    rows={3}
                  />
                )}

                <div className={styles.noteSmall}>{selectedModel.uiHint}</div>
              </div>
            </div>

            {/* Generate */}
            <div className={styles.generateCol}>
              <button
                type="button"
                className={styles.generateBtn}
                disabled={
                  isGenerating ||
                  !user ||
                  combinedRefsCount > 4 ||
                  (model === "kling-o3-ref-to-video-pro"
                    ? !startImage || (multishotEnabled ? !multishotReady : (prompt || "").trim().length === 0)
                    : !inputVideo || (prompt || "").trim().length === 0)
                }
                onClick={onGenerate}
                data-loading={isGenerating ? "true" : "false"}
              >
                <span className={styles.generateLabel}>{isGenerating ? "PROCESSING" : "GENERATE"}</span>
                {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
              </button>

              {isGenerating && (
                <button type="button" className={styles.cancelBtn} onClick={onCancel}>
                  CANCEL
                </button>
              )}

              {isGenerating && progressText && <div className={styles.progressText}>{progressText}</div>}
            </div>
          </div>

          {/* Pending resume banner */}
          {pendingJob && !isGenerating && (
            <div className={styles.resumeBanner}>
              <div className={styles.resumeTitle}>Generación pendiente</div>
              <div className={styles.resumeDesc}>
                Modelo: <b>{pendingJob.model}</b> · Iniciado: <b>{new Date(pendingJob.createdAt).toLocaleString()}</b>
              </div>
              <div className={styles.resumeActions}>
                <button type="button" className={styles.resumeBtn} onClick={onResumePending}>
                  RESUME
                </button>
                <button type="button" className={styles.discardBtn} onClick={onDiscardPending}>
                  DISCARD
                </button>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className={styles.controlsArea} ref={controlsRef}>
            <div className={styles.controlsRow}>
              <button
                type="button"
                className={`${styles.controlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
                onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
                title="Cambiar modelo"
              >
                <span className={styles.controlBtnLeft}>
                  <Icon name="model" />
                  Modelo
                </span>
                <span className={styles.controlBtnMeta}>{selectedModel.uiName}</span>
              </button>

              <button
                type="button"
                className={`${styles.controlBtn} ${panel === "params" ? styles.controlBtnActive : ""}`}
                onClick={() => setPanel((p) => (p === "params" ? null : "params"))}
                title="Ajustes"
              >
                <span className={styles.controlBtnLeft}>
                  <Icon name="sliders" />
                  Ajustes
                </span>
                <span className={styles.controlBtnMeta}>{paramsLabel}</span>
              </button>

              <button
                type="button"
                className={styles.controlBtn}
                onClick={() => setRefPickerOpen(true)}
                title="Imágenes de referencia (máx 4 combinado)"
              >
                <span className={styles.controlBtnLeft}>
                  <Icon name="image" />
                  Refs
                </span>
                <span className={styles.controlBtnMeta}>({referenceImageIds.length})</span>
              </button>

              <button
                type="button"
                className={styles.controlBtn}
                onClick={() => setElementsOpen(true)}
                title="Kling Elements (máx 4 combinado)"
              >
                <span className={styles.controlBtnLeft}>
                  <Icon name="elements" />
                  Elements
                </span>
                <span className={styles.controlBtnMeta}>({klingElementIds.length})</span>
              </button>

              {model === "kling-o3-ref-to-video-pro" && (
                <button
                  type="button"
                  className={`${styles.controlBtn} ${multishotEnabled ? styles.controlBtnActive : ""}`}
                  onClick={() => {
                    setMultishotEnabled((v) => !v);
                    setMultishotOpen(true);
                  }}
                  title="Storyboard / Multishot"
                >
                  <span className={styles.controlBtnLeft}>
                    <Icon name="multishot" />
                    Storyboard
                  </span>
                  <span className={styles.controlBtnMeta}>
                    {multishotEnabled ? `(${shots.length})` : ""}
                  </span>
                </button>
              )}
            </div>

            {panel && (
              <div className={styles.popover} ref={popoverRef}>
                <div className={styles.popoverInner}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>{panel === "model" ? "MODELOS" : "AJUSTES"}</div>
                    <button className={styles.closeBtn} type="button" onClick={() => setPanel(null)} title="Cerrar">
                      <Icon name="close" />
                    </button>
                  </div>

                  {panel === "model" ? (
                    <div className={styles.modelGrid}>
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
                          <div className={styles.modelName}>{opt.uiName}</div>
                          <div className={styles.modelDesc}>{opt.uiDesc}</div>
                        </button>
                      ))}

                      <div className={styles.note} style={{ gridColumn: "1 / -1" }}>
                        <b>Tip:</b> Si Kling falla, reduce referencias (máx 4 combinadas), simplifica el prompt, o prueba una duración menor.
                      </div>
                    </div>
                  ) : (
                    <div>
                      {model === "kling-o3-edit-video-pro" ? (
                        <div className={styles.note}>
                          <div>
                            <b>Aspect &amp; Duration:</b> en <b>Editar Video</b>, Kling usa el aspect ratio y la duración del <b>video de entrada</b>.
                            Aquí solo ajustas audio y referencias.
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={styles.formRow}>
                            <label className={styles.formLabel}>Aspect</label>
                            <div className={styles.segment}>
                              {model !== "kling-o3-ref-to-video-pro" && (
                                <button
                                  type="button"
                                  className={`${styles.segmentBtn} ${aspectRatio === "auto" ? styles.segmentBtnActive : ""}`}
                                  onClick={() => setAspectRatio("auto")}
                                  disabled={multishotEnabled}
                                >
                                  auto
                                </button>
                              )}
                              <button
                                type="button"
                                className={`${styles.segmentBtn} ${aspectRatio === "16:9" ? styles.segmentBtnActive : ""}`}
                                onClick={() => setAspectRatio("16:9")}
                                disabled={multishotEnabled}
                              >
                                16:9
                              </button>
                              <button
                                type="button"
                                className={`${styles.segmentBtn} ${aspectRatio === "9:16" ? styles.segmentBtnActive : ""}`}
                                onClick={() => setAspectRatio("9:16")}
                                disabled={multishotEnabled}
                              >
                                9:16
                              </button>
                              <button
                                type="button"
                                className={`${styles.segmentBtn} ${aspectRatio === "1:1" ? styles.segmentBtnActive : ""}`}
                                onClick={() => setAspectRatio("1:1")}
                                disabled={multishotEnabled}
                              >
                                1:1
                              </button>
                            </div>
                          </div>

                          <div className={styles.formRow}>
                            <label className={styles.formLabel}>Duration</label>
                            <div className={styles.segment}>
                              {[3, 5, 8, 10, 12, 15].map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  className={`${styles.segmentBtn} ${durationSeconds === d ? styles.segmentBtnActive : ""}`}
                                  onClick={() => setDurationSeconds(d)}
                                  disabled={multishotEnabled}
                                  title={multishotEnabled ? "Con Storyboard la duración viene de la suma de shots" : ""}
                                >
                                  {d}s
                                </button>
                              ))}
                            </div>
                            {multishotEnabled && (
                              <div className={styles.segmentMeta}>
                                Storyboard total: <b>{multishotTotalSeconds}s</b>
                              </div>
                            )}
                          </div>
                        </>
                      )}


                      {model === "kling-o3-ref-to-video-pro" ? (
                        <div className={styles.formRow}>
                          <label className={styles.formLabel}>Audio</label>
                          <div className={styles.segment}>
                            <button
                              type="button"
                              className={`${styles.segmentBtn} ${!generateAudio ? styles.segmentBtnActive : ""}`}
                              onClick={() => setGenerateAudio(false)}
                            >
                              off
                            </button>
                            <button
                              type="button"
                              className={`${styles.segmentBtn} ${generateAudio ? styles.segmentBtnActive : ""}`}
                              onClick={() => setGenerateAudio(true)}
                            >
                              on
                            </button>
                          </div>
                          <div className={styles.segmentMeta}>Audio aumenta costo y tiempo.</div>
                        </div>
                      ) : (
                        <div className={styles.formRow}>
                          <label className={styles.formLabel}>Keep audio</label>
                          <div className={styles.segment}>
                            <button
                              type="button"
                              className={`${styles.segmentBtn} ${keepAudio ? styles.segmentBtnActive : ""}`}
                              onClick={() => setKeepAudio(true)}
                            >
                              yes
                            </button>
                            <button
                              type="button"
                              className={`${styles.segmentBtn} ${!keepAudio ? styles.segmentBtnActive : ""}`}
                              onClick={() => setKeepAudio(false)}
                            >
                              no
                            </button>
                          </div>
                          <div className={styles.segmentMeta}>Si “yes”, intenta preservar el audio original.</div>
                        </div>
                      )}

                      <div className={styles.note}>
                        <div>
                          <b>Referencias:</b> Elements + imágenes ≤ 4. 1–2 referencias fuertes suele funcionar mejor que 4 débiles.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Modals ===== */}
      <AssetPickerModal
        open={pickerOpen === "start"}
        title="Selecciona START (imagen)"
        kind="image"
        assets={imageAssets}
        isLoading={isLoadingImages}
        selectedId={startImage?.id || null}
        onSelect={(a) => setStartImage(a)}
        onClose={() => setPickerOpen(null)}
        onUpload={uploadImage}
        getAssetUrl={getAssetUrl}
      />

      <AssetPickerModal
        open={pickerOpen === "end"}
        title="Selecciona END (imagen)"
        kind="image"
        assets={imageAssets}
        isLoading={isLoadingImages}
        selectedId={endImage?.id || null}
        onSelect={(a) => setEndImage(a)}
        onClose={() => setPickerOpen(null)}
        onUpload={uploadImage}
        getAssetUrl={getAssetUrl}
      />

      <AssetPickerModal
        open={pickerOpen === "video"}
        title="Selecciona VIDEO (entrada)"
        kind="video"
        assets={videoAssets}
        isLoading={isLoadingVideos}
        selectedId={inputVideo?.id || null}
        onSelect={(a) => setInputVideo(a)}
        onClose={() => setPickerOpen(null)}
        onUpload={uploadVideo}
        getAssetUrl={getAssetUrl}
      />

      <MultiImagePickerModal
        open={refPickerOpen}
        title="Imágenes de referencia"
        assets={imageAssets}
        isLoading={isLoadingImages}
        selectedIds={referenceImageIds}
        setSelectedIds={setReferenceImageIds}
        max={maxRefImages}
        onClose={() => setRefPickerOpen(false)}
        onUpload={uploadImage}
        getAssetUrl={getAssetUrl}
      />

      <KlingElementsModal
        open={elementsOpen}
        onClose={() => setElementsOpen(false)}
        elements={klingElements}
        query={elementsQuery}
        setQuery={setElementsQuery}
        selectedIds={klingElementIds}
        setSelectedIds={setKlingElementIdsLimited}
        onClear={() => setKlingElementIds([])}
        imageAssets={imageAssets}
        getAssetUrl={getAssetUrl}
        onRefresh={reloadKlingElements}
      />

      <O3MultishotModal
        open={multishotOpen}
        onClose={() => setMultishotOpen(false)}
        shots={shots}
        setShots={setShots}
        totalSeconds={multishotTotalSeconds}
      />

      <ViewerModal
        viewer={viewer}
        viewerRecipeInfo={viewerRecipeInfo}
        onClose={() => setViewer(null)}
        onCopyPrompt={(a) => {
          const meta: any = (a as any).meta || {};
          const p = String(meta?.editVideo?.prompt || meta?.prompt || "");
          navigator.clipboard?.writeText(p || "");
        }}
        onReusePrompt={() => {}}
        onTogglePublish={onTogglePublish}
        onDownload={onDownload}
        onDelete={onDelete}
      />
    </div>
  );
}
