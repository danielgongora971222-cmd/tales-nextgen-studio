/**
 * jobsWorker.js
 *
 * Background worker para procesar filas en public.jobs (Supabase) con provider = "fal", "google", "kling" o "piapi".
 *
 * Se ejecuta en Render como "Background Worker".
 *
 * Variables requeridas:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_BUCKET
 * - FAL_KEY (solo para jobs Fal)
 * - GEMINI_API_KEY (solo para jobs Google/Veo)
 *
 * Opcionales:
 * - WORKER_ID (si no, se genera)
 * - JOB_KIND (default: "video")
 * - CLAIM_LIMIT (default: 5)
 * - LOOP_MS (default: 2000)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { Readable } from "node:stream";
import { createStorageHelpers } from "../lib/storage.js";
import { klingGetWithRetry } from "../klingVideo.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;

// Providers (se validan por-job en processJob)
const FAL_KEY = process.env.FAL_KEY;
const PIAPI_API_KEY = process.env.PIAPI_API_KEY || process.env.PIAPI_KEY;
const PIAPI_BASE_URL = String(process.env.PIAPI_BASE_URL || "https://api.piapi.ai/api/v1").replace(/\/+$|\/$/g, "");
const GOOGLE_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GOOGLE_API_BASE_URL = String(process.env.GOOGLE_API_BASE_URL || process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/g, "");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}
if (!SUPABASE_BUCKET) {
  throw new Error("Falta SUPABASE_BUCKET");
}

function piapiHeaders() {
  if (!PIAPI_API_KEY) {
    throw new Error("PIAPI_NOT_CONFIGURED: falta PIAPI_API_KEY en el worker.");
  }
  return {
    "X-API-Key": PIAPI_API_KEY,
    "Content-Type": "application/json",
  };
}

function falHeaders() {
  if (!FAL_KEY) {
    throw new Error("FAL_NOT_CONFIGURED: falta FAL_KEY en el worker.");
  }
  return {
    Authorization: `Key ${FAL_KEY}`,
    "Content-Type": "application/json",
  };
}


function googleHeaders({ json = true } = {}) {
  if (!GOOGLE_API_KEY) {
    throw new Error("GOOGLE_AI_NOT_CONFIGURED: falta GEMINI_API_KEY en el worker.");
  }
  return {
    "x-goog-api-key": GOOGLE_API_KEY,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function normalizeGoogleOperationName(value) {
  return String(value || "").trim().replace(/^\/+/, "");
}

function extractGoogleProviderStatus(operationJson) {
  if (!operationJson) return "UNKNOWN";
  if (operationJson.done === true) return operationJson.error ? "FAILED" : "COMPLETED";
  const metadataState = String(
    operationJson?.metadata?.state ||
    operationJson?.metadata?.status ||
    operationJson?.metadata?.["@type"] ||
    "RUNNING"
  ).trim();
  return metadataState || "RUNNING";
}

function computeNextCheckMsGoogle(operationJson) {
  const providerStatus = String(extractGoogleProviderStatus(operationJson) || "").toUpperCase();
  if (providerStatus.includes("QUEUE") || providerStatus.includes("PENDING")) return 20_000;
  if (providerStatus.includes("RUN") || providerStatus.includes("PROGRESS")) return 12_000;
  return 15_000;
}

function extractGoogleOperationErrorMessage(payload, fallback = "Google Veo request failed.") {
  return String(
    payload?.error?.message ||
    payload?.error?.status ||
    payload?.message ||
    payload?.details?.message ||
    fallback
  ).trim();
}

function pickGoogleVideoUrl(operationJson) {
  return (
    operationJson?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
    operationJson?.response?.generatedVideos?.[0]?.video?.uri ||
    operationJson?.response?.generatedVideos?.[0]?.video?.url ||
    operationJson?.response?.videos?.[0]?.uri ||
    operationJson?.response?.videos?.[0]?.url ||
    null
  );
}

async function googleGetOperation(operationName) {
  const normalized = normalizeGoogleOperationName(operationName);
  const r = await fetch(`${GOOGLE_API_BASE_URL}/${normalized}`, {
    method: "GET",
    headers: googleHeaders({ json: false }),
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!r.ok) {
    const msg = extractGoogleOperationErrorMessage(data, `Google operation error (${r.status})`);
    const err = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

const WORKER_ID = process.env.WORKER_ID || `wrk_${crypto.randomUUID()}`;
const JOB_KIND = process.env.JOB_KIND || "video";
const CLAIM_LIMIT = Math.max(1, Math.min(25, Number(process.env.CLAIM_LIMIT || 5)));
const LOOP_MS = Math.max(500, Number(process.env.LOOP_MS || 2000));

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { uploadBufferToStorage, uploadStreamToStorage, signStoragePath, insertAssetRow } =
  createStorageHelpers({ supabase: supabaseAdmin, bucket: SUPABASE_BUCKET });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}


async function falQueueStatus(statusUrl) {
  const r = await fetch(statusUrl, { method: "GET", headers: falHeaders() });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!r.ok) {
    const msg = data?.message || data?.error?.message || `Fal status error (${r.status})`;
    const err = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function falQueueResult(responseUrl) {
  const r = await fetch(responseUrl, { method: "GET", headers: falHeaders() });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!r.ok) {
    const msg = data?.message || data?.error?.message || `Fal result error (${r.status})`;
    const err = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

function getPiapiErrorMessage(payload, fallback = "PiAPI request failed.") {
  return String(
    payload?.error?.message ||
    payload?.error?.raw_message ||
    payload?.data?.error?.message ||
    payload?.data?.error?.raw_message ||
    payload?.message ||
    payload?.detail ||
    payload?.data?.detail ||
    payload?.raw ||
    fallback
  ).trim();
}

function isPiapiAccountOwnershipMismatch(value) {
  const msg = String(value || "").trim().toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("does not belong to the current account") ||
    (msg.includes("task") && msg.includes("current account") && msg.includes("belong")) ||
    (msg.includes("task") && msg.includes("another account"))
  );
}

function isPiapiPayloadSuccess(payload) {
  const code = Number(payload?.code);
  if (!Number.isFinite(code)) return true;
  return code === 0 || code === 200;
}

async function piapiGetTask(taskId) {
  const r = await fetch(`${PIAPI_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: piapiHeaders(),
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!r.ok || !isPiapiPayloadSuccess(data)) {
    const payloadCode = Number(data?.code);
    const msg = getPiapiErrorMessage(data, `PiAPI get task error (${r.status})`);
    const err = new Error(msg);
    err.status = !r.ok
      ? r.status
      : Number.isFinite(payloadCode) && payloadCode >= 400 && payloadCode < 600
        ? payloadCode
        : 502;
    err.data = data;
    err.piapiCode = Number.isFinite(payloadCode) ? payloadCode : null;
    throw err;
  }
  return data;
}

function normalizePiapiTaskStatus(raw) {
  return String(raw || "").trim().toLowerCase();
}

function extractPiapiTaskStatus(taskData, rawJson) {
  const candidates = [
    taskData?.status,
    taskData?.task_status,
    rawJson?.status,
    rawJson?.task_status,
    taskData?.output?.status,
    rawJson?.output?.status,
    taskData?.meta?.status,
    rawJson?.meta?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function isPiapiSuccessStatus(status) {
  const s = normalizePiapiTaskStatus(status);
  return s === "completed" || s === "succeeded" || s === "success" || s === "done" || s === "finished";
}

function isPiapiFailureStatus(status) {
  const s = normalizePiapiTaskStatus(status);
  return s === "failed" || s === "fail" || s === "error" || s === "canceled" || s === "cancelled" || s === "timeout" || s === "rejected" || s === "expired";
}

function computeNextCheckMsPiapi(status) {
  const s = normalizePiapiTaskStatus(status);
  if (!s) return 30_000;
  if (s.includes("pending") || s.includes("queue") || s.includes("wait") || s.includes("submit")) return 45_000;
  if (s.includes("process") || s.includes("run") || s.includes("progress")) return 20_000;
  return 30_000;
}

function extractPiapiTaskData(rawJson) {
  if (rawJson?.data && typeof rawJson.data === "object") return rawJson.data;
  if (rawJson?.task && typeof rawJson.task === "object") return rawJson.task;
  return rawJson || null;
}

function extractPiapiTaskErrorMessage(taskData, rawJson, fallback = "PiAPI task failed.") {
  return String(
    taskData?.error?.message ||
    taskData?.error?.raw_message ||
    rawJson?.error?.message ||
    rawJson?.error?.raw_message ||
    taskData?.detail ||
    rawJson?.detail ||
    rawJson?.message ||
    fallback
  ).trim();
}

function pickPiapiVideoUrl(rawJson) {
  const taskData = extractPiapiTaskData(rawJson);
  const output = taskData?.output || rawJson?.output || {};
  return (
    output?.video?.url ||
    output?.video ||
    output?.video_url ||
    output?.videoUrl ||
    output?.videos?.[0]?.url ||
    output?.videos?.[0] ||
    null
  );
}

async function downloadToStream(url, { headers = undefined } = {}) {
  const r = await fetch(url, { method: "GET", ...(headers ? { headers } : {}) });
  if (!r.ok) throw new Error(`No se pudo descargar el archivo (${r.status})`);

  const ct = r.headers.get("content-type") || "video/mp4";
  const lenRaw = r.headers.get("content-length");
  const sizeBytes = lenRaw ? Number(lenRaw) : null;

  if (r.body) {
    return { stream: Readable.fromWeb(r.body), contentType: ct, sizeBytes };
  }

  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  return { stream: Readable.from(buf), contentType: ct, sizeBytes: buf.length };
}

function pickVideoUrl(resultJson) {
  const v1 = resultJson?.video?.url;
  if (typeof v1 === "string" && v1) return v1;

  const v2 = resultJson?.videos?.[0]?.url;
  if (typeof v2 === "string" && v2) return v2;

  const v3 = resultJson?.output?.[0]?.url;
  if (typeof v3 === "string" && v3) return v3;

  return null;
}

function computeNextCheckMs(providerStatus) {
  const s = String(providerStatus || "").toUpperCase();
  if (s.includes("IN_QUEUE")) return 25_000;
  if (s.includes("IN_PROGRESS")) return 15_000;
  return 20_000;
}

function normalizeKlingTaskStatus(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.toLowerCase();
}

function isKlingSuccessStatus(status) {
  const s = normalizeKlingTaskStatus(status);
  return (
    s === "succeed" ||
    s === "succeeded" ||
    s === "success" ||
    s === "completed" ||
    s === "done" ||
    s === "finished"
  );
}

function isKlingFailureStatus(status) {
  const s = normalizeKlingTaskStatus(status);
  return (
    s === "failed" ||
    s === "fail" ||
    s === "error" ||
    s === "canceled" ||
    s === "cancelled" ||
    s === "timeout"
  );
}

function computeNextCheckMsKling(taskStatus) {
  const s = normalizeKlingTaskStatus(taskStatus);
  if (s.includes("submitted")) return 10_000;
  if (s.includes("processing")) return 7_000;
  if (s.includes("running")) return 7_000;
  if (s.includes("queued")) return 12_000;
  return 12_000;
}

function extractKlingTaskStatus(taskData, rawJson) {
  const candidates = [
    taskData?.task_status,
    taskData?.taskStatus,
    taskData?.status,
    rawJson?.data?.task_status,
    rawJson?.task_status,
    rawJson?.data?.taskStatus,
    rawJson?.data?.status,
    rawJson?.data?.data?.task_status,
    rawJson?.data?.data?.status,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function extractKlingTaskStatusMsg(taskData, rawJson) {
  return (
    taskData?.task_status_msg ||
    rawJson?.data?.task_status_msg ||
    rawJson?.task_status_msg ||
    rawJson?.data?.data?.task_status_msg ||
    null
  );
}

function pickKlingVideoUrlFromTaskData(taskData, rawJson) {
  const taskResult =
    taskData?.task_result ||
    taskData?.data?.task_result ||
    rawJson?.data?.task_result ||
    rawJson?.data?.data?.task_result ||
    rawJson?.data?.data?.data?.task_result ||
    {};

  const firstVideo =
    Array.isArray(taskResult?.videos) && taskResult.videos.length ? taskResult.videos[0] : null;

  return (
    firstVideo?.url_with_audio ||
    firstVideo?.urlWithAudio ||
    firstVideo?.url_audio ||
    firstVideo?.urlAudio ||
    firstVideo?.url ||
    taskResult?.video_url ||
    taskResult?.videoUrl ||
    taskResult?.video?.url ||
    null
  );
}

async function releaseAndReschedule(jobId, patch) {
  const update = { ...patch, locked_at: null, locked_by: null };
  const { error } = await supabaseAdmin.from("jobs").update(update).eq("id", jobId);
  if (error) console.error("[jobsWorker][update_failed]", { jobId, error });
}

async function claimJobsRpc() {
  const { data, error } = await supabaseAdmin.rpc("claim_jobs", {
    p_kind: JOB_KIND,
    p_limit: CLAIM_LIMIT,
    p_worker_id: WORKER_ID,
    p_lock_minutes: 15,
  });

  if (!error) return Array.isArray(data) ? data : [];

  const msg = String(error?.message || "");
  if (!msg.toLowerCase().includes("could not find the function")) throw error;

  console.warn("[jobsWorker] claim_jobs() no existe en DB. Usando fallback SELECT (menos seguro).");

  const nowIso = new Date().toISOString();
  const lockBeforeIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

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

async function processJob(row) {
  const jobId = row.id;
  const ownerId = row.owner_id;
  const params = row.params || {};
  const provider = String(params.provider || "");

  // ===============================
  // ✅ Provider: Kling (Tasks)
  // ===============================
  if (provider === "kling") {
    const taskId = String(params.taskId || params.klingTaskId || "").trim();
    const taskType = String(params.taskType || params.klingTaskType || "text2video").trim();
    const modelName = params.model ? String(params.model) : null;
    const createdAtMs = row.created_at ? Date.parse(row.created_at) : null;
    const maxJobAgeMs = 25 * 60 * 1000; // 25 min hard cap

    if (createdAtMs && Date.now() - createdAtMs > maxJobAgeMs) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Kling job timeout: excedió el tiempo máximo de espera (25 min).",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "TIMEOUT" },
      });
      return;
    }


    const safeTaskType = String(taskType || "").trim();
    const pollCount = Math.max(0, Number(params.providerPollCount || 0)) + 1;

    if (
      !(
        safeTaskType === "text2video" ||
        safeTaskType === "image2video" ||
        safeTaskType === "omni-video" ||
        safeTaskType === "motion-control"
      )
    ) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: `Job Kling inválido: taskType no soportado (${safeTaskType}).`,
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "INVALID_TASK_TYPE", providerPollCount: pollCount },
      });
      return;
    }
    if (pollCount > 200) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Kling job aborted: demasiados polls (200).",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "TOO_MANY_POLLS", providerPollCount: pollCount },
      });
      return;
    }

if (!taskId) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Job Kling inválido: falta taskId en params.",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "MISSING_TASK_ID", providerPollCount: pollCount },
      });
      return;
    }

    let taskData;
    let rawJson = null;

    try {
      const endpoints =
        safeTaskType === "motion-control"
          ? [
              `/videos/motion-control/${taskId}`,
              `/videos/motion_create/${taskId}`,
              `/videos/motion-create/${taskId}`,
              `/videos/motioncontrol/${taskId}`,
            ]
          : [`/videos/${safeTaskType}/${taskId}`];

      let lastErr = null;
      for (const endpoint of endpoints) {
        try {
          rawJson = await klingGetWithRetry(endpoint, { timeoutMs: 20_000, retries: 3 });
          break;
        } catch (e) {
          lastErr = e;
          const status = e?.status || e?.response?.status || null;
          if (status && Number(status) !== 404) throw e;
        }
      }

      if (!rawJson) throw lastErr || new Error("No pude obtener status del task Kling.");

      taskData = rawJson?.data || rawJson;
    } catch (e) {
      const next = new Date(Date.now() + 20_000).toISOString();
      await releaseAndReschedule(jobId, {
        status: "running",
        next_check_at: next,
        params: {
          ...params,
          providerStatus: "STATUS_ERROR",
          providerStatusDetail: String(e?.message || e),
          providerPollCount: pollCount,
        },
      });
      return;
    }

const taskStatusRaw = extractKlingTaskStatus(taskData, rawJson);
    const taskStatus = normalizeKlingTaskStatus(taskStatusRaw);
    const taskStatusMsg = extractKlingTaskStatusMsg(taskData, rawJson);

    if (isKlingFailureStatus(taskStatus)) {
      const errMsg = taskStatusMsg || "Kling task failed.";
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: String(errMsg),
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: {
          ...params,
          providerStatus: taskStatusRaw || taskStatus || "FAILED",
          providerStatusNormalized: taskStatus || null,
          providerPollCount: pollCount,
          providerStatusMsg: taskStatusMsg,
        },
      });
      return;
    }

    if (!isKlingSuccessStatus(taskStatus)) {
      const nextMs = computeNextCheckMsKling(taskStatus);
      const next = new Date(Date.now() + nextMs).toISOString();
      await releaseAndReschedule(jobId, {
        status: "running",
        next_check_at: next,
        params: {
          ...params,
          providerStatus: taskStatusRaw || taskStatus || "PENDING",
          providerStatusNormalized: taskStatus || null,
          providerPollCount: pollCount,
          providerStatusMsg: taskStatusMsg,
        },
      });
      return;
    }

    const videoUrl = pickKlingVideoUrlFromTaskData(taskData, rawJson);
    if (!videoUrl) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Kling succeed pero no encontré URL de video en task_result.videos[0].",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: {
          ...params,
          providerStatus: taskStatus || "PENDING",
          providerPollCount: pollCount,
          providerStatusMsg: taskData?.task_status_msg || null,
        },
      });
      return;
    }

    const { stream, contentType, sizeBytes } = await downloadToStream(videoUrl);

    const maxBytes = Number(process.env.KLING_V3_MAX_VIDEO_BYTES || 250 * 1024 * 1024);
    if (sizeBytes != null && sizeBytes > maxBytes) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: `Kling video demasiado grande (${sizeBytes} bytes).`,
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "VIDEO_TOO_LARGE", providerPollCount: pollCount },
      });
      return;
    }

    const ct = String(contentType || "").toLowerCase();
    if (!(ct.startsWith("video/") || ct === "application/octet-stream")) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: `Kling devolvió content-type inesperado (${contentType}).`,
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "BAD_CONTENT_TYPE", providerPollCount: pollCount },
      });
      return;
    }

    const toolName = params.toolName || "video";
    const nameHint = params.hint || "video";
    const prompt = params.prompt || null;

    let storagePath;

    if (typeof uploadStreamToStorage === "function") {
      const up = await uploadStreamToStorage({
        userId: ownerId,
        tool: toolName,
        stream,
        mimeType: contentType,
        nameHint,
        sizeBytes,
      });
      storagePath = up.storagePath;
    } else {
      const ab = await (await fetch(videoUrl, { method: "GET" })).arrayBuffer();
      const buf = Buffer.from(ab);
      const up = await uploadBufferToStorage({
        userId: ownerId,
        tool: toolName,
        buffer: buf,
        mimeType: contentType,
        nameHint,
      });
      storagePath = up.storagePath;
    }

    const meta = {
      ...(params.meta || {}),
      ...(params.motionControl ? { motionControl: params.motionControl } : {}),

      // ✅ CRÍTICO para que aparezca en MotionControlTool / MyCreations
      tool: toolName,
      category: toolName,

      provider: "kling",
      model: params.model || null,
      klingTaskId: taskId,
      klingTaskType: taskType,
      providerStatus: "SUCCEED",
      providerVideoUrl: videoUrl,
    };
    const assetId = await insertAssetRow({
      ownerId,
      type: "video",
      tool: toolName,
      name: nameHint,
      prompt,
      storagePath,
      isPublic: false,
      meta,
    });

    let signedUrl = null;
    try {
      signedUrl = await signStoragePath(storagePath, 60 * 30);
    } catch {
      signedUrl = null;
    }

    await releaseAndReschedule(jobId, {
      status: "succeeded",
      result_asset_id: assetId,
      finished_at: new Date().toISOString(),
      error: null,
      next_check_at: null,
      params: {
        ...params,
        providerStatus: taskStatus || "PENDING",
        providerPollCount: pollCount,
        providerStatusMsg: taskData?.task_status_msg || null,
      },
    });

    return;
  }

  // ===============================
  // Provider: PiAPI (Seedance)
  // ===============================
  if (provider === "piapi") {
    const taskId = String(params.taskId || params.piapiTaskId || "").trim();
    const taskType = String(params.taskType || params.piapiTaskType || "seedance-2-preview").trim();
    const modelName = params.model ? String(params.model) : null;
    const pollCount = Math.max(0, Number(params.providerPollCount || 0)) + 1;
    const createdAtMs = row.created_at ? Date.parse(row.created_at) : null;
    const maxJobAgeMs = Math.max(30 * 60 * 1000, Number(process.env.PIAPI_MAX_JOB_AGE_MS || 8 * 60 * 60 * 1000));
    const maxPolls = Math.max(60, Number(process.env.PIAPI_MAX_POLLS || 720));

    if (!taskId) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Job PiAPI inválido: falta taskId en params.",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "MISSING_TASK_ID", providerPollCount: pollCount },
      });
      return;
    }

    if (createdAtMs && Date.now() - createdAtMs > maxJobAgeMs) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: `PiAPI job timeout: excedió el tiempo máximo de espera (${Math.round(maxJobAgeMs / 60000)} min).`,
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "TIMEOUT", providerPollCount: pollCount },
      });
      return;
    }

    if (pollCount > maxPolls) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: `PiAPI job aborted: demasiados polls (${maxPolls}).`,
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "TOO_MANY_POLLS", providerPollCount: pollCount },
      });
      return;
    }

    let rawJson = null;
    let taskData = null;
    try {
      rawJson = await piapiGetTask(taskId);
      taskData = extractPiapiTaskData(rawJson);
    } catch (e) {
      const status = Number(e?.status || 0);
      const message = String(e?.message || e);
      const webhookEnabled = params.providerWebhookEnabled === true || params.providerWebhookEnabled === "true" || params.providerWebhookEnabled === 1 || params.providerWebhookEnabled === "1";
      const webhookSeenAtMs = params.providerWebhookSeenAt ? Date.parse(params.providerWebhookSeenAt) : null;
      const createdAgeMs = createdAtMs ? Math.max(0, Date.now() - createdAtMs) : 0;
      const accountMismatch = isPiapiAccountOwnershipMismatch(message);
      const shouldFail = [400, 401, 403, 404].includes(status) || /not found|invalid|forbidden|unauthor/i.test(message);

      if (accountMismatch) {
        const graceMs = webhookEnabled ? Math.max(10 * 60 * 1000, Number(process.env.PIAPI_ACCOUNT_MISMATCH_GRACE_MS || 90 * 60 * 1000)) : Math.max(2 * 60 * 1000, Number(process.env.PIAPI_ACCOUNT_MISMATCH_GRACE_MS_NO_WEBHOOK || 10 * 60 * 1000));
        const shouldGiveUp = Boolean(webhookSeenAtMs) || createdAgeMs > graceMs;

        if (shouldGiveUp) {
          await releaseAndReschedule(jobId, {
            status: "failed",
            error: webhookEnabled
              ? "PiAPI rechazó la consulta del task porque pertenece a otra cuenta. El task se creó con una API key/cuenta distinta a la que usa el worker en Render. Revisa y unifica PIAPI_API_KEY en el servicio web y en el worker."
              : "PiAPI rechazó la consulta del task porque pertenece a otra cuenta. El task se creó con una API key/cuenta distinta a la que usa el worker en Render.",
            finished_at: new Date().toISOString(),
            next_check_at: null,
            params: {
              ...params,
              providerStatus: "ACCOUNT_MISMATCH",
              providerStatusDetail: message,
              providerPollCount: pollCount,
            },
          });
          return;
        }

        const next = new Date(Date.now() + 45_000).toISOString();
        await releaseAndReschedule(jobId, {
          status: "running",
          next_check_at: next,
          params: {
            ...params,
            providerStatus: "ACCOUNT_MISMATCH",
            providerStatusDetail: message,
            providerPollCount: pollCount,
          },
        });
        return;
      }

      if (shouldFail) {
        await releaseAndReschedule(jobId, {
          status: "failed",
          error: message || "PiAPI status fetch failed.",
          finished_at: new Date().toISOString(),
          next_check_at: null,
          params: {
            ...params,
            providerStatus: "STATUS_ERROR",
            providerStatusDetail: message,
            providerPollCount: pollCount,
          },
        });
        return;
      }

      const next = new Date(Date.now() + 30_000).toISOString();
      await releaseAndReschedule(jobId, {
        status: "running",
        next_check_at: next,
        params: {
          ...params,
          providerStatus: "STATUS_ERROR",
          providerStatusDetail: message,
          providerPollCount: pollCount,
        },
      });
      return;
    }

    const taskStatusRaw = extractPiapiTaskStatus(taskData, rawJson);
    const taskStatus = normalizePiapiTaskStatus(taskStatusRaw);
    const taskErrorMessage = extractPiapiTaskErrorMessage(taskData, rawJson, "PiAPI task failed.");

    if (isPiapiFailureStatus(taskStatus)) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: String(taskErrorMessage),
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: {
          ...params,
          providerStatus: taskStatusRaw || taskStatus || "FAILED",
          providerStatusNormalized: taskStatus || null,
          providerPollCount: pollCount,
          providerStatusMsg: taskErrorMessage || null,
        },
      });
      return;
    }

    if (!isPiapiSuccessStatus(taskStatus)) {
      const next = new Date(Date.now() + computeNextCheckMsPiapi(taskStatus)).toISOString();
      await releaseAndReschedule(jobId, {
        status: "running",
        next_check_at: next,
        params: {
          ...params,
          providerStatus: taskStatusRaw || taskStatus || "PENDING",
          providerStatusNormalized: taskStatus || null,
          providerPollCount: pollCount,
          providerStatusMsg: taskErrorMessage || null,
        },
      });
      return;
    }

    const videoUrl = pickPiapiVideoUrl(rawJson);
    if (!videoUrl) {
      const missingOutputRetries = Math.max(0, Number(params.providerMissingOutputRetries || 0));
      if (missingOutputRetries < 3) {
        await releaseAndReschedule(jobId, {
          status: "running",
          next_check_at: new Date(Date.now() + 15_000).toISOString(),
          params: {
            ...params,
            providerStatus: taskStatusRaw || "COMPLETED",
            providerPollCount: pollCount,
            providerMissingOutputRetries: missingOutputRetries + 1,
          },
        });
        return;
      }

      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "PiAPI completó la tarea pero no devolvió URL de video.",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: taskStatusRaw || "COMPLETED", providerPollCount: pollCount },
      });
      return;
    }

    const { stream, contentType, sizeBytes } = await downloadToStream(videoUrl);

    const toolName = params.toolName || "video";
    const nameHint = params.hint || "video";
    const prompt = params.prompt || null;

    let storagePath;

    if (typeof uploadStreamToStorage === "function") {
      const up = await uploadStreamToStorage({
        userId: ownerId,
        tool: toolName,
        stream,
        mimeType: contentType,
        nameHint,
        sizeBytes,
      });
      storagePath = up.storagePath;
    } else {
      const ab = await (await fetch(videoUrl, { method: "GET" })).arrayBuffer();
      const buf = Buffer.from(ab);
      const up = await uploadBufferToStorage({
        userId: ownerId,
        tool: toolName,
        buffer: buf,
        mimeType: contentType,
        nameHint,
      });
      storagePath = up.storagePath;
    }

    const meta = {
      ...(params.meta || {}),
      tool: toolName,
      category: toolName,
      provider: "piapi",
      model: modelName || null,
      piapiTaskId: taskId,
      piapiTaskType: taskType,
      providerStatus: taskStatusRaw || "completed",
      providerVideoUrl: videoUrl,
    };

    const assetId = await insertAssetRow({
      ownerId,
      type: "video",
      tool: toolName,
      name: nameHint,
      prompt,
      storagePath,
      isPublic: false,
      meta,
    });

    let signedUrl = null;
    try {
      signedUrl = await signStoragePath(storagePath, 60 * 30);
    } catch {
      signedUrl = null;
    }

    await releaseAndReschedule(jobId, {
      status: "succeeded",
      result_asset_id: assetId,
      finished_at: new Date().toISOString(),
      error: null,
      next_check_at: null,
      params: {
        ...params,
        providerStatus: taskStatusRaw || "completed",
        providerPollCount: pollCount,
        resultUrl: signedUrl,
      },
    });

    return;
  }

  // ===============================
  // Provider: Google (Veo directo)
  // ===============================
  if (provider === "google") {
    const operationName = normalizeGoogleOperationName(params.operationName || params.googleOperationName || "");
    const modelName = params.model ? String(params.model) : null;
    const pollCount = Math.max(0, Number(params.providerPollCount || 0)) + 1;

    if (!operationName) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Job Google/Veo inválido: falta operationName en params.",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "MISSING_OPERATION_NAME", providerPollCount: pollCount },
      });
      return;
    }

    if (pollCount > 240) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Google/Veo job aborted: demasiados polls (240).",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: { ...params, providerStatus: "TOO_MANY_POLLS", providerPollCount: pollCount },
      });
      return;
    }

    let operationJson = null;
    try {
      operationJson = await googleGetOperation(operationName);
    } catch (e) {
      const status = Number(e?.status || 0);
      const message = String(e?.message || e || "Google Veo status error");
      const retriable = !status || status === 408 || status === 425 || status === 429 || status >= 500;

      if (!retriable || /GOOGLE_AI_NOT_CONFIGURED/i.test(message)) {
        await releaseAndReschedule(jobId, {
          status: "failed",
          error: message,
          finished_at: new Date().toISOString(),
          next_check_at: null,
          params: {
            ...params,
            providerStatus: "STATUS_ERROR",
            providerStatusDetail: message,
            providerPollCount: pollCount,
          },
        });
        return;
      }

      const next = new Date(Date.now() + 20_000).toISOString();
      await releaseAndReschedule(jobId, {
        status: "running",
        next_check_at: next,
        params: {
          ...params,
          providerStatus: "STATUS_ERROR",
          providerStatusDetail: message,
          providerPollCount: pollCount,
        },
      });
      return;
    }

    const providerStatus = extractGoogleProviderStatus(operationJson);

    if (operationJson?.done === true && operationJson?.error) {
      const errMsg = extractGoogleOperationErrorMessage(operationJson, "Google Veo reportó un error.");
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: String(errMsg),
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: {
          ...params,
          providerStatus,
          providerPollCount: pollCount,
          providerRawError: operationJson.error || null,
        },
      });
      return;
    }

    if (operationJson?.done !== true) {
      const next = new Date(Date.now() + computeNextCheckMsGoogle(operationJson)).toISOString();
      await releaseAndReschedule(jobId, {
        status: "running",
        next_check_at: next,
        params: {
          ...params,
          providerStatus,
          providerPollCount: pollCount,
        },
      });
      return;
    }

    const videoUrl = pickGoogleVideoUrl(operationJson);
    if (!videoUrl) {
      await releaseAndReschedule(jobId, {
        status: "failed",
        error: "Google/Veo completó la operación pero no devolvió URL de video.",
        finished_at: new Date().toISOString(),
        next_check_at: null,
        params: {
          ...params,
          providerStatus: providerStatus || "COMPLETED",
          providerPollCount: pollCount,
          providerRaw: operationJson,
        },
      });
      return;
    }

    const { stream, contentType, sizeBytes } = await downloadToStream(videoUrl, {
      headers: googleHeaders({ json: false }),
    });

    const toolName = params.toolName || "video";
    const nameHint = params.hint || "video";
    const prompt = params.prompt || null;

    let storagePath;

    if (typeof uploadStreamToStorage === "function") {
      const up = await uploadStreamToStorage({
        userId: ownerId,
        tool: toolName,
        stream,
        mimeType: contentType,
        nameHint,
        sizeBytes,
      });
      storagePath = up.storagePath;
    } else {
      const ab = await (await fetch(videoUrl, { method: "GET", headers: googleHeaders({ json: false }) })).arrayBuffer();
      const buf = Buffer.from(ab);
      const up = await uploadBufferToStorage({
        userId: ownerId,
        tool: toolName,
        buffer: buf,
        mimeType: contentType,
        nameHint,
      });
      storagePath = up.storagePath;
    }

    const meta = {
      ...(params.meta || {}),
      tool: toolName,
      category: toolName,
      provider: "google",
      model: modelName || null,
      googleOperationName: operationName,
      providerStatus: providerStatus || "COMPLETED",
      providerVideoUrl: videoUrl,
    };

    const assetId = await insertAssetRow({
      ownerId,
      type: "video",
      tool: toolName,
      name: nameHint,
      prompt,
      storagePath,
      isPublic: false,
      meta,
    });

    let signedUrl = null;
    try {
      signedUrl = await signStoragePath(storagePath, 60 * 30);
    } catch {
      signedUrl = null;
    }

    await releaseAndReschedule(jobId, {
      status: "succeeded",
      result_asset_id: assetId,
      finished_at: new Date().toISOString(),
      error: null,
      next_check_at: null,
      params: {
        ...params,
        providerStatus: providerStatus || "COMPLETED",
        providerPollCount: pollCount,
        resultUrl: signedUrl,
      },
    });

    return;
  }

  // ===============================
  // Provider: Fal (igual que antes)
  // ===============================
  if (provider !== "fal") {
    await releaseAndReschedule(jobId, {
      status: "failed",
      error: `Provider no soportado: ${String(provider || "(null)")}`,
      finished_at: new Date().toISOString(),
      next_check_at: null,
    });
    return;
  }

  const statusUrl = params.statusUrl;
  const responseUrl = params.responseUrl;

  if (!statusUrl || !responseUrl) {
    await releaseAndReschedule(jobId, {
      status: "failed",
      error: "Job Fal inválido: falta statusUrl/responseUrl en params.",
      finished_at: new Date().toISOString(),
      next_check_at: null,
    });
    return;
  }

  let st;
  try {
    st = await falQueueStatus(statusUrl);
  } catch (e) {
    const next = new Date(Date.now() + 30_000).toISOString();
    await releaseAndReschedule(jobId, {
      status: "running",
      next_check_at: next,
      params: { ...params, providerStatus: "STATUS_ERROR", providerStatusDetail: String(e?.message || e) },
    });
    return;
  }

  const providerStatus = String(st?.status || "").toUpperCase();

  if (providerStatus === "FAILED") {
    const errMsg = st?.error?.message || st?.error || "Fal reportó FAILED";
    await releaseAndReschedule(jobId, {
      status: "failed",
      error: String(errMsg),
      finished_at: new Date().toISOString(),
      next_check_at: null,
      params: { ...params, providerStatus },
    });
    return;
  }

  if (providerStatus !== "COMPLETED") {
    const nextMs = computeNextCheckMs(providerStatus);
    const next = new Date(Date.now() + nextMs).toISOString();
    await releaseAndReschedule(jobId, {
      status: "running",
      next_check_at: next,
      params: { ...params, providerStatus },
    });
    return;
  }

  let result;
  try {
    result = await falQueueResult(responseUrl);
  } catch (e) {
    const next = new Date(Date.now() + 30_000).toISOString();
    await releaseAndReschedule(jobId, {
      status: "running",
      next_check_at: next,
      params: { ...params, providerStatus: "RESULT_ERROR", providerStatusDetail: String(e?.message || e) },
    });
    return;
  }

  const videoUrl = pickVideoUrl(result);
  if (!videoUrl) {
    await releaseAndReschedule(jobId, {
      status: "failed",
      error: "Fal COMPLETED pero no encontré URL del video en la respuesta.",
      finished_at: new Date().toISOString(),
      next_check_at: null,
      params: { ...params, providerStatus: "COMPLETED_NO_URL", providerRaw: result },
    });
    return;
  }

  const { stream, contentType, sizeBytes } = await downloadToStream(videoUrl);

  const toolName = params.toolName || "video";
  const nameHint = params.hint || "video";
  const prompt = params.prompt || null;

  let storagePath;

  if (typeof uploadStreamToStorage === "function") {
    const up = await uploadStreamToStorage({
      userId: ownerId,
      tool: toolName,
      stream,
      mimeType: contentType,
      nameHint,
      sizeBytes,
    });
    storagePath = up.storagePath;
  } else {
    // Fallback ultra seguro (si alguien corre un build viejo del storage helper)
    const ab = await (await fetch(videoUrl, { method: "GET" })).arrayBuffer();
    const buf = Buffer.from(ab);
    const up = await uploadBufferToStorage({
      userId: ownerId,
      tool: toolName,
      buffer: buf,
      mimeType: contentType,
      nameHint,
    });
    storagePath = up.storagePath;
  }
  const meta = {
    ...(params.meta || {}),
    ...(params.motionControl ? { motionControl: params.motionControl } : {}),

    // ✅ CRÍTICO para que aparezca en herramientas y MyCreations
    tool: toolName,
    category: toolName,

    provider: "fal",
    model: params.model || null,
    falEndpointId: params.falEndpointId || params.endpointId || null,
    requestId: params.requestId || null,
    providerStatus: "COMPLETED",
    providerVideoUrl: videoUrl,
  };

  const assetId = await insertAssetRow({
    ownerId,
    type: "video",
    tool: toolName,
    name: nameHint,
    prompt,
    storagePath,
    isPublic: false,
    meta,
  });

  let signedUrl = null;
  try {
    signedUrl = await signStoragePath(storagePath, 60 * 30);
  } catch {
    signedUrl = null;
  }

  await releaseAndReschedule(jobId, {
    status: "succeeded",
    result_asset_id: assetId,
    finished_at: new Date().toISOString(),
    error: null,
    next_check_at: null,
    params: { ...params, providerStatus: "COMPLETED", resultUrl: signedUrl },
  });
}

let lastHeartbeatAt = 0;

async function heartbeatMaybe() {
  const now = Date.now();
  if (now - lastHeartbeatAt < 30_000) return; // cada 30s
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
    console.warn("[jobsWorker][heartbeat_failed]", String(e?.message || e));
  }
}

async function main() {
  console.log("[jobsWorker] start", { WORKER_ID, JOB_KIND, CLAIM_LIMIT, LOOP_MS });

  while (true) {
    try {
      await heartbeatMaybe();

      const jobs = await claimJobsRpc();
      if (!jobs.length) {
        await sleep(LOOP_MS);
        continue;
      }

      for (const row of jobs) {
        try {
          await processJob(row);
        } catch (e) {
          console.error("[jobsWorker][job_crash]", { jobId: row?.id, err: String(e?.message || e) });
          const next = new Date(Date.now() + 60_000).toISOString();
          await releaseAndReschedule(row.id, {
            status: "running",
            next_check_at: next,
            params: { ...(row.params || {}), providerStatus: "WORKER_CRASH", providerStatusDetail: String(e?.message || e) },
          });
        }
      }
    } catch (e) {
      console.error("[jobsWorker][loop_error]", e);
      await sleep(5_000);
    }
  }
}

main();