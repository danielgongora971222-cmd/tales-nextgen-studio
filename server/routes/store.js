import express from "express";
import { randomUUID } from "crypto";
import { StoreOrderSchema } from "../schemas/index.js";
import { sendStoreOrderEmail } from "../email/storeOrderEmail.js";

export function createStoreRouter(ctx) {
  const router = express.Router();

  const { requireUser, supabaseAdmin } = ctx;

  router.post("/store/order", async (req, res) => {
    try {
      const body = StoreOrderSchema.parse(req.body);

      // Store puede ser público: si no hay login, seguimos igual (pero sin owner_id)
      let user = null;
      try {
        const r = await requireUser(req);
        if (!r?.error) user = r.user;
      } catch {
        user = null;
      }

      const orderId = randomUUID();
      const now = new Date().toISOString();

      // Best-effort insert (no rompemos si la tabla aún no existe)
      const table = process.env.STORE_ORDERS_TABLE || "store_orders";

      let inserted = false;
      try {
        const { error: insErr } = await supabaseAdmin
          .from(table)
          .insert({
            id: orderId,
            owner_id: user ? user.id : null,
            created_at: now,
            payload: body,
            status: "created",
          });

        if (!insErr) inserted = true;
      } catch {
        inserted = false;
      }

      // Email best-effort (solo si ENABLE_STORE_EMAIL=1)
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