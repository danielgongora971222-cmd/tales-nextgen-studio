import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./VideoGeneratorTool.module.css";
import type { Asset } from "../../types";
import ErrorModal from "../../components/ErrorModal";
import { MentionTextarea, type MentionItem } from "../../components/MentionTextarea";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteAsset,
  downloadAssetToDisk,
  listMyAssetsPickerLibrary,
  listMyAssetsRobust,
  listMyElementLibraryAssets,
  uploadUserAsset,
} from "../../services/assetsApi";
import { apiPostJson, formatErr } from "../../services/videoGenApi";
import { formatJobFailure, waitJobCompletion } from "../../services/jobsApi";
import { useVideoGenerationLock } from "../../hooks/useVideoGenerationLock";
import { EditHistorySection } from "./video/EditHistorySection";
import { ViewerModal } from "./video/viewermodal";
import { Icon } from "./video/icon";
import { KlingElementsModal } from "./video/KlingElementsModal";
import { listKlingElements, type KlingElement } from "../../services/klingElementsService";
import { AssetPickerModal } from "./video/AssetPickerModal";
import { SeedanceRefsPickerModal } from "./video/SeedanceRefsPickerModal";
import { SeedanceAudioRefsPickerModal } from "./video/SeedanceAudioRefsPickerModal";
import {
  O3MultishotModal,
  O3_SHOT_PROMPT_LIMIT,
  type O3Shot,
} from "./video/O3MultishotModal";
import { LimitedTextarea } from "./video/LimitedTextarea";
import { MultishotModeModal } from "./video/MultishotModeModal";
import { estimateVideoCostCredits } from "../../config/pricing.js";
import { toggleLike } from "../../services/socialApi";
import { syncFavoriteAssetState } from "../../services/favoriteAssets";
import { clearCommunityRecipePrefill, getCommunityPrefillTarget, readCommunityRecipePrefill } from "../../services/communityRecipePrefill";

type EditModelId =
  | "kling-o3-ref-to-video-pro"
  | "kling-o3-edit-video-pro"
  | "kling-o3-ref-video-to-video-pro"
  | "seedance-2"
  | "seedance-2-fast"
  | "seedance-2-preview-vip";

type AspectRatio = "auto" | "21:9" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

const TOOL_NAME = "ingredients-to-video";
const PREFILL_TARGET = getCommunityPrefillTarget(TOOL_NAME);
const PENDING_KEY = "tales_pending_video_edit_job_v2:ingredients-to-video";

// 🔒 Feature flag: oculta Storyboard/Multishot SOLO en Edit Video Tool (por ahora)
const ENABLE_EDITVIDEO_MULTISHOT = true;

// 🔒 VIDEO: ocultar/deshabilitar Elements en editor de video
const VIDEO_ELEMENTS_UI_ENABLED = false;

type PendingVideoEditJob = {
  supabaseJobId: string;
  prompt: string;
  model: EditModelId;
  createdAt: number;
};

const isSeedancePreviewVipModelId = (value: string) => value === "seedance-2-preview-vip";
const isSeedanceModelId = (value: string) => value === "seedance-2" || value === "seedance-2-fast" || isSeedancePreviewVipModelId(value);
const coerceSeedanceDurationLocal = (value: number) => Math.max(4, Math.min(15, Math.trunc(Number(value) || 5)));
const coerceSeedancePreviewVipDurationLocal = (value: number) => {
  const n = Math.trunc(Number(value) || 5);
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  return 15;
};
const isSeedanceAspectRatio = (value: string) => ["21:9", "16:9", "9:16", "1:1", "4:3", "3:4"].includes(String(value || ""));
const isSeedancePreviewVipAspectRatio = (value: string) => ["16:9", "9:16", "4:3", "3:4"].includes(String(value || ""));
const MODEL_OPTIONS: Array<{
  id: EditModelId;
  uiName: string;
  uiDesc: string;
  uiHint: string;
}> = [
  {
    id: "kling-o3-ref-to-video-pro",
    uiName: "Ingredients to Video (Pro)",
    uiDesc:
      "Crea un video nuevo desde cero usando referencias visuales subidas. No usa START/END.",
    uiHint:
      "Usa entre 1 y 7 referencias. En el prompt puedes referenciar: @Image1..@Image7 (según tu selección).",
  },
  {
    id: "seedance-2",
    uiName: "Seedance 2",
    uiDesc:
      "Omni Reference de Seedance 2: admite imágenes, un video de referencia y audio refs.",
    uiHint:
      "Puedes usar hasta 12 refs combinadas entre imágenes, 1 video y audios. El audio solo no es válido: agrega al menos una imagen o un video.",
  },
  {
    id: "seedance-2-fast",
    uiName: "Seedance 2 Fast",
    uiDesc:
      "Variante más rápida de Seedance 2 para Ingredients to Video con Omni Reference.",
    uiHint:
      "Puedes usar hasta 12 refs combinadas entre imágenes, 1 video y audios. El audio solo no es válido: agrega al menos una imagen o un video.",
  },
  {
    id: "seedance-2-preview-vip",
    uiName: "Seedance 2.0 Pro",
    uiDesc:
      "Preview VIP de Seedance para Ingredients to Video con imágenes, 1 video y audio refs en un flujo compacto.",
    uiHint:
      "Usa hasta 9 refs combinadas, con un máximo de 3 audios. En esta tool se admite 1 video de referencia.",
  },
];

const DEFAULT_MODEL_ID: EditModelId = "kling-o3-ref-to-video-pro";

function coerceModelId(value: unknown): EditModelId {
  const raw = String(value || "").trim() as EditModelId;
  if (MODEL_OPTIONS.some((option) => option.id === raw)) return raw;

  const normalized = raw.toLowerCase();
  if (normalized.includes("preview-vip")) return "seedance-2-preview-vip";
  if (normalized.includes("seedance-2-fast")) return "seedance-2-fast";
  if (normalized.includes("seedance")) return "seedance-2";
  return DEFAULT_MODEL_ID;
}

function getMetaTool(a: Asset): string | null {
  const meta: any = (a as any)?.meta || {};
  return meta?.tool ?? null;
}

function getMetaSource(a: Asset): string | null {
  const meta: any = (a as any)?.meta || {};
  return meta?.source ?? null;
}

function getMetaCategory(a: Asset): string | null {
  const meta: any = (a as any)?.meta || {};
  return meta?.category ?? null;
}

function isElementAsset(a: Asset | null | undefined) {
  const meta: any = (a as any)?.meta || {};
  return (
    (a as any)?.tool === "element-library" ||
    meta?.tool === "element-library" ||
    meta?.isElement === true ||
    meta?.category === "element"
  );
}

function getAssetUrl(a: Asset): string | null {
  const u = (a as any)?.url;
  return typeof u === "string" && u.length > 0 ? u : null;
}

