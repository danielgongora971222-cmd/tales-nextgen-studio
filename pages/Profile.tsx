import React, { useEffect, useState } from "react";
import { AppRoute } from "../types";
import { getMyWallet } from "../services/walletApi";
import { billingMe, billingPlans, billingTopups, mockSubscribe, mockTopup, mockCancel } from "../services/billingApi";
import { acceptLegal } from "../services/legalApi";
import ConfirmDollarPurchaseModal from "@/components/ConfirmDollarPurchaseModal";

const TERMS_VERSION = "2026-03-03";
const PRIVACY_VERSION = "2026-03-03";
const AUTOPAY_VERSION = "2026-03-03";

type ConfirmState =
  | null
  | {
      itemLabel: string;
      amountLabel: string;
      note?: string | null;
      action: () => Promise<void>;
    };

export default function Profile({ onNavigate }: { onNavigate: (r: AppRoute) => void }) {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<any>(null);
  const [sub, setSub] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [topups, setTopups] = useState<any[]>([]);
  const [err, setErr] = useState<string>("");

  const [confirm, setConfirm] = useState<ConfirmState>(null);

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
      setErr(e?.message || "Error al cargar perfil.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (loading) return <div className="p-6 text-white">Cargando...</div>;

  const generationCredits = wallet?.generationCredits || 0;

  function periodLabel(period: string) {
    if (period === "week") return "semanal";
    if (period === "year") return "anual";
    return "mensual";
  }

  return (
    <div className="p-6 text-white max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Perfil y Créditos</h1>
        <button className="px-4 py-2 rounded bg-white/10 hover:bg-white/20" onClick={() => onNavigate(AppRoute.HOME)}>
          Volver
        </button>
      </div>

      {err ? <div className="mb-4 p-3 rounded bg-red-500/20 border border-red-500/40">{err}</div> : null}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-lg font-semibold">Créditos</div>
          <div className="mt-2 text-3xl font-extrabold text-[rgba(241,225,148,0.95)]">{generationCredits}</div>
          <div className="mt-1 text-xs text-white/60">Créditos disponibles para generar.</div>

          <div className="mt-4 text-sm">
            <div className="text-white/80">Plan activo:</div>
            <div className="font-semibold">{sub?.plan_name || "Ninguno"}</div>
          </div>

          <div className="mt-4 flex gap-2">
            <button className="px-3 py-2 rounded bg-white/10 hover:bg-white/20" onClick={refresh}>
              Refrescar
            </button>
            <button
              className="px-3 py-2 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/30"
              onClick={async () => {
                await mockCancel();
                await refresh();
              }}
            >
              Cancelar plan (borra créditos)
            </button>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-lg font-semibold mb-2">Planes</div>
          <div className="space-y-2">
            {plans.map((pl) => {
              const price = `$${Number(pl.price_cents / 100).toFixed(2)} USD`;
              const per = periodLabel(pl.billing_period);
              return (
                <div key={pl.id} className="p-3 rounded bg-black/30 border border-white/10 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{pl.name}</div>
                    <div className="text-xs text-white/60">
                      {per.charAt(0).toUpperCase() + per.slice(1)} · {price}
                    </div>
                    <div className="text-xs text-white/60">Créditos: {pl.plan_credits} + Bonus: {pl.bonus_credits}</div>
                  </div>

                  <button
                    className="px-3 py-2 rounded bg-[rgba(241,225,148,0.14)] hover:bg-[rgba(241,225,148,0.22)] border border-[rgba(241,225,148,0.25)]"
                    onClick={() => {
                      setConfirm({
                        itemLabel: `Plan ${pl.name} (${per})`,
                        amountLabel: price,
                        note: `Esta compra es una suscripción ${per} recurrente hasta que canceles.`,
                        action: async () => {
                          await acceptLegal({
                            termsVersion: TERMS_VERSION,
                            privacyVersion: PRIVACY_VERSION,
                            autopayVersion: AUTOPAY_VERSION,
                          });

                          await mockSubscribe(pl.slug);
                          await refresh();
                        },
                      });
                    }}
                  >
                    Comprar
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-2 p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="text-lg font-semibold mb-2">Créditos extra</div>
          <div className="grid md:grid-cols-3 gap-2">
            {topups.map((t) => {
              const price = `$${Number(t.price_cents / 100).toFixed(2)} USD`;
              return (
                <button
                  key={t.id}
                  className="p-3 rounded bg-black/30 border border-white/10 hover:bg-white/10 text-left"
                  onClick={() => {
                    setConfirm({
                      itemLabel: `Créditos extra (${t.credits_amount} créditos)`,
                      amountLabel: price,
                      note: "Compra puntual. Requiere plan activo.",
                      action: async () => {
                        await acceptLegal({
                          termsVersion: TERMS_VERSION,
                          privacyVersion: PRIVACY_VERSION,
                          autopayVersion: AUTOPAY_VERSION,
                        });

                        await mockTopup(t.id);
                        await refresh();
                      },
                    });
                  }}
                >
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-white/60">
                    {price} · +{t.credits_amount} créditos
                  </div>
                </button>
              );
            })}
          </div>
          <div className="text-xs text-white/50 mt-2">Nota: comprar créditos extra requiere plan activo.</div>
        </div>
      </div>

      <ConfirmDollarPurchaseModal
        open={!!confirm}
        itemLabel={confirm?.itemLabel || ""}
        amountLabel={confirm?.amountLabel || ""}
        note={confirm?.note || null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await confirm.action();
        }}
      />
    </div>
  );
}