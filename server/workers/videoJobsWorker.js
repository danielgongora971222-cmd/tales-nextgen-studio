import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "crypto";
import { base64urlEncode, base64urlDecodeToString } from "../lib/base64url.js";
import { createStorageHelpers } from "../lib/storage.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;
const FAL_KEY = process.env.FAL_KEY;

const JOB_TOKEN_SECRET = process.env.JOB_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!SUPABASE_BUCKET) throw new Error("Missing SUPABASE_BUCKET");
if (!FAL_KEY) throw new Error("Missing FAL_KEY");
if (!JOB_TOKEN_SECRET) throw new Error("Missing JOB_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY)");

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WORKER_ID = `video-worker-${randomUUID().slice(0, 8)}`;

const storage = createStorageHelpers({ supabase: supabaseAdmin, bucket: SUPABASE_BUCKET });
const { uploadBufferToStorage, signStoragePath, insertAssetRow } = storage;

function falAuthHeader() {
  const key = String(FAL_KEY || "").trim();
  if (!key) return null;
  if (key.startsWith("Key ")) return key;
  return `Key ${key}`;
}

function signJobToken(payloadObj) {
  const payloadB64 = base64urlEncode(JSON.stringify(payloadObj));
  const sigB64 = createHmac("sha256", JOB_TOKEN_SECRET).update(payloadB64).digest("base64");
  const sig = sigB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${payloadB64}.${sig}`;
}

function verifyJobToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new Error("BAD_JOB_TOKEN");
  const [payloadB64, sig] = parts;

  const expectedSigB64 = createHmac("sha256", JOB_TOKEN_SECRET).update(payloadB64).digest("base64");
  const expectedSig = expectedSigB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (sig !== expectedSig) throw new Error("BAD_JOB_TOKEN_SIG");

  return JSON.parse(base64urlDecodeToString(payloadB64));
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function falFetchJson(url, opts) {
  const auth = falAuthHeader();
  const resp = await fetch(url, {
    ...opts,
    headers: {
      Authorization: auth,
      ...(opts?.headers || {}),
    },
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!resp.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${resp.status}`;
    const e = new Error(msg);
    e.status = resp.status;
    e.body = json || text;
    throw e;
  }
  return json;
}

