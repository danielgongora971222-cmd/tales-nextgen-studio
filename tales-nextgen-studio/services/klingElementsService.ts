import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";

/**
 * Shapes y endpoints reales según server/server.js:
 *  - GET    /api/kling/elements
 *  - POST   /api/kling/elements
 *  - DELETE /api/kling/elements/:id
 */

export type KlingElement = {
  id: string;
  name: string;

  tag?: string | null;
  description?: string | null;
  referenceType?: "image_refer" | "video_refer";
  voiceId?: string | null;

  klingElementId?: string | null;

  status?: "creating" | "ready" | "failed";
  statusDetail?: string | null;
  apiVersion?: string | null;
  taskId?: string | null;
  updatedAt?: number | null;

  previewType?: "image" | "video";
  previewUrl?: string | null;

  imageUrls: string[];
  createdAt: number;
};

// ===============================
// Cache en memoria (session) para evitar recargar Elements en cada tool/picker
// ===============================

type ElementsCacheEntry = {
  ts: number;
  items: KlingElement[];
  inFlight?: Promise<KlingElement[]>;
};

const ELEMENTS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

let elementsCache: ElementsCacheEntry | null = null;

export function invalidateKlingElementsCache() {
  elementsCache = null;
}

function elementsCacheFresh() {
  return elementsCache && Date.now() - elementsCache.ts < ELEMENTS_CACHE_TTL_MS;
}

async function authHeadersJson() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function mapRowToKlingElement(row: any): KlingElement {
  const createdRaw = row.created_at ?? row.createdAt;
  const createdAt =
    typeof createdRaw === "string"
      ? new Date(createdRaw).getTime()
      : typeof createdRaw === "number"
        ? createdRaw
        : Date.now();

  const updatedRaw = row.updated_at ?? row.updatedAt;
  const updatedAt =
    typeof updatedRaw === "string"
      ? new Date(updatedRaw).getTime()
      : typeof updatedRaw === "number"
        ? updatedRaw
        : null;

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    tag: row.tag != null ? String(row.tag) : null,
    description: row.description != null ? String(row.description) : null,
    referenceType: (row.referenceType ?? row.reference_type ?? "image_refer") as any,
    voiceId: row.voiceId ?? row.voice_id ?? null,

    klingElementId: row.klingElementId ?? row.kling_element_id ?? null,

    status: (row.status ?? "ready") as any,
    statusDetail: row.statusDetail ?? row.status_detail ?? null,
    apiVersion: row.apiVersion ?? row.api_version ?? null,
    taskId: row.taskId ?? row.kling_task_id ?? null,
    updatedAt,

    previewType: (row.previewType ?? row.preview_type ?? (row.videoAssetId || row.video_asset_id ? "video" : "image")) as any,
    previewUrl: row.previewUrl ?? row.preview_url ?? null,
    imageUrls: Array.isArray(row.imageUrls ?? row.image_urls) ? (row.imageUrls ?? row.image_urls).map(String) : [],
    createdAt,
  };
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

    // ✅ Si el backend no pudo consultar el task (auth / endpoint / red), no tiene sentido esperar 3 min.
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
      description?: string;
      voiceId?: string;
      referenceType?: "image_refer";
      images: Array<{ assetId: string } | { dataUrl: string }>;
    }
  | {
      name: string;
      tag?: string;
      description?: string;
      voiceId?: string;
      referenceType: "video_refer";
      video: { assetId: string };
    };

export type CreateKlingElementOptions = {
  // Si es false, devolvemos rápido aunque Kling siga procesando (status="creating").
  waitForReady?: boolean;

  // Solo aplica cuando waitForReady=true
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

  // ✅ Si viene creating y el caller quiere esperar, hacemos polling.
  if (created.status === "creating" && waitForReady) {
    const finalEl = await waitKlingElementReady(created.id, {
      timeoutMs: opts?.timeoutMs ?? 180_000,
      intervalMs: opts?.intervalMs ?? 2000,
    });
    invalidateKlingElementsCache();
    return finalEl;
  }

  // ✅ Modo recomendado para UI: devolver rápido y dejar que worker/Refresh status actualice.
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
// La lista se obtiene del backend (/api/kling/voices), que consulta la librería de voces de Kling
// (o un catálogo manual vía variables de entorno).
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

const VOICES_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
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
