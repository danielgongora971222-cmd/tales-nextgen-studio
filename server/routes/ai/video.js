import express from "express";
import {
  VideoRequestSchema,
  FalJobSchema,
  FalFinalizeSchema,
} from "../../schemas/index.js";

export function createAiVideoRouter(ctx) {


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
    sleep,

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

    // ... resto igual
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

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
      if (selectedModelNorm === "kling-v3") {
        const hasElements = Array.isArray(klingElementIds) && klingElementIds.length > 0;

        // Duración (Fal: 3..15)
        let dur = durationSeconds != null ? Number(durationSeconds) : 5;
        dur = Math.trunc(dur);
        if (dur < 3) dur = 3;
        if (dur > 15) dur = 15;

        const ar = aspectRatio || "16:9";

        // Audio nativo (Fal: generate_audio)
        const generateAudio = klingSound !== undefined ? Boolean(klingSound) : false;

        // Multi-shot (Fal: multi_prompt + shot_type)
        const multi =
          Array.isArray(klingMultiPrompt) && klingMultiPrompt.length
            ? klingMultiPrompt.map((s) => {
                let sDur = s?.durationSeconds != null ? Number(s.durationSeconds) : 5;
                sDur = Math.trunc(sDur);
                if (sDur < 3) sDur = 3;
                if (sDur > 15) sDur = 15;
                return { prompt: s.prompt, duration: String(sDur) };
              })
            : null;

        // Si hay multishot: usamos la suma de shots como duración total (debe quedar 3..15)
        let totalDur = dur;
        if (multi && multi.length) {
          totalDur = multi.reduce((acc, s) => acc + Number(s.duration || 0), 0);
          if (totalDur < 3 || totalDur > 15) {
            throw httpError(
              400,
              "KLING_V3_MULTISHOT_DURATION_INVALID",
              "Kling V3 Multishot: la suma de durations debe ser entre 3 y 15 segundos."
            );
          }
        }

        // Elements (Fal) desde tu tabla kling_elements + imágenes en Storage
        let elements = undefined;
        if (hasElements) {
          if (!hasFirst) {
            throw httpError(
              400,
              "KLING_V3_ELEMENTS_REQUIRE_FIRST_FRAME",
              "Kling V3: Para usar Elements necesitas un First Frame (start image)."
            );
          }

          const { data: rows, error: rowsErr } = await supabaseAdmin
            .from("kling_elements")
            .select("id, owner_id, image_paths")
            .in("id", klingElementIds)
            .eq("owner_id", user.id);

          if (rowsErr) {
            throw httpError(500, "DB_ERROR", "No pude leer tus Elements.", { rowsErr });
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
            for (const p of paths.slice(0, 4)) {
              const u = await signStoragePath(p, 60 * 30);
              urls.push(u);
            }
            if (!urls.length) continue;

            const frontal = urls[0];
            const refs = urls.slice(1, 4);
            // Fal requiere al menos 1 reference_image_url
            if (!refs.length) refs.push(frontal);

            out.push({ frontal_image_url: frontal, reference_image_urls: refs });
          }

          if (out.length) elements = out;
        }

        // Armamos el input Fal
        let endpointId = "fal-ai/kling-video/v3/pro/text-to-video";

        const falInput = {
          aspect_ratio: ar,
          duration: String(totalDur),
          generate_audio: generateAudio,
          ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
          ...(klingCfgScale !== undefined ? { cfg_scale: klingCfgScale } : {}),
          ...(Array.isArray(klingVoiceIds) && klingVoiceIds.length
            ? { voice_ids: klingVoiceIds.slice(0, 2) }
            : {}),
        };

        if (multi && multi.length) {
          falInput.multi_prompt = multi;
          falInput.shot_type = klingShotType || "customize";
        } else {
          falInput.prompt = prompt;
        }

        if (hasFirst) {
          endpointId = "fal-ai/kling-video/v3/pro/image-to-video";
          falInput.start_image_url = await assetIdToSignedUrl(firstFrameAssetId, user.id, 60 * 30);
          if (hasLast) {
            falInput.end_image_url = await assetIdToSignedUrl(lastFrameAssetId, user.id, 60 * 30);
          }
          if (elements) falInput.elements = elements;

          // i2v: shot_type solo "customize"
          if (multi && multi.length) falInput.shot_type = "customize";
        }

        // ✅ Modo async para evitar el timeout 120s de Vercel
        if (asyncMode) {
          const { requestId, statusUrl, responseUrl } = await falQueueSubmit(endpointId, falInput);

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

          return res.json({ ok: true, mode: "async", jobToken, requestId });
        }

        const falJson = await falQueueRun(endpointId, falInput);

        const videoUrl =
          falJson?.video?.url ||
          falJson?.data?.video?.url ||
          falJson?.videos?.[0]?.url ||
          falJson?.output?.video?.url;

        if (!videoUrl) {
          throw httpError(502, "FAL_KLING_V3_NO_VIDEO", "Fal/Kling V3 no devolvió video.", {
            endpointId,
            response: falJson,
          });
        }

        // Descargar video y guardarlo como Asset (igual que Kling directo)
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
        const storagePath = buildAssetPath({
          userId: user.id,
          tool: toolName,
          mimeType,
          nameHint: hint,
        });

        await uploadBytesToStorageAtPath({ storagePath, bytes, mimeType });
        async function uploadStreamToStorageAtPath({ storagePath, stream, mimeType }) {
          if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw httpError(500, "SUPABASE_NOT_CONFIGURED", "Supabase no está configurado en el backend.");
          }
          if (!stream) {
            throw httpError(502, "VIDEO_STREAM_MISSING", "No pude obtener el stream del video para subirlo a Storage.");
          }

          const encodedPath = String(storagePath)
            .split("/")
            .map(encodeURIComponent)
            .join("/");

          const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${encodedPath}`;

          const resp = await fetch(url, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": mimeType || "application/octet-stream",
              "x-upsert": "false",
            },
            body: stream,
            // Node fetch exige esto cuando mandas un stream como body
            duplex: "half",
          });

          const txt = await resp.text();
          if (!resp.ok) {
            throw httpError(
              502,
              "SUPABASE_UPLOAD_FAILED",
              `Supabase Storage upload failed (HTTP ${resp.status}): ${txt.slice(0, 200)}`
            );
          }

          return storagePath;
        }

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
          klingVoiceIds: Array.isArray(klingVoiceIds) ? klingVoiceIds.slice(0, 2) : null,
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

      // ✅ Subida por streaming (no cargamos todo el mp4 en memoria)
      await uploadStreamToStorageAtPath({
        storagePath,
        stream: videoResp.body,
        mimeType,
      });

      await uploadBytesToStorageAtPath({ storagePath, bytes, mimeType });

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

    const aiClient = await ensureAI();

    // Si usan frames, forzamos Veo 3.1 (first/last frames es feature de 3.1)
    let veoModel = selectedModelNorm;
    const isVeo31 = veoModel.startsWith("veo-3.1");
    if ((hasFirst || hasLast) && !isVeo31) {
      veoModel = "veo-3.1-generate-preview";
    }

    const cfg = {};

    // numberOfVideos (count)
    // Nota: Veo 3 / 3.1 (Gemini API) limita salida a 1 video por request.
    let requestedCount = Math.max(1, Math.min(Number(count || 1), 4));
    if (String(veoModel).startsWith("veo-3.")) {
      requestedCount = 1;
    }
    cfg.numberOfVideos = requestedCount;

    // resolution
    if (resolution) cfg.resolution = resolution;

    // durationSeconds: Veo 3/3.1 acepta 4/6/8 y 1080p/4k/frames fuerzan 8s
    let dur = durationSeconds != null ? Number(durationSeconds) : 8;
    dur = Math.trunc(dur);
    if (![4, 6, 8].includes(dur)) dur = 8;   if ((cfg.resolution && cfg.resolution !== "720p") || hasFirst || hasLast) dur = 8;
    cfg.durationSeconds = dur; // ✅ NUMBER (no string)
    console.log("[VEO DEBUG] durationSeconds =", cfg.durationSeconds, "typeof =", typeof cfg.durationSeconds);

    // aspectRatio solo si NO hay first frame
    if (!hasFirst) {
      cfg.aspectRatio = aspectRatio || "16:9";
    }

    // Construir image / lastFrame si aplica
    // Usamos el helper correcto ya existente: assetIdToImageObject()
    let firstImage = null;

    if (hasFirst) {
      firstImage = await assetIdToImageObject(firstFrameAssetId, user.id);
    }

    if (hasLast) {
      cfg.lastFrame = await assetIdToImageObject(lastFrameAssetId, user.id);
    }

    // 1) iniciar operación
    let operation = await aiClient.models.generateVideos({
      model: veoModel,
      prompt,
      ...(firstImage ? { image: firstImage } : {}),
      config: cfg,
    });

    // 2) polling hasta done (máx 6 min)
    const start = Date.now();
    const maxWaitMs = 6 * 60 * 1000;

    while (!operation.done) {
      if (Date.now() - start > maxWaitMs) {
        throw httpError(504, "VIDEO_TIMEOUT", "La generación de video tardó demasiado. Intenta otra vez.", {
          operationName: operation?.name || null,
        });
      }
      await sleep(5000);
      operation = await aiClient.operations.getVideosOperation({ operation });
    }

    const generated = operation?.response?.generatedVideos || [];
    if (!generated.length) {
      throw httpError(500, "NO_VIDEO_RETURNED", "Veo no devolvió videos en la respuesta.", {
        model: veoModel,
      });
    }

    // 3) descargar mp4, subir a Supabase Storage, crear asset row
    const urlExpiresInSeconds = 60 * 60;
    const items = [];

    for (let i = 0; i < generated.length; i++) {
      const tmpPath = pathJoin(os.tmpdir(), `veo_${Date.now()}_${i}.mp4`);

      try {
        await aiClient.files.download({
          file: generated[i].video,
          downloadPath: tmpPath,
        });

        const bytes = await fs.readFile(tmpPath);
        const mimeType = "video/mp4";
        const storagePath = buildAssetPath({
          userId: user.id,
          tool: toolName,
          mimeType,
          nameHint: hint,
        });

        await uploadBytesToStorageAtPath({ storagePath, bytes, mimeType });

        const meta = {
          tool: toolName,
          model: veoModel,
          aspectRatio: hasFirst ? null : (cfg.aspectRatio || null),
          resolution: cfg.resolution || "720p",
          durationSeconds: cfg.durationSeconds,
          count: cfg.numberOfVideos,
          firstFrameAssetId: firstFrameAssetId || null,
          lastFrameAssetId: lastFrameAssetId || null,
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
        items.push({ url, assetId });
      } finally {
        fs.unlink(tmpPath).catch(() => {});
      }
    }

    return res.json({
      ok: true,
      items,
      url: items[0]?.url,
      assetId: items[0]?.assetId,
      urlExpiresInSeconds,
    });
  } catch (err) {
    next(err);
  }
});

  // --- PASTE END ---

  return router;
}
