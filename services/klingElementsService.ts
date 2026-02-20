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

  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    tag: row.tag ? String(row.tag) : undefined,
    klingElementId: row.klingElementId ?? row.kling_element_id ?? null,
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
  return mapRowToKlingElement(data.item);
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
