import express from "express";
import {
  VideoRequestSchema,
  VideoEditRequestSchema,
  MotionControlRequestSchema,
  FalJobSchema,
  FalFinalizeSchema,
} from "../../schemas/index.js";
import { checkUserRateLimit } from "../../lib/userRateLimit.js";

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
    pollTaskUntilDone,
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

    const rl = checkUserRateLimit({
      userId: user.id,
      scope: "ai_video_generate",
      windowMs: 60 * 1000,
      max: 4,
    });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes de video por usuario. Espera un momento.",
          details: { scope: "ai_video_generate_user", retryAfterSeconds: rl.retryAfterSeconds },
        },
      });
    }

    const toolName = tool || "video-generator";
    const hint = nameHint || "generated-video";

    const hasFirst = Boolean(firstFrameAssetId);
    const hasLast = Boolean(lastFrameAssetId);
    const selectedModelRaw = model || "veo-3.1-generate-preview";
    const selectedModelStr = String(selectedModelRaw || "").trim();

    // En Gemini a veces aparece con prefijo "models/".
    // Si llega "models/kling-...", sin esto cae al branch de Veo por error.
    const selectedModelNorm = selectedModelStr.replace(/^models\//i, "");

    const isKling = selectedModelNorm.startsWith("kling-");

    if (hasLast && !hasFirst) {
      throw httpError(
        400,
        "MISSING_FIRST_FRAME",
        "lastFrameAssetId requiere firstFrameAssetId."
      );
    }

    if (isKling) {
      // ✅ KLING V3 PRO via FAL (fal-ai/kling-video/v3/pro/*)
            if (selectedModelNorm === "kling-v3" || selectedModelNorm === "kling-o3-pro") {
              const isO3 = selectedModelNorm === "kling-o3-pro";
        const hasElements =
          Array.isArray(klingElementIds) && klingElementIds.length > 0;

        // ⚠️ Fal/Kling debe poder descargar imágenes (start/end/elements).
        // Si el job queda en cola, URLs firmadas muy cortas pueden expirar.
        const INPUT_URL_TTL_SECONDS = 60 * 60 * 6; // 6 horas

        // Audio nativo (Fal: generate_audio). Si no viene nada, Fal suele default true.
        const generateAudio =
          klingSound !== undefined ? Boolean(klingSound) : true;

        // Voice IDs (limpiamos vacíos, max 2)
        const voiceIds = Array.isArray(klingVoiceIds)
          ? klingVoiceIds
              .map((v) => String(v || "").trim())
              .filter(Boolean)
              .slice(0, 2)
          : [];

        // Shot type (solo aplica en TEXT-TO-VIDEO cuando hay multi_prompt)
        const normalizedShotType =
          klingShotType === "intelligent" ? "intelligent" : "customize";

        // Duración (Fal: 3..15)
        let dur = durationSeconds != null ? Number(durationSeconds) : 5;
        dur = Math.trunc(dur);
        if (dur < 3) dur = 3;
        if (dur > 15) dur = 15;

        const ar = aspectRatio || "16:9";

        // Multi-shot (Fal: multi_prompt + shot_type)
        const KLING_V3_SHOT_PROMPT_LIMIT = 512;
        const multi =
          Array.isArray(klingMultiPrompt) && klingMultiPrompt.length
            ? klingMultiPrompt.map((s, idx) => {
                const p = String(s?.prompt || "");
                if (p.length > KLING_V3_SHOT_PROMPT_LIMIT) {
                  throw httpError(
                    400,
                    "KLING_V3_MULTISHOT_PROMPT_TOO_LONG",
                    `Kling V3 Multishot: el prompt del shot ${idx + 1} supera ${KLING_V3_SHOT_PROMPT_LIMIT} caracteres (${p.length}).`
                  );
                }

                let sDur = s?.durationSeconds != null ? Number(s.durationSeconds) : 5;
                sDur = Math.trunc(sDur);
                if (sDur < 3) sDur = 3;
                if (sDur > 15) sDur = 15;
                return { prompt: p, duration: String(sDur) };
              })
            : null;


        // Si hay multishot: suma total debe ser 3..15
        let totalDur = dur;
        if (multi && multi.length) {
          totalDur = multi.reduce(
            (acc, s) => acc + Number(s.duration || 0),
            0
          );
          if (totalDur < 3 || totalDur > 15) {
            throw httpError(
              400,
              "KLING_V3_MULTISHOT_DURATION_INVALID",
              "Kling V3 Multishot: la suma de durations debe ser entre 3 y 15 segundos."
            );
          }
        }

        // Elements (se pueden usar también en text-to-video)
        let elements = undefined;
        if (hasElements) {

          const { data: rows, error: rowsErr } = await supabaseAdmin
            .from("kling_elements")
            .select("id, owner_id, image_paths")
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
          for (const elementId of klingElementIds) {
            const row = byId.get(elementId);
            const paths = Array.isArray(row?.image_paths) ? row.image_paths : [];
            if (!paths.length) continue;

            // firmamos hasta 4 imágenes
            const urls = [];
            for (const storagePath of paths.slice(0, 4)) {
              const signed = await signStoragePath(
                storagePath,
                INPUT_URL_TTL_SECONDS
              );
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

        // Armamos el input Fal
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
          ...(klingCfgScale !== undefined ? { cfg_scale: klingCfgScale } : {}),
          ...(voiceIds.length ? { voice_ids: voiceIds } : {}),
        };

        // Text-to-video (single o multishot)
        if (multi && multi.length) {
          falInput.multi_prompt = multi;
          falInput.shot_type = isO3 ? "customize" : normalizedShotType;
        } else {
          falInput.prompt = prompt;
        }

        if (elements) falInput.elements = elements;

        // Image-to-video (si hay first frame)
        if (hasFirst) {
          // O3 usa image_url, V3 usa start_image_url
          falInput[isO3 ? "image_url" : "start_image_url"] = await assetIdToSignedUrl(
            firstFrameAssetId,
            user.id,
            INPUT_URL_TTL_SECONDS
          );

          // End frame: lo dejamos igual que estaba para V3
          // (y evitamos mandarlo en O3 para no romper)
          if (hasLast && !isO3) {
            falInput.end_image_url = await assetIdToSignedUrl(
              lastFrameAssetId,
              user.id,
              INPUT_URL_TTL_SECONDS
            );
          }

          if (elements) falInput.elements = elements;

          // i2v: shot_type solo "customize"
          if (multi && multi.length) falInput.shot_type = "customize";
        }
        
        // ✅ Modo async para evitar el timeout 120s de Vercel
        if (asyncMode) {
          const { requestId, statusUrl, responseUrl } = await falQueueSubmit(
            endpointId,
            falInput
          );

          const jobToken = signJobToken({
            uid: user.id,
            requestId,
            statusUrl,
            responseUrl,
            endpointId,
            toolName,
            hint,
            model: selectedModelNorm,
            ar,
            totalDur,
            firstFrameAssetId: firstFrameAssetId || null,
            lastFrameAssetId: lastFrameAssetId || null,
            generateAudio,
          });

          const jobId = await upsertFalJobRow({
            ownerId: user.id,
            kind: "video",
            requestId,
            jobToken,
            statusUrl,
            responseUrl,
            endpointId,
            toolName,
            hint,
            model: selectedModelNorm,
            prompt,
            extra: {
              ar,
              totalDur,
              firstFrameAssetId: firstFrameAssetId || null,
              lastFrameAssetId: lastFrameAssetId || null,
              generateAudio,
              negativePrompt: negativePrompt || null,
              klingCfgScale: klingCfgScale ?? null,
            },
          });

          return res.json({ ok: true, mode: "async", jobId, jobToken, requestId });
        }

        const falJson = await falQueueRun(endpointId, falInput);

        const videoUrl =
          falJson?.video?.url ||
          falJson?.data?.video?.url ||
          falJson?.videos?.[0]?.url ||
          falJson?.output?.video?.url;

        if (!videoUrl) {
          throw httpError(
            502,
            "FAL_KLING_V3_NO_VIDEO",
            "Fal/Kling V3 no devolvió video.",
            { endpointId, response: falJson }
          );
        }

        // Descargar video y guardarlo como Asset
        const videoResp = await fetch(videoUrl);
        if (!videoResp.ok) {
          throw httpError(
            502,
            "FAL_KLING_V3_VIDEO_DOWNLOAD_FAILED",
            `No pude descargar el video de Fal (${videoResp.status}).`
          );
        }

        const bytes = Buffer.from(await videoResp.arrayBuffer());
        const mimeType = videoResp.headers.get("content-type") || "video/mp4";

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
          model: selectedModelNorm,
          falEndpointId: endpointId,
          aspectRatio: ar,
          durationSeconds: totalDur,
          firstFrameAssetId: firstFrameAssetId || null,
          lastFrameAssetId: lastFrameAssetId || null,
          klingSound: generateAudio,
          negativePrompt: negativePrompt || null,
          klingCfgScale: klingCfgScale ?? null,
          klingVoiceIds: Array.isArray(klingVoiceIds)
            ? klingVoiceIds.slice(0, 2)
            : null,
          klingElementIds: hasElements ? klingElementIds : null,
          klingMultiPrompt: multi || null,
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
      let klingDuration = durationSeconds != null ? Number(durationSeconds) : 5;
      klingDuration = Math.trunc(klingDuration);
      if (![5, 10].includes(klingDuration)) {
        throw httpError(
          400,
          "KLING_DURATION_NOT_SUPPORTED",
          "Kling solo acepta durationSeconds de 5 o 10."
        );
      }

      // Kling v2.6 Native Audio
      // ✅ Kling API espera `enable_audio: boolean` (no `sound: "on"|"off"`).
      // ✅ Además: cuando enable_audio=true, la mayoría de gateways requieren `mode: "pro"`.
      let klingModeValue = klingMode || "std";
      const supportsNativeAudio = selectedModelNorm === "kling-v2-6";
      const enableAudio =
        supportsNativeAudio && klingSound !== undefined ? Boolean(klingSound) : undefined;

      if (supportsNativeAudio && enableAudio === true && klingModeValue !== "pro") {
        klingModeValue = "pro";
      }

      const klingExtras = {
        mode: klingModeValue,
        ...(enableAudio !== undefined ? { enable_audio: enableAudio } : {}),
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

      let taskData = null;
      try {
        taskData = await pollTaskUntilDone({
          type: taskType,
          taskId,
          modelName: selectedModelNorm,
          maxWaitMs: 6 * 60 * 1000,
          intervalMs: 2000,
        });
      } catch (err) {
        throw httpError(502, "KLING_TASK_FAILED", err.message || "Kling task failed.", {
          taskId,
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
          taskId,
          hasVideoUrl: Boolean(videoUrl),
          hasAudioUrl: Boolean(audioUrl),
          videoKeys: firstVideo ? Object.keys(firstVideo) : null,
          taskResultKeys: taskResult ? Object.keys(taskResult) : null,
        });
      }

      if (!videoUrl) {
        throw httpError(502, "KLING_NO_VIDEOS", "Kling: tarea completada pero sin videos.", {
          taskId,
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
        durationSeconds: klingDuration,
        firstFrameAssetId: firstFrameAssetId || null,
        lastFrameAssetId: lastFrameAssetId || null,
        klingMode: klingModeValue,
        klingSound: supportsNativeAudio ? (enableAudio ?? null) : null,
        negativePrompt: negativePrompt || null,
        klingTaskId: taskId,
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
  // KLING O3 PRO - Edit / Reference (Fal async)
  // POST /api/ai/video/edit
  // ===============================
  router.post("/ai/video/edit", async (req, res, next) => {
    try {
      ensureAI();

      const { user, error } = await requireUser(req);
      if (error) return res.status(401).json({ ok: false, error });

      const rl = checkUserRateLimit({
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
          "Video Edit requiere modo async (Fal queue)."
        );
      }

      // ⚠️ Fal/Kling debe poder descargar inputs durante cola/ejecución.
      const INPUT_URL_TTL_SECONDS = 60 * 60 * 6; // 6 horas

      // Map: model -> Fal endpoint
      const model = body.model;
      let endpointId = null;
      let kind = null;

      if (model === "kling-o3-ref-to-video-pro") {
        endpointId = "fal-ai/kling-video/o3/pro/reference-to-video";
        kind = "reference-to-video";
      } else if (model === "kling-o3-edit-video-pro") {
        endpointId = "fal-ai/kling-video/o3/pro/video-to-video/edit";
        kind = "video-to-video/edit";
      } else if (model === "kling-o3-ref-video-to-video-pro") {
        endpointId = "fal-ai/kling-video/o3/pro/video-to-video/reference";
        kind = "video-to-video/reference";
      } else {
        throw httpError(400, "VIDEO_EDIT_MODEL_INVALID", "Modelo inválido.");
      }

      const promptRaw = String(body.prompt || "").trim();

      // ✅ Límite de referencias combinadas por modelo
      // - reference-to-video (Ingredientes → Video): 1..7
      // - video-to-video (edit / reference):         0..4
      const MAX_COMBINED_REFS = kind === "reference-to-video" ? 7 : 4;

      // ✅ Este modelo NO soporta START/END (first/last frame).
      // Aceptamos null en el schema para evitar 400, pero si llega un UUID, rechazamos.
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
          "Multishot solo está disponible en Reference to Video."
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

      // Refs (imágenes)
      const referenceImageAssetIds = Array.isArray(body.referenceImageAssetIds)
        ? body.referenceImageAssetIds.filter(Boolean).slice(0, MAX_COMBINED_REFS)
        : [];

      const imageUrls = [];
      for (const assetId of referenceImageAssetIds) {
        const signed = await assetIdToSignedUrl(
          assetId,
          user.id,
          INPUT_URL_TTL_SECONDS
        );
        imageUrls.push(signed);
      }

      // Elements (librería Kling)
      const klingElementIds = Array.isArray(body.klingElementIds)
        ? body.klingElementIds.filter(Boolean).slice(0, MAX_COMBINED_REFS)
        : [];

      // ✅ Para reference-to-video exigimos al menos 1 ingrediente visual (1–7)
      if (kind === "reference-to-video" && referenceImageAssetIds.length + klingElementIds.length < 1) {
        throw httpError(
          400,
          "VIDEO_EDIT_MISSING_REFS",
          `Este modelo requiere entre 1 y ${MAX_COMBINED_REFS} referencias (imágenes + Elements).`,
          { refCount: referenceImageAssetIds.length, elementCount: klingElementIds.length }
        );
      }


      let elements = undefined;
      if (klingElementIds.length) {
        const { data: rows, error: rowsErr } = await supabaseAdmin
          .from("kling_elements")
          .select("id, owner_id, image_paths")
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
        for (const elementId of klingElementIds) {
          const row = byId.get(elementId);
          const paths = Array.isArray(row?.image_paths) ? row.image_paths : [];
          if (!paths.length) continue;

          // firmamos hasta 4 imágenes
          const urls = [];
          for (const storagePath of paths.slice(0, 4)) {
            const signed = await signStoragePath(
              storagePath,
              INPUT_URL_TTL_SECONDS
            );
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

      // Kling: máximo 4 referencias combinadas (Elements + image_urls)
      const elementCount = Array.isArray(elements) ? elements.length : 0;
      const refCount = imageUrls.length;
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

      // Multi-shot: normalizamos y validamos suma
      let multi = null;
      let totalDur = dur;
      if (multiRaw && multiRaw.length) {
        multi = multiRaw.map((s, idx) => {
          const p = String(s?.prompt || "");
          if (!p.trim()) {
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
          let sDur = s?.durationSeconds != null ? Number(s.durationSeconds) : 5;
          sDur = Math.trunc(sDur);
          if (sDur < 3) sDur = 3;
          if (sDur > 15) sDur = 15;
          return { prompt: p, duration: String(sDur) };
        });

        if (multi.length < 2) {
          throw httpError(
            400,
            "VIDEO_EDIT_MULTISHOT_TOO_FEW",
            "Multishot requiere mínimo 2 shots."
          );
        }

        totalDur = multi.reduce((acc, s) => acc + Number(s.duration || 0), 0);
        if (totalDur < 3 || totalDur > 15) {
          throw httpError(
            400,
            "VIDEO_EDIT_MULTISHOT_DURATION_INVALID",
            "Multishot: la suma total debe estar entre 3s y 15s."
          );
        }
      }

      // Inputs principales
      const falInput = {};

      if (kind === "reference-to-video") {
        if (multi && multi.length) {
          falInput.multi_prompt = multi;
          falInput.shot_type = "customize";
        } else {
          falInput.prompt = promptRaw;
        }

        falInput.duration = String(totalDur);
        falInput.aspect_ratio = ar;
        falInput.generate_audio = body.generateAudio === true;

        if (imageUrls.length) falInput.image_urls = imageUrls;
        if (elements) falInput.elements = elements;
      }

      if (kind === "video-to-video/edit") {
        if (!body.videoAssetId) {
          throw httpError(
            400,
            "VIDEO_EDIT_VIDEO_REQUIRED",
            "Debes seleccionar un video de referencia."
          );
        }

        falInput.prompt = promptRaw;
        falInput.video_url = await assetIdToSignedUrl(
          body.videoAssetId,
          user.id,
          INPUT_URL_TTL_SECONDS
        );
        falInput.keep_audio = body.keepAudio !== false;
        falInput.shot_type = "customize";

        if (imageUrls.length) falInput.image_urls = imageUrls;
        if (elements) falInput.elements = elements;
      }

      if (kind === "video-to-video/reference") {
        if (!body.videoAssetId) {
          throw httpError(
            400,
            "VIDEO_EDIT_VIDEO_REQUIRED",
            "Debes seleccionar un video de referencia."
          );
        }

        falInput.prompt = promptRaw;
        falInput.video_url = await assetIdToSignedUrl(
          body.videoAssetId,
          user.id,
          INPUT_URL_TTL_SECONDS
        );
        falInput.keep_audio = body.keepAudio !== false;
        falInput.shot_type = "customize";
        falInput.duration = String(dur);
        falInput.aspect_ratio = ar;

        if (imageUrls.length) falInput.image_urls = imageUrls;
        if (elements) falInput.elements = elements;
      }

      const { requestId, statusUrl, responseUrl } = await falQueueSubmit(
        endpointId,
        falInput
      );

      const savedPrompt =
        multi && multi.length
          ? multi.map((s, i) => `Shot ${i + 1}: ${s.prompt}`).join(" | ")
          : promptRaw;

      const jobToken = signJobToken({
        uid: user.id,
        requestId,
        statusUrl,
        responseUrl,
        endpointId,
        toolName,
        hint,
        model,
        ar: kind === "video-to-video/edit" ? null : ar,
        totalDur: kind === "video-to-video/edit" ? null : totalDur,
        // ✅ Este endpoint ya no usa first/last frame
        firstFrameAssetId: null,
        lastFrameAssetId: null,
        generateAudio:
          kind === "reference-to-video" ? body.generateAudio === true : null,
        editVideo: {
          kind,
          model,
          prompt: savedPrompt,
          promptRaw: promptRaw || null,
          multiPrompt: multi
            ? multi.map((s) => ({ prompt: s.prompt, duration: s.duration }))
            : null,
          // ✅ Este endpoint ya no usa START/END
          startImageAssetId: null,
          endImageAssetId: null,
          videoAssetId: body.videoAssetId || null,
          referenceImageAssetIds,
          klingElementIds,
          keepAudio: kind.startsWith("video-to-video")
            ? body.keepAudio !== false
            : null,
          generateAudio:
            kind === "reference-to-video" ? body.generateAudio === true : null,
          durationSeconds: kind === "video-to-video/edit" ? null : totalDur,
          aspectRatio: kind === "video-to-video/edit" ? null : ar,
        },
        exp: Date.now() + 1000 * 60 * 60 * 8,
      });

      const jobId = await upsertFalJobRow({
        ownerId: user.id,
        kind: "video",
        requestId,
        jobToken,
        statusUrl,
        responseUrl,
        endpointId,
        toolName,
        hint,
        model,
        prompt: savedPrompt,
        extra: {
          editVideo: {
            kind,
            model,
            prompt: savedPrompt,
            promptRaw: promptRaw || null,
            multiPrompt: multi
              ? multi.map((s) => ({ prompt: s.prompt, duration: s.duration }))
              : null,
            videoAssetId: body.videoAssetId || null,
            referenceImageAssetIds,
            klingElementIds,
            keepAudio: kind.startsWith("video-to-video")
              ? body.keepAudio !== false
              : null,
            generateAudio:
              kind === "reference-to-video" ? body.generateAudio === true : null,
            durationSeconds: kind === "video-to-video/edit" ? null : totalDur,
            aspectRatio: kind === "video-to-video/edit" ? null : ar,
          },
        },
      });

      return res.json({ ok: true, mode: "async", jobId, jobToken, requestId });
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

      const rl = checkUserRateLimit({
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

      const toolName = body.tool || "motion-control";
      const hint = body.nameHint || "motion-control";

      const keepOriginalSound = body.keepOriginalSound !== false; // default true
      const characterOrientation = body.characterOrientation === "image" ? "image" : "video";

      // signed URLs so Fal.ai can fetch them
      const imageUrl = await assetIdToSignedUrl(body.imageAssetId, user.id, 6 * 60 * 60);
      const videoUrl = await assetIdToSignedUrl(body.videoAssetId, user.id, 6 * 60 * 60);

      const endpointId = "fal-ai/kling-video/v2.6/pro/motion-control";

      const falInput = {
        image_url: imageUrl,
        video_url: videoUrl,
        keep_original_sound: keepOriginalSound,
        character_orientation: characterOrientation,
      };

      if (body.prompt && body.prompt.trim()) {
        falInput.prompt = body.prompt.trim();
      }

      // ✅ Siempre async (evita timeouts y permite videos largos)
      const { requestId, statusUrl, responseUrl } = await falQueueSubmit(endpointId, falInput);

      const jobToken = signJobToken({
        uid: user.id,
        requestId,
        statusUrl,
        responseUrl,
        endpointId,
        toolName,
        hint,
        model: "kling-2.6-motion-control",
        motionControl: {
          imageAssetId: body.imageAssetId,
          videoAssetId: body.videoAssetId,
          keepOriginalSound,
          characterOrientation,
        },
        createdAt: Date.now(),
        exp: Date.now() + 6 * 60 * 60 * 1000,
      });

      const jobId = await upsertFalJobRow({
        ownerId: user.id,
        kind: "video",
        requestId,
        jobToken,
        statusUrl,
        responseUrl,
        endpointId,
        toolName,
        hint,
        model: "kling-2.6-motion-control",
        prompt: body.prompt ? body.prompt.trim() : null,
        extra: {
          motionControl: {
            imageAssetId: body.imageAssetId,
            videoAssetId: body.videoAssetId,
            keepOriginalSound,
            characterOrientation,
          },
        },
      });

      return res.json({ ok: true, mode: "async", jobId, jobToken, requestId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
