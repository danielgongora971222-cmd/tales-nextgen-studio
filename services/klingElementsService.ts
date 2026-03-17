import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";

/**
 * Endpoints reales según server/server.js:
 *  - GET    /api/kling/elements
 *  - POST   /api/kling/elements
 *  - GET    /api/kling/elements/:id
 *  - DELETE /api/kling/elements/:id
 *  - GET    /api/kling/elements/presets
 *  - GET    /api/kling/voices
 */

export type KlingElementTagId =
  | "o_101"
  | "o_102"
  | "o_103"
  | "o_104"
  | "o_105"
  | "o_106"
  | "o_107"
  | "o_108";

export const KLING_ELEMENT_TAG_OPTIONS: Array<{ id: KlingElementTagId; label: string }> = [
  { id: "o_101", label: "Hottest" },
  { id: "o_102", label: "Character" },
  { id: "o_103", label: "Animal" },
  { id: "o_104", label: "Item" },
  { id: "o_105", label: "Costume" },
  { id: "o_106", label: "Scene" },
  { id: "o_107", label: "Effect" },
  { id: "o_108", label: "Others" },
];

const KLING_TAG_LABEL_BY_ID = new Map<KlingElementTagId, string>(
  KLING_ELEMENT_TAG_OPTIONS.map((item) => [item.id, item.label])
);

export type KlingElement = {
  id: string;
  name: string;

  source?: "custom" | "preset";
  isPreset?: boolean;
  localId?: string | null;
  remoteElementId?: string | null;
  ownedBy?: string | null;

  tag?: string | null;
  tagIds?: KlingElementTagId[];
  tagLabels?: string[];
  description?: string | null;
  referenceType?: "image_refer" | "video_refer";
  voiceId?: string | null;
  voiceInfo?: {
    voiceId?: string | null;
    voiceName?: string | null;
    trialUrl?: string | null;
    ownedBy?: string | null;
  } | null;

  klingElementId?: string | null;

  status?: "creating" | "ready" | "failed" | "deleted";
  statusDetail?: string | null;
  apiVersion?: string | null;
  taskId?: string | null;
  updatedAt?: number | null;

  previewType?: "image" | "video";
  previewUrl?: string | null;
  imageUrls: string[];
  videoUrl?: string | null;
  createdAt: number;
};

function clampPageNum(v: any) {
  const n = Math.trunc(Number(v) || 1);
  return Math.max(1, Math.min(1000, n));
}

function clampPageSize(v: any, fallback = 90) {
  const n = Math.trunc(Number(v) || fallback);
  return Math.max(1, Math.min(500, n));
}

function toTimestamp(raw: any) {
  if (typeof raw === "string") {
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) ? ts : Date.now();
  }
  if (typeof raw === "number") return raw;
  return Date.now();
}

function toOptionalTimestamp(raw: any) {
  if (typeof raw === "string") {
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof raw === "number") return raw;
  return null;
}

