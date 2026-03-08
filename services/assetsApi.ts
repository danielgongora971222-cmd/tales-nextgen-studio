import { Asset } from "../types";
import { supabase } from "./supabaseClient";
import { apiUrl } from "./apiBase";

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

  const acquiredRaw = (row as any).acquiredAt ?? (row as any).acquired_at;
  const acquiredAt =
    typeof acquiredRaw === "number"
      ? (acquiredRaw < 1e12 ? acquiredRaw * 1000 : acquiredRaw)
      : typeof acquiredRaw === "string"
        ? (isNaN(new Date(acquiredRaw).getTime()) ? undefined : new Date(acquiredRaw).getTime())
        : undefined;

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

    // ✅ DB: public.assets.tool
    tool: row.tool ?? row.meta?.tool ?? row.metadata?.tool ?? undefined,

    prompt: row.prompt ?? row.meta?.prompt ?? undefined,
    createdAt,
    meta: (row as any).meta ?? (row as any).metadata ?? undefined,
    ownerId,
    isPublic,
    accessSource: (row as any).accessSource ?? (row as any).access_source ?? "owned",
    acquiredAt,
    sourceListingId: (row as any).sourceListingId ?? (row as any).source_listing_id ?? null,

    communityListing: (row as any).communityListing ?? (row as any).community_listing ?? null,

    likedByMe: Boolean(row.likedByMe ?? row.liked_by_me ?? false),
    likesCount: Number.isFinite(Number(row.likesCount ?? row.likes_count)) ? Number(row.likesCount ?? row.likes_count) : 0,
    commentsCount: Number.isFinite(Number(row.commentsCount ?? row.comments_count)) ? Number(row.commentsCount ?? row.comments_count) : 0,

    likes: Array.isArray(row.likes) ? row.likes : [],
    comments: Array.isArray(row.comments) ? row.comments : [],
  };
}

function isInternalAsset(asset: Asset): boolean {
  const meta: any = (asset as any)?.meta || {};
  const step = meta?.step;

  // Oculta outputs internos del Paso 1 de FaceSwap (mannequin + guías técnicas)
  return meta?.tool === "faceswap" && (step === 1 || step === "1");
}

// ===============================
// In-memory cache (session) para evitar recargas repetidas de historial/pickers
// - Se invalida automáticamente cuando subes/borras/publicas/unpublicas assets.
// - También podemos invalidarlo desde otras llamadas (ej: generación IA) llamando invalidateMyAssetsCache().
// ===============================

type AssetsCacheEntry = {
  ts: number;
  fetchedLimit: number | null;
  items: Asset[];
  inFlight?: Promise<Asset[]>;
};

const ASSETS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min (reduce recargas entre tools/pickers)

const myAssetsCache = new Map<string, AssetsCacheEntry>();
const publicAssetsCache = new Map<string, AssetsCacheEntry>();
const purchasedAssetsCache = new Map<string, AssetsCacheEntry>();

function cacheKeyFor(type?: "image" | "video") {
  return type ? `type:${type}` : "type:all";
}

function isFresh(entry: AssetsCacheEntry) {
  return Date.now() - entry.ts < ASSETS_CACHE_TTL_MS;
}

export function invalidateMyAssetsCache(type?: "image" | "video") {
  if (type) myAssetsCache.delete(cacheKeyFor(type));
  else myAssetsCache.clear();
}

export function invalidatePublicAssetsCache(type?: "image" | "video") {
  if (type) publicAssetsCache.delete(cacheKeyFor(type));
  else publicAssetsCache.clear();
}

export function invalidatePurchasedAssetsCache(type?: "image" | "video") {
  if (type) purchasedAssetsCache.delete(cacheKeyFor(type));
  else purchasedAssetsCache.clear();
}

function sliceByLimit(items: Asset[], limit?: number) {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return items;
  return items.slice(0, limit);
}

