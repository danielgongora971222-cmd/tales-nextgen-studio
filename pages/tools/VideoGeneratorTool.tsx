import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import ErrorModal from "../../components/ErrorModal";
import { deleteAsset, listMyAssets, publishAsset, unpublishAsset, uploadUserAsset } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../services/supabaseClient";
import type { Asset } from "../../types";
import { listKlingElements, type KlingElement } from "../../services/klingElementsService";


type PanelKey = "frames" | "model" | "parameters" | "duration" | null;

type FrameSlotKey = "first" | "last";

type VideoGenItem = { url: string; assetId: string };

type VideoGenResponse =
  | { ok: true; items: VideoGenItem[]; urlExpiresInSeconds?: number }
  | { ok: false; error: any };

type KlingV3Shot = { prompt: string; durationSeconds: number };

const TOOL_ID = "video-generator";
const FRAME_UPLOAD_TOOL = "video-gen-frame";

const VEO_3 = "veo-3.0-generate-001";
const VEO_3_FAST = "veo-3.0-fast-generate-001";
const VEO_3_1 = "veo-3.1-generate-preview";
const VEO_3_1_FAST = "veo-3.1-fast-generate-preview";
const KLING_2_5_TURBO = "kling-v2-5-turbo";
const KLING_2_6 = "kling-v2-6";
const KLING_V3 = "kling-v3";

function Icon({ name }: { name: "heart" | "share" | "download" | "trash" | "close" | "copy" | "reuse" }) {
  switch (name) {
    case "heart":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 21s-7.2-4.35-9.6-8.55C.6 9.6 2.4 6.6 5.55 6.05c1.7-.3 3.35.3 4.45 1.55 1.1-1.25 2.75-1.85 4.45-1.55 3.15.55 4.95 3.55 3.15 6.4C19.2 16.65 12 21 12 21z"
          />
        </svg>
      );
    case "share":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a2.5 2.5 0 0 0 0-1.39l7.02-4.11A2.99 2.99 0 1 0 14 5a2.9 2.9 0 0 0 .04.49L7.02 9.6a3 3 0 1 0 0 4.8l7.02 4.11c-.03.16-.04.33-.04.49a3 3 0 1 0 3-2.92z"
          />
        </svg>
      );
    case "download":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M5 20h14v-2H5v2zM11 4h2v8h3l-4 4-4-4h3V4z" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z"
          />
        </svg>
      );
    case "close":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 0 0-1.41 1.41L10.59 12l-4.9 4.89a1 1 0 0 0 1.41 1.41L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.41L13.41 12l4.9-4.89a1 1 0 0 0-.01-1.4z"
          />
        </svg>
      );
    case "copy":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 18H8V7h11v16z"
          />
        </svg>
      );
    case "reuse":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5 0 .91-.24 1.76-.65 2.5l1.46 1.46A7.93 7.93 0 0 0 20 12c0-2.21-.9-4.21-2.35-5.65zM6.35 17.65A7.95 7.95 0 0 0 12 20v3l5-5-5-5v3c-2.76 0-5-2.24-5-5 0-.91.24-1.76.65-2.5L6.19 7.04A7.93 7.93 0 0 0 4 12c0 2.21.9 4.21 2.35 5.65z"
          />
        </svg>
      );
    default:
      return null;
  }
}

function getStatus(err: any): number | null {
  return typeof err?.status === "number"
    ? err.status
    : typeof err?.response?.status === "number"
      ? err.response.status
      : null;
}
function getErrMsg(err: any): string {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    (typeof err === "string" ? err : "Failed to generate video.")
  );
}
function formatErr(err: any): string {
  const s = getStatus(err);
  const m = getErrMsg(err);
  return s ? `${m} (HTTP ${s})` : m;
}

