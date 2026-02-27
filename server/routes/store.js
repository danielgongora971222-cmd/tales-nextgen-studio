import express from "express";
import { randomUUID } from "crypto";
import { StoreOrderSchema } from "../schemas/index.js";

export function createStoreRouter(ctx) {
  const router = express.Router();

  const { requireUser, supabaseAdmin } = ctx;

  router.post("/store/order", async (req, res) => {
    try {
      const body = StoreOrderSchema.parse(req.body);

      const { user, error } = await requireUser(req);
      if (error) return res.status(401).json({ ok: false, error });

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
            owner_id: user.id,
            created_at: now,
            payload: body,
            status: "created",
          });

        if (!insErr) inserted = true;
      } catch {
        inserted = false;
      }

      return res.json({
        ok: true,
        orderId,
        stored: inserted,
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