function normalizeTagIds(raw: any): KlingElementTagId[] {
  const direct = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];

  const out: KlingElementTagId[] = [];
  for (const item of direct) {
    const id = String(item?.tag_id ?? item?.id ?? item ?? "").trim() as KlingElementTagId;
    if (!id) continue;
    if (!KLING_TAG_LABEL_BY_ID.has(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function buildTagMeta(rawTagIds: any, fallbackTag?: any) {
  const tagIds = normalizeTagIds(rawTagIds?.length ? rawTagIds : fallbackTag);
  const tagLabels = tagIds.map((id) => KLING_TAG_LABEL_BY_ID.get(id) || id);
  return {
    tagIds,
    tagLabels,
    tag: tagLabels.length ? tagLabels.join(", ") : null,
  };
}

function mapVoiceInfo(row: any) {
  const voice = row?.voiceInfo ?? row?.voice_info ?? row?.element_voice_info ?? null;
  if (!voice) return null;

  const voiceId = voice?.voiceId ?? voice?.voice_id ?? row?.voiceId ?? row?.voice_id ?? null;
  const voiceName = voice?.voiceName ?? voice?.voice_name ?? null;
  const trialUrl = voice?.trialUrl ?? voice?.trial_url ?? null;
  const ownedBy = voice?.ownedBy ?? voice?.owned_by ?? null;

  if (!voiceId && !voiceName && !trialUrl && !ownedBy) return null;
  return {
    voiceId: voiceId ? String(voiceId) : null,
    voiceName: voiceName ? String(voiceName) : null,
    trialUrl: trialUrl ? String(trialUrl) : null,
    ownedBy: ownedBy ? String(ownedBy) : null,
  };
}

function mapRowToKlingElement(row: any): KlingElement {
  const createdAt = toTimestamp(row.created_at ?? row.createdAt);
  const updatedAt = toOptionalTimestamp(row.updated_at ?? row.updatedAt);
  const { tagIds, tagLabels, tag } = buildTagMeta(row.tagIds ?? row.tag_ids, row.tag);
  const voiceInfo = mapVoiceInfo(row);
  const previewType = (row.previewType ?? row.preview_type ?? (row.videoAssetId || row.video_asset_id ? "video" : "image")) as any;
  const imageUrls = Array.isArray(row.imageUrls ?? row.image_urls)
    ? (row.imageUrls ?? row.image_urls).map(String).filter(Boolean)
    : [];
  const remoteElementId = row.remoteElementId ?? row.remote_element_id ?? row.klingElementId ?? row.kling_element_id ?? null;

  return {
    id: String(row.id),
    name: String(row.name ?? ""),

    source: (row.source ?? "custom") as any,
    isPreset: Boolean(row.isPreset ?? row.is_preset ?? (row.source === "preset")),
    localId: row.localId ?? row.local_id ?? row.id ?? null,
    remoteElementId: remoteElementId ? String(remoteElementId) : null,
    ownedBy: row.ownedBy ?? row.owned_by ?? null,

    tag,
    tagIds,
    tagLabels,
    description: row.description != null ? String(row.description) : null,
    referenceType: (row.referenceType ?? row.reference_type ?? "image_refer") as any,
    voiceId: row.voiceId ?? row.voice_id ?? voiceInfo?.voiceId ?? null,
    voiceInfo,

    klingElementId: remoteElementId ? String(remoteElementId) : null,

    status: (row.status ?? "ready") as any,
    statusDetail: row.statusDetail ?? row.status_detail ?? null,
    apiVersion: row.apiVersion ?? row.api_version ?? null,
    taskId: row.taskId ?? row.kling_task_id ?? null,
    updatedAt,

    previewType,
    previewUrl: row.previewUrl ?? row.preview_url ?? null,
    imageUrls,
    videoUrl: row.videoUrl ?? row.video_url ?? null,
    createdAt,
  };
}

function mapRemoteElementToKlingElement(row: any): KlingElement | null {
  const remoteElementId = row?.remoteElementId ?? row?.remote_element_id ?? row?.element_id ?? row?.elementId ?? row?.id;
  if (!remoteElementId) return null;

  const imageList = row?.element_image_list ?? row?.elementImageList ?? {};
  const frontal = imageList?.frontal_image ? String(imageList.frontal_image) : "";
  const referImages = Array.isArray(imageList?.refer_images)
    ? imageList.refer_images.map((item: any) => String(item?.image_url ?? item ?? "").trim()).filter(Boolean)
    : [];

  const imageUrls = [frontal, ...referImages].filter(Boolean);

  const videoList = row?.element_video_list ?? row?.elementVideoList ?? {};
  const referVideos = Array.isArray(videoList?.refer_videos)
    ? videoList.refer_videos.map((item: any) => String(item?.video_url ?? item ?? "").trim()).filter(Boolean)
    : [];
  const videoUrl = referVideos[0] || null;

  const createdAt = toTimestamp(row.created_at ?? row.createdAt ?? Date.now());
  const updatedAt = toOptionalTimestamp(row.updated_at ?? row.updatedAt);
  const { tagIds, tagLabels, tag } = buildTagMeta(row.tag_list ?? row.tagList, row.tag);
  const voiceInfo = mapVoiceInfo(row);
  const source = row?.source === "custom" ? "custom" : "preset";

  return {
    id: source === "preset" ? `preset:${String(remoteElementId)}` : String(row?.id ?? remoteElementId),
    name: String(row?.element_name ?? row?.elementName ?? row?.name ?? `Element ${remoteElementId}`),
    source,
    isPreset: source === "preset",
    localId: source === "custom" ? String(row?.id ?? row?.localId ?? "") || null : null,
    remoteElementId: String(remoteElementId),
    ownedBy: row?.owned_by ? String(row.owned_by) : source === "preset" ? "kling" : null,
    tag,
    tagIds,
    tagLabels,
    description: row?.element_description != null ? String(row.element_description) : row?.description != null ? String(row.description) : null,
    referenceType: (row?.reference_type ?? row?.referenceType ?? (videoUrl ? "video_refer" : "image_refer")) as any,
    voiceId: voiceInfo?.voiceId ?? null,
    voiceInfo,
    klingElementId: String(remoteElementId),
    status: (row?.status ?? "ready") as any,
    statusDetail: row?.statusDetail ?? row?.status_detail ?? null,
    apiVersion: row?.apiVersion ?? row?.api_version ?? "advanced",
    taskId: row?.task_id ?? row?.taskId ?? null,
    updatedAt,
    previewType: videoUrl ? "video" : "image",
    previewUrl: videoUrl || imageUrls[0] || null,
    imageUrls,
    videoUrl,
    createdAt,
  };
}

// ===============================
// Cache en memoria (session) para evitar recargar Elements en cada tool/picker
// ===============================

type ElementsCacheEntry = {
  ts: number;
  items: KlingElement[];
  inFlight?: Promise<KlingElement[]>;
};

type PresetElementsCacheEntry = {
  ts: number;
  items: KlingElement[];
  inFlight?: Promise<KlingElement[]>;
};

const ELEMENTS_CACHE_TTL_MS = 2 * 60 * 1000;
const PRESET_ELEMENTS_CACHE_TTL_MS = 10 * 60 * 1000;

let elementsCache: ElementsCacheEntry | null = null;
const presetElementsCache = new Map<string, PresetElementsCacheEntry>();

export function invalidateKlingElementsCache() {
  elementsCache = null;
}

export function invalidateKlingPresetElementsCache() {
  presetElementsCache.clear();
}

function elementsCacheFresh() {
  return elementsCache && Date.now() - elementsCache.ts < ELEMENTS_CACHE_TTL_MS;
}

function presetCacheKey(pageNum: number, pageSize: number) {
  return `${pageNum}:${pageSize}`;
}

async function authHeadersJson() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function listKlingElements(): Promise<KlingElement[]> {
  if (elementsCacheFresh()) return elementsCache!.items;
  if (elementsCache?.inFlight) return elementsCache.inFlight;

  const headers = await authHeadersJson();

  const inFlight = (async () => {
    const resp = await fetch(apiUrl("/api/kling/elements"), { method: "GET", headers });
    const data = await resp.json();

    if (!resp.ok || data?.ok === false) {
      throw new Error(data?.error?.message || "Error listando Elements.");
    }

    const items = (data.items || []).map(mapRowToKlingElement);
    elementsCache = { ts: Date.now(), items };
    return items;
  })();

  elementsCache = { ts: Date.now(), items: elementsCache?.items ?? [], inFlight };
  try {
    return await inFlight;
  } finally {
    if (elementsCache?.inFlight === inFlight) delete elementsCache.inFlight;
  }
}

export async function listKlingPresetElements(opts?: {
  force?: boolean;
  pageNum?: number;
  pageSize?: number;
}): Promise<KlingElement[]> {
  const pageNum = clampPageNum(opts?.pageNum ?? 1);
  const pageSize = clampPageSize(opts?.pageSize ?? 90);
  const cacheKey = presetCacheKey(pageNum, pageSize);

  if (opts?.force) presetElementsCache.delete(cacheKey);

  const cache = presetElementsCache.get(cacheKey);
  if (cache && Date.now() - cache.ts < PRESET_ELEMENTS_CACHE_TTL_MS) return cache.items;
  if (cache?.inFlight) return cache.inFlight;

  const headers = await authHeadersJson();

  const inFlight = (async () => {
    const forceParam = opts?.force ? "&force=1" : "";
    const resp = await fetch(
      apiUrl(`/api/kling/elements/presets?pageNum=${pageNum}&pageSize=${pageSize}${forceParam}`),
      { method: "GET", headers }
    );
    const data = await resp.json();

    if (!resp.ok || data?.ok === false) {
      throw new Error(data?.error?.message || "Error listando presets de Elements.");
    }

    const items = (Array.isArray(data.items) ? data.items : [])
      .map(mapRemoteElementToKlingElement)
      .filter(Boolean) as KlingElement[];

    presetElementsCache.set(cacheKey, { ts: Date.now(), items });
    return items;
  })();

  presetElementsCache.set(cacheKey, {
    ts: Date.now(),
    items: cache?.items ?? [],
    inFlight,
  });

  try {
    return await inFlight;
  } finally {
    const entry = presetElementsCache.get(cacheKey);
    if (entry?.inFlight === inFlight) delete entry.inFlight;
  }
}

export async function refreshKlingElementsStatus(opts?: { maxPoll?: number }) {
  const maxPoll = Math.max(0, Math.min(25, Number(opts?.maxPoll ?? 10)));

  invalidateKlingElementsCache();

  const first = await listKlingElements();
  const creating = (first || []).filter((e) => e.status === "creating").slice(0, maxPoll);

  if (creating.length) {
    await Promise.allSettled(creating.map((e) => getKlingElementById(e.id)));
  }

  invalidateKlingElementsCache();
  return await listKlingElements();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getKlingElementById(id: string): Promise<KlingElement> {
  const headers = await authHeadersJson();
  const resp = await fetch(apiUrl(`/api/kling/elements/${encodeURIComponent(id)}`), {
    method: "GET",
    headers,
  });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error leyendo Element.");
  }

  return mapRowToKlingElement(data.item);
}

async function waitKlingElementReady(id: string, opts?: { timeoutMs?: number; intervalMs?: number }) {
  const timeoutMs = Math.max(10_000, Number(opts?.timeoutMs || 180_000));
  const intervalMs = Math.max(800, Number(opts?.intervalMs || 2000));

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const el = await getKlingElementById(id);

    if (el.status === "ready") return el;
    if (el.status === "failed") {
      throw new Error(el.statusDetail || "Kling: falló la creación del Element.");
    }

    if (typeof el.statusDetail === "string" && el.statusDetail.toLowerCase().startsWith("poll_error:")) {
      throw new Error(`Kling: error consultando el estado del Element. ${el.statusDetail}`);
    }

    await sleep(intervalMs);
  }

  throw new Error("Kling: timeout esperando que el Element termine de crearse.");
}

export type CreateKlingElementPayload =
  | {
      name: string;
      tag?: string;
      tagIds?: KlingElementTagId[];
      description?: string;
      voiceId?: string;
      referenceType?: "image_refer";
      images: Array<{ assetId: string } | { dataUrl: string }>;
    }
  | {
      name: string;
      tag?: string;
      tagIds?: KlingElementTagId[];
      description?: string;
      voiceId?: string;
      referenceType: "video_refer";
      video: { assetId: string };
    };

export type CreateKlingElementOptions = {
  waitForReady?: boolean;
  timeoutMs?: number;
  intervalMs?: number;
};

export async function createKlingElement(
  payload: CreateKlingElementPayload,
  opts?: CreateKlingElementOptions
): Promise<KlingElement> {
  const headers = await authHeadersJson();
  const resp = await fetch(apiUrl("/api/kling/elements"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error creando Element.");
  }

  invalidateKlingElementsCache();

  const created = mapRowToKlingElement(data.item);
  const waitForReady = opts?.waitForReady ?? true;

  if (created.status === "creating" && waitForReady) {
    const finalEl = await waitKlingElementReady(created.id, {
      timeoutMs: opts?.timeoutMs ?? 180_000,
      intervalMs: opts?.intervalMs ?? 2000,
    });
    invalidateKlingElementsCache();
    return finalEl;
  }

  return created;
}

export async function deleteKlingElement(id: string): Promise<void> {
  const headers = await authHeadersJson();
  const resp = await fetch(apiUrl(`/api/kling/elements/${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers,
  });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error borrando Element.");
  }
  invalidateKlingElementsCache();
}

// ===============================
// Kling Voices (para element_voice_id)
// ===============================

export type KlingVoice = {
  id: string;
  label: string;
  source?: string;
};

type VoicesCacheEntry = {
  ts: number;
  items: KlingVoice[];
  inFlight?: Promise<KlingVoice[]>;
};

const VOICES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let voicesCache: VoicesCacheEntry | null = null;

export function invalidateKlingVoicesCache() {
  voicesCache = null;
}

export async function listKlingVoices(opts?: { force?: boolean }): Promise<KlingVoice[]> {
  const force = Boolean(opts?.force);

  if (force) invalidateKlingVoicesCache();

  if (voicesCache && Date.now() - voicesCache.ts < VOICES_CACHE_TTL_MS) return voicesCache.items;
  if (voicesCache?.inFlight) return voicesCache.inFlight;

  const headers = await authHeadersJson();

  const inFlight = (async () => {
    const resp = await fetch(apiUrl("/api/kling/voices"), { method: "GET", headers });
    const data = await resp.json();

    if (!resp.ok || data?.ok === false) {
      throw new Error(data?.error?.message || "Error listando voces de Kling.");
    }

    const items = Array.isArray(data.items) ? data.items : Array.isArray(data.voices) ? data.voices : [];

    const out: KlingVoice[] = items
      .map((v: any) => {
        const id = String(v?.id ?? v?.voice_id ?? v ?? "").trim();
        if (!id) return null;
        const label = String(v?.label ?? v?.name ?? id).trim();
        const source = v?.source ? String(v.source) : undefined;
        return { id, label, source };
      })
      .filter(Boolean) as any;

    voicesCache = { ts: Date.now(), items: out };
    return out;
  })();

  voicesCache = { ts: Date.now(), items: voicesCache?.items ?? [], inFlight };
  try {
    return await inFlight;
  } finally {
    if (voicesCache?.inFlight === inFlight) delete voicesCache.inFlight;
  }
}
