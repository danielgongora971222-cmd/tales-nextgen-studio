import React, { useEffect, useMemo, useState } from "react";
import { billingMe, billingPlans, billingTopups, mockSubscribe, mockTopup } from "../services/billingApi";
import { acceptLegal } from "../services/legalApi";
import { useWallet } from "../contexts/WalletContext";
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
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <div className="text-lg font-extrabold">Choose your plan</div>
              <div className="text-sm text-white/60 mt-1">Credits reset each billing period.</div>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                className={`px-4 py-2 rounded-full text-sm ${period === "month" ? "bg-white/15" : "bg-transparent hover:bg-white/10"}`}
                onClick={() => setPeriod("month")}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-full text-sm ${period === "year" ? "bg-white/15" : "bg-transparent hover:bg-white/10"}`}
                onClick={() => setPeriod("year")}
              >
                Yearly
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredPlans.map((p) => {
              const isCurrent = currentPlanSlug && p.slug === currentPlanSlug;

              const power = planPowerScore(p);
              const isLower = currentPlanPower !== null && power < currentPlanPower;
              const isHigher = currentPlanPower !== null && power > currentPlanPower;

              const price = moneyUSD(p.price_cents || 0);
              const per =
                p.billing_period === "week" ? "/week" : p.billing_period === "year" ? "/year" : "/month";

              const ctaLabel = isCurrent
                ? "Current plan"
                : currentPlanPower !== null
                  ? isHigher
                    ? "Upgrade"
                    : "Not available"
                  : "Subscribe";

              const ctaDisabled = isCurrent || isLower;

              return (
                <div
                  key={p.id}
                  className={`rounded-3xl border p-5 bg-white/5 ${
                    isCurrent
                      ? "border-emerald-400/40 shadow-[0_0_24px_rgba(52,211,153,0.12)]"
                      : isLower
                        ? "border-white/10 opacity-60"
                        : "border-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-extrabold">{p.name}</div>
                      <div className="text-sm text-white/60 mt-1">{p.slug}</div>
                    </div>

                    {isCurrent ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200">Current</span>
                    ) : isLower ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-white/10 border border-white/10 text-white/70">Locked</span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex items-end gap-2">
                    <div className="text-3xl font-extrabold">{price}</div>
                    <div className="text-sm text-white/60 pb-1">{per}</div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-sm font-semibold">{formatK(p.plan_credits)} credits per period</div>
                    {Number(p.bonus_credits || 0) > 0 ? (
                      <div className="text-xs text-white/60 mt-1">+ {formatK(p.bonus_credits)} bonus credits</div>
                    ) : (
                      <div className="text-xs text-white/60 mt-1">No bonus credits</div>
                    )}
                    <div className="text-xs text-white/60 mt-2">Max concurrency: {Number(p.max_concurrency || 2)}</div>
                    <div className="text-xs text-white/60 mt-2">{p.can_sell ? "✓ Can sell creations" : "• Selling disabled"}</div>
                    <div className="text-xs text-white/60 mt-1">{p.can_referrals ? "✓ Referral rewards enabled" : "• Referrals disabled"}</div>
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      className={`w-full px-4 py-3 rounded-2xl font-bold ${
                        ctaDisabled
                          ? "bg-white/10 border border-white/10 text-white/60 cursor-not-allowed"
                          : "bg-white text-black hover:opacity-95"
                      }`}
                      disabled={ctaDisabled}
                      onClick={() => {
                        setConfirm({
                          itemLabel: `Plan ${p.name}`,
                          amountLabel: `${price} ${per}`,
                          note: "Suscripción recurrente hasta cancelación.",
                          action: async () => {
                            await acceptLegal({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, autopayVersion: AUTOPAY_VERSION });
                            await mockSubscribe(p.slug);
                            await refreshWallet();
                            await loadAll();
                            await onSubscribed();
                          },
                        });
                      }}
                    >
                      {ctaLabel}
                    </button>
                  </div>
                </div>
              );
            })}
            {!filteredPlans.length ? (
              <div className="text-white/60">{period === "year" ? "Yearly plans coming soon." : "No plans available."}</div>
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