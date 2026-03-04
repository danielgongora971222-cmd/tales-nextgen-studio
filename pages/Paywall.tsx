import React, { useEffect, useState } from "react";
import { billingPlans, mockSubscribe } from "../services/billingApi";
import { acceptLegal } from "../services/legalApi";
import { useAuth } from "../contexts/AuthContext";

const TERMS_VERSION = "2026-03-03";
const PRIVACY_VERSION = "2026-03-03";
const AUTOPAY_VERSION = "2026-03-03";

export default function Paywall({
  onSubscribed,
  onContinueExploring,
}: {
  onSubscribed: () => Promise<void> | void;
  onContinueExploring?: () => void;
}) {
  const { logout } = useAuth();

  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptAutopay, setAcceptAutopay] = useState(false);

  const [referralCode, setReferralCode] = useState("");

  const canContinue = acceptTerms && acceptPrivacy && acceptAutopay;

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const p = await billingPlans();
        setPlans(p);
      } catch (e: any) {
        setError(e?.message || "No se pudieron cargar los planes.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSubscribe(planSlug: string) {
    setError(null);
    setBusySlug(planSlug);
    try {
      if (!canContinue) {
        throw new Error("Debes aceptar términos, privacidad y auto-renovación para continuar.");
      }

      await acceptLegal({
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        autopayVersion: AUTOPAY_VERSION,
      });

      await mockSubscribe(planSlug, referralCode);
      await onSubscribed();
    } catch (e: any) {
      setError(e?.message || "No se pudo activar el plan.");
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-3xl font-bold">Activa tu plan</div>
            <div className="text-white/60 text-sm mt-2">
              Para usar la app necesitas un plan activo. También debes aceptar los términos y la auto-renovación.
            </div>
          </div>

          <div className="flex gap-2">
            {onContinueExploring ? (
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
                onClick={onContinueExploring}
              >
                Seguir explorando
              </button>
            ) : null}

            <button type="button" className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15" onClick={logout}>
              Logout
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold mb-3">Aceptación legal</div>

          <label className="flex items-start gap-2 text-sm text-white/80">
            <input type="checkbox" className="mt-1" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
            <span>Acepto los Términos (v{TERMS_VERSION}).</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-white/80 mt-2">
            <input type="checkbox" className="mt-1" checked={acceptPrivacy} onChange={(e) => setAcceptPrivacy(e.target.checked)} />
            <span>Acepto la Política de Privacidad (v{PRIVACY_VERSION}).</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-white/80 mt-2">
            <input type="checkbox" className="mt-1" checked={acceptAutopay} onChange={(e) => setAcceptAutopay(e.target.checked)} />
            <span>Acepto la auto-renovación del plan (v{AUTOPAY_VERSION}).</span>
          </label>

          {!canContinue ? <div className="text-xs text-yellow-200/80 mt-3">Debes marcar las 3 casillas para activar un plan.</div> : null}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold mb-2">Código de referido (opcional)</div>
          <input
            className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white outline-none"
            placeholder="Ej: TALES-B-XXXXXX"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
          />
          <div className="text-xs text-white/60 mt-2">
            Si alguien te dio un código, introdúcelo aquí para obtener la bonificación al activar tu plan.
          </div>
        </div>

        {error ? <div className="mt-4 text-red-400">{error}</div> : null}

        <div className="mt-6">
          <div className="text-sm font-semibold mb-3">Planes disponibles</div>

          {loading ? (
            <div className="text-white/60">Cargando...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plans.map((p) => (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-lg font-bold">{p.name}</div>
                  <div className="text-white/60 text-sm mt-1">{p.slug}</div>
                  <div className="mt-3 text-sm">
                    <div>Plan credits: <b>{p.plan_credits}</b></div>
                    <div>Bonus credits: <b>{p.bonus_credits}</b></div>
                    <div>Can sell: <b>{String(p.can_sell)}</b></div>
                  </div>

                  <button
                    type="button"
                    disabled={!canContinue || busySlug === p.slug}
                    className="mt-4 w-full px-4 py-2 rounded-lg bg-white text-black disabled:opacity-50"
                    onClick={() => handleSubscribe(p.slug)}
                  >
                    {busySlug === p.slug ? "Activando..." : "Activar plan"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-xs text-white/50 mt-6">
          Si estás en producción, aquí luego se conecta Stripe Checkout (ETAPA 9). En mock, esto usa /api/billing/mock/subscribe.
        </div>
      </div>
    </div>
  );
}