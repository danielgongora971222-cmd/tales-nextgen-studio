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

        // Elements (kling_elements en tu DB) → element_list (IDs reales de Kling)
        let elementList = undefined;
        if (hasElements) {
          const maxElems = hasFirst ? 3 : 5;
          if (klingElementIds.length > maxElems) {
            throw httpError(
              400,
              "KLING_O3_TOO_MANY_ELEMENTS",
              `Kling O3: máximo ${maxElems} Elements en este modo.`
            );
          }

          const { data: rows, error: rowsErr } = await supabaseAdmin
            .from("kling_elements")
            .select("id, owner_id, kling_element_id, status, status_detail")
            .in("id", klingElementIds)
            .eq("owner_id", user.id);

          if (rowsErr) {
            throw httpError(500, "DB_ERROR", "No pude leer tus Elements.", {
              rowsErr,
            });
          }

          const byId = new Map((rows || []).map((r) => [r.id, r]));
          const missing = (klingElementIds || []).filter((id) => !byId.has(id));
          if (missing.length) {
            throw httpError(
              400,
              "KLING_O3_ELEMENT_NOT_FOUND",
              "Uno o más Elements no existen o no te pertenecen.",
              { missing }
            );
          }

          const out = [];
          for (const elementUuid of klingElementIds) {
            const row = byId.get(elementUuid);

            const st = String(row?.status || "ready");
            if (st !== "ready") {
              throw httpError(
                400,
                "KLING_O3_ELEMENT_NOT_READY",
                "Uno o más Elements todavía se están creando o fallaron. Espera o usa Refresh status.",
                { elementUuid, status: row?.status || null, statusDetail: row?.status_detail || null }
              );
            }

            const raw = row?.kling_element_id;

            if (!raw) {
              throw httpError(
                400,
                "KLING_O3_ELEMENT_MISSING_KLING_ID",
                "Un Element no tiene kling_element_id guardado (no se puede mandar a Kling).",
                { elementUuid }
              );
            }

          const rawStr = String(raw).trim();

          // ⚠️ NO convertir a Number: element_id es "long" y puede exceder 2^53-1.
          // Si lo conviertes a Number pierdes precisión y Kling responde "Element id not found".
          out.push({ element_id: rawStr });
          }

          if (out.length) elementList = out;
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
        const omniPayload = {
          // ✅ O3 Pro debe usar un model_name O3 (video character elements requieren O3+)
          // Docs: video customization elements soportados para modelos `kling-video-o3` y posteriores. :contentReference[oaicite:4]{index=4}
          model_name: String(process.env.KLING_O3_MODEL_NAME || "kling-video-o3"),
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

        // Elements (kling_elements en tu DB) → element_list real (IDs de Kling)
        let elementList = undefined;
        if (hasElements) {
          const maxElems = hasFirst ? 3 : 5;
          if (klingElementIds.length > maxElems) {
            throw httpError(
              400,
              "KLING_V3_TOO_MANY_ELEMENTS",
              `Kling V3: máximo ${maxElems} Elements en este modo.`
            );
          }

          const { data: rows, error: rowsErr } = await supabaseAdmin
            .from("kling_elements")
            .select("id, owner_id, kling_element_id, status, status_detail")
            .in("id", klingElementIds)
            .eq("owner_id", user.id);

          if (rowsErr) {
            throw httpError(500, "DB_ERROR", "No pude leer tus Elements.", {
              rowsErr,
            });
          }

          const byId = new Map((rows || []).map((r) => [r.id, r]));
          const missing = (klingElementIds || []).filter((id) => !byId.has(id));
          if (missing.length) {
            throw httpError(
              400,
              "KLING_V3_ELEMENT_NOT_FOUND",
              "Uno o más Elements no existen o no te pertenecen.",
              { missing }
            );
          }

          const out = [];
          for (const elementUuid of klingElementIds) {
          const row = byId.get(elementUuid);

          const st = String(row?.status || "ready");
          if (st !== "ready") {
            throw httpError(
              400,
              "KLING_V3_ELEMENT_NOT_READY",
              "Uno o más Elements todavía se están creando o fallaron. Espera o usa Refresh status.",
              { elementUuid, status: row?.status || null, statusDetail: row?.status_detail || null }
            );
          }

          const raw = row?.kling_element_id;

          if (!raw) {
            throw httpError(
              400,
              "KLING_V3_ELEMENT_MISSING_KLING_ID",
              "Un Element no tiene kling_element_id guardado (no se puede mandar a Kling).",
              { elementUuid }
            );
          }

            const rawStr = String(raw).trim();

            // ⚠️ No convertir a Number (precisión)
            out.push({ element_id: rawStr });
          }

          if (out.length) elementList = out;
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

            const omniModelName = String(process.env.KLING_V3_OMNI_MODEL_NAME || "kling-v3-omni");

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
    // ✅ VEO via FAL (sin Gemini)
    // =========================

    // Si usan last frame, forzamos Veo 3.1 (first/last frame es feature de 3.1)
    let veoModel = selectedModelNorm;
    const isVeo31 = veoModel.startsWith("veo-3.1");
    if (hasLast && !isVeo31) {
      veoModel = "veo-3.1-generate-preview";
    }

    const isFast = veoModel.includes("-fast-");
    const baseEndpoint = isVeo31
      ? `fal-ai/veo3.1${isFast ? "/fast" : ""}`
      : `fal-ai/veo3${isFast ? "/fast" : ""}`;

    // Elegimos el endpoint según frames
    let endpointId = baseEndpoint;
    if (hasFirst && hasLast) {
      // Solo 3.1 tiene first/last
      endpointId = `${baseEndpoint}/first-last-frame-to-video`;
    } else if (hasFirst) {
      endpointId = `${baseEndpoint}/image-to-video`;
    }

    // Fal: Veo retorna 1 video por request. Para no romper UI, forzamos 1.
    const requestedCount = 1;

    // Aspect ratio
    let ar = aspectRatio || "16:9";
    if (ar === "1:1") ar = "16:9";
    // Parche conocido (también existe en el front): veo-3.0 + 1080p + 9:16
    if (veoModel.startsWith("veo-3.0") && !hasFirst && resolution === "1080p" && ar === "9:16") {
      ar = "16:9";
    }

    // Resolution
    let reso = resolution || "720p";
    if (!isVeo31 && reso === "4k") reso = "1080p";

    // Duration (Fal usa "4s"/"6s"/"8s")
    let dur = durationSeconds != null ? Number(durationSeconds) : 8;
    dur = Math.trunc(dur);
    if (![4, 6, 8].includes(dur)) dur = 8;
    if ((reso && reso !== "720p") || hasFirst || hasLast) dur = 8;
    const duration = `${dur}s`;

    // Input base Fal
    const falInput = {
      prompt,
      aspect_ratio: hasFirst ? "auto" : ar,
      duration,
      resolution: reso,

      // Igualamos el comportamiento anterior (Gemini): sin audio.
      // Si luego quieres habilitar sonido para Veo, lo añadimos como toggle en la UI.
      generate_audio: false,

      auto_fix: true,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    };

    // Frames: Fal necesita URLs accesibles
    // Si el job queda en cola, URLs firmadas muy cortas pueden expirar.
    const INPUT_URL_TTL_SECONDS = 60 * 60 * 6; // 6 horas

    if (hasFirst && hasLast) {
      falInput.first_frame_url = await assetIdToSignedUrl(
        firstFrameAssetId,
        user.id,
        INPUT_URL_TTL_SECONDS
      );
      falInput.last_frame_url = await assetIdToSignedUrl(
        lastFrameAssetId,
        user.id,
        INPUT_URL_TTL_SECONDS
      );
    } else if (hasFirst) {
      falInput.image_url = await assetIdToSignedUrl(
        firstFrameAssetId,
        user.id,
        INPUT_URL_TTL_SECONDS
      );
    }

    // Ejecutar en modo síncrono (la UI de Veo no implementa el flujo async/jobToken)
    const falJson = await falQueueRun(endpointId, falInput);

    const videoUrl =
      falJson?.video?.url ||
      falJson?.data?.video?.url ||
      falJson?.videos?.[0]?.url ||
      falJson?.output?.video?.url;

    if (!videoUrl) {
      throw httpError(502, "FAL_VEO_NO_VIDEO", "Fal/Veo no devolvió video.", {
        endpointId,
        response: falJson,
      });
    }

    // Descargar mp4, subir a Supabase Storage, crear asset row
    const urlExpiresInSeconds = 60 * 60;

    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw httpError(
        502,
        "FAL_VEO_VIDEO_DOWNLOAD_FAILED",
        `No pude descargar el video de Fal (${videoResp.status}).`
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
      provider: "fal",
      model: veoModel,
      endpointId,
      aspectRatio: hasFirst ? null : ar,
      resolution: reso,
      durationSeconds: dur,
      count: requestedCount,
      firstFrameAssetId: firstFrameAssetId || null,
      lastFrameAssetId: lastFrameAssetId || null,
      generateAudio: false,
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

        const body = VideoEditRequestSchema.parse(req.body);

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
          const { data: rows, error: rowsErr } = await supabaseAdmin
            .from("kling_elements")
            .select("id, owner_id, kling_element_id, status, status_detail")
            .in("id", klingElementIds)
            .eq("owner_id", user.id);

          if (rowsErr) {
            throw httpError(500, "DB_ERROR", "No pude leer tus Elements.", {
              rowsErr,
            });
          }

          const byId = new Map((rows || []).map((r) => [r.id, r]));
          const missing = klingElementIds.filter((id) => !byId.has(id));
          if (missing.length) {
            throw httpError(
              400,
              "VIDEO_EDIT_ELEMENT_NOT_FOUND",
              "Uno o más Elements no existen o no te pertenecen.",
              { missing }
            );
          }

          const out = [];
          for (const elementUuid of klingElementIds) {
            const row = byId.get(elementUuid);

            const st = String(row?.status || "ready");
            if (st !== "ready") {
              throw httpError(
                400,
                "VIDEO_EDIT_ELEMENT_NOT_READY",
                "Uno o más Elements todavía se están creando o fallaron. Espera o usa Refresh status.",
                { elementUuid, status: row?.status || null, statusDetail: row?.status_detail || null }
              );
            }

            const raw = row?.kling_element_id;
            if (!raw) {
              throw httpError(
                400,
                "VIDEO_EDIT_ELEMENT_MISSING_KLING_ID",
                "Un Element no tiene kling_element_id guardado (no se puede mandar a Kling).",
                { elementUuid }
              );
            }

            const rawStr = String(raw).trim();

            // ⚠️ No convertir a Number (precisión)
            out.push({ element_id: rawStr });
          }

          if (out.length) elementList = out;
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
        const modelName = String(process.env.KLING_OMNI_MODEL_NAME || "kling-v3-omni");
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


  // --- PASTE END ---
  // ===============================
  // KLING 2.6 - Motion Control (Fal)
  // ===============================
  router.post("/ai/video/motion-control", async (req, res, next) => {
    try {
      ensureAI();

      const { user, error } = await requireUser(req);
      if (error) return res.status(401).json({ ok: false, error });

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

      const body = MotionControlRequestSchema.parse(req.body);

      // ✅ Requiere plan activo
      const active = await ctx.billing.requireActiveSubscription(user.id);
      if (active.error) return res.status(403).json({ ok: false, error: active.error });

      // ✅ Spend de créditos ANTES de encolar motion-control
      // Esta ruta NO recibe duración explícita; usamos un costo estable basado en 5s.
      const mode = body.mode === "pro" ? "pro" : "std";
      const pricingModelNorm = mode === "pro" ? "kling-2.6-motion-control-pro" : "kling-2.6-motion-control";
      const costCredits = estimateVideoCostCredits({ modelNorm: pricingModelNorm, isKling: true, durationSeconds: 5 });

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

      const keepOriginalSound = body.keepOriginalSound !== false; // default true
      const characterOrientation = body.characterOrientation === "image" ? "image" : "video";

      // signed URLs so Fal.ai can fetch them
      const imageUrl = await assetIdToSignedUrl(body.imageAssetId, user.id, 6 * 60 * 60);
      const videoUrl = await assetIdToSignedUrl(body.videoAssetId, user.id, 6 * 60 * 60);

      const model = "kling-2.6-motion-control";

// std=720p, pro=1080p (ya calculado arriba en 'mode')

      const taskCreate = await createMotionControlTask({
        model,
        prompt: body.prompt && body.prompt.trim() ? body.prompt.trim() : undefined,
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
        model,
        prompt: body.prompt ? body.prompt.trim() : null,
        extra: {
          motionControl: {
            imageAssetId: body.imageAssetId,
            videoAssetId: body.videoAssetId,
            keepOriginalSound,
            characterOrientation,
            mode,
          },
        },
      });

      return res.json({ ok: true, mode: "async", jobId, taskId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
