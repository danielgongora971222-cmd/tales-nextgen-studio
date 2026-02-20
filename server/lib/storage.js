import { Readable } from "node:stream";
import { httpError } from "./errors.js";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Storage helpers (PRO):
 * - Mantiene Supabase Storage (compatibilidad con assets viejos)
 * - Agrega Cloudflare R2 (S3 compatible) con:
 *   - upload server-side (para outputs generados por workers)
 *   - presigned PUT (para uploads directos desde el navegador)
 *   - signed GET (para servir URLs temporales)
 *
 * Convención importante:
 * - storage_path en DB:
 *   - Supabase: "userId/..." (sin prefijo)
 *   - R2:       "r2:userId/..."
 */

function isConfigObject(x) {
  return !!x && typeof x === "object" && (
    Object.prototype.hasOwnProperty.call(x, "supabase") ||
    Object.prototype.hasOwnProperty.call(x, "bucket") ||
    Object.prototype.hasOwnProperty.call(x, "provider") ||
    Object.prototype.hasOwnProperty.call(x, "r2")
  );
}

function mimeFromPath(path) {
  const p = String(path || "").toLowerCase().replace(/^r2:/, "");
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".mp4")) return "video/mp4";
  if (p.endsWith(".webm")) return "video/webm";
  if (p.endsWith(".mov")) return "video/quicktime";
  return "application/octet-stream";
}

