import express from "express";
import {
  ImageRequestSchema,
  RestyleSchema,
  FaceSwapSchema,
  UpscaleSchema,
  UploadAssetSchema,
} from "../../schemas/index.js";

export function createAiImageRouter(ctx) {
  const router = express.Router();

  const {
    // deps/core
    supabaseAdmin,
    requireUser,
    getClientIp,
    apiError,
    httpError,
    ensureAI,

    // storage helpers
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    signStoragePath,
    insertAssetRow,

    // env/flags/clients/helpers (los que existan en tu server.js)
    APP_ENV,
    NODE_ENV,
    SUPABASE_BUCKET,

    // cualquier otra cosa que use tu handler de imagen (clientes, fetch, etc)
    ...rest
  } = ctx;

  /**
   * 👇 Pega aquí tu endpoint /api/ai/image movido desde server.js
   * Cambiando solo: app.post("/api/ai/image"...) -> router.post("/ai/image"...)
   */

  // --- PASTE START ---
  router.post("/ai/image", async (req, res, next) => {
  try {

    const {
      prompt,
      model,
      aspectRatio,
      count,
      quality,
      tool,
      nameHint,
      klingElementIds,
      characterAssetIds,
      styleAssetId,
      backgroundAssetId,
    } = ImageRequestSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const selectedModel = model || "gemini-2.5-flash-image";
    const maxCount = maxCountForImageModel(selectedModel);
    if (count > maxCount) {
      throw httpError(
        400,
        "COUNT_NOT_SUPPORTED",
        `This model supports up to ${maxCount} image(s) per request.`
      );
    }

    // "auto" en UI = dejar que el modelo use su default (excepto OpenAI, que sí soporta size="auto")
    const arNonOpenAI = aspectRatio === "auto" ? undefined : aspectRatio;

    // =============================
    // OPENAI GPT IMAGE
    // =============================
        if (selectedModel.startsWith("openai:")) {
      const { model: openaiModel, quality: openaiQuality } = parseOpenAIImageModel(selectedModel);

      const refs = [
        ...((characterAssetIds || []).map((id, i) => ({ label: `Character reference ${i + 1}`, id }))),
        ...(styleAssetId ? [{ label: "Style reference", id: styleAssetId }] : []),
        ...(backgroundAssetId ? [{ label: "Background reference", id: backgroundAssetId }] : []),
      ];

      // Limitar aspect ratios soportados
      if (aspectRatio && aspectRatio !== "auto" && !["1:1", "3:2", "2:3"].includes(aspectRatio)) {
        throw httpError(
          400,
          "ASPECT_RATIO_NOT_SUPPORTED",
          `GPT 1.5 solo soporta 1:1, 3:2, 2:3. Recibí: ${aspectRatio}`
        );
      }

      // Quality/resolución UI: por ahora 1K solamente
      if (quality && quality !== "1K") {
        throw httpError(400, "QUALITY_NOT_SUPPORTED", "GPT 1.5 en esta tool solo usará 1K por ahora.");
      }

      const nRequested = Math.min(Number(count || 1), maxCount);
      const toolName = tool || "image-generator";
      const hint = nameHint || "generated";
      const items = [];
      const urlExpiresInSeconds = 60 * 60;

      const size = openaiSizeFromAspectRatio(aspectRatio);

      // ✅ Si hay referencias, las mandamos como images[] usando /v1/images/edits
      const imageFiles = refs.length
        ? await Promise.all(refs.map((r) => assetIdToImageFile(r.id, user.id)))
        : [];

      for (let i = 0; i < nRequested; i++) {
        const dataUrl = await openaiGenerateImageDataUrl({
          model: openaiModel,         // gpt-image-1.5
          prompt,
          size,
          quality: openaiQuality,     // auto | high
          images: imageFiles,         // refs
        });

        const { storagePath } = await uploadBase64ToStorage({
          userId: user.id,
          tool: toolName,
          dataUrl,
          nameHint: hint,
        });

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "image",
          tool: toolName,
          name: hint,
          prompt,
          storagePath,
          isPublic: false,
          meta: {
            tool: toolName,
            model: selectedModel,
            aspectRatio: aspectRatio || null,
            quality: quality || "1K",
            count: nRequested,
            characterAssetIds: characterAssetIds || [],
            styleAssetId: styleAssetId || null,
            backgroundAssetId: backgroundAssetId || null,
          },
        });

        const url = await signStoragePath(storagePath, urlExpiresInSeconds);
        items.push({ url, assetId });
      }

      return res.json({
        ok: true,
        items,
        url: items[0]?.url,
        assetId: items[0]?.assetId,
        urlExpiresInSeconds,
      });
    }

    // =============================
    // BFL / FLUX 2.0 (Max / Pro / Flex)  ✅ usa tu API key de Black Forest Labs
    // =============================
    if (selectedModel.startsWith("fal-ai/flux-2-")) {
      const bflModel = selectedModel.replace("fal-ai/", ""); // flux-2-max | flux-2-pro | flux-2-flex

      const nRequested = Math.min(Number(count || 1), maxCount);
      const toolName = tool || "image-generator";
      const hint = nameHint || "generated";
      const urlExpiresInSeconds = 60 * 60;

      const dims = falDimsFromAspectQuality(aspectRatio, quality);

      // BFL soporta hasta 8 imágenes de referencia por request
      const refIds = [
        ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
        ...(backgroundAssetId ? [backgroundAssetId] : []),
        ...(styleAssetId ? [styleAssetId] : []),
      ].filter(Boolean);

      const refUrls = refIds.length
        ? await Promise.all(refIds.slice(0, 8).map((id) => assetIdToSignedUrl(id, user.id, 60 * 10)))
        : [];

      let bflPrompt = prompt;
      if (refUrls.length) {
        // En BFL puedes referenciar "image 1", "image 2", etc.
        bflPrompt =
          `${prompt}\n\n` +
          `Reference images by number: ${refUrls.map((_, i) => `image ${i + 1}`).join(", ")}.`;
      }

      const payload = {
        prompt: bflPrompt,
        width: dims.width,
        height: dims.height,
        output_format: "png",
        safety_tolerance: 2,
      };

      if (refUrls[0]) payload.input_image = refUrls[0];
      for (let i = 1; i < refUrls.length && i < 8; i++) {
        payload[`input_image_${i + 1}`] = refUrls[i];
      }

      const items = [];
      for (let i = 0; i < nRequested; i++) {
        const submit = await bflSubmit(bflModel, payload);
        const done = await bflPoll(submit.polling_url, { timeoutMs: 180000 });

        const sampleUrl = done?.result?.sample || done?.result?.url;
        const dataUrl = await bflSampleToDataUrl(sampleUrl);

        const { storagePath } = await uploadBase64ToStorage({
          userId: user.id,
          tool: toolName,
          dataUrl,
          nameHint: hint,
        });

        const meta = {
          tool: toolName,
          provider: "bfl",
          model: selectedModel,
          bflModel,
          aspectRatio: aspectRatio || null,
          quality: quality || null,
          count: nRequested,
          characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
          styleAssetId: styleAssetId || null,
          backgroundAssetId: backgroundAssetId || null,
        };

        const assetId = await insertAssetRow({
          ownerId: user.id,
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

      return res.json({
        ok: true,
        items,
        url: items[0]?.url,
        assetId: items[0]?.assetId,
        urlExpiresInSeconds,
      });
    }

        // =============================
        // KLING (Image) — Omni-Image (O1)
        // Docs: POST /v1/images/omni-image  |  GET /v1/images/omni-image/{task_id}
        // model_name: kling-image-o1
        // =============================
        if (selectedModel.startsWith("kling:")) {
          const accessKey = process.env.KLING_ACCESS_KEY;
          const secretKey = process.env.KLING_SECRET_KEY;
          if (!accessKey || !secretKey) {
            throw httpError(
              503,
              "KLING_NOT_CONFIGURED",
              "Faltan KLING_ACCESS_KEY y/o KLING_SECRET_KEY en el servidor (Render)."
            );
          }

          const modelName =
            selectedModel.split(":")[1] ||
            process.env.KLING_IMAGE_MODEL_NAME ||
            "kling-image-o1";

          // Kling permite n [1..9]. Tus reglas de negocio lo limitan por modelo (maxCount).
          const nRequested = Math.max(1, Math.min(Number(count || 1), 9, maxCount));

          const toolName = tool || "image-generator";
          const hint = nameHint || "generated";
          const urlExpiresInSeconds = 60 * 60;

          // Calidad UI -> resolution Kling (1k / 2k)
          const klingResolution = String(quality || "")
            .toUpperCase()
            .trim() === "2K"
            ? "2k"
            : "1k";

          // Aspect ratio soportado por Kling (NO incluye 4:5)
          const allowedAspectRatios = new Set([
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "3:2",
            "2:3",
            "21:9",
            "auto",
          ]);

          const rawAR = (aspectRatio || "auto").trim();
          const mappedAR = rawAR === "4:5" ? "3:4" : rawAR; // 4:5 -> 3:4 (lo más cercano)
          const klingAspectRatio = allowedAspectRatios.has(mappedAR) ? mappedAR : "auto";

          // Referencias -> image_list (máx 10)
          const refIds = [
            ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
            ...(backgroundAssetId ? [backgroundAssetId] : []),
            ...(styleAssetId ? [styleAssetId] : []),
          ]
            .filter(Boolean)
            .slice(0, 10);

          const refUrls = refIds.length
            ? await Promise.all(refIds.map((id) => assetIdToSignedUrl(id, user.id, 60 * 10)))
            : [];

          const image_list = refUrls.map((u) => ({ image: u }));

          // ✅ Elements (Kling Element Library) -> element_list
          // Nota: element_id puede ser "long" (18+ dígitos), NO lo conviertas a Number (pierde precisión).
          let element_list = [];
          let element_recipe = []; // para guardar en meta (IDs + name + preview_path)
          if (Array.isArray(klingElementIds) && klingElementIds.length) {
            if (klingElementIds.length > 5) {
              throw httpError(400, "KLING_TOO_MANY_ELEMENTS", "No puedes usar más de 5 elements a la vez.", {
                max: 5,
                received: klingElementIds.length,
              });
            }

            const { data: rows, error: rowsErr } = await supabaseAdmin
              .from("kling_elements")
              .select("id, kling_element_id, name, preview_path")
              .eq("owner_id", user.id)
              .in("id", klingElementIds);

            if (rowsErr) {
              throw httpError(500, "DB_SELECT_FAILED", "No se pudieron leer tus Kling elements.", {
                table: "kling_elements",
                error: rowsErr,
              });
            }

            const byId = new Map((rows || []).map((r) => [r.id, r]));
            const missing = klingElementIds.filter((id) => !byId.has(id));
            if (missing.length) {
              throw httpError(404, "KLING_ELEMENTS_NOT_FOUND", "Algunos elements no existen o no te pertenecen.", { missing });
            }

            // Mantener el orden exacto que envía el frontend
            const ordered = klingElementIds.map((id) => byId.get(id));

            // para "receta" (front-end puede renderizar nombres rápido)
            element_recipe = ordered.map((r) => ({
              id: r.id,
              name: r.name || null,
              preview_path: r.preview_path || null,
            }));

            element_list = ordered
              .map((r) => String(r.kling_element_id || "").trim())
              .filter(Boolean)
              .map((eid) => ({ element_id: eid }));
          }

          // ✅ Validación: images + elements comparten el pool de 10 slots
          if (image_list.length + element_list.length > 10) {
            throw httpError(400, "KLING_TOO_MANY_REFERENCES", "La suma de referencias (images + elements) no puede ser mayor que 10.", {
              images: image_list.length,
              elements: element_list.length,
              maxTotal: 10,
            });
          }

          // (Opcional) firmar previews para render rápido en "receta".
          // OJO: URLs firmadas expiran; por eso también guardamos preview_path + name.
          let klingElementPreviewUrls = [];
          if (Array.isArray(element_recipe) && element_recipe.length) {
            klingElementPreviewUrls = await Promise.all(
              element_recipe.map(async (r) => {
                const p = r?.preview_path;
                return p ? await signStoragePath(p, urlExpiresInSeconds) : null;
              })
            );
          }

          const klingElementRecipe = Array.isArray(element_recipe)
            ? element_recipe.map((r, i) => ({
                id: r?.id,
                name: r?.name || null,
                previewPath: r?.preview_path || null,
                previewUrl: klingElementPreviewUrls[i] || null,
              }))
            : [];

          // Si hay imágenes y el prompt NO trae <<<image_#>>>, añadimos placeholders automáticamente
          let promptForKling = String(prompt || "");
          if (image_list.length) {
            const hasPlaceholders = /<<<\s*image_\d+\s*>>>/i.test(promptForKling);
            if (!hasPlaceholders) {
              const placeholders = image_list.map((_, i) => `<<<image_${i + 1}>>>`).join(" ");
              promptForKling = `${promptForKling}\n\n${placeholders}`.trim();
            }
          }

          // ✅ Prompt templating para elements:
          // Si el usuario no incluyó referencias, auto-agrega <<<element_1>>> ... según selección.
          // (y si ya lo escribió, no lo duplicamos)
          if (element_list.length) {
            const used = new Set();

            // Detecta <<<element_1>>> ...
            const reRich = /<<<\s*element_(\d+)\s*>>>/gi;
            for (const m of promptForKling.matchAll(reRich)) used.add(Number(m[1]));

            // Detecta @element_1 ... (por si el usuario lo escribe así)
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

          // Base URL robusta (acepta que pongas https://api.klingai.com o https://api.klingai.com/v1)
          let baseUrl = (process.env.KLING_BASE_URL || "https://api.klingai.com").replace(/\/+$/g, "");
          if (!/\/v1$/.test(baseUrl)) baseUrl = `${baseUrl}/v1`;

          const createPayload = {
            model_name: modelName,          // kling-image-o1
            prompt: promptForKling,         // <= 2500 chars (tu frontend ya lo limita)
            n: nRequested,                  // 1..9
            aspect_ratio: klingAspectRatio, // auto | 1:1 | 3:4 | ...
            resolution: klingResolution,    // 1k | 2k
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

          // Kling puede devolver HTTP 200 con code != 0, validamos ambos
          if (!createResp.ok || (createJson && typeof createJson.code === "number" && createJson.code !== 0)) {
            throw httpError(
              502,
              "KLING_SUBMIT_FAILED",
              `Kling: error al crear tarea (${createResp.status}).`,
              { response: createJson || createText }
            );
          }

          const taskId = createJson?.data?.task_id || createJson?.task_id || createJson?.data?.id || createJson?.id;

          if (!taskId) {
            throw httpError(502, "KLING_BAD_RESPONSE", "Kling no devolvió task_id.", {
              response: createJson || createText,
            });
          }

          // Poll hasta completar (submitted -> processing -> succeed/failed)
          let finalJson = null;
          const maxPolls = 90; // ~3 min (2s por poll)
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
              throw httpError(
                502,
                "KLING_POLL_FAILED",
                `Kling: error al consultar tarea (${pollResp.status}).`,
                { response: pollJson || pollText }
              );
            }

            const status = pollJson?.data?.task_status || pollJson?.task_status;

            if (status === "succeed") {
              finalJson = pollJson;
              break;
            }

            if (status === "failed") {
              throw httpError(502, "KLING_TASK_FAILED", "Kling: la tarea falló.", {
                response: pollJson,
              });
            }
          }

          if (!finalJson) {
            throw httpError(504, "KLING_TIMEOUT", "Kling: timeout esperando el resultado.", { taskId });
          }

          const imagesArr = finalJson?.data?.task_result?.images || [];

          const urls = imagesArr
            .map((x) => x?.url)
            .filter(Boolean)
            .slice(0, nRequested);

          if (!urls.length) {
            throw httpError(502, "KLING_NO_IMAGES", "Kling: tarea completada pero sin URLs de imagen.", {
              response: finalJson,
            });
          }

          const items = [];
          for (const imageUrl of urls) {
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) {
              throw httpError(
                502,
                "KLING_IMAGE_DOWNLOAD_FAILED",
                `Kling: no pude descargar la imagen final (${imgRes.status}).`,
                { imageUrl }
              );
            }

            const buf = Buffer.from(await imgRes.arrayBuffer());
            const mime = imgRes.headers.get("content-type") || "image/png";
            const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

            const { storagePath } = await uploadBase64ToStorage({
              userId: user.id,
              tool: toolName,
              dataUrl,
              nameHint: hint,
            });

            const meta = {
              tool: toolName,
              provider: "kling",
              model: selectedModel,
              klingModelName: modelName,
              klingTaskId: taskId,
              aspectRatio: klingAspectRatio,
              quality: klingResolution,
              count: nRequested,
              characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
              styleAssetId: styleAssetId || null,
              backgroundAssetId: backgroundAssetId || null,
              klingElementIds: Array.isArray(klingElementIds) ? klingElementIds : [],
              // "Receta" opcional para render rápido (los previewUrl expiran).
              klingElementRecipe,
            };

            const assetId = await insertAssetRow({
              ownerId: user.id,
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

          return res.json({
            ok: true,
            items,
            url: items[0]?.url,
            assetId: items[0]?.assetId,
            urlExpiresInSeconds,
          });
        }

    // =============================
    // KLING 3.0 (Fal.ai) — kling-image/v3 + kling-image/o3
    // Docs (Fal):
    // - fal-ai/kling-image/v3/text-to-image
    // - fal-ai/kling-image/o3/image-to-image
    // =============================
    if (selectedModel.startsWith("fal-ai/kling-image/")) {
      const nRequested = Math.max(1, Math.min(Number(count || 1), 9, maxCount));
      const toolName = tool || "image-generator";
      const hint = nameHint || "generated";
      const urlExpiresInSeconds = 60 * 60;

      // Referencias (máx 10 para O3)
      const refIds = [
        ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
        ...(backgroundAssetId ? [backgroundAssetId] : []),
        ...(styleAssetId ? [styleAssetId] : []),
      ]
        .filter(Boolean)
        .slice(0, 10);

      const refUrls = refIds.length
        ? await Promise.all(refIds.map((id) => assetIdToSignedUrl(id, user.id, 60 * 10)))
        : [];

      const allowedAR = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"]);
      const rawAR = (aspectRatio || "auto").trim();
      const mappedAR = rawAR === "4:5" ? "3:4" : rawAR;
      const falAspectRatio = allowedAR.has(mappedAR) ? mappedAR : "auto";

      const falResolution = String(quality || "1K").toUpperCase().trim();
      const isO3 = selectedModel.includes("/o3/");
      const isV3 = selectedModel.includes("/v3/");

      // V3 Standard no soporta 4K (solo 1K/2K)
      const resolutionForModel = isV3 && falResolution === "4K" ? "2K" : falResolution;

      function ensureO3Prompt(p, nImages) {
        const base = String(p || "").trim();
        if (!base) return base;
        if (/@Image\d+/i.test(base)) return base;
        const tags = Array.from({ length: nImages }, (_, i) => `@Image${i + 1}`).join(", ");
        return `${base}\n\nUse the reference images ${tags} as visual guidance.`;
      }

      let falInput = {};

      // O3: image-to-image (multi-ref)
      if (isO3 && selectedModel.endsWith("/image-to-image")) {
        if (!refUrls.length) {
          throw httpError(
            400,
            "FAL_KLING_MISSING_REFERENCE",
            "Kling O3 (Fal) necesita al menos 1 imagen de referencia. Agrega una Reference o usa el modelo de texto (V3)."
          );
        }

        const safePrompt = ensureO3Prompt(prompt, refUrls.length);

        falInput = {
          prompt: safePrompt,
          image_urls: refUrls,
          resolution: resolutionForModel === "4K" || resolutionForModel === "2K" ? resolutionForModel : "1K",
          num_images: nRequested,
          // "auto" está permitido en O3 (detección inteligente)
          aspect_ratio: falAspectRatio,
          output_format: "png",
          // Para que responda imágenes sueltas (no serie)
          result_type: "single",
        };
      }

      // V3: text-to-image
      else if (isV3 && selectedModel.endsWith("/text-to-image")) {
        falInput = {
          prompt: String(prompt || "").trim(),
          resolution: resolutionForModel === "2K" ? "2K" : "1K",
          num_images: nRequested,
          // V3 no documenta "auto"; usamos default si viene "auto"
          ...(falAspectRatio !== "auto" ? { aspect_ratio: falAspectRatio } : {}),
          output_format: "png",
        };
      }

      // V3: image-to-image (1 sola referencia)
      else if (isV3 && selectedModel.endsWith("/image-to-image")) {
        if (!refUrls[0]) {
          throw httpError(
            400,
            "FAL_KLING_MISSING_REFERENCE",
            "Kling V3 image-to-image (Fal) necesita 1 imagen de referencia."
          );
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
        throw httpError(400, "MODEL_NOT_SUPPORTED", `Fal Kling model not supported: ${selectedModel}`);
      }

      // Ejecutar en Fal Queue
      const falJson = await falQueueRun(selectedModel, falInput);
      const images = falJson?.images || falJson?.data?.images || [];
      const urls = (Array.isArray(images) ? images : [])
        .map((x) => x?.url)
        .filter(Boolean)
        .slice(0, nRequested);

      if (!urls.length) {
        throw httpError(502, "FAL_NO_IMAGES", "Fal: tarea completada pero sin URLs de imagen.", { response: falJson });
      }

      const items = [];
      for (const imageUrl of urls) {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
          throw httpError(502, "FAL_IMAGE_DOWNLOAD_FAILED", `Fal: no pude descargar la imagen final (${imgRes.status}).`, {
            imageUrl,
          });
        }

        const buf = Buffer.from(await imgRes.arrayBuffer());
        const mime = imgRes.headers.get("content-type") || "image/png";
        const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

        const { storagePath } = await uploadBase64ToStorage({
          userId: user.id,
          tool: toolName,
          dataUrl,
          nameHint: hint,
        });

        const meta = {
          tool: toolName,
          provider: "fal",
          model: selectedModel,
          aspectRatio: falAspectRatio,
          quality: resolutionForModel,
          count: nRequested,
          characterAssetIds: Array.isArray(characterAssetIds) ? characterAssetIds : [],
          styleAssetId: styleAssetId || null,
          backgroundAssetId: backgroundAssetId || null,
        };

        const assetId = await insertAssetRow({
          ownerId: user.id,
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

      return res.json({
        ok: true,
        items,
        url: items[0]?.url,
        assetId: items[0]?.assetId,
        urlExpiresInSeconds,
      });
    }

    // 1) Validar que el modelo sea de imagen
    if (!isImageGenModel(selectedModel)) {
      apiError(
        400,
        "MODEL_NOT_IMAGE",
        `El modelo "${selectedModel}" no genera imágenes. Usa "gemini-2.5-flash-image" o "gemini-3-pro-image-preview".`
      );
    }

    // 2) Validar quality según modelo
    if (quality) {
      if (selectedModel === "gemini-2.5-flash-image" && quality !== "1K") {
        apiError(
          400,
          "QUALITY_NOT_SUPPORTED",
          `Gemini 2.5 Flash Image solo soporta 1K. Usa 1K o cambia a gemini-3-pro-image-preview para 2K/4K.`
        );
      }
      if (selectedModel.includes("imagen") && quality === "4K") {
        apiError(
          400,
          "QUALITY_NOT_SUPPORTED",
          `Imagen no soporta 4K aquí. Para 4K usa gemini-3-pro-image-preview.`
        );
      }
    }

    // 3) Config correcta para que DEVUELVA IMAGEN
    const config = {
      responseModalities: ["Image"],
      imageConfig: {},
    };

    if (arNonOpenAI) config.imageConfig.aspectRatio = arNonOpenAI;

    // imageSize SOLO en gemini-3-pro-image-preview (y en imagen para 1K/2K)
    if (selectedModel === "gemini-3-pro-image-preview" && quality) {
      config.imageConfig.imageSize = quality; // "1K" | "2K" | "4K"
    } else if (selectedModel.includes("imagen") && quality && quality !== "4K") {
      config.imageConfig.imageSize = quality; // "1K" | "2K"
    }

    // 4) Referencias opcionales (IDs de assets guardados en tu DB)
    const refs = [
      ...((characterAssetIds || []).map((id, i) => ({ label: `Character reference ${i + 1}`, id }))),
      ...(styleAssetId ? [{ label: "Style reference", id: styleAssetId }] : []),
      ...(backgroundAssetId ? [{ label: "Background reference", id: backgroundAssetId }] : []),
    ];
    const hasRefs = refs.length > 0;

    // 5) Generar N imágenes (1..4)
    const nRequested = Math.min(Number(count || 1), maxCount);
    const toolName = tool || "image-generator";
    const hint = nameHint || "generated";
    const items = [];
    const urlExpiresInSeconds = 60 * 60;

    // --- Imagen models: usar generateImages (generateContent NO devuelve bytes de imagen) ---
    const aiClient = await ensureAI();
    if (selectedModel.includes("imagen")) {
      if (hasRefs) {
        throw httpError(
          400,
          "REFS_NOT_SUPPORTED",
          "Los modelos Imagen no aceptan imágenes de referencia en este endpoint. Selecciona NanoBanana / NanoBanana Pro para usar referencias."
        );
      }

      const n = selectedModel.includes("ultra") ? 1 : nRequested;

      const imgConfig = {
        numberOfImages: n,
      };

      if (aspectRatio) imgConfig.aspectRatio = aspectRatio;
      if (quality && quality !== "4K") imgConfig.imageSize = quality; // Imagen: 1K | 2K

      const response = await aiClient.models.generateImages({
        model: selectedModel,
        prompt,
        config: imgConfig,
      });

      const generated = Array.isArray(response?.generatedImages) ? response.generatedImages : [];
      if (!generated.length) {
        throw httpError(500, "GENERATION_REJECTED", "No image generated.", {
          hasGeneratedImages: false,
          generatedCount: 0,
        });
      }

      for (const g of generated) {
        const b64 = g?.image?.imageBytes;
        if (!b64) continue;

        const dataUrl = `data:image/png;base64,${b64}`;

        const { storagePath } = await uploadBase64ToStorage({
          userId: user.id,
          tool: toolName,
          dataUrl,
          nameHint: hint,
        });

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "image",
          tool: toolName,
          name: hint,
          prompt,
          storagePath,
          isPublic: false,
          meta: {
            tool: toolName,
            model: selectedModel,
            aspectRatio: aspectRatio || null,
            quality: quality || null,
            count: generated.length,
            characterAssetIds: [],
            styleAssetId: null,
            backgroundAssetId: null,
          },
        });

        const url = await signStoragePath(storagePath, urlExpiresInSeconds);
        items.push({ url, assetId });
      }

      if (!items.length) {
        throw httpError(500, "GENERATION_REJECTED", "No image generated.", {
          hasGeneratedImages: true,
          generatedCount: generated.length,
          savedCount: 0,
        });
      }

      return res.json({
        ok: true,
        items,
        url: items[0]?.url,
        assetId: items[0]?.assetId,
        urlExpiresInSeconds,
      });
    }

    // --- Gemini image models: generateContent con partes (texto + refs) ---
    const parts = [];
    for (const ref of refs) {
      parts.push({ text: `${ref.label}:` });
      parts.push(await assetIdToInlinePart(ref.id, user.id));
    }
    parts.push({ text: prompt });

    const n = nRequested;

    for (let i = 0; i < n; i++) {
      const response = await aiClient.models.generateContent({
        model: selectedModel,
        contents: [{ role: "user", parts }],
        config,
      });

      const dataUrl = await extractImageDataUrl(response);

      const { storagePath } = await uploadBase64ToStorage({
        userId: user.id,
        tool: toolName,
        dataUrl,
        nameHint: hint,
      });

      const assetId = await insertAssetRow({
        ownerId: user.id,
        type: "image",
        tool: toolName,
        name: hint,
        prompt,
        storagePath,
        isPublic: false,
        meta: {
          tool: toolName,
          model: selectedModel,
          aspectRatio: aspectRatio || null,
          quality: quality || null,
          count: n,
          characterAssetIds: characterAssetIds || [],
          styleAssetId: styleAssetId || null,
          backgroundAssetId: backgroundAssetId || null,
        },
      });

      const url = await signStoragePath(storagePath, urlExpiresInSeconds);
      items.push({ url, assetId });
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

router.post("/ai/restyle", async (req, res, next) => {
  try {
    const aiClient = await ensureAI();
    const body = RestyleSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const selectedModel = body.model || "imagen-3.0-generate-002";

    const { mimeType, base64 } = parseDataUrl(body.imageDataUrl);
    const prompt = body.prompt || "Restyle this image with high quality.";

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
    });

    const dataUrl = await extractImageDataUrl(response);

    const { storagePath } = await uploadBase64ToStorage({
      userId: user.id,
      tool: "restyler",
      dataUrl,
      nameHint: "restyle",
    });

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: "image",
      tool: "restyler",
      name: "restyle",
      prompt,
      storagePath,
      isPublic: false,
      meta: {
        toolVersion: 1,
      },
    });

    const urlExpiresInSeconds = 60 * 60;
    const url = await signStoragePath(storagePath, urlExpiresInSeconds);

    return res.json({ ok: true, url, assetId, urlExpiresInSeconds });
  } catch (err) {
    next(err);
  }
});
  // --- PASTE END ---

  return router;
}
