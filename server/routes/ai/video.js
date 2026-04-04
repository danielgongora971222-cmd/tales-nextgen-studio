import { z } from "zod";
import express from "express";
import {
  VideoRequestSchema,
  VideoEditRequestSchema,
  MotionControlRequestSchema,
  FalJobSchema,
  FalFinalizeSchema,
} from "../../schemas/index.js";
import { checkUserRateLimit } from "../../lib/userRateLimit.js";
import { assertJobLimits } from "../../lib/jobLimits.js";
import { estimateVideoCostCredits } from "../../../config/pricing.js";

function clampInt(n, min, max) {
  const x = Math.trunc(Number(n));
  if (Number.isNaN(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function clampNumber(n, min, max, fallback = min) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function coerceReferenceVideoDurationSeconds(value) {
  const seconds = clampNumber(value, 0.01, 3600, 0);
  return seconds > 0 ? seconds : null;
}

function readAssetDurationSeconds(asset) {
  const meta = asset?.meta || {};
  const candidates = [meta?.durationSeconds, meta?.videoDurationSeconds, meta?.duration];

  for (const candidate of candidates) {
    const seconds = coerceReferenceVideoDurationSeconds(candidate);
    if (seconds) return seconds;
  }

  return null;
}

function getMotionControlReferenceVideoLimitSeconds(characterOrientation) {
  return characterOrientation === "image" ? 10 : 30;
}

function getMotionControlReferenceVideoDurationError(durationSeconds, characterOrientation) {
  const duration = coerceReferenceVideoDurationSeconds(durationSeconds);
  if (!duration) return null;

  const maxSeconds = getMotionControlReferenceVideoLimitSeconds(characterOrientation);
  if (duration < 3) {
    return `Kling Motion Control requiere un video de referencia de al menos 3 segundos. El clip recibido dura ${duration.toFixed(2)}s.`;
  }

  if (duration > maxSeconds) {
    const createFromLabel = characterOrientation === "image" ? "From image" : "From video";
    return `Con Create from = ${createFromLabel}, Kling Motion Control solo admite videos de referencia de hasta ${maxSeconds}s. El clip recibido dura ${duration.toFixed(2)}s.`;
  }

  return null;
}

const DEFAULT_KLING_OMNI_MODEL_NAME = "kling-v3-omni";

function coerceKlingOmniModelName(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return null;

  // Alias legacy / internos que NO son válidos en /videos/omni-video.
  // Los coercionamos al modelo oficial actual para evitar 1201 por model_name inválido.
  if (
    v === "kling-video-o3" ||
    v === "kling-o3-pro" ||
    v === "kling-v3" ||
    v === "kling-v3-0" ||
    v === "kling-v3.0"
  ) {
    return "kling-v3-omni";
  }

  if (v === "kling-v3-omni" || v === "kling-video-o1") return v;
  return null;
}
function resolveKlingOmniModelName(...candidates) {
  for (const raw of candidates) {
    const normalized = coerceKlingOmniModelName(raw);
    if (normalized) return normalized;
  }
  return DEFAULT_KLING_OMNI_MODEL_NAME;
}

export function createAiVideoRouter(ctx) {

  // Utilidad: pausa para loops de "polling" (Node.js)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const router = express.Router();

  // Destructuring: dejamos disponibles con los MISMOS nombres
  // para que el código copiado desde server.js funcione sin cambios internos.
  const {
    supabaseAdmin,
    requireUser,
    getClientIp,
    apiError,
    httpError,
    ensureAI,
    assertQueueAdmission,
  
  // kling + fal helpers (vienen desde server.js)
    createImage2VideoTask,
    createText2VideoTask,
    createMotionControlTask,
    pollTaskUntilDone,
    klingPostWithRetry,
    falQueueSubmit,
    falQueueRun,
    signJobToken,
    assetIdToSignedUrl,
    assetIdToInlinePart,
    assetIdToImageObject,

    // storage helpers
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    signStoragePath,
    insertAssetRow,

    // env/flags/clients/helpers
    APP_ENV,
    NODE_ENV,
    SUPABASE_BUCKET,

    ...rest
  } = ctx;

  // Uploads: SIEMPRE usamos uploadBufferToStorage / uploadBase64ToStorage / createClientUploadTarget,
  // que soportan Cloudflare R2 (principal) y Supabase Storage (solo legacy, si aún existiera).

  const isUuidLike = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value || "").trim()
    );

  const PIAPI_BASE_URL = String(process.env.PIAPI_BASE_URL || "https://api.piapi.ai/api/v1").replace(/\/+$/, "");
  const GOOGLE_API_BASE_URL = String(
    process.env.GOOGLE_API_BASE_URL ||
    process.env.GEMINI_API_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/, "");

  function isVeoModelId(value) {
    return String(value || "").trim().toLowerCase().startsWith("veo-");
  }

  function normalizeGoogleOperationName(value) {
    return String(value || "").trim().replace(/^\/+/, "");
  }

  function googleHeaders() {
    const key = String(process.env.GEMINI_API_KEY || "").trim();
    if (!key) {
      throw httpError(500, "AI_NOT_CONFIGURED", "Falta GEMINI_API_KEY en el backend.");
    }
    return {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    };
  }

  function buildGoogleInlineImage(imageObj) {
    const mimeType = String(imageObj?.mimeType || "image/png").trim() || "image/png";
    const data = String(
      imageObj?.bytesBase64Encoded ||
      imageObj?.imageBytes ||
      imageObj?.data ||
      imageObj?.inlineData?.data ||
      ""
    ).trim();
    if (!data) {
      throw httpError(400, "ASSET_IMAGE_EMPTY", "No pude preparar la imagen para Google Veo.");
    }

    // Importante: el endpoint predictLongRunning de Veo usa el schema oficial
    // VideoGenerationModelInstance/Image, que espera { mimeType, bytesBase64Encoded }
    // (o gcsUri), no { inlineData }. inlineData dispara HTTP 400 en Veo 3.1.
    return { mimeType, bytesBase64Encoded: data };
  }

  function pickGoogleVideoUrl(payload) {
    return (
      payload?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
      payload?.response?.generatedVideos?.[0]?.video?.uri ||
      payload?.response?.generatedVideos?.[0]?.video?.url ||
      payload?.response?.videos?.[0]?.uri ||
      payload?.response?.videos?.[0]?.url ||
      null
    );
  }

  function getGoogleOperationErrorMessage(payload, fallback = "Google Veo request failed.") {
    return String(
      payload?.error?.message ||
      payload?.error?.status ||
      payload?.message ||
      payload?.details?.message ||
      fallback
    ).trim();
  }

  function classifyGoogleVeoError(err, { defaultMessage = "Google Veo request failed.", fallbackStatus = 502 } = {}) {
    const status = Number(err?.status || 0);
    const data = err?.data || null;
    const providerMessage = getGoogleOperationErrorMessage(data, String(err?.message || defaultMessage));
    const details = {
      provider: "google",
      upstreamStatus: status || null,
      response: data,
    };

    if (status === 400) {
      return httpError(400, "GOOGLE_VEO_BAD_REQUEST", `Google Veo rechazó la solicitud: ${providerMessage}`, details);
    }
    if (status === 401 || status === 403) {
      return httpError(502, "GOOGLE_VEO_AUTH_ERROR", `Google rechazó la autenticación o el acceso a Veo: ${providerMessage}`, details);
    }
    if (status === 408 || err?.name === "AbortError") {
      return httpError(504, "GOOGLE_VEO_TIMEOUT", `Google Veo tardó demasiado en aceptar o resolver la operación: ${providerMessage}`, details);
    }
    if (status === 409 || status === 425 || status === 429) {
      return httpError(503, "GOOGLE_VEO_BUSY", `Google Veo está saturado temporalmente: ${providerMessage}`, details);
    }
    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return httpError(503, "GOOGLE_VEO_UPSTREAM_ERROR", `Google Veo devolvió un error temporal: ${providerMessage}`, details);
    }
    if (!status) {
      const message = String(err?.message || defaultMessage || "Google Veo request failed.").trim();
      if (/aborted|timeout/i.test(message)) {
        return httpError(504, "GOOGLE_VEO_TIMEOUT", `Google Veo tardó demasiado en aceptar o resolver la operación: ${message}`, details);
      }
      return httpError(503, "GOOGLE_VEO_NETWORK_ERROR", `No se pudo conectar con Google Veo: ${message}`, details);
    }

    return httpError(fallbackStatus, "GOOGLE_VEO_REQUEST_FAILED", providerMessage || defaultMessage, details);
  }

  async function googleVeoStartOperation({ model, instance, parameters }) {
    let response;
    let rawText = "";
    let data = null;
    try {
      response = await fetch(`${GOOGLE_API_BASE_URL}/models/${encodeURIComponent(model)}:predictLongRunning`, {
        method: "POST",
        headers: googleHeaders(),
        body: JSON.stringify({
          instances: [instance],
          ...(parameters && Object.keys(parameters).length ? { parameters } : {}),
        }),
      });

      rawText = await response.text();
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = rawText ? { raw: rawText } : null;
      }
    } catch (err) {
      throw classifyGoogleVeoError(err, { defaultMessage: "Google Veo request failed." });
    }

    if (!response.ok) {
      const error = new Error(getGoogleOperationErrorMessage(data, `Google Veo error (${response.status})`));
      error.status = response.status;
      error.data = data;
      throw classifyGoogleVeoError(error, { defaultMessage: "Google Veo request failed." });
    }

    const operationName = normalizeGoogleOperationName(data?.name);
    if (!operationName) {
      throw httpError(502, "GOOGLE_VEO_BAD_RESPONSE", "Google Veo no devolvió operation.name.", { response: data });
    }

    return { operationName, raw: data };
  }

  async function googleVeoGetOperation(operationName) {
    const normalized = normalizeGoogleOperationName(operationName);
    let response;
    let rawText = "";
    let data = null;
    try {
      response = await fetch(`${GOOGLE_API_BASE_URL}/${normalized}`, {
        method: "GET",
        headers: {
          "x-goog-api-key": String(process.env.GEMINI_API_KEY || "").trim(),
        },
      });

      rawText = await response.text();
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = rawText ? { raw: rawText } : null;
      }
    } catch (err) {
      throw classifyGoogleVeoError(err, { defaultMessage: "Google Veo get operation failed." });
    }

    if (!response.ok) {
      const error = new Error(getGoogleOperationErrorMessage(data, `Google Veo operation error (${response.status})`));
      error.status = response.status;
      error.data = data;
      throw classifyGoogleVeoError(error, { defaultMessage: "Google Veo get operation failed." });
    }

    return data;
  }

  async function pollGoogleVeoUntilDone(operationName, { timeoutMs = 10 * 60 * 1000, intervalMs = 10_000 } = {}) {
    const startedAt = Date.now();
    let lastPayload = null;

    while (Date.now() - startedAt <= timeoutMs) {
      lastPayload = await googleVeoGetOperation(operationName);
      if (lastPayload?.done === true) return lastPayload;
      await sleep(intervalMs);
    }

    throw httpError(504, "GOOGLE_VEO_TIMEOUT", "Google Veo excedió el tiempo máximo de espera en modo sync.", {
      operationName,
      response: lastPayload,
    });
  }

  async function upsertGoogleVideoJobRow({
    ownerId,
    kind = "video",
    operationName,
    jobToken,
    toolName,
    hint,
    model,
    prompt,
    extra,
  }) {
    if (!supabaseAdmin) {
      throw httpError(
        500,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase admin no está configurado en el backend."
      );
    }

    const params = {
      provider: "google",
      operationName: operationName || null,
      googleOperationName: operationName || null,
      jobToken: jobToken || null,
      toolName: toolName || null,
      hint: hint || null,
      model: model || null,
      prompt: prompt || null,
      ...(extra || {}),
    };

    await assertJobLimits({ supabaseAdmin, httpError, ownerId, kind });

    const ins = await supabaseAdmin
      .from("jobs")
      .insert({
        owner_id: ownerId,
        kind,
        status: "running",
        params,
        next_check_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!ins.error && ins.data?.id) return ins.data.id;

    throw httpError(500, "JOB_INSERT_FAILED", "No pude crear el job async de Google Veo en la tabla jobs.", {
      supabase: {
        message: ins.error?.message,
        code: ins.error?.code,
        details: ins.error?.details,
        hint: ins.error?.hint,
      },
    });
  }

  function isSeedanceModelId(value) {
    const v = String(value || "").trim();
    return v === "seedance-2-preview" || v === "seedance-2-fast-preview";
  }

  function isEnvExplicitFalse(value) {
    const v = String(value || "").trim().toLowerCase();
    return v === "0" || v === "false" || v === "off" || v === "no" || v === "disabled";
  }

  const SEEDANCE_MODELS_ENABLED = !isEnvExplicitFalse(process.env.SEEDANCE_MODELS_ENABLED);
  const PIAPI_WEBHOOK_SECRET = String(process.env.PIAPI_WEBHOOK_SECRET || "").trim();

  function ensureSeedanceEnabled() {
    if (SEEDANCE_MODELS_ENABLED) return;
    throw httpError(
      409,
      "SEEDANCE_TEMPORARILY_DISABLED",
      "Seedance 2.0 está desactivado por configuración del servidor.",
      { provider: "piapi", modelFamily: "seedance-2" }
    );
  }

  async function findBlockingUserVideoJob({ ownerId, excludeClientJobId = null }) {
    const activeWindowMin = Math.max(5, Number(process.env.USER_VIDEO_ACTIVE_WINDOW_MINUTES || 45));
    const activeSinceIso = new Date(Date.now() - activeWindowMin * 60 * 1000).toISOString();

    const r = await supabaseAdmin
      .from("jobs")
      .select("id, status, params, created_at, updated_at")
      .eq("kind", "video")
      .eq("owner_id", ownerId)
      .in("status", ["queued", "running"])
      .is("result_asset_id", null)
      .gte("updated_at", activeSinceIso)
      .order("created_at", { ascending: true });

    if (r.error) {
      throw httpError(500, "DB_ERROR", "No pude validar el estado de tus videos activos.", {
        supabase: {
          message: r.error?.message,
          code: r.error?.code,
          details: r.error?.details,
          hint: r.error?.hint,
        },
      });
    }

    const rows = Array.isArray(r.data) ? r.data : [];
    const exclude = String(excludeClientJobId || "").trim();

    const filtered = exclude
      ? rows.filter((row) => String(row?.params?.clientJobId || "").trim() !== exclude)
      : rows;

    for (const row of filtered) {
      const provider = String(row?.params?.provider || "").trim().toLowerCase();
      const taskId = String(row?.params?.taskId || row?.params?.piapiTaskId || "").trim();

      if (provider === "piapi" && taskId) {
        try {
          const existingAsset = await findExistingPiapiAssetByTaskId({ ownerId, taskId });
          if (existingAsset?.id) {
            await markPiapiJobSucceededWithExistingAsset({
              row,
              assetId: existingAsset.id,
              taskStatusRaw: row?.params?.providerStatus || "completed",
              extraParams: {
                providerRecoveredAt: new Date().toISOString(),
                providerFinalizePath: "piapi-slot-recovery",
              },
            });
            continue;
          }
        } catch (recoveryError) {
          console.error("[piapi][slot_recovery_failed]", recoveryError?.message || recoveryError);
        }
      }

      return row;
    }

    return null;
  }

  function respondUserVideoSlotBusy(res, blockingJob) {
    const retryAfterSeconds = Math.max(
      5,
      Math.min(90, Number(process.env.USER_VIDEO_SLOT_RETRY_AFTER_SECONDS || 30))
    );

    res
      .status(429)
      .set("Retry-After", String(retryAfterSeconds))
      .json({
        ok: false,
        error: {
          code: "VIDEO_USER_SLOT_BUSY",
          message: "Ya tienes un video en proceso. Espera a que termine y reintentamos automáticamente.",
          details: {
            retryAfterSeconds,
            activeJobId: blockingJob?.id || null,
            provider: blockingJob?.params?.provider || null,
            model: blockingJob?.params?.model || null,
            tool: blockingJob?.params?.toolName || blockingJob?.params?.tool || null,
          },
        },
      });
  }

  async function enforceUserVideoSlot(res, ownerId, { clientJobId = null } = {}) {
    const blockingJob = await findBlockingUserVideoJob({
      ownerId,
      excludeClientJobId: clientJobId || null,
    });

    if (!blockingJob) return false;

    respondUserVideoSlotBusy(res, blockingJob);
    return true;
  }

  function getPiapiApiKey() {
    const key = String(process.env.PIAPI_API_KEY || process.env.PIAPI_KEY || "").trim();
    if (!key) {
      throw httpError(500, "PIAPI_NOT_CONFIGURED", "Falta PIAPI_API_KEY en el backend.");
    }
    return key;
  }


  async function findExistingPiapiAssetByTaskId({ ownerId, taskId }) {
    const cleanTaskId = String(taskId || "").trim();
    if (!ownerId || !cleanTaskId) return null;

    const q = await supabaseAdmin
      .from("assets")
      .select("id, created_at, meta")
      .eq("owner_id", ownerId)
      .eq("type", "video")
      .filter("meta->>piapiTaskId", "eq", cleanTaskId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (q.error && q.error.code !== "PGRST116") {
      throw httpError(500, "DB_ERROR", "No pude buscar el asset PiAPI existente.", {
        supabase: {
          message: q.error?.message,
          code: q.error?.code,
          details: q.error?.details,
          hint: q.error?.hint,
        },
      });
    }

    return q.data || null;
  }

  async function markPiapiJobSucceededWithExistingAsset({ row, assetId, taskStatusRaw = null, extraParams = null }) {
    if (!row?.id || !assetId) return;
    const nowIso = new Date().toISOString();
    const mergedParams = {
      ...(row.params || {}),
      ...(extraParams || {}),
      providerStatus: taskStatusRaw || row?.params?.providerStatus || "completed",
      providerRecoveredAssetId: assetId,
      providerFinalizePath: extraParams?.providerFinalizePath || row?.params?.providerFinalizePath || "piapi-asset-recovery",
    };

    const upd = await supabaseAdmin
      .from("jobs")
      .update({
        status: "succeeded",
        error: null,
        finished_at: nowIso,
        next_check_at: null,
        locked_at: null,
        locked_by: null,
        result_asset_id: assetId,
        params: mergedParams,
      })
      .eq("id", row.id);

    if (upd.error) {
      console.error("[piapi][asset_recovery_update_failed]", { jobId: row.id, error: upd.error });
    }
  }

  function piapiHeaders() {
    return {
      "X-API-Key": getPiapiApiKey(),
      "Content-Type": "application/json",
    };
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

  function isPiapiPayloadSuccess(payload) {
    const code = Number(payload?.code);
    if (!Number.isFinite(code)) return true;
    return code === 0 || code === 200;
  }

  function classifyPiapiError(err, { defaultMessage = "PiAPI request failed.", fallbackStatus = 502 } = {}) {
    const status = Number(err?.status || 0);
    const data = err?.data || null;
    const providerCode = data?.error?.code || data?.code || null;
    const providerMessage = getPiapiErrorMessage(data, String(err?.message || defaultMessage));
    const details = {
      provider: "piapi",
      upstreamStatus: status || null,
      upstreamCode: providerCode,
      response: data,
      retryAfterSeconds: Number.isFinite(Number(err?.retryAfterSeconds)) ? Number(err.retryAfterSeconds) : null,
    };

    if (status === 400) {
      return httpError(400, "PIAPI_BAD_REQUEST", `Seedance rechazó la solicitud: ${providerMessage}`, details);
    }

    if (status === 401 || status === 403) {
      return httpError(502, "PIAPI_AUTH_ERROR", `PiAPI rechazó la autenticación o el acceso a Seedance: ${providerMessage}`, details);
    }

    if (status === 404) {
      return httpError(502, "PIAPI_ENDPOINT_ERROR", `PiAPI no encontró el endpoint o modelo de Seedance: ${providerMessage}`, details);
    }

    if (status === 408 || err?.name === "AbortError") {
      return httpError(504, "PIAPI_TIMEOUT", `PiAPI tardó demasiado en aceptar la tarea de Seedance: ${providerMessage}`, details);
    }

    if (status === 409 || status === 425 || status === 429) {
      return httpError(503, "PIAPI_BUSY", `Seedance/PiAPI está saturado temporalmente: ${providerMessage}`, details);
    }

    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return httpError(503, "PIAPI_UPSTREAM_ERROR", `PiAPI devolvió un error temporal al crear la tarea de Seedance: ${providerMessage}`, details);
    }

    if (!status) {
      const message = String(err?.message || defaultMessage || "PiAPI request failed.").trim();
      if (/aborted|timeout/i.test(message)) {
        return httpError(504, "PIAPI_TIMEOUT", `PiAPI tardó demasiado en aceptar la tarea de Seedance: ${message}`, details);
      }
      return httpError(503, "PIAPI_NETWORK_ERROR", `No se pudo conectar con PiAPI para Seedance: ${message}`, details);
    }

    return httpError(fallbackStatus, "PIAPI_REQUEST_FAILED", providerMessage || defaultMessage, details);
  }

  async function piapiRequest(path, { method = "GET", body = undefined, timeoutMs = 90_000, retries = 3 } = {}) {
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${PIAPI_BASE_URL}${path}`, {
          method,
          headers: piapiHeaders(),
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });

        const rawText = await response.text();
        let data = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          data = rawText ? { raw: rawText } : null;
        }

        if (!response.ok) {
          const err = new Error(getPiapiErrorMessage(data, `PiAPI error (${response.status})`));
          err.status = response.status;
          err.data = data;
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter && !Number.isNaN(Number(retryAfter))) {
            err.retryAfterSeconds = Number(retryAfter);
          }
          throw err;
        }

        if (!isPiapiPayloadSuccess(data)) {
          const payloadCode = Number(data?.code);
          const err = new Error(getPiapiErrorMessage(data, "PiAPI devolvió una respuesta inválida al crear o consultar la tarea."));
          err.status = Number.isFinite(payloadCode) && payloadCode >= 400 && payloadCode < 600 ? payloadCode : 502;
          err.data = data;
          throw err;
        }

        return data;
      } catch (err) {
        lastErr = err;
        const status = Number(err?.status || 0);
        const retryable = !status || [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

        if (attempt >= retries || !retryable) {
          throw classifyPiapiError(err, { defaultMessage: "PiAPI request failed." });
        }

        const retryAfterMs = Number.isFinite(Number(err?.retryAfterSeconds))
          ? Math.max(1_000, Math.min(120_000, Number(err.retryAfterSeconds) * 1000))
          : null;
        const waitMs = (retryAfterMs ?? (1_500 * (attempt + 1) + Math.floor(Math.random() * 600)));
        await sleep(waitMs);
      } finally {
        clearTimeout(timer);
      }
    }

    throw classifyPiapiError(lastErr || new Error("PiAPI request failed."), {
      defaultMessage: "PiAPI request failed.",
    });
  }

  function extractPiapiTaskData(raw) {
    if (raw?.data && typeof raw.data === "object") return raw.data;
    if (raw?.task && typeof raw.task === "object") return raw.task;
    return raw || null;
  }

  function extractPiapiTaskId(raw) {
    const data = extractPiapiTaskData(raw);
    return (
      data?.task_id ||
      data?.taskId ||
      raw?.task_id ||
      raw?.taskId ||
      null
    );
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

  async function downloadPiapiVideoToBuffer(videoUrl) {
    const response = await fetch(videoUrl, { method: "GET" });
    if (!response.ok) {
      throw httpError(
        502,
        "PIAPI_VIDEO_DOWNLOAD_FAILED",
        `No pude descargar el video de PiAPI (${response.status}).`,
        { videoUrl }
      );
    }

    const mimeType = response.headers.get("content-type") || "video/mp4";
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mimeType };
  }

  function coerceSeedanceDuration(value) {
    const n = Number(value);
    if (n === 15) return 15;
    if (n === 10) return 10;
    return 5;
  }

  function coerceSeedanceAspectRatio(value, fallback = "16:9") {
    const v = String(value || "").trim();
    return v === "9:16" || v === "16:9" || v === "4:3" || v === "3:4" ? v : fallback;
  }

  function normalizeSeedancePrompt(prompt) {
    let value = String(prompt || "").trim();
    if (!value) return "";

    // PiAPI documenta referencias de imagen como @imageN.
    // Normalizamos variantes legacy (@Image1) para evitar rechazos por placeholder.
    value = value.replace(/@image(\d+)/gi, (_, n) => `@image${String(n)}`);

    // Seedance video edit usa video_urls; @Video1 es una ayuda UX interna de Tales,
    // no un placeholder documentado del proveedor. Lo convertimos a una frase segura.
    value = value.replace(/@video\d+/gi, "the input video");

    return value.replace(/\s{2,}/g, " ").trim();
  }

  function buildSeedanceFramePrompt({ prompt, hasFirst, hasLast }) {
    const visiblePrompt = normalizeSeedancePrompt(prompt);
    const instructions = [];

    if (hasFirst) instructions.push("Use @image1 as initial frame.");
    if (hasLast) instructions.push(`Use @image${hasFirst ? 2 : 1} as last frame.`);

    return [instructions.join(" "), visiblePrompt].filter(Boolean).join("\n").trim();
  }

  function isPublicHttpUrl(value) {
    const v = String(value || "").trim();
    if (!v) return false;
    return /^https?:\/\//i.test(v) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(v);
  }

  function deriveRequestOrigin(req) {
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https";
    const host = String(req.headers["x-forwarded-host"] || req.get?.("host") || "").split(",")[0].trim();
    if (!host) return null;
    return `${proto}://${host}`;
  }

  function resolvePiapiWebhookBaseUrl(req) {
    const candidates = [
      process.env.PIAPI_WEBHOOK_BASE_URL,
      process.env.PUBLIC_API_BASE_URL,
      process.env.API_BASE_URL,
      process.env.RENDER_EXTERNAL_URL,
      deriveRequestOrigin(req),
    ];

    for (const candidate of candidates) {
      const base = String(candidate || "").trim().replace(/\/+$/, "");
      if (!base || !isPublicHttpUrl(base)) continue;
      return base;
    }
    return null;
  }

  function buildPiapiWebhookConfig(req) {
    const baseUrl = resolvePiapiWebhookBaseUrl(req);
    if (!baseUrl) return null;
    return {
      endpoint: `${baseUrl}/api/ai/video/piapi/webhook`,
      secret: PIAPI_WEBHOOK_SECRET || "",
    };
  }

  async function createPiapiSeedanceTask({ taskType, input, webhookConfig = null }) {
    const body = {
      model: "seedance",
      task_type: taskType,
      input,
    };

    if (webhookConfig?.endpoint) {
      body.config = {
        webhook_config: {
          endpoint: webhookConfig.endpoint,
          secret: webhookConfig.secret || "",
        },
      };
    }

    return piapiRequest("/task", {
      method: "POST",
      timeoutMs: 60_000,
      retries: 2,
      body,
    });
  }

  async function getOwnedAssetById(assetId, ownerId) {
    const { data, error } = await supabaseAdmin
      .from("assets")
      .select("id, owner_id, type, meta")
      .eq("id", assetId)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw httpError(500, "DB_ERROR", "No pude leer el asset solicitado.", {
        supabase: {
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
        },
      });
    }

    return data || null;
  }

  async function resolveKlingElementList({
    elementRefs,
    ownerId,
    maxCount,
    codePrefix,
    label,
  }) {
    const orderedRefs = [];
    for (const raw of Array.isArray(elementRefs) ? elementRefs : []) {
      const ref = String(raw || "").trim();
      if (!ref) continue;
      if (!orderedRefs.includes(ref)) orderedRefs.push(ref);
    }

    if (!orderedRefs.length) return undefined;

    if (orderedRefs.length > maxCount) {
      throw httpError(
        400,
        `${codePrefix}_TOO_MANY_ELEMENTS`,
        `${label}: máximo ${maxCount} Elements en este modo.`
      );
    }

    const presetRefs = orderedRefs.filter((ref) => ref.startsWith("preset:"));
    const localRefs = orderedRefs.filter((ref) => isUuidLike(ref));
    const invalidRefs = orderedRefs.filter((ref) => !ref.startsWith("preset:") && !isUuidLike(ref));

    if (invalidRefs.length) {
      throw httpError(
        400,
        `${codePrefix}_BAD_ELEMENT_REF`,
        "Uno o más Elements tienen un formato inválido.",
        { invalidRefs }
      );
    }

    let byId = new Map();
    if (localRefs.length) {
      const { data: rows, error: rowsErr } = await supabaseAdmin
        .from("kling_elements")
        .select("id, owner_id, kling_element_id, status, status_detail")
        .in("id", localRefs)
        .eq("owner_id", ownerId);

      if (rowsErr) {
        throw httpError(500, "DB_ERROR", "No pude leer tus Elements.", { rowsErr });
      }

      byId = new Map((rows || []).map((row) => [String(row.id), row]));
      const missing = localRefs.filter((id) => !byId.has(id));
      if (missing.length) {
        throw httpError(
          400,
          `${codePrefix}_ELEMENT_NOT_FOUND`,
          "Uno o más Elements no existen o no te pertenecen.",
          { missing }
        );
      }
    }

    const out = [];
    for (const ref of orderedRefs) {
      if (ref.startsWith("preset:")) {
        const remoteId = String(ref.slice("preset:".length) || "").trim();
        if (!remoteId) {
          throw httpError(
            400,
            `${codePrefix}_BAD_ELEMENT_REF`,
            "Uno o más preset Elements tienen un ID inválido.",
            { ref }
          );
        }
        out.push({ element_id: remoteId });
        continue;
      }

      const row = byId.get(ref);
      const st = String(row?.status || "ready");
      if (st !== "ready") {
        throw httpError(
          400,
          `${codePrefix}_ELEMENT_NOT_READY`,
          "Uno o más Elements todavía se están creando o fallaron. Espera o usa Refresh status.",
          { elementUuid: ref, status: row?.status || null, statusDetail: row?.status_detail || null }
        );
      }

      const rawRemoteId = row?.kling_element_id;
      if (!rawRemoteId) {
        throw httpError(
          400,
          `${codePrefix}_ELEMENT_MISSING_KLING_ID`,
          "Un Element no tiene kling_element_id guardado (no se puede mandar a Kling).",
          { elementUuid: ref }
        );
      }

      out.push({ element_id: String(rawRemoteId).trim() });
    }

    return out.length ? out : undefined;
  }

  async function spendVideoCreditsOrReject({
    userId,
    req,
    modelNorm,
    durationSeconds,
    resolution = undefined,
    generateAudio = undefined,
    klingMode = undefined,
    voiceControl = undefined,
    count = 1,
    entryType = "gen_spend_video",
    refType = "ai_video",
    refId = null,
  }) {
    const dur = clampInt(durationSeconds || 0, 1, 60);
    const n = clampInt(count || 1, 1, 8);

    const totalCredits = estimateVideoCostCredits({
      modelNorm,
      durationSeconds: dur,
      resolution,
      generateAudio,
      klingMode,
      voiceControl,
      count: n,
    });

    const baseIdem = ctx?.billing?.getIdempotencyKey ? ctx.billing.getIdempotencyKey(req) : undefined;
    const idem = baseIdem ? `${refType}:${baseIdem}` : undefined;

    const spend = await ctx.billing.spendCredits({
      userId,
      amountCredits: totalCredits,
      entryType,
      refType,
      refId,
      idempotencyKey: idem,
    });

    if (!spend.ok) return { ok: false, error: spend.error, totalCredits, idempotencyKey: idem };

    return { ok: true, totalCredits, idempotencyKey: idem };
  }


  // Helper: registra el job async (Fal queue) en la tabla public.jobs
  async function upsertFalJobRow({
    ownerId,
    kind = "video",
    requestId,
    jobToken,
    statusUrl,
    responseUrl,
    endpointId,
    toolName,
    hint,
    model,
    prompt,
    extra,
  }) {
    if (!supabaseAdmin) {
      throw httpError(
        500,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase admin no está configurado en el backend."
      );
    }

    const params = {
      provider: "fal",
      requestId: requestId || null,
      statusUrl: statusUrl || null,
      responseUrl: responseUrl || null,
      endpointId: endpointId || null,
      falEndpointId: endpointId || null,
      jobToken: jobToken || null,
      toolName: toolName || null,
      hint: hint || null,
      model: model || null,
      prompt: prompt || null,
      ...(extra || {}),
    };

    await assertJobLimits({ supabaseAdmin, httpError, ownerId, kind });

    const ins = await supabaseAdmin
      .from("jobs")
      .insert({
        owner_id: ownerId,
        kind,
        status: "running",
        params,
        next_check_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!ins.error && ins.data?.id) return ins.data.id;

    // Si el índice único por requestId dispara, buscamos el existente
    if (ins.error?.code === "23505" && requestId) {
      const existing = await supabaseAdmin
        .from("jobs")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("kind", kind)
        .filter("params->>requestId", "eq", String(requestId))
        .maybeSingle();

      if (!existing.error && existing.data?.id) return existing.data.id;
    }

    throw httpError(500, "JOB_INSERT_FAILED", "No pude crear el job async en la tabla jobs.", {
      supabase: {
        message: ins.error?.message,
        code: ins.error?.code,
        details: ins.error?.details,
        hint: ins.error?.hint,
      },
    });
  }

  // ===============================
  // ✅ Kling V3 Hardening: límite de tareas paralelas (evita 1303)
  // Solo se usa cuando selectedModelNorm === "kling-v3"
  // ===============================
  async function countRunningKlingJobs({ ownerId }) {
    const q = supabaseAdmin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("kind", "video")
      .eq("status", "running")
      .filter("params->>provider", "eq", "kling");

    // ✅ Ignora jobs “running” stale que no se actualizan (worker caído / jobs antiguos)
    const activeWindowMin = Math.max(5, Number(process.env.KLING_ACTIVE_WINDOW_MINUTES || 45));
    const activeSinceIso = new Date(Date.now() - activeWindowMin * 60 * 1000).toISOString();
    q.gte("updated_at", activeSinceIso);

    if (ownerId) q.eq("owner_id", ownerId);

    const r = await q;

    if (r.error) {
      throw httpError(500, "DB_ERROR", "No pude contar jobs Kling activos.", {
        supabase: {
          message: r.error?.message,
          code: r.error?.code,
          details: r.error?.details,
          hint: r.error?.hint,
        },
      });
    }

    return Number(r.count || 0);
}

// ✅ Idempotencia: si el cliente reintenta (reload / red / timeout), podemos devolver el job existente
// evitando mostrar "Failed 429" cuando en realidad el job original sigue corriendo.
async function findKlingJobByClientJobId({ ownerId, clientJobId }) {
  if (!clientJobId) return null;

  const r = await supabaseAdmin
    .from("jobs")
    .select("id, status, params, result_asset_id")
    .eq("kind", "video")
    .eq("owner_id", ownerId)
    .filter("params->>provider", "eq", "kling")
    .filter("params->>clientJobId", "eq", String(clientJobId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // PGRST116 = 0 rows con maybeSingle()
  if (r.error && r.error.code !== "PGRST116") {
    throw httpError(500, "DB_ERROR", "No pude buscar job Kling por clientJobId.", {
      supabase: {
        message: r.error?.message,
        code: r.error?.code,
        details: r.error?.details,
        hint: r.error?.hint,
      },
    });
  }

  return r.data || null;
}

async function findVideoJobByClientJobId({ ownerId, clientJobId }) {
  if (!clientJobId) return null;

  const r = await supabaseAdmin
    .from("jobs")
    .select("id, status, params, result_asset_id")
    .eq("kind", "video")
    .eq("owner_id", ownerId)
    .filter("params->>clientJobId", "eq", String(clientJobId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (r.error && r.error.code !== "PGRST116") {
    throw httpError(500, "DB_ERROR", "No pude buscar job de video por clientJobId.", {
      supabase: {
        message: r.error?.message,
        code: r.error?.code,
        details: r.error?.details,
        hint: r.error?.hint,
      },
    });
  }

  return r.data || null;
}

function respondKlingBusy(res, { retryAfterSeconds, message, details }) {
    const ra = Math.max(5, Math.min(180, Number(retryAfterSeconds || 30)));

    // Importante: status 429 + Retry-After => apiPostJson reintenta con esa pausa
    res
      .status(429)
      .set("Retry-After", String(ra))
      .json({
        ok: false,
        error: {
          code: "KLING_V3_PARALLEL_LIMIT",
          message: message || "Kling está ocupado (límite de tareas en paralelo). Intenta de nuevo en unos segundos.",
          details: { ...(details || {}), retryAfterSeconds: ra },
        },
      });
  }

  async function enforceKlingParallelLimit(res, ownerId) {
    const maxPerUser = Math.max(
      1,
      Number(process.env.KLING_MAX_PARALLEL_PER_USER || process.env.KLING_V3_MAX_PARALLEL_PER_USER || 1)
    );
    const maxGlobal = Math.max(
      1,
      Number(process.env.KLING_MAX_PARALLEL_GLOBAL || process.env.KLING_V3_MAX_PARALLEL_GLOBAL || 1)
    );
    const retryAfterSeconds = Number(
      process.env.KLING_RETRY_AFTER_SECONDS || process.env.KLING_V3_RETRY_AFTER_SECONDS || 30
    );

    const [activeUser, activeGlobal] = await Promise.all([
      countRunningKlingJobs({ ownerId }),
      countRunningKlingJobs({ ownerId: null }),
    ]);

    if (activeUser >= maxPerUser || activeGlobal >= maxGlobal) {
      respondKlingBusy(res, {
        retryAfterSeconds,
        message:
          "Kling está al límite de tareas en paralelo. Espera a que terminen las generaciones en curso y reintentamos automáticamente.",
        details: { activeUser, activeGlobal, maxPerUser, maxGlobal },
      });
      return true; // respuesta enviada
    }

    return false;
  }

    // Helper: registra el job async (Kling Tasks) en la tabla public.jobs
  async function upsertKlingJobRow({
    ownerId,
    kind = "video",
    taskId,
    taskType,
    toolName,
    hint,
    model,
    prompt,
    extra,
  }) {
    if (!supabaseAdmin) {
      throw httpError(
        500,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase admin no está configurado en el backend."
      );
    }

    const params = {
      provider: "kling",
      taskId: taskId || null,
      taskType: taskType || null,
      toolName: toolName || null,
      hint: hint || null,
      model: model || null,
      prompt: prompt || null,
      ...(extra || {}),
    };

    await assertJobLimits({ supabaseAdmin, httpError, ownerId, kind });

    const ins = await supabaseAdmin
      .from("jobs")
      .insert({
        owner_id: ownerId,
        kind,
        status: "running",
        params,
        next_check_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!ins.error && ins.data?.id) return ins.data.id;

    throw httpError(500, "JOB_INSERT_FAILED", "No pude crear el job async en la tabla jobs.", {
      supabase: {
        message: ins.error?.message,
        code: ins.error?.code,
        details: ins.error?.details,
        hint: ins.error?.hint,
      },
    });
  }


  async function upsertPiapiJobRow({
    ownerId,
    kind = "video",
    taskId,
    taskType,
    toolName,
    hint,
    model,
    prompt,
    extra,
  }) {
    if (!supabaseAdmin) {
      throw httpError(
        500,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase admin no está configurado en el backend."
      );
    }

    const params = {
      provider: "piapi",
      taskId: taskId || null,
      taskType: taskType || null,
      toolName: toolName || null,
      hint: hint || null,
      model: model || null,
      prompt: prompt || null,
      ...(extra || {}),
    };

    await assertJobLimits({ supabaseAdmin, httpError, ownerId, kind });

    const ins = await supabaseAdmin
      .from("jobs")
      .insert({
        owner_id: ownerId,
        kind,
        status: "running",
        params,
        next_check_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!ins.error && ins.data?.id) return ins.data.id;

    throw httpError(500, "JOB_INSERT_FAILED", "No pude crear el job async de PiAPI en la tabla jobs.", {
      supabase: {
        message: ins.error?.message,
        code: ins.error?.code,
        details: ins.error?.details,
        hint: ins.error?.hint,
      },
    });
  }


  /**
   * 👇 PEGAREMOS AQUÍ tu handler /api/ai/video movido desde server.js
   * Cambiando solo: app.post("/api/ai/video"...) -> router.post("/ai/video"...)
   */

  // --- PASTE START ---
  router.post("/ai/video", async (req, res, next) => {
  try {
    const parsed = VideoRequestSchema.parse(req.body);
  const {
      prompt,
      model,
      async: asyncFlag,
      sync,
      aspectRatio,
      resolution,
      durationSeconds,
      count,
      tool,
      nameHint,
      clientJobId,
      firstFrameAssetId,
      lastFrameAssetId,
      referenceImageAssetIds,
      klingMode,
      klingSound,
      negativePrompt,

      // Kling V3 (Fal)
      klingElementIds,
      klingMultiPrompt,
      klingCfgScale,
      klingVoiceIds,
      klingShotType,
    } = parsed;

    // Prioridad: body.async === true => asyncMode true
    //            body.sync  === true => asyncMode false
    //            default => asyncMode true (evita timeouts en Vercel)
    const asyncMode = asyncFlag === true ? true : sync === true ? false : true;

    const envName = String(APP_ENV || NODE_ENV || "").toLowerCase();
    const isProdEnv = envName === "production";
    const allowSync = String(process.env.ALLOW_SYNC_REQUESTS || "").trim() === "1";

    if (!asyncMode && isProdEnv && !allowSync) {
      throw httpError(400, "SYNC_DISABLED", "Modo sync deshabilitado en producción. Usa async=true.");
    }

    // ... resto igual
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // ✅ Requiere plan activo
    const active = await ctx.billing.requireActiveSubscription(user.id);
    if (active.error) return res.status(403).json({ ok: false, error: active.error });

    const toolName = tool || "video-generator";
    const hint = nameHint || "generated-video";

    const hasFirst = Boolean(firstFrameAssetId);
    const hasLast = Boolean(lastFrameAssetId);
const selectedModelRaw = model || "veo-3.1-generate-preview";
const selectedModelStr = String(selectedModelRaw || "").trim();

// En Gemini a veces aparece con prefijo "models/".
// Si llega "models/kling-...", sin esto cae al branch de Veo por error.
let selectedModelNorm = selectedModelStr.replace(/^models\//i, "");

// ✅ HARDENING: aceptar aliases comunes (Fal/otros) y normalizar a lo que Kling API realmente soporta
if (/^kling-v3-0$/i.test(selectedModelNorm) || /^kling-v3\.0$/i.test(selectedModelNorm)) {
  selectedModelNorm = "kling-v3";
}
if (/^kling-v2\.6$/i.test(selectedModelNorm)) {
  selectedModelNorm = "kling-v2-6";
}

const isKling = selectedModelNorm.startsWith("kling-");
const isSeedance = isSeedanceModelId(selectedModelNorm);
const isVeo = isVeoModelId(selectedModelNorm);

    const clientJobIdNorm = clientJobId ? String(clientJobId || "").trim() : "";

    if (hasLast && !hasFirst) {
      throw httpError(
        400,
        "MISSING_FIRST_FRAME",
        "lastFrameAssetId requiere firstFrameAssetId."
      );
    }

    // ✅ Idempotencia: si el frontend reintenta el mismo job (clientJobId),
    // devolvemos el job existente en vez de responder 429.
    if (isKling && asyncMode && clientJobIdNorm) {
      const existing = await findKlingJobByClientJobId({
        ownerId: user.id,
        clientJobId: clientJobIdNorm,
      });

      if (existing?.id) {
        return res.json({
          ok: true,
          mode: "async",
          jobId: existing.id,
          deduped: true,
        });
      }
    }

    if ((isSeedance || isVeo) && asyncMode && clientJobIdNorm) {
      const existing = await findVideoJobByClientJobId({
        ownerId: user.id,
        clientJobId: clientJobIdNorm,
      });

      if (existing?.id) {
        const existingJobToken = existing?.params?.jobToken ? String(existing.params.jobToken) : "";
        return res.json({
          ok: true,
          mode: "async",
          jobId: existing.id,
          deduped: true,
          ...(existingJobToken ? { jobToken: existingJobToken } : {}),
        });
      }
    }

    if (isSeedance) {
      ensureSeedanceEnabled();
    }

    if (asyncMode) {
      const blockedByOwnSlot = await enforceUserVideoSlot(res, user.id, {
        clientJobId: clientJobIdNorm || null,
      });
      if (blockedByOwnSlot) return;
    }

    // ✅ Kling (API oficial): si está al límite (global/per-user), devolvemos 429 con Retry-After
    // ANTES de consumir el rate-limit por usuario.
    if (isKling && asyncMode) {
      const blocked = await enforceKlingParallelLimit(res, user.id);
      if (blocked) return;
    }

    const rl = await checkUserRateLimit({
      userId: user.id,
      scope: "ai_video_generate",
      windowMs: 60 * 1000,
      max: isKling ? 10 : 4,
    });

    if (!rl.ok) {
      const ra = Math.max(1, Number(rl.retryAfterSeconds || 30));
      return res.status(429).set("Retry-After", String(ra)).json({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes de video por usuario. Espera un momento.",
          details: { scope: "ai_video_generate", retryAfterSeconds: ra },
        },
      });
    }

    if (isSeedance) {
      const INPUT_URL_TTL_SECONDS = 60 * 60 * 6;
      const visiblePrompt = normalizeSeedancePrompt(prompt);
      if (!visiblePrompt) {
        throw httpError(400, "SEEDANCE_PROMPT_REQUIRED", "Seedance 2.0 requiere un prompt.");
      }

      const dur = coerceSeedanceDuration(durationSeconds);
      const ar = coerceSeedanceAspectRatio(aspectRatio, "16:9");

      const extraReferenceImageAssetIds = Array.isArray(referenceImageAssetIds)
        ? referenceImageAssetIds.filter(Boolean)
        : [];

      const imageAssetIds = [];
      const pushSeedanceImageId = (assetId) => {
        const id = String(assetId || "").trim();
        if (!id || imageAssetIds.includes(id)) return;
        imageAssetIds.push(id);
      };

      if (firstFrameAssetId) pushSeedanceImageId(firstFrameAssetId);
      if (lastFrameAssetId) pushSeedanceImageId(lastFrameAssetId);
      for (const assetId of extraReferenceImageAssetIds) pushSeedanceImageId(assetId);

      if (imageAssetIds.length > 9) {
        throw httpError(400, "SEEDANCE_REFERENCE_LIMIT", "Seedance 2.0 admite un máximo total de 9 imágenes entre first frame, last frame y refs extra.");
      }

      const imageUrls = [];
      for (const assetId of imageAssetIds) {
        imageUrls.push(await assetIdToSignedUrl(assetId, user.id, INPUT_URL_TTL_SECONDS));
      }

      const providerPrompt = buildSeedanceFramePrompt({
        prompt: visiblePrompt,
        hasFirst: Boolean(firstFrameAssetId),
        hasLast: Boolean(lastFrameAssetId),
      });

      const input = {
        prompt: providerPrompt,
        duration: dur,
        aspect_ratio: ar,
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      };

      const spend = await spendVideoCreditsOrReject({
        userId: user.id,
        req,
        modelNorm: selectedModelNorm,
        durationSeconds: dur,
        resolution: "720p",
        count: 1,
        entryType: "ai_video_generate",
        refType: "ai_video",
        refId: null,
      });

      if (!spend.ok) {
        return res.status(402).json({ ok: false, error: spend.error });
      }

      const webhookConfig = buildPiapiWebhookConfig(req);
      const taskResponse = await createPiapiSeedanceTask({
        taskType: selectedModelNorm,
        input,
        webhookConfig,
      });

      const taskId = extractPiapiTaskId(taskResponse);
      if (!taskId) {
        throw httpError(502, "PIAPI_BAD_RESPONSE", "PiAPI no devolvió task_id.", { response: taskResponse });
      }

      const meta = {
        tool: toolName,
        category: toolName,
        provider: "piapi",
        model: selectedModelNorm,
        aspectRatio: ar,
        durationSeconds: dur,
        firstFrameAssetId: firstFrameAssetId || null,
        lastFrameAssetId: lastFrameAssetId || null,
        referenceImageAssetIds: extraReferenceImageAssetIds,
        piapiTaskId: String(taskId),
        piapiTaskType: selectedModelNorm,
        seedance: {
          mode: imageUrls.length ? (lastFrameAssetId ? "first-last-guided" : "image-to-video") : "text-to-video",
          imageReferenceAssetIds: imageAssetIds,
        },
      };

      const jobId = await upsertPiapiJobRow({
        ownerId: user.id,
        kind: "video",
        taskId: String(taskId),
        taskType: selectedModelNorm,
        toolName,
        hint,
        model: selectedModelNorm,
        prompt: visiblePrompt,
        extra: {
          clientJobId: clientJobIdNorm || null,
          meta,
          aspectRatio: ar,
          durationSeconds: dur,
          firstFrameAssetId: firstFrameAssetId || null,
          lastFrameAssetId: lastFrameAssetId || null,
          providerWebhookEnabled: Boolean(webhookConfig?.endpoint),
          providerWebhookEndpoint: webhookConfig?.endpoint || null,
        },
      });

      return res.json({ ok: true, mode: "async", jobId, taskId: String(taskId) });
    }

    if (isKling) {
      // ✅ KLING V3 PRO via FAL (fal-ai/kling-video/v3/pro/*)
      if (selectedModelNorm === "kling-o3-pro") {
        const hasElements =
          Array.isArray(klingElementIds) && klingElementIds.length > 0;

        // ⚠️ Kling debe poder descargar inputs durante cola/ejecución.
        // Si el job tarda, URLs firmadas muy cortas pueden expirar.
        const INPUT_URL_TTL_SECONDS = 60 * 60 * 6; // 6 horas

        // Duration global 3..15
        let dur = durationSeconds != null ? Number(durationSeconds) : 5;
        dur = Math.trunc(dur);
        if (dur < 3) dur = 3;
        if (dur > 15) dur = 15;

        // O3/Omni: multishot solo soporta shot_type=customize
        const KLING_SHOT_PROMPT_LIMIT = 512;

        const multiIn = Array.isArray(klingMultiPrompt) ? klingMultiPrompt : [];
        let multiPrompt = null;

        if (multiIn.length) {
          if (multiIn.length > 6) {
            throw httpError(
              400,
              "KLING_O3_MULTISHOT_TOO_MANY_SHOTS",
              "Kling O3 Multishot: máximo 6 shots."
            );
          }

          multiPrompt = multiIn.map((s, idx) => {
            const p = String(s?.prompt || "").trim();
            if (!p) {
              throw httpError(
                400,
                "KLING_O3_MULTISHOT_EMPTY_PROMPT",
                `Kling O3 Multishot: el shot ${idx + 1} tiene prompt vacío.`
              );
            }
            if (p.length > KLING_SHOT_PROMPT_LIMIT) {
              throw httpError(
                400,
                "KLING_O3_MULTISHOT_PROMPT_TOO_LONG",
                `Kling O3 Multishot: el prompt del shot ${idx + 1} supera ${KLING_SHOT_PROMPT_LIMIT} caracteres (${p.length}).`
              );
            }

            let sDur =
              s?.durationSeconds != null ? Number(s.durationSeconds) : 1;
            sDur = Math.trunc(sDur);
            if (sDur < 1) sDur = 1;
            if (sDur > 15) sDur = 15;

            return { index: idx + 1, prompt: p, duration: String(sDur) };
          });

          const totalDur = multiPrompt.reduce(
            (acc, s) => acc + Number(s.duration || 0),
            0
          );

          if (totalDur < 3 || totalDur > 15) {
            throw httpError(
              400,
              "KLING_O3_MULTISHOT_DURATION_INVALID",
              "Kling O3 Multishot: la suma de durations debe ser entre 3 y 15 segundos."
            );
          }

          // En O3/Omni, preferimos que duration sea la suma real del storyboard
          dur = totalDur;
        }

        const multiShotEnabled = Boolean(multiPrompt && multiPrompt.length);

        // Elements (custom + presets) → element_list (IDs reales de Kling)
        let elementList = undefined;
        if (hasElements) {
          const maxElems = hasFirst ? 3 : 5;
          elementList = await resolveKlingElementList({
            elementRefs: klingElementIds,
            ownerId: user.id,
            maxCount: maxElems,
            codePrefix: "KLING_O3",
            label: "Kling O3",
          });
        }

        // Image list (first/last frame) via URLs firmadas para no exceder el JSON limit (25mb)
        const imageList = [];
        if (hasFirst) {
          const firstUrl = await assetIdToSignedUrl(
            firstFrameAssetId,
            user.id,
            INPUT_URL_TTL_SECONDS
          );
          imageList.push({ image_url: firstUrl, type: "first_frame" });

          if (hasLast) {
            const lastUrl = await assetIdToSignedUrl(
              lastFrameAssetId,
              user.id,
              INPUT_URL_TTL_SECONDS
            );
            imageList.push({ image_url: lastUrl, type: "end_frame" });
          }
        }

        const klingModeValue = klingMode || "std";

        // Omni: `sound` usa "on" | "off"
        const soundValue =
          klingSound === undefined ? undefined : (Boolean(klingSound) ? "on" : "off");

        const ar = aspectRatio || "16:9";

        // ✅ Kling Omni API (Tasks)
        const omniModelName = resolveKlingOmniModelName(
          process.env.KLING_O3_MODEL_NAME,
          process.env.KLING_OMNI_MODEL_NAME,
          process.env.KLING_V3_OMNI_MODEL_NAME
        );

        const omniPayload = {
          // ⚠️ /videos/omni-video NO acepta `kling-video-o3`.
          // Si el entorno conserva ese alias legacy, lo normalizamos al model_name oficial válido.
          model_name: omniModelName,
          mode: klingModeValue,
          duration: String(dur),
          ...(soundValue !== undefined ? { sound: soundValue } : {}),
          ...(elementList ? { element_list: elementList } : {}),
          ...(imageList.length ? { image_list: imageList } : {}),
          // aspect_ratio es requerido cuando NO usamos first frame y NO editamos video
          ...(!hasFirst ? { aspect_ratio: ar } : {}),
        };

        if (multiShotEnabled) {
          omniPayload.multi_shot = true;
          omniPayload.shot_type = "customize";
          omniPayload.multi_prompt = multiPrompt;
        } else {
          const p = String(prompt || "").trim();
          if (!p) {
            throw httpError(
              400,
              "KLING_O3_PROMPT_REQUIRED",
              "Kling O3: prompt es obligatorio cuando no usas multi_shot."
            );
          }
          omniPayload.prompt = p;
        }

        const spend = await spendVideoCreditsOrReject({
          userId: user.id,
          req,
          modelNorm: selectedModelNorm,
          durationSeconds: dur,
          resolution: klingModeValue === "pro" ? "1080p" : "720p",
          generateAudio: soundValue === "on",
          klingMode: klingModeValue,
          count: 1,
          entryType: "ai_video_generate",
          refType: "ai_video",
          refId: null,
        });

        if (!spend.ok) {
          return res.status(402).json({ ok: false, error: spend.error });
        }

        let taskResponse = null;
        try {
          taskResponse = await klingPostWithRetry(
            "/videos/omni-video",
            omniPayload,
            { timeoutMs: 60_000, retries: 3 }
          );
        } catch (e) {
          const status = Number(e?.status || 0);
          const code = e?.code != null ? Number(e.code) : null;

          // 1303: parallel task over resource pack limit
          if (status === 429 && code === 1303) {
            respondKlingBusy(res, {
              retryAfterSeconds: Number(process.env.KLING_RETRY_AFTER_SECONDS || process.env.KLING_V3_RETRY_AFTER_SECONDS || 30),
              message:
                "Kling rechazó la solicitud por límite de tareas en paralelo (1303). Vamos a reintentar cuando haya cupo.",
              details: { klingCode: code, requestId: e?.requestId || null },
            });
            return;
          }

          throw e;
        }

        const taskId =
          taskResponse?.data?.task_id ||
          taskResponse?.task_id ||
          taskResponse?.data?.taskId ||
          taskResponse?.taskId;

        if (!taskId) {
          throw httpError(502, "KLING_BAD_RESPONSE", "Kling no devolvió task_id.", {
            response: taskResponse,
          });
        }

        const taskType = "omni-video";

        // ✅ Async: devolvemos jobId; el worker hace polling y guarda el video
        if (asyncMode) {
          const meta = {
            tool: toolName,
            provider: "kling",
            model: selectedModelNorm,
            aspectRatio: hasFirst ? null : ar,
            resolution: klingModeValue === "pro" ? "1080p" : "720p",
            durationSeconds: dur,
            firstFrameAssetId: firstFrameAssetId || null,
            lastFrameAssetId: lastFrameAssetId || null,
            klingMode: klingModeValue,
            klingSound: klingSound === undefined ? null : Boolean(klingSound),
            klingTaskId: String(taskId),
            klingTaskType: taskType,
            klingShotType: multiShotEnabled ? "customize" : null,
            klingMultiPrompt: multiPrompt || null,
            klingElementIds: hasElements ? klingElementIds : null,
          };

          const jobId = await upsertKlingJobRow({
            ownerId: user.id,
            kind: "video",
            taskId: String(taskId),
            taskType,
            toolName,
            hint,
            model: selectedModelNorm,
            prompt,
            extra: { meta, clientJobId: clientJobIdNorm || null },
          });

          return res.json({ ok: true, mode: "async", jobId, taskId: String(taskId) });
        }

        // ✅ Sync (solo dev): polling aquí y guardamos asset
        let taskData = null;
        try {
          taskData = await pollTaskUntilDone({
            type: taskType,
            taskId: String(taskId),
            modelName: selectedModelNorm,
            maxWaitMs: 10 * 60 * 1000,
            intervalMs: 2000,
          });
        } catch (err) {
          throw httpError(502, "KLING_TASK_FAILED", err.message || "Kling task failed.", {
            taskId: String(taskId),
            requestId: err?.requestId || null,
          });
        }

        const taskResult = taskData?.task_result || taskData?.data?.task_result || {};
        const firstVideo =
          Array.isArray(taskResult?.videos) && taskResult.videos.length ? taskResult.videos[0] : null;

        const videoUrl =
          firstVideo?.url_with_audio ||
          firstVideo?.urlWithAudio ||
          firstVideo?.url_audio ||
          firstVideo?.urlAudio ||
          firstVideo?.url ||
          taskResult?.video_url ||
          taskResult?.videoUrl ||
          taskResult?.video?.url;

        if (!videoUrl) {
          throw httpError(502, "KLING_NO_VIDEOS", "Kling: tarea completada pero sin videos.", {
            taskId: String(taskId),
            response: taskData,
          });
        }

        const videoResp = await fetch(videoUrl);
        if (!videoResp.ok) {
          throw httpError(
            502,
            "KLING_VIDEO_DOWNLOAD_FAILED",
            `No pude descargar el video de Kling (${videoResp.status}).`
          );
        }

        const mimeType = videoResp.headers.get("content-type") || "video/mp4";
        const bytes = Buffer.from(await videoResp.arrayBuffer());

        const uploaded = await uploadBufferToStorage({
          userId: user.id,
          tool: toolName,
          buffer: bytes,
          mimeType,
          nameHint: hint,
        });

        const storagePath = uploaded.storagePath;

        const meta = {
          tool: toolName,
          provider: "kling",
          model: selectedModelNorm,
          aspectRatio: hasFirst ? null : ar,
          resolution: klingModeValue === "pro" ? "1080p" : "720p",
          durationSeconds: dur,
          firstFrameAssetId: firstFrameAssetId || null,
          lastFrameAssetId: lastFrameAssetId || null,
          klingMode: klingModeValue,
          klingSound: klingSound === undefined ? null : Boolean(klingSound),
          klingTaskId: String(taskId),
          klingTaskType: taskType,
          klingShotType: multiShotEnabled ? "customize" : null,
          klingMultiPrompt: multiPrompt || null,
          klingElementIds: hasElements ? klingElementIds : null,
        };

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "video",
          tool: toolName,
          name: hint,
          prompt,
          storagePath,
          isPublic: false,
          meta,
        });

        const urlExpiresInSeconds = 60 * 60;
        const url = await signStoragePath(storagePath, urlExpiresInSeconds);

        return res.json({
          ok: true,
          items: [{ url, assetId }],
          url,
          assetId,
          urlExpiresInSeconds,
        });
      }

            // ✅ KLING V3 via API oficial (Tasks) — SIN Fal
      if (selectedModelNorm === "kling-v3") {
        const hasElements =
          Array.isArray(klingElementIds) && klingElementIds.length > 0;

        // Duration global 3..15 (Kling V3)
        let dur = durationSeconds != null ? Number(durationSeconds) : 5;
        dur = Math.trunc(dur);
        if (dur < 3) dur = 3;
        if (dur > 15) dur = 15;

        // shot_type: customize | intelligence (aceptamos también "intelligent" por compat)
        const shotTypeRaw = String(klingShotType || "customize").trim().toLowerCase();
        const shotType =
          shotTypeRaw === "intelligence" || shotTypeRaw === "intelligent"
            ? "intelligence"
            : "customize";

        // Multi-shot real:
        // - intelligence: multi_shot=true + shot_type=intelligence, SIN multi_prompt :contentReference[oaicite:5]{index=5}
        // - customize: multi_shot=true + shot_type=customize + multi_prompt[] :contentReference[oaicite:6]{index=6}
        const KLING_V3_SHOT_PROMPT_LIMIT = 512;

        const multiIn = Array.isArray(klingMultiPrompt) ? klingMultiPrompt : [];
        let multiPrompt = null;

        if (shotType === "customize" && multiIn.length) {
          if (multiIn.length > 6) {
            throw httpError(
              400,
              "KLING_V3_MULTISHOT_TOO_MANY_SHOTS",
              "Kling V3 Multishot: máximo 6 shots."
            );
          }

          multiPrompt = multiIn.map((s, idx) => {
            const p = String(s?.prompt || "").trim();
            if (!p) {
              throw httpError(
                400,
                "KLING_V3_MULTISHOT_EMPTY_PROMPT",
                `Kling V3 Multishot: el shot ${idx + 1} tiene prompt vacío.`
              );
            }
            if (p.length > KLING_V3_SHOT_PROMPT_LIMIT) {
              throw httpError(
                400,
                "KLING_V3_MULTISHOT_PROMPT_TOO_LONG",
                `Kling V3 Multishot: el prompt del shot ${idx + 1} supera ${KLING_V3_SHOT_PROMPT_LIMIT} caracteres (${p.length}).`
              );
            }

            let sDur = s?.durationSeconds != null ? Number(s.durationSeconds) : 1;
            sDur = Math.trunc(sDur);
            if (sDur < 1) sDur = 1;
            if (sDur > 15) sDur = 15;

            return { index: idx + 1, prompt: p, duration: String(sDur) };
          });

          const totalDur = multiPrompt.reduce(
            (acc, s) => acc + Number(s.duration || 0),
            0
          );

          // La guía exige: suma == duration global y min por shot >= 1s :contentReference[oaicite:7]{index=7}
          if (totalDur !== dur) {
            throw httpError(
              400,
              "KLING_V3_MULTISHOT_DURATION_MISMATCH",
              `Kling V3 Multishot: la suma de durations (${totalDur}s) debe ser igual a durationSeconds (${dur}s).`
            );
          }

          if (totalDur < 3 || totalDur > 15) {
            throw httpError(
              400,
              "KLING_V3_MULTISHOT_DURATION_INVALID",
              "Kling V3 Multishot: la suma de durations debe ser entre 3 y 15 segundos."
            );
          }
        }

        const multiShotEnabled = shotType === "intelligence" || (multiPrompt && multiPrompt.length);

        // Elements (custom + presets) → element_list real (IDs de Kling)
        let elementList = undefined;
        if (hasElements) {
          const maxElems = hasFirst ? 3 : 5;
          elementList = await resolveKlingElementList({
            elementRefs: klingElementIds,
            ownerId: user.id,
            maxCount: maxElems,
            codePrefix: "KLING_V3",
            label: "Kling V3",
          });
        }

        const klingModeValue = klingMode || "std";

        // Audio (V2.6+): Kling usa `sound: "on" | "off"`
        const soundValue =
          klingSound === undefined ? undefined : (Boolean(klingSound) ? "on" : "off");

        const klingExtras = {
          mode: klingModeValue,
          ...(soundValue !== undefined ? { sound: soundValue } : {}),
          ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
          ...(elementList ? { element_list: elementList } : {}),
        };

        // Normalizamos el nombre de modelo para Kling API (hardening).
        // ✅ Kling API oficial usa "kling-v3" (NO "kling-v3-0").
        const klingApiModelName = selectedModelNorm;

        // ✅ Evita error 1303 (parallel task limit) antes de llamar a Kling
        const blocked = await enforceKlingParallelLimit(res, user.id);
        if (blocked) return;

        // ✅ Spend de créditos ANTES de crear la tarea (idempotente vía x-idempotency-key)
        const spend = await spendVideoCreditsOrReject({
          userId: user.id,
          req,
          modelNorm: selectedModelNorm,
          durationSeconds: dur,
          resolution: klingModeValue === "pro" ? "1080p" : "720p",
          generateAudio: soundValue === "on",
          klingMode: klingModeValue,
          voiceControl: Array.isArray(klingVoiceIds) && klingVoiceIds.length > 0,
          count: 1,
          entryType: "ai_video_generate",
          refType: "ai_video",
          refId: null,
        });

        if (!spend.ok) {
          return res.status(402).json({ ok: false, error: spend.error });
        }

        let taskResponse = null;
        let taskType = "text2video";

        try {
          if (hasFirst) {
            taskType = "image2video";
            const firstPart = await assetIdToInlinePart(firstFrameAssetId, user.id);
            const image = firstPart.inlineData.data;

            let imageTail = undefined;
            if (hasLast) {
              const lastPart = await assetIdToInlinePart(lastFrameAssetId, user.id);
              imageTail = lastPart.inlineData.data;
            }

            const basePayload = {
              model_name: klingApiModelName,
              duration: String(dur),
              image,
              image_tail: imageTail,
              ...klingExtras,
            };

            if (multiShotEnabled) {
              basePayload.multi_shot = true;
              basePayload.shot_type = shotType;

              if (shotType === "customize") {
                basePayload.multi_prompt = multiPrompt;
              } else {
                const p = String(prompt || "").trim();
                if (!p) {
                  throw httpError(
                    400,
                    "KLING_V3_PROMPT_REQUIRED",
                    "Kling: prompt es obligatorio cuando shot_type=intelligence."
                  );
                }
                basePayload.prompt = p;
              }
            } else {
              const p = String(prompt || "").trim();
              if (!p) {
                throw httpError(
                  400,
                  "KLING_V3_PROMPT_REQUIRED",
                  "Kling: prompt es obligatorio cuando no usas multi_shot."
                );
              }
              basePayload.prompt = p;
            }

            taskResponse = await klingPostWithRetry(
              "/videos/image2video",
              basePayload,
              { timeoutMs: 60_000, retries: 3 }
            );
          } else if (hasElements) {
            // ✅ HARDENING: Cuando hay Elements sin first-frame, usamos Omni-Video.
            // Docs: Omni soporta templating `<<element_1>>` y `element_list`. :contentReference[oaicite:5]{index=5} :contentReference[oaicite:6]{index=6}
            taskType = "omni-video";

            const omniModelName = resolveKlingOmniModelName(
              process.env.KLING_V3_OMNI_MODEL_NAME,
              process.env.KLING_OMNI_MODEL_NAME
            );

            const ar = aspectRatio || "16:9";

            const omniPayload = {
              model_name: omniModelName,
              mode: klingModeValue,
              duration: String(dur),
              ...(soundValue !== undefined ? { sound: soundValue } : {}),
              ...(elementList ? { element_list: elementList } : {}),
              aspect_ratio: ar,
            };

            if (multiShotEnabled) {
              // En Omni: multi-shot soporta shot_type=customize (según tu doc consolidado). :contentReference[oaicite:7]{index=7}
              omniPayload.multi_shot = true;
              omniPayload.shot_type = "customize";
              omniPayload.multi_prompt = multiPrompt;
            } else {
              const p = String(prompt || "").trim();
              if (!p) {
                throw httpError(
                  400,
                  "KLING_V3_PROMPT_REQUIRED",
                  "Kling: prompt es obligatorio cuando no usas multi_shot."
                );
              }
              omniPayload.prompt = p;
            }

            taskResponse = await klingPostWithRetry(
              "/videos/omni-video",
              omniPayload,
              { timeoutMs: 60_000, retries: 3 }
            );
          } else {
            const basePayload = {
              model_name: klingApiModelName,
              duration: String(dur),
              aspect_ratio: aspectRatio || "16:9",
              ...klingExtras,
            };

            if (multiShotEnabled) {
              basePayload.multi_shot = true;
              basePayload.shot_type = shotType;

              if (shotType === "customize") {
                basePayload.multi_prompt = multiPrompt;
              } else {
                const p = String(prompt || "").trim();
                if (!p) {
                  throw httpError(
                    400,
                    "KLING_V3_PROMPT_REQUIRED",
                    "Kling: prompt es obligatorio cuando shot_type=intelligence."
                  );
                }
                basePayload.prompt = p;
              }
            } else {
              const p = String(prompt || "").trim();
              if (!p) {
                throw httpError(
                  400,
                  "KLING_V3_PROMPT_REQUIRED",
                  "Kling: prompt es obligatorio cuando no usas multi_shot."
                );
              }
              basePayload.prompt = p;
            }

            taskResponse = await klingPostWithRetry(
              "/videos/text2video",
              basePayload,
              { timeoutMs: 60_000, retries: 3 }
            );
          }
        } catch (e) {
          const status = Number(e?.status || 0);
          const code = e?.code != null ? Number(e.code) : null;

          // 1303: parallel task over resource pack limit
          if (status === 429 && code === 1303) {
            respondKlingBusy(res, {
              retryAfterSeconds: Number(process.env.KLING_RETRY_AFTER_SECONDS || process.env.KLING_V3_RETRY_AFTER_SECONDS || 30),
              message:
                "Kling rechazó la solicitud por límite de tareas en paralelo (1303). Vamos a reintentar cuando haya cupo.",
              details: { klingCode: code, requestId: e?.requestId || null },
            });
            return;
          }

          throw e;
        }

        const taskId =
          taskResponse?.data?.task_id ||
          taskResponse?.task_id ||
          taskResponse?.data?.taskId ||
          taskResponse?.taskId;

        if (!taskId) {
          throw httpError(502, "KLING_BAD_RESPONSE", "Kling no devolvió task_id.", {
            response: taskResponse,
          });
        }

        // ✅ Async: devolvemos jobId; el worker hace polling y guarda el video
        if (asyncMode) {
          const meta = {
            tool: toolName,
            provider: "kling",
            model: selectedModelNorm,
            aspectRatio: hasFirst ? null : (aspectRatio || "16:9"),
            resolution: klingModeValue === "pro" ? "1080p" : "720p",
            durationSeconds: dur,
            firstFrameAssetId: firstFrameAssetId || null,
            lastFrameAssetId: lastFrameAssetId || null,
            klingMode: klingModeValue,
            klingSound: klingSound === undefined ? null : Boolean(klingSound),
            negativePrompt: negativePrompt || null,
            klingTaskId: taskId,
            klingTaskType: taskType,
            klingShotType: multiShotEnabled ? shotType : null,
            klingMultiPrompt: multiPrompt || null,
            klingElementIds: hasElements ? klingElementIds : null,
          };

          const jobId = await upsertKlingJobRow({
            ownerId: user.id,
            kind: "video",
            taskId: String(taskId),
            taskType,
            toolName,
            hint,
            model: selectedModelNorm,
            prompt,
            extra: { meta, clientJobId: clientJobIdNorm || null },
          });

          return res.json({ ok: true, mode: "async", jobId, taskId: String(taskId) });
        }

        // ✅ Sync (solo dev): polling aquí y guardamos asset
        let taskData = null;
        try {
          taskData = await pollTaskUntilDone({
            type: taskType,
            taskId: String(taskId),
            modelName: selectedModelNorm,
            maxWaitMs: 10 * 60 * 1000,
            intervalMs: 2000,
          });
        } catch (err) {
          throw httpError(502, "KLING_TASK_FAILED", err.message || "Kling task failed.", {
            taskId: String(taskId),
            requestId: err?.requestId || null,
          });
        }

        const taskResult = taskData?.task_result || taskData?.data?.task_result || {};
        const firstVideo =
          Array.isArray(taskResult?.videos) && taskResult.videos.length ? taskResult.videos[0] : null;

        const videoUrl =
          firstVideo?.url_with_audio ||
          firstVideo?.urlWithAudio ||
          firstVideo?.url_audio ||
          firstVideo?.urlAudio ||
          firstVideo?.url ||
          taskResult?.video_url ||
          taskResult?.videoUrl ||
          taskResult?.video?.url;

        if (!videoUrl) {
          throw httpError(502, "KLING_NO_VIDEOS", "Kling: tarea completada pero sin videos.", {
            taskId: String(taskId),
            response: taskData,
          });
        }

        const videoResp = await fetch(videoUrl);
        if (!videoResp.ok) {
          throw httpError(
            502,
            "KLING_VIDEO_DOWNLOAD_FAILED",
            `No pude descargar el video de Kling (${videoResp.status}).`
          );
        }

        const mimeType = videoResp.headers.get("content-type") || "video/mp4";
        const bytes = Buffer.from(await videoResp.arrayBuffer());

        const uploaded = await uploadBufferToStorage({
          userId: user.id,
          tool: toolName,
          buffer: bytes,
          mimeType,
          nameHint: hint,
        });

        const storagePath = uploaded.storagePath;

        const meta = {
          tool: toolName,
          provider: "kling",
          model: selectedModelNorm,
          aspectRatio: hasFirst ? null : (aspectRatio || "16:9"),
          resolution: klingModeValue === "pro" ? "1080p" : "720p",
          durationSeconds: dur,
          firstFrameAssetId: firstFrameAssetId || null,
          lastFrameAssetId: lastFrameAssetId || null,
          klingMode: klingModeValue,
          klingSound: klingSound === undefined ? null : Boolean(klingSound),
          negativePrompt: negativePrompt || null,
          klingTaskId: String(taskId),
          klingTaskType: taskType,
          klingShotType: multiShotEnabled ? shotType : null,
          klingMultiPrompt: multiPrompt || null,
          klingElementIds: hasElements ? klingElementIds : null,
        };

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "video",
          tool: toolName,
          name: hint,
          prompt,
          storagePath,
          isPublic: false,
          meta,
        });

        const urlExpiresInSeconds = 60 * 60;
        const url = await signStoragePath(storagePath, urlExpiresInSeconds);

        return res.json({
          ok: true,
          items: [{ url, assetId }],
          url,
          assetId,
          urlExpiresInSeconds,
        });
      }

      // ===============================
      // ✅ Kling v2.6 (API oficial Tasks)
      // - En producción: SIEMPRE async (evita timeouts/rewrite 502 en Vercel)
      // - En dev: puedes forzar sync con { sync: true } y ALLOW_SYNC_REQUESTS=1
      // ===============================

      let klingDuration = durationSeconds != null ? Number(durationSeconds) : 5;
      klingDuration = Math.trunc(klingDuration);

      // Kling 2.6 (en esta UI) solo expone 5s o 10s
      if (![5, 10].includes(klingDuration)) {
        throw httpError(
          400,
          "KLING_DURATION_NOT_SUPPORTED",
          "Kling 2.6 solo acepta durationSeconds de 5 o 10."
        );
      }

      let klingModeValue = klingMode || "std";

      // Audio (v2.6+): `sound: "on" | "off"`
      // Si el usuario pide audio, forzamos mode="pro" (varios gateways lo requieren).
      const supportsSound = selectedModelNorm === "kling-v2-6";
      const enableAudio =
        supportsSound && klingSound !== undefined ? Boolean(klingSound) : undefined;

      if (supportsSound && enableAudio === true && klingModeValue !== "pro") {
        klingModeValue = "pro";
      }

      const soundValue =
        enableAudio === undefined ? undefined : enableAudio ? "on" : "off";

      const klingExtras = {
        mode: klingModeValue,
        ...(soundValue !== undefined ? { sound: soundValue } : {}),
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      };

      // ✅ Spend de créditos ANTES de crear la tarea (idempotente vía x-idempotency-key)
      const spend = await spendVideoCreditsOrReject({
        userId: user.id,
        req,
        modelNorm: selectedModelNorm,
        durationSeconds: klingDuration,
        resolution: klingModeValue === "pro" ? "1080p" : "720p",
        generateAudio: enableAudio === true,
        klingMode: klingModeValue,
        count: 1,
        entryType: "ai_video_generate",
        refType: "ai_video",
        refId: null,
      });

      if (!spend.ok) {
        return res.status(402).json({ ok: false, error: spend.error });
      }

      let taskResponse = null;
      let taskType = "text2video";

      if (hasFirst) {
        taskType = "image2video";
        const firstPart = await assetIdToInlinePart(firstFrameAssetId, user.id);
        const image = firstPart.inlineData.data;
        let imageTail = undefined;

        if (hasLast) {
          const lastPart = await assetIdToInlinePart(lastFrameAssetId, user.id);
          imageTail = lastPart.inlineData.data;
        }

        taskResponse = await createImage2VideoTask({
          model: selectedModelNorm,
          prompt,
          duration: klingDuration,
          image,
          imageTail,
          ...klingExtras,
        });
      } else {
        taskResponse = await createText2VideoTask({
          model: selectedModelNorm,
          prompt,
          duration: klingDuration,
          aspectRatio: aspectRatio || "16:9",
          ...klingExtras,
        });
      }

      const taskId =
        taskResponse?.data?.task_id ||
        taskResponse?.task_id ||
        taskResponse?.data?.taskId ||
        taskResponse?.taskId;

      if (!taskId) {
        throw httpError(502, "KLING_BAD_RESPONSE", "Kling no devolvió task_id.", {
          response: taskResponse,
        });
      }

      // ✅ Async: devolvemos jobId; el worker (public.jobs) hace polling y guarda el video
      if (asyncMode) {
        const meta = {
          tool: toolName,
          provider: "kling",
          model: selectedModelNorm,
          aspectRatio: hasFirst ? null : (aspectRatio || "16:9"),
          resolution: klingModeValue === "pro" ? "1080p" : "720p",
          durationSeconds: klingDuration,
          firstFrameAssetId: firstFrameAssetId || null,
          lastFrameAssetId: lastFrameAssetId || null,
          klingMode: klingModeValue,
          klingSound: enableAudio ?? null,
          negativePrompt: negativePrompt || null,
          klingTaskId: String(taskId),
          klingTaskType: taskType,
        };

        const jobId = await upsertKlingJobRow({
          ownerId: user.id,
          kind: "video",
          taskId: String(taskId),
          taskType,
          toolName,
          hint,
          model: selectedModelNorm,
          prompt,
          extra: { meta, clientJobId: clientJobIdNorm || null },
        });

        return res.json({ ok: true, mode: "async", jobId, taskId: String(taskId) });
      }

      // ✅ Sync (solo dev): polling aquí y guardamos asset
      let taskData = null;
      try {
        taskData = await pollTaskUntilDone({
          type: taskType,
          taskId: String(taskId),
          modelName: selectedModelNorm,
          maxWaitMs: 10 * 60 * 1000,
          intervalMs: 2000,
        });
      } catch (err) {
        throw httpError(502, "KLING_TASK_FAILED", err.message || "Kling task failed.", {
          taskId: String(taskId),
          requestId: err?.requestId || null,
        });
      }

      const taskResult = taskData?.task_result || taskData?.data?.task_result || {};
      const firstVideo =
        Array.isArray(taskResult?.videos) && taskResult.videos.length ? taskResult.videos[0] : null;

      // Kling puede devolver diferentes llaves según el endpoint / versión.
      const videoUrl =
        firstVideo?.url_with_audio ||
        firstVideo?.urlWithAudio ||
        firstVideo?.url_audio ||
        firstVideo?.urlAudio ||
        firstVideo?.url ||
        taskResult?.video_url ||
        taskResult?.videoUrl ||
        taskResult?.video?.url;

      // Para depuración / soporte futuro (algunas respuestas también traen audio separado)
      const audioUrl =
        (Array.isArray(taskResult?.audios) && taskResult.audios.length
          ? taskResult.audios[0]?.url
          : null) ||
        taskResult?.audio_url ||
        taskResult?.audioUrl;

      if (enableAudio) {
        console.log("[Kling v2.6 audio] enableAudio=true", {
          taskId: String(taskId),
          hasVideoUrl: Boolean(videoUrl),
          hasAudioUrl: Boolean(audioUrl),
          videoKeys: firstVideo ? Object.keys(firstVideo) : null,
          taskResultKeys: taskResult ? Object.keys(taskResult) : null,
        });
      }

      if (!videoUrl) {
        throw httpError(502, "KLING_NO_VIDEOS", "Kling: tarea completada pero sin videos.", {
          taskId: String(taskId),
          response: taskData,
        });
      }

      const videoResp = await fetch(videoUrl);
      if (!videoResp.ok) {
        throw httpError(
          502,
          "KLING_VIDEO_DOWNLOAD_FAILED",
          `No pude descargar el video de Kling (${videoResp.status}).`
        );
      }

      const mimeType = videoResp.headers.get("content-type") || "video/mp4";
      const bytes = Buffer.from(await videoResp.arrayBuffer());

      const uploaded = await uploadBufferToStorage({
        userId: user.id,
        tool: toolName,
        buffer: bytes,
        mimeType,
        nameHint: hint,
      });

      const storagePath = uploaded.storagePath;

      const meta = {
        tool: toolName,
        provider: "kling",
        model: selectedModelNorm,
        aspectRatio: hasFirst ? null : (aspectRatio || "16:9"),
        resolution: klingModeValue === "pro" ? "1080p" : "720p",
        durationSeconds: klingDuration,
        firstFrameAssetId: firstFrameAssetId || null,
        lastFrameAssetId: lastFrameAssetId || null,
        klingMode: klingModeValue,
        klingSound: enableAudio ?? null,
        negativePrompt: negativePrompt || null,
        klingTaskId: String(taskId),
        klingTaskType: taskType,
      };

      const assetId = await insertAssetRow({
        ownerId: user.id,
        type: "video",
        tool: toolName,
        name: hint,
        prompt,
        storagePath,
        isPublic: false,
        meta,
      });

      const urlExpiresInSeconds = 60 * 60;
      const url = await signStoragePath(storagePath, urlExpiresInSeconds);

      return res.json({
        ok: true,
        items: [{ url, assetId }],
        url,
        assetId,
        urlExpiresInSeconds,
      });
    }

    // =========================
    // ✅ VEO directo a Google Gemini API (sin Fal)
    // =========================

    await ensureAI();

    // Si usan last frame, forzamos Veo 3.1 (first/last frame es feature de 3.1)
    let veoModel = selectedModelNorm;
    let isVeo31 = veoModel.startsWith("veo-3.1");
    const wantsFast = veoModel.includes("-fast-");
    if (hasLast && !isVeo31) {
      veoModel = wantsFast ? "veo-3.1-fast-generate-preview" : "veo-3.1-generate-preview";
      isVeo31 = true;
    }

    const requestedCount = 1;
    const veoReferenceImageAssetIds = Array.isArray(referenceImageAssetIds)
      ? referenceImageAssetIds.filter(Boolean).slice(0, 3)
      : [];

    if (veoReferenceImageAssetIds.length && (hasFirst || hasLast)) {
      throw httpError(
        400,
        "VEO_REFERENCE_MODE_CONFLICT",
        "Google Veo no admite mezclar referenceImageAssetIds con firstFrame/lastFrame en la misma solicitud."
      );
    }

    if (veoReferenceImageAssetIds.length && !isVeo31) {
      throw httpError(
        400,
        "VEO_REFERENCE_REQUIRES_31",
        "referenceImageAssetIds solo está disponible en Veo 3.1."
      );
    }

    // Aspect ratio (Google Veo 3/3.1 soporta 16:9 o 9:16)
    let ar = aspectRatio || "16:9";
    if (ar === "1:1" || ar === "4:3") ar = "16:9";
    if (ar === "3:4") ar = "9:16";
    // Parche conocido (también existe en el front): veo-3.0 + 1080p + 9:16
    if (veoModel.startsWith("veo-3.0") && !hasFirst && resolution === "1080p" && ar === "9:16") {
      ar = "16:9";
    }

    // Resolution
    let reso = resolution || "720p";
    if (!isVeo31 && reso === "4k") reso = "1080p";

    // Duration (Google usa 4/6/8; 8s obligatorio para 1080p/4k, refs y first/last)
    let dur = durationSeconds != null ? Number(durationSeconds) : 8;
    dur = Math.trunc(dur);
    if (![4, 6, 8].includes(dur)) dur = 8;
    if ((reso && reso !== "720p") || hasFirst || hasLast || veoReferenceImageAssetIds.length) dur = 8;

    let firstImageObj = null;
    let lastImageObj = null;
    let referenceImageObjects = [];

    if (hasFirst) {
      firstImageObj = await assetIdToImageObject(firstFrameAssetId, user.id);
    }
    if (hasLast) {
      lastImageObj = await assetIdToImageObject(lastFrameAssetId, user.id);
    }
    if (veoReferenceImageAssetIds.length) {
      referenceImageObjects = await Promise.all(
        veoReferenceImageAssetIds.map((assetId) => assetIdToImageObject(assetId, user.id))
      );
    }

    const instance = {
      prompt,
      ...(firstImageObj ? { image: buildGoogleInlineImage(firstImageObj) } : {}),
      ...(lastImageObj ? { lastFrame: buildGoogleInlineImage(lastImageObj) } : {}),
      ...(referenceImageObjects.length
        ? {
            referenceImages: referenceImageObjects.map((img) => ({
              image: buildGoogleInlineImage(img),
              referenceType: "asset",
            })),
          }
        : {}),
    };

    const googleParameters = {
      resolution: reso,
      durationSeconds: dur,
      ...(!hasFirst ? { aspectRatio: ar } : {}),
      ...(negativePrompt ? { negativePrompt } : {}),
    };

    if (asyncMode) {
      const submit = await googleVeoStartOperation({
        model: veoModel,
        instance,
        parameters: googleParameters,
      });

      const jobToken = signJobToken({
        uid: user.id,
        provider: "google",
        operationName: submit.operationName,
        toolName,
        hint,
        model: veoModel,
      });

      const jobId = await upsertGoogleVideoJobRow({
        ownerId: user.id,
        kind: "video",
        operationName: submit.operationName,
        jobToken,
        toolName,
        hint,
        model: veoModel,
        prompt,
        extra: {
          clientJobId: clientJobIdNorm || null,
          aspectRatio: hasFirst ? null : ar,
          resolution: reso,
          durationSeconds: dur,
          firstFrameAssetId: firstFrameAssetId || null,
          lastFrameAssetId: lastFrameAssetId || null,
          referenceImageAssetIds: veoReferenceImageAssetIds,
          meta: {
            tool: toolName,
            category: toolName,
            provider: "google",
            model: veoModel,
            aspectRatio: hasFirst ? null : ar,
            resolution: reso,
            durationSeconds: dur,
            count: requestedCount,
            firstFrameAssetId: firstFrameAssetId || null,
            lastFrameAssetId: lastFrameAssetId || null,
            referenceImageAssetIds: veoReferenceImageAssetIds,
            negativePrompt: negativePrompt || null,
            googleOperationName: submit.operationName,
          },
        },
      });

      const spend = await spendVideoCreditsOrReject({
        userId: user.id,
        req,
        modelNorm: veoModel,
        durationSeconds: dur,
        resolution: reso,
        count: requestedCount,
        entryType: "ai_video_generate",
        refType: "job",
        refId: jobId,
      });

      if (!spend.ok) {
        try {
          await supabaseAdmin.from("jobs").delete().eq("id", jobId);
        } catch {}

        return res.status(402).json({ ok: false, error: spend.error });
      }

      return res.json({
        ok: true,
        mode: "async",
        jobToken,
        jobId,
      });
    }

    // ======= SYNC (solo si lo fuerzas con sync=true en dev) =======
    const spend = await spendVideoCreditsOrReject({
      userId: user.id,
      req,
      modelNorm: veoModel,
      durationSeconds: dur,
      resolution: reso,
      count: requestedCount,
      entryType: "ai_video_generate",
      refType: "ai_video",
      refId: null,
    });

    if (!spend.ok) {
      return res.status(402).json({ ok: false, error: spend.error });
    }

    const submit = await googleVeoStartOperation({
      model: veoModel,
      instance,
      parameters: googleParameters,
    });
    const operation = await pollGoogleVeoUntilDone(submit.operationName, {
      timeoutMs: 12 * 60 * 1000,
      intervalMs: 10_000,
    });

    if (operation?.error) {
      throw httpError(502, "GOOGLE_VEO_OPERATION_FAILED", getGoogleOperationErrorMessage(operation, "Google Veo reportó un error."), {
        operationName: submit.operationName,
        response: operation,
      });
    }

    const videoUrl = pickGoogleVideoUrl(operation);
    if (!videoUrl) {
      throw httpError(502, "GOOGLE_VEO_NO_VIDEO", "Google Veo no devolvió video.", {
        operationName: submit.operationName,
        response: operation,
      });
    }

    const urlExpiresInSeconds = 60 * 60;

    const videoResp = await fetch(videoUrl, {
      headers: { "x-goog-api-key": String(process.env.GEMINI_API_KEY || "").trim() },
    });
    if (!videoResp.ok) {
      throw httpError(
        502,
        "GOOGLE_VEO_VIDEO_DOWNLOAD_FAILED",
        `No pude descargar el video de Google Veo (${videoResp.status}).`
      );
    }

    const mimeType = videoResp.headers.get("content-type") || "video/mp4";
    const bytes = Buffer.from(await videoResp.arrayBuffer());

    const uploaded = await uploadBufferToStorage({
      userId: user.id,
      tool: toolName,
      buffer: bytes,
      mimeType,
      nameHint: hint,
    });

    const storagePath = uploaded.storagePath;

    const meta = {
      tool: toolName,
      provider: "google",
      model: veoModel,
      googleOperationName: submit.operationName,
      aspectRatio: hasFirst ? null : ar,
      resolution: reso,
      durationSeconds: dur,
      count: requestedCount,
      firstFrameAssetId: firstFrameAssetId || null,
      lastFrameAssetId: lastFrameAssetId || null,
      referenceImageAssetIds: veoReferenceImageAssetIds,
      negativePrompt: negativePrompt || null,
    };

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "video",
      tool: toolName,
      name: hint,
      prompt,
      storagePath,
      isPublic: false,
      meta,
    });

    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({
      ok: true,
      items: [{ url, assetId }],
      url,
      assetId,
      urlExpiresInSeconds,
    });
  } catch (err) {
    next(err);
  }
});

    // ===============================
    // ===============================
    // KLING O3 (Omni-Video) - Edit / Reference (Kling Tasks) — SIN Fal
    // POST /api/ai/video/edit
    // ===============================
    router.post("/ai/video/edit", async (req, res, next) => {
      try {
        ensureAI();

        const { user, error } = await requireUser(req);
        if (error) return res.status(401).json({ ok: false, error });

        // ✅ Requiere plan activo
        const active = await ctx.billing.requireActiveSubscription(user.id);
        if (active.error) return res.status(403).json({ ok: false, error: active.error });

        const body = VideoEditRequestSchema.parse(req.body);
        const referenceVideoDurationSeconds = coerceReferenceVideoDurationSeconds(body.referenceVideoDurationSeconds);

        const toolName = body.toolName || "video-edit";
        const hint = body.hint || "video-edit";
        const asyncMode = body.async !== false; // default true

        if (!asyncMode) {
          throw httpError(
            400,
            "VIDEO_EDIT_ASYNC_REQUIRED",
            "Video Edit requiere modo async (Kling Tasks)."
          );
        }

        const blockedByOwnSlot = await enforceUserVideoSlot(res, user.id);
        if (blockedByOwnSlot) return;

        // ⚠️ Kling debe poder descargar inputs durante cola/ejecución.
        const INPUT_URL_TTL_SECONDS = 60 * 60 * 6; // 6 horas

        const model = body.model;
        let kind = null;

        if (model === "kling-o3-ref-to-video-pro") {
          kind = "reference-to-video";
        } else if (model === "kling-o3-edit-video-pro") {
          kind = "video-to-video/edit";
        } else if (model === "kling-o3-ref-video-to-video-pro") {
          kind = "video-to-video/reference";
        } else {
          throw httpError(400, "VIDEO_EDIT_MODEL_INVALID", "Modelo inválido.");
        }

        const promptRaw = String(body.prompt || "").trim();

        // ✅ Límite de referencias combinadas por modelo (imágenes + Elements)
        // - reference-to-video: 1..7
        // - video-to-video:     0..4
        const MAX_COMBINED_REFS = kind === "reference-to-video" ? 7 : 4;

        // ✅ START/END legacy no se soporta aquí (Omni usa image_list; este tool usa "ingredientes").
        const startLegacy = body.startImageAssetId || null;
        const endLegacy = body.endImageAssetId || null;
        if (kind === "reference-to-video" && (startLegacy || endLegacy)) {
          throw httpError(
            400,
            "VIDEO_EDIT_FRAMES_NOT_SUPPORTED",
            "Este modelo no soporta first/last frame (START/END). Elimina START/END y usa solo ingredientes (imágenes de referencia + Elements).",
            { startImageAssetId: startLegacy, endImageAssetId: endLegacy }
          );
        }

        // Multi-shot (solo en reference-to-video)
        const KLING_SHOT_PROMPT_LIMIT = 512;
        const multiRaw =
          Array.isArray(body.klingMultiPrompt) && body.klingMultiPrompt.length
            ? body.klingMultiPrompt
            : null;

        if (multiRaw && kind !== "reference-to-video") {
          throw httpError(
            400,
            "VIDEO_EDIT_MULTISHOT_NOT_SUPPORTED",
            "Multishot solo está disponible en Ingredientes → Video."
          );
        }

        if (kind === "reference-to-video") {
          if (!promptRaw && !multiRaw) {
            throw httpError(
              400,
              "VIDEO_EDIT_PROMPT_REQUIRED",
              "Debes escribir un prompt (o configurar multishot)."
            );
          }
          if (promptRaw && multiRaw) {
            throw httpError(
              400,
              "VIDEO_EDIT_PROMPT_CONFLICT",
              "Usa prompt o multishot, pero no ambos a la vez."
            );
          }
        } else {
          if (!promptRaw) {
            throw httpError(
              400,
              "VIDEO_EDIT_PROMPT_REQUIRED",
              "Debes escribir un prompt para editar tu video."
            );
          }
        }

        // Refs (imágenes) -> Omni: image_list (URLs firmadas)
        const referenceImageAssetIds = Array.isArray(body.referenceImageAssetIds)
          ? body.referenceImageAssetIds.filter(Boolean).slice(0, MAX_COMBINED_REFS)
          : [];

        const imageList = [];
        for (const assetId of referenceImageAssetIds) {
          const signed = await assetIdToSignedUrl(
            assetId,
            user.id,
            INPUT_URL_TTL_SECONDS
          );
          imageList.push({ image_url: signed });
        }

        // Elements (kling_elements en tu DB) -> Omni: element_list (IDs reales de Kling)
        const klingElementIds = Array.isArray(body.klingElementIds)
          ? body.klingElementIds.filter(Boolean).slice(0, MAX_COMBINED_REFS)
          : [];

        // ✅ Para reference-to-video exigimos al menos 1 ingrediente visual
        if (kind === "reference-to-video" && imageList.length + klingElementIds.length < 1) {
          throw httpError(
            400,
            "VIDEO_EDIT_MISSING_REFS",
            `Este modelo requiere entre 1 y ${MAX_COMBINED_REFS} referencias (imágenes + Elements).`,
            { refCount: imageList.length, elementCount: klingElementIds.length }
          );
        }

        let elementList = undefined;
        if (klingElementIds.length) {
          elementList = await resolveKlingElementList({
            elementRefs: klingElementIds,
            ownerId: user.id,
            maxCount: MAX_COMBINED_REFS,
            codePrefix: "VIDEO_EDIT",
            label: "Kling",
          });
        }

        // Kling: máximo MAX_COMBINED_REFS referencias combinadas (element_list + image_list)
        const elementCount = Array.isArray(elementList) ? elementList.length : 0;
        const refCount = imageList.length;
        if (refCount + elementCount > MAX_COMBINED_REFS) {
          throw httpError(
            400,
            "VIDEO_EDIT_TOO_MANY_REFS",
            `Kling permite máximo ${MAX_COMBINED_REFS} referencias combinadas (Elements + imágenes). Reduce tu selección.`,
            { refCount, elementCount }
          );
        }

        // Duración y aspect ratio (si aplica)
        let dur = body.durationSeconds != null ? Number(body.durationSeconds) : 5;
        dur = Math.trunc(dur);
        if (dur < 3) dur = 3;
        if (dur > 15) dur = 15;

        // Reference-to-video no soporta "auto"
        const arRaw = String(body.aspectRatio || "").trim();
        const arAllowed = ["16:9", "9:16", "1:1", "auto"];
        const ar0 = arAllowed.includes(arRaw) ? arRaw : null;
        const ar =
          kind === "reference-to-video"
            ? ar0 === "auto" || !ar0
              ? "16:9"
              : ar0
            : ar0 || "auto";

        // Multi-shot: normalizamos y validamos suma total (1..15 por shot, 3..15 total)
        let multiPrompt = null;
        let totalDur = dur;

        if (multiRaw && multiRaw.length) {
          if (multiRaw.length > 6) {
            throw httpError(
              400,
              "VIDEO_EDIT_MULTISHOT_TOO_MANY_SHOTS",
              "Multishot: máximo 6 shots."
            );
          }

          multiPrompt = multiRaw.map((s, idx) => {
            const p = String(s?.prompt || "").trim();
            if (!p) {
              throw httpError(
                400,
                "VIDEO_EDIT_MULTISHOT_EMPTY",
                `Multishot: el shot ${idx + 1} está vacío.`
              );
            }
            if (p.length > KLING_SHOT_PROMPT_LIMIT) {
              throw httpError(
                400,
                "VIDEO_EDIT_MULTISHOT_PROMPT_TOO_LONG",
                `Multishot: el prompt del shot ${idx + 1} supera ${KLING_SHOT_PROMPT_LIMIT} caracteres (${p.length}).`
              );
            }

            let sDur = s?.durationSeconds != null ? Number(s.durationSeconds) : 1;
            sDur = Math.trunc(sDur);
            if (sDur < 1) sDur = 1;
            if (sDur > 15) sDur = 15;

            return { index: idx + 1, prompt: p, duration: String(sDur) };
          });

          if (multiPrompt.length < 2) {
            throw httpError(
              400,
              "VIDEO_EDIT_MULTISHOT_TOO_FEW",
              "Multishot requiere mínimo 2 shots."
            );
          }

          totalDur = multiPrompt.reduce((acc, s) => acc + Number(s.duration || 0), 0);
          if (totalDur < 3 || totalDur > 15) {
            throw httpError(
              400,
              "VIDEO_EDIT_MULTISHOT_DURATION_INVALID",
              "Multishot: la suma total debe estar entre 3s y 15s."
            );
          }
        }

        // ✅ Construimos payload para Omni-Video
        const modelName = resolveKlingOmniModelName(
          process.env.KLING_OMNI_MODEL_NAME,
          process.env.KLING_V3_OMNI_MODEL_NAME
        );
        const omniPayload = {
          model_name: modelName,
          ...(imageList.length ? { image_list: imageList } : {}),
          ...(elementList ? { element_list: elementList } : {}),
        };

        // NOTE: este tool se llama "Pro" (calidad). Si quieres std por costo, cambia a "std".
        omniPayload.mode = "pro";

        if (kind === "reference-to-video") {
          omniPayload.duration = String(totalDur);
          omniPayload.aspect_ratio = ar;

          // Audio en Omni: sound "on"/"off"
          omniPayload.sound = body.generateAudio === true ? "on" : "off";

          if (multiPrompt && multiPrompt.length) {
            omniPayload.multi_shot = true;
            omniPayload.shot_type = "customize";
            omniPayload.multi_prompt = multiPrompt;
          } else {
            omniPayload.prompt = promptRaw;
          }
        }

        if (kind === "video-to-video/edit") {
          if (!body.videoAssetId) {
            throw httpError(
              400,
              "VIDEO_EDIT_VIDEO_REQUIRED",
              "Debes seleccionar un video de referencia."
            );
          }

          const videoUrl = await assetIdToSignedUrl(
            body.videoAssetId,
            user.id,
            INPUT_URL_TTL_SECONDS
          );

          // En Omni: si hay video_list, sound SOLO puede ser "off"
          omniPayload.sound = "off";
          omniPayload.prompt = promptRaw;
          omniPayload.video_list = [
            {
              video_url: videoUrl,
              refer_type: "base",
              keep_original_sound: body.keepAudio !== false ? "yes" : "no",
            },
          ];
        }

        if (kind === "video-to-video/reference") {
          if (!body.videoAssetId) {
            throw httpError(
              400,
              "VIDEO_EDIT_VIDEO_REQUIRED",
              "Debes seleccionar un video de referencia."
            );
          }

          const videoUrl = await assetIdToSignedUrl(
            body.videoAssetId,
            user.id,
            INPUT_URL_TTL_SECONDS
          );

          // En Omni: si hay video_list, sound SOLO puede ser "off"
          omniPayload.sound = "off";
          omniPayload.prompt = promptRaw;
          omniPayload.duration = String(dur);
          // Si el cliente manda "auto", Kling puede rechazar; forzamos un valor estable.
          omniPayload.aspect_ratio = ar === "auto" ? "16:9" : ar;

          omniPayload.video_list = [
            {
              video_url: videoUrl,
              refer_type: "feature",
              keep_original_sound: body.keepAudio !== false ? "yes" : "no",
            },
          ];
        }

        // ✅ Evita error 1303 (parallel task limit) antes de cobrar/llamar a Kling
        const blocked = await enforceKlingParallelLimit(res, user.id);
        if (blocked) return;

        const rl = await checkUserRateLimit({
          userId: user.id,
          scope: "ai_video_edit",
          windowMs: 60 * 1000,
          max: 4,
        });
        if (!rl.ok) {
          return res.status(429).json({
            ok: false,
            error: {
              code: "RATE_LIMITED",
              message: "Demasiadas ediciones de video por usuario. Espera un momento.",
              details: { scope: "ai_video_edit_user", retryAfterSeconds: rl.retryAfterSeconds },
            },
          });
        }

        // ✅ Spend de créditos ANTES de crear la tarea (idempotente vía x-idempotency-key)
        const pricingDurationSeconds =
          kind === "reference-to-video"
            ? totalDur
            : referenceVideoDurationSeconds || dur;

        const costCredits = estimateVideoCostCredits({
          modelNorm: model,
          durationSeconds: pricingDurationSeconds,
          resolution: "1080p",
          generateAudio: kind === "reference-to-video" ? body.generateAudio === true : false,
          klingMode: "pro",
        });

        const spend = await ctx.billing.spendCredits({
          userId: user.id,
          amountCredits: costCredits,
          entryType: "ai_video_edit",
          refType: "ai_video",
          refId: null,
          idempotencyKey: ctx.billing.getIdempotencyKey(req),
        });

        if (!spend.ok) {
          return res.status(402).json({ ok: false, error: spend.error });
        }

        let taskResponse = null;
        try {
          taskResponse = await klingPostWithRetry(
            "/videos/omni-video",
            omniPayload,
            { timeoutMs: 60_000, retries: 3 }
          );
        } catch (e) {
          const status = Number(e?.status || 0);
          const code = e?.code != null ? Number(e.code) : null;

          // 1303: parallel task over resource pack limit
          if (status === 429 && code === 1303) {
            respondKlingBusy(res, {
              retryAfterSeconds: Number(process.env.KLING_RETRY_AFTER_SECONDS || process.env.KLING_V3_RETRY_AFTER_SECONDS || 30),
              message:
                "Kling rechazó la solicitud por límite de tareas en paralelo (1303). Reintenta en unos segundos.",
              details: { klingCode: code, requestId: e?.requestId || null },
            });
            return;
          }

          throw e;
        }

        const taskId =
          taskResponse?.data?.task_id ||
          taskResponse?.task_id ||
          taskResponse?.data?.taskId ||
          taskResponse?.taskId;

        if (!taskId) {
          throw httpError(502, "KLING_BAD_RESPONSE", "Kling no devolvió task_id.", {
            response: taskResponse,
          });
        }

        const taskType = "omni-video";

        const savedPrompt =
          multiPrompt && multiPrompt.length
            ? multiPrompt.map((s, i) => `Shot ${i + 1}: ${s.prompt}`).join(" | ")
            : promptRaw;

        const meta = {
          tool: toolName,
          provider: "kling",
          model,
          klingTaskId: String(taskId),
          klingTaskType: taskType,
          editVideo: {
            kind,
            model,
            prompt: savedPrompt,
            promptRaw: promptRaw || null,
            multiPrompt: multiPrompt
              ? multiPrompt.map((s) => ({ index: s.index, prompt: s.prompt, duration: s.duration }))
              : null,
            videoAssetId: body.videoAssetId || null,
            referenceImageAssetIds,
            klingElementIds,
            keepAudio: kind.startsWith("video-to-video")
              ? body.keepAudio !== false
              : null,
            generateAudio:
              kind === "reference-to-video" ? body.generateAudio === true : null,
            durationSeconds: kind === "video-to-video/edit" ? null : (kind === "reference-to-video" ? totalDur : dur),
            referenceVideoDurationSeconds: kind.startsWith("video-to-video") ? referenceVideoDurationSeconds : null,
            pricingDurationSeconds,
            aspectRatio: kind === "video-to-video/edit" ? null : (kind === "reference-to-video" ? ar : omniPayload.aspect_ratio),
          },
        };

        const jobId = await upsertKlingJobRow({
          ownerId: user.id,
          kind: "video",
          taskId: String(taskId),
          taskType,
          toolName,
          hint,
          model,
          prompt: savedPrompt,
          extra: { meta },
        });

        return res.json({ ok: true, mode: "async", jobId, taskId: String(taskId) });
      } catch (err) {
        next(err);
      }
    });



    router.post("/ai/video/piapi/webhook", async (req, res) => {
      try {
        const providedSecret = String(req.get("x-webhook-secret") || "").trim();
        if (PIAPI_WEBHOOK_SECRET && providedSecret !== PIAPI_WEBHOOK_SECRET) {
          return res.status(401).json({ ok: false, error: { code: "PIAPI_WEBHOOK_FORBIDDEN", message: "Firma de webhook inválida." } });
        }

        const payload = req.body || {};
        const taskId = String(extractPiapiTaskId(payload) || "").trim();
        if (!taskId) return res.status(202).json({ ok: true, ignored: true });

        const taskData = extractPiapiTaskData(payload);
        const taskStatusRaw = extractPiapiTaskStatus(taskData, payload);
        const taskStatus = normalizePiapiTaskStatus(taskStatusRaw);
        const nowIso = new Date().toISOString();

        const lookup = await supabaseAdmin
          .from("jobs")
          .select("id, owner_id, status, params, result_asset_id, error")
          .eq("kind", "video")
          .contains("params", { provider: "piapi", taskId })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lookup.error && lookup.error.code !== "PGRST116") {
          console.error("[piapiWebhook][lookup_error]", lookup.error);
          return res.status(202).json({ ok: true, queued: false });
        }

        const row = lookup.data || null;
        if (!row || row.status === "succeeded" || row.status === "failed" || row.status === "canceled") {
          return res.json({ ok: true, ignored: true });
        }

        const nextParams = {
          ...(row.params || {}),
          providerStatus: taskStatusRaw || taskStatus || null,
          providerStatusNormalized: taskStatus || null,
          providerStatusMsg: extractPiapiTaskErrorMessage(taskData, payload, "") || null,
          providerWebhookSeenAt: nowIso,
          providerWebhookTimestamp: payload?.timestamp || null,
        };

        let patch = {
          params: nextParams,
          next_check_at: isPiapiSuccessStatus(taskStatus) || isPiapiFailureStatus(taskStatus)
            ? nowIso
            : new Date(Date.now() + computeNextCheckMsPiapi(taskStatus)).toISOString(),
          locked_at: null,
          locked_by: null,
        };

        if (isPiapiFailureStatus(taskStatus)) {
          patch = {
            ...patch,
            status: "failed",
            error: extractPiapiTaskErrorMessage(taskData, payload, "PiAPI task failed."),
            finished_at: nowIso,
            next_check_at: null,
          };
        }

        if (isPiapiSuccessStatus(taskStatus) && !row.result_asset_id) {
          const videoUrl = pickPiapiVideoUrl(payload);
          if (videoUrl) {
            try {
              const existingAsset = await findExistingPiapiAssetByTaskId({ ownerId: row.owner_id, taskId });
              if (existingAsset?.id) {
                patch = {
                  ...patch,
                  status: "succeeded",
                  error: null,
                  finished_at: nowIso,
                  next_check_at: null,
                  result_asset_id: existingAsset.id,
                  params: {
                    ...nextParams,
                    providerVideoUrl: videoUrl,
                    providerWebhookFinalizedAt: nowIso,
                    providerFinalizePath: "piapi-webhook-reused-asset",
                    providerRecoveredAssetId: existingAsset.id,
                  },
                };
              } else {
                const { buffer, mimeType } = await downloadPiapiVideoToBuffer(videoUrl);
                const toolName = row?.params?.toolName || row?.params?.meta?.tool || "video";
                const hint = row?.params?.hint || taskId || `seedance_${Date.now()}`;
                const prompt = row?.params?.prompt || null;

                const uploaded = await uploadBufferToStorage({
                  userId: row.owner_id,
                  tool: toolName,
                  buffer,
                  mimeType,
                  nameHint: hint,
                });

                const storagePath = uploaded.storagePath;
                const assetMeta = {
                  ...(row?.params?.meta || {}),
                  tool: toolName,
                  category: toolName,
                  provider: "piapi",
                  model: row?.params?.model || row?.params?.taskType || null,
                  piapiTaskId: taskId,
                  piapiTaskType: row?.params?.taskType || row?.params?.piapiTaskType || null,
                  providerStatus: taskStatusRaw || "completed",
                  providerVideoUrl: videoUrl,
                  finalizedBy: "piapi-webhook",
                };

                const assetId = await insertAssetRow({
                  ownerId: row.owner_id,
                  type: "video",
                  tool: toolName,
                  name: hint,
                  prompt,
                  storagePath,
                  isPublic: false,
                  meta: assetMeta,
                });

                let signedUrl = null;
                try {
                  signedUrl = await signStoragePath(storagePath, 60 * 30);
                } catch {
                  signedUrl = null;
                }

                patch = {
                  ...patch,
                  status: "succeeded",
                  error: null,
                  finished_at: nowIso,
                  next_check_at: null,
                  result_asset_id: assetId,
                  params: {
                    ...nextParams,
                    providerVideoUrl: videoUrl,
                    providerWebhookFinalizedAt: nowIso,
                    providerFinalizePath: "piapi-webhook",
                    ...(signedUrl ? { resultUrl: signedUrl } : {}),
                  },
                };
              }
            } catch (finalizeError) {
              console.error("[piapiWebhook][finalize_error]", finalizeError?.message || finalizeError);
              patch = {
                ...patch,
                params: {
                  ...nextParams,
                  providerWebhookFinalizeError: String(finalizeError?.message || finalizeError),
                },
                next_check_at: nowIso,
              };
            }
          }
        }

        const upd = await supabaseAdmin.from("jobs").update(patch).eq("id", row.id);
        if (upd.error) {
          console.error("[piapiWebhook][update_error]", upd.error);
        }

        return res.json({ ok: true });
      } catch (error) {
        console.error("[piapiWebhook][unhandled]", error?.message || error);
        return res.status(202).json({ ok: true, queued: false });
      }
    });

    const SeedanceVideoEditRequestSchema = z.object({
      model: z.enum(["seedance-2-preview", "seedance-2-fast-preview"]),
      prompt: z.string().max(14000).optional(),
      videoAssetId: z.string().uuid().optional(),
      referenceImageAssetIds: z.array(z.string().uuid()).max(9).optional(),
      durationSeconds: z.coerce.number().optional(),
      referenceVideoDurationSeconds: z.coerce.number().optional(),
      aspectRatio: z.enum(["auto", "16:9", "9:16", "1:1", "4:3", "3:4"]).optional(),
      toolName: z.string().optional(),
      hint: z.string().optional(),
      async: z.boolean().optional(),
    });

    router.post("/ai/video/seedance-edit", async (req, res, next) => {
      try {
        ensureAI();

        const { user, error } = await requireUser(req);
        if (error) return res.status(401).json({ ok: false, error });

        const active = await ctx.billing.requireActiveSubscription(user.id);
        if (active.error) return res.status(403).json({ ok: false, error: active.error });

        ensureSeedanceEnabled();

        const body = SeedanceVideoEditRequestSchema.parse(req.body || {});
        const blockedByOwnSlot = await enforceUserVideoSlot(res, user.id);
        if (blockedByOwnSlot) return;

        const visiblePrompt = normalizeSeedancePrompt(body.prompt);
        if (!visiblePrompt) {
          throw httpError(400, "SEEDANCE_PROMPT_REQUIRED", "Seedance 2.0 requiere un prompt.");
        }

        const toolName = body.toolName || "video-edit";
        const hint = body.hint || `seedance_${Date.now()}`;
        const INPUT_URL_TTL_SECONDS = 60 * 60 * 6;
        const referenceImageAssetIds = Array.isArray(body.referenceImageAssetIds) ? body.referenceImageAssetIds : [];
        const referenceImageUrls = [];
        for (const assetId of referenceImageAssetIds) {
          referenceImageUrls.push(await assetIdToSignedUrl(assetId, user.id, INPUT_URL_TTL_SECONDS));
        }

        let input = null;
        let pricingDurationSeconds = coerceSeedanceDuration(body.durationSeconds);
        let mode = "text-to-video";
        let parentTaskId = null;

        if (toolName === "extend-video") {
          if (!body.videoAssetId) {
            throw httpError(400, "SEEDANCE_EXTEND_VIDEO_REQUIRED", "Selecciona un video generado previamente con Seedance para extenderlo.");
          }

          const sourceAsset = await getOwnedAssetById(body.videoAssetId, user.id);
          const sourceMeta = sourceAsset?.meta || {};
          parentTaskId = sourceMeta?.piapiTaskId || sourceMeta?.seedance?.piapiTaskId || sourceMeta?.seedanceTaskId || null;

          if (!parentTaskId) {
            throw httpError(400, "SEEDANCE_EXTEND_PARENT_TASK_REQUIRED", "Seedance Extend necesita un video generado previamente con Seedance dentro de Tales para reutilizar el parent_task_id.");
          }

          pricingDurationSeconds = coerceSeedanceDuration(body.durationSeconds);
          mode = "extend-video";
          input = {
            prompt: visiblePrompt,
            parent_task_id: String(parentTaskId),
            duration: pricingDurationSeconds,
            aspect_ratio: coerceSeedanceAspectRatio(body.aspectRatio, "16:9"),
          };
        } else if (body.videoAssetId) {
          const videoUrl = await assetIdToSignedUrl(body.videoAssetId, user.id, INPUT_URL_TTL_SECONDS);
          pricingDurationSeconds = coerceReferenceVideoDurationSeconds(body.referenceVideoDurationSeconds) || 5;
          mode = referenceImageUrls.length ? "video-edit-with-image" : "video-edit";
          input = {
            prompt: visiblePrompt,
            video_urls: [videoUrl],
            ...(referenceImageUrls.length ? { image_urls: referenceImageUrls } : {}),
            aspect_ratio: coerceSeedanceAspectRatio(body.aspectRatio, "16:9"),
          };
        } else {
          if (!referenceImageUrls.length) {
            throw httpError(400, "SEEDANCE_REFERENCE_REQUIRED", "Agrega al menos una imagen de referencia o un video base para esta herramienta de Seedance.");
          }

          pricingDurationSeconds = coerceSeedanceDuration(body.durationSeconds);
          mode = "image-to-video";
          input = {
            prompt: visiblePrompt,
            image_urls: referenceImageUrls,
            duration: pricingDurationSeconds,
            aspect_ratio: coerceSeedanceAspectRatio(body.aspectRatio, "16:9"),
          };
        }

        const spend = await ctx.billing.spendCredits({
          userId: user.id,
          amountCredits: estimateVideoCostCredits({
            modelNorm: body.model,
            durationSeconds: pricingDurationSeconds,
            resolution: "720p",
          }),
          entryType: "ai_video_edit",
          refType: "ai_video",
          refId: null,
          idempotencyKey: ctx.billing.getIdempotencyKey(req),
        });

        if (!spend.ok) {
          return res.status(402).json({ ok: false, error: spend.error });
        }

        const webhookConfig = buildPiapiWebhookConfig(req);
        const taskResponse = await createPiapiSeedanceTask({
          taskType: body.model,
          input,
          webhookConfig,
        });

        const taskId = extractPiapiTaskId(taskResponse);
        if (!taskId) {
          throw httpError(502, "PIAPI_BAD_RESPONSE", "PiAPI no devolvió task_id.", { response: taskResponse });
        }

        const meta = {
          tool: toolName,
          category: toolName,
          provider: "piapi",
          model: body.model,
          piapiTaskId: String(taskId),
          piapiTaskType: body.model,
          seedance: {
            mode,
            parentTaskId: parentTaskId ? String(parentTaskId) : null,
            videoAssetId: body.videoAssetId || null,
            referenceImageAssetIds,
            durationSeconds: pricingDurationSeconds,
            aspectRatio: coerceSeedanceAspectRatio(body.aspectRatio, "16:9"),
          },
          editVideo: {
            kind: mode,
            model: body.model,
            prompt: visiblePrompt,
            videoAssetId: body.videoAssetId || null,
            referenceImageAssetIds,
            durationSeconds: pricingDurationSeconds,
            aspectRatio: coerceSeedanceAspectRatio(body.aspectRatio, "16:9"),
          },
        };

        const jobId = await upsertPiapiJobRow({
          ownerId: user.id,
          kind: "video",
          taskId: String(taskId),
          taskType: body.model,
          toolName,
          hint,
          model: body.model,
          prompt: visiblePrompt,
          extra: {
            meta,
            durationSeconds: pricingDurationSeconds,
            aspectRatio: coerceSeedanceAspectRatio(body.aspectRatio, "16:9"),
            videoAssetId: body.videoAssetId || null,
            referenceImageAssetIds,
            parentTaskId: parentTaskId ? String(parentTaskId) : null,
            providerWebhookEnabled: Boolean(webhookConfig?.endpoint),
            providerWebhookEndpoint: webhookConfig?.endpoint || null,
          },
        });

        return res.json({ ok: true, mode: "async", jobId, taskId: String(taskId) });
      } catch (err) {
        next(err);
      }
    });


  // --- PASTE END ---
  // ===============================
  // KLING Motion Control (2.6 + V3 direct)
  // ===============================
  router.post("/ai/video/motion-control", async (req, res, next) => {
    try {
      ensureAI();

      const { user, error } = await requireUser(req);
      if (error) return res.status(401).json({ ok: false, error });

      const body = MotionControlRequestSchema.parse(req.body);
      const characterOrientation = body.characterOrientation === "image" ? "image" : "video";

      let sourceVideoAsset = null;
      let referenceVideoDurationSeconds = coerceReferenceVideoDurationSeconds(body.referenceVideoDurationSeconds);
      if (!referenceVideoDurationSeconds) {
        sourceVideoAsset = await getOwnedAssetById(body.videoAssetId, user.id);
        if (sourceVideoAsset?.type !== "video") {
          throw httpError(404, "ASSET_NOT_FOUND", "No encontré el video de referencia indicado.");
        }
        referenceVideoDurationSeconds = readAssetDurationSeconds(sourceVideoAsset);
      }

      const motionDurationError = getMotionControlReferenceVideoDurationError(
        referenceVideoDurationSeconds,
        characterOrientation
      );
      if (motionDurationError) {
        throw httpError(400, "INVALID_REFERENCE_VIDEO_DURATION", motionDurationError, {
          characterOrientation,
          referenceVideoDurationSeconds,
          maxAllowedSeconds: getMotionControlReferenceVideoLimitSeconds(characterOrientation),
          minAllowedSeconds: 3,
        });
      }

      // ✅ Requiere plan activo
      const active = await ctx.billing.requireActiveSubscription(user.id);
      if (active.error) return res.status(403).json({ ok: false, error: active.error });

      const asyncMode = body.async !== false;
      const clientJobIdNorm = body.clientJobId ? String(body.clientJobId || "").trim() : "";
      const requestedModel =
        body.model === "kling-v3-motion-control" ? "kling-v3-motion-control" : "kling-2.6-motion-control";

      if (asyncMode && clientJobIdNorm) {
        const existing = await findVideoJobByClientJobId({
          ownerId: user.id,
          clientJobId: clientJobIdNorm,
        });

        if (existing?.id) {
          const existingTaskId = existing?.params?.requestId || existing?.params?.taskId || null;
          return res.json({
            ok: true,
            mode: "async",
            jobId: existing.id,
            deduped: true,
            ...(existingTaskId ? { taskId: String(existingTaskId) } : {}),
          });
        }
      }

      if (asyncMode) {
        const blockedByOwnSlot = await enforceUserVideoSlot(res, user.id, {
          clientJobId: clientJobIdNorm || null,
        });
        if (blockedByOwnSlot) return;

        const blocked = await enforceKlingParallelLimit(res, user.id);
        if (blocked) return;
      }

      const rl = await checkUserRateLimit({
        userId: user.id,
        scope: "ai_motion_control",
        windowMs: 60 * 1000,
        max: 4,
      });
      if (!rl.ok) {
        return res.status(429).json({
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Demasiadas solicitudes motion-control por usuario. Espera un momento.",
            details: { scope: "ai_motion_control_user", retryAfterSeconds: rl.retryAfterSeconds },
          },
        });
      }

      // ✅ Spend de créditos ANTES de encolar motion-control
      // El pricing ahora sigue la duración real del video de referencia cargado.
      const mode = body.mode === "pro" ? "pro" : "std";
      const pricingModelNorm =
        requestedModel === "kling-v3-motion-control"
          ? mode === "pro"
            ? "kling-v3-motion-control-pro"
            : "kling-v3-motion-control"
          : mode === "pro"
            ? "kling-2.6-motion-control-pro"
            : "kling-2.6-motion-control";
      const pricingDurationSeconds = referenceVideoDurationSeconds || 5;
      const costCredits = estimateVideoCostCredits({
        modelNorm: pricingModelNorm,
        durationSeconds: pricingDurationSeconds,
        resolution: mode === "pro" ? "1080p" : "720p",
        klingMode: mode,
      });

      const spend = await ctx.billing.spendCredits({
        userId: user.id,
        amountCredits: costCredits,
        entryType: "ai_motion_control",
        refType: "async",
        refId: null,
        idempotencyKey: ctx.billing.getIdempotencyKey(req),
      });

      if (!spend.ok) {
        return res.status(402).json({ ok: false, error: spend.error });
      }

      const toolName = body.tool || "motion-control";
      const hint = body.nameHint || "motion-control";
      const prompt = body.prompt && body.prompt.trim() ? body.prompt.trim() : null;

      const keepOriginalSound = body.keepOriginalSound !== false; // default true

      // signed URLs so provider can fetch them
      const INPUT_URL_TTL_SECONDS = 6 * 60 * 60;
      const imageUrl = await assetIdToSignedUrl(body.imageAssetId, user.id, INPUT_URL_TTL_SECONDS);
      const videoUrl = await assetIdToSignedUrl(body.videoAssetId, user.id, INPUT_URL_TTL_SECONDS);

      const meta = {
        tool: toolName,
        provider: "kling",
        model: pricingModelNorm,
        motionControl: {
          imageAssetId: body.imageAssetId,
          videoAssetId: body.videoAssetId,
          keepOriginalSound,
          characterOrientation,
          mode,
          modelFamily: requestedModel,
          referenceVideoDurationSeconds,
          pricingDurationSeconds,
        },
      };

      const taskCreate = await createMotionControlTask({
        model: requestedModel,
        prompt: prompt || undefined,
        imageUrl,
        videoUrl,
        mode,
        keepOriginalSound,
        characterOrientation,
      });

      const taskId = String(
        taskCreate?.data?.task_id ||
          taskCreate?.task_id ||
          taskCreate?.data?.taskId ||
          taskCreate?.taskId ||
          ""
      ).trim();

      if (!taskId) {
        throw httpError(500, "KLING_TASK_CREATE_FAILED", "Kling no devolvió task_id en motion-control.", {
          taskCreate,
        });
      }

      const jobId = await upsertKlingJobRow({
        ownerId: user.id,
        kind: "video",
        taskId,
        taskType: "motion-control",
        toolName,
        hint,
        model: pricingModelNorm,
        prompt,
        extra: {
          meta,
          motionControl: meta.motionControl,
          clientJobId: clientJobIdNorm || null,
        },
      });

      return res.json({ ok: true, mode: "async", jobId, taskId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
