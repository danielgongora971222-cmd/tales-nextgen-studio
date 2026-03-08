import express from "express";
import multer from "multer";
import { UploadAssetSchema, PresignUploadSchema, CompleteUploadSchema, CreateCommentSchema } from "../../schemas/index.js";
import { checkUserRateLimit } from "../../lib/userRateLimit.js";
import { evaluateCommentText, getUserModeration } from "../../lib/moderation.js";

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
    downloadStoragePath,
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

  // ===============================
  // Social helpers (likes/comments)
  // ===============================
  async function hasCommunityAssetEntitlement(assetId, userId) {
    if (!assetId || !userId) return false;

    const { data, error } = await supabaseAdmin
      .from("community_asset_entitlements")
      .select("asset_id")
      .eq("asset_id", assetId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || "No se pudo verificar el acceso al asset.");
    }

    return Boolean(data?.asset_id);
  }

  async function getAssetAccessRow(assetId) {
    const { data, error } = await supabaseAdmin
      .from("assets")
      .select("id, owner_id, is_public")
      .eq("id", assetId)
      .maybeSingle();

    if (error) {
      return { row: null, error: { code: "DB_QUERY_FAILED", message: error.message } };
    }
    if (!data) {
      return { row: null, error: { code: "NOT_FOUND", message: "Asset no encontrado." } };
    }
    return { row: data, error: null };
  }

  function normalizeAssetMeta(raw, invalidMessage = "El campo meta no es JSON válido.") {
    if (!raw) return {};

    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        return {};
      } catch {
        throw httpError(400, "INVALID_META", invalidMessage);
      }
    }

    if (typeof raw === "object" && !Array.isArray(raw)) {
      return raw;
    }

    return {};
  }

  async function canAccessAsset(row, userId) {
    if (!row) return false;
    if (row.is_public === true) return true;
    if (row.owner_id === userId) return true;
    return await hasCommunityAssetEntitlement(row.id, userId);
  }
  // ===============================
  // Assets: delete / hide for purchased assets
  // DELETE /api/assets/:id
  // ===============================
  router.delete("/assets/:id", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const assetId = req.params.id;

    const { data: row, error: qErr } = await supabaseAdmin
      .from("assets")
      .select("id, owner_id, storage_path, name")
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

    const isOwner = row.owner_id === user.id;

    if (!isOwner) {
      let entitled = false;
      try {
        entitled = await hasCommunityAssetEntitlement(assetId, user.id);
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: { code: "ACCESS_CHECK_FAILED", message: e?.message || "No se pudo verificar el acceso al asset." },
        });
      }

      if (!entitled) {
        return res.status(403).json({
          ok: false,
          error: { code: "FORBIDDEN", message: "No tienes permiso para eliminar este asset." },
        });
      }

      const { data: entitlementRow, error: entitlementErr } = await supabaseAdmin
        .from("community_asset_entitlements")
        .select("listing_id")
        .eq("user_id", user.id)
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (entitlementErr) {
        return res.status(500).json({
          ok: false,
          error: { code: "DB_QUERY_FAILED", message: entitlementErr.message },
        });
      }

      const { error: hideErr } = await supabaseAdmin
        .from("community_hidden_assets")
        .upsert(
          {
            user_id: user.id,
            asset_id: assetId,
            listing_id: entitlementRow?.listing_id || null,
            hidden_at: new Date().toISOString(),
          },
          { onConflict: "user_id,asset_id" }
        );

      if (hideErr) {
        return res.status(500).json({
          ok: false,
          error: { code: "DB_UPSERT_FAILED", message: hideErr.message },
        });
      }

      return res.json({ ok: true, id: assetId, mode: "hidden" });
    }

    const { data: protectedRows, error: protectedErr } = await supabaseAdmin
      .rpc("community_find_protected_asset_usage", { p_asset_id: assetId });

    if (protectedErr) {
      return res.status(500).json({
        ok: false,
        error: { code: "DB_RPC_FAILED", message: protectedErr.message },
      });
    }

    const protectedUsage = Array.isArray(protectedRows) ? protectedRows[0] : null;
    const hasCompletedPurchases = Boolean(protectedUsage?.has_completed_purchases);
    const linkedListingId = typeof protectedUsage?.listing_id === "string" ? protectedUsage.listing_id : null;

    if (hasCompletedPurchases) {
      return res.status(409).json({
        ok: false,
        error: {
          code: "SOLD_ASSET_LOCKED",
          message: "No puedes eliminar este asset porque ya fue entregado a compradores. Debe conservarse para que esos usuarios sigan pudiendo usarlo.",
          details: {
            assetId,
            listingId: linkedListingId,
            listingStatus: protectedUsage?.listing_status || null,
            usageKind: protectedUsage?.usage_kind || null,
          },
        },
      });
    }

    if (linkedListingId) {
      return res.status(409).json({
        ok: false,
        error: {
          code: "ASSET_IN_USE",
          message: "No puedes eliminar este asset porque sigue formando parte de un listing o receta reutilizable de Community Store. Primero elimínalo o despublícalo ahí.",
          details: {
            assetId,
            listingId: linkedListingId,
            listingName: protectedUsage?.listing_name || null,
            listingStatus: protectedUsage?.listing_status || null,
            usageKind: protectedUsage?.usage_kind || null,
          },
        },
      });
    }

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

    return res.json({ ok: true, id: assetId, mode: "deleted" });
  });

  // ===============================
  // Assets: descargar (binary)
  // GET /api/assets/:id/download
  // ===============================
  router.get("/assets/:id/download", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const assetId = req.params.id;

    const { data: row, error: qErr } = await supabaseAdmin
      .from("assets")
      .select("id, owner_id, is_public, storage_path, url, type, name")
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

    const allowed =
      row.owner_id === user.id ||
      row.is_public === true ||
      (await hasCommunityAssetEntitlement(row.id, user.id));

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "No tienes permiso para descargar este asset." },
      });
    }

    let buffer = null;
    let mimeType = "application/octet-stream";

    try {
      if (row.storage_path) {
        const dl = await downloadStoragePath(row.storage_path);
        buffer = dl.buffer;
        mimeType = dl.mimeType || mimeType;
      } else if (row.url) {
        const upstream = await fetch(row.url);
        if (!upstream.ok) {
          throw new Error(`Upstream download failed (${upstream.status})`);
        }
        const ab = await upstream.arrayBuffer();
        buffer = Buffer.from(ab);
        mimeType = upstream.headers.get("content-type") || mimeType;
      } else {
        return res.status(400).json({
          ok: false,
          error: { code: "NO_STORAGE_PATH", message: "Este asset no tiene storage_path ni url." },
        });
      }
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "ASSET_DOWNLOAD_FAILED", message: e?.message || "No se pudo descargar el archivo." },
      });
    }

    const baseName = String(row.name || `asset-${String(assetId).slice(0, 8)}`);
    const safeBase = baseName.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const ext = extFromMime(mimeType);
    const filename = safeBase.includes(".") ? safeBase : `${safeBase}.${ext}`;

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

    return res.status(200).send(buffer);
  });

  // ===============================
  // Assets: historial del usuario (DB)
  // GET /api/assets?type=image&limit=50
  // ===============================
  router.get("/assets", async (req, res) => {
  // 1) exigir login
  const rawScope = typeof req.query.scope === "string" ? req.query.scope : "my";
  const scope = rawScope === "public" || rawScope === "purchased" ? rawScope : "my";
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  // 2) leer filtros simples
  const type = typeof req.query.type === "string" ? req.query.type : null;
  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

    // 3) pedir assets del usuario a la DB (incluye contadores sociales)
    let rows = [];
    const acquiredMetaByAssetId = new Map();

    if (scope === "purchased") {
      const entitlementFetchLimit = Math.min(Math.max(limit * 8, limit), 2000);

      const { data: entitlementRows, error: entErr } = await supabaseAdmin
        .from("community_asset_entitlements")
        .select("asset_id, listing_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(entitlementFetchLimit);

      if (entErr) {
        console.error("[DB_QUERY_FAILED]", entErr);
        return res.status(500).json({
          ok: false,
          error: { code: "DB_QUERY_FAILED", message: entErr.message },
        });
      }

      const entitledAssetIds = [];
      const seenAssetIds = new Set();

      for (const row of entitlementRows || []) {
        const assetId = typeof row?.asset_id === "string" ? row.asset_id : "";
        if (!assetId || seenAssetIds.has(assetId)) continue;

        seenAssetIds.add(assetId);
        entitledAssetIds.push(assetId);
        acquiredMetaByAssetId.set(assetId, {
          acquiredAt: row?.created_at ? new Date(row.created_at).getTime() : Date.now(),
          listingId: typeof row?.listing_id === "string" ? row.listing_id : null,
        });
      }

      const hiddenAssetIds = new Set();

      if (entitledAssetIds.length > 0) {
        const { data: hiddenRows, error: hiddenErr } = await supabaseAdmin
          .from("community_hidden_assets")
          .select("asset_id")
          .eq("user_id", user.id)
          .in("asset_id", entitledAssetIds);

        if (hiddenErr) {
          console.error("[DB_QUERY_FAILED]", hiddenErr);
          return res.status(500).json({
            ok: false,
            error: { code: "DB_QUERY_FAILED", message: hiddenErr.message },
          });
        }

        for (const hiddenRow of hiddenRows || []) {
          const hiddenId = typeof hiddenRow?.asset_id === "string" ? hiddenRow.asset_id : "";
          if (hiddenId) hiddenAssetIds.add(hiddenId);
        }
      }

      const visibleEntitledAssetIds = entitledAssetIds.filter((id) => !hiddenAssetIds.has(id));

      if (visibleEntitledAssetIds.length > 0) {
        let purchasedQ = supabaseAdmin
          .from("assets")
          .select("id, url, storage_path, type, name, prompt, created_at, owner_id, is_public, meta, likes_count, comments_count")
          .in("id", visibleEntitledAssetIds);

        if (type) purchasedQ = purchasedQ.eq("type", type);

        const { data: purchasedRows, error: purchasedErr } = await purchasedQ;

        if (purchasedErr) {
          console.error("[DB_QUERY_FAILED]", purchasedErr);
          return res.status(500).json({
            ok: false,
            error: { code: "DB_QUERY_FAILED", message: purchasedErr.message },
          });
        }

        rows = (purchasedRows || [])
          .filter((row) => String(row?.owner_id || "") !== String(user.id))
          .sort((a, b) => {
            const ta = Number(acquiredMetaByAssetId.get(a.id)?.acquiredAt || 0);
            const tb = Number(acquiredMetaByAssetId.get(b.id)?.acquiredAt || 0);
            return tb - ta;
          })
          .slice(0, limit);
      }
    } else {
      let q = supabaseAdmin
        .from("assets")
        .select("id, url, storage_path, type, name, prompt, created_at, owner_id, is_public, meta, likes_count, comments_count")
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

      rows = data || [];
    }
  const assetIds = rows.map((r) => r.id).filter(Boolean);

  // 3.5) Community Store listing por asset (solo para scope=my)
  const listingByAssetId = new Map();
  if (scope === "my" && assetIds.length > 0) {
    const { data: listingRows, error: lErr } = await supabaseAdmin
      .from("community_listings")
      .select("id, name, preview_asset_id, status, price_credits, description")
      .eq("seller_id", user.id)
      .in("preview_asset_id", assetIds)
      .neq("status", "deleted");

    if (lErr) {
      return res.status(500).json({
        ok: false,
        error: { code: "DB_QUERY_FAILED", message: lErr.message },
      });
    }

    for (const r of listingRows || []) {
      listingByAssetId.set(r.preview_asset_id, {
        id: r.id,
        name: r.name || "",
        status: r.status,
        priceCredits: Number(r.price_credits) || 0,
        description: r.description || "",
      });
    }
  }

  // 4) likedByMe (consulta en batch)
  const likedSet = new Set();
  if (assetIds.length > 0) {
    const { data: likedRows, error: likedErr } = await supabaseAdmin
      .from("asset_likes")
      .select("asset_id")
      .in("asset_id", assetIds)
      .eq("user_id", user.id);

    if (!likedErr && Array.isArray(likedRows)) {
      for (const r of likedRows) likedSet.add(r.asset_id);
    }
  }

  // 5) preview de comments (últimos 3 por asset) via RPC
  const previewByAsset = new Map();
  if (assetIds.length > 0) {
    const { data: previewRows, error: previewErr } = await supabaseAdmin.rpc(
      "get_asset_comments_preview",
      { asset_ids: assetIds, viewer_id: user.id, per_asset: 3 }
    );

    if (!previewErr && Array.isArray(previewRows)) {
      for (const r of previewRows) {
        const arr = previewByAsset.get(r.asset_id) || [];
        arr.push({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          text: r.text,
          timestamp: new Date(r.created_at).getTime(),
        });
        previewByAsset.set(r.asset_id, arr);
      }
    }
  }

  // 6) construir items y firmar URLs
  const items = await Promise.all(
    rows.map(async (row) => {
      let url = row.url || null;

      if (!url && row.storage_path) {
        url = await signStoragePath(row.storage_path, 60 * 60 * 6); // 6 horas
      }

      const createdAt =
        typeof row.created_at === "string"
          ? new Date(row.created_at).getTime()
          : row.created_at || Date.now();

      const likedByMe = likedSet.has(row.id);
      const likesCount = Number.isFinite(Number(row.likes_count)) ? Number(row.likes_count) : 0;
      const commentsCount = Number.isFinite(Number(row.comments_count)) ? Number(row.comments_count) : 0;
      const comments = previewByAsset.get(row.id) || [];

      const communityListing = listingByAssetId.get(row.id) || null;
      const acquiredMeta = acquiredMetaByAssetId.get(row.id) || null;

      return {
        id: row.id,
        url,
        type: row.type === "video" ? "video" : "image",
        name: row.name || `Generation ${String(row.id).slice(0, 4)}`,
        prompt: scope === "my" ? (row.prompt || undefined) : undefined,
        meta: scope === "my" ? (row.meta ?? null) : null,
        createdAt,
        ownerId: row.owner_id,
        isPublic: !!row.is_public,

        communityListing,
        accessSource: scope === "public" ? "public" : scope === "purchased" ? "purchased" : "owned",
        acquiredAt: acquiredMeta?.acquiredAt || null,
        sourceListingId: acquiredMeta?.listingId || null,

        likedByMe,
        likesCount,
        commentsCount,

        likes: likedByMe ? [user.id] : [],
        comments,
      };
    })
  );

  return res.json({ ok: true, items });
});

// ===============================
// Social: Toggle Like
// POST /api/assets/:id/like
// ===============================
router.post("/assets/:id/like", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  const { row: assetRow, error: assetErr } = await getAssetAccessRow(assetId);
  if (assetErr) return res.status(assetErr.code === "NOT_FOUND" ? 404 : 500).json({ ok: false, error: assetErr });
  if (!(await canAccessAsset(assetRow, user.id))) {
    return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No tienes acceso a este asset." } });
  }

  // ¿Ya existe like?
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("asset_likes")
    .select("id")
    .eq("asset_id", assetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (exErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: exErr.message } });
  }

  let liked = false;

  if (existing?.id) {
    // Unlike
    const { error: delErr } = await supabaseAdmin
      .from("asset_likes")
      .delete()
      .eq("id", existing.id);

    if (delErr) {
      return res.status(500).json({ ok: false, error: { code: "DB_DELETE_FAILED", message: delErr.message } });
    }
    liked = false;
  } else {
    // Like
    const { error: insErr } = await supabaseAdmin
      .from("asset_likes")
      .insert({ asset_id: assetId, user_id: user.id });

    if (insErr) {
      // Si llega duplicado por race condition, lo tratamos como liked=true
      if (String(insErr.code) === "23505") {
        liked = true;
      } else {
        return res.status(500).json({ ok: false, error: { code: "DB_INSERT_FAILED", message: insErr.message } });
      }
    } else {
      liked = true;
    }
  }

  // Leer contador actualizado
  const { data: countRow, error: cntErr } = await supabaseAdmin
    .from("assets")
    .select("likes_count")
    .eq("id", assetId)
    .maybeSingle();

  if (cntErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: cntErr.message } });
  }

  const likesCount = Number.isFinite(Number(countRow?.likes_count)) ? Number(countRow.likes_count) : 0;
  return res.json({ ok: true, liked, likesCount });
});

