import express from "express";
import {
  ImageRequestSchema,
  RestyleSchema,
  FaceSwapSchema,
  UpscaleSchema,
  UploadAssetSchema,
} from "../../schemas/index.js";
import { checkUserRateLimit } from "../../lib/userRateLimit.js";
import { assertJobLimits } from "../../lib/jobLimits.js";
import { estimateImageCostCredits } from "../../../config/pricing.js";

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

    // ai helpers (definidos en server.js y pasados por ctx)
    maxCountForImageModel,
    isImageGenModel,
    extractImageDataUrl,
    parseOpenAIImageModel,
    openaiSizeFromAspectRatio,
    openaiGenerateImageDataUrl,
    falDimsFromAspectQuality,
    falQueueRun,
    bflSubmit,
    bflPoll,
    bflSampleToDataUrl,
    makeKlingJwt,
    sleep,
    assetIdToSignedUrl,
    assetIdToInlinePart,
    assetIdToImageFile,


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

        // ✅ @mentions binding
        promptReferences,

        // ✅ Camera Angles (Qwen Multiple Angles)
        horizontalAngle,
        verticalAngle,
        zoom,
        loraScale,
        sync,
        async: asyncFlag,
      } = ImageRequestSchema.parse(req.body);


    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // ✅ Requiere plan activo
    const active = await ctx.billing.requireActiveSubscription(user.id);
    if (active.error) return res.status(403).json({ ok: false, error: active.error });

    const rl = await checkUserRateLimit({
      userId: user.id,
      scope: "ai_image_generate",
      windowMs: 60 * 1000,
      max: 8,
    });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes de imagen por usuario. Espera un momento.",
          details: { scope: "ai_image_generate_user", retryAfterSeconds: rl.retryAfterSeconds },
        },
      });
    }

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
    // @mentions binding (token -> asset) for robust multi-reference prompts
    // =============================
    const legacyRefs = [
      ...((characterAssetIds || []).map((id, i) => ({ label: `Character reference ${i + 1}`, id }))),
      ...(styleAssetId ? [{ label: "Style reference", id: styleAssetId }] : []),
      ...(backgroundAssetId ? [{ label: "Background reference", id: backgroundAssetId }] : []),
    ];

    const tokenRefs = (() => {
      const list = Array.isArray(promptReferences) ? promptReferences : [];
      if (!list.length) return [];

      // map token -> { assetId, role }
      const map = new Map();
      for (const r of list) {
        const token = typeof r?.token === "string" ? r.token.trim() : "";
        const assetId = typeof r?.assetId === "string" ? r.assetId.trim() : "";
        const role = typeof r?.role === "string" ? r.role : "character";
        if (!token || !assetId) continue;
        map.set(token, { token, assetId, role });
      }
      if (!map.size) return [];

      // tokens in prompt (unique, in order)
      const orderedTokens = [];
      const seen = new Set();
      const re = /@[a-z0-9_]+/gi;
      const txt = String(prompt || "");
      let m;
      while ((m = re.exec(txt)) !== null) {
        const t = String(m[0]);
        if (seen.has(t)) continue;
        seen.add(t);
        orderedTokens.push(t);
      }

      const out = [];
      const used = new Set();

      for (const t of orderedTokens) {
        const r = map.get(t);
        if (!r) continue;
        used.add(r.token);
        out.push({ label: r.token, id: r.assetId, role: r.role });
      }

      // include remaining bindings not mentioned in prompt (stable order)
      for (const r of map.values()) {
        if (used.has(r.token)) continue;
        out.push({ label: r.token, id: r.assetId, role: r.role });
      }

      return out;
    })();

    const hasTokenRefs = Array.isArray(tokenRefs) && tokenRefs.length > 0;
    const effectiveRefs = hasTokenRefs ? tokenRefs : legacyRefs;

    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const replaceTokenExact = (text, token, replacement) => {
      // match token but NOT as a prefix of a longer token
      const re = new RegExp(`${escapeRegExp(token)}(?![a-z0-9_])`, "g");
      return String(text || "").replace(re, replacement);
    };

    const replaceMentionsWithImageNumbers = (text, refs) => {
      let out = String(text || "");
      for (let i = 0; i < refs.length; i++) {
        const token = refs[i]?.label;
        if (!token) continue;
        out = replaceTokenExact(out, token, `image ${i + 1}`);
      }
      return out;
    };

    const replaceMentionsWithFalImageTags = (text, refs) => {
      let out = String(text || "");
      for (let i = 0; i < refs.length; i++) {
        const token = refs[i]?.label;
        if (!token) continue;
        out = replaceTokenExact(out, token, `@Image${i + 1}`);
      }
      return out;
    };

    const replaceMentionsWithKlingPlaceholders = (text, refs) => {
      let out = String(text || "");
      for (let i = 0; i < refs.length; i++) {
        const token = refs[i]?.label;
        if (!token) continue;
        out = replaceTokenExact(out, token, `<<<image_${i + 1}>>>`);
      }
      return out;
    };

    const appendImageNumberMapping = (text, refs) => {
      if (!refs.length) return String(text || "");
      const mapping = refs.map((r, i) => `image ${i + 1} = ${r.label}`).join(", ");
      return `${String(text || "").trim()}\n\nReference mapping: ${mapping}`.trim();
    };

    // =============================
    // ASYNC JOB (protege de timeouts)
    // =============================
    const wantsSync = Boolean(sync) || asyncFlag === false;
    const wantsAsync = !wantsSync;

    const envName = String(APP_ENV || NODE_ENV || "").toLowerCase();
    const isProdEnv = envName === "production";
    const allowSync = String(process.env.ALLOW_SYNC_REQUESTS || "").trim() === "1";

    if (wantsSync && isProdEnv && !allowSync) {
      throw httpError(400, "SYNC_DISABLED", "Modo sync deshabilitado en producción. Usa async=true.");
    }

    if (wantsAsync) {
      await assertJobLimits({ supabaseAdmin, httpError, ownerId: user.id, kind: "image" });

      const { data: jobRow, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .insert({
          owner_id: user.id,
          kind: "image",
          status: "running",
          next_check_at: new Date().toISOString(),
          params: {
            task: "image_generate",
            prompt,
            model: selectedModel,
            aspectRatio,
            count,
            quality,
            tool,
            nameHint,
            klingElementIds,
            characterAssetIds,
            styleAssetId,
            backgroundAssetId,
            promptReferences,
            horizontalAngle,
            verticalAngle,
            zoom,
            loraScale,
          },
        })
        .select("id")
        .single();

      if (jobErr) {
        throw httpError(500, "JOB_INSERT_FAILED", "No se pudo crear el job de imagen.", { jobErr });
      }

      // ✅ Spend de créditos ANTES de aceptar el job (con idempotencia)
      const costCredits = estimateImageCostCredits({
        model: selectedModel,
        quality,
        count,
      });

      const spend = await ctx.billing.spendCredits({
        userId: user.id,
        amountCredits: costCredits,
        entryType: "ai_image_generate",
        refType: "job",
        refId: jobRow.id,
        idempotencyKey: ctx.billing.getIdempotencyKey(req),
      });

      if (!spend.ok) {
        // rollback best-effort: borrar el job si no se pudo cobrar
        await supabaseAdmin.from("jobs").delete().eq("id", jobRow.id);
        return res.status(402).json({ ok: false, error: spend.error });
      }

      return res.json({ ok: true, jobId: jobRow.id });
    }

    // ✅ Spend de créditos ANTES de ejecutar generación SYNC (con idempotencia)
    const costCredits = estimateImageCostCredits({
      model: selectedModel,
      quality,
      count,
    });

    const spend = await ctx.billing.spendCredits({
      userId: user.id,
      amountCredits: costCredits,
      entryType: "ai_image_generate",
      refType: "sync",
      refId: null,
      idempotencyKey: ctx.billing.getIdempotencyKey(req),
    });

    if (!spend.ok) {
      return res.status(402).json({ ok: false, error: spend.error });
    }

    // =============================
    // OPENAI GPT IMAGE
    // =============================
        if (selectedModel.startsWith("openai:")) {
      const { model: openaiModel, quality: openaiQuality } = parseOpenAIImageModel(selectedModel);

      const refs = effectiveRefs;

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

      const openaiPrompt = hasTokenRefs
        ? appendImageNumberMapping(replaceMentionsWithImageNumbers(prompt, tokenRefs), tokenRefs)
        : prompt;

      for (let i = 0; i < nRequested; i++) {
        const dataUrl = await openaiGenerateImageDataUrl({
          model: openaiModel,         // gpt-image-1.5
          prompt: openaiPrompt,
          size,
          quality: openaiQuality,     // auto | high
          images: imageFiles,         // refs
        })

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
            const refIds = (
        hasTokenRefs
          ? tokenRefs.map((r) => r.id)
          : [
              ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
              ...(backgroundAssetId ? [backgroundAssetId] : []),
              ...(styleAssetId ? [styleAssetId] : []),
            ]
      ).filter(Boolean);

      const refUrls = refIds.length
        ? await Promise.all(refIds.slice(0, 8).map((id) => assetIdToSignedUrl(id, user.id, 60 * 10)))
        : [];

      const tokenRefs8 = hasTokenRefs ? tokenRefs.slice(0, Math.min(refUrls.length, 8)) : [];
      let bflPrompt = prompt;
      if (hasTokenRefs && tokenRefs8.length) {
        bflPrompt = appendImageNumberMapping(replaceMentionsWithImageNumbers(prompt, tokenRefs8), tokenRefs8);
      } else if (refUrls.length) {
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
          const refIds = (
            hasTokenRefs
              ? tokenRefs.map((r) => r.id)
              : [
                  ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
                  ...(backgroundAssetId ? [backgroundAssetId] : []),
                  ...(styleAssetId ? [styleAssetId] : []),
                ]
          )
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
              .select("id, status, status_detail, kling_element_id, name, preview_path")
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

            for (const r of ordered) {
              const st = String(r?.status || "ready");
              if (st !== "ready") {
                throw httpError(
                  400,
                  "KLING_ELEMENT_NOT_READY",
                  "Uno o más Elements todavía se están creando o fallaron. Espera o usa Refresh status.",
                  { id: r?.id || null, status: r?.status || null, statusDetail: r?.status_detail || null }
                );
              }
              if (!String(r?.kling_element_id || "").trim()) {
                throw httpError(
                  400,
                  "KLING_ELEMENT_MISSING_ID",
                  "Un Element no tiene kling_element_id guardado.",
                  { id: r?.id || null }
                );
              }
            }

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
          if (hasTokenRefs) {
            const tokenRefs10 = tokenRefs.slice(0, Math.min(refIds.length, 10));
            promptForKling = replaceMentionsWithKlingPlaceholders(promptForKling, tokenRefs10);
          }
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
      const refIds = (
        hasTokenRefs
          ? tokenRefs.map((r) => r.id)
          : [
              ...(Array.isArray(characterAssetIds) ? characterAssetIds : []),
              ...(backgroundAssetId ? [backgroundAssetId] : []),
              ...(styleAssetId ? [styleAssetId] : []),
            ]
      )
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

        const tokenRefs10 = hasTokenRefs ? tokenRefs.slice(0, Math.min(refUrls.length, 10)) : [];
        const basePrompt = hasTokenRefs && tokenRefs10.length
          ? replaceMentionsWithFalImageTags(prompt, tokenRefs10)
          : prompt;
        const safePrompt = ensureO3Prompt(basePrompt, refUrls.length);


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

    // =============================
    // QWEN MULTIPLE ANGLES (Fal.ai)
    // Endpoint: fal-ai/qwen-image-edit-2511-multiple-angles
    // Genera la misma escena desde diferentes ángulos:
    // - horizontal_angle: 0..360 (0=front, 90=right, 180=back, 270=left)
    // - vertical_angle:  -30..90 (-30=low, 0=eye-level, 90=top-down)
    // - zoom:           0..10  (0=wide, 10=close)
    // - lora_scale:     0..4   (strength)
    // =============================
    if (selectedModel === "fal-ai/qwen-image-edit-2511-multiple-angles") {
      const nRequested = Math.max(1, Math.min(Number(count || 1), 4, maxCount));
      const toolName = tool || "camera-angles";
      const hint = nameHint || "camera-angle";
      const urlExpiresInSeconds = 60 * 60;

      // Para esta herramienta exigimos EXACTAMENTE 1 imagen de referencia
      const refIds = (
        hasTokenRefs
          ? [tokenRefs[0]?.id].filter(Boolean)
          : [
              ...((characterAssetIds || []).map((id) => id)),
              ...(styleAssetId ? [styleAssetId] : []),
              ...(backgroundAssetId ? [backgroundAssetId] : []),
            ]
      ).filter(Boolean);


      if (!refIds.length) {
        throw httpError(
          400,
          "REF_REQUIRED",
          "Camera Angles necesita 1 imagen de referencia. Sube una imagen en el panel izquierdo."
        );
      }
      if (refIds.length > 1) {
        throw httpError(
          400,
          "TOO_MANY_REFS",
          "Camera Angles solo acepta 1 imagen de referencia (no múltiples refs)."
        );
      }

      const refAssetId = refIds[0];
      const refUrl = await assetIdToSignedUrl(refAssetId, user.id, urlExpiresInSeconds);

      const h = typeof horizontalAngle === "number" ? horizontalAngle : 0;
      const v = typeof verticalAngle === "number" ? verticalAngle : 0;
      const z = typeof zoom === "number" ? zoom : 5;
      const ls = typeof loraScale === "number" ? loraScale : 1;

      const extraPrompt = typeof prompt === "string" && prompt.trim().length ? prompt.trim() : undefined;

      const falInput = {
        image_urls: [refUrl],
        horizontal_angle: h,
        vertical_angle: v,
        zoom: z,
        lora_scale: ls,
        additional_prompt: extraPrompt,
        output_format: "png",
        num_images: nRequested,
      };

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
          count: nRequested,
          referenceAssetId: refAssetId,
          horizontalAngle: h,
          verticalAngle: v,
          zoom: z,
          loraScale: ls,
          additionalPrompt: extraPrompt || null,
        };

        const assetId = await insertAssetRow({
          ownerId: user.id,
          type: "image",
          tool: toolName,
          name: hint,
          prompt: extraPrompt || "",
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
    // - si vienen promptReferences, usamos labels = tokens (@img1, @bg, @logo...)
    // - si no, caemos a la lógica legacy (Character reference 1, etc.)
    const refs = effectiveRefs;
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
    const body = RestyleSchema.parse(req.body);

    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // ✅ Requiere plan activo
    const active = await ctx.billing.requireActiveSubscription(user.id);
    if (active.error) return res.status(403).json({ ok: false, error: active.error });

    const rl = await checkUserRateLimit({
      userId: user.id,
      scope: "ai_restyle",
      windowMs: 60 * 1000,
      max: 8,
    });
    if (!rl.ok) {
      return res.status(429).json({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes de restyle por usuario. Espera un momento.",
          details: { scope: "ai_restyle_user", retryAfterSeconds: rl.retryAfterSeconds },
        },
      });
    }

    const selectedModel = body.model || "imagen-3.0-generate-002";
    const wantsSync = Boolean(body.sync) || body.async === false;
    const wantsAsync = !wantsSync;

    const envName = String(APP_ENV || NODE_ENV || "").toLowerCase();
    const isProdEnv = envName === "production";
    const allowSync = String(process.env.ALLOW_SYNC_REQUESTS || "").trim() === "1";

    if (wantsSync && isProdEnv && !allowSync) {
      throw httpError(400, "SYNC_DISABLED", "Modo sync deshabilitado en producción. Usa async=true.");
    }

    if (wantsAsync) {
      if (!body.sourceAssetId) {
        throw httpError(
          400,
          "SOURCE_ASSET_REQUIRED",
          "Para restyle async, envía sourceAssetId (no imageDataUrl)."
        );
      }

      await assertJobLimits({ supabaseAdmin, httpError, ownerId: user.id, kind: "image" });

      const { data: jobRow, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .insert({
          owner_id: user.id,
          kind: "image",
          status: "running",
          next_check_at: new Date().toISOString(),
          params: {
            task: "restyle",
            sourceAssetId: body.sourceAssetId,
            prompt: body.prompt,
            model: selectedModel,
          },
        })
        .select("id")
        .single();

      if (jobErr) {
        throw httpError(500, "JOB_INSERT_FAILED", "No se pudo crear el job de restyle.", { jobErr });
      }

      // ✅ Spend de créditos ANTES de aceptar el job (idempotente)
      const costCredits = estimateImageCostCredits({
        model: selectedModel,
        quality: body.quality,
        count: 1,
      });

      const spend = await ctx.billing.spendCredits({
        userId: user.id,
        amountCredits: costCredits,
        entryType: "ai_restyle",
        refType: "job",
        refId: jobRow.id,
        idempotencyKey: ctx.billing.getIdempotencyKey(req),
      });

      if (!spend.ok) {
        // rollback best-effort: borrar el job si no se pudo cobrar
        await supabaseAdmin.from("jobs").delete().eq("id", jobRow.id);
        return res.status(402).json({ ok: false, error: spend.error });
      }

      return res.json({ ok: true, jobId: jobRow.id });
    }

    // ✅ SYNC (legacy): ejecuta en request (puede tardar)

    // ✅ Spend de créditos ANTES de ejecutar restyle SYNC (idempotente)
    const costCredits = estimateImageCostCredits({
      model: selectedModel,
      quality: body.quality,
      count: 1,
    });

    const spend = await ctx.billing.spendCredits({
      userId: user.id,
      amountCredits: costCredits,
      entryType: "ai_restyle",
      refType: "sync",
      refId: null,
      idempotencyKey: ctx.billing.getIdempotencyKey(req),
    });

    if (!spend.ok) {
      return res.status(402).json({ ok: false, error: spend.error });
    }

    const aiClient = await ensureAI();
    const prompt = body.prompt || "Restyle this image with high quality.";

    const inlinePart = body.sourceAssetId
      ? await assetIdToInlinePart(body.sourceAssetId, user.id, 10 * 60)
      : (() => {
          if (!body.imageDataUrl) {
            throw httpError(400, "IMAGE_REQUIRED", "Missing imageDataUrl or sourceAssetId.");
          }
          const { mimeType, base64 } = parseDataUrl(body.imageDataUrl);
          return { inlineData: { mimeType, data: base64 } };
        })();

    const response = await aiClient.models.generateContent({
      model: selectedModel,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, inlinePart],
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
        toolVersion: 2,
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
