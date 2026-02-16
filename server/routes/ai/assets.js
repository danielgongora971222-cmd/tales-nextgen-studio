import express from "express";
import { UploadAssetSchema } from "../../schemas/index.js";

export function createAssetsRouter(ctx) {
  const router = express.Router();

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

  // 2) Borrar del storage si existe
  if (row.storage_path) {
    const { error: rmErr } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .remove([row.storage_path]);

    // Si falla, reportamos error (para evitar DB sin archivo o viceversa)
    if (rmErr) {
      return res.status(500).json({
        ok: false,
        error: { code: "STORAGE_DELETE_FAILED", message: rmErr.message },
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
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

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
        url = await signStoragePath(row.storage_path, 60 * 60); // 1 hora
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

router.post("/assets/upload", async (req, res, next) => {
  try {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const { dataUrl, name, tool, type, category } = UploadAssetSchema.parse(req.body);

    const toolName = tool || "upload";
    const assetType = type || "image";

    const { storagePath, mimeType, sizeBytes } = await uploadBase64ToStorage({
      userId: user.id,
      tool: toolName,
      dataUrl,
      nameHint: name || "upload",
    });

    // Este endpoint es SOLO para subir un asset (por ejemplo, una referencia).
    // No está ligado a la generación.
    const meta = {
      source: "upload",
      tool: toolName,
      category: category || null,
      createdAt: new Date().toISOString(),
      originalMimeType: mime,
      sizeBytes: buffer.length,
    };

    const assetId = await insertAssetRow({
      ownerId: user.id,
      type: assetType,
      tool: toolName,
      name: name || "upload",
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
        name: name || "upload",
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
