import React, { useEffect, useMemo, useState } from "react";
import { billingMe, billingPlans, billingTopups, mockSubscribe, mockTopup } from "../services/billingApi";
import { acceptLegal } from "../services/legalApi";
import { useWallet } from "../contexts/WalletContext";
import { validateReferralCode } from "../services/referralsApi";
import ConfirmDollarPurchaseModal from "@/components/ConfirmDollarPurchaseModal";

const TERMS_VERSION = "2026-03-03";
const PRIVACY_VERSION = "2026-03-03";
const AUTOPAY_VERSION = "2026-03-03";

type TabKey = "plans" | "credits";

type ConfirmState =
  | null
  | { itemLabel: string; amountLabel: string; note?: string | null; action: () => Promise<void> };

function moneyUSD(cents: number) {
  const v = Number(cents || 0) / 100;
  return `$${v.toFixed(2)}`;
}

function formatK(n: number) {
  const v = Number(n) || 0;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

function premiumVars(accent: string, accent2: string): React.CSSProperties {
  return { ["--ph-accent" as any]: accent, ["--ph-accent2" as any]: accent2 } as React.CSSProperties;
}

function planPeriodFactor(bp: any) {
  const v = String(bp || "month").toLowerCase();
  if (v === "week") return 4;
  if (v === "year") return 12;
  return 1;
}

function planPowerScore(p: any) {
  const factor = planPeriodFactor(p?.billing_period);
  const creditsEqMonth = Number(p?.plan_credits || 0) * factor;
  const concurrency = Number(p?.max_concurrency || 2);
  const features = (p?.can_sell ? 1 : 0) + (p?.can_referrals ? 1 : 0);
  return creditsEqMonth * 1_000_000 + concurrency * 10_000 + features * 100 + Number(p?.price_cents || 0);
}

function topupPalette(credits: number): [string, string] {
  // Psicología del color:
  // - Azul: confianza/seguridad (packs pequeños)
  // - Verde: valor/éxito (packs medios)
  // - Morado: premium/creatividad (packs grandes)
  // - Ámbar: urgencia/poder (packs mega)
  if (credits <= 1500) return ["rgba(59,130,246,0.78)", "rgba(14,165,233,0.34)"];
  if (credits <= 5000) return ["rgba(34,197,94,0.78)", "rgba(16,185,129,0.34)"];
  if (credits <= 12000) return ["rgba(168,85,247,0.78)", "rgba(217,70,239,0.30)"];
  return ["rgba(245,158,11,0.82)", "rgba(239,68,68,0.26)"];
}

function topupBadge(credits: number) {
  if (credits <= 1500) return "Starter";
  if (credits <= 5000) return "Popular";
  if (credits <= 12000) return "Pro";
  return "Mega";
}

function clampPct(n: any, min = 0, max = 100) {
  const x = Math.trunc(Number(n));
  if (!Number.isFinite(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function applyPercentDiscount(priceCents: number, pct: number) {
  const p = clampPct(pct, 0, 100);
  const base = Math.max(0, Math.trunc(Number(priceCents || 0)));
  const discount = Math.round((base * p) / 100);
  const discounted = Math.max(0, base - discount);
  return { base, pct: p, discountCents: discount, discountedCents: discounted };
}

function planPalette(slug: string): [string, string] {
  // Psicología del color:
  // - Azul/Teal: confianza + fluidez (entrada)
  // - Verde: valor + progreso (popular)
  // - Morado: creatividad + poder (pro)
  // - Ámbar/Naranja: autoridad + afiliados (partner)
  // - Rojo/Ámbar: escala + decisión (business)
  const s = String(slug || "").toLowerCase();
  if (s.includes("basic")) return ["rgba(59,130,246,0.80)", "rgba(20,184,166,0.32)"];
  if (s.includes("standard")) return ["rgba(34,197,94,0.78)", "rgba(16,185,129,0.34)"];
  if (s.includes("pro")) return ["rgba(168,85,247,0.80)", "rgba(217,70,239,0.30)"];
  if (s.includes("partner")) return ["rgba(245,158,11,0.82)", "rgba(249,115,22,0.30)"];
  if (s.includes("business")) return ["rgba(239,68,68,0.80)", "rgba(245,158,11,0.26)"];
  return ["rgba(241, 225, 148, 0.55)", "rgba(111, 168, 255, 0.35)"];
}

function planMarketing(slug: string) {
  const s = String(slug || "").toLowerCase();

  if (s.includes("basic")) {
    return {
      badge: "Flexible",
      tagline: "Entra rápido, paga por semana.",
      bullets: ["Ideal para probar el estudio", "Genera sin compromisos largos", "Activa y cancela cuando quieras"],
    };
  }

  if (s.includes("standard")) {
    return {
      badge: "Más popular",
      tagline: "El equilibrio perfecto para creadores diarios.",
      bullets: ["Gran valor por crédito", "Flujo estable de generación", "Perfecto para contenido constante"],
    };
  }

  if (s.includes("pro")) {
    return {
      badge: "Creator Pro",
      tagline: "Más potencia, más velocidad, más resultados.",
      bullets: ["Desbloquea funciones premium", "Mejor para volúmenes altos", "Listo para escalar tu pipeline"],
    };
  }

  if (s.includes("partner")) {
    return {
      badge: "Afiliados",
      tagline: "Gana por referidos y vende tus creaciones.",
      bullets: ["Códigos de referidos activos", "Comisiones y crecimiento orgánico", "Construye tu audiencia"],
    };
  }

  if (s.includes("business")) {
    return {
      badge: "Escala",
      tagline: "El plan para equipos, agencias y producción seria.",
      bullets: ["Máxima capacidad", "Bonus extra incluido", "Preparado para operación continua"],
    };
  }

  return { badge: "Plan", tagline: "Elige el plan que mejor se ajuste a tu ritmo.", bullets: [] };
}

export default function Paywall({
  onSubscribed,
  onContinueExploring,
}: {
  onSubscribed: () => Promise<void> | void;
  onContinueExploring?: () => void;
}) {
  const { wallet, refresh: refreshWallet } = useWallet();

  const [tab, setTab] = useState<TabKey>("plans");
  const [period, setPeriod] = useState<"month" | "year">("month");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sub, setSub] = useState<any | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [topups, setTopups] = useState<any[]>([]);

  const [confirm, setConfirm] = useState<ConfirmState>(null);

  // Referral code (planes)
  const [referralInput, setReferralInput] = useState("");
  const [referralCheck, setReferralCheck] = useState<any>({ state: "idle" });
  const [appliedReferral, setAppliedReferral] = useState<any | null>(null);

  const availableCredits = Number(wallet?.generationCredits ?? 0);
  const planCredits = Number(wallet?.gen_plan_credits ?? 0);
  const topupCredits = Number(wallet?.gen_topup_credits ?? 0);
  const bonusCredits = Number(wallet?.gen_bonus_credits ?? 0);

  useEffect(() => {
    const t = window.localStorage.getItem("tales_account_tab");
    if (t === "plans" || t === "credits") setTab(t as TabKey);
    window.localStorage.removeItem("tales_account_tab");
  }, []);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);

    const [sR, pR, tR] = await Promise.allSettled([billingMe(), billingPlans(), billingTopups()]);

    if (sR.status === "fulfilled") setSub(sR.value || null);
    if (pR.status === "fulfilled") setPlans(pR.value || []);
    if (tR.status === "fulfilled") setTopups(tR.value || []);

    const err =
      (sR.status === "rejected" ? sR.reason?.message : null) ||
      (pR.status === "rejected" ? pR.reason?.message : null) ||
      (tR.status === "rejected" ? tR.reason?.message : null);

    if (err) setError(err);
    setLoading(false);
  }

  // Auto-validación (debounced) del código de referido (Planes)
  useEffect(() => {
    const raw = referralInput ? String(referralInput) : "";
    const code = raw.trim().toUpperCase();

    if (!code) {
      setReferralCheck({ state: "idle" });
      return;
    }

    if (code.length < 6) {
      setReferralCheck({ state: "typing" });
      return;
    }

    let cancelled = false;
    setReferralCheck({ state: "checking" });

    const t = window.setTimeout(async () => {
      try {
        const r = await validateReferralCode(code);
        if (cancelled) return;

        if (!r.valid) {
          const msg =
            r.reason === "SELF"
              ? "No puedes usar tu propio código."
              : r.reason === "NOT_FOUND"
                ? "Código no encontrado o inactivo."
                : "Código inválido.";
          setReferralCheck({ state: "invalid", message: msg });
          return;
        }

        if (!r.eligible) {
          setReferralCheck({
            state: "ineligible",
            message: "El dueño del código no tiene un plan Partner/Business activo.",
            data: r,
          });
          return;
        }

        setReferralCheck({ state: "valid", data: r });
      } catch (e: any) {
        if (cancelled) return;
        setReferralCheck({ state: "error", message: e?.message || "No se pudo validar el código." });
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [referralInput]);


  const currentPlanSlug = sub?.planSlug || null;
  const heroPlanName = sub?.planName || "Ninguno";
  const heroNext = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleString() : "—";

  const currentPlan = useMemo(() => {
    if (!currentPlanSlug) return null;
    return (plans || []).find((p) => p?.slug === currentPlanSlug) || null;
  }, [plans, currentPlanSlug]);

  const currentPlanPower = currentPlan ? planPowerScore(currentPlan) : null;

  const filteredPlans = useMemo(() => {
    const list = plans || [];

    const filtered =
      period === "month"
        ? list.filter((p) => {
            const bp = String(p?.billing_period || "month").toLowerCase();
            // ✅ El plan semanal (ej: basic_week) se muestra dentro de Monthly como opción de pago flexible.
            return bp === "month" || bp === "week";
          })
        : list.filter((p) => String(p?.billing_period || "").toLowerCase() === "year");

    return filtered.sort((a, b) => planPowerScore(a) - planPowerScore(b));
  }, [plans, period]);

  const bestValuePlanId = useMemo(() => {
    let bestId: string | null = null;
    let bestRatio = -1;

    for (const p of filteredPlans) {
      const priceCents = Number(p?.price_cents || 0);
      const dollars = priceCents / 100;
      if (!dollars) continue;

      const factor = planPeriodFactor(p?.billing_period);
      const creditsEqMonth = Number(p?.plan_credits || 0) * factor;
      const ratio = creditsEqMonth / dollars;

      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = String(p?.id || "");
      }
    }

    return bestId;
  }, [filteredPlans]);


  const uniqueTopups = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];

    for (const t of topups || []) {
      const credits = Number(t?.credits_amount ?? t?.credits ?? 0);
      const price = Number(t?.price_cents ?? 0);
      const name = String(t?.name || "").trim().toLowerCase();
      const key = `${credits}|${price}|${name}`;

      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ ...t, _credits: credits, _price_cents: price, _key: key });
    }

    out.sort(
      (a, b) =>
        Number(a._credits) - Number(b._credits) || Number(a._price_cents) - Number(b._price_cents)
    );
    return out;
  }, [topups]);

  const bestValueTopupKey = useMemo(() => {
    let bestKey: string | null = null;
    let bestRatio = -1;

    for (const t of uniqueTopups) {
      const credits = Number(t?._credits ?? 0);
      const dollars = Number(t?._price_cents ?? 0) / 100;
      if (!dollars) continue;

      const ratio = credits / dollars;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestKey = String(t?._key || "");
      }
    }

    return bestKey;
  }, [uniqueTopups]);

  return (
    <div className="text-white">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Account</h1>
          <div className="text-sm text-white/60 mt-1">Plans and extra credits</div>
        </div>

        <div className="flex gap-2">
          {onContinueExploring ? (
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10"
              onClick={onContinueExploring}
            >
              Back
            </button>
          ) : null}

        </div>
      </div>

      {error ? <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/40">{error}</div> : null}

      {/* Hero cards */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div
          className="premium-hero-card p-5"
          style={premiumVars("rgba(244, 197, 66, 0.55)", "rgba(240, 107, 87, 0.28)")}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="premium-hero-badge">
                <span className="premium-hero-dot" aria-hidden="true" />
                <span>Plan</span>
              </div>

              <div className="text-2xl font-extrabold mt-3 truncate">{heroPlanName}</div>
              <div className="text-sm text-white/60 mt-2">Next renewal: {heroNext}</div>
            </div>

            <div className="premium-hero-icon" aria-hidden="true" title="Plan">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 2h12l4 8-10 12L2 10l4-8Z" />
                <path d="M10 10 8 2" />
                <path d="m14 10 2-8" />
                <path d="M2 10h20" />
              </svg>
            </div>
          </div>

          <div className="mt-5">
            <button
              type="button"
              className="premium-hero-btn px-4 py-2 text-sm"
              onClick={() => setTab("plans")}
            >
              View plans
            </button>
          </div>
        </div>

        <div
          className="premium-hero-card p-5"
          style={premiumVars("rgba(111, 168, 255, 0.55)", "rgba(46, 229, 157, 0.32)")}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="premium-hero-badge">
                <span className="premium-hero-dot" aria-hidden="true" />
                <span>Credits</span>
              </div>

              <div className="text-2xl font-extrabold mt-3">{formatK(availableCredits)}</div>
              <div className="text-[12px] text-white/60 mt-2">
                Plan {formatK(planCredits)} · Extra {formatK(topupCredits)} · Bonus {formatK(bonusCredits)}
              </div>
            </div>

            <button
              type="button"
              className="premium-hero-btn px-3 py-1.5 text-xs"
              onClick={() => setTab("credits")}
              title="Credit details"
            >
              Details
            </button>
          </div>

          <div className="mt-5">
            <button
              type="button"
              className="premium-hero-btn premium-hero-btn--primary px-4 py-2 text-sm"
              onClick={() => setTab("credits")}
            >
              Buy credits
            </button>
          </div>
        </div>

        <div
          className="premium-hero-card p-5"
          style={premiumVars("rgba(123, 77, 255, 0.55)", "rgba(240, 107, 87, 0.30)")}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="premium-hero-badge">
                <span className="premium-hero-dot" aria-hidden="true" />
                <span>Quick actions</span>
              </div>

              <div className="text-sm text-white/65 mt-3">
                Upgrade your plan or top up extra credits anytime.
              </div>
            </div>

            <div className="premium-hero-icon" aria-hidden="true" title="Actions">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 6v6l4 2" />
                <path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z" />
              </svg>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="premium-hero-btn premium-hero-btn--primary px-4 py-2 text-sm"
              onClick={() => setTab("plans")}
            >
              Upgrade
            </button>

            <button
              type="button"
              className="premium-hero-btn px-4 py-2 text-sm"
              onClick={() => setTab("credits")}
            >
              Extra credits
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-white/10 mb-6">
        <button
          type="button"
          onClick={() => setTab("plans")}
          className={`pb-3 text-sm font-semibold ${tab === "plans" ? "text-white border-b-2 border-emerald-400" : "text-white/55 hover:text-white"}`}
        >
          Plans
        </button>

        <button
          type="button"
          onClick={() => setTab("credits")}
          className={`pb-3 text-sm font-semibold ${tab === "credits" ? "text-white border-b-2 border-emerald-400" : "text-white/55 hover:text-white"}`}
        >
          Credits
        </button>
      </div>

      {loading ? <div className="text-white/70">Loading...</div> : null}

      {/* PLANS */}
      {!loading && tab === "plans" ? (
        <div>
          {/* Referral */}
          <div className="referral-panel mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="referral-panel__badge">
                  <span className="referral-panel__dot" aria-hidden="true" />
                  <span>Código de referido</span>
                </div>

                <div className="text-lg font-extrabold mt-3">Desbloquea tu descuento (si aplica)</div>
                <div className="text-sm text-white/60 mt-1">
                  El botón <span className="font-semibold text-white/80">Aplicar</span> se habilita solo si el código existe y el dueño tiene un plan Partner/Business activo.
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {appliedReferral?.code ? (
                  <div className="referral-applied-pill">
                    <div className="text-[11px] text-white/60">Código activo</div>
                    <div className="text-sm font-extrabold tracking-wide">{String(appliedReferral.code)}</div>
                    <div className="text-[11px] text-white/70 mt-1">
                      Descuento: <span className="text-white/90 font-semibold">{clampPct(appliedReferral.buyerDiscountPct)}%</span> · Reward partner:{" "}
                      <span className="text-white/90 font-semibold">{clampPct(appliedReferral.refRewardPct)}%</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[12px] text-white/55 text-right">
                    Tip: si tu código es válido verás “Listo para aplicar”.
                  </div>
                )}

                {appliedReferral?.code ? (
                  <button
                    type="button"
                    className="referral-btn"
                    onClick={() => {
                      setAppliedReferral(null);
                      setReferralCheck({ state: "idle" });
                      setReferralInput("");
                    }}
                  >
                    Quitar código
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-col lg:flex-row gap-3">
              <div className="flex-1 referral-input">
                <div className="referral-input__shine" aria-hidden="true" />
                <input
                  className="referral-input__field"
                  value={referralInput}
                  onChange={(e) => setReferralInput(e.target.value)}
                  placeholder="Ej: TNG15-AB12CD34EF"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={!!appliedReferral?.code}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className={`referral-btn referral-btn--primary ${
                    referralCheck?.state === "valid" && !appliedReferral?.code ? "" : "opacity-70"
                  }`}
                  disabled={!(referralCheck?.state === "valid" && !appliedReferral?.code)}
                  onClick={() => {
                    const r = referralCheck?.data;
                    if (!r?.code) return;
                    setAppliedReferral(r);
                    setReferralInput(String(r.code));
                  }}
                  title={
                    referralCheck?.state === "valid"
                      ? "Aplicar código"
                      : referralCheck?.state === "checking"
                        ? "Validando..."
                        : "Introduce un código válido y elegible"
                  }
                >
                  Aplicar
                </button>

                <button
                  type="button"
                  className="referral-btn"
                  onClick={() => {
                    setReferralInput("");
                    setReferralCheck({ state: "idle" });
                  }}
                  disabled={!!appliedReferral?.code}
                >
                  Limpiar
                </button>
              </div>
            </div>

            {/* Status */}
            <div className="mt-3">
              {referralCheck?.state === "idle" ? (
                <div className="text-[12px] text-white/55">Ingresa un código para verificar si tiene descuento y está habilitado.</div>
              ) : referralCheck?.state === "typing" ? (
                <div className="text-[12px] text-white/55">Sigue escribiendo…</div>
              ) : referralCheck?.state === "checking" ? (
                <div className="text-[12px] text-white/70">Validando código…</div>
              ) : referralCheck?.state === "invalid" ? (
                <div className="text-[12px] text-red-200/90">{String(referralCheck?.message || "Código inválido.")}</div>
              ) : referralCheck?.state === "ineligible" ? (
                <div className="text-[12px] text-amber-200/90">
                  {String(referralCheck?.message || "Código no elegible.")}{" "}
                  <span className="text-white/55">
                    {referralCheck?.data?.ownerPlanName ? `Plan actual del dueño: ${referralCheck.data.ownerPlanName}.` : ""}
                  </span>
                </div>
              ) : referralCheck?.state === "error" ? (
                <div className="text-[12px] text-red-200/90">{String(referralCheck?.message || "No se pudo validar.")}</div>
              ) : referralCheck?.state === "valid" ? (
                <div className="text-[12px] text-emerald-200/90">
                  Listo para aplicar:{" "}
                  <span className="font-semibold text-white/90">{String(referralCheck?.data?.code || "")}</span> · Descuento{" "}
                  <span className="font-semibold text-white/90">{clampPct(referralCheck?.data?.buyerDiscountPct)}%</span> · Reward partner{" "}
                  <span className="font-semibold text-white/90">{clampPct(referralCheck?.data?.refRewardPct)}%</span>
                </div>
              ) : null}
            </div>

            {/* Savings preview */}
            {appliedReferral?.code && clampPct(appliedReferral?.buyerDiscountPct) > 0 ? (
              <div className="referral-savings mt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold">Descuento activo</div>
                    <div className="text-[12px] text-white/65 mt-1">
                      Tus planes se muestran con el <span className="font-semibold text-white/90">{clampPct(appliedReferral.buyerDiscountPct)}%</span> aplicado.
                    </div>
                  </div>

                  <div className="text-[12px] text-white/70">
                    Código: <span className="font-semibold text-white/90">{String(appliedReferral.code)}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
            <div>
              <div className="text-lg font-extrabold">Planes</div>
              <div className="text-sm text-white/60 mt-1">Créditos se reinician cada periodo de facturación.</div>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                className={`px-4 py-2 rounded-full text-sm ${period === "month" ? "bg-white/15" : "bg-transparent hover:bg-white/10"}`}
                onClick={() => setPeriod("month")}
              >
                Mensual
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-full text-sm ${period === "year" ? "bg-white/15" : "bg-transparent hover:bg-white/10"}`}
                onClick={() => setPeriod("year")}
              >
                Anual
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredPlans.map((p) => {
              const isCurrent = currentPlanSlug && p.slug === currentPlanSlug;

              const power = planPowerScore(p);
              const isLower = currentPlanPower !== null && power < currentPlanPower;
              const isHigher = currentPlanPower !== null && power > currentPlanPower;

              const mk = planMarketing(p.slug);
              const [accent, accent2] = planPalette(p.slug);

              const perLabel =
                p.billing_period === "week" ? "/semana" : p.billing_period === "year" ? "/año" : "/mes";

              const discountPct = appliedReferral?.code ? clampPct(appliedReferral?.buyerDiscountPct) : 0;
              const pricing = applyPercentDiscount(Number(p.price_cents || 0), discountPct);
              const priceNow = moneyUSD(pricing.discountedCents);
              const priceWas = moneyUSD(pricing.base);
              const savings = pricing.discountCents;

              const ctaLabel = isCurrent
                ? "Plan actual"
                : currentPlanPower !== null
                  ? isHigher
                    ? "Mejorar plan"
                    : "No disponible"
                  : "Suscribirme";

              const ctaDisabled = isCurrent || isLower;

              const factor = planPeriodFactor(p.billing_period);
              const creditsEqMonth = Number(p.plan_credits || 0) * factor;

              const showBest = bestValuePlanId && String(p.id) === String(bestValuePlanId);

              const showDiscount = !!appliedReferral?.code && discountPct > 0 && pricing.discountedCents < pricing.base;

              return (
                <div
                  key={p.id}
                  className={[
                    "premium-hero-card plan-tier-card p-5 transition-transform duration-200 group",
                    isLower ? "plan-tier-card--locked" : "",
                    isCurrent ? "plan-tier-card--current" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={premiumVars(accent, accent2)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="plan-tier-pill">{mk.badge}</span>
                        {showBest ? <span className="plan-tier-pill plan-tier-pill--best">Mejor valor</span> : null}
                        {isCurrent ? <span className="plan-tier-pill plan-tier-pill--current">Actual</span> : null}
                        {isLower ? <span className="plan-tier-pill">Bloqueado</span> : null}
                      </div>

                      <div className="text-2xl font-extrabold mt-3">{p.name}</div>
                      <div className="text-sm text-white/70 mt-1">{mk.tagline}</div>
                    </div>

                    <div className="premium-hero-icon" aria-hidden="true" title="Plan tier">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 2h12l4 8-10 12L2 10l4-8Z" />
                        <path d="M2 10h20" />
                      </svg>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="mt-5 flex items-end justify-between gap-3">
                    <div>
                      <div className="flex items-end gap-2">
                        <div className="text-3xl font-extrabold">{priceNow}</div>
                        <div className="text-sm text-white/60 pb-1">{perLabel}</div>
                      </div>

                      {showDiscount ? (
                        <div className="text-[12px] text-white/65 mt-1">
                          <span className="line-through text-white/40 mr-2">{priceWas}</span>
                          <span className="text-emerald-200/90 font-semibold">Ahorras {moneyUSD(savings)}</span>
                        </div>
                      ) : (
                        <div className="text-[12px] text-white/55 mt-1">
                          {p.billing_period === "week" ? "Pago semanal" : p.billing_period === "year" ? "Pago anual" : "Pago mensual"}
                        </div>
                      )}
                    </div>

                    {appliedReferral?.code ? (
                      <div className="text-[11px] text-white/55 text-right">
                        <div className="font-semibold text-white/80">Código</div>
                        <div className="tracking-wide">{String(appliedReferral.code)}</div>
                      </div>
                    ) : null}
                  </div>

                  {/* Metrics */}
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="plan-tier-metric">
                      <div className="text-[11px] text-white/55">Créditos / periodo</div>
                      <div className="text-sm font-extrabold mt-1">{formatK(p.plan_credits || 0)}</div>
                      <div className="text-[11px] text-white/55 mt-1">≈ {formatK(creditsEqMonth)} / mes</div>
                    </div>

                    <div className="plan-tier-metric">
                      <div className="text-[11px] text-white/55">Bonus</div>
                      <div className="text-sm font-extrabold mt-1">{Number(p.bonus_credits || 0) > 0 ? `+${formatK(p.bonus_credits)}` : "—"}</div>
                      <div className="text-[11px] text-white/55 mt-1">Concurrencia: {Number(p.max_concurrency || 2)}</div>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="plan-tier-features mt-4">
                    <div className="text-sm font-extrabold">Lo que desbloqueas</div>
                    <div className="text-[12px] text-white/60 mt-1">Decisiones visuales pensadas para que compres con confianza.</div>

                    <div className="mt-3 space-y-2">
                      {(mk.bullets || []).slice(0, 3).map((b: string) => (
                        <div key={b} className="plan-tier-li">
                          <span className="plan-tier-check" aria-hidden="true" />
                          <div className="text-[12px] text-white/80 leading-snug">{b}</div>
                        </div>
                      ))}

                      <div className="plan-tier-li plan-tier-li--soft">
                        <span className="plan-tier-note" aria-hidden="true" />
                        <div className="text-[12px] text-white/70 leading-snug">
                          {p.can_sell ? "Vender creaciones habilitado" : "Venta de creaciones deshabilitada"} ·{" "}
                          {p.can_referrals ? "Recompensas por referidos activas" : "Referidos deshabilitados"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      className={[
                        "premium-hero-btn premium-hero-btn--primary w-full px-4 py-3 text-sm font-extrabold",
                        ctaDisabled ? "opacity-60 cursor-not-allowed" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={ctaDisabled}
                      onClick={() => {
                        const noteParts: string[] = ["Suscripción recurrente hasta cancelación."];
                        if (appliedReferral?.code) {
                          const pct = clampPct(appliedReferral?.buyerDiscountPct);
                          noteParts.push(`Código: ${String(appliedReferral.code)} · Descuento: ${pct}% · Reward partner: ${clampPct(appliedReferral?.refRewardPct)}%`);
                        }

                        setConfirm({
                          itemLabel: `Plan ${p.name}`,
                          amountLabel: `${priceNow} ${perLabel}`,
                          note: noteParts.join(" "),
                          action: async () => {
                            await acceptLegal({
                              termsVersion: TERMS_VERSION,
                              privacyVersion: PRIVACY_VERSION,
                              autopayVersion: AUTOPAY_VERSION,
                            });

                            await mockSubscribe(p.slug, appliedReferral?.code || null);
                            await refreshWallet();
                            await loadAll();
                            await onSubscribed();
                          },
                        });
                      }}
                    >
                      {ctaLabel}
                    </button>

                    {!ctaDisabled && showDiscount ? (
                      <div className="text-[11px] text-white/55 mt-2 text-center">
                        Descuento aplicado automáticamente por el código activo.
                      </div>
                    ) : null}

                    {ctaDisabled && isLower ? (
                      <div className="text-[11px] text-white/55 mt-2 text-center">
                        Para bajar de plan, contáctanos (protección contra downgrades accidentales).
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {!filteredPlans.length ? (
              <div className="text-white/60">
                {period === "year" ? "Planes anuales próximamente." : "No hay planes disponibles en este momento."}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* CREDITS */}
      {!loading && tab === "credits" ? (
        <div>
          <div className="mb-5">
            <div className="text-lg font-extrabold">Extra credits</div>
            <div className="text-sm text-white/60 mt-1">One-time purchases. Requires a plan.</div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            {uniqueTopups.map((t) => {
              const credits = Number(t._credits ?? t.credits_amount ?? t.credits ?? 0);
              const priceCents = Number(t._price_cents ?? t.price_cents ?? 0);
              const price = moneyUSD(priceCents);

              const key = String(
                t._key ||
                  t.id ||
                  `${credits}|${priceCents}|${String(t.name || "").trim().toLowerCase()}`
              );

              const isBestValue = !!bestValueTopupKey && key === bestValueTopupKey;

              const dollars = priceCents / 100;
              const perDollar = dollars ? Math.round(credits / dollars) : 0;

              const [accent, accent2] = topupPalette(credits);

              return (
                <div key={key} className="premium-hero-card p-5" style={premiumVars(accent, accent2)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="premium-hero-badge">
                        <span className="premium-hero-dot" aria-hidden="true" />
                        <span>{topupBadge(credits)}</span>
                      </div>

                      <div className="text-3xl font-extrabold mt-3">{formatK(credits)}</div>
                      <div className="text-sm text-white/65 mt-1">credits</div>
                      <div className="text-xs text-white/55 mt-2">{t.name}</div>
                    </div>

                    {isBestValue ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200">
                        Best value
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xl font-extrabold">{price}</div>
                      <div className="text-xs text-white/60 mt-1">{perDollar} credits / $</div>
                    </div>

                    <button
                      type="button"
                      className="premium-hero-btn premium-hero-btn--primary px-4 py-2 text-sm"
                      onClick={() => {
                        setConfirm({
                          itemLabel: `Extra credits (${credits} credits)`,
                          amountLabel: price,
                          note: "Compra puntual. Requiere plan activo.",
                          action: async () => {
                            await acceptLegal({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, autopayVersion: AUTOPAY_VERSION });
                            await mockTopup(t.id);
                            await refreshWallet();
                            await loadAll();
                            await onSubscribed();
                          },
                        });
                      }}
                    >
                      Purchase
                    </button>
                  </div>
                </div>
              );
            })}
            {!uniqueTopups.length ? <div className="text-white/60">No credit packs available.</div> : null}
          </div>
        </div>
      ) : null}

      <ConfirmDollarPurchaseModal
        open={!!confirm}
        itemLabel={confirm?.itemLabel || ""}
        amountLabel={confirm?.amountLabel || ""}
        note={confirm?.note || null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await confirm.action();
          setConfirm(null);
        }}
      />
    </div>
  );
}