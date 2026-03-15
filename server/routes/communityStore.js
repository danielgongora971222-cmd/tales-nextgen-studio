import express from "express";
import { z } from "zod";
import { createHash, randomUUID } from "crypto";
import { checkUserRateLimit } from "../lib/userRateLimit.js";
import { evaluateCommentText, getUserModeration } from "../lib/moderation.js";

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.floor(x);
  return Math.min(Math.max(xi, min), max);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

const STYLE_PRESET_BLOCK_START = "[[STYLE_PRESET_START]]";
const STYLE_PRESET_BLOCK_END = "[[STYLE_PRESET_END]]";
const LEGACY_STYLE_PRESET_BLOCK_START = "/* STYLE_PRESET_START */";
const LEGACY_STYLE_PRESET_BLOCK_END = "/* STYLE_PRESET_END */";
const LIGHTING_PRESET_BLOCK_START = "[[LIGHTING_PRESET_START]]";
const LIGHTING_PRESET_BLOCK_END = "[[LIGHTING_PRESET_END]]";

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHiddenPresetBlocks(input) {
  let out = String(input || "");
  const pairs = [
    { start: STYLE_PRESET_BLOCK_START, end: STYLE_PRESET_BLOCK_END },
    { start: LEGACY_STYLE_PRESET_BLOCK_START, end: LEGACY_STYLE_PRESET_BLOCK_END },
    { start: LIGHTING_PRESET_BLOCK_START, end: LIGHTING_PRESET_BLOCK_END },
  ];

  for (const { start, end } of pairs) {
    const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`, "g");
    out = out.replace(re, "");
  }

  return out.trim();
}

function sanitizeRecipeMeta(meta) {
  const src = meta && typeof meta === "object" ? meta : {};
  const next = JSON.parse(JSON.stringify(src));

  delete next.styleAssetId;
  delete next.styleReferenceDataUrl;
  delete next.styleReferenceUrl;

  next.stylePresetId = typeof next.stylePresetId === "string" ? next.stylePresetId : null;
  next.stylePresetName = typeof next.stylePresetName === "string" ? next.stylePresetName : null;

  return next;
}

async function maybeUserFromReq(req, supabaseAdmin) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { user: null };
  if (!supabaseAdmin) return { user: null };

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return { user: null };
    return { user: data.user };
  } catch {
    return { user: null };
  }
}

const CreateListingSchema = z.object({
  previewAssetId: z.string().uuid(),
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(3).max(80)),
  priceCredits: z.preprocess((v) => Number(v), z.number().int().min(1).max(1000000)),
  // ✅ ahora es obligatoria y más larga (permite paso a paso / contexto)
  description: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z.string().min(20, "La descripción es obligatoria (mínimo 20 caracteres).").max(2000, "Máximo 2000 caracteres.")
  ),
  listingKind: z.enum(["single", "workflow"]).default("single"),
});


const CreateArtDecoListingSchema = z
  .object({
    previewAssetId: z.string().uuid(),
    name: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(3).max(80)),
    description: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : ""),
      z.string().min(20, "La descripción es obligatoria (mínimo 20 caracteres).").max(2000, "Máximo 2000 caracteres.")
    ),
    priceUsd: z.preprocess((v) => Number(v), z.number().positive().max(1000000)),
    currency: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : "USD"), z.string().min(3).max(8)).default("USD"),
    artDecoPayload: z
      .object({
        assetId: z.string().min(1),
        assetUrl: z.string().min(1),
        assetName: z.string().optional(),
        imageDims: z.object({ w: z.number().int().nonnegative(), h: z.number().int().nonnegative() }).nullable().optional(),
        material: z.enum(["metal", "acrylic", "canvas", "paper"]),
        materialLabel: z.string().min(1),
        size: z.object({
          id: z.string().min(1),
          wIn: z.number().positive(),
          hIn: z.number().positive(),
          label: z.string().min(1),
        }),
        fitMode: z.enum(["perfect", "crop", "smart_fill"]).default("crop"),
        cropNormalized: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().min(0).max(1),
            h: z.number().min(0).max(1),
            aspect: z.number().positive().optional(),
          })
          .nullable()
          .optional(),
        croppedImageDataUrl: z.string().max(8_500_000).nullable().optional(),
        pricing: z.object({
          basePrice: z.number().nonnegative(),
          salePrice: z.number().positive(),
          sellerProfit: z.number().nonnegative(),
          currency: z.string().min(3).max(8).optional(),
        }),
      })
      .superRefine((value, ctx) => {
        const basePrice = normalizeUsd(value?.pricing?.basePrice);
        const salePrice = normalizeUsd(value?.pricing?.salePrice);
        const sellerProfit = normalizeUsd(value?.pricing?.sellerProfit);

        if (salePrice <= basePrice) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["pricing", "salePrice"],
            message: "El precio de venta debe ser mayor que el costo base del servicio.",
          });
        }

        if (Math.abs((salePrice - basePrice) - sellerProfit) > 0.02) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["pricing", "sellerProfit"],
            message: "La ganancia del seller no coincide con el margen calculado.",
          });
        }
      }),
  })
  .superRefine((value, ctx) => {
    const priceUsd = normalizeUsd(value?.priceUsd);
    const salePrice = normalizeUsd(value?.artDecoPayload?.pricing?.salePrice);
    if (Math.abs(priceUsd - salePrice) > 0.02) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priceUsd"],
        message: "priceUsd debe coincidir con el precio de venta configurado para el Art Deco.",
      });
    }
  });

const UpdateListingSchema = z
  .object({
    name: z.preprocess((v) => (v === undefined ? undefined : String(v).trim()), z.string().min(3).max(80)).optional(),
    priceCredits: z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(1).max(1000000)).optional(),
    priceUsd: z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().positive().max(1000000)).optional(),
    currency: z.preprocess((v) => (v === undefined ? undefined : String(v).trim().toUpperCase()), z.string().min(3).max(8)).optional(),
    description: z.preprocess((v) => (v === undefined ? undefined : String(v).trim()), z.string().max(2000)).optional(),
    status: z.enum(["active", "unlisted", "deleted"]).optional(),
  })
  .superRefine((val, ctx) => {
    // Si alguien intenta activar un listing, exigimos descripción no vacía
    if (val?.status === "active") {
      const d = typeof val.description === "string" ? val.description.trim() : "";
      if (!d || d.length < 20) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["description"],
          message: "La descripción es obligatoria para activar el listing (mínimo 20 caracteres).",
        });
      }
    }
  });


const PurchaseSchema = z.object({
  listingId: z.string().uuid(),
  referralCode: z.preprocess((v) => (v == null ? null : String(v).trim()), z.string().max(40).nullable()).optional(),
});

const CreateCommentSchema = z.object({
  text: z.string().min(1).max(500),
});

export function createCommunityStoreRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser, signStoragePath, billing } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  async function signedUrlForAssetId(assetId) {
    const { data, error } = await supabaseAdmin
      .from("assets")
      .select("id, url, storage_path, type")
      .eq("id", assetId)
      .maybeSingle();

    if (error || !data) return null;

    if (data.url) return data.url;
    if (!data.storage_path) return null;

    try {
      return await signStoragePath(data.storage_path, 60 * 60 * 6);
    } catch {
      return null;
    }
  }

  async function sellerCanSellNow(sellerId) {
    const active = await billing.getActiveSubscription(sellerId);
    if (active.error) return { ok: false, error: active.error, canSell: false };
    return { ok: true, error: null, canSell: !!active.subscription?.canSell };
  }


  function normalizeUsd(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function safeArtDecoPayload(payload) {
    return payload && typeof payload === "object" ? payload : {};
  }

  function artDecoPreviewFromPayload(payload) {
    const candidate = safeArtDecoPayload(payload)?.croppedImageDataUrl;
    return typeof candidate === "string" && candidate.startsWith("data:image/") ? candidate : null;
  }

  const LISTING_SELECT_BASE = [
    "id",
    "name",
    "seller_id",
    "seller_username_snapshot",
    "seller_verified_snapshot",
    "listing_kind",
    "media_tag",
    "price_credits",
    "description",
    "status",
    "preview_asset_id",
    "created_at",
    "likes_count",
    "comments_count",
    "sales_count",
  ].join(", ");

  const LISTING_SELECT_ART_DECO = ["price_usd", "currency", "art_deco_payload"].join(", ");
  const LISTING_SELECT_FULL = `${LISTING_SELECT_BASE}, ${LISTING_SELECT_ART_DECO}`;

  function isMissingPublicCatalogArtDecoColumn(error) {
    const message = String(error?.message || "").toLowerCase();
    return (
      message.includes("community_listings_public_catalog")
      && (message.includes("price_usd") || message.includes("currency") || message.includes("art_deco_payload"))
    );
  }

  function applyListingsQueryShape(query, { media, seller, qSearch, sort, offset, limit }) {
    let next = query.eq("status", "active");

    if (media === "image" || media === "video" || media === "workflow") {
      next = next.eq("media_tag", media);
    }

    if (seller) {
      next = next.ilike("seller_username_snapshot", `%${seller}%`);
    }

    if (qSearch) {
      const term = qSearch.startsWith("@") ? qSearch.slice(1) : qSearch;
      next = next.or(`name.ilike.%${term}%,seller_username_snapshot.ilike.%${term}%`);
    }

    if (sort === "top_liked") {
      next = next.order("likes_count", { ascending: false }).order("created_at", { ascending: false });
    } else if (sort === "top_sold") {
      next = next.order("sales_count", { ascending: false }).order("created_at", { ascending: false });
    } else if (sort === "top_commented") {
      next = next.order("comments_count", { ascending: false }).order("created_at", { ascending: false });
    } else if (sort === "oldest") {
      next = next.order("created_at", { ascending: true });
    } else {
      next = next.order("created_at", { ascending: false });
    }

    return next.range(offset, offset + limit - 1);
  }

  async function enrichLegacyCatalogRows(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const listingIds = safeRows.map((row) => row?.id).filter(Boolean);
    const extrasById = new Map();

    if (listingIds.length > 0) {
      const { data: extras } = await supabaseAdmin
        .from("community_listings")
        .select(`id, ${LISTING_SELECT_ART_DECO}`)
        .in("id", listingIds);

      for (const extra of extras || []) {
        extrasById.set(extra.id, extra);
      }
    }

    return safeRows.map((row) => {
      const extra = extrasById.get(row.id);
      return {
        ...row,
        price_usd: extra?.price_usd ?? row.price_usd ?? 0,
        currency: extra?.currency ?? row.currency ?? "USD",
        art_deco_payload: extra?.art_deco_payload ?? row.art_deco_payload ?? null,
      };
    });
  }

  // LISTINGS PUBLICOS (paginado)
  router.get("/community-store/listings", async (req, res) => {
    const limit = clampInt(req.query.limit, 1, 48, 12);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);

    let sort = typeof req.query.sort === "string" ? req.query.sort : "recent";
    const media = typeof req.query.media === "string" ? req.query.media : "all";
    const seller = typeof req.query.seller === "string" ? req.query.seller.trim() : "";
    const qSearchRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const qSearch = qSearchRaw ? qSearchRaw.slice(0, 80).replace(/,/g, " ") : "";
    const mine = String(req.query.mine || "").toLowerCase() === "1" || String(req.query.mine || "").toLowerCase() === "true";

    // Usuario (si existe) - se usa para filtros "mine" y likedByMe
    const { user } = await maybeUserFromReq(req, supabaseAdmin);

    // Aliases de sort (para UI)
    if (sort === "hot") sort = "top_liked";
    if (sort === "newer") sort = "recent";
    if (sort === "older") sort = "oldest";
    if (sort === "most_commented") sort = "top_commented";
    if (sort === "best_seller") sort = "top_sold";

    const queryShape = { media, seller, qSearch, sort, offset, limit };

    let data = null;
    let error = null;

    if (mine) {
      if (!user?.id) return err(res, 401, "AUTH_REQUIRED", "Necesitas iniciar sesión para ver tus listings.");

      const result = await applyListingsQueryShape(
        supabaseAdmin
          .from("community_listings")
          .select(LISTING_SELECT_FULL)
          .eq("seller_id", user.id),
        queryShape
      );

      data = result.data;
      error = result.error;
    } else {
      const primaryResult = await applyListingsQueryShape(
        supabaseAdmin
          .from("community_listings_public_catalog")
          .select(LISTING_SELECT_FULL),
        queryShape
      );

      data = primaryResult.data;
      error = primaryResult.error;

      if (error && isMissingPublicCatalogArtDecoColumn(error)) {
        const legacyResult = await applyListingsQueryShape(
          supabaseAdmin
            .from("community_listings_public_catalog")
            .select(LISTING_SELECT_BASE),
          queryShape
        );

        if (legacyResult.error) return err(res, 500, "DB_QUERY_FAILED", legacyResult.error.message);

        data = await enrichLegacyCatalogRows(legacyResult.data || []);
        error = null;
      }
    }

    if (error) return err(res, 500, "DB_QUERY_FAILED", error.message);

    const rows = data || [];
    const listingIds = rows.map((r) => r.id).filter(Boolean);

    const likedSet = new Set();
    const purchasedSet = new Set();
    if (user?.id && listingIds.length > 0) {
      const [{ data: likedRows }, { data: purchasedRows }] = await Promise.all([
        supabaseAdmin
          .from("community_listing_likes")
          .select("listing_id")
          .eq("user_id", user.id)
          .in("listing_id", listingIds),
        supabaseAdmin
          .from("community_purchases")
          .select("listing_id")
          .eq("buyer_id", user.id)
          .eq("status", "completed")
          .in("listing_id", listingIds),
      ]);

      for (const r of likedRows || []) likedSet.add(r.listing_id);
      for (const r of purchasedRows || []) purchasedSet.add(r.listing_id);
    }

    // Signed preview URLs
    const previewUrlByListingId = new Map();
    for (const r of rows) {
      const url = r.preview_asset_id ? await signedUrlForAssetId(r.preview_asset_id) : null;
      previewUrlByListingId.set(r.id, url);
    }

    const items = rows.map((r) => {
      const ownedByMe = user?.id ? r.seller_id === user.id : false;
      const purchasedByMe = user?.id && r.listing_kind !== "art_deco" ? purchasedSet.has(r.id) : false;
      const artDecoPayload = safeArtDecoPayload(r.art_deco_payload);
      const previewUrl = artDecoPreviewFromPayload(artDecoPayload) || previewUrlByListingId.get(r.id) || null;

      return {
        id: r.id,
        sellerId: r.seller_id,
        sellerUsername: r.seller_username_snapshot || "seller",
        sellerVerified: Boolean(r.seller_verified_snapshot),

        listingKind: r.listing_kind,
        mediaTag: r.media_tag,

        name: r.name || "",
        priceCredits: Number(r.price_credits) || 0,
        priceUsd: normalizeUsd(r.price_usd),
        currency: r.currency || "USD",
        artDecoPayload: r.listing_kind === "art_deco" ? artDecoPayload : null,
        description: r.description || "",

        status: r.status,

        previewUrl,

        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),

        likesCount: Number(r.likes_count) || 0,
        commentsCount: Number(r.comments_count) || 0,
        salesCount: Number(r.sales_count) || 0,

        likedByMe: user?.id ? likedSet.has(r.id) : false,
        ownedByMe,
        purchasedByMe,
      };
    });

    return res.json({
      ok: true,
      items,
      nextOffset: offset + items.length,
      hasMore: items.length === limit,
    });
  });

  // DETALLE PUBLICO (sin receta)
  router.get("/community-store/listings/:id", async (req, res) => {
    const listingId = req.params.id;
    const { user } = await maybeUserFromReq(req, supabaseAdmin);

    const { data: row, error } = await supabaseAdmin
      .from("community_listings")
      .select(
        "id, name, seller_id, seller_username_snapshot, seller_verified_snapshot, listing_kind, media_tag, price_credits, price_usd, currency, art_deco_payload, description, status, preview_asset_id, created_at, likes_count, comments_count, sales_count"
      )
      .eq("id", listingId)
      .maybeSingle();

    if (error) return err(res, 500, "DB_QUERY_FAILED", error.message);
    if (!row) return err(res, 404, "NOT_FOUND", "Listing no encontrado.");

    let purchasedByMe = false;
    if (user?.id && row.seller_id !== user.id) {
      const { data: purchaseRow } = await supabaseAdmin
        .from("community_purchases")
        .select("id")
        .eq("listing_id", listingId)
        .eq("buyer_id", user.id)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle();

      purchasedByMe = Boolean(purchaseRow?.id);
    }

    const sellerAccess = await sellerCanSellNow(row.seller_id);
    if (!sellerAccess.ok) {
      return err(res, 500, sellerAccess.error.code, sellerAccess.error.message, sellerAccess.error.details);
    }

    const ownedByMe = user?.id ? row.seller_id === user.id : false;
    const hiddenByPlanLoss = row.status === "active" && !sellerAccess.canSell;
    const canBypassPublicHide = ownedByMe || purchasedByMe;

    if (row.status !== "active") {
      return err(res, 404, "NOT_FOUND", "Listing no encontrado.");
    }

    if (hiddenByPlanLoss && !canBypassPublicHide) {
      return err(res, 404, "NOT_FOUND", "Listing no encontrado.");
    }

    const previewUrl = row.preview_asset_id ? await signedUrlForAssetId(row.preview_asset_id) : null;

    let likedByMe = false;
    if (user?.id) {
      const { data: likeRow } = await supabaseAdmin
        .from("community_listing_likes")
        .select("id")
        .eq("listing_id", listingId)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      likedByMe = Boolean(likeRow?.id);
    }

    return res.json({
      ok: true,
      item: {
        id: row.id,
        sellerId: row.seller_id,
        sellerUsername: row.seller_username_snapshot || "seller",
        sellerVerified: Boolean(row.seller_verified_snapshot),

        listingKind: row.listing_kind,
        mediaTag: row.media_tag,

        name: row.name || "",
        priceCredits: Number(row.price_credits) || 0,
        priceUsd: normalizeUsd(row.price_usd),
        currency: row.currency || "USD",
        artDecoPayload: row.listing_kind === "art_deco" ? safeArtDecoPayload(row.art_deco_payload) : null,
        description: row.description || "",

        status: row.status,

        previewUrl: artDecoPreviewFromPayload(row.art_deco_payload) || previewUrl,

        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),

        likesCount: Number(row.likes_count) || 0,
        commentsCount: Number(row.comments_count) || 0,
        salesCount: Number(row.sales_count) || 0,

        likedByMe,
        ownedByMe,
        purchasedByMe,
        visibility: hiddenByPlanLoss ? "purchase_only" : "public",
      },
    });
  });
  // CREAR LISTING (SELL)
  router.post("/community-store/listings", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // ✅ Solo Pro/Partner/Business pueden vender
    const active = await billing.getActiveSubscription(user.id);
    if (active.error) return err(res, 500, active.error.code, active.error.message, active.error.details);
    if (!active.subscription || !active.subscription.canSell) {
      return err(res, 403, "PLAN_REQUIRED_PRO", "Necesitas plan Pro o superior para publicar y vender.");
    }

    let body;
    try {
      body = CreateListingSchema.parse(req.body);
    } catch (e) {
      return err(res, 400, "BAD_REQUEST", e?.message || "Payload inválido.");
    }

        const { previewAssetId, name, priceCredits, description, listingKind } = body;

    const { data: assetRow, error: aErr } = await supabaseAdmin
      .from("assets")
      .select("id, owner_id, type, tool, prompt, meta, created_at")
      .eq("id", previewAssetId)
      .maybeSingle();

    if (aErr) return err(res, 500, "DB_QUERY_FAILED", aErr.message);
    if (!assetRow) return err(res, 404, "ASSET_NOT_FOUND", "Asset no encontrado.");
    if (assetRow.owner_id !== user.id) return err(res, 403, "FORBIDDEN", "Ese asset no es tuyo.");

    // Si ya existe listing para ese asset (del mismo seller), reusalo y solo actualiza precio/desc/status
    const { data: existing } = await supabaseAdmin
      .from("community_listings")
      .select("id, status")
      .eq("seller_id", user.id)
      .eq("preview_asset_id", previewAssetId)
      .eq("listing_kind", listingKind)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const { error: upErr } = await supabaseAdmin
        .from("community_listings")
        .update({
          name,
          price_credits: priceCredits,
          description,
          status: "active",
        })
        .eq("id", existing.id)
        .eq("seller_id", user.id);

      if (upErr) {
        if (String(upErr.code) === "23505") return err(res, 409, "NAME_TAKEN", "Ya existe un listing con ese nombre. Elige otro.");
        return err(res, 500, "DB_UPDATE_FAILED", upErr.message);
      }

      return res.json({ ok: true, listingId: existing.id, reused: true });
    }

    // Snapshot seller username
    const { data: profileRow } = await supabaseAdmin.from("profiles").select("username").eq("id", user.id).maybeSingle();
    const sellerUsername = profileRow?.username || (user.email ? user.email.split("@")[0] : "seller");

    const mediaTag = listingKind === "workflow" ? "workflow" : assetRow.type === "video" ? "video" : "image";

    const { data: insRows, error: insErr } = await supabaseAdmin
      .from("community_listings")
      .insert({
        seller_id: user.id,
        seller_username_snapshot: sellerUsername,
        seller_verified_snapshot: false,
        listing_kind: listingKind,
        media_tag: mediaTag,
        name,
        price_credits: priceCredits,
        description,
        status: "active",
        preview_asset_id: previewAssetId,
        listed_at: new Date().toISOString(),
      })
      .select("id")
      .limit(1);

    if (insErr) return err(res, 500, "DB_INSERT_FAILED", insErr.message);
    const listingId = insRows?.[0]?.id;
    if (!listingId) return err(res, 500, "DB_INSERT_FAILED", "No se pudo crear listing.");

    // Receta snapshot + hash (inmutable)
    const recipeSnapshot = {
      version: 2,
      kind: "single",
      createdAt: Date.now(),
      sourceAsset: {
        id: assetRow.id,
        type: assetRow.type,
        tool: assetRow.tool || null,
        prompt: stripHiddenPresetBlocks(assetRow.prompt || ""),
        meta: sanitizeRecipeMeta(assetRow.meta || {}),
        createdAt: assetRow.created_at || null,
      },
    };

    const hash = sha256Hex(canonicalJson(recipeSnapshot));

    const { error: recErr } = await supabaseAdmin.from("community_listing_recipes").insert({
      listing_id: listingId,
      seller_id: user.id,
      recipe_snapshot: recipeSnapshot,
      recipe_hash: hash,
    });

    if (recErr) return err(res, 500, "DB_INSERT_FAILED", recErr.message);

    return res.json({ ok: true, listingId, reused: false });
  });

  router.post("/community-store/art-deco", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const active = await billing.getActiveSubscription(user.id);
    if (active.error) return err(res, 500, active.error.code, active.error.message, active.error.details);
    if (!active.subscription || !active.subscription.canSell) {
      return err(res, 403, "PLAN_REQUIRED_PRO", "Necesitas plan Pro o superior para publicar Art Deco en Community Store.");
    }

    let body;
    try {
      body = CreateArtDecoListingSchema.parse(req.body);
    } catch (e) {
      return err(res, 400, "BAD_REQUEST", e?.message || "Payload inválido.");
    }

    const { previewAssetId, name, description, priceUsd, currency, artDecoPayload } = body;

    const { data: assetRow, error: aErr } = await supabaseAdmin
      .from("assets")
      .select("id, owner_id, type")
      .eq("id", previewAssetId)
      .maybeSingle();

    if (aErr) return err(res, 500, "DB_QUERY_FAILED", aErr.message);
    if (!assetRow) return err(res, 404, "ASSET_NOT_FOUND", "Asset no encontrado.");
    if (assetRow.owner_id !== user.id) return err(res, 403, "FORBIDDEN", "Ese asset no es tuyo.");
    if (assetRow.type !== "image") return err(res, 400, "BAD_REQUEST", "Art Deco solo admite assets de imagen.");

    const priceUsdNorm = normalizeUsd(priceUsd);
    const basePriceUsd = normalizeUsd(artDecoPayload?.pricing?.basePrice);
    const sellerProfitUsd = normalizeUsd(artDecoPayload?.pricing?.sellerProfit);
    if (priceUsdNorm <= basePriceUsd) {
      return err(res, 400, "BAD_REQUEST", "El precio de venta debe ser mayor que el costo base del servicio.");
    }
    if (Math.abs((priceUsdNorm - basePriceUsd) - sellerProfitUsd) > 0.02) {
      return err(res, 400, "BAD_REQUEST", "La ganancia del seller no coincide con el margen calculado.");
    }

    const { data: profileRow } = await supabaseAdmin.from("profiles").select("username").eq("id", user.id).maybeSingle();
    const sellerUsername = profileRow?.username || (user.email ? user.email.split("@")[0] : "seller");

    const storedPayload = {
      ...artDecoPayload,
      pricing: {
        ...artDecoPayload.pricing,
        basePrice: basePriceUsd,
        salePrice: priceUsdNorm,
        sellerProfit: sellerProfitUsd,
        currency: currency || "USD",
      },
    };

    const { data: existing } = await supabaseAdmin
      .from("community_listings")
      .select("id")
      .eq("seller_id", user.id)
      .eq("preview_asset_id", previewAssetId)
      .eq("listing_kind", "art_deco")
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const { error: upErr } = await supabaseAdmin
        .from("community_listings")
        .update({
          name,
          description,
          status: "active",
          price_credits: 0,
          price_usd: priceUsdNorm,
          currency: currency || "USD",
          art_deco_payload: storedPayload,
          listed_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("seller_id", user.id);

      if (upErr) {
        if (String(upErr.code) === "23505") return err(res, 409, "NAME_TAKEN", "Ya existe un listing con ese nombre. Elige otro.");
        return err(res, 500, "DB_UPDATE_FAILED", upErr.message);
      }

      return res.json({ ok: true, listingId: existing.id, reused: true });
    }

    const { data: insRows, error: insErr } = await supabaseAdmin
      .from("community_listings")
      .insert({
        seller_id: user.id,
        seller_username_snapshot: sellerUsername,
        seller_verified_snapshot: false,
        listing_kind: "art_deco",
        media_tag: "image",
        name,
        price_credits: 0,
        price_usd: priceUsdNorm,
        currency: currency || "USD",
        art_deco_payload: storedPayload,
        description,
        status: "active",
        preview_asset_id: previewAssetId,
        listed_at: new Date().toISOString(),
      })
      .select("id")
      .limit(1);

    if (insErr) {
      if (String(insErr.code) === "23505") return err(res, 409, "NAME_TAKEN", "Ya existe un listing con ese nombre. Elige otro.");
      return err(res, 500, "DB_INSERT_FAILED", insErr.message);
    }

    const listingId = insRows?.[0]?.id;
    if (!listingId) return err(res, 500, "DB_INSERT_FAILED", "No se pudo crear listing Art Deco.");

    return res.json({ ok: true, listingId, reused: false });
  });

  // UPDATE LISTING (precio/descripcion/status)
  router.patch("/community-store/listings/:id", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const listingId = req.params.id;

    let body;
    try {
      body = UpdateListingSchema.parse(req.body);
    } catch (e) {
      return err(res, 400, "BAD_REQUEST", e?.message || "Payload inválido.");
    }

    // Si intenta reactivar/publicar, vuelve a exigir plan seller
    if (body.status === "active") {
      const active = await billing.getActiveSubscription(user.id);
      if (active.error) return err(res, 500, active.error.code, active.error.message, active.error.details);
      if (!active.subscription || !active.subscription.canSell) {
        return err(res, 403, "PLAN_REQUIRED_PRO", "Necesitas plan Pro o superior para publicar y vender.");
      }
    }

    const patch = {};
    if (body.name != null) patch.name = body.name;
    if (body.priceCredits != null) patch.price_credits = body.priceCredits;
    if (body.priceUsd != null) patch.price_usd = normalizeUsd(body.priceUsd);
    if (body.currency != null) patch.currency = body.currency;
    if (body.description != null) patch.description = body.description;
    if (body.status != null) {
      patch.status = body.status;
      if (body.status === "active") patch.listed_at = new Date().toISOString();
      if (body.status === "deleted") patch.listed_at = null;
    }

    const { error: upErr } = await supabaseAdmin
      .from("community_listings")
      .update(patch)
      .eq("id", listingId)
      .eq("seller_id", user.id);

    if (upErr) return err(res, 500, "DB_UPDATE_FAILED", upErr.message);

    return res.json({ ok: true });
  });

  // LIKE toggle
  router.post("/community-store/listings/:id/like", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const listingId = req.params.id;

    // asegurar que existe y esta activo
    const { data: lrow, error: lerr } = await supabaseAdmin
      .from("community_listings")
      .select("id, status, seller_id")
      .eq("id", listingId)
      .maybeSingle();

    if (lerr) return err(res, 500, "DB_QUERY_FAILED", lerr.message);
    if (!lrow || lrow.status !== "active") return err(res, 404, "NOT_FOUND", "Listing no encontrado.");

    const sellerAccess = await sellerCanSellNow(lrow.seller_id);
    if (!sellerAccess.ok) {
      return err(res, 500, sellerAccess.error.code, sellerAccess.error.message, sellerAccess.error.details);
    }
    if (!sellerAccess.canSell) return err(res, 404, "NOT_FOUND", "Listing no encontrado.");

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("community_listing_likes")
      .select("id")
      .eq("listing_id", listingId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (exErr) return err(res, 500, "DB_QUERY_FAILED", exErr.message);

    let liked = false;

    if (existing?.id) {
      const { error: delErr } = await supabaseAdmin.from("community_listing_likes").delete().eq("id", existing.id);
      if (delErr) return err(res, 500, "DB_DELETE_FAILED", delErr.message);
      liked = false;
    } else {
      const { error: insErr } = await supabaseAdmin
        .from("community_listing_likes")
        .insert({ listing_id: listingId, user_id: user.id });

      if (insErr) {
        if (String(insErr.code) === "23505") liked = true;
        else return err(res, 500, "DB_INSERT_FAILED", insErr.message);
      } else {
        liked = true;
      }
    }

    const { data: cntRow } = await supabaseAdmin
      .from("community_listings")
      .select("likes_count")
      .eq("id", listingId)
      .maybeSingle();

    const likesCount = Number.isFinite(Number(cntRow?.likes_count)) ? Number(cntRow.likes_count) : 0;

    return res.json({ ok: true, liked, likesCount });
  });

  // COMMENTS list
  router.get("/community-store/listings/:id/comments", async (req, res) => {
    const listingId = req.params.id;

    const limit = clampInt(req.query.limit, 1, 200, 50);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);

    const { data: lrow, error: lerr } = await supabaseAdmin
      .from("community_listings")
      .select("id, status, seller_id")
      .eq("id", listingId)
      .maybeSingle();

    if (lerr) return err(res, 500, "DB_QUERY_FAILED", lerr.message);
    if (!lrow || lrow.status !== "active") return err(res, 404, "NOT_FOUND", "Listing no encontrado.");

    const sellerAccess = await sellerCanSellNow(lrow.seller_id);
    if (!sellerAccess.ok) {
      return err(res, 500, sellerAccess.error.code, sellerAccess.error.message, sellerAccess.error.details);
    }
    if (!sellerAccess.canSell) return err(res, 404, "NOT_FOUND", "Listing no encontrado.");

    const { user } = await maybeUserFromReq(req, supabaseAdmin);

    const rl = await checkUserRateLimit({
      userId: user?.id || "anon",
      scope: "listing_comments_list",
      windowMs: 60 * 1000,
      max: 120,
    });

    if (!rl.ok) {
      return err(res, 429, "RATE_LIMITED", "Demasiadas solicitudes. Espera un momento.", {
        retryAfterSeconds: rl.retryAfterSeconds,
      });
    }

    let q = supabaseAdmin
      .from("community_listing_comments")
      .select("id, user_id, text, created_at, is_shadowed", { count: "exact" })
      .eq("listing_id", listingId)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (user?.id) {
      q = q.or(`is_shadowed.eq.false,user_id.eq.${user.id}`);
    } else {
      q = q.eq("is_shadowed", false);
    }

    const { data: rows, error, count } = await q;
    if (error) return err(res, 500, "DB_QUERY_FAILED", error.message);

    const commentRows = rows || [];
    const userIds = Array.from(new Set(commentRows.map((r) => r.user_id).filter(Boolean)));

    const usernameById = new Map();
    if (userIds.length > 0) {
      const { data: profileRows } = await supabaseAdmin.from("profiles").select("id, username").in("id", userIds);
      for (const p of profileRows || []) usernameById.set(p.id, p.username);
    }

    const comments = commentRows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: usernameById.get(r.user_id) || `User_${String(r.user_id).slice(0, 4)}`,
      text: r.text,
      timestamp: new Date(r.created_at).getTime(),
      isShadowed: Boolean(r.is_shadowed),
    }));

    const commentsCount = Number.isFinite(Number(count)) ? Number(count) : comments.length;

    return res.json({ ok: true, comments, commentsCount });
  });

  // COMMENT create
  router.post("/community-store/listings/:id/comments", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const listingId = req.params.id;

    const { data: lrow, error: lerr } = await supabaseAdmin
      .from("community_listings")
      .select("id, status, seller_id")
      .eq("id", listingId)
      .maybeSingle();

    if (lerr) return err(res, 500, "DB_QUERY_FAILED", lerr.message);
    if (!lrow || lrow.status !== "active") return err(res, 404, "NOT_FOUND", "Listing no encontrado.");

    const sellerAccess = await sellerCanSellNow(lrow.seller_id);
    if (!sellerAccess.ok) {
      return err(res, 500, sellerAccess.error.code, sellerAccess.error.message, sellerAccess.error.details);
    }
    if (!sellerAccess.canSell) return err(res, 404, "NOT_FOUND", "Listing no encontrado.");

    let body;
    try {
      body = CreateCommentSchema.parse(req.body);
    } catch (e) {
      return err(res, 400, "BAD_REQUEST", e?.message || "Comentario inválido.");
    }

    const rl = await checkUserRateLimit({
      userId: user.id,
      scope: "listing_comment_create",
      windowMs: 30 * 1000,
      max: 8,
    });

    if (!rl.ok) {
      return err(res, 429, "RATE_LIMITED", "Demasiados comentarios. Espera y vuelve a intentar.", {
        retryAfterSeconds: rl.retryAfterSeconds,
      });
    }

    const moderation = await getUserModeration(supabaseAdmin, user.id);
    const textEval = evaluateCommentText(body.text);
    const isShadowed = Boolean(moderation.shadowBanned) || Boolean(textEval.shouldShadow);

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("community_listing_comments")
      .insert({
        listing_id: listingId,
        user_id: user.id,
        text: body.text,
        is_shadowed: isShadowed,
      })
      .select("id, user_id, text, created_at, is_shadowed")
      .limit(1)
      .maybeSingle();

    if (insErr) return err(res, 500, "DB_INSERT_FAILED", insErr.message);
    if (!inserted) return err(res, 500, "DB_INSERT_FAILED", "No se pudo insertar comentario.");

    const { data: profileRow } = await supabaseAdmin.from("profiles").select("username").eq("id", user.id).maybeSingle();
    const username = profileRow?.username || (user.email ? user.email.split("@")[0] : "user");

    const { data: cntRow } = await supabaseAdmin
      .from("community_listings")
      .select("comments_count")
      .eq("id", listingId)
      .maybeSingle();

    const commentsCount = Number.isFinite(Number(cntRow?.comments_count)) ? Number(cntRow.comments_count) : 0;

    return res.json({
      ok: true,
      comment: {
        id: inserted.id,
        userId: inserted.user_id,
        username,
        text: inserted.text,
        timestamp: new Date(inserted.created_at).getTime(),
        isShadowed: Boolean(inserted.is_shadowed),
      },
      commentsCount,
    });
  });

  // PURCHASE (usa funcion SQL atomica)
  router.post("/community-store/purchase", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    let body;
    try {
      body = PurchaseSchema.parse(req.body);
    } catch (e) {
      return err(res, 400, "BAD_REQUEST", e?.message || "Payload inválido.");
    }

    const { data: listingRow, error: listingErr } = await supabaseAdmin
      .from("community_listings")
      .select("id, listing_kind, status")
      .eq("id", body.listingId)
      .maybeSingle();

    if (listingErr) return err(res, 500, "DB_QUERY_FAILED", listingErr.message);
    if (!listingRow || listingRow.status !== "active") return err(res, 404, "LISTING_UNAVAILABLE", "Este listing ya no está disponible públicamente.");
    if (listingRow.listing_kind === "art_deco") {
      return err(res, 409, "ART_DECO_REQUIRES_STORE_FLOW", "Este Art Deco se compra desde el flujo físico de 1NationUp, no con créditos.");
    }

    const idempotencyKey = req.headers["x-idempotency-key"]
      ? String(req.headers["x-idempotency-key"])
      : randomUUID();

    const { data, error: rpcErr } = await supabaseAdmin.rpc("community_purchase_listing", {
      p_listing_id: body.listingId,
      p_buyer_id: user.id,
      p_referral_code: body.referralCode || null,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcErr) {
      const msg = rpcErr.message || "Compra fallida.";

      if (msg.includes("NO_ACTIVE_PLAN")) {
        return err(res, 403, "NO_ACTIVE_PLAN", "Necesitas un plan activo para usar créditos de generación o comprar en Community Store.");
      }

      if (msg.includes("SELLER_PLAN_REQUIRED") || msg.includes("LISTING_NOT_ACTIVE") || msg.includes("LISTING_NOT_FOUND")) {
        return err(res, 404, "LISTING_UNAVAILABLE", "Este listing ya no está disponible públicamente.");
      }

      if (msg.includes("INVALID_REFERRAL_CODE")) {
        return err(res, 400, "INVALID_REFERRAL_CODE", "El código de referido no es válido.");
      }

      if (msg.includes("REFERRAL_OWNER_NOT_ELIGIBLE")) {
        return err(res, 400, "REFERRAL_OWNER_NOT_ELIGIBLE", "Ese código de referido ya no está habilitado por el plan actual de su dueño.");
      }

      if (msg.includes("INSUFFICIENT_CREDITS")) {
        let need = 0;
        let have = 0;

        try {
          const { data: lrow } = await supabaseAdmin
            .from("community_listings")
            .select("price_credits")
            .eq("id", body.listingId)
            .maybeSingle();

          need = Number(lrow?.price_credits) || 0;

          const { data: bal } = await supabaseAdmin
            .from("wallet_balances")
            .select("gen_plan_credits, gen_topup_credits, gen_bonus_credits")
            .eq("user_id", user.id)
            .maybeSingle();

          have =
            (Number(bal?.gen_plan_credits) || 0) +
            (Number(bal?.gen_topup_credits) || 0) +
            (Number(bal?.gen_bonus_credits) || 0);
        } catch {}

        const deficit = Math.max(0, need - have);
        return err(res, 400, "INSUFFICIENT_CREDITS", "No tienes créditos suficientes.", { need, have, deficit });
      }

      if (msg.includes("ALREADY_OWNED")) return err(res, 400, "ALREADY_OWNED", "Ya compraste este listing.");
      if (msg.includes("CANNOT_BUY_OWN_LISTING")) return err(res, 400, "CANNOT_BUY_OWN_LISTING", "No puedes comprar tu propio listing.");

      return err(res, 500, "PURCHASE_FAILED", msg);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return res.json({
      ok: true,
      purchaseId: row?.purchase_id || null,
      paidCredits: Number(row?.paid_credits) || 0,
      idempotencyKey,
    });
  });

  // RECIPE (solo comprador o vendedor)
  router.get("/community-store/listings/:id/recipe", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const listingId = req.params.id;

    const { data: listingRow, error: lerr } = await supabaseAdmin
      .from("community_listings")
      .select("id, seller_id, listing_kind, status")
      .eq("id", listingId)
      .maybeSingle();

    if (lerr) return err(res, 500, "DB_QUERY_FAILED", lerr.message);
    if (!listingRow) return err(res, 404, "NOT_FOUND", "Listing no encontrado.");
    if (listingRow.listing_kind === "art_deco") return err(res, 403, "RECIPE_NOT_AVAILABLE", "Las publicaciones Art Deco no exponen receta reutilizable.");

    const isSeller = listingRow.seller_id === user.id;

    let canView = isSeller;
    if (!canView) {
      const { data: pRow } = await supabaseAdmin
        .from("community_purchases")
        .select("id")
        .eq("listing_id", listingId)
        .eq("buyer_id", user.id)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle();

      canView = Boolean(pRow?.id);
    }

    if (!canView) return err(res, 403, "FORBIDDEN", "Debes comprar para ver la receta.");

    const { data: rRow, error: rErr } = await supabaseAdmin
      .from("community_listing_recipes")
      .select("recipe_snapshot, recipe_hash, created_at")
      .eq("listing_id", listingId)
      .limit(1)
      .maybeSingle();

    if (rErr) return err(res, 500, "DB_QUERY_FAILED", rErr.message);
    if (!rRow) return err(res, 500, "RECIPE_MISSING", "La receta no existe (error interno).");

    // ✅ Resolver referencias (para poder reusar receta con referencias reales)
    const recipe = rRow.recipe_snapshot || {};
    const source = recipe?.sourceAsset || {};
    const meta = source?.meta || {};

    const refs = [];
    const seen = new Set();
    const pushRef = (assetId, role, token) => {
      const id = typeof assetId === "string" ? assetId.trim() : "";
      if (!id) return;
      if (seen.has(id)) return;
      seen.add(id);
      refs.push({ assetId: id, role: role || "element", token: token || null });
    };

    const prs = Array.isArray(meta.promptReferences) ? meta.promptReferences : [];
    if (prs.length) {
      for (const r of prs) {
        const assetId = typeof r?.id === "string" ? r.id : typeof r?.assetId === "string" ? r.assetId : "";
        const token = typeof r?.token === "string" ? r.token : null;
        const role = typeof r?.role === "string" ? r.role : "element";
        pushRef(assetId, role, token);
      }
    } else {
      const chars = Array.isArray(meta.characterAssetIds) ? meta.characterAssetIds : [];
      for (let i = 0; i < chars.length; i++) {
        const role = i < 3 ? "character" : "element";
        const token = i < 3 ? `@img${i + 1}` : null;
        pushRef(chars[i], role, token);
      }
      if (typeof meta.backgroundAssetId === "string") pushRef(meta.backgroundAssetId, "background", "@bg");
    }

    if (typeof meta.firstFrameAssetId === "string") pushRef(meta.firstFrameAssetId, "firstFrame", "@first");
    if (typeof meta.lastFrameAssetId === "string") pushRef(meta.lastFrameAssetId, "lastFrame", "@last");

    const edit = meta?.editVideo && typeof meta.editVideo === "object" ? meta.editVideo : null;
    if (edit) {
      if (typeof edit.videoAssetId === "string") pushRef(edit.videoAssetId, "inputVideo", "@video1");
      if (typeof edit.startImageAssetId === "string") pushRef(edit.startImageAssetId, "startImage", "@start");
      if (typeof edit.endImageAssetId === "string") pushRef(edit.endImageAssetId, "endImage", "@end");

      const refIds = Array.isArray(edit.referenceImageAssetIds) ? edit.referenceImageAssetIds : [];
      refIds.forEach((assetId, index) => pushRef(assetId, "reference", `@image${index + 1}`));

      const elementIds = Array.isArray(edit.klingElementIds) ? edit.klingElementIds : [];
      elementIds.forEach((assetId, index) => pushRef(assetId, "element", `@element${index + 1}`));
    }

    const resolvedAssets = [];
    for (const r of refs) {
      const url = await signedUrlForAssetId(r.assetId);
      resolvedAssets.push({ ...r, url: url || null });
    }

    return res.json({
      ok: true,
      recipe,
      recipeHash: rRow.recipe_hash,
      createdAt: rRow.created_at ? new Date(rRow.created_at).getTime() : Date.now(),

      // [{ assetId, role, token, url }]
      resolvedAssets,
    });
  });

  return router;
}