function shouldRefetch(entry: AssetsCacheEntry, nextLimit?: number) {
  // Si está expirado -> refetch
  if (!isFresh(entry)) return true;

  // Si pedimos más de lo que se había pedido antes -> refetch
  if (typeof nextLimit === "number" && Number.isFinite(nextLimit) && nextLimit > 0) {
    const prevLimit = entry.fetchedLimit ?? 0;
    if (nextLimit > prevLimit) return true;
  }

  return false;
}

async function fetchMyAssetsNoCache(opts?: { type?: "image" | "video"; limit?: number }): Promise<Asset[]> {
  // 1) sacar token del login actual
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  // 2) armar URL con filtros
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.limit) params.set("limit", String(opts.limit));

  const path = `/api/assets${params.toString() ? `?${params.toString()}` : ""}`;
  const url = apiUrl(path);

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
    .filter((a) => a.url) // quita vacíos
    .filter((a) => !isInternalAsset(a));
}

async function fetchPublicAssetsNoCache(opts?: { type?: "image" | "video"; limit?: number }): Promise<Asset[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const params = new URLSearchParams();
  params.set("scope", "public");
  if (opts?.type) params.set("type", opts.type);
  if (opts?.limit) params.set("limit", String(opts.limit));

  const url = apiUrl(`/api/assets?${params.toString()}`);

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
    .filter((a) => a.url)
    .filter((a) => !isInternalAsset(a));
}

async function fetchPurchasedAssetsNoCache(opts?: { type?: "image" | "video"; limit?: number }): Promise<Asset[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const params = new URLSearchParams();
  params.set("scope", "purchased");
  if (opts?.type) params.set("type", opts.type);
  if (opts?.limit) params.set("limit", String(opts.limit));

  const url = apiUrl(`/api/assets?${params.toString()}`);

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, { method: "GET", headers });

  const text = await resp.text();
  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `El backend devolvió HTML/texto en vez de JSON en listPurchasedAssets. Inicio: ${text.slice(0, 60)}`
    );
  }

  if (!resp.ok || data?.ok === false) {
    const e = data?.error;
    throw new Error(e?.message || `Request failed: ${resp.status}`);
  }

  return (Array.isArray(data.items) ? data.items : [])
    .map(mapRowToAsset)
    .filter((a) => a.url)
    .filter((a) => !isInternalAsset(a));
}



export async function listMyAssets(opts?: { type?: "image" | "video"; limit?: number; fresh?: boolean }): Promise<Asset[]> {
  const key = cacheKeyFor(opts?.type);
  const limit = opts?.limit;

  if (!opts?.fresh) {
    const existing = myAssetsCache.get(key);

    if (existing && !shouldRefetch(existing, limit)) {
      return sliceByLimit(existing.items, limit);
    }

    // Si ya hay un fetch en vuelo, reutilízalo (evita doble fetch)
    if (existing?.inFlight) {
      const items = await existing.inFlight;
      return sliceByLimit(items, limit);
    }
  }

  // Fetch real (sin cache), y luego actualiza cache
  const entry: AssetsCacheEntry = myAssetsCache.get(key) || {
    ts: 0,
    fetchedLimit: null,
    items: [],
  };

  const inFlight = fetchMyAssetsNoCache({ type: opts?.type, limit: opts?.limit });
  entry.inFlight = inFlight;
  myAssetsCache.set(key, entry);

  try {
    const items = await inFlight;
    entry.ts = Date.now();
    entry.fetchedLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : null;
    entry.items = items;
    delete entry.inFlight;
    myAssetsCache.set(key, entry);
    return sliceByLimit(items, limit);
  } catch (e) {
    delete entry.inFlight;
    myAssetsCache.set(key, entry);
    throw e;
  }
}


