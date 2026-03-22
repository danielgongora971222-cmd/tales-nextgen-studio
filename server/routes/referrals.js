import express from "express";
import { randomUUID } from "crypto";

function makeCode(prefix) {
  const raw = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `${prefix}${raw}`;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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

function mapOfferMeta(buyerDiscountPct, refRewardPct) {
  const buyer = Math.max(0, Math.trunc(Number(buyerDiscountPct) || 0));
  const reward = Math.max(0, Math.trunc(Number(refRewardPct) || 0));

  return {
    buyerDiscountPct: buyer,
    refRewardPct: reward,
    offerLabel: `Cliente -${buyer}% · Partner +${reward}%`,
    offerKey: `${buyer}_${reward}`,
  };
}

async function ensureOneCode(supabaseAdmin, ownerId, variant, buyerDiscountPct, refRewardPct, prefix) {
  const { data: existing } = await supabaseAdmin
    .from("community_referral_codes")
    .select("id, code, variant, buyer_discount_pct, ref_reward_pct, is_active")
    .eq("owner_id", ownerId)
    .eq("variant", variant)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const needsFix =
      Number(existing.buyer_discount_pct) !== Number(buyerDiscountPct) ||
      Number(existing.ref_reward_pct) !== Number(refRewardPct) ||
      existing.is_active !== true;

    if (needsFix) {
      const { data: upd, error: uErr } = await supabaseAdmin
        .from("community_referral_codes")
        .update({
          buyer_discount_pct: buyerDiscountPct,
          ref_reward_pct: refRewardPct,
          is_active: true,
        })
        .eq("id", existing.id)
        .select("id, code, variant, buyer_discount_pct, ref_reward_pct, is_active")
        .limit(1)
        .maybeSingle();

      if (!uErr && upd?.id) return upd;
    }

    return existing;
  }

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

  async function getExistingBuyerReferralGrant(userId) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) return null;

    const primary = await supabaseAdmin
      .from("billing_referrals")
      .select("id, status, created_at, referral_code_snapshot, referred_user_id")
      .eq("referred_user_id", normalizedUserId)
      .in("status", ["pending", "matured"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!primary.error) return primary.data || null;
    if (isMissingTableError(primary.error)) return null;

    if (!isMissingColumnError(primary.error, "status")) {
      throw primary.error;
    }

    const fallback = await supabaseAdmin
      .from("billing_referrals")
      .select("id, is_matured, created_at, referral_code_snapshot, referred_user_id")
      .eq("referred_user_id", normalizedUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallback.error) {
      if (isMissingTableError(fallback.error)) return null;
      throw fallback.error;
    }

    if (!fallback.data?.id) return null;

    return {
      id: fallback.data.id,
      status: fallback.data.is_matured ? "matured" : "pending",
      created_at: fallback.data.created_at,
      referral_code_snapshot: fallback.data.referral_code_snapshot || null,
      referred_user_id: fallback.data.referred_user_id || normalizedUserId,
    };
  }

  async function getReferralSummaryRows(userId) {
    const primary = await supabaseAdmin
      .from("billing_referrals")
      .select(
        "id, referred_user_id, referred_username_snapshot, plan_slug_snapshot, buyer_bonus_credits, referrer_reward_credits, buyer_discount_pct_snapshot, ref_reward_pct_snapshot, created_at, matures_at, is_matured, status, reversed_at, reverse_reason, referral_code_id, referral_code_snapshot"
      )
      .eq("referrer_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!primary.error) {
      return { rows: Array.isArray(primary.data) ? primary.data : [], isConfigured: true };
    }

    if (isMissingTableError(primary.error)) {
      return { rows: [], isConfigured: false };
    }

    if (!isMissingColumnError(primary.error, "status") && !isMissingColumnError(primary.error, "buyer_discount_pct_snapshot")) {
      throw primary.error;
    }

    const fallback = await supabaseAdmin
      .from("billing_referrals")
      .select(
        "id, referred_user_id, referred_username_snapshot, plan_slug_snapshot, buyer_bonus_credits, referrer_reward_credits, created_at, matures_at, is_matured, referral_code_id, referral_code_snapshot"
      )
      .eq("referrer_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (fallback.error) {
      if (isMissingTableError(fallback.error)) return { rows: [], isConfigured: false };
      throw fallback.error;
    }

    const fallbackRows = Array.isArray(fallback.data) ? fallback.data : [];
    const referralCodeIds = [...new Set(fallbackRows.map((row) => row.referral_code_id).filter(Boolean))];

    let referralCodeMap = new Map();
    if (referralCodeIds.length) {
      const codesResp = await supabaseAdmin
        .from("community_referral_codes")
        .select("id, buyer_discount_pct, ref_reward_pct")
        .in("id", referralCodeIds);

      if (!codesResp.error && Array.isArray(codesResp.data)) {
        referralCodeMap = new Map(
          codesResp.data.map((row) => [row.id, { buyer_discount_pct: row.buyer_discount_pct, ref_reward_pct: row.ref_reward_pct }])
        );
      }
    }

    const rows = fallbackRows.map((row) => {
      const codeMeta = referralCodeMap.get(row.referral_code_id) || null;
      return {
        ...row,
        buyer_discount_pct_snapshot: Number(codeMeta?.buyer_discount_pct) || 0,
        ref_reward_pct_snapshot: Number(codeMeta?.ref_reward_pct) || 0,
        status: row.is_matured ? "matured" : "pending",
        reversed_at: null,
        reverse_reason: null,
      };
    });

    return { rows, isConfigured: true };
  }

  async function requireReferralAccess(userId) {
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

  router.get("/referrals/validate", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const raw = req.query?.code ? String(req.query.code) : "";
    const code = raw ? raw.trim().toUpperCase() : "";

    if (!code) {
      return res.json({
        ok: true,
        valid: false,
        eligible: false,
        reason: "EMPTY",
        code: null,
        variant: null,
        buyerDiscountPct: 0,
        refRewardPct: 0,
        ownerPlanSlug: null,
        ownerPlanName: null,
      });
    }

    const { data: rc, error: rcErr } = await supabaseAdmin
      .from("community_referral_codes")
      .select("id, code, variant, owner_id, buyer_discount_pct, ref_reward_pct, is_active")
      .eq("code", code)
      .eq("is_active", true)
      .maybeSingle();

    if (rcErr) return err(res, 500, "DB_QUERY_FAILED", rcErr.message);

    if (!rc?.id) {
      return res.json({
        ok: true,
        valid: false,
        eligible: false,
        reason: "NOT_FOUND",
        code: null,
        variant: null,
        buyerDiscountPct: 0,
        refRewardPct: 0,
        ownerPlanSlug: null,
        ownerPlanName: null,
      });
    }

    const buyerDiscountPct = Number(rc.buyer_discount_pct) || 0;
    const refRewardPct = Number(rc.ref_reward_pct) || 0;

    if (rc.owner_id === user.id) {
      return res.json({
        ok: true,
        valid: false,
        eligible: false,
        reason: "SELF",
        code: rc.code,
        variant: rc.variant,
        buyerDiscountPct,
        refRewardPct,
        ownerPlanSlug: null,
        ownerPlanName: null,
      });
    }

    try {
      const buyerActive = await billing.getActiveSubscription(user.id);
      if (buyerActive?.subscription?.subscriptionId) {
        return res.json({
          ok: true,
          valid: true,
          eligible: false,
          reason: "BUYER_HAS_ACTIVE_PLAN",
          code: rc.code,
          variant: rc.variant,
          buyerDiscountPct,
          refRewardPct,
          ownerPlanSlug: null,
          ownerPlanName: null,
        });
      }
    } catch {
      // noop: si falla la comprobación, dejamos que backend de checkout vuelva a validar.
    }

    try {
      const existingGrant = await getExistingBuyerReferralGrant(user.id);
      if (existingGrant?.id) {
        return res.json({
          ok: true,
          valid: true,
          eligible: false,
          reason: "BUYER_ALREADY_REFERRED",
          code: rc.code,
          variant: rc.variant,
          buyerDiscountPct,
          refRewardPct,
          ownerPlanSlug: null,
          ownerPlanName: null,
        });
      }
    } catch (lookupError) {
      return err(res, 500, "DB_QUERY_FAILED", lookupError?.message || "No se pudo validar el estado del referido.");
    }

    let eligible = false;
    let ownerPlanSlug = null;
    let ownerPlanName = null;

    try {
      const r = await billing.getActiveSubscription(rc.owner_id);
      ownerPlanSlug = r?.subscription?.planSlug || null;
      ownerPlanName = r?.subscription?.planName || null;
      eligible = !!r?.subscription?.canReferrals;
    } catch {
      eligible = false;
    }

    return res.json({
      ok: true,
      valid: true,
      eligible,
      reason: eligible ? null : "OWNER_NOT_ELIGIBLE",
      code: rc.code,
      variant: rc.variant,
      buyerDiscountPct,
      refRewardPct,
      ownerPlanSlug,
      ownerPlanName,
    });
  });

  router.get("/referrals/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const access = await requireReferralAccess(user.id);
    if (!access.ok) return res.status(403).json({ ok: false, error: access.error });

    const a = await ensureOneCode(supabaseAdmin, user.id, "A", 15, 5, "TNG15-");
    const b = await ensureOneCode(supabaseAdmin, user.id, "B", 5, 15, "TNG05-");
    const c = await ensureOneCode(supabaseAdmin, user.id, "C", 10, 10, "TNG10-");

    if (!a || !b || !c) return err(res, 500, "CODES_CREATE_FAILED", "No se pudieron asegurar tus 3 códigos.");

    const ordered = [b, a, c].map((row) => ({
      id: row.id,
      code: row.code,
      variant: row.variant,
      isActive: Boolean(row.is_active),
      ...mapOfferMeta(row.buyer_discount_pct, row.ref_reward_pct),
    }));

    return res.json({ ok: true, codes: ordered });
  });

  router.get("/referrals/summary", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    const access = await requireReferralAccess(user.id);
    if (!access.ok) return res.status(403).json({ ok: false, error: access.error });

    try {
      const summary = await getReferralSummaryRows(user.id);
      if (!summary.isConfigured) {
        return res.json({
          ok: true,
          isConfigured: false,
          referrals: [],
          totals: {
            count: 0,
            activeCount: 0,
            reversedCount: 0,
            totalRewardCredits: 0,
            pendingRewardCredits: 0,
            maturedRewardCredits: 0,
            reversedRewardCredits: 0,
            totalBuyerBonusCredits: 0,
          },
        });
      }

      const referrals = (summary.rows || []).map((row) => {
        const status = String(row.status || (row.is_matured ? "matured" : "pending")).toLowerCase();
        return {
          id: row.id,
          referredUserId: row.referred_user_id,
          referredUsername: row.referred_username_snapshot || null,
          planSlug: row.plan_slug_snapshot || null,
          referralCode: row.referral_code_snapshot || null,
          buyerBonusCredits: Number(row.buyer_bonus_credits) || 0,
          referrerRewardCredits: Number(row.referrer_reward_credits) || 0,
          buyerDiscountPct: Number(row.buyer_discount_pct_snapshot) || 0,
          refRewardPct: Number(row.ref_reward_pct_snapshot) || 0,
          status,
          createdAt: row.created_at,
          maturesAt: row.matures_at,
          isMatured: status === "matured",
          reversedAt: row.reversed_at || null,
          reverseReason: row.reverse_reason || null,
          ...mapOfferMeta(row.buyer_discount_pct_snapshot, row.ref_reward_pct_snapshot),
        };
      });

      const totals = referrals.reduce(
        (acc, r) => {
          acc.count += 1;
          if (r.status === "reversed") {
            acc.reversedCount += 1;
            acc.reversedRewardCredits += r.referrerRewardCredits;
          } else {
            acc.activeCount += 1;
            acc.totalRewardCredits += r.referrerRewardCredits;
            if (r.status === "matured") acc.maturedRewardCredits += r.referrerRewardCredits;
            else acc.pendingRewardCredits += r.referrerRewardCredits;
          }
          acc.totalBuyerBonusCredits += r.buyerBonusCredits;
          return acc;
        },
        {
          count: 0,
          activeCount: 0,
          reversedCount: 0,
          totalRewardCredits: 0,
          pendingRewardCredits: 0,
          maturedRewardCredits: 0,
          reversedRewardCredits: 0,
          totalBuyerBonusCredits: 0,
        }
      );

      return res.json({ ok: true, isConfigured: true, referrals, totals });
    } catch (qErr) {
      return err(res, 500, "DB_QUERY_FAILED", qErr?.message || "No se pudieron cargar los referidos.");
    }
  });

  return router;
}
