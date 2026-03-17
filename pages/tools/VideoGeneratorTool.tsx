import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import ErrorModal from "../../components/ErrorModal";
import { MentionTextarea, type MentionItem } from "../../components/MentionTextarea";
import { deleteAsset, listMyAssets, uploadUserAsset, downloadAssetToDisk } from "../../services/assetsApi";
import { useAuth } from "../../contexts/AuthContext";
import type { Asset } from "../../types";
import {
  listKlingElements,
  listKlingPresetElements,
  refreshKlingElementsStatus,
  isKlingElementReadyForVideoGenerator,
  type KlingElement,
} from "../../services/klingElementsService";
import { formatErr } from "../../services/videoGenApi";
import { useGenerationQueue } from "../../contexts/GenerationQueueContext";
import { FramePickerModal } from "./video/FramePickerModal";
import { LimitedTextarea, KLING_V3_SHOT_PROMPT_LIMIT } from "./video/LimitedTextarea";
import { KlingElementsModal } from "./video/KlingElementsModal";
import { HistorySection } from "./video/HistorySection";
import { ControlsPopover } from "./video/ControlsPopover";
import type { KlingShotType } from "../../services/videoModels/types";
import { estimateVideoCostCredits } from "../../config/pricing.js";
import { toggleLike } from "../../services/socialApi";
import { syncFavoriteAssetState } from "../../services/favoriteAssets";
import { clearCommunityRecipePrefill, getCommunityPrefillTarget, readCommunityRecipePrefill } from "../../services/communityRecipePrefill";

import {
  DEFAULT_VIDEO_MODEL,
  getVideoModelHandler,
  normalizeModelId,
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

// Kling Elements habilitados para Kling 3.0 y Kling O3
const VIDEO_ELEMENTS_UI_ENABLED = true;

type PanelKey = "frames" | "model" | "parameters" | "duration" | null;

type FrameSlotKey = "first" | "last";

type VideoGenItem = { url: string; assetId: string };

type VideoGenResponse =
  | { ok: true; items: VideoGenItem[]; urlExpiresInSeconds?: number }
  | { ok: false; error: any };

type KlingV3Shot = { prompt: string; durationSeconds: number; elementIds?: string[] };

function slugifyName(s: string) {
  return (
    (s || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 28) || "element"
  );
}

function makeElementTag(name: string) {
  return `@${slugifyName(name || "element")}`;
}

function buildElementTokenMap(elements: KlingElement[]) {
  const reserved = new Set(["@element1", "@element2", "@element3", "@element4", "@element5"]);
  const used = new Set<string>(reserved);
  const map = new Map<string, string>(); // elementId -> token

  for (const el of elements) {
    const base = makeElementTag(el.name || "element");
    let token = base;

    if (used.has(token)) {
      let n = 2;
      while (used.has(`${base}_${n}`)) n++;
      token = `${base}_${n}`;
    }

    used.add(token);
    map.set(el.id, token);
  }
  return map;
}

function extractMentionTokens(text: string) {
  return (text || "").match(/@[a-z0-9_]+/gi) ?? [];
}

function appendTokensAtEnd(args: { text: string; tokens: string[]; limit?: number }) {
  const base = String(args.text || "").trim();
  const suffix = (args.tokens || []).filter(Boolean).join(" ").trim();
  if (!suffix) return { ok: true, text: base };

  const next = base ? `${base}\n\n${suffix}` : suffix;

  if (typeof args.limit === "number" && next.length > args.limit) {
    return { ok: false, text: base };
  }
  return { ok: true, text: next };
}

function syncElementTokensInText(args: {
  text: string;
  selectedIds: string[];
  elementTokenById: Map<string, string>;
  elementTokenToId: Map<string, string>;
  appendMissing: boolean;
  limit?: number;
}) {
  const selectedTokenSet = new Set(
    (args.selectedIds || [])
      .map((id) => (args.elementTokenById.get(id) || "").toLowerCase())
      .filter(Boolean)
  );

  const tokenRe = /@[a-z0-9_]+/gi;

  // 1) Remover tokens de Elements que ya no están seleccionados
  let out = String(args.text || "").replace(tokenRe, (m) => {
    const tok = m.toLowerCase();
    if (!args.elementTokenToId.has(tok)) return m; // no es Element conocido
    return selectedTokenSet.has(tok) ? m : "";
  });

  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 2) Agregar tokens faltantes (solo si se pidió)
  if (args.appendMissing && selectedTokenSet.size) {
    const existing = new Set(extractMentionTokens(out).map((t) => t.toLowerCase()));
    const missing = [...selectedTokenSet].filter((t) => !existing.has(t));

    if (missing.length) {
      const appended = appendTokensAtEnd({ text: out, tokens: missing, limit: args.limit });
      return { text: appended.text, overflowed: !appended.ok };
    }
  }

  return { text: out, overflowed: false };
}