export async function listPublicAssets(opts?: { type?: "image" | "video"; limit?: number; fresh?: boolean }): Promise<Asset[]> {
  const key = cacheKeyFor(opts?.type);
  const limit = opts?.limit;

  if (!opts?.fresh) {
    const existing = publicAssetsCache.get(key);

    if (existing && !shouldRefetch(existing, limit)) {
      return sliceByLimit(existing.items, limit);
    }

    if (existing?.inFlight) {
      const items = await existing.inFlight;
      return sliceByLimit(items, limit);
    }
  }

  const entry: AssetsCacheEntry = publicAssetsCache.get(key) || {
    ts: 0,
    fetchedLimit: null,
    items: [],
  };

  const inFlight = fetchPublicAssetsNoCache({ type: opts?.type, limit: opts?.limit });
  entry.inFlight = inFlight;
  publicAssetsCache.set(key, entry);

  try {
    const items = await inFlight;
    entry.ts = Date.now();
    entry.fetchedLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : null;
    entry.items = items;
    delete entry.inFlight;
    publicAssetsCache.set(key, entry);
    return sliceByLimit(items, limit);
  } catch (e) {
    delete entry.inFlight;
    publicAssetsCache.set(key, entry);
    throw e;
  }
}

export async function listPurchasedAssets(opts?: { type?: "image" | "video"; limit?: number; fresh?: boolean }): Promise<Asset[]> {
  const key = cacheKeyFor(opts?.type);
  const limit = opts?.limit;

  if (!opts?.fresh) {
    const existing = purchasedAssetsCache.get(key);

    if (existing && !shouldRefetch(existing, limit)) {
      return sliceByLimit(existing.items, limit);
    }

    if (existing?.inFlight) {
      const items = await existing.inFlight;
      return sliceByLimit(items, limit);
    }
  }

  const entry: AssetsCacheEntry = purchasedAssetsCache.get(key) || {
    ts: 0,
    fetchedLimit: null,
    items: [],
  };

  const inFlight = fetchPurchasedAssetsNoCache({ type: opts?.type, limit: opts?.limit });
  entry.inFlight = inFlight;
  purchasedAssetsCache.set(key, entry);

  try {
    const items = await inFlight;
    entry.ts = Date.now();
    entry.fetchedLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : null;
    entry.items = items;
    delete entry.inFlight;
    purchasedAssetsCache.set(key, entry);
    return sliceByLimit(items, limit);
  } catch (e) {
    delete entry.inFlight;
    purchasedAssetsCache.set(key, entry);
    throw e;
  }
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
  const resp = await fetch(apiUrl(`/api/assets/${assetId}/publish`), { method: "POST", headers });

  const text = await resp.text();
  const data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Publish failed: ${resp.status}`);
  }
 
  invalidateMyAssetsCache();
  invalidatePublicAssetsCache();

  return { isPublic: !!data.isPublic };
}

export async function unpublishAsset(assetId: string) {
  const headers = await authHeadersJson();
  const resp = await fetch(apiUrl(`/api/assets/${assetId}/unpublish`), { method: "POST", headers });

  const text = await resp.text();
  const data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Unpublish failed: ${resp.status}`);
  }

  invalidateMyAssetsCache();
  invalidatePublicAssetsCache();

  return { isPublic: !!data.isPublic };
}

export async function deleteAsset(assetId: string) {
  const headers = await authHeadersJson();
  const resp = await fetch(apiUrl(`/api/assets/${assetId}`), { method: "DELETE", headers });

  const text = await resp.text();
  const data = JSON.parse(text);

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error?.message || `Delete failed: ${resp.status}`);
  }

  invalidateMyAssetsCache();
  invalidatePublicAssetsCache();
  invalidatePurchasedAssetsCache();

  return {
    ok: true,
    mode: data?.mode || "deleted",
  };
}

