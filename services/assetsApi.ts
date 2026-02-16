import { Asset } from "../types";
import { supabase } from "./supabaseClient";

type ApiOk = { ok: true; items: any[] };
type ApiFail = { ok: false; error: any };

function mapRowToAsset(row: any): Asset {
  const createdRaw =
    row.createdAt ?? row.created_at ?? row.created ?? row.created_time ?? row.timestamp;

  const createdAt =
    typeof createdRaw === "number"
      ? (createdRaw < 1e12 ? createdRaw * 1000 : createdRaw) // por si viene en segundos
      : typeof createdRaw === "string"
        ? (isNaN(new Date(createdRaw).getTime()) ? Date.now() : new Date(createdRaw).getTime())
        : Date.now();

  const ownerId = String(row.ownerId ?? row.owner_id ?? row.userId ?? row.user_id ?? "");

  const isPublic = !!(row.isPublic ?? row.is_public ?? row.public ?? row.is_public_asset);

  // Normaliza el type a "image" | "video"
  const rawType = String(row.type ?? row.assetType ?? row.mimeType ?? "");
  const type: "image" | "video" =
    rawType === "video" || rawType.startsWith("video") ? "video" : "image";

  return {
    id: row.id,
    url: row.url,
    type,
    name: row.name ?? row.filename ?? row.title ?? "",
    prompt: row.prompt ?? row.meta?.prompt ?? undefined,
    createdAt,
    meta: (row as any).meta ?? (row as any).metadata ?? undefined,
    ownerId,
    isPublic,
    likes: Array.isArray(row.likes) ? row.likes : [],
    comments: Array.isArray(row.comments) ? row.comments : [],
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

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `El backend devolvió HTML/texto en vez de JSON en listPublicAssets. Inicio: ${text.slice(0, 60)}`
    );
  }


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

export async function uploadUserAsset(
  file: File,
  toolOrOpts: string | { tool?: string; category?: string; name?: string; type?: "image" | "video" } = "upload"
): Promise<Asset> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const inferredType: "image" | "video" = file.type.startsWith("video") ? "video" : "image";

  const opts =
    typeof toolOrOpts === "string"
      ? { tool: toolOrOpts }
      : toolOrOpts || {};

  const tool = opts.tool ?? "upload";
  const name = opts.name ?? file.name;
  const type = opts.type ?? inferredType;
  const category = opts.category;

  // ---------- 1) INTENTO PRINCIPAL: multipart/form-data ----------
  const form = new FormData();
  form.append("file", file, name);
  form.append("tool", tool);
  form.append("name", name);
  form.append("type", type);
  if (category) form.append("category", category);

  const headersMultipart: Record<string, string> = {};
  if (token) headersMultipart["Authorization"] = `Bearer ${token}`;

  const resp = await fetch("/api/assets/upload", {
    method: "POST",
    headers: headersMultipart,
    body: form,
  });

  const text = await resp.text();
  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `El backend devolvió HTML/texto en vez de JSON en uploadUserAsset. Inicio: ${text.slice(0, 60)}`
    );
  }

  // Si el backend aún no soporta multipart, normalmente devuelve VALIDATION_ERROR por falta de dataUrl.
  const shouldFallbackToJsonBase64 =
    (!resp.ok || data?.ok === false) &&
    data?.error?.code === "VALIDATION_ERROR" &&
    Array.isArray(data?.error?.details) &&
    data.error.details.some((d: any) => d?.field === "dataUrl");

  if (shouldFallbackToJsonBase64) {
    // ---------- 2) FALLBACK: JSON (base64) ----------
    const headersJson: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headersJson["Authorization"] = `Bearer ${token}`;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });

    const resp2 = await fetch("/api/assets/upload", {
      method: "POST",
      headers: headersJson,
      body: JSON.stringify({ dataUrl, name, tool, category, type }),
    });

    const text2 = await resp2.text();
    let data2: any;

    try {
      data2 = JSON.parse(text2);
    } catch {
      throw new Error(
        `El backend devolvió HTML/texto en vez de JSON en uploadUserAsset (fallback). Inicio: ${text2.slice(0, 60)}`
      );
    }

    if (!resp2.ok || data2?.ok === false) {
      const e2 = data2?.error;
      const msg2 = typeof e2 === "string" ? e2 : e2?.message;
      throw new Error(msg2 || `Upload failed: ${resp2.status}`);
    }

    const row2 = data2.item;
    return {
      id: row2.id,
      url: row2.url,
      type: row2.type === "video" ? "video" : "image",
      name: row2.name || file.name,
      prompt: undefined,
      createdAt: row2.createdAt ? new Date(row2.createdAt).getTime() : Date.now(),
      ownerId: row2.ownerId,
      isPublic: !!row2.isPublic,
      likes: [],
      comments: [],
    };
  }

  if (!resp.ok || data?.ok === false) {
    const e = data?.error;
    const msg = typeof e === "string" ? e : e?.message;
    throw new Error(msg || `Upload failed: ${resp.status}`);
  }

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

