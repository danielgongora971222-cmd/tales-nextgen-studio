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

function normalizeRange(raw) {
  const value = String(raw || "30d").toLowerCase();
  return ["7d", "30d", "90d", "all"].includes(value) ? value : "30d";
}

function getSinceIso(range) {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString();
}

function bucketKeyFor(range, ts) {
  const d = new Date(ts);
  if (range === "all") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return d.toISOString().slice(0, 10);
}

function bucketLabelFor(range, key) {
  if (range === "all") {
    const [year, month] = String(key).split("-");
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }

  const d = new Date(`${key}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function buildTimeline(range, events) {
  const buckets = [];
  const bucketMap = new Map();

  if (range === "all") {
    const timestamps = events.map((e) => e.ts).filter(Boolean).sort((a, b) => a - b);
    if (timestamps.length > 0) {
      const first = new Date(timestamps[0]);
      const last = new Date();
      let cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
      const limit = 60;
      let count = 0;

      while (cursor.getTime() <= last.getTime() && count < limit) {
        const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
        const row = {
          key,
          label: bucketLabelFor("all", key),
          salesNetCredits: 0,
          referralCredits: 0,
          totalCredits: 0,
          pendingCredits: 0,
          confirmedCredits: 0,
          salesCount: 0,
          referralCount: 0,
        };
        buckets.push(row);
        bucketMap.set(key, row);
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
        count += 1;
      }
    }
  } else {
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    cursor.setUTCDate(cursor.getUTCDate() - (days - 1));

    for (let i = 0; i < days; i += 1) {
      const d = new Date(cursor);
      d.setUTCDate(cursor.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const row = {
        key,
        label: bucketLabelFor(range, key),
        salesNetCredits: 0,
        referralCredits: 0,
        totalCredits: 0,
        pendingCredits: 0,
        confirmedCredits: 0,
        salesCount: 0,
        referralCount: 0,
      };
      buckets.push(row);
      bucketMap.set(key, row);
    }
  }

  for (const event of events) {
    if (!event?.ts) continue;
    const key = bucketKeyFor(range, event.ts);
    const row = bucketMap.get(key);
    if (!row) continue;

    if (event.kind === "sale") {
      row.salesNetCredits += asNumber(event.credits);
      row.salesCount += 1;
    } else {
      row.referralCredits += asNumber(event.credits);
      row.referralCount += 1;
    }

    row.totalCredits += asNumber(event.credits);

    if (event.isMatured) {
      row.confirmedCredits += asNumber(event.credits);
    } else {
      row.pendingCredits += asNumber(event.credits);
    }
  }

  return buckets;
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

    const range = normalizeRange(req.query.range);
    const sinceIso = getSinceIso(range);

    const listingsQuery = supabaseAdmin
      .from("community_listings")
      .select("id, name, status, listing_kind, media_tag, price_credits, description, preview_asset_id, created_at, likes_count, comments_count, sales_count")
      .eq("seller_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .range(0, 4999);

    let sellerSalesQuery = supabaseAdmin
      .from("community_purchases")
      .select("id, listing_id, paid_credits, seller_net_credits, referral_code_id, created_at, matures_at, is_matured")
      .eq("seller_id", user.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .range(0, 4999);

    let marketplaceReferralsQuery = supabaseAdmin
      .from("community_purchases")
      .select("id, listing_id, paid_credits, referral_code_id, referral_reward_credits, created_at, matures_at, is_matured")
      .eq("referrer_id", user.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .range(0, 4999);

    let planReferralsQuery = supabaseAdmin
      .from("billing_referrals")
      .select("id, referral_code_id, referral_code_snapshot, referred_username_snapshot, plan_slug_snapshot, referrer_reward_credits, created_at, matures_at, is_matured")
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false })
      .range(0, 4999);

    let cashoutsQuery = supabaseAdmin
      .from("wallet_cashout_requests")
      .select("id, status, amount_credits, net_usd_micros, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(0, 4999);

    if (sinceIso) {
      sellerSalesQuery = sellerSalesQuery.gte("created_at", sinceIso);
      marketplaceReferralsQuery = marketplaceReferralsQuery.gte("created_at", sinceIso);
      planReferralsQuery = planReferralsQuery.gte("created_at", sinceIso);
      cashoutsQuery = cashoutsQuery.gte("created_at", sinceIso);
    }

    const codesQuery = supabaseAdmin
      .from("community_referral_codes")
      .select("id, code, variant, buyer_discount_pct, ref_reward_pct, is_active")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .range(0, 99);

    const [
      { data: listingRows, error: listingsErr },
      { data: sellerSalesRows, error: sellerSalesErr },
      { data: marketplaceReferralRows, error: marketplaceRefErr },
      { data: planReferralRows, error: planRefErr },
      { data: cashoutRows, error: cashoutsErr },
      { data: codeRows, error: codesErr },
    ] = await Promise.all([
      listingsQuery,
      sellerSalesQuery,
      marketplaceReferralsQuery,
      planReferralsQuery,
      cashoutsQuery,
      codesQuery,
    ]);

    if (listingsErr) return err(res, 500, "DB_QUERY_FAILED", listingsErr.message);
    if (sellerSalesErr) return err(res, 500, "DB_QUERY_FAILED", sellerSalesErr.message);
    if (marketplaceRefErr) return err(res, 500, "DB_QUERY_FAILED", marketplaceRefErr.message);
    if (planRefErr) return err(res, 500, "DB_QUERY_FAILED", planRefErr.message);
    if (cashoutsErr) return err(res, 500, "DB_QUERY_FAILED", cashoutsErr.message);
    if (codesErr) return err(res, 500, "DB_QUERY_FAILED", codesErr.message);

    const sellerListings = Array.isArray(listingRows) ? listingRows : [];
    const sellerSales = Array.isArray(sellerSalesRows) ? sellerSalesRows : [];
    const marketplaceReferrals = Array.isArray(marketplaceReferralRows) ? marketplaceReferralRows : [];
    const planReferrals = Array.isArray(planReferralRows) ? planReferralRows : [];
    const cashouts = Array.isArray(cashoutRows) ? cashoutRows : [];
    const codes = Array.isArray(codeRows) ? codeRows : [];

    const extraListingIds = [...new Set(marketplaceReferrals.map((r) => r.listing_id).filter(Boolean))]
      .filter((id) => !sellerListings.some((row) => row.id === id));

    let extraListings = [];
    if (extraListingIds.length > 0) {
      const { data, error: extraErr } = await supabaseAdmin
        .from("community_listings")
        .select("id, name, status, listing_kind, media_tag, price_credits, description, preview_asset_id, created_at, likes_count, comments_count, sales_count")
        .in("id", extraListingIds);

      if (extraErr) return err(res, 500, "DB_QUERY_FAILED", extraErr.message);
      extraListings = Array.isArray(data) ? data : [];
    }

    const allListings = [...sellerListings, ...extraListings];
    const previewMap = await resolveAssetPreviewMap(allListings.map((r) => r.preview_asset_id));

    const listingById = new Map();
    for (const row of allListings) {
      listingById.set(row.id, {
        id: row.id,
        name: row.name || "Untitled creation",
        status: row.status || "active",
        listingKind: row.listing_kind || "single",
        mediaTag: row.media_tag || "image",
        priceCredits: asNumber(row.price_credits),
        description: row.description || "",
        previewUrl: row.preview_asset_id ? previewMap.get(row.preview_asset_id) || null : null,
        createdAt: toMillis(row.created_at) || Date.now(),
        likesCount: asNumber(row.likes_count),
        commentsCount: asNumber(row.comments_count),
        salesCount: asNumber(row.sales_count),
        grossSalesCredits: 0,
        netSalesCredits: 0,
        pendingCredits: 0,
        confirmedCredits: 0,
        rangeSalesCount: 0,
        lastSaleAt: null,
      });
    }

    const codeById = new Map();
    const codePerformanceMap = new Map();
    for (const row of codes) {
      const base = {
        code: row.code,
        variant: row.variant || null,
        buyerDiscountPct: asNumber(row.buyer_discount_pct),
        refRewardPct: asNumber(row.ref_reward_pct),
        isActive: row.is_active !== false,
        marketplaceReferralCount: 0,
        marketplaceReferralCredits: 0,
        marketplaceSalesVolumeCredits: 0,
        planReferralCount: 0,
        planReferralCredits: 0,
        totalCredits: 0,
      };
      codeById.set(row.id, base);
      codePerformanceMap.set(row.code, { ...base });
    }

    const eventStream = [];

    for (const row of sellerSales) {
      const item = listingById.get(row.listing_id);
      if (!item) continue;

      const netCredits = asNumber(row.seller_net_credits);
      item.grossSalesCredits += asNumber(row.paid_credits);
      item.netSalesCredits += netCredits;
      item.rangeSalesCount += 1;
      item.lastSaleAt = Math.max(item.lastSaleAt || 0, toMillis(row.created_at) || 0);
      if (row.is_matured) item.confirmedCredits += netCredits;
      else item.pendingCredits += netCredits;

      eventStream.push({
        id: `sale_${row.id}`,
        kind: "sale",
        ts: toMillis(row.created_at),
        credits: netCredits,
        isMatured: Boolean(row.is_matured),
        availableAt: toMillis(row.matures_at),
        title: item.name,
        subtitle: "Creation sale",
        code: null,
      });
    }

    for (const row of marketplaceReferrals) {
      const credits = asNumber(row.referral_reward_credits);
      const listing = listingById.get(row.listing_id) || null;
      const codeRow = row.referral_code_id ? codeById.get(row.referral_code_id) || null : null;
      const code = codeRow?.code || null;

      if (code) {
        const agg = codePerformanceMap.get(code) || {
          code,
          variant: codeRow?.variant || null,
          buyerDiscountPct: asNumber(codeRow?.buyerDiscountPct),
          refRewardPct: asNumber(codeRow?.refRewardPct),
          isActive: codeRow?.isActive !== false,
          marketplaceReferralCount: 0,
          marketplaceReferralCredits: 0,
          marketplaceSalesVolumeCredits: 0,
          planReferralCount: 0,
          planReferralCredits: 0,
          totalCredits: 0,
        };
        agg.marketplaceReferralCount += 1;
        agg.marketplaceReferralCredits += credits;
        agg.marketplaceSalesVolumeCredits += asNumber(row.paid_credits);
        agg.totalCredits += credits;
        codePerformanceMap.set(code, agg);
      }

      eventStream.push({
        id: `market_ref_${row.id}`,
        kind: "referral",
        ts: toMillis(row.created_at),
        credits,
        isMatured: Boolean(row.is_matured),
        availableAt: toMillis(row.matures_at),
        title: listing?.name || "Referred marketplace sale",
        subtitle: code ? `Code ${code}` : "Marketplace referral",
        code,
      });
    }

    for (const row of planReferrals) {
      const credits = asNumber(row.referrer_reward_credits);
      const codeFromId = row.referral_code_id ? codeById.get(row.referral_code_id) || null : null;
      const code = row.referral_code_snapshot || codeFromId?.code || null;

      if (code) {
        const agg = codePerformanceMap.get(code) || {
          code,
          variant: codeFromId?.variant || null,
          buyerDiscountPct: asNumber(codeFromId?.buyerDiscountPct),
          refRewardPct: asNumber(codeFromId?.refRewardPct),
          isActive: codeFromId?.isActive !== false,
          marketplaceReferralCount: 0,
          marketplaceReferralCredits: 0,
          marketplaceSalesVolumeCredits: 0,
          planReferralCount: 0,
          planReferralCredits: 0,
          totalCredits: 0,
        };
        agg.planReferralCount += 1;
        agg.planReferralCredits += credits;
        agg.totalCredits += credits;
        codePerformanceMap.set(code, agg);
      }

      eventStream.push({
        id: `plan_ref_${row.id}`,
        kind: "referral",
        ts: toMillis(row.created_at),
        credits,
        isMatured: Boolean(row.is_matured),
        availableAt: toMillis(row.matures_at),
        title: row.plan_slug_snapshot ? `Plan ${row.plan_slug_snapshot}` : "Plan referral",
        subtitle: row.referred_username_snapshot
          ? `${row.referred_username_snapshot}${code ? ` · Code ${code}` : ""}`
          : code
            ? `Code ${code}`
            : "Plan referral",
        code,
      });
    }

    const listings = [...listingById.values()]
      .filter((item) => sellerListings.some((row) => row.id === item.id))
      .sort((a, b) => {
        const diff = b.netSalesCredits - a.netSalesCredits;
        if (diff !== 0) return diff;
        return b.likesCount - a.likesCount;
      });

    const summary = {
      listingsCount: listings.length,
      activeListingsCount: listings.filter((item) => item.status === "active").length,
      salesCount: sellerSales.length,
      grossSalesCredits: sellerSales.reduce((sum, row) => sum + asNumber(row.paid_credits), 0),
      netSalesCredits: sellerSales.reduce((sum, row) => sum + asNumber(row.seller_net_credits), 0),
      marketplaceReferralCount: marketplaceReferrals.length,
      marketplaceReferralCredits: marketplaceReferrals.reduce((sum, row) => sum + asNumber(row.referral_reward_credits), 0),
      planReferralCount: planReferrals.length,
      planReferralCredits: planReferrals.reduce((sum, row) => sum + asNumber(row.referrer_reward_credits), 0),
      totalReferralCredits:
        marketplaceReferrals.reduce((sum, row) => sum + asNumber(row.referral_reward_credits), 0) +
        planReferrals.reduce((sum, row) => sum + asNumber(row.referrer_reward_credits), 0),
      totalCreditsGenerated:
        sellerSales.reduce((sum, row) => sum + asNumber(row.seller_net_credits), 0) +
        marketplaceReferrals.reduce((sum, row) => sum + asNumber(row.referral_reward_credits), 0) +
        planReferrals.reduce((sum, row) => sum + asNumber(row.referrer_reward_credits), 0),
      pendingCredits:
        sellerSales.filter((row) => !row.is_matured).reduce((sum, row) => sum + asNumber(row.seller_net_credits), 0) +
        marketplaceReferrals.filter((row) => !row.is_matured).reduce((sum, row) => sum + asNumber(row.referral_reward_credits), 0) +
        planReferrals.filter((row) => !row.is_matured).reduce((sum, row) => sum + asNumber(row.referrer_reward_credits), 0),
      confirmedCredits:
        sellerSales.filter((row) => !!row.is_matured).reduce((sum, row) => sum + asNumber(row.seller_net_credits), 0) +
        marketplaceReferrals.filter((row) => !!row.is_matured).reduce((sum, row) => sum + asNumber(row.referral_reward_credits), 0) +
        planReferrals.filter((row) => !!row.is_matured).reduce((sum, row) => sum + asNumber(row.referrer_reward_credits), 0),
      avgNetCreditsPerSale: sellerSales.length > 0
        ? sellerSales.reduce((sum, row) => sum + asNumber(row.seller_net_credits), 0) / sellerSales.length
        : 0,
    };

    const timeline = buildTimeline(range, eventStream);
    const referralCodesPerformance = [...codePerformanceMap.values()].sort((a, b) => b.totalCredits - a.totalCredits);

    const recentEvents = eventStream
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 12)
      .map((item) => ({
        id: item.id,
        eventType: item.kind,
        createdAt: item.ts,
        availableAt: item.availableAt,
        credits: item.credits,
        isMatured: item.isMatured,
        title: item.title,
        subtitle: item.subtitle,
        code: item.code,
      }));

    const cashoutsSummary = {
      count: cashouts.length,
      totalCredits: cashouts.reduce((sum, row) => sum + asNumber(row.amount_credits), 0),
      totalNetUsdMicros: cashouts.reduce((sum, row) => sum + asNumber(row.net_usd_micros), 0),
      lastCashoutAt: cashouts[0]?.created_at ? toMillis(cashouts[0].created_at) : null,
    };

    return res.json({
      ok: true,
      range,
      summary,
      timeline,
      listings,
      top: {
        bestSeller: listings[0] || null,
        mostLiked: [...listings].sort((a, b) => b.likesCount - a.likesCount)[0] || null,
        mostCommented: [...listings].sort((a, b) => b.commentsCount - a.commentsCount)[0] || null,
      },
      recentEvents,
      referralCodesPerformance,
      cashoutsSummary,
    });
  });

  return router;
}