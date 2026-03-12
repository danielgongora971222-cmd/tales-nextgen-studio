import express from "express";
import { randomUUID } from "crypto";
import { StoreOrderSchema } from "../schemas/index.js";
import { sendStoreOrderEmail } from "../email/storeOrderEmail.js";

export function createStoreRouter(ctx) {
  const router = express.Router();

  const { requireUser, supabaseAdmin } = ctx;

  router.post("/store/order", async (req, res) => {
    try {
      const parsedBody = StoreOrderSchema.parse(req.body);
      let body = JSON.parse(JSON.stringify(parsedBody));

      // Store puede ser público: si no hay login, seguimos igual (pero sin owner_id)
      let user = null;
      try {
        const r = await requireUser(req);
        if (!r?.error) user = r.user;
      } catch {
        user = null;
      }

      if (body.artDeco?.listingId) {
        const { data: listingRow, error: listingErr } = await supabaseAdmin
          .from("community_listings")
          .select("id, seller_id, seller_username_snapshot, status, price_usd, currency, art_deco_payload")
          .eq("id", body.artDeco.listingId)
          .maybeSingle();

        if (listingErr) {
          return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED", message: listingErr.message, details: null } });
        }
        if (!listingRow || listingRow.status !== "active") {
          return res.status(404).json({ ok: false, error: { code: "LISTING_UNAVAILABLE", message: "Este Art Deco ya no está disponible.", details: null } });
        }

        const payload = listingRow.art_deco_payload && typeof listingRow.art_deco_payload === "object" ? listingRow.art_deco_payload : {};
        const salePriceUsd = Number(listingRow.price_usd || payload?.pricing?.salePrice || 0);
        const basePriceUsd = Number(payload?.pricing?.basePrice || 0);
        const sellerProfitUsd = Math.max(0, salePriceUsd - basePriceUsd);

        body.assetId = payload?.assetId || body.assetId;
        body.assetUrl = payload?.assetUrl || body.assetUrl;
        body.assetName = payload?.assetName || body.assetName;
        body.imageDims = payload?.imageDims || body.imageDims;
        body.material = payload?.material || body.material;
        body.materialLabel = payload?.materialLabel || body.materialLabel;
        body.size = payload?.size || body.size;
        body.fitMode = payload?.fitMode || body.fitMode;
        body.cropNormalized = payload?.cropNormalized || body.cropNormalized;
        body.croppedImageDataUrl = payload?.croppedImageDataUrl || body.croppedImageDataUrl;
        body.pricing = {
          ...(body.pricing || {}),
          basePrice: salePriceUsd,
          total: salePriceUsd + Number(body?.pricing?.shipping || 0) + Number(body?.pricing?.smartFillAddon || 0),
        };
        body.artDeco = {
          listingId: listingRow.id,
          sellerId: listingRow.seller_id || null,
          sellerUsername: listingRow.seller_username_snapshot || undefined,
          salePriceUsd,
          basePriceUsd,
          sellerProfitUsd,
          currency: listingRow.currency || payload?.pricing?.currency || "USD",
        };

        body = StoreOrderSchema.parse(body);
      }

      const orderId = randomUUID();
      const now = new Date().toISOString();

      const table = process.env.STORE_ORDERS_TABLE || "store_orders";
      const orderKind = body.artDeco?.listingId ? "art_deco" : "standard";

      let inserted = false;
      try {
        const { error: insErr } = await supabaseAdmin
          .from(table)
          .insert({
            id: orderId,
            owner_id: user ? user.id : null,
            buyer_id: user ? user.id : null,
            seller_id: body.artDeco?.sellerId || null,
            art_deco_listing_id: body.artDeco?.listingId || null,
            order_kind: orderKind,
            sale_price_usd: body.artDeco?.salePriceUsd || body.pricing?.basePrice || 0,
            base_service_price_usd: body.artDeco?.basePriceUsd || body.pricing?.basePrice || 0,
            seller_profit_usd: body.artDeco?.sellerProfitUsd || 0,
            currency: body.artDeco?.currency || "USD",
            customer_name: body.delivery?.customerName || null,
            buyer_email: body.delivery?.email || null,
            preview_asset_id: body.assetId || null,
            created_at: now,
            updated_at: now,
            payload: body,
            status: "created",
          });

        if (!insErr) inserted = true;
      } catch {
        inserted = false;
      }

      if (inserted && body.artDeco?.listingId) {
        try {
          const { data: row } = await supabaseAdmin
            .from("community_listings")
            .select("sales_count")
            .eq("id", body.artDeco.listingId)
            .maybeSingle();
          const nextCount = (Number(row?.sales_count) || 0) + 1;
          await supabaseAdmin.from("community_listings").update({ sales_count: nextCount }).eq("id", body.artDeco.listingId);
        } catch {}
      }

      let email = { sent: false, reason: "disabled" };
      if (String(process.env.ENABLE_STORE_EMAIL || "") === "1") {
        try {
          email = await sendStoreOrderEmail({ orderId, payload: body });
        } catch (e) {
          email = { sent: false, reason: e?.message || "email_failed" };
        }
      }

      return res.json({
        ok: true,
        orderId,
        stored: inserted,
        email,
        note: inserted
          ? "stored_in_db"
          : "not_stored_db_yet_create_table_store_orders_or_set_STORE_ORDERS_TABLE",
      });
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: e?.message || "Invalid order payload",
        },
      });
    }
  });

  return router;
}