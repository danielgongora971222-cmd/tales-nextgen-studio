import express from "express";

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.floor(x);
  return Math.min(Math.max(xi, min), max);
}

function toMillis(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isMissingTableError(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || "").toLowerCase();
  return code === "42P01" || msg.includes("does not exist") || msg.includes("relation");
}

function isMissingColumnError(error, columnName = "") {
  const code = String(error?.code || "");
  const msg = String(error?.message || "").toLowerCase();
  const cleanColumn = String(columnName || "").toLowerCase();
  return code === "42703" || (cleanColumn ? msg.includes(cleanColumn) : false) || msg.includes("column");
}

function normalizeBillingReferralStatus(row) {
  const explicit = String(row?.status || "").toLowerCase();
  if (explicit === "reversed") return "reversed";
  if (explicit === "matured") return "matured";
  if (explicit === "pending") return "pending";
  return row?.is_matured ? "matured" : "pending";
}

function normalizeRange(raw, fallback = "30d") {
  const value = String(raw || fallback).toLowerCase();
  return ["7d", "30d", "90d", "all"].includes(value) ? value : fallback;
}

function normalizeCompare(raw) {
  const value = String(raw || "previous").toLowerCase();
  return ["none", "previous", "7d", "30d", "90d", "all"].includes(value) ? value : "previous";
}

function startOfUtcDay(ts = Date.now()) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function daysForRange(range) {
  if (range === "7d") return 7;
  if (range === "90d") return 90;
  if (range === "30d") return 30;
  return null;
}

