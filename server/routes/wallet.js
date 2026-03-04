import express from "express";

export function createWalletRouter(ctx) {
  const router = express.Router();
  const { supabaseAdmin, requireUser, ADMIN_TOKEN } = ctx;

  function err(res, status, code, message, details) {
    return res.status(status).json({ ok: false, error: { code, message, details: details || null } });
  }

  // Wallet del usuario (tambien ejecuta maturation global)
  router.get("/wallet/me", async (req, res) => {
    const { user, error } = await requireUser(req);
    if (error) return res.status(401).json({ ok: false, error });

    // asegura row wallet
    await supabaseAdmin.from("wallet_balances").upsert({ user_id: user.id }, { onConflict: "user_id" });

    // maturation (safe para repetirse)
    await supabaseAdmin.rpc("billing_mature_due_referrals", {});

    const { data, error: qErr } = await supabaseAdmin
      .from("wallet_balances")
      .select("gen_plan_credits, gen_topup_credits, gen_bonus_credits, earnings_pending_credits, earnings_matured_credits")
      .eq("user_id", user.id)
      .maybeSingle();

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    // plan activo (si existe)
    const { data: sub, error: sErr } = await supabaseAdmin.rpc("get_active_subscription", { p_user_id: user.id });
    if (sErr) return err(res, 500, "DB_RPC_FAILED", sErr.message);
    const active = Array.isArray(sub) ? sub[0] : null;

    const gen_plan_credits = Number(data?.gen_plan_credits) || 0;
    const gen_topup_credits = Number(data?.gen_topup_credits) || 0;
    const gen_bonus_credits = Number(data?.gen_bonus_credits) || 0;

    return res.json({
      ok: true,
      wallet: {
        gen_plan_credits,
        gen_topup_credits,
        gen_bonus_credits,
        generationCredits: gen_plan_credits + gen_topup_credits + gen_bonus_credits,

        earnings_pending_credits: Number(data?.earnings_pending_credits) || 0,
        earnings_matured_credits: Number(data?.earnings_matured_credits) || 0,
      },
      subscription: active?.subscription_id
        ? {
            subscription_id: active.subscription_id,
            plan_slug: active.plan_slug,
            plan_name: active.plan_name,
            can_sell: !!active.can_sell,
            can_referrals: !!active.can_referrals,
            current_period_end: active.current_period_end,
          }
        : null,
    });
  });

  // Admin: grant credits (para testing)
  router.post("/wallet/admin/grant", async (req, res) => {
    if (!ADMIN_TOKEN) return err(res, 503, "ADMIN_NOT_CONFIGURED", "ADMIN_TOKEN no configurado en el server.");

    const token = req.headers["x-admin-token"] ? String(req.headers["x-admin-token"]) : "";
    if (!token || token !== ADMIN_TOKEN) return err(res, 401, "UNAUTHORIZED", "Admin token inválido.");

    const userId = req.body?.userId ? String(req.body.userId) : "";
    const amount = Number(req.body?.amountCredits);

    if (!userId) return err(res, 400, "BAD_REQUEST", "Falta userId.");
    if (!Number.isFinite(amount) || amount <= 0) return err(res, 400, "BAD_REQUEST", "amountCredits debe ser > 0.");

    await supabaseAdmin.from("wallet_balances").upsert({ user_id: userId }, { onConflict: "user_id" });

    const { data: row, error: qErr } = await supabaseAdmin
      .from("wallet_balances")
      .select("gen_plan_credits, gen_topup_credits, gen_bonus_credits")
      .eq("user_id", userId)
      .maybeSingle();

    if (qErr) return err(res, 500, "DB_QUERY_FAILED", qErr.message);

    const gen_plan_credits = Number(row?.gen_plan_credits) || 0;
    const gen_topup_credits = Number(row?.gen_topup_credits) || 0;
    const currentBonus = Number(row?.gen_bonus_credits) || 0;

    const add = Math.floor(amount);
    const nextBonus = currentBonus + add;

    const { error: saveErr } = await supabaseAdmin
      .from("wallet_balances")
      .update({ gen_bonus_credits: nextBonus })
      .eq("user_id", userId);

    if (saveErr) return err(res, 500, "DB_UPDATE_FAILED", saveErr.message);

    await supabaseAdmin.from("wallet_ledger").insert({
      user_id: userId,
      entry_type: "admin_grant_gen_bonus_credits",
      amount_credits: add,
      ref_type: "admin",
      ref_id: null,
    });

    const generationCredits = gen_plan_credits + gen_topup_credits + nextBonus;

    return res.json({
      ok: true,
      userId,
      wallet: {
        gen_plan_credits,
        gen_topup_credits,
        gen_bonus_credits: nextBonus,
        generationCredits,
      },
    });
  });

  return router;
}