// ===============================
// Social: List Comments (paginado simple)
// GET /api/assets/:id/comments?limit=50&offset=0
// ===============================
router.get("/assets/:id/comments", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  const { row: assetRow, error: assetErr } = await getAssetAccessRow(assetId);
  if (assetErr) return res.status(assetErr.code === "NOT_FOUND" ? 404 : 500).json({ ok: false, error: assetErr });
  if (!(await canAccessAsset(assetRow, user.id))) {
    return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No tienes acceso a este asset." } });
  }

  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const offsetRaw = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const rl = await checkUserRateLimit({
    userId: user.id,
    scope: "comments_list",
    windowMs: 60 * 1000,
    max: 240,
  });
if (!rl.ok) {
  return res.status(429).json({
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "Demasiadas solicitudes de comentarios. Espera un momento.",
      details: { scope: "comments_list_user", retryAfterSeconds: rl.retryAfterSeconds },
    },
  });
}

const { data: rows, error: cErr, count } = await supabaseAdmin
  .from("asset_comments")
  .select("id, user_id, text, created_at", { count: "exact" })
  .eq("asset_id", assetId)
  .or(`is_shadowed.eq.false,user_id.eq.${user.id}`)
  .order("created_at", { ascending: true })
  .range(offset, offset + limit - 1);

  if (cErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: cErr.message } });
  }

  const commentRows = rows || [];
  const userIds = Array.from(new Set(commentRows.map((r) => r.user_id).filter(Boolean)));

  const usernameById = new Map();
  if (userIds.length > 0) {
    const { data: profileRows, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    if (!pErr && Array.isArray(profileRows)) {
      for (const p of profileRows) {
        usernameById.set(p.id, p.username);
      }
    }
  }

  const comments = commentRows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: usernameById.get(r.user_id) || `User_${String(r.user_id).slice(0, 4)}`,
    text: r.text,
    timestamp: new Date(r.created_at).getTime(),
  }));

  const commentsCount = Number.isFinite(Number(count)) ? Number(count) : comments.length;
  return res.json({ ok: true, comments, commentsCount });
});

