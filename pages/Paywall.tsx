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

  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptAutopay, setAcceptAutopay] = useState(false);

  const canPurchase = acceptTerms && acceptPrivacy && acceptAutopay;

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

  async function ensureLegal() {
    if (!canPurchase) throw new Error("Debes aceptar términos, privacidad y auto-renovación para continuar.");
    await acceptLegal({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, autopayVersion: AUTOPAY_VERSION });
  }

  const currentPlanSlug = sub?.planSlug || null;
  const heroPlanName = sub?.planName || "Ninguno";
  const heroNext = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleString() : "—";

  const filteredPlans = useMemo(() => {
    const want = period === "year" ? "year" : "month";
    return (plans || []).filter((p) => (p.billing_period || "month") === want);
  }, [plans, period]);

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

          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10"
            onClick={loadAll}
          >
            Refresh
          </button>
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

      {/* Legal acceptance */}
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mb-6">
        <div className="text-sm font-semibold mb-3">Legal & payments</div>

        <div className="grid md:grid-cols-3 gap-3 text-sm text-white/80">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
            <span>I accept the Terms (v{TERMS_VERSION}).</span>
          </label>

          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={acceptPrivacy} onChange={(e) => setAcceptPrivacy(e.target.checked)} />
            <span>I accept the Privacy Policy (v{PRIVACY_VERSION}).</span>
          </label>

          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={acceptAutopay} onChange={(e) => setAcceptAutopay(e.target.checked)} />
            <span>I accept auto-renewal for subscriptions (v{AUTOPAY_VERSION}).</span>
          </label>
        </div>

        {!canPurchase ? <div className="text-xs text-white/55 mt-3">Debes aceptar los 3 puntos para poder comprar.</div> : null}
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
                className={`px-4 py-2 rounded-full text-sm ${period === "year" ? "bg-white/15" : "bg-transparent hover:bg-white/10"}`}
                onClick={() => setPeriod("year")}
              >
                Yearly
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-full text-sm ${period === "month" ? "bg-white/15" : "bg-transparent hover:bg-white/10"}`}
                onClick={() => setPeriod("month")}
              >
                Monthly
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredPlans.map((p) => {
              const isCurrent = currentPlanSlug && p.slug === currentPlanSlug;
              const price = moneyUSD(p.price_cents || 0);
              const per = p.billing_period === "year" ? "/year" : "/month";

              return (
                <div
                  key={p.id}
                  className={`rounded-3xl border p-5 bg-white/5 ${isCurrent ? "border-emerald-400/40 shadow-[0_0_24px_rgba(52,211,153,0.12)]" : "border-white/10"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-extrabold">{p.name}</div>
                      <div className="text-sm text-white/60 mt-1">{p.slug}</div>
                    </div>
                    {isCurrent ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200">Current</span>
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
                        isCurrent ? "bg-white/10 border border-white/10 text-white/60 cursor-not-allowed" : "bg-white text-black"
                      } ${!canPurchase && !isCurrent ? "opacity-60" : ""}`}
                      disabled={isCurrent || !canPurchase}
                      onClick={() => {
                        setConfirm({
                          itemLabel: `Plan ${p.name}`,
                          amountLabel: `${price} ${per}`,
                          note: "Suscripción recurrente hasta cancelación.",
                          action: async () => {
                            await ensureLegal();
                            await mockSubscribe(p.slug);
                            await refreshWallet();
                            await loadAll();
                            await onSubscribed();
                          },
                        });
                      }}
                    >
                      {isCurrent ? "Current plan" : "Subscribe"}
                    </button>
                  </div>
                </div>
              );
            })}
            {!filteredPlans.length ? <div className="text-white/60">No plans available for this billing period.</div> : null}
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
            {topups.map((t) => {
              const price = moneyUSD(t.price_cents || 0);
              const credits = Number(t.credits_amount || 0);
              return (
                <div key={t.id} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-start justify-between">
                    <div className="text-xl font-extrabold">{formatK(credits)}</div>
                    <span className="text-xs text-white/60">credits</span>
                  </div>

                  <div className="text-sm text-white/60 mt-2">{t.name}</div>

                  <div className="mt-5 flex items-center justify-between">
                    <div className="text-lg font-bold">{price}</div>
                    <button
                      type="button"
                      className={`px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm ${!canPurchase ? "opacity-60" : ""}`}
                      disabled={!canPurchase}
                      onClick={() => {
                        setConfirm({
                          itemLabel: `Extra credits (${credits} credits)`,
                          amountLabel: price,
                          note: "Compra puntual. Requiere plan activo.",
                          action: async () => {
                            await ensureLegal();
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
            {!topups.length ? <div className="text-white/60">No credit packs available.</div> : null}
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