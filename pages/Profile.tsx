import React, { useEffect, useState } from "react";
import { AppRoute } from "../types";
import { getMyWallet } from "../services/walletApi";
import { billingMe, billingPlans, billingTopups, mockSubscribe, mockTopup, mockCancel } from "../services/billingApi";

export default function Profile({ onNavigate }: { onNavigate: (r: AppRoute) => void }) {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<any>(null);
  const [sub, setSub] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [topups, setTopups] = useState<any[]>([]);
  const [err, setErr] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const w = await getMyWallet();
      const s = await billingMe();
      const p = await billingPlans();
      const t = await billingTopups();
      setWallet(w);
      setSub(s);
      setPlans(p);
      setTopups(t);
    } catch (e: any) {
      setErr(e?.message || "Error cargando perfil.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  if (loading) return <div className="p-6 text-white">Cargando...</div>;

  const generationCredits = wallet?.generationCredits || 0;

  return (
    <div className="p-6 text-white max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Perfil y Créditos</h1>
        <button
          className="px-4 py-2 rounded bg-white/10 hover:bg-white/20"
          onClick={() => onNavigate(AppRoute.HOME)}
        >
          Volver
        </button>
      </div>

      {err ? <div className="mb-4 p-3 rounded bg-red-500/20 border border-red-500/30">{err}</div> : null}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-sm text-white/70">Plan actual</div>
          <div className="text-lg font-semibold">{sub?.planName || "Sin plan activo"}</div>
          <div className="text-xs text-white/60 mt-1">{sub?.currentPeriodEnd ? `Renueva / vence: ${sub.currentPeriodEnd}` : ""}</div>

          <div className="mt-4 text-sm text-white/70">Créditos para generar</div>
          <div className="text-3xl font-extrabold">{generationCredits}</div>
          <div className="text-xs text-white/60 mt-1">
            Plan: {wallet?.planCredits || 0} · Extra: {wallet?.topupCredits || 0} · Bonus: {wallet?.bonusCredits || 0}
          </div>

          <div className="mt-4 flex gap-2">
            <button className="px-3 py-2 rounded bg-white/10 hover:bg-white/20" onClick={refresh}>Refrescar</button>
            <button
              className="px-3 py-2 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/30"
              onClick={async () => { await mockCancel(); await refresh(); }}
            >
              Cancelar plan (borra créditos)
            </button>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-lg font-semibold mb-2">Planes</div>
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="p-3 rounded bg-black/30 border border-white/10 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-white/60">{p.billing_period === "week" ? "Semanal" : "Mensual"} · ${Number(p.price_cents / 100).toFixed(2)}</div>
                  <div className="text-xs text-white/60">Créditos: {p.plan_credits} + Bonus: {p.bonus_credits}</div>
                </div>
                <button
                  className="px-3 py-2 rounded bg-[rgba(241,225,148,0.14)] hover:bg-[rgba(241,225,148,0.22)] border border-[rgba(241,225,148,0.25)]"
                  onClick={async () => { await mockSubscribe(p.slug); await refresh(); }}
                >
                  Comprar
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-2 p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-lg font-semibold mb-2">Créditos extra</div>
          <div className="grid md:grid-cols-3 gap-2">
            {topups.map((t) => (
              <button
                key={t.id}
                className="p-3 rounded bg-black/30 border border-white/10 hover:bg-white/10 text-left"
                onClick={async () => { await mockTopup(t.id); await refresh(); }}
              >
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs text-white/60">+{t.credits_amount} créditos</div>
              </button>
            ))}
          </div>
          <div className="text-xs text-white/50 mt-2">
            Nota: comprar créditos extra requiere plan activo.
          </div>
        </div>
      </div>
    </div>
  );
}
