import express from "express";
import multer from "multer";
import { UploadAssetSchema, PresignUploadSchema, CompleteUploadSchema } from "../../schemas/index.js";

export function createAssetsRouter(ctx) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });


  const {
    // deps/core
    supabaseAdmin,
    requireUser,
    getClientIp,
    apiError,
    httpError,

    // storage helpers
    parseDataUrl,
    extFromMime,
    safeSlug,
    buildAssetPath,
    uploadBase64ToStorage,
    uploadBufferToStorage,
    signStoragePath,
    deleteStoragePath,
    createClientUploadTarget,
    insertAssetRow,

    // env/flags
    APP_ENV,
    NODE_ENV,
    SUPABASE_BUCKET,

    // cualquier otro helper/const que tus endpoints de assets usen
    ...rest
  } = ctx;

  /**
   * 👇 Aquí pegaremos TODOS los endpoints que empiecen con /api/assets
   * Cambiando solo:
   *   router.get("/api/assets...")  -> router.get("/assets...")
   *   router.post("/api/assets...") -> router.post("/assets...")
   *   etc.
   */

  // --- PASTE START ---
  // ===============================
// Assets: delete (owner only)
// DELETE /api/assets/:id
// ===============================
router.delete("/assets/:id", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  // 1) Buscar asset y validar dueño
  const { data: row, error: qErr } = await supabaseAdmin
    .from("assets")
    .select("id, owner_id, storage_path")
    .eq("id", assetId)
    .maybeSingle();

  if (qErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_QUERY_FAILED", message: qErr.message },
    });
  }

  if (!row) {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Asset no encontrado." },
    });
  }

  if (row.owner_id !== user.id) {
    return res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "No tienes permiso para eliminar este asset." },
    });
  }

  // 2) Borrar del storage si existe (compatible: Supabase o R2)
  if (row.storage_path) {
    try {
      await deleteStoragePath(row.storage_path);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "STORAGE_DELETE_FAILED", message: e?.message || "No se pudo borrar el archivo." },
      });
    }
  }

  // 3) Borrar fila en DB
  const { error: delErr } = await supabaseAdmin
    .from("assets")
    .delete()
    .eq("id", assetId)
    .eq("owner_id", user.id);

  if (delErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_DELETE_FAILED", message: delErr.message },
    });
  }

  return res.json({ ok: true, id: assetId });
});

// ===============================
// Assets: historial del usuario (DB)
// GET /api/assets?type=image&limit=50
// ===============================
router.get("/assets", async (req, res) => {
  // 1) exigir login
  const scope = typeof req.query.scope === "string" ? req.query.scope : "my";
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  // 2) leer filtros simples
    const type = typeof req.query.type === "string" ? req.query.type : null;
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

  // 3) pedir assets del usuario a la DB
  let q = supabaseAdmin
    .from("assets")
    .select("id, url, storage_path, type, name, prompt, created_at, owner_id, is_public, meta")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope === "public") {
    q = q.eq("is_public", true);
  } else {
    q = q.eq("owner_id", user.id);
  }

  if (type) q = q.eq("type", type);

  const { data, error: dbErr } = await q;

  if (dbErr) {
    console.error("[DB_QUERY_FAILED]", dbErr);
    return res.status(500).json({
      ok: false,
      error: { code: "DB_QUERY_FAILED", message: dbErr.message },
    });
  }

  // 4) convertir a la forma que el frontend espera (Asset de types.ts)
  //    + generar signed URLs cuando url está null pero hay storage_path
  const rows = data || [];

  const items = await Promise.all(
    rows.map(async (row) => {
      let url = row.url || null;

      // Si no hay url guardada, la generamos firmada desde storage_path
      if (!url && row.storage_path) {
        url = await signStoragePath(row.storage_path, 60 * 60 * 6); // 6 horas
      }

      // createdAt: soporta string timestamp o number (ms)
      const createdAt =
        typeof row.created_at === "string"
          ? new Date(row.created_at).getTime()
          : row.created_at || Date.now();

      return {
        id: row.id,
        url,
        type: row.type === "video" ? "video" : "image",
        name: row.name || `Generation ${String(row.id).slice(0, 4)}`,
        prompt: row.prompt || undefined,
        meta: row.meta ?? null,
        createdAt,
        ownerId: row.owner_id,
        isPublic: !!row.is_public,
        likes: [],
        comments: [],
      };
    })
  );

    return res.json({ ok: true, items });
});

router.post("/assets/:id/unpublish", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  const { data, error: upErr } = await supabaseAdmin
    .from("assets")
    .update({ is_public: false })
    .eq("id", assetId)
    .eq("owner_id", user.id)
    .select("id,is_public")
    .single();

  if (upErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_UPDATE_FAILED", message: upErr.message },
    });
  }

  if (!data) {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Asset no encontrado o no es tuyo." },
    });
  }

  return res.json({ ok: true, id: data.id, isPublic: !!data.is_public });
});

