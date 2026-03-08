import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { createHmac, randomUUID } from "crypto";

import {
  ImageRequestSchema,
  RestyleSchema,
  FaceSwapMannequinSchema,
  FaceSwapInsertSchema,
  UpscaleSchema,
} from "../schemas/index.js";

import { createStorageHelpers } from "../lib/storage.js";
import { apiError, httpError } from "../lib/errors.js";
import { base64urlEncode } from "../lib/base64url.js";

dotenv.config();

// =============================
// Config
// =============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_BUCKET) throw new Error("Missing SUPABASE_BUCKET");

const WORKER_ID = process.env.WORKER_ID || `image-worker-${randomUUID()}`;
const JOB_KIND = process.env.JOB_KIND || "image";

const CLAIM_LIMIT = Math.max(1, Number(process.env.WORKER_BATCH_SIZE || 2));
const IDLE_SLEEP_MS = Math.max(250, Number(process.env.WORKER_IDLE_SLEEP_MS || 1500));
const LOCK_MINUTES = Math.max(2, Number(process.env.WORKER_LOCK_MINUTES || 15));

// =============================
// Supabase admin + Storage
// =============================
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const storage = createStorageHelpers({ supabase: supabaseAdmin, bucket: SUPABASE_BUCKET });
const {
  parseDataUrl,
  extFromMime,
  safeSlug,
  uploadBase64ToStorage,
  signStoragePath,
  downloadStoragePath,
  insertAssetRow,
} = storage;

// =============================
// AI clients / helpers
// =============================
let aiClient = null;
async function ensureAI() {
  if (aiClient) return aiClient;
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw httpError(503, "AI_NOT_CONFIGURED", "Falta GEMINI_API_KEY en el worker.");
  }
  aiClient = new GoogleGenAI({ apiKey: key });
  return aiClient;
}

function ensureOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("OPENAI_NOT_CONFIGURED");
    err.status = 503;
    err.code = "OPENAI_NOT_CONFIGURED";
    err.details = { hint: "Falta OPENAI_API_KEY en Render" };
    throw err;
  }
  return key;
}

function openaiSizeFromAspectRatio(ar) {
  if (!ar || ar === "auto") return "auto";
  if (ar === "1:1") return "1024x1024";
  if (ar === "3:2") return "1536x1024";
  if (ar === "2:3") return "1024x1536";
  return "auto";
}

function parseOpenAIImageModel(selectedModel) {
  const token = String(selectedModel || "").replace(/^openai:/, "");
  let quality = "auto";
  let model = token || "gpt-image-1.5";

  const m = model.match(/-(high|medium|low)$/);
  if (m) {
    quality = m[1];
    model = model.replace(/-(high|medium|low)$/, "");
  }
  return { model, quality };
}

async function openaiGenerateImageDataUrl({ model, prompt, size, quality = "auto", images = [] }) {
  const key = ensureOpenAIKey();
  const hasImages = Array.isArray(images) && images.length > 0;

  let r;
  let data;

  if (hasImages) {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("prompt", prompt);
    fd.append("n", "1");
    if (size) fd.append("size", size);
    if (quality) fd.append("quality", quality);
    fd.append("output_format", "png");

    for (const img of images) {
      const blob = new Blob([img.buffer], { type: img.mimeType || "image/png" });
      fd.append("image[]", blob, img.filename || "ref.png");
    }

    r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });

    data = await r.json().catch(() => null);
  } else {
    r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: size || "auto",
        quality: quality || "auto",
        output_format: "png",
      }),
    });

    data = await r.json().catch(() => null);
  }

  if (!r.ok) {
    const msg = data?.error?.message || `OpenAI error HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = 400;
    err.code = "OPENAI_IMAGE_FAILED";
    err.details = data?.error || data;
    throw err;
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    const err = new Error("OpenAI no devolvió imagen (b64_json vacío). ");
    err.status = 500;
    err.code = "OPENAI_EMPTY_IMAGE";
    throw err;
  }
  return `data:image/png;base64,${b64}`;
}

async function extractImageDataUrl(response) {
  const candidates = response?.candidates || response?.response?.candidates;
  const parts = candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data) {
      const mimeType = inline.mimeType || inline.mime_type || "image/png";
      return `data:${mimeType};base64,${inline.data}`;
    }
  }

  let msg = "No image generated.";
  try {
    if (typeof response?.text === "string") msg = response.text;
    if (typeof response?.text === "function") msg = String(await response.text());
  } catch (_) {}

  const err = new Error(msg);
  err.status = 400;
  err.code = "GENERATION_REJECTED";
  err.details = {
    hasCandidates: Boolean(candidates?.length),
    partsCount: parts.length,
  };
  throw err;
}

function isImageGenModel(model) {
  return (
    typeof model === "string" &&
    (model.includes("imagen") ||
      model.endsWith("-image") ||
      model.includes("-image-") ||
      model.startsWith("fal-ai/flux-2-") ||
      model.startsWith("kling:"))
  );
}

function maxCountForImageModel(model) {
  if (model === "gemini-3-pro-image-preview") return 1;
  if (model === "fal-ai/flux-2-max") return 1;
  if (model === "fal-ai/flux-2-pro") return 2;
  if (model === "fal-ai/flux-2-flex") return 4;
  if (model && model.startsWith("openai:")) return 1;
  if (model && model.startsWith("kling:")) return 1;
  if (model === "gemini-2.5-flash-image") return 4;
  return 4;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================
// Kling helpers
// =============================
function makeKlingJwt(accessKey, secretKey, ttlSeconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + ttlSeconds,
    nbf: now - 5,
  };

  const unsigned = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(
    JSON.stringify(payload)
  )}`;

  const sig = createHmac("sha256", secretKey).update(unsigned).digest();
  return `${unsigned}.${base64urlEncode(sig)}`;
}

// =============================
// Fal.ai helpers
// =============================
function falAuthHeader() {
  const key = process.env.FAL_KEY;
  if (!key) return null;
  return `Key ${key}`;
}

function falStringify(value, maxLen = 800) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, maxLen);
  try {
    const s = JSON.stringify(value);
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  } catch {
    const s = String(value);
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  }
}

function falDimsFromAspectQuality(aspectRatio, quality) {
  const base = quality === "4K" ? 2048 : quality === "2K" ? 1536 : 1024;

  if (typeof aspectRatio !== "string" || !aspectRatio.includes(":")) {
    return { width: base, height: base };
  }

  const [wStr, hStr] = aspectRatio.split(":");
  const w = Number(wStr);
  const h = Number(hStr);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: base, height: base };
  }

  const long = base;
  const shortRaw = Math.round((base * Math.min(w, h)) / Math.max(w, h));
  const short = Math.max(64, Math.round(shortRaw / 8) * 8);

  if (w >= h) return { width: long, height: short };
  return { width: short, height: long };
}

