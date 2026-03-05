// server/lib/billing.js
import { randomUUID } from "crypto";

export function createBillingHelpers(supabaseAdmin) {
  function err(code, message, details) {
    return { code, message, details: details || null };
  }

  async function getActiveSubscription(userId) {
    const { data, error } = await supabaseAdmin.rpc("get_active_subscription", { p_user_id: userId });
    if (error) return { subscription: null, error: err("DB_RPC_FAILED", error.message) };

    const sub = Array.isArray(data) ? data[0] : null;
    if (!sub?.subscription_id) return { subscription: null, error: null };

    return {
      subscription: {
        subscriptionId: sub.subscription_id,
        planId: sub.plan_id,
        planSlug: sub.plan_slug,
        planName: sub.plan_name,
        canSell: !!sub.can_sell,
        canReferrals: !!sub.can_referrals,
        maxConcurrency: Number(sub.max_concurrency) || 2,
        billingPeriod: sub.billing_period,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
      },
      error: null,
    };
  }

  async function requireActiveSubscription(userId) {
    const { subscription, error } = await getActiveSubscription(userId);
    if (error) return { subscription: null, error };
    if (!subscription) {
      return { subscription: null, error: err("NO_ACTIVE_PLAN", "Necesitas un plan activo para usar esta función.") };
    }
    return { subscription, error: null };
  }

  async function spendCredits({
    userId,
    amountCredits,
    entryType,
    refType,
    refId,
    idempotencyKey,
  }) {
    const { data, error } = await supabaseAdmin.rpc("wallet_spend_generation_credits", {
      p_user_id: userId,
      p_amount: amountCredits,
      p_entry_type: entryType,
      p_ref_type: refType || null,
      p_ref_id: refId || null,
      p_idempotency_key: idempotencyKey || null,
    });

    if (error) {
      const msg = String(error.message || "");

      if (msg.includes("NO_ACTIVE_PLAN")) {
        return {
          ok: false,
          error: err("NO_ACTIVE_PLAN", "Necesitas un plan activo para usar créditos de generación."),
        };
      }

      if (msg.includes("INSUFFICIENT_CREDITS")) {
        let have = 0;

        try {
          const { data: bal } = await supabaseAdmin
            .from("wallet_balances")
            .select("gen_plan_credits, gen_topup_credits, gen_bonus_credits")
            .eq("user_id", userId)
            .maybeSingle();

          have =
            (Number(bal?.gen_plan_credits) || 0) +
            (Number(bal?.gen_topup_credits) || 0) +
            (Number(bal?.gen_bonus_credits) || 0);
        } catch {
          // fallback: have = 0
        }

        const need = amountCredits;
        const deficit = Math.max(0, need - have);

        return {
          ok: false,
          error: err("INSUFFICIENT_CREDITS", "Créditos insuficientes.", { need, have, deficit }),
        };
      }

      return { ok: false, error: err("CREDIT_SPEND_FAILED", error.message) };
    }

    const row = Array.isArray(data) ? data[0] : null;
    return {
      ok: true,
      spend: {
        ledgerId: row?.ledger_id || null,
        newPlanCredits: Number(row?.gen_plan_credits) || 0,
        newTopupCredits: Number(row?.gen_topup_credits) || 0,
        newBonusCredits: Number(row?.gen_bonus_credits) || 0,
      },
    };
  }

  function getIdempotencyKey(req) {
    const raw = req.headers["x-idempotency-key"];
    const key = raw ? String(raw) : "";
    return key && key.length >= 8 ? key : randomUUID();
  }

  return { getActiveSubscription, requireActiveSubscription, spendCredits, getIdempotencyKey };
}
