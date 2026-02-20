import "dotenv/config";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { createStorageHelpers } from "../lib/storage.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JOB_TOKEN_SECRET = process.env.JOB_TOKEN_SECRET;

const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || "assets";

const WORKER_POLL_MS = Number(process.env.WORKER_POLL_MS || 10_000);
const WORKER_BATCH_SIZE = Math.max(1, Math.min(200, Number(process.env.WORKER_BATCH_SIZE || 50)));

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
if (!JOB_TOKEN_SECRET) {
  throw new Error("Missing JOB_TOKEN_SECRET (must match API)");
}
if (!process.env.FAL_KEY) {
  throw new Error("Missing FAL_KEY");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const {
  safeSlug,
  buildAssetPath,
  uploadBufferToStorage,
  signStoragePath,
  insertAssetRow,
} = createStorageHelpers({ supabase: supabaseAdmin, bucket: STORAGE_BUCKET });

function base64UrlDecode(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function timingSafeEq(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyJobToken(jobToken) {
  const parts = String(jobToken || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid jobToken");
  const [b64Header, b64Payload, b64Sig] = parts;
  const header = JSON.parse(base64UrlDecode(b64Header));
  const payload = JSON.parse(base64UrlDecode(b64Payload));

  if (header?.alg !== "HS256" || header?.typ !== "FAL_JOB") {
    throw new Error("Invalid jobToken header");
  }

  const data = `${b64Header}.${b64Payload}`;
  const expected = crypto.createHmac("sha256", JOB_TOKEN_SECRET).update(data).digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (!timingSafeEq(expected, b64Sig)) throw new Error("Invalid jobToken signature");
  if (payload?.exp && Date.now() > payload.exp) throw new Error("Expired jobToken");
  return payload;
}

function falAuthHeader() {
  return { Authorization: `Key ${process.env.FAL_KEY}` };
}

async function falQueueStatus(statusUrl, { timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(statusUrl, {
      method: "GET",
      headers: { ...falAuthHeader() },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Fal status failed: ${res.status} ${await res.text()}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function falQueueResult(responseUrl, { timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(responseUrl, {
      method: "GET",
      headers: { ...falAuthHeader() },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Fal result failed: ${res.status} ${await res.text()}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function downloadToBuffer(url, { timeoutMs = 120_000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${await res.text()}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(t);
  }
}

function pickVideoUrl(resultJson) {
  const u1 = resultJson?.video?.url;
  if (u1) return String(u1);

  const u2 = resultJson?.videos?.[0]?.url;
  if (u2) return String(u2);

  const u3 = resultJson?.data?.video?.url;
  if (u3) return String(u3);

  return "";
}

async function processRunningJob(row) {
  const jobId = String(row.id);
  const ownerId = String(row.owner_id);
  const prompt = String(row.prompt || "");
  const label = String(row.label || "Video");
  const modelNorm = String(row.model_norm || "");

  if (row.status !== "running") return;
  if (!row.job_token) return;

  if (Array.isArray(row?.result?.assetIds) && row.result.assetIds.length) return;

  let payload;
  try {
    payload = verifyJobToken(row.job_token);
  } catch (e) {
    await supabaseAdmin
      .from("generation_jobs")
      .update({ status: "failed", error: String(e?.message || e), finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return;
  }

  const statusUrl = payload?.statusUrl;
  const responseUrl = payload?.responseUrl;
  const endpointId = payload?.endpointId || null;
  const requestId = payload?.requestId || null;

  if (!statusUrl || !responseUrl) {
    await supabaseAdmin
      .from("generation_jobs")
      .update({ status: "failed", error: "jobToken missing statusUrl/responseUrl", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return;
  }

  const status = await falQueueStatus(statusUrl).catch(async (e) => {
    await supabaseAdmin
      .from("generation_jobs")
      .update({ next_check_at: new Date(Date.now() + WORKER_POLL_MS).toISOString() })
      .eq("id", jobId);
    throw e;
  });

  const st = String(status?.status || "").toUpperCase();

  if (st === "FAILED") {
    await supabaseAdmin
      .from("generation_jobs")
      .update({ status: "failed", error: status?.error ? JSON.stringify(status.error) : "Fal job failed", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return;
  }

  if (st !== "COMPLETED") {
    await supabaseAdmin
      .from("generation_jobs")
      .update({ next_check_at: new Date(Date.now() + WORKER_POLL_MS).toISOString() })
      .eq("id", jobId);
    return;
  }

  const resultJson = await falQueueResult(responseUrl);
  const videoUrl = pickVideoUrl(resultJson);
  if (!videoUrl) {
    await supabaseAdmin
      .from("generation_jobs")
      .update({ status: "failed", error: "Fal result has no video url", finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return;
  }

  const buf = await downloadToBuffer(videoUrl);
  const hint = safeSlug(`${label}-${modelNorm}`) || "video";

  const uploaded = await uploadBufferToStorage({
    userId: ownerId,
    tool: "video",
    buffer: buf,
    mimeType: "video/mp4",
    nameHint: hint,
  });

  const storagePath = uploaded.storagePath;

  const meta = {
    provider: "fal",
    model: modelNorm || null,
    falEndpointId: endpointId,
    requestId,
  };

  const assetId = await insertAssetRow({
    ownerId,
    type: "video",
    tool: "video",
    name: hint,
    prompt,
    storagePath,
    isPublic: false,
    meta,
  });

  let url = null;
  try {
    url = await signStoragePath(storagePath, 60 * 10);
  } catch {
    url = null;
  }

  await supabaseAdmin
    .from("generation_jobs")
    .update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      result: { assetIds: [assetId], url },
      error: null,
      next_check_at: null,
    })
    .eq("id", jobId);
}

async function tick() {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("generation_jobs")
    .select("id, owner_id, type, status, label, model_norm, prompt, job_token, result, error, next_check_at")
    .eq("type", "video_generate")
    .eq("status", "running")
    .not("job_token", "is", null)
    .lte("next_check_at", nowIso)
    .limit(WORKER_BATCH_SIZE);

  if (error) {
    console.error("[worker] query error:", error);
    return;
  }

  for (const row of data || []) {
    try {
      await processRunningJob(row);
    } catch (e) {
      console.error("[worker] job failed:", row?.id, e);
    }
  }
}

async function main() {
  console.log("[worker] Fal finalize worker started", {
    pollMs: WORKER_POLL_MS,
    batchSize: WORKER_BATCH_SIZE,
    bucket: STORAGE_BUCKET,
  });

  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, WORKER_POLL_MS));
  }
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