async function apiPostJson<T>(path: string, body: any): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // A veces un 502 viene como HTML (gateway) y resp.json() falla.
  // Leemos texto y luego intentamos parsear JSON.
  const rawText = await resp.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!resp.ok || data?.ok === false) {
    const e =
      data?.error ??
      data ??
      { message: rawText ? rawText.slice(0, 600) : `Request failed: ${resp.status}` };
    const msg =
      typeof e === "string"
        ? e
        : e?.message || e?.error || `Request failed: ${resp.status}`;
    const details = e?.details ? `\n\nDetalles:\n${JSON.stringify(e.details, null, 2)}` : "";
    throw new Error(`${e?.code ? `${e.code}: ` : ""}${msg}${details}`);
  }

  return data as T;
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function shortText(s?: string, max = 60) {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFalJob(jobToken: string, maxWaitMs = 15 * 60 * 1000) {
  const t0 = Date.now();
  while (true) {
    const st = await apiPostJson<any>("/api/ai/video/fal/status", { jobToken });
    const status = st?.status;

    if (status === "COMPLETED") return;
    if (status === "FAILED") throw new Error(st?.error || "Fal job FAILED");
    if (Date.now() - t0 > maxWaitMs) throw new Error("Timeout esperando Kling V3 (Fal).");

    await delay(1500);
  }
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

  // placeholders mientras se genera (tiles “GENERATING” como en Image Tool)
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);

  // refs para reproducir preview en hover
  const hoverVideoEls = useRef<Record<string, HTMLVideoElement | null>>({});

  const [error, setError] = useState<string | null>(null);

  // Core
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>(VEO_3_1);
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

  const visibleHistory = useMemo(
    () => videoAssets.slice(0, Math.min(historyVisibleCount, videoAssets.length)),
    [videoAssets, historyVisibleCount]
  );
  const hasMoreHistory = historyVisibleCount < videoAssets.length;

  // Picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<FrameSlotKey>("first");
  const [pickerQuery, setPickerQuery] = useState("");

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

  function prettyVideoModelLabel(modelId: string | null) {
    if (!modelId) return "—";
    if (modelId === VEO_3) return "Veo 3";
    if (modelId === VEO_3_FAST) return "Veo 3 Fast";
    if (modelId === VEO_3_1) return "Veo 3.1";
    if (modelId === VEO_3_1_FAST) return "Veo 3.1 Fast";
    if (modelId === KLING_2_5_TURBO) return "Kling 2.5 Turbo";
    if (modelId === KLING_2_6) return "Kling 2.6";
    if (modelId === KLING_V3) return "Kling V3";
    return modelId;
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

  const isVeo30 = model.startsWith("veo-3.0");
  const isVeo31 = model.startsWith("veo-3.1");
  const isKling = model.startsWith("kling-");
  const isKlingV2 = model === KLING_2_5_TURBO || model === KLING_2_6;
  const isKlingV3 = model === KLING_V3;




  const capability = useMemo(() => {
    if (model === KLING_2_5_TURBO || model === KLING_2_6) {
      return {
        supportsResolution: false,
        supportsAspectRatio: !hasFirst,
        supportsAspectRatio1x1: !hasFirst,
        durations: [5, 10] as const,
        supportsSound: model === KLING_2_6 && klingMode === "pro",
        supportsLastFrame: true,
      };
    }

    if (model === KLING_V3) {
      return {
        supportsResolution: false,
        supportsAspectRatio: !hasFirst,
        supportsAspectRatio1x1: !hasFirst,
        durations: [3,4,5,6,7,8,9,10,11,12,13,14,15] as const,
        supportsSound: true,       // en v3 pro es nativo
        supportsLastFrame: true,   // usaremos end_image_url luego
      };
    }

    const durations = (() => {
      // Veo 3 / Veo 3 Fast: en Gemini API es 8s fijo
      if (isVeo30) return [8] as const;

      // Veo 3.1: 8s obligatorio si 1080p/4k o si usas imágenes (first/last)
      if (hasFirst || hasLast) return [8] as const;
      if (resolution === "720p") return [4, 6, 8] as const;
      return [8] as const;
    })();

    return {
      supportsResolution: true,
      supportsAspectRatio: !hasFirst,
      supportsAspectRatio1x1: false,
      durations,
      supportsSound: false,
      supportsLastFrame: true,
    };
  }, [hasFirst, hasLast, isVeo30, model, resolution, klingMode]);

  // Allowed durations logic (según tu regla)
  const allowedDurations = useMemo(() => capability.durations, [capability.durations]);

  const supportedResolutions = useMemo(() => {
    if (!capability.supportsResolution) return ["720p"] as const;
    return isVeo30 ? (["720p", "1080p"] as const) : (["720p", "1080p", "4k"] as const);
  }, [capability.supportsResolution, isVeo30]);

  useEffect(() => {
    if (!capability.supportsResolution && resolution !== "720p") {
      setResolution("720p");
      return;
    }
    if (isVeo30 && resolution === "4k") setResolution("1080p");
  }, [capability.supportsResolution, isVeo30, resolution]);

  useEffect(() => {
    if (isVeo30 && !hasFirst && resolution === "1080p" && aspectRatio === "9:16") {
      setAspectRatio("16:9");
    }
  }, [isVeo30, hasFirst, resolution, aspectRatio]);

  useEffect(() => {
    if (!capability.supportsAspectRatio1x1 && aspectRatio === "1:1") {
      setAspectRatio("16:9");
    }
  }, [aspectRatio, capability.supportsAspectRatio1x1]);

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
    if (!hasLast) return;
    if (!isVeo30) return;

    const wantsFast = model.includes("-fast-");
    setModel(wantsFast ? VEO_3_1_FAST : VEO_3_1);
  }, [hasLast, isVeo30, model]);

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
    (async () => {
      try {
        const imgs = await listMyAssets({ type: "image", limit: 250 });
        setImageAssets(imgs);
      } catch (e: any) {
        console.warn(e);
      }

      await reloadHistory();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const modelLabel = useMemo(() => {
    if (model === VEO_3) return "Veo 3";
    if (model === VEO_3_FAST) return "Veo 3 Fast";
    if (model === VEO_3_1) return "Veo 3.1";
    if (model === VEO_3_1_FAST) return "Veo 3.1 Fast";
    if (model === KLING_2_5_TURBO) return "Kling 2.5 Turbo";
    if (model === KLING_2_6) return "Kling 2.6";
    if (model === KLING_V3) return "Kling V3";
    return model;
  }, [model]);

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

  const filteredPickerAssets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const base = imageAssets.filter((a) => a.type === "image" && a.url);
    if (!q) return base;
    return base.filter((a) => {
      const t = `${a.name || ""} ${a.prompt || ""}`.toLowerCase();
      return t.includes(q);
    });
  }, [imageAssets, pickerQuery]);

  const handleGenerate = async () => {
    const allowEmptyPrompt = isKlingV3 && multishotEnabled;
    if (!allowEmptyPrompt && !prompt.trim()) return;

    setIsGenerating(true);
    setError(null);

    const modelNorm = String(model || "").trim().replace(/^models\//i, "");

        // crea "slots" temporales en el historial (uno por video a generar)
    {
      const n =
        modelNorm === KLING_V3
          ? 1
          : Math.max(1, Math.min(4, Number(count) || 1));

      const stamp = Date.now();
      setPendingSlots(Array.from({ length: n }, (_, i) => `pending-${stamp}-${i}`));
    }

    try {
      // Si es Kling V3 + Multishot: usamos el primer shot válido como prompt fallback (por schema min(1))
      const effectivePrompt =
        modelNorm === KLING_V3 && multishotEnabled
          ? (multishotValidShots[0]?.prompt || "multishot")
          : prompt;

      const effectiveDurationSeconds =
        modelNorm === KLING_V3 && multishotEnabled
          ? Number(multishotTotalSeconds || 5)
          : Number(durationSeconds);

      const body: any = {
        prompt: effectivePrompt,
        model: modelNorm,
        tool: TOOL_ID,
        nameHint: "video",
        count: modelNorm === KLING_V3 ? 1 : clampInt(count, 1, 4, 1),
        durationSeconds: effectiveDurationSeconds,
      };

      if (capability.supportsResolution) {
        body.resolution = resolution;
      }

      if (firstFrame?.id) body.firstFrameAssetId = firstFrame.id;
      if (lastFrame?.id) body.lastFrameAssetId = lastFrame.id;

      // si NO hay first frame, se permite escoger aspect ratio
      if (!firstFrame && capability.supportsAspectRatio) body.aspectRatio = aspectRatio;

      // Kling v2.* directo
      if (isKling && modelNorm !== "kling-v3") {
        body.klingMode = klingMode;
      }

      // Kling 2.6: solo enviamos si el usuario tocó el toggle
      if (isKling && modelNorm === KLING_2_6 && klingSoundTouched) {
        body.klingSound = klingSound;
      }

      // Kling V3 (Fal): enviamos SIEMPRE audio + extras
      if (modelNorm === "kling-v3") {
        // Audio nativo (Fal: generate_audio)
        body.klingSound = klingSound;

        // Elements (requiere FIRST)
        if (selectedKlingElementIds.length > 0) {
          if (!firstFrame?.id) {
            throw new Error("Kling V3: Para usar Elements debes cargar FIRST frame.");
          }
          body.klingElementIds = selectedKlingElementIds.slice(0, 5);
        }

        // Multishot
        if (multishotEnabled) {
          if (!multishotIsReady) {
            throw new Error("Multishot: necesitas 2+ shots con prompt y la suma de duración 3–15s.");
          }

          body.klingMultiPrompt = multishotValidShots;

          // shot_type solo importa en text-to-video (sin FIRST)
          if (!firstFrame?.id) body.klingShotType = klingShotType;
        }

        // Params extra V3
        if (negativePrompt.trim()) body.negativePrompt = negativePrompt.trim();
        if (Number.isFinite(Number(klingCfgScale))) body.klingCfgScale = Number(klingCfgScale);

        const voiceIds = klingVoiceIdsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 2);
        if (voiceIds.length) body.klingVoiceIds = voiceIds;
      }

      let res: any;

      if (modelNorm === KLING_V3) {
        const submit = await apiPostJson<any>("/api/ai/video", { ...body, async: true });

        if (submit?.mode === "async" && submit?.jobToken) {
          const jobToken = String(submit.jobToken);

          await waitFalJob(jobToken);

          // Finalize: aquí es donde bajas el video de Fal y lo guardas en Supabase Storage
          res = await apiPostJson<VideoGenResponse>("/api/ai/video/fal/finalize", {
            jobToken,
            prompt: effectivePrompt,
          });
        } else {
          // fallback por si el backend responde sync
          res = submit;
        }
      } else {
        res = await apiPostJson<VideoGenResponse>("/api/ai/video", body);
      }

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

            <div className={styles.stage}>
        <div className={styles.historyHeader}>
          <div className={styles.historyTitle}>
            <span className={styles.kicker}>VIDEO GENERATOR</span>
            <div className={styles.historyMeta}>
              {isLoadingHistory ? (
                <span className={styles.subKicker}>Loading history...</span>
              ) : (
                <>
                  <span className={styles.subKicker}>History</span>
                  <span className={styles.historyCount}>{videoAssets.length}</span>
                </>
              )}
            </div>
          </div>

          <button className={styles.ghostBtn} onClick={reloadHistory} type="button" disabled={isLoadingHistory}>
            Refresh
          </button>
        </div>

        <div className={styles.historyGrid}>
          {isLoadingHistory ? (
            <div className={styles.historyLoading}>Cargando historial…</div>
          ) : videoAssets.length === 0 && pendingSlots.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyAnimator}>
                <div className={styles.emptyGrid} />
                <div className={styles.emptyGlow} />
                <div className={styles.emptyScan} />
                <div className={styles.emptyOrb} />
              </div>
              <div className={styles.emptyCopy}>
                <div className={styles.emptyCode}>NO GENERATIONS</div>
                <div className={styles.emptyText}>Genera tu primer video para ver el historial aquí.</div>
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
                const caption = (asset.prompt || asset.name || "—").trim();
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={styles.tile}
                    onClick={() => setViewer(asset)}
                    title="Click para ver detalles"
                    onMouseEnter={() => {
                      const el = hoverVideoEls.current[asset.id];
                      if (el) {
                        el.currentTime = 0;
                        el.play().catch(() => {});
                      }
                    }}
                    onMouseLeave={() => {
                      const el = hoverVideoEls.current[asset.id];
                      if (el) {
                        el.pause();
                        el.currentTime = 0;
                      }
                    }}
                  >
                    <video
                      ref={(el) => {
                        hoverVideoEls.current[asset.id] = el;
                      }}
                      className={styles.tileVideo}
                      src={asset.url}
                      muted
                      playsInline
                      preload="metadata"
                    />

                    <div className={styles.tileMeta}>
                      <span className={styles.tileCaption}>{caption}</span>
                      {asset.isPublic && <span className={styles.publicTag}>PUBLIC</span>}
                    </div>

                    <div className={styles.tileActions} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        title="Favoritos (próximamente)"
                        onClick={() => setError("Favoritos (Like) se habilita en el paso de Mis Creaciones / Favoritos.")}
                      >
                        <Icon name="heart" />
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

          {hasMoreHistory && (
            <div className={styles.historyLoadMoreWrap}>
              <button
                type="button"
                className={styles.loadMoreBtn}
                onClick={handleLoadMoreHistory}
                disabled={isLoadingMoreHistory}
              >
                {isLoadingMoreHistory ? "Cargando..." : "Cargar más"}
              </button>
              <div className={styles.loadMoreHint}>
                Mostrando {visibleHistory.length} de {videoAssets.length}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DOCK (prompt bar estilo Image Tool) */}
      <div className={styles.dockWrap}>
        <div className={styles.dock}>
          <div className={styles.refThumbStrip}>
            {/* FIRST */}
            <div
              className={styles.refMini}
              title="FIRST frame"
              role="button"
              tabIndex={0}
              onClick={() => openPicker("first")}
              onKeyDown={(e) => e.key === "Enter" && openPicker("first")}
            >
              {firstFrame ? <img src={firstFrame.url} alt="FIRST" /> : <div className={styles.refMiniEmpty}>FIRST</div>}
              <span className={styles.refMiniIcon}>FIRST</span>
              {firstFrame && (
                <button
                  type="button"
                  className={styles.refMiniRemove}
                  aria-label="Remove FIRST"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFirstFrame(null);
                    setLastFrame(null);
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {/* LAST */}
            <div
              className={`${styles.refMini} ${!hasFirst ? styles.refMiniLocked : ""}`}
              title={!hasFirst ? "LAST bloqueado: primero carga FIRST" : "LAST frame"}
              role="button"
              tabIndex={0}
              onClick={() => openPicker("last")}
              onKeyDown={(e) => e.key === "Enter" && openPicker("last")}
            >
              {lastFrame ? <img src={lastFrame.url} alt="LAST" /> : <div className={styles.refMiniEmpty}>LAST</div>}
              <span className={styles.refMiniIcon}>LAST</span>
              {lastFrame && (
                <button
                  type="button"
                  className={styles.refMiniRemove}
                  aria-label="Remove LAST"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLastFrame(null);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

                    <div className={styles.promptRow}>
            <div className={styles.promptInputWrap}>
              {isKlingV3 && (
                <div className={styles.klingDock}>
                  {/* Elements */}
                  <button
                    type="button"
                    className={styles.klingElementBtn}
                    onClick={() => setElementsOpen(true)}
                    disabled={!firstFrame?.id}
                    title={!firstFrame?.id ? "Para usar Elements primero carga FIRST frame" : "Seleccionar Elements"}
                    aria-label="Elements"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2.24-8 5v2h16v-2c0-2.76-3.6-5-8-5z"
                      />
                    </svg>

                    {selectedKlingElementIds.length > 0 && (
                      <span className={styles.klingBadge}>{selectedKlingElementIds.length}</span>
                    )}
                  </button>

                  {/* Multishot toggle */}
                  <button
                    type="button"
                    className={`${styles.klingElementBtn} ${multishotEnabled ? styles.klingElementBtnActive : ""}`}
                    onClick={() => setMultishotEnabled((v) => !v)}
                    title="Activar/Desactivar Multishot"
                    aria-label="Multishot"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm2 2v8h12V8H6zm14 1h2v6h-2V9z"
                      />
                    </svg>
                  </button>

                  {/* Edit multishot */}
                  <button
                    type="button"
                    className={styles.klingElementBtn}
                    onClick={() => setMultishotOpen(true)}
                    disabled={!multishotEnabled}
                    title={!multishotEnabled ? "Activa Multishot para editar shots" : "Editar shots"}
                    aria-label="Edit multishot"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M10 18h4v-2h-4v2zm-7 0h4v-2H3v2zM17 18h4v-2h-4v2zM10 13h4V6h-4v7zM3 13h4V9H3v4zm14 0h4V4h-4v9z"
                      />
                    </svg>
                  </button>
                </div>
              )}

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

                <textarea
                  className={styles.prompt}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe el video… (ej: cinematic neon city, rain, slow dolly in, high detail)"
                  rows={2}
                />
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
              className={`${styles.controlBtn} ${panel === "parameters" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "parameters" ? null : "parameters"))}
            >
              <span>Parameters</span>
              <span className={styles.controlBtnMeta}>{paramsLabel}</span>
            </button>

            <button
              type="button"
              className={`${styles.controlBtn} ${panel === "duration" ? styles.controlBtnActive : ""}`}
              onClick={() => setPanel((p) => (p === "duration" ? null : "duration"))}
            >
              <span>Duration</span>
              <span className={styles.controlBtnMeta}>{durationLabel}</span>
            </button>
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
                                className={`${styles.modelOption} ${model === VEO_3 ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(VEO_3);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Veo 3</div>
                                <div className={styles.modelDesc}>Calidad alta · 8s fijo</div>
                              </button>

                              <button
                                type="button"
                                className={`${styles.modelOption} ${model === VEO_3_FAST ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(VEO_3_FAST);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Veo 3 Fast</div>
                                <div className={styles.modelDesc}>Más rápido · 8s fijo</div>
                              </button>

                              <button
                                type="button"
                                className={`${styles.modelOption} ${model === VEO_3_1 ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(VEO_3_1);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Veo 3.1</div>
                                <div className={styles.modelDesc}>4/6/8s (según resolución y frames)</div>
                              </button>

                              <button
                                type="button"
                                className={`${styles.modelOption} ${model === VEO_3_1_FAST ? styles.modelOptionActive : ""}`}
                                onClick={() => {
                                  setModel(VEO_3_1_FAST);
                                  setPanel(null);
                                }}
                              >
                                <div className={styles.modelName}>Veo 3.1 Fast</div>
                                <div className={styles.modelDesc}>Más rápido · mismo set de reglas</div>
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

      {/* VIEWER (receta estilo Image Tool) */}
      {viewer && (
        <div className={styles.viewerBackdrop} onClick={() => setViewer(null)}>
          <div className={styles.viewer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.viewerTop}>
              <div className={styles.viewerTitle}>
                <span className={styles.viewerKicker}>GENERATION</span>
                <span className={styles.viewerSub}>{viewer.isPublic ? "PUBLIC" : "PRIVATE"}</span>
              </div>

              <div className={styles.viewerTopActions}>
                <button className={styles.iconBtn} type="button" title="Copiar prompt" onClick={() => copyToClipboard(viewer.prompt || "")}>
                  <Icon name="copy" />
                </button>

                <button className={styles.iconBtn} type="button" title="Reusar prompt" onClick={() => reusePromptFromAsset(viewer)}>
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
              <div className={styles.viewerVideoWrap}>
                <video className={styles.viewerVideo} src={viewer.url} controls autoPlay loop playsInline />
              </div>

              <div className={styles.viewerRecipe}>
                <div className={styles.viewerRecipeTitle}>RECIPE</div>

                <div className={styles.recipeGrid}>
                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Model</div>
                    <div className={styles.recipeValue}>{prettyVideoModelLabel(viewerRecipeInfo?.modelId || null)}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Aspect</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.aspectRatio || "—"}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Resolution</div>
                    <div className={styles.recipeValue}>{viewerRecipeInfo?.resolution || "—"}</div>
                  </div>

                  <div className={styles.recipeItem}>
                    <div className={styles.recipeLabel}>Duration</div>
                    <div className={styles.recipeValue}>
                      {viewerRecipeInfo?.durationSeconds != null ? `${viewerRecipeInfo.durationSeconds}s` : "—"}
                    </div>
                  </div>

                  {(viewerRecipeInfo?.klingMode || viewerRecipeInfo?.klingShotType) && (
                    <div className={styles.recipeItemWide}>
                      <div className={styles.recipeLabel}>Kling</div>
                      <div className={styles.recipeValue}>
                        {viewerRecipeInfo.klingMode ? `mode: ${viewerRecipeInfo.klingMode}` : ""}
                        {viewerRecipeInfo.klingShotType ? ` • shot: ${viewerRecipeInfo.klingShotType}` : ""}
                        {viewerRecipeInfo.klingSound != null ? ` • sound: ${viewerRecipeInfo.klingSound ? "on" : "off"}` : ""}
                      </div>
                    </div>
                  )}
                </div>

                <div className={styles.recipeRefs}>
                  <div className={styles.recipeLabel}>Frames</div>
                  <div className={styles.recipeRefStrip}>
                    {viewerRecipeInfo?.first ? (
                      <div className={styles.recipeRefThumb} title="FIRST">
                        <img src={viewerRecipeInfo.first.url} alt="FIRST" />
                        <span className={styles.recipeRefTag}>FIRST</span>
                      </div>
                    ) : (
                      <div className={styles.recipeEmpty}>No FIRST</div>
                    )}

                    {viewerRecipeInfo?.last ? (
                      <div className={styles.recipeRefThumb} title="LAST">
                        <img src={viewerRecipeInfo.last.url} alt="LAST" />
                        <span className={styles.recipeRefTag}>LAST</span>
                      </div>
                    ) : null}
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

      {/* Picker modal */}
      {pickerOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                Pick {pickerSlot === "first" ? "FIRST" : "LAST"} Frame
              </div>
              <button className={styles.modalClose} onClick={() => setPickerOpen(false)} type="button">
                ×
              </button>
            </div>

            <div className={styles.modalActions}>
              <input
                className={styles.search}
                placeholder="Search in history..."
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
              />

              <label className={styles.uploadBtn}>
                Upload
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadForSlot(pickerSlot, f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <div className={styles.pickerGrid}>
              {filteredPickerAssets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={styles.pickerTile}
                  onClick={() => setFrameFromAsset(pickerSlot, a)}
                >
                  <img src={a.url} alt={a.name} />
                  <div className={styles.pickerCap}>
                    {shortText(a.prompt || a.name, 56)}
                  </div>
                </button>
              ))}
            </div>

            {pickerSlot === "last" && !hasFirst && (
              <div className={styles.modalNote}>
                LAST está bloqueado: primero carga FIRST.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Multishot modal (Kling V3) */}
      {multishotOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Multishot</div>
              <button className={styles.modalClose} onClick={() => setMultishotOpen(false)} type="button">
                ×
              </button>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() =>
                  setKlingShots((prev) =>
                    prev.length >= 10 ? prev : [...prev, { prompt: "", durationSeconds: 3 }]
                  )
                }
              >
                + Add shot
              </button>

              <div className={styles.segmentMeta}>
                Total: {multishotTotalSeconds}s (cada shot 3–15s · max 10)
              </div>
            </div>

            <div className={styles.modalActions}>
              <label className={styles.formLabel} style={{ width: 110 }}>Shot type</label>
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
                  disabled={!!firstFrame?.id} // i2v: solo customize
                >
                  intelligent
                </button>
                <div className={styles.segmentMeta}>
                  {firstFrame?.id ? "Con FIRST frame solo permite customize" : "Text-only permite intelligent"}
                </div>
              </div>
            </div>

            <div className={styles.shotsList}>
              {klingShots.map((s, i) => (
                <div key={i} className={styles.shotRow}>
                  <div className={styles.shotHeader}>
                    <div className={styles.shotTitle}>Shot {i + 1}</div>
                    <button
                      type="button"
                      className={styles.swapBtn}
                      onClick={() => setKlingShots((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={klingShots.length <= 1}
                    >
                      Remove
                    </button>
                  </div>

                  <textarea
                    className={styles.textarea}
                    rows={2}
                    value={s.prompt}
                    onChange={(e) =>
                      setKlingShots((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, prompt: e.target.value } : x))
                      )
                    }
                    placeholder="Prompt de este shot..."
                  />

                  <div className={styles.formRow}>
                    <label className={styles.formLabel}>Duration</label>
                    <input
                      className={styles.input}
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
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.modalNote}>
              Si Multishot está ON, el backend enviará `multi_prompt` y usará la suma de durations.
            </div>
          </div>
        </div>
      )}

      {/* Elements modal (Kling V3) */}
      {elementsOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Kling Elements</div>
              <button className={styles.modalClose} onClick={() => setElementsOpen(false)} type="button">
                ×
              </button>
            </div>

            <div className={styles.modalActions}>
              <input
                className={styles.search}
                placeholder="Search elements..."
                value={elementsQuery}
                onChange={(e) => setElementsQuery(e.target.value)}
              />
              <button
                type="button"
                className={styles.swapBtn}
                onClick={() => setSelectedKlingElementIds([])}
              >
                Clear
              </button>
            </div>

            <div className={styles.pickerGrid}>
              {klingElements
                .filter((el) => {
                  const q = elementsQuery.trim().toLowerCase();
                  if (!q) return true;
                  const t = `${el.elementName} ${el.elementDescription}`.toLowerCase();
                  return t.includes(q);
                })
                .map((el) => {
                  const selected = selectedKlingElementIds.includes(el.id);
                  const thumbAsset =
                    imageAssets.find((a) => a.id === el.frontalAssetId) || null;

                  return (
                    <button
                      key={el.id}
                      type="button"
                      className={`${styles.pickerTile} ${selected ? styles.pickerTileActive : ""}`}
                      onClick={() => {
                        setSelectedKlingElementIds((prev) => {
                          const has = prev.includes(el.id);
                          if (has) return prev.filter((x) => x !== el.id);
                          if (prev.length >= 5) return prev; // max 5
                          return [...prev, el.id];
                        });
                      }}
                    >
                      <img
                        src={thumbAsset?.url || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="}
                        alt={el.elementName}
                      />
                      <div className={styles.pickerCap}>
                        {el.elementName}
                        {selected ? " ✓" : ""}
                      </div>
                    </button>
                  );
                })}
            </div>

            {!firstFrame?.id && (
              <div className={styles.modalNote}>
                Para usar Elements en Kling V3 primero debes cargar FIRST frame.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoGeneratorTool;