// ===============================
// Moderación: Reportar comentario
// POST /api/assets/:assetId/comments/:commentId/report { reason }
// ===============================
router.post("/assets/:assetId/comments/:commentId/report", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const rl = await checkUserRateLimit({
    userId: user.id,
    scope: "comment_report",
    windowMs: 60 * 1000,
    max: 10,
  });
  if (!rl.ok) {
    return res.status(429).json({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Demasiados reportes. Espera un momento.",
        details: { scope: "comment_report_user", retryAfterSeconds: rl.retryAfterSeconds },
      },
    });
  }

  const assetId = req.params.assetId;
  const commentId = req.params.commentId;

  const reason = String(req.body?.reason || "").trim();
  if (!reason || reason.length > 500) {
    return res.status(400).json({
      ok: false,
      error: { code: "BAD_REQUEST", message: "Reason inválido (1..500 chars)." },
    });
  }

  const { row: assetRow, error: assetErr } = await getAssetAccessRow(assetId);
  if (assetErr) return res.status(assetErr.code === "NOT_FOUND" ? 404 : 500).json({ ok: false, error: assetErr });
  if (!(await canAccessAsset(assetRow, user.id))) {
    return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No tienes acceso a este asset." } });
  }

  // Verifica que el comment pertenezca al asset
  const { data: cRow, error: cErr } = await supabaseAdmin
    .from("asset_comments")
    .select("id")
    .eq("id", commentId)
    .eq("asset_id", assetId)
    .maybeSingle();

  if (cErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: cErr.message } });
  }
  if (!cRow) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Comentario no encontrado." } });
  }

  const { error: rErr } = await supabaseAdmin
    .from("comment_reports")
    .insert({ comment_id: commentId, reporter_id: user.id, reason });

  if (rErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_INSERT_FAILED", message: rErr.message } });
  }

  return res.json({ ok: true });
});

