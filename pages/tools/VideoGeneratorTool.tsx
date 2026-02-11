import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import ErrorModal from "../../components/ErrorModal";
import { deleteAsset, listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import type { Asset } from "../../types";
import { listKlingElements, type KlingElement } from "../../services/klingElementsService";
import { formatErr } from "../../services/videoGenApi";
import { FramePickerModal } from "./video/FramePickerModal";
import { MultishotModal } from "./video/multishotmodal";
import { KlingElementsModal } from "./video/KlingElementsModal";
import { HistorySection } from "./video/HistorySection";
import { FrameStrip } from "./video/FrameStrip";


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

type KlingV3Shot = { prompt: string; durationSeconds: number };

const TOOL_ID = "video-generator";
const FRAME_UPLOAD_TOOL = "video-gen-frame";


const VideoGeneratorTool: React.FC = () => {

    const { user } = useAuth();

  // Historial: mostramos 12 al inicio y cargamos de a 9 con botón "Cargar más"
  const HISTORY_INITIAL_COUNT = 12;
  const HISTORY_LOAD_MORE_COUNT = 9;

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_INITIAL_COUNT);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [viewer, setViewer] = useState<Asset | null>(null);

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
  const [elementsQuery, setElementsQuery] = useState("");
  const [selectedKlingElementIds, setSelectedKlingElementIds] = useState<string[]>([]);

  const [multishotEnabled, setMultishotEnabled] = useState(false);
  const [multishotOpen, setMultishotOpen] = useState(false);
  const [klingShots, setKlingShots] = useState<KlingV3Shot[]>([
    { prompt: "", durationSeconds: 3 },
    { prompt: "", durationSeconds: 3 },
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
  const isKlingV3 = modelNorm === KLING_V3;

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

    (async () => {
      await reloadImages();
      await reloadHistory();
    })();
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
    if (!isKlingV3) return;
    if (!elementsOpen) return;

    (async () => {
      try {
        const items = await listKlingElements();
        setKlingElements(items || []);
      } catch (e: any) {
        setError(e?.message || "No pude cargar tus Elements.");
      }
    })();
  }, [isKlingV3, elementsOpen]);

  useEffect(() => {
    if (!isKlingV3) return;
    if (firstFrame?.id) return;

    // Si quitas FIRST, dejamos elements en 0 para evitar errores
    if (selectedKlingElementIds.length > 0) {
      setSelectedKlingElementIds([]);
    }
  }, [isKlingV3, firstFrame?.id, selectedKlingElementIds.length]);

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

const multishotIsReady = useMemo(() => {
  if (!isKlingV3 || !multishotEnabled) return true;
  if (multishotValidShots.length < 2) return false;
  return multishotTotalSeconds >= 3 && multishotTotalSeconds <= 15;
}, [isKlingV3, multishotEnabled, multishotValidShots.length, multishotTotalSeconds]);

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

      const res = await handler.submit(plan);

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
      setError(formatErr(e));
    } finally {
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
                              prev.length >= 10 ? prev : [...prev, { prompt: "", durationSeconds: 3 }]
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
                      Total: {multishotTotalSeconds}s · mínimo 2 shots · suma entre 3s y 15s
                    </div>

                    <div className={styles.multishotShots}>
                      {klingShots.map((s, i) => (
                        <div key={i} className={styles.multishotShotRow}>
                          <div className={styles.multishotShotHeader}>
                            <div className={styles.multishotShotName}>Shot {i + 1}</div>
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

                          <textarea
                            className={styles.multishotTextarea}
                            rows={2}
                            value={s.prompt}
                            onChange={(e) =>
                              setKlingShots((prev) =>
                                prev.map((x, idx) => (idx === i ? { ...x, prompt: e.target.value } : x))
                              )
                            }
                            placeholder="Describe este shot… (acción, cámara, estilo, iluminación)"
                          />

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
                        Para generar: mínimo 2 shots y la suma total entre 3s y 15s.
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
            </div>
          </div>


          {/* Controls row (igual a tu lógica actual) */}
        <div className={styles.controlsArea}></div>
          <div className={styles.controlsRow}>
            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "model" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
            >
              <span className={styles.controlBtnLeft}>
                <Icon name="model" />
                <span>Model</span>
              </span>
              <span className={styles.controlBtnMeta}>{modelLabel}</span>
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "parameters" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "parameters" ? null : "parameters"))}
            >
              <span className={styles.controlBtnLeft}>
                <Icon name="sliders" />
                <span>Parameters</span>
              </span>
              <span className={styles.controlBtnMeta}>{paramsLabel}</span>
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "duration" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "duration" ? null : "duration"))}
            >
              <span className={styles.controlBtnLeft}>
                <Icon name="clock" />
                <span>Duration</span>
              </span>
              <span className={styles.controlBtnMeta}>{durationLabel}</span>
            </button>

            {/* Veo: Fast / Quality */}
            {isVeoFamily && (
              <button
                type="button"
                className={styles.controlBtn}
                onClick={() => {
                  setPanel(null);
                  toggleVeoSpeed();
                }}
                title="Cambiar entre Fast y Quality"
              >
                <span className={styles.controlBtnLeft}>
                  <Icon name="speed" />
                  <span>Veo</span>
                </span>
                <span className={styles.controlBtnMeta}>{veoSpeedLabel}</span>
              </button>
            )}

            {/* Kling 2.x: Standard / Pro */}
            {isKlingV2 && (
              <button
                type="button"
                className={styles.controlBtn}
                onClick={() => {
                  setPanel(null);
                  toggleKlingMode();
                }}
                title="Cambiar entre Standard y Pro"
              >
                <span className={styles.controlBtnLeft}>
                  <Icon name="mode" />
                  <span>Kling</span>
                </span>
                <span className={styles.controlBtnMeta}>{klingMode === "std" ? "Standard" : "Pro"}</span>
              </button>
            )}

            {/* Sound ON/OFF (cuando el modelo lo soporta) */}
            {capability.supportsSound && (
              <button
                type="button"
                className={`${styles.controlBtn} ${klingSound ? styles.controlBtnActive : ""}`}
                onClick={() => {
                  setPanel(null);
                  toggleSound();
                }}
                title="Activar/Desactivar sonido"
              >
                <span className={styles.controlBtnLeft}>
                  <Icon name="sound" />
                  <span>Sound</span>
                </span>
                <span className={styles.controlBtnMeta}>{klingSound ? "On" : "Off"}</span>
              </button>
            )}

            {/* Kling V3: Elements + Multishot */}
            {isKlingV3 && (
              <>
                <button
                  type="button"
                  className={styles.controlBtn}
                  onClick={() => {
                    setPanel(null);
                    setElementsOpen(true);
                  }}
                  disabled={!firstFrame?.id}
                  title={!firstFrame?.id ? "Para usar Elements primero carga FIRST frame" : "Seleccionar Elements"}
                >
                  <span className={styles.controlBtnLeft}>
                    <Icon name="elements" />
                    <span>Elements</span>
                  </span>
                  <span className={styles.controlBtnMeta}>
                    {!firstFrame?.id
                      ? "Need FIRST"
                      : selectedKlingElementIds.length
                        ? `${selectedKlingElementIds.length} sel`
                        : "Optional"}
                  </span>
                </button>

                <button
                  type="button"
                  className={`${styles.controlBtn} ${multishotEnabled ? styles.controlBtnActive : ""}`}
                  onClick={() => {
                    setPanel(null);
                    setMultishotEnabled((v) => !v);
                  }}
                  title="Activar/Desactivar Multishot"
                >
                  <span className={styles.controlBtnLeft}>
                    <Icon name="multishot" />
                    <span>Multishot</span>
                  </span>
                  <span className={styles.controlBtnMeta}>
                    {multishotEnabled ? `${multishotTotalSeconds}s` : "Off"}
                  </span>
                </button>
              </>
            )}
          </div>

          {/* POPOVERS: aquí NO cambiamos tu contenido, solo el botón close si quieres estética igual */}
                    {panel && (
                      <div ref={popoverRef} className={styles.popover}>
                        <div className={styles.popoverInner}>
                          <div className={styles.popoverHeader}>
                            <div className={styles.popoverTitle}>
                              {panel === "model" ? "Model" : panel === "parameters" ? "Parameters" : "Duration"}
                            </div>
                            <button className={styles.closeBtn} onClick={() => setPanel(null)} type="button" title="Cerrar">
                              <Icon name="close" />
                            </button>
                          </div>

                          {/* MODEL */}
                          {panel === "model" && (
                            <div className={styles.modelGrid}>
                              <button
                                type="button"
                                className={`${styles.modelOption} ${(model === VEO_3 || model === VEO_3_FAST) ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(veoIsFast ? VEO_3_FAST : VEO_3);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Veo 3</div>
                                <div className={styles.modelDesc}>8s fijo · velocidad en "Veo: Quality/Fast"</div>
                              </button>

                              <button
                                type="button"
                                className={`${styles.modelOption} ${(model === VEO_3_1 || model === VEO_3_1_FAST) ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(veoIsFast ? VEO_3_1_FAST : VEO_3_1);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Veo 3.1</div>
                                <div className={styles.modelDesc}>4/6/8s (según resolución y frames) · velocidad en "Veo: Quality/Fast"</div>
                              </button>

                              <button
                                type="button"
                                className={`${styles.modelOption} ${model === KLING_2_5_TURBO ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(KLING_2_5_TURBO);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Kling 2.5 Turbo</div>
                                <div className={styles.modelDesc}>5/10s · soporta first/last</div>
                              </button>

                              <button
                                type="button"
                                className={`${styles.modelOption} ${model === KLING_2_6 ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(KLING_2_6);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Kling 2.6</div>
                                <div className={styles.modelDesc}>Mejorado · audio solo en PRO</div>
                              </button>

                              <button
                                type="button"
                                className={`${styles.modelOption} ${model === KLING_V3 ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(KLING_V3);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Kling V3</div>
                                <div className={styles.modelDesc}>Elements + Multishot · 3–15s</div>
                              </button>
                            </div>
                          )}

                          {/* PARAMETERS */}
                          {panel === "parameters" && (
                            <>
                              <div className={styles.formRow}>
                                <label className={styles.formLabel}>Aspect ratio</label>

                                {capability.supportsAspectRatio ? (
                                  <div className={styles.segment}>
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${aspectRatio === "16:9" ? styles.segmentBtnActive : ""}`}
                                      onClick={() => setAspectRatio("16:9")}
                                    >
                                      16:9
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${aspectRatio === "9:16" ? styles.segmentBtnActive : ""}`}
                                      onClick={() => setAspectRatio("9:16")}
                                    >
                                      9:16
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${aspectRatio === "1:1" ? styles.segmentBtnActive : ""} ${
                                        capability.supportsAspectRatio1x1 ? "" : styles.segmentBtnDisabled
                                      }`}
                                      onClick={() => capability.supportsAspectRatio1x1 && setAspectRatio("1:1")}
                                      disabled={!capability.supportsAspectRatio1x1}
                                      title={!capability.supportsAspectRatio1x1 ? "No disponible para este modelo/estado" : "1:1"}
                                    >
                                      1:1
                                    </button>
                                    {!capability.supportsAspectRatio && <span className={styles.segmentMeta}>Auto</span>}
                                    {hasFirst && <span className={styles.segmentMeta}>Bloqueado por FIRST</span>}
                                  </div>
                                ) : (
                                  <div className={styles.noteSmall}>Auto (se bloquea si usas FIRST frame)</div>
                                )}
                              </div>

                              <div className={styles.formRow}>
                                <label className={styles.formLabel}>Resolution</label>

                                {capability.supportsResolution ? (
                                  <div className={styles.segment}>
                                    {supportedResolutions.map((r) => (
                                      <button
                                        key={r}
                                        type="button"
                                        className={`${styles.segmentBtn} ${resolution === r ? styles.segmentBtnActive : ""}`}
                                        onClick={() => setResolution(r)}
                                      >
                                        {r}
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <div className={styles.noteSmall}>Auto / Fixed (según el modelo)</div>
                                )}
                              </div>

                              <div className={styles.formRow}>
                                <label className={styles.formLabel}>Count</label>
                                <div className={styles.segment}>
                                  {[1, 2, 3, 4].map((n) => (
                                    <button
                                      key={n}
                                      type="button"
                                      className={`${styles.segmentBtn} ${count === n ? styles.segmentBtnActive : ""} ${
                                        isKlingV3 ? styles.segmentBtnDisabled : ""
                                      }`}
                                      onClick={() => !isKlingV3 && setCount(n)}
                                      disabled={isKlingV3}
                                      title={isKlingV3 ? "Kling V3 genera 1 video por vez" : `Generar x${n}`}
                                    >
                                      x{n}
                                    </button>
                                  ))}
                                  {isKlingV3 && <span className={styles.segmentMeta}>Kling V3: x1</span>}
                                </div>
                              </div>

                              {isKling && (
                                <div className={styles.formRow}>
                                  <label className={styles.formLabel}>Kling mode</label>
                                  <div className={styles.segment}>
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${klingMode === "std" ? styles.segmentBtnActive : ""}`}
                                      onClick={() => setKlingMode("std")}
                                    >
                                      STD
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${klingMode === "pro" ? styles.segmentBtnActive : ""}`}
                                      onClick={() => setKlingMode("pro")}
                                    >
                                      PRO
                                    </button>
                                    <span className={styles.segmentMeta}>{model === KLING_2_6 ? "2.6: audio solo PRO" : "STD/PRO"}</span>
                                  </div>
                                </div>
                              )}

                              {capability.supportsSound && (
                                <div className={styles.formRow}>
                                  <label className={styles.formLabel}>Sound</label>
                                  <div className={styles.segment}>
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${!klingSound ? styles.segmentBtnActive : ""}`}
                                      onClick={() => {
                                        setKlingSound(false);
                                        setKlingSoundTouched(true);
                                      }}
                                    >
                                      OFF
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${klingSound ? styles.segmentBtnActive : ""}`}
                                      onClick={() => {
                                        setKlingSound(true);
                                        setKlingSoundTouched(true);
                                      }}
                                    >
                                      ON
                                    </button>
                                    <span className={styles.segmentMeta}>Disponible en este modo</span>
                                  </div>
                                </div>
                              )}

                              {isKlingV3 && (
                                <>
                                  <div className={styles.formRow}>
                                    <label className={styles.formLabel}>Shot type</label>
                                    <div className={styles.segment}>
                                      <button
                                        type="button"
                                        className={`${styles.segmentBtn} ${klingShotType === "customize" ? styles.segmentBtnActive : ""}`}
                                        onClick={() => setKlingShotType("customize")}
                                      >
                                        customize
                                      </button>
                                      <button
                                        type="button"
                                        className={`${styles.segmentBtn} ${klingShotType === "intelligent" ? styles.segmentBtnActive : ""}`}
                                        onClick={() => setKlingShotType("intelligent")}
                                      >
                                        intelligent
                                      </button>
                                    </div>
                                  </div>

                                  <div className={styles.formRow}>
                                    <label className={styles.formLabel}>Negative prompt</label>
                                    <textarea
                                      className={styles.textarea}
                                      rows={2}
                                      value={negativePrompt}
                                      onChange={(e) => setNegativePrompt(e.target.value)}
                                      placeholder="Evitar: blur, low quality, artifacts..."
                                    />
                                  </div>

                                  <div className={styles.formRow}>
                                    <label className={styles.formLabel}>CFG scale</label>
                                    <input
                                      className={styles.input}
                                      type="number"
                                      min={0}
                                      max={1}
                                      step={0.05}
                                      value={klingCfgScale}
                                      onChange={(e) => setKlingCfgScale(Number(e.target.value))}
                                    />
                                    <div className={styles.noteSmall}>Rango típico 0.0–1.0</div>
                                  </div>

                                  <div className={styles.formRow}>
                                    <label className={styles.formLabel}>Voice IDs (opcional)</label>
                                    <input
                                      className={styles.input}
                                      value={klingVoiceIdsText}
                                      onChange={(e) => setKlingVoiceIdsText(e.target.value)}
                                      placeholder="Ej: voice_1, voice_2"
                                    />
                                  </div>
                                </>
                              )}
                            </>
                          )}

                          {/* DURATION */}
                          {panel === "duration" && (
                            <>
                              {isKlingV3 && multishotEnabled ? (
                                <div className={styles.note}>
                                  La duración la controla <b>Multishot</b>.
                                  <div className={styles.noteSmall}>
                                    Total actual: {multishotTotalSeconds}s · Debe quedar entre 3s y 15s
                                  </div>

                                  <div className={styles.formRow}>
                                    <button type="button" className={styles.segmentBtn} onClick={() => setMultishotOpen(true)}>
                                      Editar Multishot
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className={styles.durationGrid}>
                                    {allowedDurations.map((d) => (
                                      <button
                                        key={d}
                                        type="button"
                                        className={`${styles.durationOption} ${durationSeconds === d ? styles.durationOptionActive : ""}`}
                                        onClick={() => setDurationSeconds(d)}
                                      >
                                        {d}s
                                      </button>
                                    ))}
                                  </div>

                                  <div className={styles.noteSmall}>
                                    Las opciones dependen del modelo (y en Veo 3.1 también de resolución/frames).
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
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
        onClose={() => setElementsOpen(false)}
        elements={klingElements}
        query={elementsQuery}
        setQuery={setElementsQuery}
        selectedIds={selectedKlingElementIds}
        setSelectedIds={setSelectedKlingElementIds}
        onClear={() => setSelectedKlingElementIds([])}
        imageAssets={imageAssets}
        hasFirstFrame={!!firstFrame?.id}
        getAssetUrl={getAssetUrl}
      />

    </div>
  );
};

export default VideoGeneratorTool;