export async function uploadUserAsset(
  file: File,
  toolOrOpts:
    | string
    | {
        tool?: string;
        category?: string;
        name?: string;
        type?: "image" | "video";
        meta?: Record<string, any>;
      } = "upload"
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
  const meta = opts.meta && typeof opts.meta === "object" ? opts.meta : undefined;

  const headersJson: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headersJson["Authorization"] = `Bearer ${token}`;

    // ---------- 0) INTENTO PRINCIPAL: presign + upload directo ----------
    let presignErr: any = null;
    try {
      const presignResp = await fetch(apiUrl("/api/assets/presign-upload"), {
      method: "POST",
      headers: headersJson,
      body: JSON.stringify({
        tool,
        name,
        type,
        category,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }),
    });

    const presignText = await presignResp.text();
    let presignData: any;
    try {
      presignData = JSON.parse(presignText);
    } catch {
      presignData = null;
    }

    if (presignResp.ok && presignData?.ok === true && presignData?.upload?.storagePath) {
      const upload = presignData.upload;

      if (upload.provider === "r2") {
        const putHeaders: Record<string, string> = upload.headers || {};
        const putResp = await fetch(upload.url, {
          method: upload.method || "PUT",
          headers: putHeaders,
          body: file,
        });

        if (!putResp.ok) {
          const errText = await putResp.text();
          throw new Error(`R2 upload failed: ${putResp.status} ${errText}`);
        }
      } else if (upload.provider === "supabase") {
        // Fallback: Supabase signed upload (si algún día pones STORAGE_PROVIDER=supabase)
        if (!upload.bucket || !upload.path || !upload.token) {
          throw new Error("Supabase signed upload incompleto (bucket/path/token).");
        }

        const anySb: any = supabase as any;
        const fn = anySb?.storage?.from?.(upload.bucket)?.uploadToSignedUrl;
        if (typeof fn !== "function") {
          throw new Error("supabase-js no soporta uploadToSignedUrl en el cliente.");
        }

        const { error: upErr } = await supabase.storage
          .from(upload.bucket)
          .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type || "application/octet-stream" });

        if (upErr) throw new Error(upErr.message);
      } else {
        throw new Error(`Proveedor de upload desconocido: ${String(upload.provider)}`);
      }

      const completeResp = await fetch(apiUrl("/api/assets/complete-upload"), {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({
          storagePath: upload.storagePath,
          tool,
          name,
          type,
          category,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          meta,
        }),
      });

      const completeText = await completeResp.text();
      let completeData: any;
      try {
        completeData = JSON.parse(completeText);
      } catch {
        throw new Error(`Complete upload devolvió texto no JSON. Inicio: ${completeText.slice(0, 80)}`);
      }

      if (!completeResp.ok || completeData?.ok === false) {
        const e = completeData?.error;
        const msg = typeof e === "string" ? e : e?.message;
        throw new Error(msg || `Complete upload failed: ${completeResp.status}`);
      }

      const row = completeData.item;
      invalidateMyAssetsCache();

      return {
        id: row.id,
        url: row.url,
        type: row.type === "video" ? "video" : "image",
        name: row.name || file.name,
        tool: row.tool ?? tool,
        prompt: undefined,
        createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
        meta: row.meta ?? meta ?? undefined,
        ownerId: row.ownerId,
        isPublic: !!row.isPublic,

        likedByMe: false,
        likesCount: 0,
        commentsCount: 0,

        likes: [],
        comments: [],
      };
    }
  } catch (e: any) {
    // Guardamos el error para dar un diagnóstico claro si el fallback también falla.
    presignErr = e;
  }

  // ---------- 1) FALLBACK: multipart/form-data (legacy) ----------
  const form = new FormData();
  form.append("file", file, name);
  form.append("tool", tool);
  form.append("name", name);
  form.append("type", type);
  if (category) form.append("category", category);
  if (meta) form.append("meta", JSON.stringify(meta));

  const headersMultipart: Record<string, string> = {};
  if (token) headersMultipart["Authorization"] = `Bearer ${token}`;

  let resp: Response;
  try {
    resp = await fetch(apiUrl("/api/assets/upload"), {
      method: "POST",
      headers: headersMultipart,
      body: form,
    });
  } catch (e: any) {
    const msg = String(e?.message || "");
    const presignMsg = presignErr ? String(presignErr?.message || presignErr) : "";

    // Error típico cuando el navegador bloquea un cross-origin PUT (R2 CORS) o hay un bloqueo de red.
    if (msg.includes("Failed to fetch") || msg.toLowerCase().includes("networkerror")) {
      throw new Error(
        [
          "No se pudo subir el archivo (Failed to fetch).",
          "",
          "Causas típicas:",
          "1) CORS del bucket R2 no permite PUT desde tu dominio de Vercel.",
          "2) El backend /api no está accesible desde el navegador (rewrites/CORS/caído).",
          "",
          presignMsg ? `Detalle presign/R2: ${presignMsg}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    throw e;
  }

  const text = await resp.text();
  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `El backend devolvió HTML/texto en vez de JSON en uploadUserAsset. Inicio: ${text.slice(0, 80)}`
    );
  }

  const shouldFallbackToJsonBase64 =
    (!resp.ok || data?.ok === false) &&
    data?.error?.code === "VALIDATION_ERROR" &&
    Array.isArray(data?.error?.details) &&
    data.error.details.some((d: any) => d?.field === "dataUrl");

  if (shouldFallbackToJsonBase64) {
    // ---------- 2) FALLBACK EXTREMO: JSON (base64) ----------
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });

    const resp2 = await fetch(apiUrl("/api/assets/upload"), {
      method: "POST",
      headers: headersJson,
      body: JSON.stringify({ dataUrl, name, tool, category, type, meta }),
    });

    const text2 = await resp2.text();
    let data2: any;

    try {
      data2 = JSON.parse(text2);
    } catch {
      throw new Error(
        `El backend devolvió HTML/texto en vez de JSON en uploadUserAsset (fallback). Inicio: ${text2.slice(0, 80)}`
      );
    }

    if (!resp2.ok || data2?.ok === false) {
      const e2 = data2?.error;
      const msg2 = typeof e2 === "string" ? e2 : e2?.message;
      throw new Error(msg2 || `Upload failed: ${resp2.status}`);
    }

    const row2 = data2.item;
    invalidateMyAssetsCache();

    return {
      id: row2.id,
      url: row2.url,
      type: row2.type === "video" ? "video" : "image",
      name: row2.name || file.name,
      tool: row2.tool ?? tool,
      prompt: undefined,
      createdAt: row2.createdAt ? new Date(row2.createdAt).getTime() : Date.now(),
      meta: row2.meta ?? meta ?? undefined,
      ownerId: row2.ownerId,
      isPublic: !!row2.isPublic,

      likedByMe: false,
      likesCount: 0,
      commentsCount: 0,

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
  invalidateMyAssetsCache();

  return {
    id: row.id,
    url: row.url,
    type: row.type === "video" ? "video" : "image",
    name: row.name || file.name,
    tool: row.tool ?? tool,
    prompt: undefined,
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
    meta: row.meta ?? meta ?? undefined,
    ownerId: row.ownerId,
    isPublic: !!row.isPublic,

    likedByMe: false,
    likesCount: 0,
    commentsCount: 0,

    likes: [],
    comments: [],
  };
}

export async function downloadAssetToDisk(assetId: string, filenameHint?: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Debes iniciar sesión para descargar.");
  }

  const resp = await fetch(apiUrl(`/api/assets/${assetId}/download`), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const raw = await resp.text();
    try {
      const parsed = JSON.parse(raw);
      const msg = parsed?.error?.message || `Download failed (${resp.status})`;
      throw new Error(msg);
    } catch {
      throw new Error(`Download failed (${resp.status}). Inicio: ${raw.slice(0, 120)}`);
    }
  }

  const blob = await resp.blob();

  let filename = filenameHint || "download";
  const disp = resp.headers.get("content-disposition") || resp.headers.get("Content-Disposition");
  if (disp) {
    const m = disp.match(/filename=\"?([^\";]+)\"?/i);
    if (m && m[1]) filename = m[1];
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