// ===============================
// Social: Create Comment
// POST /api/assets/:id/comments { text }
// ===============================
router.post("/assets/:id/comments", async (req, res) => {
  const { user, error } = await requireUser(req);
  if (error) return res.status(401).json({ ok: false, error });

  const assetId = req.params.id;

  const parsed = CreateCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: { code: "BAD_REQUEST", message: "Texto inválido (1..500 chars).", details: parsed.error.format() },
    });
  }

  const { row: assetRow, error: assetErr } = await getAssetAccessRow(assetId);
  if (assetErr) return res.status(assetErr.code === "NOT_FOUND" ? 404 : 500).json({ ok: false, error: assetErr });
  if (!(await canAccessAsset(assetRow, user.id))) {
    return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No tienes acceso a este asset." } });
  }

const text = parsed.data.text;

// Rate limit por userId (además del limiter por IP)
  const rl = await checkUserRateLimit({
    userId: user.id,
    scope: "comment_create",
    windowMs: 60 * 1000,
    max: 30,
  });
if (!rl.ok) {
  return res.status(429).json({
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "Demasiados comentarios. Espera un momento y vuelve a intentar.",
      details: { scope: "comment_create_user", retryAfterSeconds: rl.retryAfterSeconds },
    },
  });
}

// Cooldown real: 1 comentario cada 2s por usuario (global, no por asset)
const { data: lastRow, error: lastErr } = await supabaseAdmin
  .from("asset_comments")
  .select("created_at")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (lastErr) {
  return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: lastErr.message } });
}

