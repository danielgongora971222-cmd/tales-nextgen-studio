import express from "express";

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.floor(x);
  return Math.min(Math.max(xi, min), max);
}

export function createTradesRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser, signStoragePath } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  async function signedUrlForAssetId(assetId) {
    const { data } = await supabaseAdmin
      .from("assets")
      .select("id, url, storage_path")
      .eq("id", assetId)
      .maybeSingle();

    if (!data) return null;
    if (data.url) return data.url;
    if (!data.storage_path) return null;

    try {
      return await signStoragePath(data.storage_path, 60 * 60 * 6);
    } catch {
      return null;
    }
  }

  // Buyer: compras
  router.get("/trades/buyer/purchases", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const limit = clampInt(req.query.limit, 1, 100, 12);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);

    const { data: rows, error: qErr } = await supabaseAdmin
      .from("community_purchases")
      .select("id, listing_id, seller_id, paid_credits, created_at, matures_at, is_matured")
      .eq("buyer_id", user.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    const purchases = rows || [];
    const listingIds = purchases.map((p) => p.listing_id).filter(Boolean);

    const listingById = new Map();
    if (listingIds.length > 0) {
      const { data: lrows } = await supabaseAdmin
        .from("community_listings")
        .select("id, seller_username_snapshot, description, price_credits, preview_asset_id")
        .in("id", listingIds);

      for (const l of lrows || []) listingById.set(l.id, l);
    }

    const items = [];
    for (const p of purchases) {
      const l = listingById.get(p.listing_id) || null;
      const previewUrl = l?.preview_asset_id ? await signedUrlForAssetId(l.preview_asset_id) : null;

      items.push({
        id: p.id,
        listingId: p.listing_id,
        sellerId: p.seller_id,
        sellerUsername: l?.seller_username_snapshot || "seller",
        listingDescription: l?.description || "",
        listingPriceCredits: Number(l?.price_credits) || 0,
        paidCredits: Number(p.paid_credits) || 0,
        previewUrl,
        createdAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
        maturesAt: p.matures_at ? new Date(p.matures_at).getTime() : Date.now(),
        isMatured: Boolean(p.is_matured),
      });
    }

    return res.json({
      ok: true,
      items,
      nextOffset: offset + items.length,
      hasMore: items.length === limit,
    });
  });

  // Seller: listings
  router.get("/trades/seller/listings", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const limit = clampInt(req.query.limit, 1, 100, 12);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);

    const { data: rows, error: qErr } = await supabaseAdmin
      .from("community_listings")
      .select("id, status, listing_kind, media_tag, price_credits, description, preview_asset_id, created_at, likes_count, comments_count, sales_count")
      .eq("seller_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    const items = [];
    for (const r of rows || []) {
      const previewUrl = r.preview_asset_id ? await signedUrlForAssetId(r.preview_asset_id) : null;
      items.push({
        id: r.id,
        status: r.status,
        listingKind: r.listing_kind,
        mediaTag: r.media_tag,
        priceCredits: Number(r.price_credits) || 0,
        description: r.description || "",
        previewUrl,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        likesCount: Number(r.likes_count) || 0,
        commentsCount: Number(r.comments_count) || 0,
        salesCount: Number(r.sales_count) || 0,
      });
    }

    return res.json({
      ok: true,
      items,
      nextOffset: offset + items.length,
      hasMore: items.length === limit,
    });
  });

  return router;
}
