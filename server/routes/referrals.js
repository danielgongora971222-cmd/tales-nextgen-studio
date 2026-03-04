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
  const { supabaseAdmin, requireUser, billing } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  async function requireReferralAccess(userId) {
    // Safety: si por error no pasamos billing al router, fallamos con mensaje claro
    if (!billing?.requireActiveSubscription) {
      return {
        ok: false,
        subscription: null,
        error: {
          code: "SERVER_MISCONFIGURED",
          message: "Referrals no está configurado en el servidor (billing missing).",
          details: { required: "billing.requireActiveSubscription" },
        },
      };
    }

    const active = await billing.requireActiveSubscription(userId);

    // Si no tiene plan activo, transformamos a un error que empuje al upgrade
    if (active?.error) {
      if (active.error.code === "NO_ACTIVE_PLAN") {
        return {
          ok: false,
          subscription: null,
          error: {
            code: "PLAN_UPGRADE_REQUIRED",
            message:
              "Para desbloquear Referidos/Afiliados necesitas activar un plan compatible. Ve a Planes y elige Partner o superior.",
            details: { requiredFeature: "referrals", havePlan: null },
          },
        };
      }
      return { ok: false, subscription: null, error: active.error };
    }

    const sub = active?.subscription || null;

    // NOTA: en tu repo actual el plan sólo expone canSell (no existe canReferrals aún),
    // así que usamos canSell como “feature gate” para referidos.
    if (!sub?.canReferrals) {
      return {
        ok: false,
        subscription: sub,
        error: {
          code: "PLAN_UPGRADE_REQUIRED",
          message:
            "Tu plan actual no incluye Referidos/Afiliados. Para obtener códigos debes subir a un plan Partner o superior.",
          details: { requiredFeature: "referrals", havePlan: sub?.planSlug || null },
        },
      };
    }

    return { ok: true, subscription: sub, error: null };
  }

  router.get("/referrals/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const access = await requireReferralAccess(user.id);
    if (!access.ok) return res.status(403).json({ ok: false, error: access.error });

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

    router.get("/referrals/summary", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const access = await requireReferralAccess(user.id);
    if (!access.ok) return res.status(403).json({ ok: false, error: access.error });

    const { data: rows, error: qErr } = await supabaseAdmin
      .from("billing_referrals")
      .select(
        "id, referred_user_id, referred_username_snapshot, plan_slug_snapshot, buyer_bonus_credits, referrer_reward_credits, created_at, matures_at, is_matured"
      )
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    // Si todavía no has aplicado el patch SQL que crea billing_referrals, NO rompas el UI:
    // devuelve vacío y una flag isConfigured=false.
    if (qErr) {
      const msg = String(qErr.message || "");
      const code = String(qErr.code || "");
      const missingTable =
        code === "42P01" || msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation");

      if (missingTable) {
        return res.json({
          ok: true,
          isConfigured: false,
          referrals: [],
          totals: {
            count: 0,
            totalRewardCredits: 0,
            totalBuyerBonusCredits: 0,
            pendingRewardCredits: 0,
            maturedRewardCredits: 0,
          },
        });
      }

      return err(res, 500, "DB_QUERY_FAILED", qErr.message);
    }

    const referrals = (rows || []).map((r) => ({
      id: r.id,
      referredUserId: r.referred_user_id,
      referredUsername: r.referred_username_snapshot || null,
      planSlug: r.plan_slug_snapshot || null,
      buyerBonusCredits: Number(r.buyer_bonus_credits) || 0,
      referrerRewardCredits: Number(r.referrer_reward_credits) || 0,
      createdAt: r.created_at,
      maturesAt: r.matures_at,
      isMatured: Boolean(r.is_matured),
    }));

    const totals = referrals.reduce(
      (acc, r) => {
        acc.count += 1;
        acc.totalRewardCredits += r.referrerRewardCredits;
        acc.totalBuyerBonusCredits += r.buyerBonusCredits;
        if (r.isMatured) acc.maturedRewardCredits += r.referrerRewardCredits;
        else acc.pendingRewardCredits += r.referrerRewardCredits;
        return acc;
      },
      {
        count: 0,
        totalRewardCredits: 0,
        totalBuyerBonusCredits: 0,
        pendingRewardCredits: 0,
        maturedRewardCredits: 0,
      }
    );

    return res.json({ ok: true, isConfigured: true, referrals, totals });
  });

  return router;
}