async function readableToBuffer(body) {
  if (!body) return Buffer.alloc(0);

  if (Buffer.isBuffer(body)) return body;

  if (body instanceof Uint8Array) return Buffer.from(body);

  // AWS SDK v3 (Node): Body suele ser Readable
  if (body instanceof Readable) {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  // fallback muy defensivo
  try {
    return Buffer.from(body);
  } catch {
    return Buffer.alloc(0);
  }
}

function parseStoragePath(storagePath) {
  const raw = String(storagePath || "");
  if (raw.startsWith("r2:")) {
    return { provider: "r2", key: raw.slice(3) };
  }
  return { provider: "supabase", key: raw };
}

function wrapStoragePath(provider, key) {
  return provider === "r2" ? `r2:${key}` : key;
}

export function createStorageHelpers(arg1, arg2) {
  const cfg = isConfigObject(arg1) ? arg1 : { supabase: arg1, bucket: arg2 };

  const supabaseAdmin = cfg.supabase ?? null;
  const supabaseBucket = cfg.bucket ?? null;

  const providerDefault = String(
    cfg.provider ?? process.env.STORAGE_PROVIDER ?? "supabase"
  ).toLowerCase();

  const r2 = {
    accessKeyId: cfg.r2?.accessKeyId ?? process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: cfg.r2?.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY,
    endpoint: cfg.r2?.endpoint ?? process.env.R2_ENDPOINT,
    bucket: cfg.r2?.bucket ?? process.env.R2_BUCKET,
    region: cfg.r2?.region ?? process.env.R2_REGION ?? "auto",
    publicBaseUrl: cfg.r2?.publicBaseUrl ?? process.env.R2_PUBLIC_BASE_URL ?? null,
  };

  let s3 = null;

  function ensureSupabase() {
    if (!supabaseAdmin) {
      throw httpError(
        500,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase no está configurado en el backend."
      );
    }
    if (!supabaseBucket) {
      throw httpError(
        500,
        "SUPABASE_BUCKET_MISSING",
        "SUPABASE_BUCKET no está configurado."
      );
    }
  }

  function ensureR2() {
    if (!r2.accessKeyId || !r2.secretAccessKey || !r2.endpoint || !r2.bucket) {
      throw httpError(
        500,
        "R2_NOT_CONFIGURED",
        "R2 no está configurado. Faltan R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT / R2_BUCKET."
      );
    }
    if (!s3) {
      s3 = new S3Client({
        region: r2.region || "auto",
        endpoint: r2.endpoint,
        credentials: {
          accessKeyId: r2.accessKeyId,
          secretAccessKey: r2.secretAccessKey,
        },
        forcePathStyle: true,
      });
    }
    return s3;
  }

  const strictR2Raw = cfg.strictR2 ?? process.env.STORAGE_STRICT_R2 ?? "";
  const strictR2 =
    String(strictR2Raw).toLowerCase() === "true" ||
    String(strictR2Raw) === "1" ||
    String(strictR2Raw).toLowerCase() === "yes";

  if (strictR2 && providerDefault !== "r2") {
    throw httpError(
      500,
      "STORAGE_STRICT_R2_REQUIRES_R2_PROVIDER",
      "STORAGE_STRICT_R2 está activo pero STORAGE_PROVIDER no es 'r2'.",
      { providerDefault }
    );
  }

  // Fail-fast: si STORAGE_PROVIDER=r2, validamos que R2 esté bien configurado al arrancar.
  if (providerDefault === "r2") {
    ensureR2();
  }

  function assertR2Only(storagePath) {
    if (strictR2 && !String(storagePath || "").startsWith("r2:")) {
      throw httpError(
        500,
        "STORAGE_STRICT_R2_BLOCKED",
        "STORAGE_STRICT_R2 está activo: este storage_path no apunta a R2 (falta prefijo r2:). Ejecuta la migración a R2 o corrige el registro.",
        { storagePath }
      );
    }
  }

  function parseDataUrl(dataUrl) {
    const match =
      typeof dataUrl === "string"
        ? dataUrl.match(/^data:([^;]+);base64,(.+)$/)
        : null;

    if (!match) return { mimeType: "image/png", base64: dataUrl };
    return { mimeType: match[1], base64: match[2] };
  }

  function extFromMime(mimeType) {
    const t = String(mimeType || "").toLowerCase();
    if (t.includes("video/mp4") || t.includes("mp4")) return "mp4";
    if (t.includes("video/webm") || t.includes("webm")) return "webm";
    if (t.includes("quicktime") || t.includes("mov")) return "mov";
    if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
    if (t.includes("webp")) return "webp";
    if (t.includes("png")) return "png";
    return "bin";
  }

  function safeSlug(input) {
    return (
      (input || "file")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_.]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "file"
    );
  }

  function buildAssetPath({ userId, tool, mimeType, nameHint }) {
    const ext = extFromMime(mimeType || "application/octet-stream");
    const day = new Date().toISOString().slice(0, 10);
    const ts = Date.now();
    const rand = Math.random().toString(16).slice(2, 10);
    const slug = safeSlug(nameHint || tool || "asset");
    const folder = safeSlug(tool || "generated");
    return `${userId}/${folder}/${day}/${ts}-${rand}-${slug}.${ext}`;
  }

  function providerForNewObjects() {
    return providerDefault === "r2" ? "r2" : "supabase";
  }

  async function uploadBytesToProvider({ provider, key, bytes, contentType }) {
    const ct = contentType || "application/octet-stream";
    const isStreamLike = !!bytes && typeof bytes.pipe === "function";

    if (provider === "r2") {
      const client = ensureR2();
      await client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: key,
          Body: bytes,
          ContentType: ct,
        })
      );
      return;
    }

    ensureSupabase();

    // Supabase Storage no es confiable con Node streams: bufferizamos si llega stream
    const uploadBody = isStreamLike ? await readableToBuffer(bytes) : bytes;

    const up = await supabaseAdmin.storage
      .from(supabaseBucket)
      .upload(key, uploadBody, { contentType: ct, upsert: false });

    if (up.error) {
      throw httpError(
        500,
        "STORAGE_UPLOAD_FAILED",
        "No se pudo subir el archivo a Supabase Storage.",
        { bucket: supabaseBucket, key, mimeType: ct, supabase: { message: up.error.message, name: up.error.name } }
      );
    }
  }

  async function uploadBase64ToStorage({ userId, tool, dataUrl, nameHint }) {
    const provider = providerForNewObjects();

    let parsed;
    try {
      parsed = parseDataUrl(dataUrl);
    } catch {
      throw httpError(
        400,
        "INVALID_DATA_URL",
        "El archivo no es un dataUrl válido.",
        { tool, nameHint }
      );
    }

    const mimeType = parsed.mimeType || "application/octet-stream";

    let bytes;
    try {
      bytes = Buffer.from(parsed.base64, "base64");
    } catch {
      throw httpError(
        400,
        "INVALID_BASE64",
        "El archivo no se pudo decodificar (base64 inválido).",
        { tool, nameHint, mimeType }
      );
    }

    const key = buildAssetPath({ userId, tool, mimeType, nameHint });

    await uploadBytesToProvider({ provider, key, bytes, contentType: mimeType });

    return {
      storagePath: wrapStoragePath(provider, key),
      mimeType,
      sizeBytes: bytes.length,
    };
  }

  async function uploadBufferToStorage({ userId, tool, buffer, mimeType, nameHint }) {
    const provider = providerForNewObjects();

    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw httpError(
        400,
        "MISSING_FILE_BUFFER",
        "No llegó el archivo al servidor (buffer vacío).",
        { tool, nameHint }
      );
    }

    const ct = mimeType || "application/octet-stream";
    const key = buildAssetPath({ userId, tool, mimeType: ct, nameHint });

    await uploadBytesToProvider({ provider, key, bytes: buffer, contentType: ct });

    return {
      storagePath: wrapStoragePath(provider, key),
      mimeType: ct,
      sizeBytes: buffer.length,
    };
  }

  async function uploadStreamToStorage({ userId, tool, stream, mimeType, nameHint, sizeBytes }) {
  const provider = providerForNewObjects();

  if (!stream || typeof stream.pipe !== "function") {
    throw httpError(
      400,
      "MISSING_FILE_STREAM",
      "No llegó el archivo al servidor (stream vacío).",
      { tool, nameHint }
    );
  }

  const ct = mimeType || "application/octet-stream";
  const key = buildAssetPath({ userId, tool, mimeType: ct, nameHint });

  await uploadBytesToProvider({ provider, key, bytes: stream, contentType: ct });

  return {
    storagePath: wrapStoragePath(provider, key),
    mimeType: ct,
    sizeBytes: Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : null,
  };
}

  async function signStoragePath(storagePath, expiresSeconds = 60 * 60) {
    assertR2Only(storagePath);
    const { provider, key } = parseStoragePath(storagePath);

    if (provider === "r2") {
      const client = ensureR2();
      return await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: r2.bucket, Key: key }),
        { expiresIn: expiresSeconds }
      );
    }

    ensureSupabase();
    const { data, error } = await supabaseAdmin.storage
      .from(supabaseBucket)
      .createSignedUrl(key, expiresSeconds);

    if (error) {
      throw httpError(
        500,
        "STORAGE_SIGN_URL_FAILED",
        "No pude firmar la URL del archivo en Storage.",
        { storagePath, expiresSeconds, supabase: { message: error.message, name: error.name } }
      );
    }

    return data.signedUrl;
  }

  async function deleteStoragePath(storagePath) {
    assertR2Only(storagePath);
    const { provider, key } = parseStoragePath(storagePath);

    if (provider === "r2") {
      const client = ensureR2();
      await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
      return;
    }

    ensureSupabase();
    const { error } = await supabaseAdmin.storage
      .from(supabaseBucket)
      .remove([key]);

    if (error) {
      throw httpError(
        500,
        "STORAGE_DELETE_FAILED",
        "No se pudo eliminar el archivo del Storage.",
        { storagePath, supabase: { message: error.message, name: error.name } }
      );
    }
  }

  async function downloadStoragePath(storagePath) {
    assertR2Only(storagePath);
    const { provider, key } = parseStoragePath(storagePath);

    if (provider === "r2") {
      const client = ensureR2();
      const out = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
      const buffer = await readableToBuffer(out.Body);
      return { buffer, mimeType: out.ContentType || mimeFromPath(key) };
    }

    ensureSupabase();
    const dl = await supabaseAdmin.storage.from(supabaseBucket).download(key);
    if (dl.error || !dl.data) {
      throw httpError(
        500,
        "ASSET_DOWNLOAD_FAILED",
        dl.error?.message || "No se pudo descargar el asset desde Storage.",
        { storagePath }
      );
    }

    const blob = dl.data;
    const ab = await blob.arrayBuffer();
    const buffer = Buffer.from(ab);
    const mimeType = blob.type || mimeFromPath(key);

    return { buffer, mimeType };
  }

  /**
   * Presigned upload para el navegador:
   * - R2: devuelve URL PUT + headers requeridos
   * - Supabase: devuelve token/path/bucket para uploadToSignedUrl (fallback)
   */
  async function createClientUploadTarget({
    userId,
    tool,
    mimeType,
    nameHint,
    expiresSeconds = 15 * 60,
  }) {
    const provider = providerForNewObjects();
    const ct = mimeType || "application/octet-stream";
    const key = buildAssetPath({ userId, tool, mimeType: ct, nameHint });

    if (provider === "r2") {
      const client = ensureR2();
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: key,
          ContentType: ct,
        }),
        { expiresIn: expiresSeconds }
      );

      return {
        provider: "r2",
        method: "PUT",
        url,
        headers: { "Content-Type": ct },
        storagePath: wrapStoragePath("r2", key),
        expiresInSeconds: expiresSeconds,
      };
    }

    ensureSupabase();
    const st = supabaseAdmin.storage.from(supabaseBucket);
    if (typeof st.createSignedUploadUrl !== "function") {
      throw httpError(
        500,
        "SUPABASE_SIGNED_UPLOAD_UNSUPPORTED",
        "Tu versión de supabase-js no soporta createSignedUploadUrl. Actualiza @supabase/supabase-js."
      );
    }

    const { data, error } = await st.createSignedUploadUrl(key);
    if (error || !data?.token) {
      throw httpError(
        500,
        "SUPABASE_CREATE_SIGNED_UPLOAD_FAILED",
        "No se pudo crear signed upload URL en Supabase Storage.",
        { key, supabase: { message: error?.message, name: error?.name } }
      );
    }

    return {
      provider: "supabase",
      bucket: supabaseBucket,
      path: data.path || key,
      token: data.token,
      signedUrl: data.signedUrl || null,
      storagePath: key,
      expiresInSeconds: 2 * 60 * 60,
    };
  }

  async function insertAssetRow({
    ownerId,
    type,
    tool,
    name,
    prompt,
    storagePath,
    isPublic,
    meta,
  }) {
    ensureSupabase();

    const payload = {
      owner_id: ownerId,
      type: type || "image",
      tool: tool || null,
      name: name || null,
      prompt: prompt || null,
      storage_path: storagePath,
      is_public: Boolean(isPublic),
      meta: meta || {},
    };

    const { data, error } = await supabaseAdmin
      .from("assets")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      throw httpError(
        500,
        "DB_INSERT_FAILED",
        "No se pudo guardar el asset en la base de datos.",
        {
          table: "assets",
          supabase: {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          },
          payloadKeys: Object.keys(payload),
        }
      );
    }

    return data.id;
  }

  return {
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    wrapStoragePath,
    parseStoragePath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    uploadStreamToStorage,
    signStoragePath,
    deleteStoragePath,
    createClientUploadTarget,
    insertAssetRow,
  };
}