// ===============================
// Assets: presign upload (direct-to-storage)
// POST /api/assets/presign-upload
// ===============================
router.post("/assets/presign-upload", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  let input;
  try {
    input = PresignUploadSchema.parse(req.body);
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Payload inválido", details: e?.errors || null },
    });
  }

  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 524288000); // 500MB default
  if (input.sizeBytes && input.sizeBytes > maxBytes) {
    return res.status(413).json({
      ok: false,
      error: { code: "FILE_TOO_LARGE", message: `Archivo demasiado grande. Máximo ${maxBytes} bytes.` },
    });
  }

  const inferredType = input.type || (String(input.mimeType || "").startsWith("video") ? "video" : "image");
  const tool = input.tool || "upload";
  const name = input.name || "upload";

  try {
    const upload = await createClientUploadTarget({
      userId: user.id,
      tool,
      mimeType: input.mimeType,
      nameHint: name,
      expiresSeconds: input.expiresSeconds || 15 * 60,
    });

    return res.json({
      ok: true,
      upload,
      inferred: { type: inferredType },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "PRESIGN_FAILED", message: e?.message || "No se pudo crear presigned upload." },
    });
  }
});

// ===============================
// Assets: complete upload (register in DB)
// POST /api/assets/complete-upload
// ===============================
router.post("/assets/complete-upload", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  let input;
  try {
    input = CompleteUploadSchema.parse(req.body);
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Payload inválido", details: e?.errors || null },
    });
  }

  const storagePath = input.storagePath;
  const keyForCheck = String(storagePath).replace(/^r2:/, "");

  if (!keyForCheck.startsWith(`${user.id}/`)) {
    return res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN_STORAGE_PATH", message: "storagePath no pertenece al usuario." },
    });
  }

  const type = input.type || (String(input.mimeType || "").startsWith("video") ? "video" : "image");
  const tool = input.tool || "upload";
  const name = input.name || "upload";

  const meta = {
    category: input.category || null,
    mimeType: input.mimeType || null,
    sizeBytes: input.sizeBytes || null,
    source: "user_upload_direct",
  };

  try {
    const assetId = await insertAssetRow({
      ownerId: user.id,
      type,
      tool,
      name,
      prompt: null,
      storagePath,
      isPublic: false,
      meta,
    });

    const url = await signStoragePath(storagePath, 60 * 60);

    return res.json({
      ok: true,
      item: {
        id: assetId,
        url,
        type,
        name,
        createdAt: Date.now(),
        ownerId: user.id,
        isPublic: false,
        meta,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "COMPLETE_UPLOAD_FAILED", message: e?.message || "No se pudo completar el upload." },
    });
  }
});

router.post("/assets/upload", upload.single("file"), async (req, res, next) => {
  try {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // Soportamos 2 modos:
    // 1) multipart/form-data con req.file (recomendado)
    // 2) JSON con dataUrl (compatibilidad)

    let toolName = "upload";
    let assetType = "image";
    let name = "upload";
    let category = null;

    let storagePath;
    let mimeType;
    let sizeBytes;

    if (req.file) {
      // ---- MODO MULTIPART ----
      const body = req.body || {};

      toolName = typeof body.tool === "string" && body.tool.trim() ? body.tool.trim() : "upload";
      name =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : (req.file.originalname || "upload");

      category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;

      const forcedType = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";
      const inferred = req.file.mimetype?.startsWith("video") ? "video" : "image";
      assetType = forcedType === "video" || forcedType === "image" ? forcedType : inferred;

      const up = await uploadBufferToStorage({
        userId: user.id,
        tool: toolName,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype || "application/octet-stream",
        nameHint: name,
      });

      storagePath = up.storagePath;
      mimeType = up.mimeType;
      sizeBytes = up.sizeBytes;
    } else {
      // ---- MODO JSON (BASE64) ----
      const parsed = UploadAssetSchema.parse(req.body);

      toolName = parsed.tool || "upload";
      assetType = parsed.type || "image";
      name = parsed.name || "upload";
      category = parsed.category || null;

      const up = await uploadBase64ToStorage({
        userId: user.id,
        tool: toolName,
        dataUrl: parsed.dataUrl,
        nameHint: name,
      });

      storagePath = up.storagePath;
      mimeType = up.mimeType;
      sizeBytes = up.sizeBytes;
    }

    const meta = {
      source: "upload",
      tool: toolName,
      category,
      createdAt: new Date().toISOString(),
      originalMimeType: mimeType,
      sizeBytes,
    };

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: assetType,
      tool: toolName,
      name,
      prompt: null,
      storagePath,
      isPublic: false,
      meta,
    });

    const url = await signStoragePath(storagePath);

    return res.json({
      ok: true,
      item: {
        id: assetId,
        url,
        type: assetType,
        tool: toolName,
        name,
        ownerId: user.id,
        isPublic: false,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ===============================
// Assets visibility: publish / unpublish
// POST /api/assets/:id/publish
// POST /api/assets/:id/unpublish
// ===============================

router.post("/assets/:id/publish", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  const { data, error: upErr } = await supabaseAdmin
    .from("assets")
    .update({ is_public: true })
    .eq("id", assetId)
    .eq("owner_id", user.id)
    .select("id,is_public")
    .single();

  if (upErr) {
    return res.status(500).json({
      ok: false,
      error: { code: "DB_UPDATE_FAILED", message: upErr.message },
    });
  }

  if (!data) {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Asset no encontrado o no es tuyo." },
    });
  }

  return res.json({ ok: true, id: data.id, isPublic: !!data.is_public });
});

  // --- PASTE END ---

  return router;
}