function moveItem<T>(arr: T[], from: number, to: number) {
  const out = [...(arr || [])];
  if (from < 0 || from >= out.length) return out;
  if (to < 0 || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

function mergeAssetsById(base: Asset[], incoming: Asset[]) {
  const map = new Map<string, Asset>();
  for (const asset of [...base, ...incoming]) {
    if (!asset?.id) continue;
    map.set(asset.id, { ...((map.get(asset.id) || {}) as Asset), ...asset });
  }
  return Array.from(map.values());
}

function makeResolvedAsset(item: any, type: Asset["type"]): Asset | null {
  const assetId = typeof item?.assetId === "string" ? item.assetId.trim() : "";
  const url = typeof item?.url === "string" ? item.url.trim() : "";
  if (!assetId || !url) return null;
  return {
    id: assetId,
    url,
    type,
    name: typeof item?.token === "string" && item.token ? item.token.replace(/^@/, "") : `prefill-${type}`,
    prompt: "",
    createdAt: Date.now(),
    ownerId: "",
    isPublic: false,
    likedByMe: false,
    likesCount: 0,
    commentsCount: 0,
    likes: [],
    comments: [],
  };
}


const TOOL_ID = "video-generator";
const PREFILL_TARGET = getCommunityPrefillTarget(TOOL_ID);
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
  klingShotType: KlingShotType;
  klingShots: { prompt: string; durationSeconds: number; elementIds?: string[] }[];
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

function coerceShotType(v: any): KlingShotType {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "intelligence" || s === "intelligent" ? "intelligence" : "customize";
}

function getVideoModelDisplayLabel(modelId: string) {
  const m = normalizeModelId(modelId);
  if (m === VEO_3) return "Veo 3 Quality";
  if (m === VEO_3_FAST) return "Veo 3 Fast";
  if (m === VEO_3_1) return "Veo 3.1 Quality";
  if (m === VEO_3_1_FAST) return "Veo 3.1 Fast";
  if (m === KLING_2_5_TURBO) return "Kling 2.5 Turbo";
  if (m === KLING_2_6) return "Kling 2.6";
  if (m === KLING_V3) return "Kling 3.0";
  if (m === KLING_O3_PRO) return "Kling O3 Pro";
  return m || "—";
}

function coerceShots(v: any, maxShots = 10) {
  const arr = Array.isArray(v) ? v : [];

  const cleaned = arr
    .map((x) => {
      const prompt = typeof x?.prompt === "string" ? x.prompt : "";
      const durationSeconds = Math.max(3, Math.min(15, Math.trunc(Number(x?.durationSeconds) || 3)));

      const elementIdsRaw = Array.isArray(x?.elementIds) ? x.elementIds : [];
      const elementIds = elementIdsRaw
        .map((id: any) => String(id || "").trim())
        .filter(Boolean);

      return { prompt, durationSeconds, elementIds };
    })
    .slice(0, maxShots);

  if (cleaned.length === 0) return [{ prompt: "", durationSeconds: 3, elementIds: [] }];
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
  const { jobs: queueJobs, enqueueVideoGeneration, cancelJob, activeCount: queueActiveCount, maxActive: queueMaxActive } =
    useGenerationQueue();

  const videoQueueJobs = useMemo(() => queueJobs.filter((j) => j.type === "video_generate"), [queueJobs]);

  const activeVideoQueueJobs = useMemo(
    () => videoQueueJobs.filter((j) => j.status === "queued" || j.status === "running"),
    [videoQueueJobs]
  );

  const isGenerating = useMemo(() => activeVideoQueueJobs.some((j) => j.status === "running"), [activeVideoQueueJobs]);

  const progressText = useMemo(() => {
    const running = activeVideoQueueJobs
      .filter((j) => j.status === "running")
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    return running?.progressText || null;
  }, [activeVideoQueueJobs]);

  const pendingSlots = useMemo(() => activeVideoQueueJobs.flatMap((j) => j.placeholders || []), [activeVideoQueueJobs]);
  const settingsLoadedRef = useRef(false);
  const pendingFrameIdsRef = useRef<{ firstId: string | null; lastId: string | null }>({
    firstId: null,
    lastId: null,
  });

  // refs para reproducir preview en hover
  const hoverVideoEls = useRef<Record<string, HTMLVideoElement | null>>({});
  const [likeBusyById, setLikeBusyById] = useState<Record<string, boolean>>({});
  const prefillAppliedRef = useRef(false);
  const [pendingExternalPrefill, setPendingExternalPrefill] = useState<any | null>(null);

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
  const [presetKlingElements, setPresetKlingElements] = useState<KlingElement[]>([]);
  const [elementsOpen, setElementsOpen] = useState(false);
  // ✅ NUEVO: en multishot, el modal edita los elements de un shot específico
  const [elementsShotIndex, setElementsShotIndex] = useState<number | null>(null);
  const openElementsForShot = (shotIndex: number | null) => {
    setElementsShotIndex(shotIndex);
    setElementsOpen(true);
  };
  const [elementsQuery, setElementsQuery] = useState("");
  const [selectedKlingElementIds, setSelectedKlingElementIds] = useState<string[]>([]);

  // 🔒 Si Elements están deshabilitados en video, forzamos estado limpio
  useEffect(() => {
    if (VIDEO_ELEMENTS_UI_ENABLED) return;
    setSelectedKlingElementIds([]);
    setKlingShots((prev) => prev.map((s) => ({ ...s, elementIds: [] })));
    setElementsOpen(false);
    setElementsShotIndex(null);
  }, []);

  const [multishotEnabled, setMultishotEnabled] = useState(false);
  const [klingShots, setKlingShots] = useState<KlingV3Shot[]>([
    { prompt: "", durationSeconds: 3, elementIds: [] },
  ]);
  const [klingShotType, setKlingShotType] = useState<KlingShotType>("intelligence");

  // V3 extra params
  const [negativePrompt, setNegativePrompt] = useState("");
  const [klingCfgScale, setKlingCfgScale] = useState<number>(0.5);
  const [klingVoiceIdsText, setKlingVoiceIdsText] = useState("");

  // Duration
  const [durationSeconds, setDurationSeconds] = useState<number>(8);

  // Assets
  const [imageAssets, setImageAssets] = useState<Asset[]>([]);
  const [videoLibraryAssets, setVideoLibraryAssets] = useState<Asset[]>([]);
  const [isLoadingVideosForElements, setIsLoadingVideosForElements] = useState(false);
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
  const [isCookOpen, setIsCookOpen] = useState(false);

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

  async function reloadVideosForElements() {
    setIsLoadingVideosForElements(true);
    try {
      const vids = await listMyAssets({ type: "video", limit: 500 });
      setVideoLibraryAssets(Array.isArray(vids) ? vids : []);
      return vids;
    } catch (e: any) {
      console.warn(e);
      setVideoLibraryAssets([]);
      return [];
    } finally {
      setIsLoadingVideosForElements(false);
    }
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

  function handleTogglePublish(asset: Asset) {
    window.dispatchEvent(new CustomEvent("tales:open-sell", { detail: { asset } }));
  }

  async function handleToggleLike(asset: Asset) {
    if (!user) {
      setError("Debes iniciar sesión para dar Like.");
      return;
    }
    if (likeBusyById[asset.id]) return;

    setLikeBusyById((prev) => ({ ...prev, [asset.id]: true }));
    try {
      const res = await toggleLike(asset.id);
      syncFavoriteAssetState(asset.id, res.liked);
      setVideoAssets((prev) =>
        prev.map((entry) => (entry.id === asset.id ? { ...entry, likedByMe: res.liked, likesCount: res.likesCount } : entry))
      );
      setViewer((prev) =>
        prev && prev.id === asset.id ? { ...prev, likedByMe: res.liked, likesCount: res.likesCount } : prev
      );
    } catch (e: any) {
      setError(e?.message || "No se pudo actualizar el Like.");
    } finally {
      setLikeBusyById((prev) => ({ ...prev, [asset.id]: false }));
    }
  }

  async function handleDownload(asset: Asset) {
    try {
      await downloadAssetToDisk(asset.id, asset.name || "image");
    } catch (e: any) {
      setError(e?.message || "No se pudo descargar.");
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

    if (VIDEO_ELEMENTS_UI_ENABLED) {
      if (Array.isArray(meta.klingElementIds)) {
        setSelectedKlingElementIds(meta.klingElementIds.filter((x: any) => typeof x === "string"));
      }
    } else {
      setSelectedKlingElementIds([]);
    }

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
  const isKlingV3Core = modelNorm === KLING_V3;

  // ✅ Kling O3 se comporta como “V3 family” en UI (Elements + Multishot)
  const isKlingO3 = modelNorm === KLING_O3_PRO;
  const isKlingV3 = isKlingV3Core || isKlingO3;
  const supportsMultishotUi = isKlingV3;
  const supportsMultishotIntelligence = isKlingV3Core;
  const maxMultishotShots = isKlingO3 ? 10 : isKlingV3Core ? 6 : 0;
  const lastFrameBlockedByMultishot = supportsMultishotUi && multishotEnabled;

  const maxKlingElements = isKlingV3 ? (hasFirst ? 3 : 5) : 0;

  // ✅ Kling API oficial (mode std/pro => 720/1080). Incluye O3 (Omni).
  const isKlingApi = isKling;
    // ===============================
  // Mentions (@) para Elements (Kling V3 / O3)
  // - El usuario escribe tags tipo @mi_elemento (slug del nombre).
  // - Antes de enviar al modelo, los convertimos a @Element1, @Element2...
  // ===============================
  const isKlingV3ElementsUI = isKlingV3 && VIDEO_ELEMENTS_UI_ENABLED;

  const allKlingElements = useMemo(() => {
    const out: KlingElement[] = [];
    const seen = new Set<string>();

    for (const el of [...klingElements, ...presetKlingElements]) {
      const id = String(el?.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ ...el, id });
    }

    return out;
  }, [klingElements, presetKlingElements]);

  const selectableKlingElements = useMemo(
    () => allKlingElements.filter((el) => isKlingElementReadyForVideoGenerator(el)),
    [allKlingElements]
  );

  const elementTokenById = useMemo(
    () => (isKlingV3ElementsUI ? buildElementTokenMap(selectableKlingElements) : new Map<string, string>()),
    [isKlingV3ElementsUI, selectableKlingElements]
  );

  const elementTokenToId = useMemo(() => {
    const m = new Map<string, string>(); // token(lower) -> elementId
    for (const [id, token] of elementTokenById.entries()) {
      m.set(token.toLowerCase(), id);
    }
    return m;
  }, [elementTokenById]);

const elementMentionItems = useMemo<MentionItem[]>(() => {
  if (!isKlingV3ElementsUI) return [];

  return selectableKlingElements
    .map((el) => {
      const token = elementTokenById.get(el.id) || `@element${Math.floor(Math.random() * 1000)}`;

      return {
        id: el.id,
        token,
        label: el.name || el.description || "Element",
        kind: "element",
      };
    });
}, [isKlingV3ElementsUI, selectableKlingElements, elementTokenById]);

  // Sync Elements con el prompt:
  // - Si borras un token de Element del prompt -> se deselecciona.
  // - Si agregas un token de Element al prompt -> se selecciona (hasta 5).
  const prevPromptElementTokensRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isKlingV3ElementsUI) return;
    // ✅ Solo bloqueamos el sync cuando es storyboard (customize).
    if (multishotEnabled && klingShotType === "customize") return;

    const tokens = extractMentionTokens(prompt).map((t) => t.toLowerCase());
    const current = new Set<string>();
    for (const t of tokens) if (elementTokenToId.has(t)) current.add(t);

    const prev = prevPromptElementTokensRef.current;
    const removed: string[] = [];
    const added: string[] = [];

    for (const t of prev) if (!current.has(t)) removed.push(t);
    for (const t of current) if (!prev.has(t)) added.push(t);

    if (removed.length || added.length) {
      setSelectedKlingElementIds((prevIds) => {
        const beforeIds = Array.isArray(prevIds) ? prevIds : [];
        let nextIds = beforeIds;

        if (removed.length) {
          const removedIds = removed.map((t) => elementTokenToId.get(t)).filter(Boolean) as string[];
          if (removedIds.length) nextIds = nextIds.filter((id) => !removedIds.includes(id));
        }

        if (added.length) {
          const temp = [...nextIds];
          for (const t of added) {
            const id = elementTokenToId.get(t);
            if (!id) continue;
            if (temp.includes(id)) continue;
            if (temp.length >= maxKlingElements) break;
            temp.push(id);
          }
          nextIds = temp;
        }

        if (nextIds.length > maxKlingElements) nextIds = nextIds.slice(0, maxKlingElements);

        const same = nextIds.length === beforeIds.length && nextIds.every((id, i) => id === beforeIds[i]);
        return same ? beforeIds : nextIds;
      });
    }

    prevPromptElementTokensRef.current = current;

    if (current.size > maxKlingElements) {
      setError(`No puedes usar más de ${maxKlingElements} Elements a la vez. Elimina alguno del prompt.`);
    }
  }, [prompt, elementTokenToId, isKlingV3ElementsUI, multishotEnabled, klingShotType, maxKlingElements]);


  // Sync global Elements en multishot customize:
  // - Unión de elementIds entre todos los shots (máx por modo/frames)
  // - Mantiene el orden actual (reordenado por el usuario) y solo agrega/quita según uso real
  useEffect(() => {
    if (!isKlingV3ElementsUI) return;
    if (!(multishotEnabled && klingShotType === "customize")) return;

    const used: string[] = [];
    for (const s of klingShots) {
      const ids = Array.isArray((s as any).elementIds) ? (s as any).elementIds : [];
      for (const id of ids) {
        if (!id) continue;
        if (!used.includes(id)) used.push(id);
      }
    }

    if (used.length > maxKlingElements) {
      setError(`No puedes usar más de ${maxKlingElements} Elements a la vez (sumando todos los shots). Elimina alguno del prompt.`);
      return;
    }

    setSelectedKlingElementIds((prevIds) => {
      const prev = Array.isArray(prevIds) ? prevIds : [];
      const base = prev.filter((id) => used.includes(id));
      const next = [...base];
      for (const id of used) if (!next.includes(id)) next.push(id);

      const same = next.length === prev.length && next.every((id, i) => id === prev[i]);
      return same ? prev : next;
    });
  }, [isKlingV3ElementsUI, multishotEnabled, klingShotType, klingShots, maxKlingElements]);


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
    if (count === 1) return;
    setCount(1);
  }, [count]);

  useEffect(() => {
    if (capability.supportsSound) return;
    if (!klingSound && !klingSoundTouched) return;
    setKlingSound(false);
    setKlingSoundTouched(false);
  }, [capability.supportsSound, klingSound, klingSoundTouched]);

  useEffect(() => {
    if (supportsMultishotUi) return;
    if (!multishotEnabled && klingShotType === "intelligence") return;
    setMultishotEnabled(false);
    setKlingShotType("intelligence");
  }, [supportsMultishotUi, multishotEnabled, klingShotType]);

  useEffect(() => {
    if (!multishotEnabled) return;
    if (!isKlingO3) return;
    if (klingShotType === "customize") return;
    setKlingShotType("customize");
  }, [isKlingO3, multishotEnabled, klingShotType]);

  useEffect(() => {
    if (panel !== "duration") return;
    if (!multishotEnabled || klingShotType !== "customize") return;
    setPanel(null);
  }, [panel, multishotEnabled, klingShotType]);

  useEffect(() => {
    if (!supportsMultishotUi || maxMultishotShots <= 0) return;
    setKlingShots((prev) => {
      const next = coerceShots(prev, maxMultishotShots).map((shot) => ({
        ...shot,
        durationSeconds: clampInt(shot.durationSeconds, 3, 15, 3),
      }));
      const same =
        next.length === prev.length &&
        next.every(
          (shot, idx) =>
            shot.prompt === prev[idx]?.prompt &&
            shot.durationSeconds === prev[idx]?.durationSeconds &&
            JSON.stringify(shot.elementIds || []) === JSON.stringify(prev[idx]?.elementIds || [])
        );
      return same ? prev : next;
    });
  }, [supportsMultishotUi, maxMultishotShots]);

  useEffect(() => {
    const next = coerceResolutionForModel(modelNorm, capability, resolution);
    if (next !== resolution) setResolution(next);
  }, [modelNorm, capability, resolution]);

  // ✅ Hardening: si el modelo cambió y tu resolution actual no existe en supportedResolutions, la corregimos.
