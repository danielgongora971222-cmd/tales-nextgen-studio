import { supabase } from "./supabaseClient";

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
  const headers = await authHeadersJson();
  const resp = await fetch("/api/kling/elements", { method: "GET", headers });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error listando Elements.");
  }
  return (data.items || []).map(mapRowToKlingElement);
}

export async function createKlingElement(payload: {
  name: string;
  tag?: string;
  images: Array<{ assetId: string } | { dataUrl: string }>;
}): Promise<KlingElement> {
  const headers = await authHeadersJson();
  const resp = await fetch("/api/kling/elements", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error creando Element.");
  }
  return mapRowToKlingElement(data.item);
}

export async function deleteKlingElement(id: string): Promise<void> {
  const headers = await authHeadersJson();
  const resp = await fetch(`/api/kling/elements/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
  const data = await resp.json();

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Error borrando Element.");
  }
}
