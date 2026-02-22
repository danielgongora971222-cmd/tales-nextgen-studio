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
  tag?: string;

  klingElementId?: string | null;

  status?: "creating" | "ready" | "failed";
  statusDetail?: string | null;
  apiVersion?: string | null;
  taskId?: string | null;
  updatedAt?: number | null;

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
    tag: row.tag ? String(row.tag) : undefined,

    klingElementId: row.klingElementId ?? row.kling_element_id ?? null,

    status: (row.status ?? "ready") as any,
    statusDetail: row.statusDetail ?? row.status_detail ?? null,
    apiVersion: row.apiVersion ?? row.api_version ?? null,
    taskId: row.taskId ?? row.kling_task_id ?? null,
    updatedAt,

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

    await sleep(intervalMs);
  }

  throw new Error("Kling: timeout esperando que el Element termine de crearse.");
}

export async function createKlingElement(payload: {
  name: string;
  tag?: string;
  images: Array<{ assetId: string } | { dataUrl: string }>;
}): Promise<KlingElement> {
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

  // ✅ Si viene pending/creating, hacemos polling hasta ready/failed
  if (created.status === "creating") {
    const finalEl = await waitKlingElementReady(created.id, { timeoutMs: 180_000, intervalMs: 2000 });
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
