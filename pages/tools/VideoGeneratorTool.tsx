import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import ErrorModal from "../../components/ErrorModal";
import { deleteAsset, listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import type { Asset } from "../../types";
import { listKlingElements, type KlingElement } from "../../services/klingElementsService";
import { formatErr, loadPendingFalJob, clearPendingFalJob, resumeFalFinalize, type PendingFalJob } from "../../services/videoGenApi";
import { FramePickerModal } from "./video/FramePickerModal";
import { MultishotModal } from "./video/multishotmodal";
import { LimitedTextarea, KLING_V3_SHOT_PROMPT_LIMIT } from "./video/LimitedTextarea";
import { KlingElementsModal } from "./video/KlingElementsModal";
import { HistorySection } from "./video/HistorySection";
import { FrameStrip } from "./video/FrameStrip";
import { ControlsRow } from "./video/ControlsRow";
import { ControlsPopover } from "./video/ControlsPopover";


import {
  DEFAULT_VIDEO_MODEL,
  getVideoModelHandler,
  normalizeModelId,
  prettyVideoModelLabel,
  coerceAspectRatioForModel,
  coerceModelForLastFrame,
  coerceResolutionForModel,
  clampInt,
  KLING_2_5_TURBO,
  KLING_2_6,
  KLING_V3,
  KLING_O3_PRO,
  VEO_3,
  VEO_3_FAST,
  VEO_3_1,
  VEO_3_1_FAST,
} from "../../services/videoModels";
import { Icon } from "./video/icon";
import { ViewerModal } from "./video/viewermodal";


type PanelKey = "frames" | "model" | "parameters" | "duration" | null;

type FrameSlotKey = "first" | "last";

type VideoGenItem = { url: string; assetId: string };

type VideoGenResponse =
  | { ok: true; items: VideoGenItem[]; urlExpiresInSeconds?: number }
  | { ok: false; error: any };

type KlingV3Shot = { prompt: string; durationSeconds: number; elementIds?: string[] };

const TOOL_ID = "video-generator";
const FRAME_UPLOAD_TOOL = "video-gen-frame";

const VIDEO_SETTINGS_VERSION = 1;

type VideoToolSettingsV1 = {
  v: 1;

  prompt: string;
  model: string;

  aspectRatio: "16:9" | "9:16" | "1:1";
  resolution: "720p" | "1080p" | "4k";
  durationSeconds: number;
  count: number;

  // Frames guardamos solo IDs
  firstFrameId: string | null;
  lastFrameId: string | null;

  // Kling V2
  klingMode: "std" | "pro";
  klingSound: boolean;
  klingSoundTouched: boolean;

  // Kling V3
  negativePrompt: string;
  klingCfgScale: number;
  klingVoiceIdsText: string;
  selectedKlingElementIds: string[];

  multishotEnabled: boolean;
  klingShotType: "customize" | "intelligent";
  klingShots: { prompt: string; durationSeconds: number }[];
};

function settingsKey(userId: string) {
  return `tales_video_settings_v${VIDEO_SETTINGS_VERSION}:${userId}`;
}

function safeParseJson(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function coerceAr(v: any): "16:9" | "9:16" | "1:1" {
  return v === "9:16" || v === "1:1" ? v : "16:9";
}

function coerceRes(v: any): "720p" | "1080p" | "4k" {
  return v === "1080p" || v === "4k" ? v : "720p";
}

function coerceStdPro(v: any): "std" | "pro" {
  return v === "pro" ? "pro" : "std";
}

function coerceShotType(v: any): "customize" | "intelligent" {
  return v === "intelligent" ? "intelligent" : "customize";
}

function coerceShots(v: any) {
  const arr = Array.isArray(v) ? v : [];
  const cleaned = arr
    .map((x) => ({
      prompt: typeof x?.prompt === "string" ? x.prompt : "",
      durationSeconds: Math.max(3, Math.min(15, Math.trunc(Number(x?.durationSeconds) || 3))),
    }))
    .slice(0, 10);

  // mínimo 1 shot para no romper UI
  if (cleaned.length === 0) return [{ prompt: "", durationSeconds: 3 }];
  return cleaned;
}

const VideoGeneratorTool: React.FC = () => {

    const { user } = useAuth();

  // Historial: mostramos 12 al inicio y cargamos de a 9 con botón "Cargar más"
  const HISTORY_INITIAL_COUNT = 12;
  const HISTORY_LOAD_MORE_COUNT = 9;

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_INITIAL_COUNT);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [viewer, setViewer] = useState<Asset | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [pendingFalJob, setPendingFalJob] = useState<PendingFalJob | null>(null);
  const settingsLoadedRef = useRef(false);
  const pendingFrameIdsRef = useRef<{ firstId: string | null; lastId: string | null }>({
    firstId: null,
    lastId: null,
  });

  // placeholders mientras se genera (tiles “GENERATING” como en Image Tool)
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);

  // refs para reproducir preview en hover
  const hoverVideoEls = useRef<Record<string, HTMLVideoElement | null>>({});

  const [error, setError] = useState<string | null>(null);

  // Core
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_VIDEO_MODEL);
  const [panel, setPanel] = useState<PanelKey>(null);

  // Frames (First / Last)
  const [firstFrame, setFirstFrame] = useState<Asset | null>(null);
  const [lastFrame, setLastFrame] = useState<Asset | null>(null);

  // Params
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("720p");
  const [count, setCount] = useState<number>(1);
  const [klingSound, setKlingSound] = useState<boolean>(false);
  const [klingSoundTouched, setKlingSoundTouched] = useState<boolean>(false);
  const [klingMode, setKlingMode] = useState<"std" | "pro">("std");

  // ===============================
  // Kling V3 (Fal) — Elements + Multishot + Params
  // ===============================
  const [klingElements, setKlingElements] = useState<KlingElement[]>([]);
  const [elementsOpen, setElementsOpen] = useState(false);
  // ✅ NUEVO: en multishot, el modal edita los elements de un shot específico
  const [elementsShotIndex, setElementsShotIndex] = useState<number | null>(null);
  const openElementsForShot = (shotIndex: number | null) => {
    setElementsShotIndex(shotIndex);
    setElementsOpen(true);
  };
  const [elementsQuery, setElementsQuery] = useState("");
  const [selectedKlingElementIds, setSelectedKlingElementIds] = useState<string[]>([]);

  const [multishotEnabled, setMultishotEnabled] = useState(false);
  const [multishotOpen, setMultishotOpen] = useState(false);
  const [klingShots, setKlingShots] = useState<KlingV3Shot[]>([
    { prompt: "", durationSeconds: 3, elementIds: [] },
    { prompt: "", durationSeconds: 3, elementIds: [] },
  ]);
  const [klingShotType, setKlingShotType] = useState<"customize" | "intelligent">("customize");

  // V3 extra params
  const [negativePrompt, setNegativePrompt] = useState("");
  const [klingCfgScale, setKlingCfgScale] = useState<number>(0.5);
  const [klingVoiceIdsText, setKlingVoiceIdsText] = useState("");

  // Duration
  const [durationSeconds, setDurationSeconds] = useState<number>(8);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);

  // Assets
  const [imageAssets, setImageAssets] = useState<Asset[]>([]);
  const [videoAssets, setVideoAssets] = useState<Asset[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  const visibleHistory = useMemo(
    () => videoAssets.slice(0, Math.min(historyVisibleCount, videoAssets.length)),
    [videoAssets, historyVisibleCount]
  );
  const hasMoreHistory = historyVisibleCount < videoAssets.length;

  // Picker modal
    // Picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<FrameSlotKey>("first");
  const [pickerQuery, setPickerQuery] = useState("");

  // Picker (FIRST/LAST): mostramos 12 al inicio y cargamos de a 9 con botón "Cargar más"
  const PICKER_INITIAL_COUNT = 12;
  const PICKER_LOAD_MORE_COUNT = 9;
  const [pickerVisibleCount, setPickerVisibleCount] = useState(PICKER_INITIAL_COUNT);

  const popoverRef = useRef<HTMLDivElement>(null);

    // ==== Root glow (igual que ImageTool) ====
  const rootRef = useRef<HTMLDivElement>(null);

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

  // ==== Historial: solo generaciones reales (no uploads) ====
  function isGeneratedHistoryItem(a: Asset): boolean {
    const meta = (a as any).meta || {};
    const metaTool = typeof meta.tool === "string" ? meta.tool : null;
    const source = typeof meta.source === "string" ? meta.source : null;
    const model = typeof meta.model === "string" ? meta.model : null;

    const hasPrompt = typeof a.prompt === "string" && a.prompt.trim().length > 0;

    if (a.type !== "video") return false;
    if (source === "upload") return false;

    // si viene tool guardado, debe coincidir
    if (metaTool && metaTool !== TOOL_ID) return false;

    // para evitar videos sueltos sin recipe
    if (!model) return false;
    if (!hasPrompt) return false;

    return true;
  }

  function getAssetUrl(a: Asset): string | null {
    const anyA = a as any;
    return (
      (typeof (a as any).url === "string" && (a as any).url) ||
      (typeof anyA.signedUrl === "string" && anyA.signedUrl) ||
      (typeof anyA.publicUrl === "string" && anyA.publicUrl) ||
      (typeof anyA.thumbUrl === "string" && anyA.thumbUrl) ||
      null
    );
  }

  async function reloadImages() {
    setIsLoadingImages(true);
    try {
      const imgs = await listMyAssets({ type: "image", limit: 500 });

      if (Array.isArray(imgs) && imgs.length > 0) {
        setImageAssets(imgs);
        return imgs;
      }

      // Fallback: algunos backends no usan type="image" para imágenes generadas
      const all = await listMyAssets({ limit: 500 } as any);
      const onlyImages = (all || []).filter((x: any) => {
        if (x?.type === "image") return true;
        const mime = String(x?.mime || x?.contentType || x?.mimeType || "");
        return mime.startsWith("image/");
      });

      setImageAssets(onlyImages);
      return onlyImages;
    } catch (e: any) {
      console.warn(e);
      return [];
    } finally {
      setIsLoadingImages(false);
    }
  }

  async function reloadHistory() {
    setIsLoadingHistory(true);
    try {
      const vids = await listMyAssets({ type: "video", limit: 300 });
      const sorted = [...vids].sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      const onlyGenerated = sorted.filter(isGeneratedHistoryItem);
      setVideoAssets(onlyGenerated);
      setHistoryVisibleCount(Math.min(HISTORY_INITIAL_COUNT, onlyGenerated.length));
      return onlyGenerated;
    } catch (e: any) {
      console.warn(e);
      return [];
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleLoadMoreHistory() {
    if (isLoadingMoreHistory) return;
    setIsLoadingMoreHistory(true);
    try {
      await new Promise((r) => setTimeout(r, 120));
      setHistoryVisibleCount((c) => Math.min(c + HISTORY_LOAD_MORE_COUNT, videoAssets.length));
    } finally {
      setIsLoadingMoreHistory(false);
    }
  }

  async function handleTogglePublish(asset: Asset) {
    try {
      if (asset.isPublic) {
        const r = await unpublishAsset(asset.id);
        setVideoAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPublic: r.isPublic } : a)));
        if (viewer?.id === asset.id) setViewer((v) => (v ? { ...v, isPublic: r.isPublic } : v));
      } else {
        const r = await publishAsset(asset.id);
        setVideoAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, isPublic: r.isPublic } : a)));
        if (viewer?.id === asset.id) setViewer((v) => (v ? { ...v, isPublic: r.isPublic } : v));
      }
    } catch (e: any) {
      setError(e?.message || "No se pudo cambiar visibilidad.");
    }
  }

  async function handleDownload(asset: Asset) {
    try {
      const resp = await fetch(asset.url);
      if (!resp.ok) throw new Error("No se pudo descargar el video.");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (asset.name || "video") + ".mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar el video.");
    }
  }

  async function handleDelete(asset: Asset) {
    const ok = window.confirm("¿Seguro que deseas eliminar este video? Esta acción no se puede deshacer.");
    if (!ok) return;

    try {
      await deleteAsset(asset.id);
      setVideoAssets((prev) => {
        const next = prev.filter((x) => x.id !== asset.id);
        const nextCount = Math.min(historyVisibleCount, next.length);
        setHistoryVisibleCount(nextCount);
        return next;
      });
      if (viewer?.id === asset.id) setViewer(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar.");
    }
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


  function reusePromptFromAsset(asset: Asset) {
    const raw = asset.prompt || "";
    if (!raw.trim()) return;

    setPrompt(raw);

    const meta = (asset as any).meta || {};

    // model
    if (typeof meta.model === "string") setModel(meta.model);

    // params básicos
    if (typeof meta.aspectRatio === "string") setAspectRatio(meta.aspectRatio);
    if (typeof meta.resolution === "string") setResolution(meta.resolution);
    if (typeof meta.durationSeconds === "number") setDurationSeconds(meta.durationSeconds);

    // frames
    const firstId = typeof meta.firstFrameAssetId === "string" ? meta.firstFrameAssetId : null;
    const lastId = typeof meta.lastFrameAssetId === "string" ? meta.lastFrameAssetId : null;

    const first = firstId ? imageAssets.find((a) => a.id === firstId) || null : null;
    const last = lastId ? imageAssets.find((a) => a.id === lastId) || null : null;

    setFirstFrame(first);
    setLastFrame(first ? last : null);

    // kling params opcionales
    if (typeof meta.klingMode === "string") setKlingMode(meta.klingMode);
    if (typeof meta.klingSound === "boolean") {
      setKlingSound(meta.klingSound);
      setKlingSoundTouched(true);
    }
    if (typeof meta.klingShotType === "string") setKlingShotType(meta.klingShotType);
    if (Array.isArray(meta.klingElementIds)) setSelectedKlingElementIds(meta.klingElementIds.filter((x: any) => typeof x === "string"));

    if (typeof meta.negativePrompt === "string") setNegativePrompt(meta.negativePrompt);
    if (typeof meta.klingCfgScale === "number") setKlingCfgScale(meta.klingCfgScale);
    if (Array.isArray(meta.klingVoiceIds)) setKlingVoiceIdsText(meta.klingVoiceIds.join(","));

    if (typeof meta.multishotEnabled === "boolean") setMultishotEnabled(meta.multishotEnabled);
    if (Array.isArray(meta.klingMultiPrompt)) setKlingShots(meta.klingMultiPrompt);

    // UI close
    setPanel(null);
    setViewer(null);
  }
 

  const hasFirst = !!firstFrame;
  const hasLast = !!lastFrame;

  const modelNorm = useMemo(() => normalizeModelId(model), [model]);

  const isKling = modelNorm.startsWith("kling-");
  const isKlingV2 = modelNorm === KLING_2_5_TURBO || modelNorm === KLING_2_6;

  // ✅ Kling O3 se comporta como “V3 family” en UI (Elements + Multishot)
  const isKlingO3 = modelNorm === KLING_O3_PRO;
  const isKlingV3 = modelNorm === KLING_V3 || isKlingO3;

  const isVeoFamily = modelNorm.startsWith("veo-");
  const veoIsFast = modelNorm === VEO_3_FAST || modelNorm === VEO_3_1_FAST;
  const veoSpeedLabel = isVeoFamily ? (veoIsFast ? "Fast" : "Quality") : "";

  const toggleVeoSpeed = () => {
    if (!isVeoFamily) return;

    if (model === VEO_3) return setModel(VEO_3_FAST);
    if (model === VEO_3_FAST) return setModel(VEO_3);

    if (model === VEO_3_1) return setModel(VEO_3_1_FAST);
    if (model === VEO_3_1_FAST) return setModel(VEO_3_1);
  };

  const toggleKlingMode = () => setKlingMode((m) => (m === "std" ? "pro" : "std"));

  const toggleSound = () => {
    setKlingSound((v) => !v);
    setKlingSoundTouched(true);
  };


  const handler = useMemo(() => getVideoModelHandler(modelNorm), [modelNorm]);

  const capability = useMemo(
    () => handler.getCapability({ modelNorm, hasFirst, hasLast, resolution, klingMode }),
    [handler, modelNorm, hasFirst, hasLast, resolution, klingMode]
  );

  const allowedDurations = useMemo(() => capability.durations, [capability.durations]);

  const supportedResolutions = useMemo(
    () => handler.getSupportedResolutions({ modelNorm }),
    [handler, modelNorm]
  );

  useEffect(() => {
    const next = coerceResolutionForModel(modelNorm, capability, resolution);
    if (next !== resolution) setResolution(next);
  }, [modelNorm, capability, resolution]);

  useEffect(() => {
    const next = coerceAspectRatioForModel(modelNorm, capability, hasFirst, resolution, aspectRatio);
    if (next !== aspectRatio) setAspectRatio(next);
  }, [modelNorm, capability, hasFirst, resolution, aspectRatio]);

  // 1) Regla Kling: si estás en STD y tenías sound ON, lo apagamos
  useEffect(() => {
  if (!isKlingV2) return;

  if (klingMode === "std" && klingSound) {
    setKlingSound(false);
    setKlingSoundTouched(true);
  }
}, [isKlingV2, klingMode, klingSound]);

  // 2) Regla Veo: si hay LAST frame y estabas en Veo 3.0, forzar Veo 3.1
  useEffect(() => {
    const next = coerceModelForLastFrame(modelNorm, hasLast);
    if (next !== modelNorm) setModel(next);
  }, [modelNorm, hasLast]);

  // Si cambia allowedDurations, ajusta duration si no es válido
  useEffect(() => {
    if (!allowedDurations.includes(durationSeconds)) {
      setDurationSeconds(allowedDurations[0] || 8);
    }
  }, [allowedDurations, durationSeconds]);

  // Si quitas el first frame, también se limpia el last (tu regla)
  useEffect(() => {
    if (!hasFirst && hasLast) {
      setLastFrame(null);
    }
  }, [hasFirst, hasLast]);

  // Cargar assets (imágenes para picker + videos para historial)
  useEffect(() => {
    if (!user?.id) return;

    // 1) Cargar settings (solo una vez por login)
    try {
      const raw = localStorage.getItem(settingsKey(user.id));
      const parsed = safeParseJson(raw);

      if (parsed?.v === 1) {
        const s = parsed as VideoToolSettingsV1;

        setPrompt(typeof s.prompt === "string" ? s.prompt : "");
        setModel(typeof s.model === "string" && s.model.trim() ? s.model : DEFAULT_VIDEO_MODEL);

        setAspectRatio(coerceAr(s.aspectRatio));
        setResolution(coerceRes(s.resolution));

        setDurationSeconds(Number.isFinite(Number(s.durationSeconds)) ? Math.trunc(Number(s.durationSeconds)) : 8);
        setCount(clampInt(s.count, 1, 4, 1));

        setKlingMode(coerceStdPro(s.klingMode));
        setKlingSound(Boolean(s.klingSound));
        setKlingSoundTouched(Boolean(s.klingSoundTouched));

        setNegativePrompt(typeof s.negativePrompt === "string" ? s.negativePrompt : "");
        const cfg = Number(s.klingCfgScale);
        setKlingCfgScale(Number.isFinite(cfg) ? Math.max(0, Math.min(1, cfg)) : 0.5);
        setKlingVoiceIdsText(typeof s.klingVoiceIdsText === "string" ? s.klingVoiceIdsText : "");
        setSelectedKlingElementIds(Array.isArray(s.selectedKlingElementIds) ? s.selectedKlingElementIds.filter(Boolean) : []);

        setMultishotEnabled(Boolean(s.multishotEnabled));
        setKlingShotType(coerceShotType(s.klingShotType));
        setKlingShots(coerceShots(s.klingShots));

        // Frames se aplican después de cargar imageAssets
        pendingFrameIdsRef.current = {
          firstId: typeof s.firstFrameId === "string" ? s.firstFrameId : null,
          lastId: typeof s.lastFrameId === "string" ? s.lastFrameId : null,
        };
      }
    } catch {
      // si falla localStorage, no pasa nada
    } finally {
      settingsLoadedRef.current = true;
    }

    // 2) Cargar assets y aplicar frames guardados
    (async () => {
      const imgs = await reloadImages();
      await reloadHistory();

      const { firstId, lastId } = pendingFrameIdsRef.current;

      if (firstId) {
        const f = (imgs || []).find((a) => a?.id === firstId) || null;
        setFirstFrame(f);
        if (f && lastId) {
          const l = (imgs || []).find((a) => a?.id === lastId) || null;
          setLastFrame(l);
        }
      }
    })();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    setPendingFalJob(loadPendingFalJob());
  }, [user?.id]);

  useEffect(() => {
    if (!pickerOpen) return;
    reloadImages();
  }, [pickerOpen]);

  // Cerrar popover al click afuera
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!panel) return;
      const el = popoverRef.current;
      if (el && !el.contains(e.target as any)) {
        setPanel(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panel]);

  useEffect(() => {
    if (!user?.id) return;
    if (!settingsLoadedRef.current) return;

    const payload: VideoToolSettingsV1 = {
      v: 1,

      prompt,
      model,

      aspectRatio,
      resolution,
      durationSeconds,
      count,

      firstFrameId: firstFrame?.id ?? null,
      lastFrameId: lastFrame?.id ?? null,

      klingMode,
      klingSound,
      klingSoundTouched,

      negativePrompt,
      klingCfgScale,
      klingVoiceIdsText,
      selectedKlingElementIds,

      multishotEnabled,
      klingShotType,
      klingShots,
    };

    const t = setTimeout(() => {
      try {
        localStorage.setItem(settingsKey(user.id), JSON.stringify(payload));
      } catch {
        // si no se puede guardar, no pasa nada
      }
    }, 250);

    return () => clearTimeout(t);
  }, [
    user?.id,
    prompt,
    model,
    aspectRatio,
    resolution,
    durationSeconds,
    count,
    firstFrame?.id,
    lastFrame?.id,
    klingMode,
    klingSound,
    klingSoundTouched,
    negativePrompt,
    klingCfgScale,
    klingVoiceIdsText,
    selectedKlingElementIds,
    multishotEnabled,
    klingShotType,
    klingShots,
  ]);

  const refreshKlingElements = useCallback(async () => {
    try {
      const items = await listKlingElements();
      setKlingElements(items || []);
    } catch (e: any) {
      setError(e?.message || "No pude cargar tus Elements.");
    }
  }, []);

  useEffect(() => {
    if (!isKlingV3) return;
    if (!elementsOpen) return;
    refreshKlingElements();
  }, [isKlingV3, elementsOpen, refreshKlingElements]);

  useEffect(() => {
  if (!isKlingV3) return;
  if (!elementsOpen) return;
  // Refresca imágenes para el selector del creador de Elements
  reloadImages();
}, [isKlingV3, elementsOpen]);

  const modelLabel = useMemo(() => prettyVideoModelLabel(modelNorm), [modelNorm]);

  const paramsLabel = useMemo(() => {
    const ar = capability.supportsAspectRatio ? aspectRatio : "Auto";
    const resLabel = capability.supportsResolution ? resolution : "Auto";
    return `${ar} • ${resLabel} • x${count}`;
  }, [aspectRatio, capability.supportsAspectRatio, capability.supportsResolution, count, resolution]);

  

  const multishotValidShots = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return [];
  return klingShots
    .map((s) => ({
      prompt: (s.prompt || "").trim(),
      durationSeconds: clampInt(s.durationSeconds, 3, 15, 3),
    }))
    .filter((s) => s.prompt.length > 0);
}, [isKlingV3, multishotEnabled, klingShots]);