async function falQueueRun(endpointId, input) {
  const auth = falAuthHeader();
  if (!auth) {
    throw httpError(500, "FAL_KEY_MISSING", "Missing FAL_KEY env var (Fal.ai)");
  }

  const submitUrl = `https://queue.fal.run/${endpointId}`;
  const submitResp = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const submitText = await submitResp.text();
  let submitJson;
  try {
    submitJson = JSON.parse(submitText);
  } catch {
    throw httpError(502, "FAL_BAD_RESPONSE", `Fal submit invalid JSON: ${submitText.slice(0, 200)}`);
  }

  if (!submitResp.ok) {
    throw httpError(
      502,
      "FAL_SUBMIT_FAILED",
      `Fal submit HTTP ${submitResp.status}: ${falStringify(submitJson?.detail || submitJson?.message || submitText, 900)}`.slice(
        0,
        400
      )
    );
  }

  const statusUrl = submitJson?.status_url;
  const responseUrl = submitJson?.response_url;
  const requestId = submitJson?.request_id;

  if (!statusUrl || !responseUrl || !requestId) {
    throw httpError(502, "FAL_SUBMIT_MISSING_FIELDS", "Fal submit missing status_url/response_url/request_id");
  }

  const t0 = Date.now();
  while (true) {
    const statusResp = await fetch(statusUrl, {
      headers: { Authorization: auth },
    });

    const statusText = await statusResp.text();
    let statusJson;
    try {
      statusJson = JSON.parse(statusText);
    } catch {
      throw httpError(502, "FAL_BAD_STATUS", `Fal status invalid JSON: ${statusText.slice(0, 200)}`);
    }

    if (!statusResp.ok) {
      throw httpError(
        502,
        "FAL_STATUS_FAILED",
        `Fal status HTTP ${statusResp.status}: ${falStringify(statusJson?.detail || statusJson?.message || statusText, 900)}`.slice(
          0,
          400
        )
      );
    }

    const st = statusJson?.status;
    if (st === "COMPLETED") break;
    if (st === "FAILED") {
      throw httpError(502, "FAL_FAILED", statusJson?.error || statusJson?.detail || "Fal request failed");
    }

    if (Date.now() - t0 > 120000) {
      throw httpError(504, "FAL_TIMEOUT", "Fal request timed out");
    }
    await sleep(800);
  }

  const resultResp = await fetch(responseUrl, { headers: { Authorization: auth } });
  const resultText = await resultResp.text();

  if (!resultResp.ok) {
    throw httpError(502, "FAL_RESULT_FAILED", `Fal result HTTP ${resultResp.status}: ${resultText.slice(0, 200)}`);
  }

  let resultJson;
  try {
    resultJson = JSON.parse(resultText);
  } catch {
    throw httpError(502, "FAL_BAD_RESULT", `Fal result invalid JSON: ${resultText.slice(0, 200)}`);
  }

  if (resultJson && typeof resultJson === "object" && resultJson.response) {
    return resultJson.response;
  }
  return resultJson;
}

async function falResultImageToDataUrl(img) {
  if (!img) throw httpError(502, "FAL_NO_IMAGE", "Fal result missing image");
  const contentType = img.content_type || "image/png";

  if (img.file_data) {
    if (typeof img.file_data === "string" && img.file_data.startsWith("data:")) return img.file_data;
    if (typeof img.file_data === "string") return `data:${contentType};base64,${img.file_data}`;
  }

  if (!img.url) throw httpError(502, "FAL_NO_URL", "Fal image has no url");
  const r = await fetch(img.url);
  if (!r.ok) throw httpError(502, "FAL_IMAGE_DOWNLOAD_FAILED", `Failed to fetch fal image: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || contentType;
  return `data:${ct};base64,${buf.toString("base64")}`;
}

// =============================
// BFL helpers
// =============================
function bflApiKey() {
  return process.env.BFL_API_KEY || process.env.BFL_KEY || "";
}

async function bflSubmit(modelSlug, payload) {
  const key = bflApiKey();
  if (!key) throw httpError(500, "BFL_KEY_MISSING", "Missing BFL_API_KEY env var (Black Forest Labs)");

  const submitUrl = `https://api.bfl.ai/v1/${modelSlug}`;
  const resp = await fetch(submitUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "x-key": key,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw httpError(502, "BFL_BAD_RESPONSE", `BFL submit invalid JSON: ${text.slice(0, 200)}`);
  }

  if (!resp.ok) {
    throw httpError(502, "BFL_SUBMIT_FAILED", json?.detail || json?.message || text);
  }

  if (!json?.polling_url) {
    throw httpError(502, "BFL_SUBMIT_MISSING_FIELDS", "BFL submit missing polling_url");
  }
  return json;
}

async function bflPoll(pollingUrl, { timeoutMs = 180000 } = {}) {
  const key = bflApiKey();
  if (!key) throw httpError(500, "BFL_KEY_MISSING", "Missing BFL_API_KEY env var (Black Forest Labs)");

  const started = Date.now();
  let delay = 500;

  while (true) {
    const resp = await fetch(pollingUrl, {
      method: "GET",
      headers: { accept: "application/json", "x-key": key },
    });

    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw httpError(502, "BFL_BAD_RESPONSE", `BFL poll invalid JSON: ${text.slice(0, 200)}`);
    }

    if (!resp.ok) {
      throw httpError(502, "BFL_POLL_FAILED", json?.detail || json?.message || text);
    }

    const status = json?.status;
    if (status === "Ready" || status === "completed") return json;
    if (status === "Error" || status === "Failed") {
      throw httpError(502, "BFL_GENERATION_FAILED", "BFL generation failed", json);
    }

    if (Date.now() - started > timeoutMs) {
      throw httpError(504, "BFL_TIMEOUT", "BFL generation timed out");
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.5), 2000);
  }
}

async function bflSampleToDataUrl(sampleUrl) {
  if (!sampleUrl) throw httpError(502, "BFL_NO_SAMPLE_URL", "BFL result missing result.sample");

  const r = await fetch(sampleUrl);
  if (!r.ok) throw httpError(502, "BFL_IMAGE_DOWNLOAD_FAILED", `Failed to fetch BFL image: ${r.status}`);

  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || "image/png";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

// =============================
// Asset helpers
// =============================
async function getAssetRowOrThrow(assetId) {
  const { data, error } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, is_public, storage_path, type")
    .eq("id", assetId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw httpError(404, "ASSET_NOT_FOUND", "Asset no encontrado.", { assetId });
  return data;
}

async function hasCommunityAssetEntitlement(assetId, requesterId) {
  if (!assetId || !requesterId) return false;

  const { data, error } = await supabaseAdmin
    .from("community_asset_entitlements")
    .select("asset_id")
    .eq("asset_id", assetId)
    .eq("user_id", requesterId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw httpError(500, "ASSET_ACCESS_CHECK_FAILED", error.message, { assetId, requesterId });
  }

  return Boolean(data?.asset_id);
}

async function assertAssetReadable(row, requesterId) {
  if (!row) throw httpError(404, "ASSET_NOT_FOUND", "Asset no encontrado.");
  if (row.owner_id === requesterId) return;
  if (row.is_public) return;

  const entitled = await hasCommunityAssetEntitlement(row.id, requesterId);
  if (entitled) return;

  throw httpError(403, "ASSET_FORBIDDEN", "No tienes permisos para acceder a ese asset.");
}

async function assetIdToSignedUrl(assetId, requesterId, expiresSeconds = 600) {
  const row = await getAssetRowOrThrow(assetId);
  await assertAssetReadable(row, requesterId);
  if (!row.storage_path) throw httpError(500, "ASSET_NO_STORAGE_PATH", "Asset sin storage_path.", { assetId });
  return await signStoragePath(row.storage_path, expiresSeconds);
}

async function assetIdToInlinePart(assetId, requesterId) {
  const row = await getAssetRowOrThrow(assetId);
  await assertAssetReadable(row, requesterId);
  if (!row.storage_path) throw httpError(500, "ASSET_NO_STORAGE_PATH", "Asset sin storage_path.", { assetId });
  const { buffer, mimeType } = await downloadStoragePath(row.storage_path);
  return {
    inlineData: {
      mimeType: mimeType || "image/png",
      data: buffer.toString("base64"),
    },
  };
}

async function assetIdToImageFile(assetId, requesterId) {
  const row = await getAssetRowOrThrow(assetId);
  await assertAssetReadable(row, requesterId);
  if (!row.storage_path) throw httpError(500, "ASSET_NO_STORAGE_PATH", "Asset sin storage_path.", { assetId });
  const { buffer, mimeType } = await downloadStoragePath(row.storage_path);
  const filename = `${row.id}.${(mimeType || "image/png").split("/")[1] || "png"}`;
  return { buffer, mimeType: mimeType || "image/png", filename };
}

// =============================
// Faceswap helpers (Gemini)
// =============================
const FACESWAP_MODEL = "gemini-3-pro-image-preview";

function faceswapQualityHint(q) {
  const qq = String(q || "").toUpperCase().trim();
  if (qq === "4K") return "high resolution, crisp details";
  if (qq === "2K") return "high detail";
  return "";
}

function mannequinSwapPrompt(swapType) {
  switch (swapType) {
    case "face":
      return "Create a mannequin version of the person. Remove face details (eyes, nose, mouth) so it's neutral. Keep head shape and hair silhouette if present. Keep same pose, clothing, and background.";
    case "face_hair":
      return "Create a mannequin version of the person. Remove face details (eyes, nose, mouth) and remove/neutralize hair so it's a clean head shape. Keep same pose, clothing, and background.";
    case "body":
      return "Create a mannequin version of the person. Remove face details and remove body identity features. Keep the same pose and background but make the body neutral like a mannequin.";
    case "body_clothes":
      return "Create a mannequin version of the person. Remove face details and remove body identity features but preserve the clothing exactly. Keep the same pose and background.";
    case "clothes_only":
      return "Create a mannequin version of the clothing only: remove the person identity/skin/face completely. Preserve garment shape, folds, and texture, on a neutral mannequin body if needed.";
    default:
      return "Create a mannequin version of the person. Remove face details so it's neutral. Keep pose, clothing, background.";
  }
}

function insertSwapPrompt(swapType) {
  switch (swapType) {
    case "face":
      return "Insert the donor's face onto the base image. Preserve lighting, angle, expression as much as possible. Keep the base image's hair, body, clothes, and background.";
    case "face_hair":
      return "Insert the donor's face and hair onto the base image. Preserve lighting, angle. Keep the base image's body, clothes, and background.";
    case "body":
      return "Insert the donor's head and body identity onto the base image while preserving pose and background. Keep the base clothing if possible unless it conflicts.";
    case "body_clothes":
      return "Insert the donor's identity (face/body) into the base image, but preserve the base clothing exactly. Preserve pose and background.";
    case "clothes_only":
      return "Replace only the clothing in the base image with the donor clothing. Preserve the base person's identity, face, skin, body, and background.";
    default:
      return "Insert the donor onto the base image. Preserve lighting, pose, and background.";
  }
}

function tryGetImageDimsFromBuffer(buf, mimeType) {
  try {
    const mt = String(mimeType || "").toLowerCase();

    if (mt.includes("png") && buf.length >= 24) {
      const isPng =
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a;
      if (isPng) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          return { width, height };
        }
      }
    }

    if ((mt.includes("jpeg") || mt.includes("jpg")) && buf.length >= 4) {
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;

      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }

        const marker = buf[i + 1];

        if (marker === 0xd9 || marker === 0xd8) {
          i += 2;
          continue;
        }

        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }

        const length = buf.readUInt16BE(i + 2);
        if (!length || length < 2) break;

        const isSOF =
          marker === 0xc0 ||
          marker === 0xc1 ||
          marker === 0xc2 ||
          marker === 0xc3 ||
          marker === 0xc5 ||
          marker === 0xc6 ||
          marker === 0xc7 ||
          marker === 0xc9 ||
          marker === 0xca ||
          marker === 0xcb ||
          marker === 0xcd ||
          marker === 0xce ||
          marker === 0xcf;

        if (isSOF) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            return { width, height };
          }
          return null;
        }

        i += 2 + length;
      }
    }
  } catch {
    return null;
  }

  return null;
}