useEffect(() => {
  if (!capability.supportsResolution) return;
  if (!supportedResolutions.includes(resolution as any)) {
    const first = (supportedResolutions[0] as any) || "720p";
    setResolution(first);
  }
}, [capability.supportsResolution, supportedResolutions, resolution]);

// ✅ Kling (API oficial): Kling mode (std/pro) define la resolución (720p/1080p).
useEffect(() => {
  if (!isKlingApi) return;
  const nextRes = klingMode === "pro" ? "1080p" : "720p";
  if (resolution !== nextRes) setResolution(nextRes);
}, [isKlingApi, klingMode, resolution]);

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

  useEffect(() => {
    const readPrefill = () => {
      const payload = readCommunityRecipePrefill(TOOL_ID);
      if (payload) setPendingExternalPrefill(payload);
    };

    readPrefill();
    const onPrefill = () => readPrefill();
    window.addEventListener(PREFILL_TARGET.event, onPrefill as any);
    return () => window.removeEventListener(PREFILL_TARGET.event, onPrefill as any);
  }, []);

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
    if (prefillAppliedRef.current) return;
    if (!pendingExternalPrefill) return;
    if (isLoadingHistory || isLoadingImages) return;

    const payload = pendingExternalPrefill;
    const recipe = payload?.recipe || null;
    const resolvedAssets = Array.isArray(payload?.resolvedAssets) ? payload.resolvedAssets : [];
    const source = recipe?.sourceAsset || {};
    const meta = source?.meta || {};

    if (typeof source?.prompt === "string") setPrompt(source.prompt);
    if (typeof meta.model === "string") setModel(meta.model);
    if (typeof meta.aspectRatio === "string") setAspectRatio(meta.aspectRatio);
    if (typeof meta.resolution === "string") setResolution(meta.resolution);
    if (typeof meta.durationSeconds === "number") setDurationSeconds(meta.durationSeconds);
    if (typeof meta.klingMode === "string") setKlingMode(meta.klingMode);
    if (typeof meta.klingSound === "boolean") {
      setKlingSound(meta.klingSound);
      setKlingSoundTouched(true);
    }
    if (typeof meta.klingShotType === "string") setKlingShotType(meta.klingShotType);
    if (typeof meta.negativePrompt === "string") setNegativePrompt(meta.negativePrompt);
    if (typeof meta.klingCfgScale === "number") setKlingCfgScale(meta.klingCfgScale);
    if (Array.isArray(meta.klingVoiceIds)) setKlingVoiceIdsText(meta.klingVoiceIds.join(","));
    if (typeof meta.multishotEnabled === "boolean") setMultishotEnabled(meta.multishotEnabled);
    if (Array.isArray(meta.klingMultiPrompt)) setKlingShots(coerceShots(meta.klingMultiPrompt));

    const byId = new Map<string, any>();
    for (const item of resolvedAssets) {
      if (item?.assetId) byId.set(String(item.assetId), item);
    }

    const first = makeResolvedAsset(byId.get(meta.firstFrameAssetId), "image");
    const last = makeResolvedAsset(byId.get(meta.lastFrameAssetId), "image");

    if (first || last) {
      setImageAssets((prev) => mergeAssetsById(prev, [first, last].filter(Boolean) as Asset[]));
    }

    setFirstFrame(first);
    setLastFrame(first ? last : null);

    prefillAppliedRef.current = true;
    setPendingExternalPrefill(null);
    clearCommunityRecipePrefill(TOOL_ID);
    setPanel(null);
  }, [pendingExternalPrefill, isLoadingHistory, isLoadingImages]);

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

  const loadKlingElementLibrary = useCallback(async (opts?: {
    pollCustom?: boolean;
    forcePresets?: boolean;
    silent?: boolean;
  }) => {
    try {
      const [customRaw, presetRaw] = await Promise.all([
        opts?.pollCustom ? refreshKlingElementsStatus({ maxPoll: 10 }) : listKlingElements(),
        listKlingPresetElements({ force: Boolean(opts?.forcePresets) }),
      ]);

      const customItems = (customRaw || []).map((e: any) => ({ ...e, id: String(e?.id ?? "") }));
      const presetItems = (presetRaw || []).map((e: any) => ({ ...e, id: String(e?.id ?? "") }));

      setKlingElements(customItems);
      setPresetKlingElements(presetItems);

      const validIds = new Set(
        [...customItems, ...presetItems]
          .filter((e: any) => isKlingElementReadyForVideoGenerator(e))
          .map((e: any) => String(e?.id ?? "").trim())
          .filter(Boolean)
      );

      setSelectedKlingElementIds((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.map(String).filter((id) => validIds.has(id));
      });

      setKlingShots((prev: any) => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.map((s: any) => ({
          ...s,
          elementIds: Array.isArray(s?.elementIds)
            ? s.elementIds.map(String).filter((id: string) => validIds.has(id))
            : [],
        }));
      });
    } catch (e: any) {
      if (!opts?.silent) {
        setError(e?.message || "No pude cargar tus Elements.");
      }
    }
  }, []);

  useEffect(() => {
    if (!isKlingV3ElementsUI) return;
    loadKlingElementLibrary({ silent: true });
  }, [isKlingV3ElementsUI, loadKlingElementLibrary]);

  useEffect(() => {
    if (!isKlingV3ElementsUI) return;
    if (!elementsOpen) return;
    loadKlingElementLibrary({ pollCustom: true, forcePresets: true });
  }, [isKlingV3ElementsUI, elementsOpen, loadKlingElementLibrary]);

  useEffect(() => {
    if (!isKlingV3ElementsUI) return;
    if (!elementsOpen) return;

    // Refresca imágenes y videos para el creador de Elements
    reloadImages();
    reloadVideosForElements();
  }, [isKlingV3ElementsUI, elementsOpen]);

  const modelLabel = useMemo(() => getVideoModelDisplayLabel(modelNorm), [modelNorm]);

  const aspectSelectorLabel = useMemo(() => {
    if (!capability.supportsAspectRatio) return "Auto";
    return aspectRatio;
  }, [capability.supportsAspectRatio, aspectRatio]);

  const resolutionSelectorLabel = useMemo(() => {
    if (isKlingApi) return klingMode === "pro" ? "1080p" : "720p";
    if (!capability.supportsResolution) return "Auto";
    return resolution;
  }, [isKlingApi, klingMode, capability.supportsResolution, resolution]);

