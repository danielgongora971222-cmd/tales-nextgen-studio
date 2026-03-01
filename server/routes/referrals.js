import express from "express";
import { randomUUID } from "crypto";

function makeCode(prefix) {
  const raw = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}${raw}`;
}

async function ensureOneCode(supabaseAdmin, ownerId, variant, buyerDiscountPct, refRewardPct, prefix) {
  const { data: existing } = await supabaseAdmin
    .from("community_referral_codes")
    .select("id, code, variant, buyer_discount_pct, ref_reward_pct, is_active")
    .eq("owner_id", ownerId)
    .eq("variant", variant)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing;

  for (let i = 0; i < 7; i++) {
    const code = makeCode(prefix);

    const { data: ins, error } = await supabaseAdmin
      .from("community_referral_codes")
      .insert({
        owner_id: ownerId,
        code,
        variant,
        buyer_discount_pct: buyerDiscountPct,
        ref_reward_pct: refRewardPct,
        is_active: true,
      })
      .select("id, code, variant, buyer_discount_pct, ref_reward_pct, is_active")
      .limit(1);

    if (!error && ins?.[0]) return ins[0];

    // retry si colision de UNIQUE(code)
    if (!error) break;
    if (String(error.code) !== "23505") break;
  }

  return null;
}

export function createReferralsRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  router.get("/referrals/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const a = await ensureOneCode(supabaseAdmin, user.id, "A", 20, 0, "TNG20-");
    const b = await ensureOneCode(supabaseAdmin, user.id, "B", 10, 10, "TNG10-");
    const c = await ensureOneCode(supabaseAdmin, user.id, "C", 0, 20, "TNG00-");

    if (!a || !b || !c) return err(res, 500, "CODES_CREATE_FAILED", "No se pudieron asegurar tus 3 códigos.");

    return res.json({
      ok: true,
      codes: [
        {
          id: a.id,
          code: a.code,
          variant: "A",
          buyerDiscountPct: Number(a.buyer_discount_pct) || 0,
          refRewardPct: Number(a.ref_reward_pct) || 0,
          isActive: Boolean(a.is_active),
        },
        {
          id: b.id,
          code: b.code,
          variant: "B",
          buyerDiscountPct: Number(b.buyer_discount_pct) || 0,
          refRewardPct: Number(b.ref_reward_pct) || 0,
          isActive: Boolean(b.is_active),
        },
        {
          id: c.id,
          code: c.code,
          variant: "C",
          buyerDiscountPct: Number(c.buyer_discount_pct) || 0,
          refRewardPct: Number(c.ref_reward_pct) || 0,
          isActive: Boolean(c.is_active),
        },
      ],
    });
  });

  return router;
}