async function falQueueSubmit(endpointId, input) {
  const submitUrl = `https://queue.fal.run/${endpointId}`;
  const json = await falFetchJson(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const requestId = json?.request_id || json?.requestId || null;
  const statusUrl = json?.status_url || json?.statusUrl || null;
  const responseUrl = json?.response_url || json?.responseUrl || null;

  if (!requestId || !statusUrl || !responseUrl) {
    throw new Error("FAL_SUBMIT_MISSING_FIELDS");
  }
  return { requestId, statusUrl, responseUrl };
}

async function falQueueStatus(statusUrl) {
  return falFetchJson(statusUrl, { method: "GET" });
}

async function falQueueResult(responseUrl) {
  return falFetchJson(responseUrl, { method: "GET" });
}

async function hasCommunityAssetEntitlement(assetId, userId) {
  if (!assetId || !userId) return false;

  const { data, error } = await supabaseAdmin
    .from("community_asset_entitlements")
    .select("asset_id")
    .eq("asset_id", assetId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("ASSET_ACCESS_CHECK_FAILED");
  return Boolean(data?.asset_id);
}

async function assetIdToSignedUrl(assetId, ownerId, ttlSeconds) {
  if (!assetId) return null;

  const { data, error } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, is_public, storage_path")
    .eq("id", assetId)
    .single();

  if (error || !data) throw new Error("ASSET_NOT_FOUND");

  const entitled = await hasCommunityAssetEntitlement(assetId, ownerId);
  if (String(data.owner_id) !== String(ownerId) && data.is_public !== true && !entitled) {
    throw new Error("ASSET_NOT_OWNED");
  }

  return signStoragePath(data.storage_path, ttlSeconds);
}

async function lockJob(id, expectedStatus) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("generation_jobs")
    .update({ locked_at: nowIso, locked_by: WORKER_ID })
    .eq("id", id)
    .eq("status", expectedStatus)
    .is("locked_at", null)
    .select("id")
    .single();

  if (error) return false;
  return Boolean(data?.id);
}

async function unlockJob(id) {
  await supabaseAdmin
    .from("generation_jobs")
    .update({ locked_at: null, locked_by: null })
    .eq("id", id);
}

function safeModelNorm(input) {
  return String(input || "").replace(/^models\//i, "");
}

async function buildKlingFalTaskFromPlan(ownerId, planBody) {
  const selectedModelNorm = safeModelNorm(planBody?.model);
  const isO3 = selectedModelNorm === "kling-o3-pro";
  if (!(selectedModelNorm === "kling-v3" || selectedModelNorm === "kling-o3-pro")) {
    throw new Error("UNSUPPORTED_MODEL_FOR_WORKER");
  }

  const INPUT_URL_TTL_SECONDS = 60 * 60 * 6;

  const prompt = String(planBody?.prompt || "");
  const toolName = String(planBody?.tool || "VideoGeneratorTool");
  const hint = String(planBody?.nameHint || "kling-video");

  const firstFrameAssetId = planBody?.firstFrameAssetId || null;
  const lastFrameAssetId = planBody?.lastFrameAssetId || null;

  const hasFirst = Boolean(firstFrameAssetId);
  const hasLast = Boolean(lastFrameAssetId);

  if (hasLast && !hasFirst) throw new Error("MISSING_FIRST_FRAME");

  const generateAudio = planBody?.klingSound !== undefined ? Boolean(planBody.klingSound) : true;

  const voiceIds = Array.isArray(planBody?.klingVoiceIds)
    ? planBody.klingVoiceIds.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 2)
    : [];

  const klingShotType = planBody?.klingShotType === "intelligent" ? "intelligent" : "customize";
  const negativePrompt = planBody?.negativePrompt ? String(planBody.negativePrompt) : null;

  let dur = planBody?.durationSeconds != null ? Number(planBody.durationSeconds) : 5;
  dur = Math.trunc(dur);
  if (dur < 3) dur = 3;
  if (dur > 15) dur = 15;

  const ar = String(planBody?.aspectRatio || "16:9");

  const KLING_V3_SHOT_PROMPT_LIMIT = 512;
  const multi = Array.isArray(planBody?.klingMultiPrompt) && planBody.klingMultiPrompt.length
    ? planBody.klingMultiPrompt.map((s, idx) => {
        const p = String(s?.prompt || "");
        if (p.length > KLING_V3_SHOT_PROMPT_LIMIT) {
          throw new Error(`KLING_V3_MULTISHOT_PROMPT_TOO_LONG:${idx + 1}`);
        }
        let sDur = s?.durationSeconds != null ? Number(s.durationSeconds) : 5;
        sDur = Math.trunc(sDur);
        if (sDur < 3) sDur = 3;
        if (sDur > 15) sDur = 15;
        return { prompt: p, duration: String(sDur) };
      })
    : null;

  let totalDur = dur;
  if (multi && multi.length) {
    totalDur = multi.reduce((acc, s) => acc + Number(s.duration || 0), 0);
    if (totalDur < 3 || totalDur > 15) throw new Error("KLING_V3_MULTISHOT_DURATION_INVALID");
  }

  const klingElementIds = Array.isArray(planBody?.klingElementIds) ? planBody.klingElementIds : [];
  const hasElements = klingElementIds.length > 0;

  let elements = undefined;
  if (hasElements) {
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("kling_elements")
      .select("id, owner_id, image_paths")
      .in("id", klingElementIds)
      .eq("owner_id", ownerId);

    if (rowsErr) throw new Error("DB_READ_ELEMENTS_FAILED");

    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const missing = (klingElementIds || []).filter((id) => !byId.has(id));
    if (missing.length) throw new Error("KLING_V3_ELEMENT_NOT_FOUND");

    const out = [];
    for (const elementId of klingElementIds) {
      const row = byId.get(elementId);
      const paths = Array.isArray(row?.image_paths) ? row.image_paths : [];
      if (!paths.length) continue;

      const urls = [];
      for (const storagePath of paths.slice(0, 4)) {
        const signed = await signStoragePath(storagePath, INPUT_URL_TTL_SECONDS);
        urls.push(signed);
      }
      if (!urls.length) continue;

      const frontal = urls[0];
      const refs = urls.slice(1, 4);
      if (!refs.length) refs.push(frontal);

      out.push({
        frontal_image_url: frontal,
        reference_image_urls: refs,
      });
    }
    if (out.length) elements = out;
  }

  let endpointId = isO3
    ? "fal-ai/kling-video/o3/pro/text-to-video"
    : "fal-ai/kling-video/v3/pro/text-to-video";

  if (hasFirst) {
    endpointId = isO3
      ? "fal-ai/kling-video/o3/pro/image-to-video"
      : "fal-ai/kling-video/v3/pro/image-to-video";
  }

  const falInput = {
    aspect_ratio: ar,
    duration: String(totalDur),
    generate_audio: generateAudio,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    ...(planBody?.klingCfgScale !== undefined ? { cfg_scale: planBody.klingCfgScale } : {}),
    ...(voiceIds.length ? { voice_ids: voiceIds } : {}),
  };

  if (multi && multi.length) {
    falInput.multi_prompt = multi;
    falInput.shot_type = isO3 ? "customize" : klingShotType;
  } else {
    falInput.prompt = prompt;
  }

  if (elements) falInput.elements = elements;

  if (hasFirst) {
    falInput[isO3 ? "image_url" : "start_image_url"] = await assetIdToSignedUrl(
      firstFrameAssetId,
      ownerId,
      INPUT_URL_TTL_SECONDS
    );

    if (hasLast && !isO3) {
      falInput.end_image_url = await assetIdToSignedUrl(
        lastFrameAssetId,
        ownerId,
        INPUT_URL_TTL_SECONDS
      );
    }

    if (multi && multi.length) falInput.shot_type = "customize";
  }

  const metaForToken = {
    endpointId,
    toolName,
    hint,
    model: selectedModelNorm,
    ar,
    totalDur,
    firstFrameAssetId,
    lastFrameAssetId,
    generateAudio,
  };

  return { endpointId, falInput, prompt, toolName, hint, metaForToken };
}

async function processQueuedJob(job) {
  const ownerId = job.owner_id;
  const payload = job.payload || {};
  const planBody = payload.planBody || {};
  const modelNorm = safeModelNorm(job.model_norm || planBody.model);

  if (!(modelNorm === "kling-v3" || modelNorm === "kling-o3-pro")) {
    await supabaseAdmin.from("generation_jobs").update({
      status: "failed",
      error: "Worker: modelo no soportado para cola.",
      progress_text: null,
      finished_at: new Date().toISOString(),
      next_check_at: null,
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return;
  }

  await supabaseAdmin.from("generation_jobs").update({
    status: "running",
    progress_text: "Enviando a Fal…",
    error: null,
    next_check_at: new Date(Date.now() + 8_000).toISOString(),
  }).eq("id", job.id);

  const task = await buildKlingFalTaskFromPlan(ownerId, planBody);

  const { requestId, statusUrl, responseUrl } = await falQueueSubmit(task.endpointId, task.falInput);

  const jobToken = signJobToken({
    uid: ownerId,
    requestId,
    statusUrl,
    responseUrl,
    ...task.metaForToken,
  });

  await supabaseAdmin.from("generation_jobs").update({
    job_token: jobToken,
    progress_text: "Generando (Fal)…",
    next_check_at: new Date(Date.now() + 10_000).toISOString(),
    locked_at: null,
    locked_by: null,
  }).eq("id", job.id);
}

async function processRunningJob(job) {
  const token = String(job.job_token || "");
  if (!token) {
    await supabaseAdmin.from("generation_jobs").update({
      status: "failed",
      error: "Worker: job_token faltante.",
      progress_text: null,
      finished_at: new Date().toISOString(),
      next_check_at: null,
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return;
  }

  const decoded = verifyJobToken(token);

  const statusJson = await falQueueStatus(decoded.statusUrl);
  const status = String(statusJson?.status || "").toUpperCase();

  if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
    await supabaseAdmin.from("generation_jobs").update({
      progress_text: status === "IN_QUEUE" ? "En cola (Fal)…" : "Procesando (Fal)…",
      next_check_at: new Date(Date.now() + 10_000).toISOString(),
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return;
  }

  if (status === "FAILED") {
    const errMsg = statusJson?.error?.message || statusJson?.error || "Fal: FAILED";
    await supabaseAdmin.from("generation_jobs").update({
      status: "failed",
      error: String(errMsg),
      progress_text: null,
      finished_at: new Date().toISOString(),
      next_check_at: null,
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return;
  }

  if (status !== "COMPLETED") {
    await supabaseAdmin.from("generation_jobs").update({
      progress_text: `Estado Fal: ${status || "UNKNOWN"}`,
      next_check_at: new Date(Date.now() + 12_000).toISOString(),
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return;
  }

  await supabaseAdmin.from("generation_jobs").update({
    progress_text: "Descargando resultado…",
  }).eq("id", job.id);

  const resultJson = await falQueueResult(decoded.responseUrl);

  const videoUrl =
    resultJson?.video?.url ||
    resultJson?.data?.video?.url ||
    resultJson?.videos?.[0]?.url ||
    resultJson?.output?.video?.url;

  if (!videoUrl) {
    await supabaseAdmin.from("generation_jobs").update({
      status: "failed",
      error: "Fal no devolvió video URL.",
      progress_text: null,
      finished_at: new Date().toISOString(),
      next_check_at: null,
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return;
  }

  const videoResp = await fetch(videoUrl);
  if (!videoResp.ok) {
    await supabaseAdmin.from("generation_jobs").update({
      status: "failed",
      error: `No pude descargar el video (${videoResp.status}).`,
      progress_text: null,
      finished_at: new Date().toISOString(),
      next_check_at: null,
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return;
  }

  const bytes = Buffer.from(await videoResp.arrayBuffer());
  const mimeType = videoResp.headers.get("content-type") || "video/mp4";

  const toolName = decoded.toolName || "VideoGeneratorTool";
  const hint = decoded.hint || "kling-video";

  const uploaded = await uploadBufferToStorage({
    userId: decoded.uid,
    tool: toolName,
    buffer: bytes,
    mimeType,
    nameHint: hint,
  });

  const meta = {
    tool: toolName,
    provider: "fal",
    model: decoded.model || null,
    falEndpointId: decoded.endpointId || null,
    requestId: decoded.requestId || null,
    aspectRatio: decoded.ar || null,
    durationSeconds: decoded.totalDur || null,
    firstFrameAssetId: decoded.firstFrameAssetId || null,
    lastFrameAssetId: decoded.lastFrameAssetId || null,
    klingSound: Boolean(decoded.generateAudio),
  };

  const assetId = await insertAssetRow({
    ownerId: decoded.uid,
    type: "video",
    tool: toolName,
    name: hint,
    prompt: job.prompt || null,
    storagePath: uploaded.storagePath,
    isPublic: false,
    meta,
  });

  const urlExpiresInSeconds = 60 * 60;
  const url = await signStoragePath(uploaded.storagePath, urlExpiresInSeconds);

  await supabaseAdmin.from("generation_jobs").update({
    status: "succeeded",
    progress_text: null,
    error: null,
    finished_at: new Date().toISOString(),
    next_check_at: null,
    locked_at: null,
    locked_by: null,
    result: {
      ok: true,
      items: [{ url, assetId }],
      url,
      assetId,
      urlExpiresInSeconds,
    },
  }).eq("id", job.id);
}

async function loopOnce() {
  const nowIso = new Date().toISOString();

  const { data: queued } = await supabaseAdmin
    .from("generation_jobs")
    .select("*")
    .eq("type", "video_generate")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(5);

  for (const job of queued || []) {
    const locked = await lockJob(job.id, "queued");
    if (!locked) continue;

    try {
      await processQueuedJob(job);
    } catch (e) {
      await supabaseAdmin.from("generation_jobs").update({
        status: "failed",
        error: String(e?.message || e),
        progress_text: null,
        finished_at: new Date().toISOString(),
        next_check_at: null,
        locked_at: null,
        locked_by: null,
      }).eq("id", job.id);
    } finally {
      await unlockJob(job.id);
    }
  }

  const { data: running } = await supabaseAdmin
    .from("generation_jobs")
    .select("*")
    .eq("type", "video_generate")
    .eq("status", "running")
    .or(`next_check_at.is.null,next_check_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(8);

  for (const job of running || []) {
    if (job.status === "canceled") continue;

    const locked = await lockJob(job.id, "running");
    if (!locked) continue;

    try {
      // Si alguien lo canceló por API, paramos
      const { data: fresh } = await supabaseAdmin
        .from("generation_jobs")
        .select("status")
        .eq("id", job.id)
        .single();

      if (fresh?.status === "canceled") {
        await unlockJob(job.id);
        continue;
      }

      await processRunningJob(job);
    } catch (e) {
      await supabaseAdmin.from("generation_jobs").update({
        status: "failed",
        error: String(e?.message || e),
        progress_text: null,
        finished_at: new Date().toISOString(),
        next_check_at: null,
        locked_at: null,
        locked_by: null,
      }).eq("id", job.id);
    } finally {
      await unlockJob(job.id);
    }
  }
}

async function main() {
  // Loop infinito
  for (;;) {
    await loopOnce();
    await sleep(1500);
  }
}

main().catch((e) => {
  console.error(`[${WORKER_ID}] fatal`, e);
  process.exit(1);
});
