/**
 * jobsWorker.js
 *
 * Background worker para procesar filas en public.jobs (Supabase) con provider = "fal".
 *
 * Se ejecuta en Render como "Background Worker".
 *
 * Variables requeridas:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_BUCKET
 * - FAL_KEY
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;
const FAL_KEY = process.env.FAL_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}
if (!SUPABASE_BUCKET) {
  throw new Error("Falta SUPABASE_BUCKET");
}
if (!FAL_KEY) {
  throw new Error("Falta FAL_KEY");
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

function falHeaders() {
  return {
    Authorization: `Key ${FAL_KEY}`,
    "Content-Type": "application/json",
  };
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

async function downloadToStream(url) {
  const r = await fetch(url, { method: "GET" });
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

  if (params.provider !== "fal") {
    await releaseAndReschedule(jobId, {
      status: "failed",
      error: `Provider no soportado: ${String(params.provider || "(null)")}`,
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
    provider: "fal",
    model: params.model || null,
    falEndpointId: params.falEndpointId || null,
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