const isMultishotCustomize = supportsMultishotUi && multishotEnabled && klingShotType === "customize";
const isMultishotIntelligence = supportsMultishotUi && multishotEnabled && klingShotType === "intelligence";

const multishotValidShots = useMemo(() => {
  if (!isMultishotCustomize) return [];
  return klingShots
    .map((s) => ({
      prompt: (s.prompt || "").trim(),
      durationSeconds: clampInt(s.durationSeconds, 3, 15, 3),
    }))
    .filter((s) => s.prompt.length > 0);
}, [isMultishotCustomize, klingShots]);

const multishotTotalSeconds = useMemo(() => {
  if (!isMultishotCustomize) return 0;
  return multishotValidShots.reduce((acc, s) => acc + s.durationSeconds, 0);
}, [isMultishotCustomize, multishotValidShots]);

const estimatedCostCredits = useMemo(() => {
  const dur = isMultishotCustomize ? (multishotTotalSeconds || durationSeconds) : durationSeconds;
  return estimateVideoCostCredits({
    modelNorm,
    durationSeconds: dur,
    resolution,
    generateAudio: klingSound,
    klingMode,
    voiceControl: klingVoiceIdsText.trim().length > 0,
    count: 1,
  });
}, [modelNorm, durationSeconds, isMultishotCustomize, multishotTotalSeconds, resolution, klingSound, klingMode, klingVoiceIdsText]);

useEffect(() => {
  if (!isMultishotCustomize) return;

  if (Number.isFinite(multishotTotalSeconds) && multishotTotalSeconds > 0) {
    const synced = clampInt(multishotTotalSeconds, 3, 15, 8);
    if (synced !== durationSeconds) setDurationSeconds(synced);
  }
}, [isMultishotCustomize, multishotTotalSeconds, durationSeconds]);

const multishotHasOverLimitPrompt = useMemo(() => {
  if (!isMultishotCustomize) return false;
  return klingShots.some((s) => (s.prompt || "").length > KLING_V3_SHOT_PROMPT_LIMIT);
}, [isMultishotCustomize, klingShots]);

const multishotDurationOverLimit = useMemo(() => {
  if (!isMultishotCustomize) return false;
  return multishotTotalSeconds > 15;
}, [isMultishotCustomize, multishotTotalSeconds]);

const multishotIsReady = useMemo(() => {
  if (!supportsMultishotUi || !multishotEnabled) return true;

  if (isMultishotIntelligence) {
    return prompt.trim().length > 0;
  }

  if (multishotValidShots.length < 1) return false;
  if (multishotHasOverLimitPrompt) return false;
  if (multishotTotalSeconds < 3 || multishotTotalSeconds > 15) return false;
  return true;
}, [
  supportsMultishotUi,
  multishotEnabled,
  isMultishotIntelligence,
  prompt,
  multishotValidShots.length,
  multishotHasOverLimitPrompt,
  multishotTotalSeconds,
]);