const multishotTotalSeconds = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return 0;
  return multishotValidShots.reduce((acc, s) => acc + s.durationSeconds, 0);
}, [isKlingV3, multishotEnabled, multishotValidShots]);

const multishotHasOverLimitPrompt = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return false;
  return klingShots.some((s) => (s.prompt || "").length > KLING_V3_SHOT_PROMPT_LIMIT);
}, [isKlingV3, multishotEnabled, klingShots]);

const multishotIsReady = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return true;
  if (multishotValidShots.length < 2) return false;
  if (multishotHasOverLimitPrompt) return false;
  return multishotTotalSeconds >= 3 && multishotTotalSeconds <= 15;
}, [isKlingV3, multishotEnabled, multishotValidShots.length, multishotTotalSeconds, multishotHasOverLimitPrompt]);

const durationLabel = useMemo(() => {
  if (isKlingV3 && multishotEnabled) {
    return `${multishotTotalSeconds || 0}s (multishot)`;
  }
  return `${durationSeconds}s`;
}, [durationSeconds, isKlingV3, multishotEnabled, multishotTotalSeconds]);


  const openPicker = (slot: FrameSlotKey) => {
    if (slot === "last" && !hasFirst) return; // bloquea last si no hay first
    setPanel(null);
    setPickerSlot(slot);
    setPickerQuery("");
    setPickerVisibleCount(PICKER_INITIAL_COUNT);
    setPickerOpen(true);
  };

  const setFrameFromAsset = (slot: FrameSlotKey, asset: Asset) => {
    if (slot === "first") {
      setFirstFrame(asset);
    } else {
      if (!hasFirst) return;
      setLastFrame(asset);
    }
    setPickerOpen(false);
  };

  const clearFrame = (slot: FrameSlotKey) => {
    if (slot === "first") {
      setFirstFrame(null);
      setLastFrame(null); // regla: al limpiar first se limpia last
    } else {
      setLastFrame(null);
    }
  };

  const swapFrames = () => {
    // Solo si hay ambas (para respetar tu regla de bloqueo)
    if (!firstFrame || !lastFrame) return;
    const a = firstFrame;
    const b = lastFrame;
    setFirstFrame(b);
    setLastFrame(a);
  };

  const handleUploadForSlot = async (slot: FrameSlotKey, file: File) => {
    try {
      const asset = await uploadUserAsset(file, FRAME_UPLOAD_TOOL);
      // Añádelo al historial de imágenes (para que aparezca inmediatamente)
      setImageAssets((prev) => [asset, ...prev]);
      setFrameFromAsset(slot, asset);
    } catch (e: any) {
      setError(formatErr(e));
    }
  };

  const filteredPickerAssetsAll = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const base = [...imageAssets]
      .filter(
        (a) =>
          !!getAssetUrl(a) &&
          (a.type === "image" ||
            String((a as any).mime || (a as any).contentType || (a as any).mimeType || "").startsWith("image/"))
      )
      .sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

    if (!q) return base;
    return base.filter((a) => {
      const t = `${a.name || ""} ${a.prompt || ""}`.toLowerCase();
      return t.includes(q);
    });
  }, [imageAssets, pickerQuery]);

  // Si el usuario busca (o reabre el modal), reiniciamos a 12 para que no se “acumule” la lista.
  useEffect(() => {
    if (!pickerOpen) return;
    setPickerVisibleCount(PICKER_INITIAL_COUNT);
  }, [pickerQuery, pickerOpen]);

  const visiblePickerAssets = useMemo(
    () => filteredPickerAssetsAll.slice(0, Math.min(pickerVisibleCount, filteredPickerAssetsAll.length)),
    [filteredPickerAssetsAll, pickerVisibleCount]
  );
  const hasMorePicker = pickerVisibleCount < filteredPickerAssetsAll.length;

  const handleLoadMorePicker = () => {
    setPickerVisibleCount((c) => Math.min(c + PICKER_LOAD_MORE_COUNT, filteredPickerAssetsAll.length));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setProgressText("Preparando…");

    try {
      const handler = getVideoModelHandler(modelNorm);

      const plan = handler.buildPlan({
        model: modelNorm,
        prompt,
        tool: TOOL_ID,
        nameHint: "video",

        count,
        durationSeconds,
        aspectRatio,
        resolution,

        firstFrameAssetId: firstFrame?.id || null,
        lastFrameAssetId: lastFrame?.id || null,

        klingMode,
        klingSound,
        klingSoundTouched,

        selectedKlingElementIds,
        multishotEnabled,
        klingShots,
        klingShotType,

        negativePrompt,
        klingCfgScale,
        klingVoiceIdsText,
      });

      // crea placeholders en historial
      const stamp = Date.now();
      setPendingSlots(Array.from({ length: plan.pendingSlotsCount }, (_, i) => `pending-${stamp}-${i}`));

      const res = await handler.submit(plan, {
        signal: ac.signal,
        onProgress: (msg) => setProgressText(msg),
      });

      if (!("ok" in res) || (res as any).ok !== true) {
        throw new Error("Respuesta inválida del backend.");
      }

      const items = Array.isArray((res as any).items) ? (res as any).items : [];
      if (!items.length) throw new Error("No se devolvió ningún video.");

      const firstId = items[0]?.assetId ? String(items[0].assetId) : null;

      const refreshed = await reloadHistory();
      const justMade = firstId ? refreshed.find((a) => a.id === firstId) : null;

      setViewer(justMade || refreshed[0] || null);
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.isCanceled || String(e?.message || "").toLowerCase().includes("cancel")) {
        // Cancelado por el usuario: no mostramos modal de error
      } else {
        setError(formatErr(e));
      }
    } finally {
      abortRef.current = null;
      setProgressText(null);
      setIsGenerating(false);
      setPendingSlots([]);
    }
  };

  const handleCancel = () => {
      abortRef.current?.abort();
    };

    const handleDiscardPending = () => {
    clearPendingFalJob();
    setPendingFalJob(null);
  };

  const handleResumePending = async () => {
    if (!pendingFalJob) return;

    setIsGenerating(true);
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;
    setProgressText("Reanudando…");
    setPendingSlots(["pending-resume"]);

    try {
      const res = await resumeFalFinalize(pendingFalJob, {
        signal: ac.signal,
        onProgress: (msg) => setProgressText(msg),
        maxWaitMs: 15 * 60 * 1000,
      });

      // Si salió bien: limpiar y refrescar historial
      clearPendingFalJob();
      setPendingFalJob(null);

      await reloadHistory();
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.isCanceled) {
        // cancelado: no error modal
      } else {
        // si falló la reanudación, normalmente el job ya murió → limpiamos para evitar loop
        clearPendingFalJob();
        setPendingFalJob(null);
        setError(formatErr(e));
      }
    } finally {
      abortRef.current = null;
      setProgressText(null);
      setIsGenerating(false);
      setPendingSlots([]);
    }
  };

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

    return {
      modelId,
      aspectRatio: aspect || "—",
      resolution: resolutionSaved || "—",
      durationSeconds: dur,
      first,
      last,
      klingMode: typeof meta.klingMode === "string" ? meta.klingMode : null,
      klingSound: typeof meta.klingSound === "boolean" ? meta.klingSound : null,
      klingShotType: typeof meta.klingShotType === "string" ? meta.klingShotType : null,
    };
  }, [viewer, imageAssets])

  const effectiveElementsShotIndex = multishotEnabled ? (elementsShotIndex ?? 0) : null;

  const modalSelectedIds = multishotEnabled
    ? (klingShots[effectiveElementsShotIndex ?? 0]?.elementIds ?? [])
    : selectedKlingElementIds;

  const setModalSelectedIds: React.Dispatch<React.SetStateAction<string[]>> = (next) => {
    if (multishotEnabled) {
      const idx = effectiveElementsShotIndex ?? 0;
      setKlingShots((prev) =>
        prev.map((s, i) => {
          if (i !== idx) return s;
          const current = s.elementIds ?? [];
          const value = typeof next === "function" ? (next as any)(current) : next;
          return { ...s, elementIds: value };
        })
      );
    } else {
      setSelectedKlingElementIds(next);
    }
  };

  const clearModalSelectedIds = () => {
    if (multishotEnabled) {
      const idx = effectiveElementsShotIndex ?? 0;
      setKlingShots((prev) => prev.map((s, i) => (i === idx ? { ...s, elementIds: [] } : s)));
    } else {
      setSelectedKlingElementIds([]);
    }
  };

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onMouseMove={handleRootMouseMove}
      onMouseLeave={handleRootMouseLeave}
    >
      <ErrorModal error={error} onClose={() => setError(null)} />

      <HistorySection
        isLoading={isLoadingHistory}
        pendingSlots={pendingSlots}
        totalCount={videoAssets.length}
        visibleHistory={visibleHistory}
        hasMore={hasMoreHistory}
        isLoadingMore={isLoadingMoreHistory}
        onRefresh={reloadHistory}
        onLoadMore={handleLoadMoreHistory}
        onOpenViewer={(a) => setViewer(a)}
        onTogglePublish={handleTogglePublish}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onShowError={(msg) => setError(msg)}
        hoverVideoEls={hoverVideoEls}
      />

      {/* DOCK (prompt bar estilo Image Tool) */}
      <div className={styles.dockWrap}>
        <div className={styles.dock}>
          <FrameStrip
            firstFrame={firstFrame}
            lastFrame={lastFrame}
            hasFirst={hasFirst}
            openPicker={openPicker}
            clearFrame={clearFrame}
            swapFrames={swapFrames}
          />

          <div className={styles.promptRow}>
            <div className={styles.promptInputWrap}>
              <div className={styles.promptEditor}>
                {(selectedKlingElementIds.length > 0 || (isKlingV3 && multishotEnabled)) && (
                  <div className={styles.promptTags}>
                    {selectedKlingElementIds.length > 0 && (
                      <button
                        type="button"
                        className={styles.promptTag}
                        onClick={() => setSelectedKlingElementIds([])}
                        title="Click para limpiar Elements"
                      >
                        Elements: {selectedKlingElementIds.length}
                        <span className={styles.promptTagRemove}>×</span>
                      </button>
                    )}

                    {isKlingV3 && multishotEnabled && (
                      <button
                        type="button"
                        className={styles.promptTag}
                        onClick={() => setMultishotEnabled(false)}
                        title="Click para apagar Multishot"
                      >
                        Multishot: {multishotTotalSeconds}s
                        <span className={styles.promptTagRemove}>×</span>
                      </button>
                    )}
                  </div>
                )}

                {isKlingV3 && multishotEnabled ? (
                  <div className={styles.multishotInline}>
                    <div className={styles.multishotTop}>
                      <div className={styles.multishotTitle}>
                        <Icon name="multishot" />
                        Shots ({klingShots.length}/10)
                      </div>

                      <div className={styles.multishotTopActions}>
                        <button
                          type="button"
                          className={styles.multishotAddBtn}
                          onClick={() =>
                            setKlingShots((prev) =>
                              prev.length >= 10 ? prev : [...prev, { prompt: "", durationSeconds: 3, elementIds: [] }]
                            )
                          }
                          title="Agregar un shot"
                        >
                          + Shot
                        </button>

                        <button
                          type="button"
                          className={styles.multishotExpandBtn}
                          onClick={() => setMultishotOpen(true)}
                          title="Abrir editor en pantalla completa"
                        >
                          <Icon name="sliders" />
                        </button>
                      </div>
                    </div>

                    <div className={styles.multishotMeta}>
                      Total: {multishotTotalSeconds}s · mínimo 2 shots · suma entre 3s y 15s · Shot type:{" "}
                      {isKlingO3 ? "customize (O3 fijo)" : hasFirst ? "customize (bloqueado por FIRST)" : klingShotType}
                    </div>

                    {!isKlingO3 && !hasFirst && klingShotType === "intelligent" && (
                      <div className={styles.multishotHint}>
                        Modo intelligent: escribe prompts más generales por shot; el modelo conecta transiciones automáticamente.
                      </div>
                    )}

                    <div className={styles.multishotShots}>
                      {klingShots.map((s, i) => (
                        <div key={i} className={styles.multishotShotRow}>
                          <div className={styles.multishotShotHeader}>
                            <div className={styles.multishotShotName}>Shot {i + 1}</div>

                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <button
                                type="button"
                                className={styles.multishotElementsBtn}
                                onClick={() => openElementsForShot(i)}
                                title="Seleccionar Elements para este shot"
                              >
                                Elements {Array.isArray(s.elementIds) && s.elementIds.length ? `(${s.elementIds.length})` : ""}
                              </button>

                              <button
                                type="button"
                                className={styles.multishotRemoveBtn}
                                onClick={() => setKlingShots((prev) => prev.filter((_, idx) => idx !== i))}
                                disabled={klingShots.length <= 1}
                                title={klingShots.length <= 1 ? "Debe existir al menos 1 shot" : "Eliminar shot"}
                              >
                                <Icon name="trash" />
                              </button>
                            </div>
                          </div>

                          <LimitedTextarea
                            surfaceClassName={styles.multishotTextarea}
                            rows={2}
                            value={s.prompt}
                            onChange={(next) =>
                              setKlingShots((prev) =>
                                prev.map((x, idx) => (idx === i ? { ...x, prompt: next } : x))
                              )
                            }
                            placeholder={
                              klingShotType === "intelligent"
                                ? "Describe este shot… (idea principal; el modelo conecta transiciones automáticamente)"
                                : "Describe este shot… (acción, cámara, estilo, iluminación)"
                            }
                            limit={KLING_V3_SHOT_PROMPT_LIMIT}
                            inputResize="none"
                          />

                          <div className={styles.multishotCharRow}>
                            <span className={s.prompt.length > KLING_V3_SHOT_PROMPT_LIMIT ? styles.multishotCharOver : undefined}>
                              {s.prompt.length}/{KLING_V3_SHOT_PROMPT_LIMIT}
                              {s.prompt.length > KLING_V3_SHOT_PROMPT_LIMIT
                                ? ` (+${s.prompt.length - KLING_V3_SHOT_PROMPT_LIMIT})`
                                : ""}
                            </span>
                          </div>

                          <div className={styles.multishotDurationRow}>
                            <span className={styles.multishotDurationLabel}>
                              <Icon name="clock" />
                              Duration
                            </span>
                            <input
                              className={styles.multishotDurationInput}
                              type="number"
                              min={3}
                              max={15}
                              value={s.durationSeconds}
                              onChange={(e) =>
                                setKlingShots((prev) =>
                                  prev.map((x, idx) =>
                                    idx === i ? { ...x, durationSeconds: Number(e.target.value) } : x
                                  )
                                )
                              }
                            />
                            <span className={styles.multishotDurationUnit}>s</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {!multishotIsReady && (
                      <div className={styles.multishotWarn}>
                        Para generar: mínimo 2 shots, suma total entre 3s y 15s, y cada shot ≤ 512 caracteres (el exceso se ve en rojo).
                      </div>
                    )}
                  </div>
                ) : (
                  <textarea
                    className={styles.prompt}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe el video… (ej: cinematic neon city, rain, slow dolly in, high detail)"
                    rows={2}
                  />
                )}
              </div>
            </div>

            <div className={styles.generateCol}>
              <button
                type="button"
                className={styles.generateBtn}
                disabled={isGenerating || (isKlingV3 && multishotEnabled ? !multishotIsReady : !prompt.trim())}
                onClick={handleGenerate}
                data-loading={isGenerating ? "true" : "false"}
              >
                <span className={styles.generateLabel}>{isGenerating ? "GENERATING" : "GENERATE"}</span>
                {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
              </button>

              {isGenerating && (
                <button type="button" className={styles.cancelBtn} onClick={handleCancel}>
                  CANCEL
                </button>
              )}

              {isGenerating && progressText && (
                <div className={styles.progressText}>{progressText}</div>
              )}
            </div>
          </div>

        {!isGenerating && pendingFalJob && (
          <div className={styles.resumeBanner}>
            <div className={styles.resumeTitle}>GENERACIÓN PENDIENTE DETECTADA</div>
            <div className={styles.resumeDesc}>
              Parece que quedó una generación de Kling V3 en progreso. Puedes reanudarla o descartarla.
            </div>
            <div className={styles.resumeActions}>
              <button type="button" className={styles.resumeBtn} onClick={handleResumePending}>
                REANUDAR
              </button>
              <button type="button" className={styles.discardBtn} onClick={handleDiscardPending}>
                DESCARTAR
              </button>
            </div>
          </div>
        )} 

        {/* Controls */}
        <div className={styles.controlsArea}>
          <ControlsRow
            panel={panel}
            setPanel={setPanel}
            modelLabel={modelLabel}
            paramsLabel={paramsLabel}
            durationLabel={durationLabel}
            isVeoFamily={isVeoFamily}
            veoSpeedLabel={veoSpeedLabel}
            toggleVeoSpeed={toggleVeoSpeed}
            isKlingV2={isKlingV2}
            klingMode={klingMode}
            toggleKlingMode={toggleKlingMode}
            supportsSound={capability.supportsSound}
            klingSound={klingSound}
            toggleSound={toggleSound}
            isKlingV3={isKlingV3}
            selectedKlingElementCount={selectedKlingElementIds.length}
            openElements={() => openElementsForShot(multishotEnabled ? 0 : null)}
            multishotEnabled={multishotEnabled}
            setMultishotEnabled={setMultishotEnabled}
            multishotTotalSeconds={multishotTotalSeconds}
          />

          <ControlsPopover
            panel={panel}
            setPanel={setPanel}
            popoverRef={popoverRef}
            model={model}
            setModel={setModel}
            veoIsFast={veoIsFast}
            capability={capability}
            hasFirst={hasFirst}
            aspectRatio={aspectRatio}
            setAspectRatio={setAspectRatio}
            supportedResolutions={supportedResolutions}
            resolution={resolution}
            setResolution={setResolution}
            count={count}
            setCount={setCount}
            isKling={isKling}
            isKlingV3={isKlingV3}
            klingMode={klingMode}
            setKlingMode={setKlingMode}
            klingSound={klingSound}
            setKlingSound={setKlingSound}
            setKlingSoundTouched={setKlingSoundTouched}
            klingShotType={klingShotType}
            setKlingShotType={setKlingShotType}
            negativePrompt={negativePrompt}
            setNegativePrompt={setNegativePrompt}
            klingCfgScale={klingCfgScale}
            setKlingCfgScale={setKlingCfgScale}
            klingVoiceIdsText={klingVoiceIdsText}
            setKlingVoiceIdsText={setKlingVoiceIdsText}
            multishotEnabled={multishotEnabled}
            multishotTotalSeconds={multishotTotalSeconds}
            setMultishotOpen={setMultishotOpen}
            allowedDurations={allowedDurations}
            durationSeconds={durationSeconds}
            setDurationSeconds={setDurationSeconds}
          />

                </div>
            </div>
         </div>

      <ViewerModal
        viewer={viewer}
        viewerRecipeInfo={viewerRecipeInfo}
        onClose={() => setViewer(null)}
        onCopyPrompt={(a) => copyToClipboard(a.prompt || "")}
        onReusePrompt={(a) => reusePromptFromAsset(a)}
        onTogglePublish={(a) => handleTogglePublish(a)}
        onDownload={(a) => handleDownload(a)}
        onDelete={(a) => handleDelete(a)}
      />

      <FramePickerModal
        open={pickerOpen}
        slot={pickerSlot}
        query={pickerQuery}
        setQuery={setPickerQuery}
        isLoading={isLoadingImages}
        visibleAssets={visiblePickerAssets}
        totalCount={filteredPickerAssetsAll.length}
        hasMore={hasMorePicker}
        onLoadMore={handleLoadMorePicker}
        onClose={() => setPickerOpen(false)}
        onPick={(a) => setFrameFromAsset(pickerSlot, a)}
        onUpload={(file) => handleUploadForSlot(pickerSlot, file)}
        hasFirst={hasFirst}
        getAssetUrl={getAssetUrl}
      />

      <MultishotModal
        open={multishotOpen}
        onClose={() => setMultishotOpen(false)}
        shots={klingShots}
        setShots={setKlingShots}
        shotType={klingShotType}
        setShotType={setKlingShotType}
        totalSeconds={multishotTotalSeconds}
      />

      <KlingElementsModal
        open={elementsOpen}
        onClose={() => {
          setElementsOpen(false);
          setElementsShotIndex(null);
        }}
        elements={klingElements}
        query={elementsQuery}
        setQuery={setElementsQuery}
        selectedIds={modalSelectedIds}
        setSelectedIds={setModalSelectedIds}
        onClear={clearModalSelectedIds}
        imageAssets={imageAssets}
        getAssetUrl={getAssetUrl}
        onRefresh={refreshKlingElements}
      />
    </div>
  );
};

export default VideoGeneratorTool;
