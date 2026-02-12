import { httpError } from "./errors.js";

export function createStorageHelpers(supabaseAdmin, bucket) {
  function ensureSupabase() {
    if (!supabaseAdmin) {
      throw httpError(500, "SUPABASE_NOT_CONFIGURED", "Supabase no está configurado en el backend.");
    }
    if (!bucket) {
      throw httpError(500, "SUPABASE_BUCKET_MISSING", "SUPABASE_BUCKET no está configurado.");
    }
  }

  function parseDataUrl(dataUrl) {
    // Espera: data:image/png;base64,AAAA...
    const match =
      typeof dataUrl === "string"
        ? dataUrl.match(/^data:([^;]+);base64,(.+)$/)
        : null;

    if (!match) return { mimeType: "image/png", base64: dataUrl };
    return { mimeType: match[1], base64: match[2] };
  }

  function extFromMime(mimeType) {
    const t = String(mimeType || "").toLowerCase();
    // video
    if (t.includes("video/mp4") || t.includes("mp4")) return "mp4";
    if (t.includes("video/webm") || t.includes("webm")) return "webm";
    if (t.includes("quicktime") || t.includes("mov")) return "mov";
    // images
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
    const ext = extFromMime(mimeType || "image/png");
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const ts = Date.now();
    const rand = Math.random().toString(16).slice(2, 10);
    const slug = safeSlug(nameHint || tool || "asset");
    const folder = safeSlug(tool || "generated");
    return `${userId}/${folder}/${day}/${ts}-${rand}-${slug}.${ext}`;
  }

  async function uploadBase64ToStorage({ userId, tool, dataUrl, nameHint }) {
    ensureSupabase();
    const { mimeType, base64 } = parseDataUrl(dataUrl);
    const bytes = Buffer.from(base64, "base64");
    const path = buildAssetPath({ userId, tool, mimeType, nameHint });

    const up = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, bytes, { contentType: mimeType, upsert: false });

    if (up.error) throw new Error(up.error.message);
    return { storagePath: path, mimeType, sizeBytes: bytes.length };
  }

  async function uploadBufferToStorage({
    userId,
    tool,
    buffer,
    mimeType,
    nameHint,
  }) {
    ensureSupabase();
    if (!buffer) throw new Error("Missing buffer");
    const ct = mimeType || "application/octet-stream";
    const path = buildAssetPath({ userId, tool, mimeType: ct, nameHint });

    const up = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, buffer, { contentType: ct, upsert: false });

    if (up.error) throw new Error(up.error.message);
    return { storagePath: path, mimeType: ct, sizeBytes: buffer.length };
  }

  async function signStoragePath(storagePath, expiresSeconds = 60 * 60) {
    ensureSupabase();
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, expiresSeconds);

    if (error) {
      throw httpError(
        500,
        "STORAGE_SIGN_URL_FAILED",
        "No pude firmar la URL del archivo en Storage.",
        { storagePath, expiresSeconds, supabase: error }
      );
    }
    return data.signedUrl;
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

    if (error) throw new Error(error.message);
    return data.id;
  }

  return {
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    signStoragePath,
    insertAssetRow,
  };
}