// =============================
// Job claiming / updates
// =============================
async function claimJobsRpc() {
  const { data, error } = await supabaseAdmin.rpc("claim_jobs", {
    p_kind: JOB_KIND,
    p_limit: CLAIM_LIMIT,
    p_worker_id: WORKER_ID,
    p_lock_minutes: LOCK_MINUTES,
  });

  if (!error) return Array.isArray(data) ? data : [];

  const msg = String(error?.message || "");
  if (!msg.toLowerCase().includes("could not find the function")) throw error;

  console.warn("[imageJobsWorker] claim_jobs() no existe en DB. Usando fallback SELECT (menos seguro)." );

  const nowIso = new Date().toISOString();
  const lockBeforeIso = new Date(Date.now() - LOCK_MINUTES * 60 * 1000).toISOString();

  const { data: rows, error: selErr } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("kind", JOB_KIND)
    .eq("status", "running")
    .is("result_asset_id", null)
    .or(`next_check_at.is.null,next_check_at.lte.${nowIso}`)
    .or(`locked_at.is.null,locked_at.lte.${lockBeforeIso}`)
    .order("created_at", { ascending: true })
    .limit(CLAIM_LIMIT);

  if (selErr) throw selErr;
  const picked = Array.isArray(rows) ? rows : [];

  const locked = [];
  for (const row of picked) {
    const { data: upd, error: lockErr } = await supabaseAdmin
      .from("jobs")
      .update({ locked_at: new Date().toISOString(), locked_by: WORKER_ID })
      .eq("id", row.id)
      .or(`locked_at.is.null,locked_at.lte.${lockBeforeIso}`)
      .select("*")
      .maybeSingle();

    if (!lockErr && upd) locked.push(upd);
  }
  return locked;
}

async function updateJob(jobId, patch) {
  const { error } = await supabaseAdmin.from("jobs").update(patch).eq("id", jobId);
  if (error) throw error;
}

function normalizeError(err) {
  const e = err || {};
  const status = e.status || e.statusCode || null;
  const code = e.code || null;
  const message = e.message ? String(e.message) : String(err);
  const details = e.details || null;
  return { status, code, message, details };
}

async function jobSetProgress(jobRow, providerStatus, providerStatusDetail) {
  try {
    const nextParams = { ...(jobRow.params || {}), providerStatus, providerStatusDetail };
    await updateJob(jobRow.id, { params: nextParams, updated_at: new Date().toISOString() });
    jobRow.params = nextParams;
  } catch {
    // best-effort
  }
}

async function jobSucceed(jobRow, result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const first = items[0] || null;
  const resultAssetIds = items.map((x) => x.assetId).filter(Boolean);
  const resultUrls = items.map((x) => x.url).filter(Boolean);

  const nextParams = {
    ...(jobRow.params || {}),
    providerStatus: "COMPLETED",
    providerStatusDetail: null,
    resultUrl: first?.url || null,
    resultUrls,
    resultAssetIds,
    urlExpiresInSeconds: result?.urlExpiresInSeconds || 3600,
  };

  await updateJob(jobRow.id, {
    status: "succeeded",
    error: null,
    result_asset_id: first?.assetId || null,
    params: nextParams,
    finished_at: new Date().toISOString(),
    next_check_at: null,
    locked_at: null,
    locked_by: null,
  });
}

async function jobFail(jobRow, err) {
  const norm = normalizeError(err);
  const nextParams = {
    ...(jobRow.params || {}),
    providerStatus: "FAILED",
    providerStatusDetail: norm.message,
    errorCode: norm.code || null,
    errorStatus: norm.status || null,
    errorDetails: norm.details || null,
  };

  await updateJob(jobRow.id, {
    status: "failed",
    error: norm.message,
    params: nextParams,
    finished_at: new Date().toISOString(),
    next_check_at: null,
    locked_at: null,
    locked_by: null,
  });
}

// =============================
// Image pipeline (copied/adapted from routes)
// =============================

