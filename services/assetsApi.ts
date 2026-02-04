import { Asset } from "../types";
import { supabase } from "./supabaseClient";

type ApiOk = { ok: true; items: any[] };
type ApiFail = { ok: false; error: any };

function mapRowToAsset(row: any): Asset {
  const createdRaw = row.createdAt ?? row.created_at;
  const createdAt =
    typeof createdRaw === "number"
      ? createdRaw
      : typeof createdRaw === "string"
        ? new Date(createdRaw).getTime()
        : Date.now();

  const ownerId = row.ownerId ?? row.owner_id ?? "";
  const isPublic = !!(row.isPublic ?? row.is_public);

  return {
    id: row.id,
    url: row.url || "",
    type: row.type === "video" ? "video" : "image",
    name: row.name || `Generation ${String(row.id || "").slice(0, 4)}`,
    prompt: row.prompt ?? undefined,
    createdAt,
    ownerId,
    isPublic,
    likes: [],
    comments: [],
  };
}

export async function listMyAssets(opts?: { type?: "image" | "video"; limit?: number }): Promise<Asset[]> {
  // 1) sacar token del login actual
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  // 2) armar URL con filtros
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const url = `/api/assets${params.toString() ? `?${params.toString()}` : ""}`;

  // 3) mandar request con Authorization
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, { method: "GET", headers });

  // 4) leer respuesta (protege del error: Unexpected token '<')
  const text = await resp.text();
  let data: ApiOk | ApiFail | any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `El backend devolvió HTML en vez de JSON (probable: /api/assets no existe aún o Vercel no reescribió). Inicio: ${text.slice(0, 30)}`
    );
  }

  if (!resp.ok || data?.ok === false) {
    const e = data?.error;
    const msg = typeof e === "string" ? e : e?.message || `Request failed: ${resp.status}`;
    throw new Error(msg);
  }

  return (Array.isArray(data.items) ? data.items : [])
    .map(mapRowToAsset)
    .filter((a) => a.url); // quita vacíos
}

export async function listPublicAssets(opts?: { type?: "image" | "video"; limit?: number }): Promise<Asset[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const params = new URLSearchParams();
  params.set("scope", "public");
  if (opts?.type) params.set("type", opts.type);
  if (opts?.limit) params.set("limit", String(opts.limit));

  const url = `/api/assets?${params.toString()}`;

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, { method: "GET", headers });

  const text = await resp.text();
  let data: any;
  data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    const e = data?.error;
    throw new Error(e?.message || `Request failed: ${resp.status}`);
  }

  return (Array.isArray(data.items) ? data.items : [])
    .map(mapRowToAsset)
    .filter((a) => a.url);
}

async function authHeadersJson() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function publishAsset(assetId: string) {
  const headers = await authHeadersJson();
  const resp = await fetch(`/api/assets/${assetId}/publish`, { method: "POST", headers });

  const text = await resp.text();
  const data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Publish failed: ${resp.status}`);
  }

  return { isPublic: !!data.isPublic };
}

export async function unpublishAsset(assetId: string) {
  const headers = await authHeadersJson();
  const resp = await fetch(`/api/assets/${assetId}/unpublish`, { method: "POST", headers });

  const text = await resp.text();
  const data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Unpublish failed: ${resp.status}`);
  }

  return { isPublic: !!data.isPublic };
}

export async function deleteAsset(assetId: string) {
  const headers = await authHeadersJson();
  const resp = await fetch(`/api/assets/${assetId}`, { method: "DELETE", headers });

  const text = await resp.text();
  const data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Delete failed: ${resp.status}`);
  }

  return { ok: true };
}

export async function uploadUserAsset(file: File, tool = "upload"): Promise<Asset> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });

  const resp = await fetch("/api/assets/upload", {
    method: "POST",
    headers,
    body: JSON.stringify({ dataUrl, name: file.name, tool, type: file.type.startsWith("video") ? "video" : "image" }),
  });

  const text = await resp.text();
  const data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Upload failed");
  }

  // backend devuelve { item: { ... } }
  const row = data.item;
  return {
    id: row.id,
    url: row.url,
    type: row.type === "video" ? "video" : "image",
    name: row.name || file.name,
    prompt: undefined,
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
    ownerId: row.ownerId,
    isPublic: !!row.isPublic,
    likes: [],
    comments: [],
  };
}