function buildCurrentWindow(range) {
  if (range === "all") {
    return { key: "all", label: "All time", startMs: null, endMs: null, startIso: null, endIso: null };
  }

  const days = daysForRange(range) || 30;
  const endMs = startOfUtcDay(Date.now()) + (24 * 60 * 60 * 1000) - 1;
  const startMs = startOfUtcDay(Date.now()) - (days - 1) * 24 * 60 * 60 * 1000;

  return {
    key: range,
    label: range.toUpperCase(),
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

function buildCompareWindow(compare, currentRange) {
  if (compare === "none") return null;

  if (compare === "previous") {
    if (currentRange === "all") return null;

    const current = buildCurrentWindow(currentRange);
    const days = daysForRange(currentRange) || 30;
    const endMs = current.startMs - 1;
    const startMs = startOfUtcDay(endMs) - (days - 1) * 24 * 60 * 60 * 1000;

    return {
      key: "previous",
      label: `Previous ${currentRange.toUpperCase()}`,
      startMs,
      endMs,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
    };
  }

  return buildCurrentWindow(normalizeRange(compare, "30d"));
}

function isInWindow(ts, window) {
  if (!window || window.startMs == null || window.endMs == null) return true;
  if (!ts) return false;
  return ts >= window.startMs && ts <= window.endMs;
}

function makeSummary() {
  return {
    salesCount: 0,
    netSalesCredits: 0,
    pendingCredits: 0,
    confirmedCredits: 0,
    likesCount: 0,
    commentsCount: 0,
    marketplaceReferralCount: 0,
    marketplaceReferralCredits: 0,
    planReferralCount: 0,
    planReferralCredits: 0,
    totalReferralCredits: 0,
  };
}

function safePctDelta(current, compare) {
  const c = asNumber(current);
  const p = asNumber(compare);

  if (p <= 0) {
    if (c <= 0) return 0;
    return 100;
  }

  return ((c - p) / p) * 100;
}

export function createTradesRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser, signStoragePath } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  async function resolveAssetPreviewMap(assetIds) {
    const ids = [...new Set((assetIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const { data, error } = await supabaseAdmin
      .from("assets")
      .select("id, url, storage_path")
      .in("id", ids);

    if (error) throw error;

    const map = new Map();
    for (const row of data || []) {
      if (row.url) {
        map.set(row.id, row.url);
        continue;
      }
      if (!row.storage_path) {
        map.set(row.id, null);
        continue;
      }
      try {
        map.set(row.id, await signStoragePath(row.storage_path, 60 * 60 * 6));
      } catch {
        map.set(row.id, null);
      }
    }

    return map;
  }

  router.get("/trades/art-deco/summary", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const emptySummary = { ordersCount: 0, grossRevenueUsd: 0, baseServiceUsd: 0, sellerProfitUsd: 0 };

    let buyerRows = [];
    let sellerRows = [];
    try {
      const [buyerResp, sellerResp] = await Promise.all([
        supabaseAdmin
          .from("store_orders")
          .select("id, art_deco_listing_id, seller_id, sale_price_usd, base_service_price_usd, seller_profit_usd, currency, status, payload, created_at")
          .eq("buyer_id", user.id)
          .eq("order_kind", "art_deco")
          .order("created_at", { ascending: false })
          .range(0, 49),
        supabaseAdmin
          .from("store_orders")
          .select("id, art_deco_listing_id, buyer_id, sale_price_usd, base_service_price_usd, seller_profit_usd, currency, status, payload, created_at")
          .eq("seller_id", user.id)
          .eq("order_kind", "art_deco")
          .order("created_at", { ascending: false })
          .range(0, 49),
      ]);

      if (buyerResp.error) throw buyerResp.error;
      if (sellerResp.error) throw sellerResp.error;
      buyerRows = Array.isArray(buyerResp.data) ? buyerResp.data : [];
      sellerRows = Array.isArray(sellerResp.data) ? sellerResp.data : [];
    } catch (e) {
      const code = String(e?.code || "");
      const msg = String(e?.message || "").toLowerCase();
      const missing = code === "42P01" || msg.includes("does not exist") || msg.includes("relation");
      if (!missing) return err(res, 500, "DB_QUERY_FAILED", e?.message || "No se pudo cargar Art Deco trades.");
      return res.json({ ok: true, buyerOrders: [], sellerOrders: [], sellerSummary: emptySummary });
    }

    const listingIds = [...new Set([...buyerRows, ...sellerRows].map((row) => row.art_deco_listing_id).filter(Boolean))];
    const listingMap = new Map();
    if (listingIds.length > 0) {
      const { data: listingRows, error: listingErr } = await supabaseAdmin
        .from("community_listings")
        .select("id, name, preview_asset_id, art_deco_payload")
        .in("id", listingIds);
      if (listingErr) return err(res, 500, "DB_QUERY_FAILED", listingErr.message);

      const previewMap = await resolveAssetPreviewMap((listingRows || []).map((row) => row.preview_asset_id));
      for (const row of listingRows || []) {
        const payload = row.art_deco_payload && typeof row.art_deco_payload === "object" ? row.art_deco_payload : {};
        listingMap.set(row.id, {
          name: row.name || "Art Deco listing",
          previewUrl: typeof payload?.croppedImageDataUrl === "string" && payload.croppedImageDataUrl.startsWith("data:image/")
            ? payload.croppedImageDataUrl
            : (row.preview_asset_id ? previewMap.get(row.preview_asset_id) || null : null),
          payload,
        });
      }
    }

    const buyerOrders = buyerRows.map((row) => {
      const listing = listingMap.get(row.art_deco_listing_id) || {};
      const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
      return {
        id: row.id,
        listingId: row.art_deco_listing_id,
        name: listing.name || payload?.assetName || "Art Deco order",
        previewUrl: listing.previewUrl || payload?.croppedImageDataUrl || payload?.assetUrl || null,
        materialLabel: payload?.materialLabel || null,
        sizeLabel: payload?.size?.label || null,
        salePriceUsd: asNumber(row.sale_price_usd),
        currency: row.currency || "USD",
        status: row.status || "created",
        createdAt: toMillis(row.created_at) || Date.now(),
      };
    });

    const sellerOrders = sellerRows.map((row) => {
      const listing = listingMap.get(row.art_deco_listing_id) || {};
      const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
      return {
        id: row.id,
        listingId: row.art_deco_listing_id,
        name: listing.name || payload?.assetName || "Art Deco sale",
        previewUrl: listing.previewUrl || payload?.croppedImageDataUrl || payload?.assetUrl || null,
        materialLabel: payload?.materialLabel || null,
        sizeLabel: payload?.size?.label || null,
        salePriceUsd: asNumber(row.sale_price_usd),
        baseServiceUsd: asNumber(row.base_service_price_usd),
        sellerProfitUsd: asNumber(row.seller_profit_usd),
        currency: row.currency || "USD",
        status: row.status || "created",
        createdAt: toMillis(row.created_at) || Date.now(),
      };
    });

    const sellerSummary = sellerOrders.reduce(
      (acc, row) => {
        acc.ordersCount += 1;
        acc.grossRevenueUsd += asNumber(row.salePriceUsd);
        acc.baseServiceUsd += asNumber(row.baseServiceUsd);
        acc.sellerProfitUsd += asNumber(row.sellerProfitUsd);
        return acc;
      },
      { ...emptySummary }
    );

    return res.json({ ok: true, buyerOrders, sellerOrders, sellerSummary });
  });

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
        .select("id, seller_username_snapshot, name, description, price_credits, preview_asset_id")
        .in("id", listingIds);

      const previewMap = await resolveAssetPreviewMap((lrows || []).map((l) => l.preview_asset_id));

      for (const l of lrows || []) {
        listingById.set(l.id, {
          ...l,
          previewUrl: l.preview_asset_id ? previewMap.get(l.preview_asset_id) || null : null,
        });
      }
    }

    const items = purchases.map((p) => {
      const l = listingById.get(p.listing_id) || null;
      return {
        id: p.id,
        listingId: p.listing_id,
        sellerId: p.seller_id,
        sellerUsername: l?.seller_username_snapshot || "seller",
        listingName: l?.name || "Untitled creation",
        listingDescription: l?.description || "",
        listingPriceCredits: asNumber(l?.price_credits),
        paidCredits: asNumber(p.paid_credits),
        previewUrl: l?.previewUrl || null,
        createdAt: toMillis(p.created_at) || Date.now(),
        maturesAt: toMillis(p.matures_at) || Date.now(),
        isMatured: Boolean(p.is_matured),
      };
    });

    return res.json({
      ok: true,
      items,
      nextOffset: offset + items.length,
      hasMore: items.length === limit,
    });
  });

  router.get("/trades/seller/listings", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const limit = clampInt(req.query.limit, 1, 100, 12);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);

    const { data: rows, error: qErr } = await supabaseAdmin
      .from("community_listings")
      .select("id, name, status, listing_kind, media_tag, price_credits, description, preview_asset_id, created_at, likes_count, comments_count, sales_count")
      .eq("seller_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    const previewMap = await resolveAssetPreviewMap((rows || []).map((r) => r.preview_asset_id));

    const items = (rows || []).map((r) => ({
      id: r.id,
      name: r.name || "Untitled creation",
      status: r.status,
      listingKind: r.listing_kind,
      mediaTag: r.media_tag,
      priceCredits: asNumber(r.price_credits),
      description: r.description || "",
      previewUrl: r.preview_asset_id ? previewMap.get(r.preview_asset_id) || null : null,
      createdAt: toMillis(r.created_at) || Date.now(),
      likesCount: asNumber(r.likes_count),
      commentsCount: asNumber(r.comments_count),
      salesCount: asNumber(r.sales_count),
    }));

    return res.json({
      ok: true,
      items,
      nextOffset: offset + items.length,
      hasMore: items.length === limit,
    });
  });

  router.get("/trades/dashboard", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const range = normalizeRange(req.query.range, "30d");
    const compare = normalizeCompare(req.query.compare);
    const currentWindow = buildCurrentWindow(range);
    const compareWindow = buildCompareWindow(compare, range);

    const { data: listingRows, error: listingsErr } = await supabaseAdmin
      .from("community_listings")
      .select("id, name, status, listing_kind, media_tag, price_credits, description, preview_asset_id, created_at, likes_count, comments_count, sales_count")
      .eq("seller_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .range(0, 4999);

    if (listingsErr) return err(res, 500, "DB_QUERY_FAILED", listingsErr.message);

    const listings = Array.isArray(listingRows) ? listingRows : [];
    const listingIds = listings.map((row) => row.id).filter(Boolean);
    const previewMap = await resolveAssetPreviewMap(listings.map((row) => row.preview_asset_id));

    let salesRows = [];
    let likesRows = [];
    let commentsRows = [];
    let marketplaceReferralRows = [];
    let planReferralRows = [];

    if (listingIds.length > 0) {
      const [salesResp, likesResp, commentsResp] = await Promise.all([
        supabaseAdmin
          .from("community_purchases")
          .select("id, listing_id, paid_credits, seller_net_credits, created_at, matures_at, is_matured")
          .eq("seller_id", user.id)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .range(0, 4999),
        supabaseAdmin
          .from("community_listing_likes")
          .select("id, listing_id, created_at")
          .in("listing_id", listingIds)
          .order("created_at", { ascending: false })
          .range(0, 4999),
        supabaseAdmin
          .from("community_listing_comments")
          .select("id, listing_id, created_at, is_shadowed")
          .in("listing_id", listingIds)
          .eq("is_shadowed", false)
          .order("created_at", { ascending: false })
          .range(0, 4999),
      ]);

      if (salesResp.error) return err(res, 500, "DB_QUERY_FAILED", salesResp.error.message);
      if (likesResp.error) return err(res, 500, "DB_QUERY_FAILED", likesResp.error.message);
      if (commentsResp.error) return err(res, 500, "DB_QUERY_FAILED", commentsResp.error.message);

      salesRows = Array.isArray(salesResp.data) ? salesResp.data : [];
      likesRows = Array.isArray(likesResp.data) ? likesResp.data : [];
      commentsRows = Array.isArray(commentsResp.data) ? commentsResp.data : [];
    }

    const planRespPrimary = supabaseAdmin
      .from("billing_referrals")
      .select("id, referrer_reward_credits, created_at, matures_at, is_matured, status")
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false })
      .range(0, 4999);

    const [marketResp, planRespCandidate] = await Promise.all([
      supabaseAdmin
        .from("community_purchases")
        .select("id, listing_id, paid_credits, referral_reward_credits, created_at, matures_at, is_matured")
        .eq("referrer_id", user.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .range(0, 4999),
      planRespPrimary,
    ]);

    if (marketResp.error) return err(res, 500, "DB_QUERY_FAILED", marketResp.error.message);

    let planResp = planRespCandidate;
    if (planRespCandidate.error && !isMissingTableError(planRespCandidate.error) && isMissingColumnError(planRespCandidate.error, "status")) {
      planResp = await supabaseAdmin
        .from("billing_referrals")
        .select("id, referrer_reward_credits, created_at, matures_at, is_matured")
        .eq("referrer_id", user.id)
        .order("created_at", { ascending: false })
        .range(0, 4999);
    }

    if (planResp.error) {
      if (!isMissingTableError(planResp.error)) return err(res, 500, "DB_QUERY_FAILED", planResp.error.message);
    }

    marketplaceReferralRows = Array.isArray(marketResp.data) ? marketResp.data : [];
    planReferralRows = Array.isArray(planResp.data) ? planResp.data : [];

    const currentSummary = makeSummary();
    const compareSummary = makeSummary();
    const listingMap = new Map();

    for (const row of listings) {
      listingMap.set(row.id, {
        id: row.id,
        name: row.name || "Untitled creation",
        status: row.status || "active",
        listingKind: row.listing_kind || "single",
        mediaTag: row.media_tag || "other",
        priceCredits: asNumber(row.price_credits),
        description: row.description || "",
        previewUrl: row.preview_asset_id ? previewMap.get(row.preview_asset_id) || null : null,
        createdAt: toMillis(row.created_at) || Date.now(),
        lifetimeSalesCount: asNumber(row.sales_count),
        lifetimeLikesCount: asNumber(row.likes_count),
        lifetimeCommentsCount: asNumber(row.comments_count),
        currentSalesCount: 0,
        currentNetSalesCredits: 0,
        currentPendingCredits: 0,
        currentConfirmedCredits: 0,
        currentLikesCount: 0,
        currentCommentsCount: 0,
        compareSalesCount: 0,
        compareNetSalesCredits: 0,
        compareLikesCount: 0,
        compareCommentsCount: 0,
        lastSaleAt: null,
      });
    }

    for (const row of salesRows) {
      const item = listingMap.get(row.listing_id);
      if (!item) continue;

      const ts = toMillis(row.created_at);
      const credits = asNumber(row.seller_net_credits);
      item.lastSaleAt = Math.max(item.lastSaleAt || 0, ts || 0);

      if (isInWindow(ts, currentWindow)) {
        item.currentSalesCount += 1;
        item.currentNetSalesCredits += credits;
        if (row.is_matured) item.currentConfirmedCredits += credits;
        else item.currentPendingCredits += credits;

        currentSummary.salesCount += 1;
        currentSummary.netSalesCredits += credits;
        if (row.is_matured) currentSummary.confirmedCredits += credits;
        else currentSummary.pendingCredits += credits;
      }

      if (compareWindow && isInWindow(ts, compareWindow)) {
        item.compareSalesCount += 1;
        item.compareNetSalesCredits += credits;

        compareSummary.salesCount += 1;
        compareSummary.netSalesCredits += credits;
        if (row.is_matured) compareSummary.confirmedCredits += credits;
        else compareSummary.pendingCredits += credits;
      }
    }

    for (const row of likesRows) {
      const item = listingMap.get(row.listing_id);
      if (!item) continue;

      const ts = toMillis(row.created_at);
      if (isInWindow(ts, currentWindow)) {
        item.currentLikesCount += 1;
        currentSummary.likesCount += 1;
      }
      if (compareWindow && isInWindow(ts, compareWindow)) {
        item.compareLikesCount += 1;
        compareSummary.likesCount += 1;
      }
    }

    for (const row of commentsRows) {
      const item = listingMap.get(row.listing_id);
      if (!item) continue;

      const ts = toMillis(row.created_at);
      if (isInWindow(ts, currentWindow)) {
        item.currentCommentsCount += 1;
        currentSummary.commentsCount += 1;
      }
      if (compareWindow && isInWindow(ts, compareWindow)) {
        item.compareCommentsCount += 1;
        compareSummary.commentsCount += 1;
      }
    }

    for (const row of marketplaceReferralRows) {
      const ts = toMillis(row.created_at);
      const credits = asNumber(row.referral_reward_credits);

      if (isInWindow(ts, currentWindow)) {
        currentSummary.marketplaceReferralCount += 1;
        currentSummary.marketplaceReferralCredits += credits;
      }
      if (compareWindow && isInWindow(ts, compareWindow)) {
        compareSummary.marketplaceReferralCount += 1;
        compareSummary.marketplaceReferralCredits += credits;
      }
    }

    for (const row of planReferralRows) {
      const referralStatus = normalizeBillingReferralStatus(row);
      if (referralStatus === "reversed") continue;

      const ts = toMillis(row.created_at);
      const credits = asNumber(row.referrer_reward_credits);

      if (isInWindow(ts, currentWindow)) {
        currentSummary.planReferralCount += 1;
        currentSummary.planReferralCredits += credits;
      }
      if (compareWindow && isInWindow(ts, compareWindow)) {
        compareSummary.planReferralCount += 1;
        compareSummary.planReferralCredits += credits;
      }
    }

    currentSummary.totalReferralCredits = currentSummary.marketplaceReferralCredits + currentSummary.planReferralCredits;
    compareSummary.totalReferralCredits = compareSummary.marketplaceReferralCredits + compareSummary.planReferralCredits;

    const listingItems = [...listingMap.values()].map((item) => ({
      ...item,
      salesDeltaPct: safePctDelta(item.currentSalesCount, item.compareSalesCount),
      revenueDeltaPct: safePctDelta(item.currentNetSalesCredits, item.compareNetSalesCredits),
      likesDeltaPct: safePctDelta(item.currentLikesCount, item.compareLikesCount),
      commentsDeltaPct: safePctDelta(item.currentCommentsCount, item.compareCommentsCount),
    }));

    const alerts = [];

    for (const item of listingItems) {
      if (item.status !== "active") {
        alerts.push({
          id: `inactive_${item.id}`,
          type: "listing_inactive",
          severity: "medium",
          listingId: item.id,
          listingName: item.name,
          title: "Listing no activo",
          message: `${item.name} no está activo y ahora mismo no puede captar nuevas ventas orgánicas.`,
        });
      }

      if (compareWindow) {
        if (item.compareSalesCount >= 2 && item.currentSalesCount === 0) {
          alerts.push({
            id: `sales_drop_${item.id}`,
            type: "sales_dropoff",
            severity: "high",
            listingId: item.id,
            listingName: item.name,
            title: "Caída fuerte en ventas",
            message: `${item.name} vendía ${item.compareSalesCount} veces en la ventana de comparación y ahora no registra ventas.`,
          });
        }

        if (item.compareLikesCount >= 4 && item.currentLikesCount <= Math.floor(item.compareLikesCount * 0.5)) {
          alerts.push({
            id: `likes_drop_${item.id}`,
            type: "likes_cooling",
            severity: "medium",
            listingId: item.id,
            listingName: item.name,
            title: "Menor atracción social",
            message: `${item.name} cayó de ${item.compareLikesCount} likes a ${item.currentLikesCount} en la ventana actual.`,
          });
        }

        if (item.compareCommentsCount >= 2 && item.currentCommentsCount === 0) {
          alerts.push({
            id: `comments_drop_${item.id}`,
            type: "comments_cooling",
            severity: "low",
            listingId: item.id,
            listingName: item.name,
            title: "La conversación se frenó",
            message: `${item.name} tenía conversación en la ventana comparativa y ahora no registra comentarios.`,
          });
        }
      }

      if ((item.currentLikesCount >= 6 || item.currentCommentsCount >= 3) && item.currentSalesCount === 0) {
        alerts.push({
          id: `engaged_no_sales_${item.id}`,
          type: "engaged_no_sales",
          severity: "medium",
          listingId: item.id,
          listingName: item.name,
          title: "Interés sin conversión",
          message: `${item.name} está generando interacción, pero no convirtió en ventas dentro del rango actual.`,
        });
      }
    }

    alerts.sort((a, b) => {
      const score = { high: 3, medium: 2, low: 1 };
      return (score[b.severity] || 0) - (score[a.severity] || 0);
    });

    return res.json({
      ok: true,
      range,
      compare,
      currentWindow,
      compareWindow,
      summary: currentSummary,
      compareSummary,
      deltas: {
        salesCountPct: safePctDelta(currentSummary.salesCount, compareSummary.salesCount),
        netSalesCreditsPct: safePctDelta(currentSummary.netSalesCredits, compareSummary.netSalesCredits),
        likesCountPct: safePctDelta(currentSummary.likesCount, compareSummary.likesCount),
        commentsCountPct: safePctDelta(currentSummary.commentsCount, compareSummary.commentsCount),
        totalReferralCreditsPct: safePctDelta(currentSummary.totalReferralCredits, compareSummary.totalReferralCredits),
      },
      listings: listingItems,
      alerts: alerts.slice(0, 12),
    });
  });

  return router;
}