const durationLabel = useMemo(() => {
  if (isMultishotCustomize) {
    return `${multishotTotalSeconds || 0}s`;
  }
  return `${durationSeconds}s`;
}, [durationSeconds, isMultishotCustomize, multishotTotalSeconds]);

  const isCookSidebarVisible = isCookOpen && !panel;
  const isCookLayerVisible = isCookOpen || !!panel;
  const showCookActionDock = isCookSidebarVisible;

  function openCook() {
    setPanel(null);
    setIsCookOpen(true);
  }

  function closeCook() {
    setPanel(null);
    setIsCookOpen(false);
  }

  function restoreCookFromPanel() {
    setPanel(null);
    setIsCookOpen(true);
  }

  const openPicker = (slot: FrameSlotKey) => {
    if (slot === "last" && (!hasFirst || lastFrameBlockedByMultishot)) return; // bloquea last si no hay first o si Multishot está activo
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
      if (!hasFirst || lastFrameBlockedByMultishot) return;
      setLastFrame(asset);
    }
    setPickerOpen(false);
  };

  useEffect(() => {
    if (!lastFrameBlockedByMultishot) return;
    if (lastFrame) setLastFrame(null);
    if (pickerOpen && pickerSlot === "last") setPickerOpen(false);
  }, [lastFrameBlockedByMultishot, lastFrame, pickerOpen, pickerSlot]);

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

  // ✅ Cuando un job del Queue termina, refrescamos el historial (solo una vez por job)
  const handledCompletedJobsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;

    const newlyDone = videoQueueJobs.filter(
      (j) => j.status === "succeeded" && !handledCompletedJobsRef.current.has(j.id)
    );

    if (newlyDone.length === 0) return;

    newlyDone.forEach((j) => handledCompletedJobsRef.current.add(j.id));

    (async () => {
      const refreshed = await reloadHistory();

      const newest = [...newlyDone].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      const firstId = newest?.result?.assetIds?.[0] || null;

      if (firstId) {
        const found = refreshed.find((a) => a.id === firstId) || null;
        if (found) setViewer(found);
      }
    })();
  }, [videoQueueJobs, user?.id]);

  const computeFinalInputsForModel = () => {
  let promptForModel = prompt;
  let selectedKlingElementIdsForModel = selectedKlingElementIds;
  let klingShotsForModel = klingShots;

  if (isKlingV3 || isKlingO3) {
    const tokenRe = /@[a-z0-9_]+/gi;

    const idsMentionedInText = (text: string) => {
      const out: string[] = [];
      for (const tok of extractMentionTokens(text)) {
        const id = elementTokenToId.get(tok.toLowerCase());
        if (!id) continue;
        if (!out.includes(id)) out.push(id);
      }
      return out;
    };

    const mergeInOrder = (baseOrder: string[], extraIds: string[]) => {
      const out = [...(Array.isArray(baseOrder) ? baseOrder : [])];
      for (const id of extraIds) {
        if (!id) continue;
        if (!out.includes(id)) out.push(id);
      }
      return out;
    };

    const normalizeLegacyElementRefs = (text: string) =>
      String(text || "").replace(/<<\s*element_(\d+)\s*>>/gi, "<<<element_$1>>>");

    const replaceTokensWithElementRefs = (text: string, indexById: Map<string, number>) => {
      const replaced = String(text || "").replace(tokenRe, (m) => {
        const id = elementTokenToId.get(m.toLowerCase());
        if (!id) return m;
        const n = indexById.get(id);
        if (!n) return m;

        // Kling Video 3.0 / Omni: sintaxis oficial de prompt con triple brackets.
        return `<<<element_${n}>>>`;
      });

      return normalizeLegacyElementRefs(replaced);
    };

    if (!multishotEnabled || klingShotType === "intelligence") {
      const mentionedIds = idsMentionedInText(prompt);
      const finalGlobalIds = mergeInOrder(selectedKlingElementIds, mentionedIds);

      if (finalGlobalIds.length > maxKlingElements) {
        throw new Error(`No puedes usar más de ${maxKlingElements} Elements a la vez. Elimina alguno del prompt.`);
      }

      const indexById = new Map<string, number>();
      finalGlobalIds.forEach((id, i) => indexById.set(id, i + 1));

      promptForModel = replaceTokensWithElementRefs(prompt, indexById);
      selectedKlingElementIdsForModel = finalGlobalIds;
    } else {
      const shotUsedUnion: string[] = [];

      const shotsWithIds = (klingShots as any[]).map((s) => {
        const baseIds = Array.isArray((s as any).elementIds) ? (s as any).elementIds : [];
        const mentionedIds = idsMentionedInText(String((s as any).prompt || ""));
        const ids = mergeInOrder(baseIds, mentionedIds);

        for (const id of ids) if (!shotUsedUnion.includes(id)) shotUsedUnion.push(id);

        return { ...s, elementIds: ids };
      });

      const baseOrder = selectedKlingElementIds.filter((id) => shotUsedUnion.includes(id));
      const finalGlobalIds = mergeInOrder(baseOrder, shotUsedUnion);

      if (finalGlobalIds.length > maxKlingElements) {
        throw new Error(
          `No puedes usar más de ${maxKlingElements} Elements a la vez (sumando todos los shots). Elimina alguno del prompt.`
        );
      }

      const indexById = new Map<string, number>();
      finalGlobalIds.forEach((id, i) => indexById.set(id, i + 1));

      klingShotsForModel = shotsWithIds.map((s) => {
        const ids = Array.isArray((s as any).elementIds) ? (s as any).elementIds : [];
        return {
          ...s,
          elementIds: finalGlobalIds.filter((id) => ids.includes(id)),
          prompt: replaceTokensWithElementRefs(String((s as any).prompt || ""), indexById),
        };
      });

      selectedKlingElementIdsForModel = finalGlobalIds;
    }
  }

  // ✅ Quality Gate: no permitir Elements no listos (creating/failed o sin klingElementId)
  if (isKlingV3) {
    const byId = new Map(allKlingElements.map((e) => [String(e.id), e]));

    const selected = (selectedKlingElementIdsForModel || []).map((x) => String(x)).filter(Boolean);

    const missingIds = selected.filter((id) => !byId.has(id));

    const notReady = selected
      .map((id) => byId.get(id))
      .filter((e) => e && !isKlingElementReadyForVideoGenerator(e));

    if (missingIds.length || notReady.length) {
      const missingLabel = missingIds.length ? `missingIds: ${missingIds.join(", ")}` : "";
      const notReadyLabel = notReady.length
        ? `notReady: ${notReady.map((e: any) => (e?.name ? `"${e.name}"` : String(e?.id || ""))).join(", ")}`
        : "";

      const sep = missingLabel && notReadyLabel ? " | " : "";
      const detail = `${missingLabel}${sep}${notReadyLabel}`.trim();

      throw new Error(
        `Estos Elements no están listos o no existen: ${detail || "(unknown)"}. Usa "Refresh status" o reabre Elements.`
      );
    }
  }

  return { promptForModel, selectedKlingElementIdsForModel, klingShotsForModel };
  };

  const handleGenerate = async () => {
    setError(null);

    if (queueActiveCount >= queueMaxActive) {
      setError(
        `Tienes ${queueActiveCount}/${queueMaxActive} generaciones activas. Espera a que termine alguna o cancela.`
      );
      return;
    }

    try {
      const handler = getVideoModelHandler(modelNorm);

// Preparar prompts con @Elements:
// El usuario escribe @mi_elemento (slug). Aquí lo convertimos a @Element1..N para el modelo.
      const {
        promptForModel,
        selectedKlingElementIdsForModel,
        klingShotsForModel,
      } = computeFinalInputsForModel();

      const plan = handler.buildPlan({
        model: modelNorm,
        prompt: promptForModel,
        tool: TOOL_ID,
        nameHint: "video",

        count: 1,
        durationSeconds,
        aspectRatio,
        resolution,

        firstFrameAssetId: firstFrame?.id || null,
        lastFrameAssetId: lastFrame?.id || null,

        klingMode,
        klingSound,
        klingSoundTouched,

        selectedKlingElementIds: selectedKlingElementIdsForModel,
        multishotEnabled,
        klingShots: klingShotsForModel,
        klingShotType,

        negativePrompt,
        klingCfgScale,
        klingVoiceIdsText,
      });

      const label = `Video • ${modelLabel}`;

      const enq = enqueueVideoGeneration({
        label,
        modelNorm: plan.modelNorm,
        planBody: plan.body,
        prompt: plan.effectivePrompt,
        pendingSlotsCount: plan.pendingSlotsCount,
      });

    if (enq.ok === false) {
      setError(enq.error);
      return;
    }
    } catch (e: any) {
      setError(formatErr(e));
    }
  };

  const handleCancel = () => {
    const running = [...videoQueueJobs]
      .filter((j) => j.status === "running")
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

    if (running) cancelJob(running.id);
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

  const effectiveElementsShotIndex =
    multishotEnabled && klingShotType === "customize" ? (elementsShotIndex ?? 0) : null;

  const modalSelectedIds =
    multishotEnabled && klingShotType === "customize"
      ? (klingShots[effectiveElementsShotIndex ?? 0]?.elementIds ?? [])
      : selectedKlingElementIds;

const setModalSelectedIds: React.Dispatch<React.SetStateAction<string[]>> = (next) => {
    if (multishotEnabled && klingShotType === "customize") {
      const idx = effectiveElementsShotIndex ?? 0;

      let promptOverflow = false;
      let tooMany = false;

      setKlingShots((prev) =>
        prev.map((s, i) => {
          if (i !== idx) return s;

          const current = s.elementIds ?? [];
          let value: string[] = typeof next === "function" ? (next as any)(current) : next;

          if (isKlingV3 && value.length > maxKlingElements) {
            tooMany = true;
            value = value.slice(0, maxKlingElements);
          }

          // Sync selección ⇄ tokens en el prompt del shot (fuente de verdad)
          const synced = syncElementTokensInText({
            text: String(s.prompt || ""),
            selectedIds: value,
            elementTokenById,
            elementTokenToId,
            appendMissing: true,
            limit: KLING_V3_SHOT_PROMPT_LIMIT,
          });

          if (synced.overflowed) promptOverflow = true;

          return {
            ...s,
            elementIds: value,
            prompt: synced.text,
          };
        })
      );

      if (tooMany) {
        setError(`No puedes usar más de ${maxKlingElements} Elements a la vez en este modo (por frames).`);
      }

      if (promptOverflow) {
        setError("El prompt del shot es demasiado largo para insertar los tokens de Elements (límite 512).");
      }
    } else {
      const current = selectedKlingElementIds;
      let value: string[] = typeof next === "function" ? (next as any)(current) : next;

      if (isKlingV3 && value.length > maxKlingElements) {
        value = value.slice(0, maxKlingElements);
        setError(`No puedes usar más de ${maxKlingElements} Elements a la vez en este modo (por frames).`);
      }

      // Sync selección ⇄ tokens en el prompt principal
      if (isKlingV3) {
        const synced = syncElementTokensInText({
          text: String(prompt || ""),
          selectedIds: value,
          elementTokenById,
          elementTokenToId,
          appendMissing: true,
        });

        if (synced.text !== prompt) setPrompt(synced.text);
      }

      setSelectedKlingElementIds(value);
    }
  };

const clearModalSelectedIds = () => {
    if (multishotEnabled && klingShotType === "customize") {
      const idx = effectiveElementsShotIndex ?? 0;

      setKlingShots((prev) =>
        prev.map((s, i) => {
          if (i !== idx) return s;

          const synced = syncElementTokensInText({
            text: String(s.prompt || ""),
            selectedIds: [],
            elementTokenById,
            elementTokenToId,
            appendMissing: false,
            limit: KLING_V3_SHOT_PROMPT_LIMIT,
          });

          return { ...s, elementIds: [], prompt: synced.text };
        })
      );
    } else {
      if (isKlingV3) {
        const synced = syncElementTokensInText({
          text: String(prompt || ""),
          selectedIds: [],
          elementTokenById,
          elementTokenToId,
          appendMissing: false,
        });

        if (synced.text !== prompt) setPrompt(synced.text);
      }

      setSelectedKlingElementIds([]);
    }
  };

  const canShowComposerActions = !isMultishotCustomize && (capability.supportsSound || isKlingV3ElementsUI);

  const toggleMultishot = () => {
    if (!supportsMultishotUi) return;
    setPanel(null);
    if (multishotEnabled) {
      setMultishotEnabled(false);
      return;
    }
    setMultishotEnabled(true);
    setKlingShotType(supportsMultishotIntelligence ? "intelligence" : "customize");
  };

  const selectMultishotMode = (mode: KlingShotType) => {
    if (!supportsMultishotUi) return;
    if (mode === "intelligence" && !supportsMultishotIntelligence) return;
    setPanel(null);
    setMultishotEnabled(true);
    setKlingShotType(mode);
  };

  const handleShotPromptChange = (index: number, nextPrompt: string) => {
    setKlingShots((prev) =>
      prev.map((shot, shotIndex) => (shotIndex === index ? { ...shot, prompt: nextPrompt } : shot))
    );
  };

  const handleShotDurationChange = (index: number, value: number) => {
    const nextDuration = clampInt(value, 3, 15, 3);
    setKlingShots((prev) =>
      prev.map((shot, shotIndex) =>
        shotIndex === index ? { ...shot, durationSeconds: nextDuration } : shot
      )
    );
  };

  const handleAddShot = () => {
    if (!supportsMultishotUi || maxMultishotShots <= 0) return;
    setKlingShots((prev) => {
      if (prev.length >= maxMultishotShots) return prev;
      return [...prev, { prompt: "", durationSeconds: 3, elementIds: [] }];
    });
  };

  const handleRemoveShot = (index: number) => {
    setKlingShots((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, shotIndex) => shotIndex !== index);
    });
  };

  const modelSelectorLabel = modelLabel;
  const durationSelectorLabel = durationLabel;
  const showDurationSelector = !isMultishotCustomize;
  const firstFramePreviewUrl = firstFrame ? getAssetUrl(firstFrame) : null;
  const lastFramePreviewUrl = lastFrame ? getAssetUrl(lastFrame) : null;
  const generateDisabled =
    isGenerating ||
    queueActiveCount >= queueMaxActive ||
    (supportsMultishotUi && multishotEnabled ? !multishotIsReady : !prompt.trim());

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
        title="VIDEO GENERATOR"
        isLoading={isLoadingHistory}
        pendingSlots={pendingSlots}
        totalCount={videoAssets.length}
        visibleHistory={visibleHistory}
        hasMore={hasMoreHistory}
        isLoadingMore={isLoadingMoreHistory}
        onRefresh={reloadHistory}
        onLoadMore={handleLoadMoreHistory}
        onOpenViewer={(a) => setViewer(a)}
        onToggleLike={handleToggleLike}
        likeBusyById={likeBusyById}
        onTogglePublish={handleTogglePublish}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onShowError={(msg) => setError(msg)}
        hoverVideoEls={hoverVideoEls}
      />

      {panel === null && !isCookSidebarVisible && (
        <button
          type="button"
          className={`${styles.cookToggle} ${isCookSidebarVisible ? styles.cookToggleOpen : styles.cookTogglePulse}`}
          onClick={() => {
            if (isCookSidebarVisible) closeCook();
            else openCook();
          }}
          aria-expanded={isCookSidebarVisible}
          aria-controls="video-generator-start-create"
          aria-label={isCookSidebarVisible ? "Close Start Create" : "Open Start Create"}
        >
          <span className={styles.cookToggleLabel}>Start Create</span>
          <span className={styles.cookToggleGlyph} aria-hidden="true">{isCookSidebarVisible ? "×" : "+"}</span>
        </button>
      )}

      {isCookLayerVisible && (
        <div id="video-generator-start-create" className={`${styles.cookOverlay} ${styles.cookOverlayOpen}`} aria-hidden={!isCookLayerVisible}>
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
                <ControlsPopover
                  inline
                  onClose={restoreCookFromPanel}
                  panel={panel}
                  setPanel={setPanel}
                  popoverRef={popoverRef}
                  model={model}
                  setModel={setModel}
                  capability={capability}
                  hasFirst={hasFirst}
                  aspectRatio={aspectRatio}
                  setAspectRatio={setAspectRatio}
                  supportedResolutions={supportedResolutions}
                  resolution={resolution}
                  setResolution={setResolution}
                  isKling={isKling}
                  klingMode={klingMode}
                  setKlingMode={setKlingMode}
                  allowedDurations={allowedDurations}
                  durationSeconds={durationSeconds}
                  setDurationSeconds={setDurationSeconds}
                />
              </div>
            </div>
          )}

          {isCookSidebarVisible && (
            <div
              className={styles.cookSidebarShell}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                if (panel) restoreCookFromPanel();
                else closeCook();
              }}
            >
              <div className={styles.cookSidebar}>
                <div className={`${styles.dock} ${styles.cookSectionCard} ${styles.cookPromptCard}`}>
                  <div className={styles.videoCreateFrameRow}>
                    <div className={styles.videoCreateFrameSlot}>
                      <button
                        type="button"
                        className={`${styles.videoCreateFrameCard} ${hasFirst ? styles.videoCreateFrameCardFilled : ""}`}
                        onClick={() => openPicker("first")}
                      >
                        <span className={styles.videoCreateFrameBadge}>Optional</span>
                        {firstFramePreviewUrl && (
                          <img
                            src={firstFramePreviewUrl}
                            alt={firstFrame?.name || "Start frame"}
                            className={styles.videoCreateFramePreview}
                          />
                        )}
                        <span className={styles.videoCreateFrameShade} aria-hidden="true" />
                        {!firstFramePreviewUrl && (
                          <span className={styles.videoCreateFrameIconOrb} aria-hidden="true">
                            <Icon name="image" />
                          </span>
                        )}
                        <span className={styles.videoCreateFrameLabel}>Start frame</span>
                      </button>

                      {hasFirst && (
                        <button
                          type="button"
                          className={styles.videoCreateFrameRemove}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFirstFrame(null);
                            setLastFrame(null);
                          }}
                          aria-label="Quitar Start frame"
                          title="Quitar Start frame"
                        >
                          <Icon name="close" />
                        </button>
                      )}
                    </div>

                    <div className={styles.videoCreateFrameSlot}>
                      <button
                        type="button"
                        className={`${styles.videoCreateFrameCard} ${hasLast ? styles.videoCreateFrameCardFilled : ""} ${
                          !hasFirst || lastFrameBlockedByMultishot ? styles.videoCreateFrameCardDisabled : ""
                        }`}
                        onClick={() => openPicker("last")}
                        disabled={!hasFirst || lastFrameBlockedByMultishot}
                        title={
                          !hasFirst
                            ? "End frame disponible después de seleccionar Start frame"
                            : lastFrameBlockedByMultishot
                              ? "End frame bloqueado mientras Multi-shot está activo"
                              : "Seleccionar End frame"
                        }
                      >
                        <span className={styles.videoCreateFrameBadge}>Optional</span>
                        {lastFramePreviewUrl && (
                          <img
                            src={lastFramePreviewUrl}
                            alt={lastFrame?.name || "End frame"}
                            className={styles.videoCreateFramePreview}
                          />
                        )}
                        <span className={styles.videoCreateFrameShade} aria-hidden="true" />
                        {!lastFramePreviewUrl && (
                          <span className={styles.videoCreateFrameIconOrb} aria-hidden="true">
                            <Icon name="image" />
                          </span>
                        )}
                        <span className={styles.videoCreateFrameLabel}>End frame</span>
                      </button>

                      {hasLast && (
                        <button
                          type="button"
                          className={styles.videoCreateFrameRemove}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLastFrame(null);
                          }}
                          aria-label="Quitar End frame"
                          title="Quitar End frame"
                        >
                          <Icon name="close" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className={styles.videoComposerCard}>
                    {supportsMultishotUi && (
                      <>
                        <div className={styles.videoComposerHeader}>
                          <div className={styles.videoComposerTitleWrap}>
                            <span className={styles.videoComposerTitle}>Multi-shot</span>
                            <span className={styles.videoComposerInfo} aria-hidden="true">
                              i
                            </span>
                          </div>

                          {multishotDurationOverLimit && (
                            <span className={styles.videoComposerAlert} aria-live="polite">
                              La suma de los shots no debe superar los 15 segundos.
                            </span>
                          )}

                          <button
                            type="button"
                            className={`${styles.videoSwitch} ${multishotEnabled ? styles.videoSwitchActive : ""}`}
                            onClick={toggleMultishot}
                            aria-pressed={multishotEnabled}
                            aria-label={multishotEnabled ? "Desactivar Multi-shot" : "Activar Multi-shot"}
                          >
                            <span className={styles.videoSwitchThumb} />
                          </button>
                        </div>

                        {multishotEnabled && (
                          <div className={styles.videoModeTabs}>
                            {supportsMultishotIntelligence && (
                              <button
                                type="button"
                                className={`${styles.videoModeTab} ${
                                  isMultishotIntelligence ? styles.videoModeTabActive : ""
                                }`}
                                onClick={() => selectMultishotMode("intelligence")}
                              >
                                Intelligence
                              </button>
                            )}

                            <button
                              type="button"
                              className={`${styles.videoModeTab} ${isMultishotCustomize ? styles.videoModeTabActive : ""} ${
                                !supportsMultishotIntelligence ? styles.videoModeTabSingle : ""
                              }`}
                              onClick={() => selectMultishotMode("customize")}
                            >
                              Customize
                            </button>
                          </div>
                        )}

                        <div className={styles.videoComposerDivider} />
                      </>
                    )}

                    {isMultishotCustomize ? (
                      <>
                        <div className={styles.videoShotList}>
                          {klingShots.map((shot, shotIndex) => (
                            <div key={`shot-${shotIndex}`} className={styles.videoShotCard}>
                              <div className={styles.videoShotHeader}>
                                <div className={styles.videoShotTitle}>Shot {shotIndex + 1}</div>
                                {klingShots.length > 1 && (
                                  <button
                                    type="button"
                                    className={styles.videoShotRemove}
                                    onClick={() => handleRemoveShot(shotIndex)}
                                    aria-label={`Eliminar Shot ${shotIndex + 1}`}
                                  >
                                    <Icon name="close" />
                                  </button>
                                )}
                              </div>

                              <LimitedTextarea
                                value={shot.prompt}
                                onChange={(nextPrompt) => handleShotPromptChange(shotIndex, nextPrompt)}
                                placeholder="Describe the first scene you imagine, with details."
                                rows={4}
                                surfaceClassName={styles.videoShotPromptSurface}
                              />

                              <div className={styles.videoShotFooter}>
                                <div className={styles.videoShotDurationChip}>
                                  <Icon name="clock" />
                                  <label className={styles.videoShotDurationLabel} htmlFor={`shot-duration-${shotIndex}`}>
                                    Duration
                                  </label>
                                  <select
                                    id={`shot-duration-${shotIndex}`}
                                    value={shot.durationSeconds}
                                    onChange={(e) => handleShotDurationChange(shotIndex, Number(e.target.value))}
                                    className={styles.videoShotDurationSelect}
                                    aria-label={`Duración del Shot ${shotIndex + 1}`}
                                  >
                                    {allowedDurations.map((duration) => (
                                      <option key={duration} value={duration}>
                                        {duration}s
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {isKlingV3ElementsUI && (
                                  <button
                                    type="button"
                                    className={`${styles.videoActionBtn} ${styles.videoActionBtnMuted} ${Array.isArray(shot.elementIds) && shot.elementIds.length ? styles.videoActionBtnActive : ""}`}
                                    onClick={() => openElementsForShot(shotIndex)}
                                    title={`Manage Elements for Shot ${shotIndex + 1}`}
                                    aria-label={`Open Elements for Shot ${shotIndex + 1}`}
                                  >
                                    <Icon name="elements" />
                                    <span>Elements</span>
                                    <span className={styles.videoActionBtnMeta}>{Array.isArray(shot.elementIds) ? shot.elementIds.length : 0}/{maxKlingElements}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {klingShots.length < maxMultishotShots && (
                          <div className={styles.videoAddShotWrap}>
                            <button type="button" className={styles.videoAddShotButton} onClick={handleAddShot}>
                              + Add shot
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className={styles.videoPromptSurface}>
                          <MentionTextarea
                            value={prompt}
                            onChange={setPrompt}
                            placeholder='Describe your video, like "A woman walking through a neon-lit city". Add elements using @'
                            rows={4}
                            textareaClassName={styles.videoPromptTextarea}
                            items={isKlingV3ElementsUI ? elementMentionItems : []}
                            onSelectItem={(it) => {
                              if (!isKlingV3ElementsUI) return true;
                              if (it.kind !== "element") return true;

                              let allowed = true;
                              setSelectedKlingElementIds((prev) => {
                                if (prev.includes(it.id)) return prev;
                                if (prev.length >= maxKlingElements) {
                                  allowed = false;
                                  return prev;
                                }
                                return [...prev, it.id];
                              });

                              if (!allowed) {
                                setError(`No puedes usar más de ${maxKlingElements} Elements a la vez. Elimina alguno del prompt.`);
                              }
                              return allowed;
                            }}
                          />
                        </div>

                        {canShowComposerActions && (
                          <div className={styles.videoPromptFooter}>
                            {capability.supportsSound && (
                              <button
                                type="button"
                                className={`${styles.videoActionBtn} ${klingSound ? styles.videoActionBtnActive : ""}`}
                                onClick={toggleSound}
                                aria-pressed={klingSound}
                              >
                                <Icon name="sound" />
                                <span>{klingSound ? "On" : "Off"}</span>
                              </button>
                            )}

                            {isKlingV3ElementsUI && (
                              <button
                                type="button"
                                className={`${styles.videoActionBtn} ${styles.videoActionBtnMuted} ${selectedKlingElementIds.length ? styles.videoActionBtnActive : ""}`}
                                onClick={() => openElementsForShot(null)}
                                title="Open Elements library"
                                aria-label="Open Elements library"
                              >
                                <Icon name="elements" />
                                <span>Elements</span>
                                <span className={styles.videoActionBtnMeta}>{selectedKlingElementIds.length}/{maxKlingElements}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className={styles.videoSelectorsStack}>
                    <button
                      type="button"
                      className={`${styles.videoSelectorButton} ${panel === "model" ? styles.videoSelectorButtonActive : ""}`}
                      onClick={() => setPanel("model")}
                    >
                      <span className={styles.videoSelectorTopLabel}>Model</span>
                      <span className={styles.videoSelectorValueRow}>
                        <span>{modelSelectorLabel}</span>
                        <span className={styles.videoSelectorChevron} aria-hidden="true">
                          ›
                        </span>
                      </span>
                    </button>

                    <div className={`${styles.videoQuickGrid} ${!showDurationSelector ? styles.videoQuickGridCompact : ""}`}>
                      {showDurationSelector && (
                        <button
                          type="button"
                          className={`${styles.videoQuickButton} ${panel === "duration" ? styles.videoSelectorButtonActive : ""}`}
                          onClick={() => setPanel("duration")}
                        >
                          <Icon name="clock" />
                          <span>{durationSelectorLabel}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className={`${styles.videoQuickButton} ${panel === "parameters" ? styles.videoSelectorButtonActive : ""}`}
                        onClick={() => setPanel("parameters")}
                      >
                        <Icon name="image" />
                        <span>{aspectSelectorLabel}</span>
                      </button>

                      <button
                        type="button"
                        className={`${styles.videoQuickButton} ${panel === "parameters" ? styles.videoSelectorButtonActive : ""}`}
                        onClick={() => setPanel("parameters")}
                      >
                        <Icon name="mode" />
                        <span>{resolutionSelectorLabel}</span>
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          )}

          {showCookActionDock && (
            <div className={styles.cookActionDockShell}>
              <div className={styles.cookActionDock}>
                <div className={styles.cookActionButtons}>
                  <button
                    type="button"
                    className={`${styles.cookDockButton} ${styles.cookDockStartButton}`}
                    onClick={closeCook}
                    aria-label="Close Start Create"
                  >
                    <span className={styles.cookDockText}>Start Create</span>
                    <span className={styles.cookDockGlyph} aria-hidden="true">×</span>
                  </button>

                  <button
                    type="button"
                    className={`${styles.cookDockButton} ${styles.cookDockGenerateButton}`}
                    disabled={generateDisabled}
                    onClick={handleGenerate}
                    data-loading={isGenerating ? "true" : "false"}
                  >
                    <span className={styles.videoGenerateLabelRow}>
                      <span>{isGenerating ? "Generating" : `Generate ✦ ${estimatedCostCredits}`}</span>
                      {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
                    </span>
                  </button>
                </div>

                {isGenerating && (
                  <div className={styles.cookDockMetaRow}>
                    <button type="button" className={styles.cookDockCancel} onClick={handleCancel}>
                      Cancel
                    </button>
                    {progressText && <div className={styles.cookDockProgress}>{progressText}</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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

      {VIDEO_ELEMENTS_UI_ENABLED && (
        <KlingElementsModal
          open={elementsOpen}
          onClose={() => {
            setElementsOpen(false);
            setElementsShotIndex(null);
          }}
          elements={klingElements}
          presetElements={presetKlingElements}
          query={elementsQuery}
          setQuery={setElementsQuery}
          selectedIds={modalSelectedIds}
          setSelectedIds={setModalSelectedIds}
          onClear={clearModalSelectedIds}
          imageAssets={imageAssets}
          videoAssets={videoLibraryAssets}
          getAssetUrl={getAssetUrl}
          onRefresh={() => loadKlingElementLibrary({ pollCustom: true, forcePresets: true })}
          onAssetUploaded={(asset) => {
            if (asset.type === "video") {
              setVideoLibraryAssets((prev) => [asset, ...prev.filter((x) => x.id !== asset.id)]);
            } else {
              setImageAssets((prev) => [asset, ...prev.filter((x) => x.id !== asset.id)]);
            }
          }}
          maxSelected={maxKlingElements || 5}
          uploadToolName="video-elements"
        />
      )}
    </div>
  );
};

export default VideoGeneratorTool;