if (lastRow?.created_at) {
  const lastMs = new Date(lastRow.created_at).getTime();
  const delta = Date.now() - lastMs;
  if (delta < 2000) {
    const retryAfterSeconds = Math.max(Math.ceil((2000 - delta) / 1000), 1);
    return res.status(429).json({
      ok: false,
      error: {
        code: "COOLDOWN",
        message: "Cooldown: espera 2 segundos antes de comentar de nuevo.",
        details: { scope: "comment_cooldown", retryAfterSeconds },
      },
    });
  }
}

// Shadow ban + auto-moderación (shadow = no visible a otros)
const moderation = await getUserModeration(supabaseAdmin, user.id);
const textEval = evaluateCommentText(text);
const isShadowed = Boolean(moderation.shadowBanned) || Boolean(textEval.shouldShadow);

const { data: inserted, error: insErr } = await supabaseAdmin
  .from("asset_comments")
  .insert({ asset_id: assetId, user_id: user.id, text, is_shadowed: isShadowed })
  .select("id, user_id, text, created_at")
  .single();

if (insErr) {
  return res.status(500).json({ ok: false, error: { code: "DB_INSERT_FAILED", message: insErr.message } });
}

  // username propio
  let username = null;
  const { data: profileRow, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  if (!pErr) username = profileRow?.username || null;

  // contador actualizado
  const { data: cntRow, error: cntErr } = await supabaseAdmin
    .from("assets")
    .select("comments_count")
    .eq("id", assetId)
    .maybeSingle();

  if (cntErr) {
    return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: cntErr.message } });
  }

  const commentsCount = Number.isFinite(Number(cntRow?.comments_count)) ? Number(cntRow.comments_count) : 0;

  const comment = {
    id: inserted.id,
    userId: inserted.user_id,
    username: username || `User_${String(inserted.user_id).slice(0, 4)}`,
    text: inserted.text,
    timestamp: new Date(inserted.created_at).getTime(),
  };

  return res.json({ ok: true, comment, commentsCount });
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
  const extraMeta = normalizeAssetMeta(input.meta, "El campo meta de complete-upload no es JSON válido.");

  const meta = {
    ...extraMeta,
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

    const envName = String(APP_ENV || NODE_ENV || "").toLowerCase();
    const isProdEnv = envName === "production";
    const allowLegacyUpload = String(process.env.ALLOW_LEGACY_UPLOAD || "").trim() === "1";

    if (isProdEnv && !allowLegacyUpload) {
      throw httpError(
        400,
        "LEGACY_UPLOAD_DISABLED",
        "Endpoint /assets/upload deshabilitado en producción. Usa /assets/upload/presign y /assets/upload/complete."
      );
    }

    // Soportamos 2 modos:
    // 1) multipart/form-data con req.file (recomendado)
    // 2) JSON con dataUrl (compatibilidad)

    let toolName = "upload";
    let assetType = "image";
    let name = "upload";
    let category = null;
    let extraMeta = {};

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
      extraMeta = normalizeAssetMeta(body.meta, "El campo meta del upload no es JSON válido.");

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
      extraMeta = normalizeAssetMeta(parsed.meta, "El campo meta del upload no es válido.");

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
      ...extraMeta,
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
        meta,
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