async function runImageGenerateTask({ userId, params }) {
  const parsed = ImageRequestSchema.parse(params);
  const {
    prompt,
    model,
    aspectRatio,
    count,
    quality,
    tool,
    nameHint,
    characterAssetIds,
    styleAssetId,
    stylePresetId,
    stylePresetName,
    styleReferenceDataUrl,
    backgroundAssetId,
    promptReferences,
    klingElementIds,
    horizontalAngle,
    verticalAngle,
    zoom,
    loraScale,
  } = parsed;

  const selectedModel = String(model || "");
    const hasStylePresetReference =
    typeof styleReferenceDataUrl === "string" &&
    styleReferenceDataUrl.startsWith("data:image/");

  const buildStoredStyleMeta = () => ({
    styleAssetId: styleAssetId || null,
    stylePresetId: stylePresetId || null,
    stylePresetName: stylePresetName || null,
  });

  const appendStyleReferenceInstruction = (text, currentRefCount) => {
    if (!hasStylePresetReference) return String(text || "").trim();

    const styleIndex = Number(currentRefCount || 0) + 1;
    const instruction =
      `Use image ${styleIndex} only as style guidance for overall look, materials, rendering, lighting and finish. ` +
      `Do not reproduce any grid, collage, contact sheet or multi-panel layout from that style reference unless the user's prompt explicitly asks for it.`;

    return `${String(text || "").trim()}\n\n${instruction}`.trim();
  };

  const styleReferenceInlinePart = async () => {
    const { mimeType, base64 } = parseDataUrl(styleReferenceDataUrl);
    return { inlineData: { mimeType, data: base64 } };
  };

  const styleReferenceImageFile = async () => {
    const { mimeType, base64 } = parseDataUrl(styleReferenceDataUrl);
    const bytes = Buffer.from(base64, "base64");
    const ext = extFromMime(mimeType || "image/jpeg");
    return new File([bytes], `style-preset-reference.${ext}`, {
      type: mimeType || "image/jpeg",
    });
  };

  const styleReferenceSignedUrl = async () => {
    const { storagePath } = await uploadBase64ToStorage({
      userId,
      tool: "preset-style-ref",
      dataUrl: styleReferenceDataUrl,
      nameHint: `style_preset_${safeSlug(stylePresetId || stylePresetName || "reference")}`,
    });

    return signStoragePath(storagePath, 60 * 10);
  };

  const modelVisualRefLimit = (() => {
    if (selectedModel.startsWith("openai:")) return 4;
    if (selectedModel.startsWith("fal-ai/flux-2-")) return 1;
    if (selectedModel.startsWith("kling:")) return 4;
    if (selectedModel.startsWith("fal-ai/kling-image/")) return 10;
    if (selectedModel === "fal-ai/qwen-image-edit-2511-multiple-angles") return 1;
    return null;
  })();
  const maxCount = maxCountForImageModel(selectedModel);

  // ---- Token -> refs (robusto) ----
  const tokenRefsRaw = Array.isArray(promptReferences) ? promptReferences : [];
  const tokenRefs = tokenRefsRaw
    .map((r) => ({
      token: String(r?.token || "").trim(),
      id: String(r?.assetId || "").trim(),
      role: String(r?.role || "").trim() || "element",
    }))
    .filter((r) => r.token && r.id);

  const hasTokenRefs = tokenRefs.length > 0;

  const replaceMentionsWithImageNumbers = (text, refs) => {
    let out = String(text || "");
    for (let i = 0; i < refs.length; i++) {
      const tok = refs[i].token;
      if (!tok) continue;
      const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      out = out.replace(re, `@Image${i + 1}`);
    }
    return out;
  };

  const replaceMentionsWithFalImageTags = (text, refs) => {
    let out = String(text || "");
    for (let i = 0; i < refs.length; i++) {
      const tok = refs[i].token;
      if (!tok) continue;
      const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      out = out.replace(re, `@Image${i + 1}`);
    }
    return out;
  };

  const klingPlaceholderFor = (i) => `<<<IMAGE_${i + 1}>>>`;
  const replaceMentionsWithKlingPlaceholders = (text, refs) => {
    let out = String(text || "");
    for (let i = 0; i < refs.length; i++) {
      const tok = refs[i].token;
      if (!tok) continue;
      const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      out = out.replace(re, klingPlaceholderFor(i));
    }
    return out;
  };

  const appendImageNumberMapping = (text, refs) => {
    if (!refs.length) return text;
    const lines = refs.map((r, i) => `@Image${i + 1} = ${r.token}`);
    const mapping = `\n\nReference mapping:\n${lines.join("\n")}`;
    return `${String(text || "").trim()}${mapping}`.trim();
  };

  // Fallback refs order si no hay tokens
  const fallbackRefs = [
    ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
    ...(backgroundAssetId ? [backgroundAssetId] : []),
    ...(styleAssetId ? [styleAssetId] : []),
  ].filter(Boolean);

  const refAssetIds = hasTokenRefs ? tokenRefs.map((r) => r.id) : fallbackRefs;
  const totalVisualRefs = refAssetIds.length + (hasStylePresetReference ? 1 : 0);

  if (modelVisualRefLimit != null && totalVisualRefs > modelVisualRefLimit) {
    throw httpError(
      400,
      "TOO_MANY_REFS",
      `El modelo "${selectedModel}" soporta hasta ${modelVisualRefLimit} referencia(s) visual(es) en este flujo. ` +
        `Ahora intentaste usar ${totalVisualRefs} contando el grid de estilo.`
    );
  }

  // =============================
  // OpenAI (GPT Image)
  // =============================
  if (selectedModel.startsWith("openai:")) {
    const { model: oModel, quality: oQuality } = parseOpenAIImageModel(selectedModel);
    const size = openaiSizeFromAspectRatio(aspectRatio);
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const openaiRefs = refAssetIds.length
      ? await Promise.all(refAssetIds.slice(0, 4).map((id) => assetIdToImageFile(id, userId)))
      : [];

    if (hasStylePresetReference) {
      openaiRefs.push(await styleReferenceImageFile());
    }

    const promptAdaptedBase = hasTokenRefs
      ? appendImageNumberMapping(
          replaceMentionsWithImageNumbers(prompt, tokenRefs.slice(0, Math.min(refAssetIds.length, 4))),
          tokenRefs.slice(0, Math.min(refAssetIds.length, 4))
        )
      : prompt;

    const promptAdapted = appendStyleReferenceInstruction(
      promptAdaptedBase,
      Math.min(refAssetIds.length, 4)
    );

    const dataUrl = await openaiGenerateImageDataUrl({
      model: oModel,
      prompt: promptAdapted,
      size,
      quality: oQuality,
      images: openaiRefs,
    });

    const { storagePath } = await uploadBase64ToStorage({
      userId,
      tool: toolName,
      dataUrl,
      nameHint: hint,
    });

    const meta = {
      tool: toolName,
      provider: "openai",
      model: selectedModel,
      aspectRatio: aspectRatio || "auto",
      quality: oQuality,
      count: 1,
      characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
      ...buildStoredStyleMeta(),
      backgroundAssetId: backgroundAssetId || null,
      promptReferences: tokenRefs,
    };

    const assetId = await insertAssetRow({
      ownerId: userId,
      type: "image",
      tool: toolName,
      name: hint,
      prompt,
      storagePath,
      isPublic: false,
      meta,
    });

    const url = await signStoragePath(storagePath, urlExpiresInSeconds);
    return { items: [{ url, assetId }], urlExpiresInSeconds };
  }

  // =============================
  // BFL (Black Forest Labs)
  // =============================
  if (selectedModel.startsWith("fal-ai/flux-2-")) {
    const nRequested = Math.max(1, Math.min(Number(count || 1), maxCount));
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const modelSlug = String(selectedModel || "").replace(/^fal-ai\//, "");
    const { width, height } = falDimsFromAspectQuality(
      aspectRatio || "auto",
      String(quality || "1K").toUpperCase()
    );

    const refUrls = refAssetIds.length
      ? await Promise.all(refAssetIds.slice(0, 4).map((id) => assetIdToSignedUrl(id, userId, 60 * 10)))
      : [];

    const promptAdaptedBase = hasTokenRefs
      ? appendImageNumberMapping(
          replaceMentionsWithFalImageTags(prompt, tokenRefs.slice(0, refUrls.length)),
          tokenRefs.slice(0, refUrls.length)
        )
      : prompt;

    const promptAdapted = appendStyleReferenceInstruction(promptAdaptedBase, refUrls.length);

    const bflPrimaryRefUrl =
      refUrls[0] || (hasStylePresetReference ? await styleReferenceSignedUrl() : null);

    const payload = {
      prompt: String(promptAdapted || "").slice(0, 3500),
      width,
      height,
      num_images: nRequested,
      ...(bflPrimaryRefUrl ? { image_prompt: bflPrimaryRefUrl } : {}),
    };

    const submit = await bflSubmit(modelSlug, payload);
    const done = await bflPoll(submit.polling_url, { timeoutMs: 180000 });

    const sampleUrls = Array.isArray(done?.result?.sample)
      ? done.result.sample
      : done?.result?.sample
        ? [done.result.sample]
        : [];
    if (!sampleUrls.length) throw httpError(502, "BFL_NO_SAMPLE", "BFL no devolvió samples.", done);

    const items = [];
    for (const sampleUrl of sampleUrls.slice(0, nRequested)) {
      const dataUrl = await bflSampleToDataUrl(sampleUrl);
      const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });

      const meta = {
        tool: toolName,
        provider: "bfl",
        model: selectedModel,
        aspectRatio: aspectRatio || "auto",
        quality: String(quality || "1K").toUpperCase(),
        count: nRequested,
        characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
        ...buildStoredStyleMeta(),
        backgroundAssetId: backgroundAssetId || null,
        promptReferences: tokenRefs,
      };

      const assetId = await insertAssetRow({
        ownerId: userId,
        type: "image",
        tool: toolName,
        name: hint,
        prompt,
        storagePath,
        isPublic: false,
        meta,
      });
      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    return { items, urlExpiresInSeconds };
  }

  // =============================
  // KLING (direct API) — kling-image-o1 via kling:
  // =============================
  if (selectedModel.startsWith("kling:")) {
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const accessKey = process.env.KLING_ACCESS_KEY;
    const secretKey = process.env.KLING_SECRET_KEY;
    if (!accessKey || !secretKey) {
      throw httpError(503, "KLING_NOT_CONFIGURED", "Faltan KLING_ACCESS_KEY / KLING_SECRET_KEY en el worker.");
    }

    const allowedAR = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"]);
    const rawAR = (aspectRatio || "auto").trim();
    const mappedAR = rawAR === "4:5" ? "3:4" : rawAR;
    const klingAspectRatio = allowedAR.has(mappedAR) ? mappedAR : "auto";

    const q = String(quality || "1K").toUpperCase().trim();
    const klingResolution = q === "4K" ? "2k" : q === "2K" ? "2k" : "1k";

    const refIds = refAssetIds.filter(Boolean).slice(0, 4);
    const refUrls = refIds.length
      ? await Promise.all(refIds.map((id) => assetIdToSignedUrl(id, userId, 60 * 10)))
      : [];

    if (hasStylePresetReference && refUrls.length < 4) {
      refUrls.push(await styleReferenceSignedUrl());
    }

    const tokenRefs10 = hasTokenRefs ? tokenRefs.slice(0, Math.min(refUrls.length, 10)) : [];

    let element_list = [];
    let klingElementRecipe = null;
    if (Array.isArray(klingElementIds) && klingElementIds.length) {
      const { data: rows, error } = await supabaseAdmin
        .from("kling_elements")
        .select("id, kling_element_id, preview_path")
        .eq("owner_id", userId)
        .in("id", klingElementIds.slice(0, 4));

      if (error) throw error;
      const safeRows = Array.isArray(rows) ? rows : [];

      const previewUrls = [];
      const elementIds = [];
      for (const r of safeRows) {
        if (r?.kling_element_id) elementIds.push(String(r.kling_element_id));
        if (r?.preview_path) previewUrls.push(await signStoragePath(r.preview_path, 60 * 10));
      }

      element_list = elementIds.map((id) => ({ element_id: id }));
      if (element_list.length) {
        klingElementRecipe = {
          elementIds,
          previewUrls,
          tokens: elementIds.map((_, i) => `<<<element_${i + 1}>>>`),
        };
      }
    }

    let image_list = [];
    if (refUrls.length) {
      image_list = refUrls.map((u) => ({ url: u }));
    }

    let promptForKling = String(prompt || "");
    if (hasTokenRefs && tokenRefs10.length) {
      promptForKling = replaceMentionsWithKlingPlaceholders(promptForKling, tokenRefs10);
      const used = new Set();
      const re = /<<<\s*IMAGE_(\d+)\s*>>>/gi;
      for (const m of promptForKling.matchAll(re)) used.add(Number(m[1]));
      const missing = [];
      for (let i = 1; i <= tokenRefs10.length; i++) {
        if (!used.has(i)) missing.push(i);
      }
      if (missing.length) {
        const placeholders = missing.map((i) => `<<<IMAGE_${i}>>>`).join(" ");
        promptForKling = `${promptForKling}\n\n${placeholders}`.trim();
      }
    }

    const directKlingNonStyleRefCount = hasStylePresetReference
      ? Math.max(0, refUrls.length - 1)
      : refUrls.length;

    promptForKling = appendStyleReferenceInstruction(
      promptForKling,
      directKlingNonStyleRefCount
    );

    if (element_list.length) {
      const used = new Set();
      const reRich = /<<<\s*element_(\d+)\s*>>>/gi;
      for (const m of promptForKling.matchAll(reRich)) used.add(Number(m[1]));
      const reAt = /@element_(\d+)/gi;
      for (const m of promptForKling.matchAll(reAt)) used.add(Number(m[1]));
      const missingNums = [];
      for (let i = 1; i <= element_list.length; i++) {
        if (!used.has(i)) missingNums.push(i);
      }
      if (missingNums.length) {
        const placeholders = missingNums.map((i) => `<<<element_${i}>>>`).join(" ");
        promptForKling = `${promptForKling}\n\n${placeholders}`.trim();
      }
    }

    let baseUrl = (process.env.KLING_BASE_URL || "https://api.klingai.com").replace(/\/+$/g, "");
    if (!/\/v1$/.test(baseUrl)) baseUrl = `${baseUrl}/v1`;

    const createPayload = {
      model_name: "kling-image-o1",
      prompt: promptForKling,
      n: 1,
      aspect_ratio: klingAspectRatio,
      resolution: klingResolution,
    };
    if (image_list.length) createPayload.image_list = image_list;
    if (element_list.length) createPayload.element_list = element_list;

    const createResp = await fetch(`${baseUrl}/images/omni-image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeKlingJwt(accessKey, secretKey, 300)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createPayload),
    });

    const createText = await createResp.text();
    let createJson;
    try {
      createJson = JSON.parse(createText);
    } catch {
      createJson = null;
    }

    if (!createResp.ok || (createJson && typeof createJson.code === "number" && createJson.code !== 0)) {
      throw httpError(502, "KLING_SUBMIT_FAILED", `Kling: error al crear tarea (${createResp.status}).`, {
        response: createJson || createText,
      });
    }

    const taskId = createJson?.data?.task_id || createJson?.task_id || createJson?.data?.id || createJson?.id;
    if (!taskId) throw httpError(502, "KLING_BAD_RESPONSE", "Kling no devolvió task_id.", { response: createJson || createText });

    let finalJson = null;
    const maxPolls = 90;
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      await sleep(2000);
      const pollResp = await fetch(`${baseUrl}/images/omni-image/${taskId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${makeKlingJwt(accessKey, secretKey, 300)}`,
          "Content-Type": "application/json",
        },
      });

      const pollText = await pollResp.text();
      let pollJson;
      try {
        pollJson = JSON.parse(pollText);
      } catch {
        pollJson = null;
      }

      if (!pollResp.ok || (pollJson && typeof pollJson.code === "number" && pollJson.code !== 0)) {
        throw httpError(502, "KLING_POLL_FAILED", `Kling: error al consultar tarea (${pollResp.status}).`, {
          response: pollJson || pollText,
        });
      }

      const status = pollJson?.data?.task_status || pollJson?.task_status;
      if (status === "succeed") {
        finalJson = pollJson;
        break;
      }
      if (status === "failed") {
        throw httpError(502, "KLING_TASK_FAILED", "Kling: la tarea falló.", { response: pollJson });
      }
    }

    if (!finalJson) throw httpError(504, "KLING_TIMEOUT", "Kling: timeout esperando el resultado.", { taskId });

    const imagesArr = finalJson?.data?.task_result?.images || [];
    const urls = imagesArr.map((x) => x?.url).filter(Boolean).slice(0, 1);
    if (!urls.length) throw httpError(502, "KLING_NO_IMAGES", "Kling: tarea completada pero sin URLs de imagen.", { response: finalJson });

    const items = [];
    for (const imageUrl of urls) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        throw httpError(502, "KLING_IMAGE_DOWNLOAD_FAILED", `Kling: no pude descargar la imagen final (${imgRes.status}).`, {
          imageUrl,
        });
      }

      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get("content-type") || "image/png";
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

      const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
      const meta = {
        tool: toolName,
        provider: "kling",
        model: selectedModel,
        klingModelName: "kling-image-o1",
        klingTaskId: taskId,
        aspectRatio: klingAspectRatio,
        quality: klingResolution,
        count: 1,
        characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
        ...buildStoredStyleMeta(),
        backgroundAssetId: backgroundAssetId || null,
        klingElementIds: Array.isArray(klingElementIds) ? klingElementIds : [],
        klingElementRecipe,
      };

      const assetId = await insertAssetRow({
        ownerId: userId,
        type: "image",
        tool: toolName,
        name: hint,
        prompt,
        storagePath,
        isPublic: false,
        meta,
      });

      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    return { items, urlExpiresInSeconds };
  }

  // =============================
  // Fal.ai - Kling Image v3/o3
  // =============================
  if (selectedModel.startsWith("fal-ai/kling-image/")) {
    const nRequested = Math.max(1, Math.min(Number(count || 1), 9, maxCount));
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const refIds = refAssetIds.filter(Boolean).slice(0, 10);
    const refUrls = refIds.length
      ? await Promise.all(refIds.map((id) => assetIdToSignedUrl(id, userId, 60 * 10)))
      : [];

    const allowedAR = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"]);
    const rawAR = (aspectRatio || "auto").trim();
    const mappedAR = rawAR === "4:5" ? "3:4" : rawAR;
    const falAspectRatio = allowedAR.has(mappedAR) ? mappedAR : "auto";

    const falResolution = String(quality || "1K").toUpperCase().trim();
    const isO3 = selectedModel.includes("/o3/");
    const isV3 = selectedModel.includes("/v3/");
    const resolutionForModel = isV3 && falResolution === "4K" ? "2K" : falResolution;

    function ensureO3Prompt(p, nImages) {
      const base = String(p || "").trim();
      if (!base) return base;
      if (/@Image\d+/i.test(base)) return base;
      const tags = Array.from({ length: nImages }, (_, i) => `@Image${i + 1}`).join(", ");
      return `${base}\n\nUse the reference images ${tags} as visual guidance.`;
    }

    let falInput = {};

    if (isO3 && selectedModel.endsWith("/image-to-image")) {
      if (!refUrls.length) {
        throw httpError(400, "FAL_KLING_MISSING_REFERENCE", "Kling O3 (Fal) necesita al menos 1 imagen de referencia.");
      }

      const tokenRefs10 = hasTokenRefs ? tokenRefs.slice(0, Math.min(refUrls.length, 10)) : [];
      const basePrompt = hasTokenRefs && tokenRefs10.length ? replaceMentionsWithFalImageTags(prompt, tokenRefs10) : prompt;
      const nonStyleRefCount = hasStylePresetReference
        ? Math.max(0, refUrls.length - 1)
        : refUrls.length;

      const safePrompt = appendStyleReferenceInstruction(
        ensureO3Prompt(basePrompt, refUrls.length),
        nonStyleRefCount
      );

      falInput = {
        prompt: safePrompt,
        image_urls: refUrls,
        resolution: resolutionForModel === "4K" || resolutionForModel === "2K" ? resolutionForModel : "1K",
        num_images: nRequested,
        aspect_ratio: falAspectRatio,
        output_format: "png",
        result_type: "single",
      };
    } else if (isV3 && selectedModel.endsWith("/text-to-image")) {
      falInput = {
        prompt: String(prompt || "").trim(),
        resolution: resolutionForModel === "2K" ? "2K" : "1K",
        num_images: nRequested,
        ...(falAspectRatio !== "auto" ? { aspect_ratio: falAspectRatio } : {}),
        output_format: "png",
      };
    } else if (isV3 && selectedModel.endsWith("/image-to-image")) {
      if (!refUrls[0]) {
        throw httpError(400, "FAL_KLING_MISSING_REFERENCE", "Kling V3 image-to-image (Fal) necesita 1 imagen de referencia.");
      }
      falInput = {
        prompt: String(prompt || "").trim(),
        image_url: refUrls[0],
        resolution: resolutionForModel === "2K" ? "2K" : "1K",
        num_images: nRequested,
        ...(falAspectRatio !== "auto" ? { aspect_ratio: falAspectRatio } : {}),
        output_format: "png",
      };
    } else {
      throw httpError(400, "FAL_KLING_UNSUPPORTED", "Modelo Kling (Fal) no soportado.", { model: selectedModel });
    }

    const endpointId = selectedModel;
    const falJson = await falQueueRun(endpointId, falInput);

    const images = Array.isArray(falJson?.images) ? falJson.images : [];
    if (!images.length) throw httpError(502, "FAL_NO_IMAGES", "Fal no devolvió imágenes.", falJson);

    const items = [];
    for (const img of images.slice(0, nRequested)) {
      const dataUrl = await falResultImageToDataUrl(img);
      const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
      const meta = {
        tool: toolName,
        provider: "fal",
        model: selectedModel,
        count: nRequested,
        aspectRatio: aspectRatio || "auto",
        quality: falResolution,
        characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
        ...buildStoredStyleMeta(),
        backgroundAssetId: backgroundAssetId || null,
        promptReferences: tokenRefs,
      };
      const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    return { items, urlExpiresInSeconds };
  }

  // =============================
  // Fal.ai - Qwen Multiple Angles (camera control)
  // =============================
  if (selectedModel === "fal-ai/qwen-image-edit-2511-multiple-angles") {
    const nRequested = Math.max(1, Math.min(Number(count || 1), 4, maxCount));
    const toolName = tool || "camera-angles";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const refIds = refAssetIds.filter(Boolean).slice(0, 1);
    const refUrls = refIds.length
      ? await Promise.all(refIds.map((id) => assetIdToSignedUrl(id, userId, 60 * 10)))
      : [];

    if (!refUrls[0]) {
      throw httpError(400, "QWEN_NEEDS_REFERENCE", "Qwen Multiple Angles necesita 1 imagen de referencia.");
    }

    const falInput = {
      image_urls: [refUrls[0]],
      horizontal_angle: Number.isFinite(horizontalAngle) ? horizontalAngle : 0,
      vertical_angle: Number.isFinite(verticalAngle) ? verticalAngle : 0,
      zoom: Number.isFinite(zoom) ? zoom : 5,
      lora_scale: Number.isFinite(loraScale) ? loraScale : 1,
      additional_prompt: String(prompt || "").trim() || undefined,
      output_format: "png",
      num_images: nRequested,
    };

    const falJson = await falQueueRun(selectedModel, falInput);
    const imagesArr = Array.isArray(falJson?.images) ? falJson.images : [];
    const urls = imagesArr.map((x) => x?.url).filter(Boolean).slice(0, nRequested);

    if (!urls.length) {
      throw httpError(502, "QWEN_NO_IMAGES", "Qwen (Fal) no devolvió URLs de imagen.", falJson);
    }

    const items = [];
    for (const imageUrl of urls) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        throw httpError(502, "QWEN_IMAGE_DOWNLOAD_FAILED", `Qwen (Fal): no pude descargar la imagen final (${imgRes.status}).`, { imageUrl });
      }

      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get("content-type") || "image/png";
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

      const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });

      const meta = {
        tool: toolName,
        provider: "fal",
        model: selectedModel,
        count: nRequested,
        prompt,
        camera: { horizontalAngle, verticalAngle, zoom, loraScale },
        characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
        ...buildStoredStyleMeta(),
        backgroundAssetId: backgroundAssetId || null,
        promptReferences: tokenRefs,
      };

      const assetId = await insertAssetRow({
        ownerId: userId,
        type: "image",
        tool: toolName,
        name: hint,
        prompt,
        storagePath,
        isPublic: false,
        meta,
      });

      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    return { items, urlExpiresInSeconds };
  }


  // =============================
  // Fal.ai - Flux 2.0 (default)
  // =============================
  if (selectedModel.startsWith("fal-ai/flux-")) {
    const nRequested = Math.max(1, Math.min(Number(count || 1), maxCount));
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const refIds = refAssetIds.filter(Boolean).slice(0, 4);
    const refUrls = refIds.length
      ? await Promise.all(refIds.map((id) => assetIdToSignedUrl(id, userId, 60 * 10)))
      : [];

    const tokenRefs10 = hasTokenRefs ? tokenRefs.slice(0, Math.min(refUrls.length, 10)) : [];
    const promptAdapted = hasTokenRefs && tokenRefs10.length
      ? appendImageNumberMapping(replaceMentionsWithFalImageTags(prompt, tokenRefs10), tokenRefs10)
      : prompt;

    const { width, height } = falDimsFromAspectQuality(
      aspectRatio || "auto",
      String(quality || "1K").toUpperCase()
    );

    const falInput = {
      prompt: String(promptAdapted || "").trim(),
      image_size: { width, height },
      num_images: nRequested,
      output_format: "png",
      sync_mode: true,
      ...(refUrls.length ? { image_urls: refUrls } : {}),
    };

    const falJson = await falQueueRun(selectedModel, falInput);
    const images = Array.isArray(falJson?.images) ? falJson.images : [];
    if (!images.length) throw httpError(502, "FAL_NO_IMAGES", "Fal no devolvió imágenes.", falJson);

    const items = [];
    for (const img of images.slice(0, nRequested)) {
      const dataUrl = await falResultImageToDataUrl(img);
      const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
      const meta = {
        tool: toolName,
        provider: "fal",
        model: selectedModel,
        count: nRequested,
        aspectRatio: aspectRatio || "auto",
        quality: String(quality || "1K").toUpperCase(),
        characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
        ...buildStoredStyleMeta(),
        backgroundAssetId: backgroundAssetId || null,
        promptReferences: tokenRefs,
      };
      const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    return { items, urlExpiresInSeconds };
  }

  // =============================
  // Gemini Imagen (generateImages)
  // =============================
  // ⚠️ IMPORTANTE:
  // - Imagen models (ej: "imagen-*") usan generateImages() (internamente es :predict).
  // - Nano Banana / Nano Banana Pro (gemini-2.5-flash-image, gemini-3-pro-image-preview)
  //   usan generateContent() (NO :predict). Si entran aquí, Google responde 404 "not supported for predict".
  if (typeof selectedModel === "string" && selectedModel.includes("imagen")) {
    const ai = await ensureAI();

    const nRequested = Math.max(1, Math.min(Number(count || 1), maxCount));
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const safePrompt = String(prompt || "").trim();
    if (!safePrompt) apiError(400, "MISSING_PROMPT", "Falta prompt.");

    const gen = await ai.models.generateImages({
      model: selectedModel,
      prompt: safePrompt,
      config: {
        numberOfImages: nRequested,
        outputMimeType: "image/png",
        ...(aspectRatio ? { aspectRatio } : {}),
      },
    });

    const images = Array.isArray(gen?.generatedImages) ? gen.generatedImages : [];
    if (!images.length) throw httpError(502, "GEMINI_NO_IMAGES", "Gemini no devolvió imágenes.", gen);

    const items = [];
    for (const img of images.slice(0, nRequested)) {
      const b64 = img?.image?.imageBytes;
      if (!b64) continue;
      const dataUrl = `data:image/png;base64,${b64}`;
      const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
      const meta = {
        tool: toolName,
        provider: "google",
        model: selectedModel,
        count: nRequested,
        aspectRatio: aspectRatio || "auto",
        quality: String(quality || "1K").toUpperCase(),
        characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
        ...buildStoredStyleMeta(),
        backgroundAssetId: backgroundAssetId || null,
        promptReferences: tokenRefs,
      };
      const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    if (!items.length) throw httpError(502, "GEMINI_NO_IMAGES", "Gemini no devolvió imágenes utilizables.");
    return { items, urlExpiresInSeconds };
  }

  // =============================
  // Gemini (NanoBanana Pro/Flash image preview)
  // =============================
  {
    const ai = await ensureAI();
    const nRequested = Math.max(1, Math.min(Number(count || 1), maxCount));
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const urlExpiresInSeconds = 60 * 60;

    const refParts = refAssetIds.length
      ? await Promise.all(refAssetIds.slice(0, 4).map((id) => assetIdToInlinePart(id, userId)))
      : [];

    if (hasStylePresetReference) {
      refParts.push(await styleReferenceInlinePart());
    }

    const tokenRefs4 = hasTokenRefs ? tokenRefs.slice(0, Math.min(refAssetIds.length, 4)) : [];
    const promptBase = hasTokenRefs && tokenRefs4.length
      ? appendImageNumberMapping(replaceMentionsWithImageNumbers(prompt, tokenRefs4), tokenRefs4)
      : prompt;

    const promptAdapted = appendStyleReferenceInstruction(
      promptBase,
      Math.min(refAssetIds.length, 4)
    );

    // Pedimos explícitamente salida de IMAGEN + aplicamos aspectRatio/quality cuando aplique.
    // (Mantener alineado con /api/ai/image sync)
    const genConfig = {
      responseModalities: ["Image"],
      imageConfig: {},
    };

    // Aspect ratio (ignoramos "auto")
    if (aspectRatio && aspectRatio !== "auto") {
      genConfig.imageConfig.aspectRatio = aspectRatio;
    }

    // imageSize SOLO en NanoBanana Pro
    if (selectedModel === "gemini-3-pro-image-preview" && quality) {
      genConfig.imageConfig.imageSize = String(quality).toUpperCase(); // "1K" | "2K" | "4K"
    }

    const items = [];
    for (let i = 0; i < nRequested; i++) {
      const resp = await ai.models.generateContent({
        model: selectedModel,
        contents: [{ role: "user", parts: [...refParts, { text: String(promptAdapted || "") }] }],
        config: genConfig,
      });

      const dataUrl = await extractImageDataUrl(resp);
      const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
      const meta = {
        tool: toolName,
        provider: "google",
        model: selectedModel,
        count: nRequested,
        aspectRatio: aspectRatio || "auto",
        quality: String(quality || "1K").toUpperCase(),
        characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
        ...buildStoredStyleMeta(),
        backgroundAssetId: backgroundAssetId || null,
        promptReferences: tokenRefs,
      };
      const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
    }

    return { items, urlExpiresInSeconds };
  }
}

async function runRestyleTask({ userId, params }) {
  const parsed = RestyleSchema.parse(params);
  const { sourceAssetId, prompt, model } = parsed;

  const ai = await ensureAI();
  const toolName = "restyle";
  const hint = "restyle";
  const urlExpiresInSeconds = 60 * 60;

  const srcPart = await assetIdToInlinePart(sourceAssetId, userId);

  const resp = await ai.models.generateContent({
    model: model || "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: String(prompt || "") }, srcPart] }],
  });

  const dataUrl = await extractImageDataUrl(resp);
  const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
  const meta = { tool: toolName, provider: "google", model: model || "gemini-2.5-flash-image", sourceAssetId };
  const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
  const url = await signStoragePath(storagePath, urlExpiresInSeconds);
  return { items: [{ url, assetId }], urlExpiresInSeconds };
}

async function runUpscaleTask({ userId, params }) {
  const parsed = UpscaleSchema.parse(params);
  const { imageAssetId, scale, model } = parsed;
  const ai = await ensureAI();
  const toolName = "upscale";
  const hint = "upscale";
  const urlExpiresInSeconds = 60 * 60;

  const srcRow = await getAssetRowOrThrow(imageAssetId);
  assertAssetReadable(srcRow, userId);
  if (!srcRow.storage_path) throw httpError(500, "ASSET_NO_STORAGE_PATH", "Asset sin storage_path.", { imageAssetId });
  const { buffer, mimeType } = await downloadStoragePath(srcRow.storage_path);

  const dims = tryGetImageDimsFromBuffer(buffer, mimeType) || { width: null, height: null };
  const s = Number(scale || 2);

  const targetW = dims.width ? Math.min(4096, Math.round(dims.width * s)) : 2048;
  const targetH = dims.height ? Math.min(4096, Math.round(dims.height * s)) : 2048;

  const srcPart = {
    inlineData: { mimeType: mimeType || "image/png", data: buffer.toString("base64") },
  };

  const prompt = `Upscale this image. Keep the content exactly the same. Output a sharper, higher resolution image. Target size: ${targetW}x${targetH}.`;

  const resp = await ai.models.generateContent({
    model: model || "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }, srcPart] }],
  });

  const dataUrl = await extractImageDataUrl(resp);
  const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
  const meta = { tool: toolName, provider: "google", model: model || "gemini-2.5-flash-image", imageAssetId, scale: s };
  const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
  const url = await signStoragePath(storagePath, urlExpiresInSeconds);
  return { items: [{ url, assetId }], urlExpiresInSeconds };
}

async function runFaceswapMannequinTask({ userId, params }) {
  const parsed = FaceSwapMannequinSchema.parse(params);
  const { targetAssetId, swapType, quality } = parsed;
  const ai = await ensureAI();
  const toolName = "faceswap";
  const hint = "faceswap-mannequin";
  const urlExpiresInSeconds = 60 * 60;

  const part = await assetIdToInlinePart(targetAssetId, userId);
  const prompt = `${mannequinSwapPrompt(swapType)} ${faceswapQualityHint(quality)}`.trim();
  const resp = await ai.models.generateContent({
    model: FACESWAP_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }, part] }],
  });

  const dataUrl = await extractImageDataUrl(resp);
  const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
  const meta = { tool: toolName, step: 1, provider: "google", model: FACESWAP_MODEL, targetAssetId, swapType, quality };
  const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
  const url = await signStoragePath(storagePath, urlExpiresInSeconds);
  return { items: [{ url, assetId }], urlExpiresInSeconds };
}

async function runFaceswapInsertTask({ userId, params }) {
  const parsed = FaceSwapInsertSchema.parse(params);
  const { baseAssetId, donorElementId } = parsed;
  let { swapType, quality } = parsed;

  const ai = await ensureAI();
  const toolName = "faceswap";
  const hint = "faceswap";
  const urlExpiresInSeconds = 60 * 60;

  const baseRow = await getAssetRowOrThrow(baseAssetId);
  assertAssetReadable(baseRow, userId);
  // 🔒 Paso 2 hereda SIEMPRE swapType + quality del Paso 1 (guardado en meta del asset base)
  const baseMeta = baseRow?.meta || {};
  const lockedSwapType = baseMeta?.swapType || swapType;
  const lockedQuality = baseMeta?.quality || quality;

  swapType = lockedSwapType;
  quality = lockedQuality;

  const basePart = await assetIdToInlinePart(baseAssetId, userId);

  const { data: elRow, error } = await supabaseAdmin
    .from("kling_elements")
    .select("id, owner_id, image_paths")
    .eq("id", donorElementId)
    .maybeSingle();
  if (error) throw error;
  if (!elRow) throw httpError(404, "ELEMENT_NOT_FOUND", "Elemento no encontrado.", { donorElementId });
  if (elRow.owner_id !== userId) throw httpError(403, "ELEMENT_FORBIDDEN", "No tienes permisos para ese elemento.");

  const imagePaths = Array.isArray(elRow.image_paths) ? elRow.image_paths : [];
  const donorParts = [];
  for (const p of imagePaths.slice(0, 4)) {
    if (!p) continue;
    const { buffer, mimeType } = await downloadStoragePath(p);
    donorParts.push({ inlineData: { mimeType: mimeType || "image/png", data: buffer.toString("base64") } });
  }
  if (!donorParts.length) throw httpError(400, "DONOR_EMPTY", "El elemento donor no tiene imágenes.");

  const prompt = `${insertSwapPrompt(swapType)} ${faceswapQualityHint(quality)}`.trim();
  const resp = await ai.models.generateContent({
    model: FACESWAP_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }, basePart, ...donorParts] }],
  });

  const dataUrl = await extractImageDataUrl(resp);
  const { storagePath } = await uploadBase64ToStorage({ userId, tool: toolName, dataUrl, nameHint: hint });
  const meta = { tool: toolName, step: 2, provider: "google", model: FACESWAP_MODEL, baseAssetId, donorElementId, swapType, quality };
  const assetId = await insertAssetRow({ ownerId: userId, type: "image", tool: toolName, name: hint, prompt, storagePath, isPublic: false, meta });
  const url = await signStoragePath(storagePath, urlExpiresInSeconds);
  return { items: [{ url, assetId }], urlExpiresInSeconds };
}

// =============================
// Job processor
// =============================
async function processJob(row) {
  const jobId = row.id;
  const params = row.params || {};

  const task = String(params.task || "").trim();
  if (!task) {
    await jobFail(row, httpError(400, "JOB_MISSING_TASK", "Job inválido: falta params.task"));
    return;
  }

  await jobSetProgress(row, "RUNNING", `Iniciando ${task}`);

  try {
    let result;
    if (task === "image_generate") {
      await jobSetProgress(row, "RUNNING", "Generando imagen...");
      result = await runImageGenerateTask({ userId: row.owner_id, params });
    } else if (task === "restyle") {
      await jobSetProgress(row, "RUNNING", "Restyle...");
      result = await runRestyleTask({ userId: row.owner_id, params });
    } else if (task === "upscale") {
      await jobSetProgress(row, "RUNNING", "Upscale...");
      result = await runUpscaleTask({ userId: row.owner_id, params });
    } else if (task === "faceswap_mannequin") {
      await jobSetProgress(row, "RUNNING", "Faceswap paso 1...");
      result = await runFaceswapMannequinTask({ userId: row.owner_id, params });
    } else if (task === "faceswap_insert") {
      await jobSetProgress(row, "RUNNING", "Faceswap paso 2...");
      result = await runFaceswapInsertTask({ userId: row.owner_id, params });
    } else {
      throw httpError(400, "JOB_UNKNOWN_TASK", `Task no soportada: ${task}`);
    }

    await jobSucceed(row, result);
    console.log(`[imageJobsWorker] ✅ Job ${jobId} succeeded (${task})`);
  } catch (err) {
    await jobFail(row, err);
    const norm = normalizeError(err);
    console.error(`[imageJobsWorker] ❌ Job ${jobId} failed (${task}):`, norm.message);
  }
}

let lastHeartbeatAt = 0;

async function heartbeatMaybe() {
  const now = Date.now();
  if (now - lastHeartbeatAt < 30_000) return;
  lastHeartbeatAt = now;

  if (!supabaseAdmin) return;

  try {
    await supabaseAdmin
      .from("worker_heartbeats")
      .upsert(
        { worker_id: WORKER_ID, kind: JOB_KIND, updated_at: new Date().toISOString() },
        { onConflict: "worker_id" }
      );
  } catch (e) {
    console.warn("[imageJobsWorker][heartbeat_failed]", String(e?.message || e));
  }
}

// =============================
// Main loop
// =============================
async function main() {
  console.log(`[imageJobsWorker] start WORKER_ID=${WORKER_ID} JOB_KIND=${JOB_KIND} CLAIM_LIMIT=${CLAIM_LIMIT}`);

  await supabaseAdmin.from("jobs").select("id").limit(1);

while (true) {
  try {
    await heartbeatMaybe();

    const rows = await claimJobsRpc();

      if (!rows.length) {
        await sleep(IDLE_SLEEP_MS);
        continue;
      }

      for (const row of rows) {
        await processJob(row);
      }
    } catch (e) {
      const norm = normalizeError(e);
      console.error("[imageJobsWorker] loop error:", norm.message);
      await sleep(2000);
    }
  }
}

main().catch((e) => {
  const norm = normalizeError(e);
  console.error("[imageJobsWorker] fatal:", norm.message);
  process.exit(1);
});