function mergeAssetsById(base: Asset[], incoming: Asset[]) {
  const map = new Map<string, Asset>();
  for (const asset of [...base, ...incoming]) {
    if (!asset?.id) continue;
    map.set(asset.id, { ...(map.get(asset.id) || {} as Asset), ...asset });
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

const FRAME_UPLOAD_TOOL = "video-gen-frame";

function slugifyName(s: string) {
  return (
    (s || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 28) || "item"
  );
}

function makeElementTag(name: string) {
  return `@${slugifyName(name || "element")}`;
}

function makeImageTag(name: string) {
  return `@img_${slugifyName(name || "image")}`;
}

function extractMentionTokens(text: string) {
  return (text || "").match(/@[a-z0-9_]+/gi) ?? [];
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

export default function IngredientsToVideoTool() {
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
  const [elementLibraryAssets, setElementLibraryAssets] = useState<Asset[]>([]);
  const [videoAssets, setVideoAssets] = useState<Asset[]>([]);
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isLoadingElementLibrary, setIsLoadingElementLibrary] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [isLoadingAudios, setIsLoadingAudios] = useState(false);

  // ===== UI state =====
  const [panel, setPanel] = useState<null | "model" | "params">(null);
  const [isCookOpen, setIsCookOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const [model, setModel] = useState<EditModelId>(DEFAULT_MODEL_ID);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [durationSeconds, setDurationSeconds] = useState<number>(8);

  const [startImage, setStartImage] = useState<Asset | null>(null);
  const [endImage, setEndImage] = useState<Asset | null>(null);
  const [inputVideo, setInputVideo] = useState<Asset | null>(null);

  const [referenceImageIds, setReferenceImageIds] = useState<string[]>([]);
  const [audioReferenceIds, setAudioReferenceIds] = useState<string[]>([]);
  const [sessionUploadedImageIds, setSessionUploadedImageIds] = useState<string[]>([]);
  const [klingElementIds, setKlingElementIds] = useState<string[]>([]);
  const [klingElements, setKlingElements] = useState<KlingElement[]>([]);
  const [isLoadingElements, setIsLoadingElements] = useState(false);
  const [elementsQuery, setElementsQuery] = useState("");

  const [generateAudio, setGenerateAudio] = useState(false);
  const [keepAudio, setKeepAudio] = useState(true);

  const [multishotEnabled, setMultishotEnabled] = useState(false);
  const [multishotMode, setMultishotMode] = useState<"intelligence" | "customize">("intelligence");
  const isStoryboardMode = ENABLE_EDITVIDEO_MULTISHOT && multishotEnabled && multishotMode === "customize";

  const [shots, setShots] = useState<O3Shot[]>([{ prompt: "", durationSeconds: 5 }]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progressText, setProgressText] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Viewer
  const [viewer, setViewer] = useState<Asset | null>(null);
  const hoverVideoEls = useRef<Record<string, HTMLVideoElement | null>>({});
  const [likeBusyById, setLikeBusyById] = useState<Record<string, boolean>>({});
  const prefillAppliedRef = useRef(false);
  const [pendingExternalPrefill, setPendingExternalPrefill] = useState<any | null>(null);

  // Modals
  const [pickerOpen, setPickerOpen] = useState<null | "start" | "end" | "video">(null);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [refAudioPickerOpen, setRefAudioPickerOpen] = useState(false);
  const [elementsOpen, setElementsOpen] = useState(false);

  useEffect(() => {
    if (VIDEO_ELEMENTS_UI_ENABLED) return;
    setKlingElementIds([]);
    setElementsOpen(false);
  }, []);

const [multishotOpen, setMultishotOpen] = useState(false);
const [multishotModeOpen, setMultishotModeOpen] = useState(false);

  // Pending resume
  const [pendingJob, setPendingJob] = useState<PendingVideoEditJob | null>(null);
  const autoResumeAttemptedJobIdRef = useRef<string | null>(null);

  const { hasActiveVideoJob, busyMessage: activeVideoBusyMessage } = useVideoGenerationLock();
  const videoSlotBusy = hasActiveVideoJob && !isGenerating;

  const selectedModel = useMemo(() => MODEL_OPTIONS.find((m) => m.id === coerceModelId(model)) ?? MODEL_OPTIONS[0], [model]);

  useEffect(() => {
    const nextModel = coerceModelId(model);
    if (nextModel !== model) setModel(nextModel);
  }, [model]);
  const isSeedanceModel = useMemo(() => isSeedanceModelId(model), [model]);
  const isSeedancePreviewVipModel = useMemo(() => isSeedancePreviewVipModelId(model), [model]);

  const shotsWithPrompt = useMemo(
    () => shots.filter((s) => (s.prompt || "").trim().length > 0),
    [shots]
  );

  const multishotTotalSeconds = useMemo(
    () => sumSeconds(shotsWithPrompt),
    [shotsWithPrompt]
  );

  const estimatedCostCredits = useMemo(() => {
    const dur = isStoryboardMode ? multishotTotalSeconds : durationSeconds;
    return estimateVideoCostCredits({
      modelNorm: model,
      durationSeconds: isSeedanceModel
        ? (isSeedancePreviewVipModel ? coerceSeedancePreviewVipDurationLocal(dur) : coerceSeedanceDurationLocal(dur))
        : dur,
      resolution: "1080p",
      generateAudio: isSeedanceModel ? false : generateAudio,
      klingMode: "pro",
      seedanceMode: isSeedanceModel ? "generate" : undefined,
      inputVideoDurationSeconds: isSeedanceModel && inputVideo ? Number((inputVideo as any)?.meta?.durationSeconds || 0) : undefined,
      hasVideoReference: undefined,
    });
  }, [model, durationSeconds, isStoryboardMode, multishotTotalSeconds, generateAudio, isSeedanceModel, isSeedancePreviewVipModel, inputVideo]);

  const combinedRefsCount = isSeedanceModel
    ? referenceImageIds.length + audioReferenceIds.length + (inputVideo ? 1 : 0)
    : referenceImageIds.length + klingElementIds.length;
  const maxCombinedRefs = isSeedanceModel
    ? (isSeedancePreviewVipModel ? 9 : 12)
    : (model === "kling-o3-ref-to-video-pro" ? 7 : 4);

  useEffect(() => {
    if (!isSeedanceModel) {
      if (audioReferenceIds.length) setAudioReferenceIds([]);
      if (aspectRatio === "4:3") setAspectRatio("16:9");
      if (aspectRatio === "3:4") setAspectRatio("9:16");
      if (aspectRatio === "21:9" || aspectRatio === "1:1") setAspectRatio("16:9");
      return;
    }

    const nextDuration = isSeedancePreviewVipModel
      ? coerceSeedancePreviewVipDurationLocal(durationSeconds)
      : coerceSeedanceDurationLocal(durationSeconds);
    if (nextDuration !== durationSeconds) setDurationSeconds(nextDuration);

    const aspectIsValid = isSeedancePreviewVipModel
      ? isSeedancePreviewVipAspectRatio(aspectRatio)
      : isSeedanceAspectRatio(aspectRatio);
    const defaultAspect = "16:9";
    if (!aspectIsValid) setAspectRatio(defaultAspect);

    if (isSeedancePreviewVipModel && audioReferenceIds.length > 3) {
      setAudioReferenceIds((prev) => prev.slice(0, 3));
    }
  }, [isSeedanceModel, isSeedancePreviewVipModel, durationSeconds, aspectRatio, audioReferenceIds.length]);
  const maxRefImages = isSeedanceModel
    ? Math.max(0, Math.min(isSeedancePreviewVipModel ? 9 : 12, maxCombinedRefs - audioReferenceIds.length - (inputVideo ? 1 : 0)))
    : Math.max(0, maxCombinedRefs - klingElementIds.length);
  const maxElements = Math.max(0, maxCombinedRefs - referenceImageIds.length);
  const maxAudioRefs = isSeedanceModel
    ? Math.max(0, Math.min(isSeedancePreviewVipModel ? 3 : 12, maxCombinedRefs - referenceImageIds.length - (inputVideo ? 1 : 0)))
    : 0;

  // ===============================
  // Mentions (@) para referencias + Elements (Kling O3)
  // - El usuario escribe tokens:
  //    - Imágenes: @img_xxx (dropdown)
  //    - Elements: @xxx (dropdown)
  //    - Video base (video→video): @video1
  // - Antes de enviar al modelo:
  //    - convertimos a @Image1.. y @Element1.. en el prompt,
  //    - y ordenamos referenceImageIds / klingElementIds para que coincidan.
  // - Excluimos START/END y frames (first/last) del dropdown de referencias.
  // ===============================
  const excludeIdsFromMentions = useMemo(() => {
    const s = new Set<string>();
    if (startImage?.id) s.add(startImage.id);
    if (endImage?.id) s.add(endImage.id);
    return s;
  }, [startImage?.id, endImage?.id]);

  const allReferenceImageAssets = useMemo(
    () => mergeAssetsById(imageAssets, elementLibraryAssets),
    [imageAssets, elementLibraryAssets]
  );

  const referenceHistoryImages = useMemo(
    () => allReferenceImageAssets.filter((asset) => !isElementAsset(asset)),
    [allReferenceImageAssets]
  );
  const referenceElementImages = useMemo(
    () => allReferenceImageAssets.filter((asset) => isElementAsset(asset)),
    [allReferenceImageAssets]
  );

  const referenceHistoryAudios = useMemo(
    () => (audioAssets || []).filter(Boolean),
    [audioAssets]
  );

  const mentionableRefImages = useMemo(() => {
    return allReferenceImageAssets
      .filter((a) => !!getAssetUrl(a))
      .filter((a) => !excludeIdsFromMentions.has(a.id))
      .filter((a) => getMetaTool(a) !== FRAME_UPLOAD_TOOL)
      .sort((a: any, b: any) => {
        const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
  }, [allReferenceImageAssets, excludeIdsFromMentions]);

  const refImageTokenById = useMemo(() => {
    const reserved = new Set<string>([
      "@video1",
      "@image1",
      "@image2",
      "@image3",
      "@image4",
      "@image5",
      "@image6",
      "@image7",
      "@image8",
      "@image9",
      "@element1",
      "@element2",
      "@element3",
      "@element4",
      "@element5",
      "@element6",
      "@element7",
    ]);


    const used = new Set<string>(reserved);
    const map = new Map<string, string>(); // assetId -> token

    const alloc = (raw: string) => {
      let token = String(raw || "").trim();
      if (!token) return "";
      if (!token.startsWith("@")) token = `@${token}`;

      const base = token;
      if (used.has(token)) {
        let n = 2;
        while (used.has(`${base}_${n}`)) n++;
        token = `${base}_${n}`;
      }
      used.add(token);
      return token;
    };

    for (const a of mentionableRefImages) {
      const name = String((a as any).name || (a as any).prompt || "image");
      const base = makeImageTag(name);
      const tok = alloc(base);
      if (tok) map.set(a.id, tok);
    }
    return map;
  }, [mentionableRefImages]);

  const elementTokenById = useMemo(() => {
    const reserved = new Set<string>([
      "@video1",
      "@image1",
      "@image2",
      "@image3",
      "@image4",
      "@element1",
      "@element2",
      "@element3",
      "@element4",
      "@element5",
    ]);
    const used = new Set<string>(reserved);
    const map = new Map<string, string>(); // elementId -> token

    for (const el of klingElements || []) {
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
  }, [klingElements]);

  const imageTokenToId = useMemo(() => {
    const m = new Map<string, string>(); // token(lower) -> assetId
    for (const [id, tok] of refImageTokenById.entries()) m.set(tok.toLowerCase(), id);
    return m;
  }, [refImageTokenById]);

  const mentionPromptRefImages = useMemo(() => {
    const selected = referenceImageIds
      .map((id) => mentionableRefImages.find((a) => a.id === id) || null)
      .filter(Boolean) as Asset[];

    const uploaded = sessionUploadedImageIds
      .map((id) => mentionableRefImages.find((a) => a.id === id) || null)
      .filter(Boolean) as Asset[];

    const seen = new Set<string>();
    const merged: Asset[] = [];
    for (const asset of [...selected, ...uploaded]) {
      if (!asset?.id || seen.has(asset.id)) continue;
      seen.add(asset.id);
      merged.push(asset);
    }
    return merged;
  }, [referenceImageIds, sessionUploadedImageIds, mentionableRefImages]);

  const elementTokenToId = useMemo(() => {
    const m = new Map<string, string>(); // token(lower) -> elementId
    for (const [id, tok] of elementTokenById.entries()) m.set(tok.toLowerCase(), id);
    return m;
  }, [elementTokenById]);

  const promptMentionItems: MentionItem[] = useMemo(() => {
    const out: MentionItem[] = [];

    const needsVideo = model !== "kling-o3-ref-to-video-pro";
    if (needsVideo) {
      out.push({ id: "video1", token: "@video1", label: "video1 (entrada)", kind: "video", previewUrl: null });
      out.push({ id: "video1", token: "@Video1", label: "Video1 (entrada)", kind: "video", previewUrl: null, hidden: true });
    }

    // Aliases numéricos para lo YA seleccionado (compat + fácil de usar)
    for (let i = 0; i < referenceImageIds.length; i++) {
      const id = referenceImageIds[i];
      const a = (imageAssets || []).find((x) => x.id === id) || null;
      if (!a) continue;
      if (excludeIdsFromMentions.has(a.id)) continue;
      if (getMetaTool(a) === FRAME_UPLOAD_TOOL) continue;

      const url = getAssetUrl(a);
      const labelName = a?.name ? ` · ${a.name}` : "";
      out.push({ id, token: `@image${i + 1}`, label: `image${i + 1}${labelName}`, kind: "ref", previewUrl: url });
      out.push({ id, token: `@Image${i + 1}`, label: `Image${i + 1}${labelName}`, kind: "ref", previewUrl: url, hidden: true });
    }

    for (let i = 0; i < klingElementIds.length; i++) {
      const id = klingElementIds[i];
      const el = (klingElements || []).find((x) => x.id === id) || null;
      const previewUrl = (el as any)?.previewUrl || (el as any)?.imageUrls?.[0] || null;
      const labelName = el?.name ? ` · ${el.name}` : "";
      out.push({ id, token: `@element${i + 1}`, label: `element${i + 1}${labelName}`, kind: "element", previewUrl });
      out.push({ id, token: `@Element${i + 1}`, label: `Element${i + 1}${labelName}`, kind: "element", previewUrl, hidden: true });
    }

    // Elements (slug tokens)
    const selectedElSet = new Set(klingElementIds);
    const orderedEls = [
      ...(klingElementIds.map((id) => klingElements.find((e) => e.id === id)).filter(Boolean) as KlingElement[]),
      ...((klingElements || []).filter((e) => !selectedElSet.has(e.id))),
    ];

    for (const el of orderedEls) {
      const token = elementTokenById.get(el.id) || makeElementTag(el.name || "element");
      const previewUrl = (el as any)?.previewUrl || (el as any)?.imageUrls?.[0] || null;
      out.push({ id: el.id, token, label: el.name || "Element", kind: "element", previewUrl });
    }

    // Referencias de imagen para @
    // - Solo mostramos referencias ya seleccionadas
    // - y también imágenes subidas localmente en esta sesión de la tool
    for (const a of mentionPromptRefImages) {
      const token = refImageTokenById.get(a.id) || makeImageTag(a.name || "image");
      const url = getAssetUrl(a);
      out.push({ id: a.id, token, label: a.name || "Image", kind: "ref", previewUrl: url });
    }

    return out;
  }, [
    model,
    referenceImageIds,
    klingElementIds,
    imageAssets,
    klingElements,
    elementTokenById,
    refImageTokenById,
    mentionableRefImages,
    mentionPromptRefImages,
    excludeIdsFromMentions,
  ]);

  const multishotReady = useMemo(() => {
    if (!isStoryboardMode) return true;
    if (shotsWithPrompt.length === 0) return false;
    if (multishotTotalSeconds < 3 || multishotTotalSeconds > 15) return false;
    if (shotsWithPrompt.some((s) => (s.prompt || "").length > O3_SHOT_PROMPT_LIMIT)) return false;
    return true;
  }, [isStoryboardMode, shotsWithPrompt, multishotTotalSeconds]);

  const referencePreviewAssets = useMemo(
    () => referenceImageIds.map((id) => allReferenceImageAssets.find((asset) => asset.id === id) || null).filter((asset): asset is Asset => Boolean(asset)),
    [referenceImageIds, allReferenceImageAssets]
  );
  const visibleReferencePreviewAssets = referencePreviewAssets.slice(0, 3);
  const hiddenReferencePreviewCount = Math.max(0, referencePreviewAssets.length - visibleReferencePreviewAssets.length);

  const visibleHistory = useMemo(() => history.slice(0, visibleCount), [history, visibleCount]);
  const hasMore = history.length > visibleHistory.length;

  const pendingSlots = useMemo(() => {
    if (isGenerating) return ["pending-1"];
    if (pendingJob) return ["pending-resume-1"];
    return [];
  }, [isGenerating, pendingJob]);

  const viewerRecipeInfo = useMemo(() => {
    if (!viewer) return null;

    const meta: any = (viewer as any).meta || {};

    const modelId = typeof meta.model === "string" ? meta.model : null;
    const aspect = typeof meta.aspectRatio === "string" ? meta.aspectRatio : null;
    const resolutionSaved = typeof meta.resolution === "string" ? meta.resolution : null;
    const dur = typeof meta.durationSeconds === "number" ? meta.durationSeconds : null;

    const firstId = typeof meta.firstFrameAssetId === "string" ? meta.firstFrameAssetId : null;
    const lastId = typeof meta.lastFrameAssetId === "string" ? meta.lastFrameAssetId : null;

    const first = firstId ? allReferenceImageAssets.find((a) => a.id === firstId) || null : null;
    const last = lastId ? allReferenceImageAssets.find((a) => a.id === lastId) || null : null;

    const editRaw = meta.editVideo && typeof meta.editVideo === "object" ? meta.editVideo : null;

    const referenceImageAssetIds: string[] = Array.isArray(editRaw?.referenceImageAssetIds)
      ? editRaw.referenceImageAssetIds.map(String)
      : [];

    const klingElementIds: string[] = Array.isArray(editRaw?.klingElementIds)
      ? editRaw.klingElementIds.map(String)
      : [];

    const referenceImages = referenceImageAssetIds
      .map((id) => allReferenceImageAssets.find((a) => a.id === id) || null)
      .filter(Boolean) as Asset[];

    const elements = klingElementIds
      .map((id) => klingElements.find((e) => e.id === id) || null)
      .filter(Boolean) as KlingElement[];

    const startImage =
      typeof editRaw?.startImageAssetId === "string"
        ? allReferenceImageAssets.find((a) => a.id === editRaw.startImageAssetId) || null
        : null;

    const endImage =
      typeof editRaw?.endImageAssetId === "string"
        ? allReferenceImageAssets.find((a) => a.id === editRaw.endImageAssetId) || null
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
  }, [viewer, allReferenceImageAssets, videoAssets, klingElements]);

  // ===== Local storage (pending) =====
  const loadPending = useCallback((): PendingVideoEditJob | null => {

    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.supabaseJobId || !parsed?.prompt || !parsed?.model) return null;
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
    if (!user) return [] as Asset[];
    setIsLoadingImages(true);
    try {
      const imgs = await listMyAssetsPickerLibrary({ type: "image", limit: 500, fresh: true });
      setImageAssets(Array.isArray(imgs) ? imgs : []);
      return Array.isArray(imgs) ? imgs : [];
    } catch (err: any) {
      console.warn(err);
      return [] as Asset[];
    } finally {
      setIsLoadingImages(false);
    }
  }, [user]);

  const reloadElementLibrary = useCallback(async () => {
    if (!user) return [] as Asset[];
    setIsLoadingElementLibrary(true);
    try {
      const elements = await listMyElementLibraryAssets({ limit: 300, fresh: true });
      setElementLibraryAssets(Array.isArray(elements) ? elements : []);
      return Array.isArray(elements) ? elements : [];
    } catch (err: any) {
      console.warn(err);
      return [] as Asset[];
    } finally {
      setIsLoadingElementLibrary(false);
    }
  }, [user]);

  const reloadVideos = useCallback(async () => {
    if (!user) return [] as Asset[];
    setIsLoadingVideos(true);
    try {
      const vids = await listMyAssetsRobust({ type: "video", limit: 250, fresh: true });
      setVideoAssets(Array.isArray(vids) ? vids : []);
      return Array.isArray(vids) ? vids : [];
    } catch (err: any) {
      console.warn(err);
      return [] as Asset[];
    } finally {
      setIsLoadingVideos(false);
    }
  }, [user]);

  const reloadAudios = useCallback(async () => {
    if (!user) return [] as Asset[];
    setIsLoadingAudios(true);
    try {
      const audios = await listMyAssetsRobust({ type: "audio", limit: 250, fresh: true });
      setAudioAssets(Array.isArray(audios) ? audios : []);
      return Array.isArray(audios) ? audios : [];
    } catch (err: any) {
      console.warn(err);
      return [] as Asset[];
    } finally {
      setIsLoadingAudios(false);
    }
  }, [user]);

  const reloadHistory = useCallback(async () => {
    if (!user) return [] as Asset[];
    setIsLoadingHistory(true);
    try {
      const vids = await listMyAssetsRobust({ type: "video", limit: 250, fresh: true });
      const filtered = vids.filter((a) => getMetaTool(a) === TOOL_NAME);
      setHistory(filtered);
      setVisibleCount(18);
      return filtered;
    } catch (err: any) {
      setError(formatErr(err));
      return [] as Asset[];
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
    const readPrefill = () => {
      const payload = readCommunityRecipePrefill(TOOL_NAME);
      if (payload) setPendingExternalPrefill(payload);
    };

    readPrefill();
    const onPrefill = () => readPrefill();
    window.addEventListener(PREFILL_TARGET.event, onPrefill as any);
    return () => window.removeEventListener(PREFILL_TARGET.event, onPrefill as any);
  }, []);

  useEffect(() => {
    if (!user) {
      setImageAssets([]);
      setElementLibraryAssets([]);
      setVideoAssets([]);
      setAudioAssets([]);
      setHistory([]);
      return;
    }

    void (async () => {
      await Promise.all([
        reloadImages(),
        reloadElementLibrary(),
        reloadVideos(),
        reloadAudios(),
        reloadHistory(),
        VIDEO_ELEMENTS_UI_ENABLED ? reloadKlingElements() : Promise.resolve([]),
      ]);
    })();
  }, [user?.id, reloadImages, reloadElementLibrary, reloadVideos, reloadAudios, reloadHistory, reloadKlingElements]);

  useEffect(() => {
    if (!pickerOpen && !refPickerOpen && !refAudioPickerOpen) return;

    void (async () => {
      const tasks: Promise<any>[] = [];
      if (pickerOpen === "video") tasks.push(reloadVideos());
      if (pickerOpen === "start" || pickerOpen === "end" || refPickerOpen) tasks.push(reloadImages());
      if (refPickerOpen) tasks.push(reloadElementLibrary());
      if (refAudioPickerOpen) tasks.push(reloadAudios());
      await Promise.all(tasks);
    })();
  }, [pickerOpen, refPickerOpen, refAudioPickerOpen, reloadElementLibrary, reloadImages, reloadVideos, reloadAudios]);

  useEffect(() => {
    if (!(ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode)) return;
    if (endImage) setEndImage(null);
    if (pickerOpen === "end") setPickerOpen(null);
  }, [isStoryboardMode, endImage, pickerOpen]);

  useEffect(() => {
    const run = async () => {
      const pj = loadPending();
      setPendingJob(pj);

      if (!pj) {
        autoResumeAttemptedJobIdRef.current = null;
        return;
      }

      if (autoResumeAttemptedJobIdRef.current === pj.supabaseJobId) return;
      autoResumeAttemptedJobIdRef.current = pj.supabaseJobId;

      setIsGenerating(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        await runWaitFlow(pj.supabaseJobId);
      } catch (err: any) {
        if (err?.clearPending) {
          clearPending();
          setPendingJob(null);
          autoResumeAttemptedJobIdRef.current = null;
        }
        setError(formatErr(err));
        setProgressText("");
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
      }
    };

    void run();
  }, [user, reloadImages, reloadVideos, reloadHistory, reloadKlingElements, loadPending, clearPending]);


  useEffect(() => {
    if (prefillAppliedRef.current) return;
    if (!pendingExternalPrefill) return;
    if (isLoadingHistory || isLoadingImages || isLoadingVideos) return;

    const payload = pendingExternalPrefill;
    const source = payload?.recipe?.sourceAsset || {};
    const fakeAsset: Asset = {
      id: String(source?.id || `prefill-${TOOL_NAME}`),
      url: "",
      type: "video",
      name: String(source?.tool || TOOL_NAME),
      prompt: typeof source?.prompt === "string" ? source.prompt : "",
      tool: source?.tool || undefined,
      meta: source?.meta || {},
      createdAt: Date.now(),
      ownerId: String(user?.id || ""),
      isPublic: false,
      likedByMe: false,
      likesCount: 0,
      commentsCount: 0,
      likes: [],
      comments: [],
    };

    applyRecipeFromAsset(fakeAsset, payload);
    prefillAppliedRef.current = true;
    setPendingExternalPrefill(null);
    clearCommunityRecipePrefill(TOOL_NAME);
  }, [pendingExternalPrefill, isLoadingHistory, isLoadingImages, isLoadingVideos, applyRecipeFromAsset, user?.id]);

  // Keep state coherent when switching models
  useEffect(() => {
    // Si el feature flag está apagado, multishot queda siempre desactivado
    if (!ENABLE_EDITVIDEO_MULTISHOT) {
      setMultishotEnabled(false);
      setMultishotOpen(false);
    }

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
    setSessionUploadedImageIds((prev) => (prev.includes(a.id) ? prev : [a.id, ...prev]));
    return a;
  }, []);

  const uploadVideo = useCallback(async (file: File) => {
    const a = await uploadUserAsset(file, { tool: TOOL_NAME, category: "video", type: "video" });
    setVideoAssets((prev) => [a, ...prev]);
    return a;
  }, []);

  const uploadAudio = useCallback(async (file: File) => {
    const a = await uploadUserAsset(file, {
      tool: TOOL_NAME,
      category: "audio",
      type: "video",
      meta: {
        category: "audio",
        mimeType: file.type || "audio/mpeg",
      },
    });
    setAudioAssets((prev) => [a, ...prev.filter((asset) => asset.id !== a.id)]);
    return a;
  }, []);

  // ===== Actions (history) =====
  const onTogglePublish = useCallback(
    (asset: Asset) => {
      window.dispatchEvent(new CustomEvent("tales:open-sell", { detail: { asset } }));
    },
    []
  );

  const onDownload = useCallback(async (asset: Asset) => {
    try {
      await downloadAssetToDisk(asset.id, asset.name || "video");
    } catch (err: any) {
      setError(formatErr(err));
    }
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

  const onToggleLike = useCallback(
    async (asset: Asset) => {
      if (!user) {
        setError("Debes iniciar sesión para dar Like.");
        return;
      }
      if (likeBusyById[asset.id]) return;

      setLikeBusyById((prev) => ({ ...prev, [asset.id]: true }));
      try {
        const res = await toggleLike(asset.id);
        syncFavoriteAssetState(asset.id, res.liked);
        setHistory((prev) =>
          prev.map((entry) => (entry.id === asset.id ? { ...entry, likedByMe: res.liked, likesCount: res.likesCount } : entry))
        );
        setViewer((prev) =>
          prev && prev.id === asset.id ? { ...prev, likedByMe: res.liked, likesCount: res.likesCount } : prev
        );
      } catch (err: any) {
        setError(formatErr(err));
      } finally {
        setLikeBusyById((prev) => ({ ...prev, [asset.id]: false }));
      }
    },
    [user, likeBusyById]
  );

  function applyRecipeFromAsset(asset: Asset, payload?: { recipe?: any; resolvedAssets?: any[] } | null) {
      const source = payload?.recipe?.sourceAsset || asset;
      const meta: any = source?.meta || (asset as any)?.meta || {};
      const promptValue = typeof source?.prompt === "string" ? source.prompt : asset.prompt || "";
      const resolvedAssets = Array.isArray(payload?.resolvedAssets) ? payload.resolvedAssets : [];
      const byId = new Map<string, any>();
      for (const item of resolvedAssets) {
        if (item?.assetId) byId.set(String(item.assetId), item);
      }

      const incomingImages: Asset[] = [];
      const incomingVideos: Asset[] = [];

      const resolveImage = (id: any) => {
        if (typeof id !== "string" || !id) return null;
        const existing = allReferenceImageAssets.find((entry) => entry.id === id) || null;
        if (existing) return existing;
        const temp = makeResolvedAsset(byId.get(id), "image");
        if (temp) incomingImages.push(temp);
        return temp;
      };

      const resolveVideo = (id: any) => {
        if (typeof id !== "string" || !id) return null;
        const existing = videoAssets.find((entry) => entry.id === id) || null;
        if (existing) return existing;
        const temp = makeResolvedAsset(byId.get(id), "video");
        if (temp) incomingVideos.push(temp);
        return temp;
      };

      setPrompt(promptValue);
      if (typeof meta.model === "string") setModel(coerceModelId(meta.model));
      if (typeof meta.aspectRatio === "string") setAspectRatio(meta.aspectRatio as any);
      if (typeof meta.durationSeconds === "number") setDurationSeconds(meta.durationSeconds);

      const first = resolveImage(meta.firstFrameAssetId);
      const last = resolveImage(meta.lastFrameAssetId);
      setStartImage(resolveImage(meta?.editVideo?.startImageAssetId) || first);
      setEndImage(resolveImage(meta?.editVideo?.endImageAssetId) || last);
      setInputVideo(resolveVideo(meta?.editVideo?.videoAssetId));

      const nextRefIds = Array.isArray(meta?.editVideo?.referenceImageAssetIds)
        ? meta.editVideo.referenceImageAssetIds.map(String).filter(Boolean)
        : [];
      for (const id of nextRefIds) resolveImage(id);
      setReferenceImageIds(nextRefIds);

      const nextElementIds = Array.isArray(meta?.editVideo?.klingElementIds)
        ? meta.editVideo.klingElementIds.map(String).filter(Boolean)
        : [];
      setKlingElementIds(nextElementIds);

      if (typeof meta?.editVideo?.generateAudio === "boolean") setGenerateAudio(meta.editVideo.generateAudio);
      if (typeof meta?.editVideo?.keepAudio === "boolean") setKeepAudio(meta.editVideo.keepAudio);

      const multiPrompt = Array.isArray(meta?.editVideo?.multiPrompt) ? meta.editVideo.multiPrompt : [];
      if (multiPrompt.length > 0) {
        setShots(
          multiPrompt.map((shot: any) => ({
            prompt: String(shot?.prompt || ""),
            durationSeconds: Number.isFinite(Number(shot?.durationSeconds ?? shot?.duration)) ? Number(shot?.durationSeconds ?? shot?.duration) : 5,
          }))
        );
      }

      if (incomingImages.length > 0) setImageAssets((prev) => mergeAssetsById(prev, incomingImages));
      if (incomingVideos.length > 0) setVideoAssets((prev) => mergeAssetsById(prev, incomingVideos));

      setPanel(null);
      setViewer(null);
  }

    // ===== Limits for references (Elements modal + images modal) =====
  const setKlingElementIdsLimited = useCallback<React.Dispatch<React.SetStateAction<string[]>>>(
    (next) => {
      setKlingElementIds((prev) => {
        const value = typeof next === "function" ? (next as any)(prev) : next;
        if (value.length > maxElements) {
          setError(
            `Máximo ${maxElements} Elements porque ya tienes ${referenceImageIds.length} imágenes de referencia (máx ${maxCombinedRefs} combinado).`
          );
          return prev;
        }
        return value;
      });
    },
    [maxElements, referenceImageIds.length]
  );

  const setReferenceImageIdsLimited = useCallback<React.Dispatch<React.SetStateAction<string[]>>>(
    (next) => {
      setReferenceImageIds((prev) => {
        const value = typeof next === "function" ? (next as any)(prev) : next;
        if (value.length > maxRefImages) {
          setError(
            `Máximo ${maxRefImages} imágenes de referencia porque ya tienes ${klingElementIds.length} Elements (máx ${maxCombinedRefs} combinado).`
          );
          return prev;
        }
        return value;
      });
    },
    [maxRefImages, klingElementIds.length]
  );

  // ✅ Sync referencias (imágenes) con el prompt (slug tokens):
  // - Si borras un token de imagen del prompt -> se deselecciona.
  // - Si agregas un token -> se selecciona (hasta el límite actual).
  const prevPromptImageTokensRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode) return;

    const tokens = extractMentionTokens(prompt).map((t) => t.toLowerCase());

    const current = new Set<string>();
    for (const t of tokens) if (imageTokenToId.has(t)) current.add(t);

    const prev = prevPromptImageTokensRef.current;
    const removed: string[] = [];
    const added: string[] = [];

    for (const t of prev) if (!current.has(t)) removed.push(t);
    for (const t of current) if (!prev.has(t)) added.push(t);

    if (removed.length || added.length) {
      setReferenceImageIdsLimited((prevIds) => {
        const beforeIds = Array.isArray(prevIds) ? prevIds : [];
        let nextIds = beforeIds;

        if (removed.length) {
          const removedIds = removed.map((t) => imageTokenToId.get(t)).filter(Boolean) as string[];
          if (removedIds.length) nextIds = nextIds.filter((id) => !removedIds.includes(id));
        }

        if (added.length) {
          const temp = [...nextIds];
          for (const t of added) {
            const id = imageTokenToId.get(t);
            if (!id) continue;
            if (temp.includes(id)) continue;
            if (temp.length >= maxRefImages) break;
            temp.push(id);
          }
          nextIds = temp;
        }

        if (nextIds.length > maxRefImages) nextIds = nextIds.slice(0, maxRefImages);

        const same = nextIds.length === beforeIds.length && nextIds.every((id, i) => id === beforeIds[i]);
        return same ? beforeIds : nextIds;
      });
    }

    prevPromptImageTokensRef.current = current;

    if (current.size > maxRefImages) {
      setError(`No puedes usar más de ${maxRefImages} imágenes de referencia a la vez (máx ${maxCombinedRefs} combinado).`);
    }
  }, [prompt, imageTokenToId, maxRefImages, setReferenceImageIdsLimited, multishotEnabled]);

  // ✅ Sync Elements con el prompt (slug tokens):
  // - Si borras un token de Element del prompt -> se deselecciona.
  // - Si agregas un token -> se selecciona (hasta el límite actual).
  const prevPromptElementTokensRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode) return;

    const tokens = extractMentionTokens(prompt).map((t) => t.toLowerCase());

    const current = new Set<string>();
    for (const t of tokens) if (elementTokenToId.has(t)) current.add(t);

    const prev = prevPromptElementTokensRef.current;
    const removed: string[] = [];
    const added: string[] = [];

    for (const t of prev) if (!current.has(t)) removed.push(t);
    for (const t of current) if (!prev.has(t)) added.push(t);

    if (removed.length || added.length) {
      setKlingElementIdsLimited((prevIds) => {
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
            if (temp.length >= maxElements) break;
            temp.push(id);
          }
          nextIds = temp;
        }

        if (nextIds.length > maxElements) nextIds = nextIds.slice(0, maxElements);

        const same = nextIds.length === beforeIds.length && nextIds.every((id, i) => id === beforeIds[i]);
        return same ? beforeIds : nextIds;
      });
    }

    prevPromptElementTokensRef.current = current;

    if (current.size > maxElements) {
      setError(`No puedes usar más de ${maxElements} Elements a la vez (máx ${maxCombinedRefs} combinado).`);
    }
  }, [prompt, elementTokenToId, maxElements, setKlingElementIdsLimited, multishotEnabled]);

    // ===== Generation =====
    type BuildRequestResult =
      | { ok: false; error: string }
      | { ok: true; body: any; finalPrompt: string; endpoint?: string };

    const validateAndBuildRequest = useCallback((): BuildRequestResult => {
    // Construye prompt + orden de refs/elements en función de los @tokens.
    // - En el prompt el usuario puede escribir:
    //    - Imágenes: @img_xxx (dropdown) o @Image1/@image1 (alias numérico)
    //    - Elements: @xxx (dropdown) o @Element1/@element1 (alias numérico)
    //    - Video base: @video1 / @Video1
    // - Antes de enviar al modelo convertimos a @ImageN/@ElementN y ordenamos arrays.

    const normalizeAspectRatio = (arIn: AspectRatio): AspectRatio => {
      // Kling O3 reference-to-video suele trabajar mejor con AR explícito
      if (model === "kling-o3-ref-to-video-pro" && arIn === "auto") return "16:9";
      if (isSeedanceModelId(model)) {
        if (arIn === "auto") return "16:9";
        if (!isSeedanceAspectRatio(arIn)) return "16:9";
        return arIn;
      }
      if (arIn === "4:3") return "16:9";
      if (arIn === "3:4") return "9:16";
      return arIn;
    };

    const convertTokensWithMaps = (
      raw: string,
      imgIndexById: Map<string, number>,
      elIndexById: Map<string, number>
    ) => {
      const p = String(raw || "").trim();

      return p.replace(/@[a-z0-9_]+/gi, (tok) => {
        const lower = tok.toLowerCase();

        // Normaliza @video1
        if (lower === "@video1") return "@Video1";

        // Normaliza @imageN/@elementN escritos por el usuario
        const mImg = lower.match(/^@image(\d+)$/);
        if (mImg) {
          const n = Number(mImg[1]);
          if (n >= 1 && n <= maxCombinedRefs) return `@Image${n}`;
        }

        const mEl = lower.match(/^@element(\d+)$/);
        if (mEl) {
          const n = Number(mEl[1]);
          if (n >= 1 && n <= maxCombinedRefs) return `@Element${n}`;
        }

        // Slug tokens -> numeric tokens
        const imgId = imageTokenToId.get(lower);
        if (imgId) {
          const n = imgIndexById.get(imgId);
          if (n) return `@Image${n}`;
        }

        const elId = elementTokenToId.get(lower);
        if (elId) {
          const n = elIndexById.get(elId);
          if (n) return `@Element${n}`;
        }

        return tok;
      });
    };

    const preparePromptAndRefs = (rawPrompt: string) => {
      const p = String(rawPrompt || "").trim();
      const tokens = extractMentionTokens(p);
      const lowerTokens = tokens.map((t) => t.toLowerCase());

    const numericImageIndices = lowerTokens
        .map((t) => {
          const m = t.match(/^@image(\d+)$/);
          const n = m ? Number(m[1]) : 0;
          return n >= 1 && n <= maxCombinedRefs ? n : 0;
        })
        .filter((n) => n > 0);

      const numericElementIndices = lowerTokens
        .map((t) => {
          const m = t.match(/^@element(\d+)$/);
          const n = m ? Number(m[1]) : 0;
          return n >= 1 && n <= maxCombinedRefs ? n : 0;
        })
        .filter((n) => n > 0);

      const hasNumericImages = numericImageIndices.length > 0;
      const hasNumericElements = numericElementIndices.length > 0;

      const mentionedImageIds: string[] = [];
      const mentionedElementIds: string[] = [];

      for (const t of lowerTokens) {
        const imgId = imageTokenToId.get(t);
        if (imgId && !mentionedImageIds.includes(imgId)) mentionedImageIds.push(imgId);

        const elId = elementTokenToId.get(t);
        if (elId && !mentionedElementIds.includes(elId)) mentionedElementIds.push(elId);
      }

      // Si el usuario usa @imageN / @elementN, preservamos el orden actual del selector
      // (para que los números no cambien).
      let finalImageIds = hasNumericImages ? [...referenceImageIds] : [...mentionedImageIds];
      let finalElementIds = hasNumericElements ? [...klingElementIds] : [...mentionedElementIds];

      // Merge con lo seleccionado / lo mencionado
      if (hasNumericImages) {
        for (const id of mentionedImageIds) if (!finalImageIds.includes(id)) finalImageIds.push(id);
      } else {
        for (const id of referenceImageIds) if (!finalImageIds.includes(id)) finalImageIds.push(id);
      }

      if (hasNumericElements) {
        for (const id of mentionedElementIds) if (!finalElementIds.includes(id)) finalElementIds.push(id);
      } else {
        for (const id of klingElementIds) if (!finalElementIds.includes(id)) finalElementIds.push(id);
      }

      if (finalImageIds.length + finalElementIds.length > maxCombinedRefs) {
        return {
          ok: false as const,
          error: `Máximo ${maxCombinedRefs} referencias combinadas (Elements + imágenes).`,
        };
      }

      const maxImgIndex = numericImageIndices.length ? Math.max(...numericImageIndices) : 0;
      if (maxImgIndex > finalImageIds.length) {
        return {
          ok: false as const,
          error: `Tu prompt usa @Image${maxImgIndex}, pero solo hay ${finalImageIds.length} imágenes de referencia disponibles.`,
        };
      }

      const maxElIndex = numericElementIndices.length ? Math.max(...numericElementIndices) : 0;
      if (maxElIndex > finalElementIds.length) {
        return {
          ok: false as const,
          error: `Tu prompt usa @Element${maxElIndex}, pero solo hay ${finalElementIds.length} Elements disponibles.`,
        };
      }

      const imgIndexById = new Map<string, number>();
      finalImageIds.forEach((id, i) => imgIndexById.set(id, i + 1));

      const elIndexById = new Map<string, number>();
      finalElementIds.forEach((id, i) => elIndexById.set(id, i + 1));

      const promptForModel = convertTokensWithMaps(p, imgIndexById, elIndexById);

      return {
        ok: true as const,
        promptForModel,
        referenceImageAssetIds: finalImageIds,
        klingElementIds: finalElementIds,
        imgIndexById,
        elIndexById,
      };
    };

    if (combinedRefsCount > maxCombinedRefs) {
      return { ok: false as const, error: `Máximo ${maxCombinedRefs} referencias combinadas (Elements + imágenes).` };
    }

    const ar: AspectRatio = normalizeAspectRatio(aspectRatio);

    // ===== Reference → Video =====
    if (model === "kling-o3-ref-to-video-pro") {
      // Multishot (solo si se habilita el flag)
      if (ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode) {
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

        // Preparamos refs/elements mirando TODOS los shots (tokens reales)
        const allPrompts = clean.map((s) => String(s.prompt || "")).join("\n");
        const preparedAll = preparePromptAndRefs(allPrompts);
        if (!preparedAll.ok) return { ok: false as const, error: preparedAll.error };

        const totalIngredients =
          preparedAll.referenceImageAssetIds.length + preparedAll.klingElementIds.length;

        if (totalIngredients < 1) {
          return {
            ok: false as const,
            error: `Agrega entre 1 y ${maxCombinedRefs} ingredientes (Elements + imágenes) para generar el video.`,
          };
        }


        // Convertimos cada shot al formato @ImageN/@ElementN usando el mismo orden final
        const convertedShots: O3Shot[] = clean.map((s) => ({
          ...s,
          prompt: convertTokensWithMaps(String(s.prompt || ""), preparedAll.imgIndexById, preparedAll.elIndexById),
        }));

        const finalPrompt = buildPromptFromShots(convertedShots);

        return {
          ok: true as const,
          finalPrompt,
          body: {
            model,
            klingMultiPrompt: convertedShots,
            referenceImageAssetIds: preparedAll.referenceImageAssetIds,
            klingElementIds: preparedAll.klingElementIds,
            durationSeconds: total,
            aspectRatio: ar,
            generateAudio,
            toolName: TOOL_NAME,
            hint: nowHint(model),
            async: true,
          },
        };
      }

      const prepared = preparePromptAndRefs(prompt);
      if (!prepared.ok) return { ok: false as const, error: prepared.error };

      if (!prepared.promptForModel) {
        return { ok: false as const, error: "Escribe un prompt (obligatorio) para generar el video." };
      }

      const totalIngredients =
        prepared.referenceImageAssetIds.length + prepared.klingElementIds.length;

      if (totalIngredients < 1) {
        return {
          ok: false as const,
          error: `Agrega entre 1 y ${maxCombinedRefs} ingredientes (Elements + imágenes) para generar el video.`,
        };
      }

      if (durationSeconds < 3 || durationSeconds > 15) {
        return { ok: false as const, error: "Duración inválida: usa 3–15 segundos." };
      }

      return {
        ok: true as const,
        finalPrompt: prepared.promptForModel,
        body: {
          model,
          prompt: prepared.promptForModel,
          referenceImageAssetIds: prepared.referenceImageAssetIds,
          klingElementIds: prepared.klingElementIds,
          durationSeconds,
          aspectRatio: ar,
          generateAudio,
          toolName: TOOL_NAME,
          hint: nowHint(model),
          async: true,
        },
      };
    }


    if (isSeedanceModel) {
      const prepared = preparePromptAndRefs(prompt);
      if (!prepared.ok) return { ok: false as const, error: prepared.error };

      if (!prepared.promptForModel) {
        return { ok: false as const, error: "Escribe un prompt (obligatorio) para Seedance 2." };
      }

      if (isSeedancePreviewVipModel && prepared.promptForModel.length > 4000) {
        return { ok: false as const, error: "Seedance 2.0 Pro admite prompts de hasta 4000 caracteres." };
      }

      const totalSeedanceRefs =
        prepared.referenceImageAssetIds.length + audioReferenceIds.length + (inputVideo ? 1 : 0);

      if (totalSeedanceRefs < 1) {
        return {
          ok: false as const,
          error: "Agrega al menos una imagen o un video de referencia para Seedance 2.",
        };
      }

      if (!inputVideo && prepared.referenceImageAssetIds.length < 1) {
        return {
          ok: false as const,
          error: "Seedance 2 Omni Reference no admite audio solo. Agrega al menos una imagen o un video de referencia.",
        };
      }

      if (totalSeedanceRefs > maxCombinedRefs) {
        return {
          ok: false as const,
          error: isSeedancePreviewVipModel
            ? "Seedance 2.0 Pro admite un máximo total de 9 refs combinadas (imágenes + audio + 1 video en esta tool)."
            : "Seedance 2 admite un máximo total de 12 refs combinadas (imágenes + audio + 1 video).",
        };
      }

      if (isSeedancePreviewVipModel && audioReferenceIds.length > 3) {
        return { ok: false as const, error: "Seedance 2.0 Pro admite un máximo de 3 audios de referencia." };
      }

      return {
        ok: true as const,
        finalPrompt: prepared.promptForModel,
        endpoint: "/api/ai/video/seedance-edit",
        body: {
          model,
          prompt: prepared.promptForModel,
          ...(inputVideo ? { videoAssetId: inputVideo.id } : {}),
          ...(prepared.referenceImageAssetIds.length
            ? { referenceImageAssetIds: prepared.referenceImageAssetIds }
            : {}),
          ...(audioReferenceIds.length ? { audioReferenceAssetIds: audioReferenceIds } : {}),
          durationSeconds: isSeedancePreviewVipModel
            ? coerceSeedancePreviewVipDurationLocal(durationSeconds)
            : coerceSeedanceDurationLocal(durationSeconds),
          aspectRatio: ar === "auto" ? "16:9" : ar,
          toolName: TOOL_NAME,
          hint: nowHint(model),
          async: true,
        },
      };
    }

    // ===== Video → Video =====
    if (!inputVideo) {
      return { ok: false as const, error: "Selecciona un VIDEO de entrada (obligatorio) para este modelo." };
    }

    const prepared = preparePromptAndRefs(prompt);
    if (!prepared.ok) return { ok: false as const, error: prepared.error };

    if (!prepared.promptForModel) {
      return { ok: false as const, error: "Escribe un prompt (obligatorio) para editar el video." };
    }

    // ✅ Kling O3 Edit Video no expone duration/aspect en el API: usa los del video de entrada.
    if (model === "kling-o3-edit-video-pro") {
      return {
        ok: true as const,
        finalPrompt: prepared.promptForModel,
        body: {
          model,
          prompt: prepared.promptForModel,
          videoAssetId: inputVideo.id,
          referenceImageAssetIds: prepared.referenceImageAssetIds,
          klingElementIds: prepared.klingElementIds,
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
      finalPrompt: prepared.promptForModel,
      body: {
        model,
        prompt: prepared.promptForModel,
        videoAssetId: inputVideo.id,
        referenceImageAssetIds: prepared.referenceImageAssetIds,
        klingElementIds: prepared.klingElementIds,
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
    imageTokenToId,
    elementTokenToId,
    keepAudio,
    generateAudio,
    multishotEnabled,
    shots,
    combinedRefsCount,
    isSeedanceModel,
    isSeedancePreviewVipModel,
  ]);


  async function runWaitFlow(supabaseJobId: string) {
    setProgressText("Procesando (background)…");

    const row = await waitJobCompletion(supabaseJobId, {
      signal: abortRef.current?.signal,
      onProgress: (msg) => setProgressText(msg),
      pollMs: 15_000,
    });

    if (row.status === "failed") {
      clearPending();
      setPendingJob(null);
      autoResumeAttemptedJobIdRef.current = null;

      const terminalErr: any = new Error(formatJobFailure(row, "Falló el job en background."));
      terminalErr.clearPending = true;
      terminalErr.jobId = row.id;
      terminalErr.jobStatus = row.status;
      throw terminalErr;
    }

    clearPending();
    setPendingJob(null);
    autoResumeAttemptedJobIdRef.current = null;
    setProgressText("");

    await reloadVideos();
    await reloadHistory();
  }

  const onGenerate = useCallback(async () => {
    if (isGenerating) return;
    setError(null);

    if (videoSlotBusy) {
      setError(activeVideoBusyMessage || "Ya tienes un video en proceso. Espera a que termine antes de lanzar otro.");
      return;
    }

    const built = validateAndBuildRequest();
    if (!built.ok) {
      // Narrowing explícito para TS
      setError("error" in built ? built.error : "Error de validación.");
      return;
    }

    const { body, finalPrompt } = built;
    setIsGenerating(true);
      setProgressText(
        isSeedanceModelId(model)
          ? "Enviando a Seedance 2.0…"
          : "Enviando a Kling O3…"
      );

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const endpoint = built.endpoint || "/api/ai/video/edit";

      const resp = await apiPostJson<any>(
        endpoint,
        body,
        { signal: ctrl.signal, timeoutMs: 12 * 60 * 1000, retries: 10 }
      );

      if (!resp?.ok || resp?.mode !== "async" || !resp?.jobId) {
        throw new Error(resp?.error || "Respuesta inválida del backend (esperaba async + jobId).");
      }

      const supabaseJobId = String(resp.jobId);

      const pj: PendingVideoEditJob = {
        supabaseJobId,
        prompt: finalPrompt,
        model: model,
        createdAt: Date.now(),
      };
      savePending(pj);
      setPendingJob(pj);

      await runWaitFlow(supabaseJobId);
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.isCanceled) {
        setProgressText("Cancelado.");
      } else {
        if (err?.clearPending) {
          clearPending();
          setPendingJob(null);
          autoResumeAttemptedJobIdRef.current = null;
        }
        setError(formatErr(err));
        setProgressText("");
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [activeVideoBusyMessage, isGenerating, model, savePending, validateAndBuildRequest, videoSlotBusy]);

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
      await runWaitFlow(pj.supabaseJobId);
    } catch (err: any) {
      if (err?.clearPending) {
        clearPending();
        setPendingJob(null);
        autoResumeAttemptedJobIdRef.current = null;
      }
      setError(formatErr(err));
      setProgressText("");
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [loadPending]);

  const onDiscardPending = useCallback(() => {
    clearPending();
    setPendingJob(null);
    autoResumeAttemptedJobIdRef.current = null;
  }, [clearPending]);

  const onCancel = useCallback(() => {
    const ctrl = abortRef.current;
    if (ctrl) ctrl.abort();
    abortRef.current = null;

    // Si el request ya salió, el job seguirá en background; el usuario puede reanudar luego.
    setIsGenerating(false);
    setProgressText("Cancelado. Si ya se envió, el job seguirá en background y puedes reanudar.");
  }, []);
    

  // ===== Labels =====
  const paramsLabelParts: string[] = [];

  if (model === "kling-o3-edit-video-pro") {
    paramsLabelParts.push("Aspect: input");
    paramsLabelParts.push("Duration: input");
    paramsLabelParts.push(keepAudio ? "Keep audio: yes" : "Keep audio: no");
  } else {
    paramsLabelParts.push(aspectRatio === "auto" ? "Aspect: auto" : `Aspect: ${aspectRatio}`);
    paramsLabelParts.push(
      ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode
        ? `Duration: ${multishotTotalSeconds}s`
        : `Duration: ${durationSeconds}s`
    );
    if (model === "kling-o3-ref-to-video-pro") paramsLabelParts.push(generateAudio ? "Audio: on" : "Audio: off");
    if (model !== "kling-o3-ref-to-video-pro") paramsLabelParts.push(keepAudio ? "Keep audio: yes" : "Keep audio: no");
  }
  const paramsLabel = paramsLabelParts.join(" · ");
  const isCookSidebarVisible = isCookOpen && !panel;
  const isCookLayerVisible = isCookOpen || !!panel;

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


  return (
    <div ref={rootRef} className={`${styles.root} ${isCookOpen ? styles.rootCookOpen : ""}`} onMouseMove={handleRootMouseMove}>
      <ErrorModal error={error} onClose={() => setError(null)} />

      <EditHistorySection
        isCookOpen={isCookOpen}
        title="INGREDIENTS TO VIDEO"
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
        onToggleLike={onToggleLike}
        likeBusyById={likeBusyById}
        onTogglePublish={onTogglePublish}
        onDownload={onDownload}
        onDelete={onDelete}
        onShowError={(msg) => setError(msg)}
        hoverVideoEls={hoverVideoEls}
      />

      {panel === null && (
        <button
          type="button"
          className={`${styles.cookToggle} ${isCookSidebarVisible ? styles.cookToggleOpen : styles.cookTogglePulse}`}
          onClick={() => {
            if (isCookSidebarVisible) closeCook();
            else openCook();
          }}
          aria-expanded={isCookSidebarVisible}
          aria-controls="ingredients-to-video-start-create"
          aria-label={isCookSidebarVisible ? "Close Start Create" : "Open Start Create"}
        >
          <span className={styles.cookToggleLabel}>Start Create</span>
          <span className={styles.cookToggleGlyph} aria-hidden="true">{isCookSidebarVisible ? "×" : "+"}</span>
        </button>
      )}

      {isCookLayerVisible && (
        <div id="ingredients-to-video-start-create" className={`${styles.cookOverlay} ${styles.cookOverlayOpen}`} aria-hidden={!isCookLayerVisible}>
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
              <div
                className={styles.cookPanel}
              >
                <div className={`${styles.popover} ${styles.cookInlinePopover}`} ref={popoverRef}>
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
                        <b>Tip:</b> Si el modelo falla, reduce referencias (máx {maxCombinedRefs} combinadas), simplifica el prompt, o prueba una duración menor.
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
                              {model !== "kling-o3-ref-to-video-pro" && !isSeedancePreviewVipModel && (
                                <button
                                  type="button"
                                  className={`${styles.segmentBtn} ${aspectRatio === "auto" ? styles.segmentBtnActive : ""}`}
                                  onClick={() => setAspectRatio("auto")}
                                  disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                                >
                                  auto
                                </button>
                              )}
                              <button
                                type="button"
                                className={`${styles.segmentBtn} ${aspectRatio === "16:9" ? styles.segmentBtnActive : ""}`}
                                onClick={() => setAspectRatio("16:9")}
                                disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                              >
                                16:9
                              </button>
                              <button
                                type="button"
                                className={`${styles.segmentBtn} ${aspectRatio === "9:16" ? styles.segmentBtnActive : ""}`}
                                onClick={() => setAspectRatio("9:16")}
                                disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                              >
                                9:16
                              </button>
                              {isSeedanceModel ? (
                                <>
                                  {!isSeedancePreviewVipModel && (
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${aspectRatio === "21:9" ? styles.segmentBtnActive : ""}`}
                                      onClick={() => setAspectRatio("21:9")}
                                      disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                                    >
                                      21:9
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={`${styles.segmentBtn} ${aspectRatio === "4:3" ? styles.segmentBtnActive : ""}`}
                                    onClick={() => setAspectRatio("4:3")}
                                    disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                                  >
                                    4:3
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.segmentBtn} ${aspectRatio === "3:4" ? styles.segmentBtnActive : ""}`}
                                    onClick={() => setAspectRatio("3:4")}
                                    disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                                  >
                                    3:4
                                  </button>
                                  {!isSeedancePreviewVipModel && (
                                    <button
                                      type="button"
                                      className={`${styles.segmentBtn} ${aspectRatio === "1:1" ? styles.segmentBtnActive : ""}`}
                                      onClick={() => setAspectRatio("1:1")}
                                      disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                                    >
                                      1:1
                                    </button>
                                  )}
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className={`${styles.segmentBtn} ${aspectRatio === "1:1" ? styles.segmentBtnActive : ""}`}
                                  onClick={() => setAspectRatio("1:1")}
                                  disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                                >
                                  1:1
                                </button>
                              )}
                            </div>
                          </div>

                          <div className={styles.formRow}>
                            <label className={styles.formLabel}>Duration</label>
                            <div className={styles.segment}>
                              {(isSeedanceModel
                                ? [5, 10, 15]
                                : [3, 5, 8, 10, 12, 15]).map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  className={`${styles.segmentBtn} ${durationSeconds === d ? styles.segmentBtnActive : ""}`}
                                  onClick={() => setDurationSeconds(d)}
                                  disabled={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode}
                                  title={ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode ? "Con Storyboard la duración viene de la suma de shots" : ""}
                                >
                                  {d}s
                                </button>
                              ))}
                            </div>
                            {ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode && (
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
                          <b>Referencias:</b>{" "}
                          {model === "kling-o3-ref-to-video-pro"
                            ? `Requiere 1–${maxCombinedRefs} referencias visuales. `
                            : isSeedanceModel
                              ? isSeedancePreviewVipModel
                                ? `Máximo ${maxCombinedRefs} refs combinadas (imágenes + audio + 1 video en esta tool; audio máx 3). `
                                : `Máximo ${maxCombinedRefs} refs combinadas (imágenes + audio + 1 video). `
                              : `Máximo ${maxCombinedRefs} referencias visuales.`}
                          1–2 referencias fuertes suele funcionar mejor que muchas débiles.
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isCookSidebarVisible && (
            <div className={styles.cookSidebarShell}>
              <div className={styles.cookSidebar}>
                <div className={`${styles.dock} ${styles.cookSectionCard} ${styles.cookPromptCard}`}>
          <div className={`${styles.promptRow} ${styles.cookPromptRow}`}>
            {/* Inputs */}
                      {model === "kling-o3-ref-to-video-pro" ? (
                        <div className={styles.frameStrip}>
                          <div
                            className={styles.frameCard}
                            role="button"
                            tabIndex={0}
                            onClick={() => setRefPickerOpen(true)}
                            onKeyDown={(e) => e.key === "Enter" && setRefPickerOpen(true)}
                            title={`Refs (máx ${maxCombinedRefs} combinado)`}
                          >
                            <div className={styles.frameCardEmpty}>
                              <div className={styles.frameCardIcons}>
                                <Icon name="image" />
                                <Icon name="upload" />
                              </div>
                            </div>
                            <span className={styles.frameCardBadge}>REFS</span>
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
            <div className={`${styles.promptInputWrap} ${styles.cookPromptInputWrap}`}>
              <div className={`${styles.promptEditor} ${styles.cookPromptEditor}`}>

                {(referenceImageIds.length > 0 || klingElementIds.length > 0 || (ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode)) && (
                  <div className={styles.promptTags}>

                    {VIDEO_ELEMENTS_UI_ENABLED && klingElementIds.length > 0 && (
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

                    <button type="button" className={styles.promptTag} title="Límite de referencias">
                      Total refs: {combinedRefsCount}/{maxCombinedRefs}
                    </button>
                    {isSeedanceModel && audioReferenceIds.length > 0 && (
                      <button type="button" className={styles.promptTag} onClick={() => setRefAudioPickerOpen(true)}>
                        Audio refs: {audioReferenceIds.length}
                      </button>
                    )}

                    {ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode && (
                      <button type="button" className={styles.promptTag} onClick={() => setMultishotOpen(true)}>
                        Storyboard: {multishotTotalSeconds}s
                      </button>
                    )}
                  </div>
                )}

                {ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode ? (
                  <div className={styles.multishotInline}>
                    <div className={styles.multishotTop}>
                      <div>
                        <div className={styles.multishotTitle}>
                          <Icon name="multishot" /> Storyboard • customize
                        </div>
                        <div className={styles.multishotMeta}>
                          {shots.length} shots · {multishotTotalSeconds}s
                        </div>
                      </div>

                      <div className={styles.multishotTopActions}>
                        <button type="button" className={styles.multishotAddBtn} onClick={() => setMultishotOpen(true)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.multishotExpandBtn}
                          onClick={() => {
                            setMultishotEnabled(false);
                            setMultishotMode("intelligence");
                            setMultishotOpen(false);
                            setMultishotModeOpen(false);
                          }}
                          title="Desactivar Multishot"
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <MentionTextarea
                    textareaClassName={styles.prompt}
                    value={prompt}
                    onChange={setPrompt}
                    items={promptMentionItems}
                    onSelectItem={(it) => {
                      if (it.kind === "element") {
                        if (klingElementIds.includes(it.id)) return true;
                        if (klingElementIds.length >= maxElements) {
                          setError(
                            `Máximo ${maxElements} Elements porque ya tienes ${referenceImageIds.length} imágenes de referencia (máx ${maxCombinedRefs} combinado).`
                          );
                          return false;
                        }
                        setKlingElementIdsLimited((prev) => (prev.includes(it.id) ? prev : [...prev, it.id]));
                        return true;
                      }

                      if (it.kind === "ref") {
                        if (referenceImageIds.includes(it.id)) return true;
                        if (referenceImageIds.length >= maxRefImages) {
                          setError(
                            `Máximo ${maxRefImages} imágenes de referencia porque ya tienes ${klingElementIds.length} Elements (máx ${maxCombinedRefs} combinado).`
                          );
                          return false;
                        }
                        setReferenceImageIdsLimited((prev) => (prev.includes(it.id) ? prev : [...prev, it.id]));
                        return true;
                      }

                      return true;
                    }}
                    placeholder={
                      isSeedanceModel
                        ? inputVideo
                          ? "Describe la transformación… (El video base es @Video1. Puedes usar @Image1..@Image12 y @Audio1..@Audio12 según tus refs cargadas)."
                          : "Describe la escena… Usa @Image1..@Image12 y @Audio1..@Audio12 según tus refs. Si cargas un video, podrás referenciarlo como @Video1."
                        : model === "kling-o3-ref-to-video-pro"
                          ? "Describe la escena… (personaje, acción, cámara, estilo)."
                          : model === "kling-o3-edit-video-pro"
                            ? "Describe qué cambiar y qué conservar… (El video base es @Video1. Ej: “cambia el ambiente a nieve, conserva la identidad y el movimiento”)."
                            : "Describe la nueva versión… (El video base es @Video1. Usa @Image1 para identidad/estilo)."
                    }
                    rows={3}
                  />
                )}

              </div>
            </div>

            <div className={styles.videoSelectorsStack} style={{ marginTop: 14 }}>
              <button
                type="button"
                className={`${styles.videoSelectorButton} ${panel === "model" ? styles.videoSelectorButtonActive : ""}`}
                onClick={() => setPanel("model")}
              >
                <span className={styles.videoSelectorTopLabel}>Model</span>
                <span className={styles.videoSelectorValueRow}>
                  <span>{selectedModel.uiName}</span>
                  <span className={styles.videoSelectorChevron} aria-hidden="true">›</span>
                </span>
              </button>

              <div className={styles.videoQuickGrid}>
                <button
                  type="button"
                  className={`${styles.videoQuickButton} ${panel === "params" ? styles.videoSelectorButtonActive : ""}`}
                  onClick={() => setPanel("params")}
                >
                  <Icon name="sliders" />
                  <span>{paramsLabel || "Settings"}</span>
                </button>

                <button
                  type="button"
                  className={styles.videoQuickButton}
                  onClick={() => setRefPickerOpen(true)}
                >
                  <Icon name="image" />
                  <span>{isSeedanceModel ? `Image refs${referenceImageIds.length ? ` (${referenceImageIds.length})` : ""}` : `Refs${referenceImageIds.length ? `(${referenceImageIds.length})` : ""}`}</span>
                </button>

                {isSeedanceModel && (
                  <button
                    type="button"
                    className={styles.videoQuickButton}
                    onClick={() => setRefAudioPickerOpen(true)}
                  >
                    <Icon name="sound" />
                    <span>Audio refs{audioReferenceIds.length ? ` (${audioReferenceIds.length})` : ""}</span>
                  </button>
                )}

                {ENABLE_EDITVIDEO_MULTISHOT && model === "kling-o3-ref-to-video-pro" && (
                  <button
                    type="button"
                    className={`${styles.videoQuickButton} ${multishotEnabled ? styles.videoSelectorButtonActive : ""}`}
                    onClick={() => {
                      if (multishotEnabled) {
                        setMultishotEnabled(false);
                        setMultishotMode("intelligence");
                        setMultishotOpen(false);
                        setMultishotModeOpen(false);
                        return;
                      }
                      setMultishotModeOpen(true);
                    }}
                  >
                    <Icon name="multishot" />
                    <span>{multishotEnabled ? `Storyboard (${multishotMode === "customize" ? shots.length : multishotMode})` : "Storyboard"}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Generate */}
            <div className={`${styles.generateCol} ${styles.cookGenerateCol}`}>
              <button
                type="button"
                className={`${styles.generateBtn} ${styles.cookGenerateBtn}`}
                disabled={
                  isGenerating ||
                  !user ||
                  combinedRefsCount > maxCombinedRefs ||
                  videoSlotBusy ||
                  (isSeedanceModel
                    ? ((prompt || "").trim().length === 0 || (!inputVideo && referenceImageIds.length === 0))
                    : (model === "kling-o3-ref-to-video-pro"
                        ? ((ENABLE_EDITVIDEO_MULTISHOT && isStoryboardMode) ? !multishotReady : (prompt || "").trim().length === 0)
                        : !inputVideo || (prompt || "").trim().length === 0))
                }
                onClick={onGenerate}
                data-loading={isGenerating ? "true" : "false"}
              >
                <span className={styles.generateLabel}>{isGenerating ? "PROCESSING" : "GENERATE"}</span>
                {isGenerating && <span className={styles.generateSpinner} aria-hidden="true" />}
              </button>

              <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.65)", textAlign: "center" }}>
                Coste estimado: <b>{estimatedCostCredits}</b> créditos
              </div>

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

                </div>
              </div>
            </div>
          )}
        </div>
      )}

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

      <SeedanceRefsPickerModal
        open={refPickerOpen}
        onClose={() => setRefPickerOpen(false)}
        title={isSeedanceModel ? "Image refs" : "Imágenes de referencia"}
        note={
          <>
            Seleccionadas: <b>{referenceImageIds.length}</b> / {maxRefImages}. {isSeedanceModel ? (isSeedancePreviewVipModel ? "Seedance 2.0 Pro usa hasta 9 refs combinadas entre imágenes, audio y 1 video en esta tool." : "Seedance usa hasta 12 refs combinadas entre imágenes, audio y 1 video.") : "Puedes elegir imágenes normales o Elements de imagen como refs."}
          </>
        }
        selectedIds={referenceImageIds}
        setSelectedIds={setReferenceImageIds}
        historyAssets={referenceHistoryImages}
        elementAssets={referenceElementImages}
        max={maxRefImages}
        isLoading={isLoadingImages || isLoadingElementLibrary}
        onUpload={uploadImage}
        getAssetUrl={getAssetUrl}
      />

      <SeedanceAudioRefsPickerModal
        open={refAudioPickerOpen}
        onClose={() => setRefAudioPickerOpen(false)}
        title="Audio refs"
        note={
          <>
            Seleccionados: <b>{audioReferenceIds.length}</b> / {maxAudioRefs}. Seedance admite MP3/WAV de hasta 15s por audio.
          </>
        }
        selectedIds={audioReferenceIds}
        setSelectedIds={setAudioReferenceIds}
        historyAssets={referenceHistoryAudios}
        max={maxAudioRefs}
        isLoading={isLoadingAudios}
        onUpload={uploadAudio}
        getAssetUrl={getAssetUrl}
      />

      {VIDEO_ELEMENTS_UI_ENABLED && (
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
          videoAssets={videoAssets}
          getAssetUrl={getAssetUrl}
          onRefresh={reloadKlingElements}
          onAssetUploaded={(asset) =>
            setImageAssets((prev) => [asset, ...prev.filter((x) => x.id !== asset.id)])
          }
          uploadToolName="video-elements"
        />
      )}

      {ENABLE_EDITVIDEO_MULTISHOT && (
        <>
          <MultishotModeModal
            open={multishotModeOpen}
            title="Multishot"
            intelligenceText="Usa el prompt principal y deja que el modelo resuelva la secuencia."
            customizeText="Abre el editor shot-by-shot para escribir storyboard manual."
            customizeHint="Antes de entrar, revisa modelo y parámetros."
            onClose={() => setMultishotModeOpen(false)}
            onChooseIntelligence={() => {
              setMultishotEnabled(true);
              setMultishotMode("intelligence");
              setMultishotModeOpen(false);
              setMultishotOpen(false);
            }}
            onChooseCustomize={() => {
              setMultishotEnabled(true);
              setMultishotMode("customize");
              setMultishotModeOpen(false);
              setMultishotOpen(true);
            }}
          />

          <O3MultishotModal
            open={multishotOpen && isStoryboardMode}
            onClose={() => setMultishotOpen(false)}
            shots={shots}
            setShots={setShots}
            totalSeconds={multishotTotalSeconds}
            mentionItems={promptMentionItems}
            generateDisabled={isGenerating || videoSlotBusy || !multishotReady || !user || combinedRefsCount > maxCombinedRefs}
            onGenerate={() => {
              setMultishotOpen(false);
              onGenerate();
            }}
          />
        </>
      )}

      <ViewerModal
        viewer={viewer}
        viewerRecipeInfo={viewerRecipeInfo}
        onClose={() => setViewer(null)}
        onCopyPrompt={(a) => {
          const meta: any = (a as any).meta || {};
          const p = String(meta?.editVideo?.prompt || meta?.prompt || "");
          navigator.clipboard?.writeText(p || "");
        }}
        onReusePrompt={(asset) => applyRecipeFromAsset(asset)}
        onTogglePublish={onTogglePublish}
        onDownload={onDownload}
        onDelete={onDelete}
      />
    </div>
  );
}
