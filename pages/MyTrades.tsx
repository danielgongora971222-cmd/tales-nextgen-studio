import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Clock3,
  CreditCard,
  Crown,
  DollarSign,
  Lock,
  ShoppingBag,
  Sparkles,
  Star,
  Ticket,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AppRoute } from "../types";
import { getWalletMe, listMyCashouts, listEarningsHistory, requestCashout, transferEarningsToGeneration } from "../services/walletApi";
import { getMyReferralCodes, getMyReferralSummary } from "../services/referralsApi";
import { getBuyerPurchases, getTradesDashboard } from "../services/tradesApi";
import EarningsActionsModal from "@/components/EarningsActionsModal";
import EarningsHistoryModal from "@/components/EarningsHistoryModal";

type RangeKey = "7d" | "30d" | "90d" | "all";
type DisplayUnit = "credits" | "usd";
type ScreenTab = "overview" | "sales" | "referrals" | "purchases";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "all", label: "ALL" },
];

function numberCompact(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }).format(value || 0);
}

function creditsToUsd(credits: number, usdMicrosPerCredit: number) {
  return ((Number(credits) || 0) * (Number(usdMicrosPerCredit) || 0)) / 1_000_000;
}

function formatPrimaryValue(credits: number, unit: DisplayUnit, usdMicrosPerCredit: number) {
  if (unit === "usd") return `$${creditsToUsd(credits, usdMicrosPerCredit).toFixed(2)}`;
  return `${numberCompact(credits)} cr`;
}

function formatSecondaryValue(credits: number, unit: DisplayUnit, usdMicrosPerCredit: number) {
  if (unit === "usd") return `${numberCompact(credits)} credits`;
  return `$${creditsToUsd(credits, usdMicrosPerCredit).toFixed(2)} ref.`;
}

function formatDateTime(value?: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`px-4 py-2 rounded-2xl border text-sm transition-all ${
        active
          ? "border-white/25 bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.14)]"
          : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function MetricCard({
  icon,
  title,
  value,
  subtitle,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
  accent: string;
}) {
  return (
    <div
      className="premium-hero-card relative overflow-hidden p-4"
      style={{ ["--ph-accent" as any]: accent, ["--ph-accent2" as any]: "rgba(255,255,255,0.20)" }}
    >
      <div className="relative z-[1] flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">{title}</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</div>
          <div className="mt-2 text-sm text-white/62">{subtitle}</div>
        </div>
        <div className="w-11 h-11 rounded-2xl border border-white/10 bg-black/35 backdrop-blur-md flex items-center justify-center text-white/90">
          {icon}
        </div>
      </div>
    </div>
  );
}

function TimelineChart({
  points,
  usdMicrosPerCredit,
  unit,
}: {
  points: any[];
  usdMicrosPerCredit: number;
  unit: DisplayUnit;
}) {
  const maxValue = Math.max(1, ...points.map((p) => Number(p.totalCredits) || 0));

  return (
    <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Revenue timeline</div>
          <div className="mt-2 text-xl font-semibold">Sales + referrals across the selected window</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/55">
          <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-sky-300" /> Sales</span>
          <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-fuchsia-300" /> Referrals</span>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-white/55">
          Todavía no hay movimiento suficiente para construir la línea temporal.
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex items-end gap-2 h-64 min-w-max">
            {points.map((point) => {
              const sales = Number(point.salesNetCredits) || 0;
              const referrals = Number(point.referralCredits) || 0;
              const salesPct = Math.max(4, (sales / maxValue) * 100);
              const referralPct = referrals > 0 ? Math.max(4, (referrals / maxValue) * 100) : 0;
              const total = Number(point.totalCredits) || 0;
              const label = unit === "usd"
                ? `$${creditsToUsd(total, usdMicrosPerCredit).toFixed(2)}`
                : `${total} cr`;

              return (
                <div key={point.key} className="group relative h-full w-9 sm:w-10 flex flex-col justify-end">
                  <div className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl border border-white/10 bg-black/80 px-3 py-1.5 text-[11px] text-white/85 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100">
                    <div className="font-semibold">{point.label}</div>
                    <div>{label}</div>
                  </div>

                  <div className="relative h-full rounded-[20px] border border-white/8 bg-white/[0.03] overflow-hidden">
                    <div className="absolute inset-0 flex flex-col justify-end">
                      {referralPct > 0 ? (
                        <div
                          className="w-full bg-[linear-gradient(180deg,rgba(232,121,249,0.95),rgba(168,85,247,0.75))]"
                          style={{ height: `${referralPct}%` }}
                        />
                      ) : null}
                      <div
                        className="w-full bg-[linear-gradient(180deg,rgba(125,211,252,0.96),rgba(59,130,246,0.72))]"
                        style={{ height: `${salesPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-2 text-center text-[10px] uppercase tracking-[0.16em] text-white/35 truncate">{point.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SpotlightCard({ title, item, metric }: { title: string; item: any | null; metric: string }) {
  return (
    <div className="premium-hero-card p-4" style={{ ["--ph-accent" as any]: "rgba(111,168,255,0.48)", ["--ph-accent2" as any]: "rgba(240,107,87,0.26)" }}>
      <div className="relative z-[1] flex items-start gap-4">
        <div className="w-20 h-20 rounded-2xl overflow-hidden border border-white/10 bg-white/[0.04] shrink-0">
          {item?.previewUrl ? <img src={item.previewUrl} className="w-full h-full object-cover" alt={item?.name || title} /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">{title}</div>
          <div className="mt-2 text-lg font-semibold truncate">{item?.name || "Sin actividad suficiente"}</div>
          <div className="mt-1 text-sm text-white/58 line-clamp-2">{item?.description || "Cuando haya más señal comercial o social, aparecerá aquí."}</div>
          <div className="mt-3 inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/82">
            {metric}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MyTrades({ onNavigate }: Props) {
  const [tab, setTab] = useState<ScreenTab>("overview");
  const [range, setRange] = useState<RangeKey>("30d");
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>("credits");

  const [wallet, setWallet] = useState<any | null>(null);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [cashoutConfig, setCashoutConfig] = useState<any | null>(null);

  const [dashboard, setDashboard] = useState<any | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const [cashouts, setCashouts] = useState<any[]>([]);
  const [cashoutsLoading, setCashoutsLoading] = useState(false);
  const [cashoutsError, setCashoutsError] = useState<string | null>(null);

  const [earningsModalOpen, setEarningsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyBucket, setHistoryBucket] = useState<"pending" | "available">("pending");
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [codes, setCodes] = useState<any[]>([]);
  const [refSummary, setRefSummary] = useState<any | null>(null);
  const [refLoading, setRefLoading] = useState(false);

  const [buyerItems, setBuyerItems] = useState<any[]>([]);
  const [buyerOffset, setBuyerOffset] = useState(0);
  const [buyerHasMore, setBuyerHasMore] = useState(true);
  const [buyerLoading, setBuyerLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const canSell = !!subscription?.can_sell;
  const canReferrals = !!subscription?.can_referrals;
  const canManageEarnings = !!subscription?.can_sell;

  const usdMicrosPerCredit = Number(cashoutConfig?.usdMicrosPerCredit) || 4990;
  const feeBps = Number(cashoutConfig?.feeBps) || 3700;
  const grossUsdPerCredit = usdMicrosPerCredit / 1_000_000;
  const netUsdPerCredit = grossUsdPerCredit * (1 - feeBps / 10000);

  const referralGateText = useMemo(() => {
    if (!subscription) {
      return "Referral Engine requiere un plan Partner o superior activo. Si cancelas o bajas de nivel, tus códigos se pausan automáticamente hasta reactivar un plan compatible.";
    }
    return "Tu plan actual no incluye Referral Engine. Tus códigos quedan pausados y dejan de funcionar hasta volver a Partner o superior.";
  }, [subscription]);

  const sellerGateText = useMemo(() => {
    if (!subscription) {
      return "Sales Studio requiere un plan Pro o superior activo. Tus listings públicos se ocultan automáticamente si sales del plan.";
    }
    return "Tu plan actual no incluye Sales Studio. Tus listings públicos quedan ocultos y la gestión de earnings se bloquea hasta volver a Pro o superior.";
  }, [subscription]);

  const earningsGateText = useMemo(() => {
    if (!subscription) {
      return "Tus earnings se conservan, pero no puedes moverlos ni solicitar cash-out sin un plan Pro o superior activo.";
    }
    return "Tus earnings están retenidos. Vuelve a Pro o superior para transferirlos a créditos o solicitar cash-out.";
  }, [subscription]);

  useEffect(() => {
    loadWalletAndCashouts();
  }, []);

  useEffect(() => {
    loadDashboard(range);
  }, [range]);

  useEffect(() => {
    if (tab !== "referrals" || !canReferrals) return;

    (async () => {
      setRefLoading(true);
      try {
        const [c, s] = await Promise.all([getMyReferralCodes(), getMyReferralSummary()]);
        setCodes(c);
        setRefSummary(s);
      } catch (e: any) {
        setCodes([]);
        setRefSummary(null);
        setError(e?.message || "No se pudo cargar Referral Engine.");
      } finally {
        setRefLoading(false);
      }
    })();
  }, [tab, canReferrals]);

  useEffect(() => {
    if (tab === "purchases" && buyerItems.length === 0) {
      loadBuyer("reset");
    }
  }, [tab]);

  async function loadWalletAndCashouts() {
    try {
      setError(null);
      const r = await getWalletMe();
      setWallet(r.wallet);
      setSubscription(r.subscription);
      setCashoutConfig((r as any).cashoutConfig || null);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar wallet.");
    }

    try {
      setCashoutsLoading(true);
      setCashoutsError(null);
      const c = await listMyCashouts({ limit: 12, offset: 0 });
      setCashouts(Array.isArray(c?.items) ? c.items : []);
    } catch (e: any) {
      setCashouts([]);
      setCashoutsError(e?.message || "No se pudieron cargar cashouts.");
    } finally {
      setCashoutsLoading(false);
    }
  }

  async function loadDashboard(nextRange: RangeKey) {
    try {
      setDashboardLoading(true);
      setDashboardError(null);
      const res = await getTradesDashboard(nextRange);
      setDashboard(res);
    } catch (e: any) {
      setDashboard(null);
      setDashboardError(e?.message || "No se pudo cargar Trade Intelligence.");
    } finally {
      setDashboardLoading(false);
    }
  }

  async function refreshFinance() {
    await Promise.all([loadWalletAndCashouts(), loadDashboard(range)]);
  }

  async function handleTransfer(amountCredits: number) {
    if (!canManageEarnings) throw new Error("Necesitas plan Pro o superior activo para gestionar earnings.");
    await transferEarningsToGeneration(amountCredits);
    await refreshFinance();
  }

  async function handleCashout(args: { amountCredits: number; payoutMethod: { kind: string; handle: string; note?: string } }) {
    if (!canManageEarnings) throw new Error("Necesitas plan Pro o superior activo para gestionar earnings.");
    await requestCashout(args.amountCredits, args.payoutMethod);
    await refreshFinance();
  }

  async function loadHistory(bucket: "pending" | "available", mode: "reset" | "more") {
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const nextOffset = mode === "reset" ? 0 : historyOffset;
      const res = await listEarningsHistory(bucket, { limit: 12, offset: nextOffset });
      setHistoryItems((prev) => (mode === "reset" ? res.items : [...prev, ...res.items]));
      setHistoryOffset(res.nextOffset);
      setHistoryHasMore(res.hasMore);
    } catch (e: any) {
      if (mode === "reset") setHistoryItems([]);
      setHistoryError(e?.message || "No se pudo cargar el historial de earnings.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openHistory(bucket: "pending" | "available") {
    setHistoryBucket(bucket);
    setHistoryModalOpen(true);
    setHistoryItems([]);
    setHistoryOffset(0);
    setHistoryHasMore(true);
    setHistoryError(null);
    await loadHistory(bucket, "reset");
  }

  async function loadBuyer(mode: "reset" | "more") {
    try {
      setBuyerLoading(true);
      setError(null);
      const nextOffset = mode === "reset" ? 0 : buyerOffset;
      const res = await getBuyerPurchases({ limit: 12, offset: nextOffset });
      setBuyerItems((prev) => (mode === "reset" ? res.items : [...prev, ...res.items]));
      setBuyerOffset(res.nextOffset);
      setBuyerHasMore(res.hasMore);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar purchases.");
    } finally {
      setBuyerLoading(false);
    }
  }

  const summary = dashboard?.summary || {};
  const listings = Array.isArray(dashboard?.listings) ? dashboard.listings : [];
  const timeline = Array.isArray(dashboard?.timeline) ? dashboard.timeline : [];
  const recentEvents = Array.isArray(dashboard?.recentEvents) ? dashboard.recentEvents : [];
  const codePerformance = Array.isArray(dashboard?.referralCodesPerformance) ? dashboard.referralCodesPerformance : [];
  const top = dashboard?.top || {};

  const walletPending = Number(wallet?.earnings_pending_credits) || 0;
  const walletAvailable = Number(wallet?.earnings_matured_credits) || 0;
  const rangeRevenue = Number(summary.totalCreditsGenerated) || 0;

  return (
    <div className="p-4 md:p-6 text-white space-y-6">
      <div
        className="premium-hero-card overflow-hidden p-5 md:p-6"
        style={{ ["--ph-accent" as any]: "rgba(111,168,255,0.42)", ["--ph-accent2" as any]: "rgba(240,107,87,0.28)" }}
      >
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="premium-hero-badge"><span className="premium-hero-dot" /> My Trades · Revenue Intelligence</div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl md:text-5xl font-semibold tracking-tight">Una cabina de control real para tus ventas, referidos y payout.</h1>
            </div>
            <p className="mt-4 max-w-3xl text-sm md:text-base text-white/68 leading-7">
              Aquí vas a detectar qué creación vende más, cuál genera más conversación, cuánto produce cada pieza por separado,
              cuánto genera tu portfolio en grupo y qué parte de tu crecimiento viene de referral engine.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs text-white/62">
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">Plan: {subscription?.plan_name || "No active plan"}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">1 credit ≈ ${grossUsdPerCredit.toFixed(4)} ref.</span>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">Net cash-out ≈ ${netUsdPerCredit.toFixed(4)} / credit</span>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">Fee: {(feeBps / 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full xl:w-auto xl:min-w-[360px]">
            <div className="flex flex-wrap gap-2 justify-start xl:justify-end">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`px-3 py-2 rounded-2xl border text-sm transition-all ${
                    range === option.key
                      ? "border-white/25 bg-white text-black"
                      : "border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08]"
                  }`}
                  onClick={() => setRange(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 justify-start xl:justify-end">
              <button
                type="button"
                className={`px-3 py-2 rounded-2xl border text-sm ${displayUnit === "credits" ? "border-white/25 bg-white text-black" : "border-white/10 bg-white/[0.04] text-white/72"}`}
                onClick={() => setDisplayUnit("credits")}
              >
                Mostrar en credits
              </button>
              <button
                type="button"
                className={`px-3 py-2 rounded-2xl border text-sm ${displayUnit === "usd" ? "border-white/25 bg-white text-black" : "border-white/10 bg-white/[0.04] text-white/72"}`}
                onClick={() => setDisplayUnit("usd")}
              >
                Mostrar en USD ref.
              </button>
            </div>

            <div className="flex flex-wrap gap-2 justify-start xl:justify-end">
              <button type="button" className="premium-hero-btn px-4 py-2.5" onClick={() => onNavigate(AppRoute.COMMUNITY_STORE)}>
                Abrir Community Store
              </button>
              <button
                type="button"
                className={`premium-hero-btn px-4 py-2.5 ${!canManageEarnings ? "opacity-60 cursor-not-allowed" : ""}`}
                onClick={() => {
                  if (!canManageEarnings) return;
                  setEarningsModalOpen(true);
                }}
              >
                Gestionar earnings
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          icon={<Wallet className="w-5 h-5" />}
          title="Available balance"
          value={formatPrimaryValue(walletAvailable, displayUnit, usdMicrosPerCredit)}
          subtitle={`${formatSecondaryValue(walletAvailable, displayUnit, usdMicrosPerCredit)} listos para transfer o cash-out`}
          accent="rgba(111,168,255,0.54)"
        />
        <MetricCard
          icon={<Clock3 className="w-5 h-5" />}
          title="Pending pipeline"
          value={formatPrimaryValue(walletPending, displayUnit, usdMicrosPerCredit)}
          subtitle={`${formatSecondaryValue(walletPending, displayUnit, usdMicrosPerCredit)} aún en maduración`}
          accent="rgba(244,197,66,0.54)"
        />
        <MetricCard
          icon={<TrendingUp className="w-5 h-5" />}
          title={`Revenue ${range.toUpperCase()}`}
          value={formatPrimaryValue(rangeRevenue, displayUnit, usdMicrosPerCredit)}
          subtitle={`${summary.salesCount || 0} sales · ${(summary.marketplaceReferralCount || 0) + (summary.planReferralCount || 0)} referrals`}
          accent="rgba(240,107,87,0.52)"
        />
        <MetricCard
          icon={<DollarSign className="w-5 h-5" />}
          title="Net cash-out reference"
          value={`$${(walletAvailable * netUsdPerCredit).toFixed(2)}`}
          subtitle={`sobre ${walletAvailable} credits disponibles al fee actual`}
          accent="rgba(123,77,255,0.52)"
        />
      </div>

      <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-4 md:p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === "overview"} label="Overview" onClick={() => setTab("overview")} />
            <TabButton active={tab === "sales"} label="Sales Studio" onClick={() => setTab("sales")} />
            <TabButton active={tab === "referrals"} label="Referral Engine" onClick={() => setTab("referrals")} />
            <TabButton active={tab === "purchases"} label="Purchases" onClick={() => setTab("purchases")} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="px-3 py-2 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-sm" onClick={() => openHistory("pending")}>Pending history</button>
            <button type="button" className="px-3 py-2 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-sm" onClick={() => openHistory("available")}>Available history</button>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-red-200">{error}</div> : null}
      {dashboardError ? <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-red-200">{dashboardError}</div> : null}
      {!canManageEarnings ? <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 p-4 text-amber-100">{earningsGateText}</div> : null}
      {dashboardLoading && !dashboard ? <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-white/60">Cargando Trade Intelligence...</div> : null}

      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-6">
            <TimelineChart points={timeline} usdMicrosPerCredit={usdMicrosPerCredit} unit={displayUnit} />

            <div className="space-y-4">
              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Portfolio mix</div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/55">Sales revenue</div>
                    <div className="mt-2 text-2xl font-semibold">{formatPrimaryValue(Number(summary.netSalesCredits) || 0, displayUnit, usdMicrosPerCredit)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/55">Referral revenue</div>
                    <div className="mt-2 text-2xl font-semibold">{formatPrimaryValue(Number(summary.totalReferralCredits) || 0, displayUnit, usdMicrosPerCredit)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/55">Active listings</div>
                    <div className="mt-2 text-2xl font-semibold">{summary.activeListingsCount || 0}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/55">Avg per sale</div>
                    <div className="mt-2 text-2xl font-semibold">{formatPrimaryValue(Number(summary.avgNetCreditsPerSale) || 0, displayUnit, usdMicrosPerCredit)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Cash-out intelligence</div>
                    <div className="mt-2 text-lg font-semibold">Tu histórico de retiros y ritmo de salida</div>
                  </div>
                  <CreditCard className="w-5 h-5 text-white/70" />
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/55">Cashouts</div>
                    <div className="mt-2 text-2xl font-semibold">{dashboard?.cashoutsSummary?.count || 0}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/55">Credits out</div>
                    <div className="mt-2 text-2xl font-semibold">{dashboard?.cashoutsSummary?.totalCredits || 0}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-white/55">Net USD</div>
                    <div className="mt-2 text-2xl font-semibold">${(((dashboard?.cashoutsSummary?.totalNetUsdMicros || 0) as number) / 1_000_000).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <SpotlightCard title="Best seller" item={top.bestSeller || null} metric={`${top.bestSeller?.rangeSalesCount || 0} sales · ${formatPrimaryValue(top.bestSeller?.netSalesCredits || 0, displayUnit, usdMicrosPerCredit)}`} />
            <SpotlightCard title="Most liked" item={top.mostLiked || null} metric={`${top.mostLiked?.likesCount || 0} likes`} />
            <SpotlightCard title="Most commented" item={top.mostCommented || null} metric={`${top.mostCommented?.commentsCount || 0} comments`} />
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Live tape</div>
                <div className="mt-2 text-lg font-semibold">Actividad reciente que mueve tu cashflow</div>
              </div>
              <Activity className="w-5 h-5 text-white/70" />
            </div>
            {recentEvents.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-white/55">Todavía no hay eventos recientes para mostrar.</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {recentEvents.map((event: any) => (
                  <div key={event.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{event.title}</div>
                        <div className="mt-1 text-xs text-white/58">{event.subtitle}</div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium">
                        {formatPrimaryValue(event.credits, displayUnit, usdMicrosPerCredit)}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/55">
                      <span>{formatDateTime(event.createdAt)}</span>
                      <span>{event.isMatured ? "Confirmed" : `Available ${formatDateTime(event.availableAt)}`}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Recent cashouts</div>
                <div className="mt-2 text-lg font-semibold">Tus solicitudes de salida más recientes</div>
              </div>
              <CreditCard className="w-5 h-5 text-white/70" />
            </div>

            {cashoutsLoading ? (
              <div className="text-white/60">Cargando cashouts...</div>
            ) : cashoutsError ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-red-200">{cashoutsError}</div>
            ) : cashouts.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-white/60">Aún no has solicitado cashouts.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/45 border-b border-white/10">
                      <th className="text-left py-3 pr-4">Fecha</th>
                      <th className="text-left py-3 pr-4">Status</th>
                      <th className="text-left py-3 pr-4">Credits</th>
                      <th className="text-left py-3 pr-4">Net USD</th>
                      <th className="text-left py-3 pr-4">Método</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashouts.map((c) => (
                      <tr key={c.id} className="border-b border-white/5">
                        <td className="py-3 pr-4 text-white/82">{new Date(c.createdAt).toLocaleString()}</td>
                        <td className="py-3 pr-4"><span className="px-3 py-1 rounded-full border border-white/10 bg-white/[0.05] text-xs">{c.status}</span></td>
                        <td className="py-3 pr-4 text-white/82">{c.amountCredits}</td>
                        <td className="py-3 pr-4 text-white/82">${((Number(c.netUsdMicros || 0) || 0) / 1_000_000).toFixed(2)}</td>
                        <td className="py-3 pr-4 text-white/58">{c?.payoutMethod?.kind ? String(c.payoutMethod.kind) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "sales" ? (
        !canSell ? (
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl border border-white/10 bg-white/[0.05] flex items-center justify-center"><Lock className="w-5 h-5" /></div>
              <div>
                <div className="text-xl font-semibold">Sales Studio locked</div>
                <div className="mt-2 text-white/68 max-w-3xl">{sellerGateText}</div>
                <button type="button" className="mt-4 premium-hero-btn px-4 py-2.5" onClick={() => onNavigate(AppRoute.PROFILE)}>Ir a Perfil y Créditos</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <MetricCard icon={<ShoppingBag className="w-5 h-5" />} title="Gross sales" value={formatPrimaryValue(Number(summary.grossSalesCredits) || 0, displayUnit, usdMicrosPerCredit)} subtitle="volumen total vendido en el rango" accent="rgba(111,168,255,0.5)" />
              <MetricCard icon={<Wallet className="w-5 h-5" />} title="Net creator revenue" value={formatPrimaryValue(Number(summary.netSalesCredits) || 0, displayUnit, usdMicrosPerCredit)} subtitle="lo que realmente entró a tus earnings" accent="rgba(240,107,87,0.5)" />
              <MetricCard icon={<Sparkles className="w-5 h-5" />} title="Average order" value={formatPrimaryValue(Number(summary.avgNetCreditsPerSale) || 0, displayUnit, usdMicrosPerCredit)} subtitle="net promedio por venta" accent="rgba(123,77,255,0.48)" />
              <MetricCard icon={<BarChart3 className="w-5 h-5" />} title="Published listings" value={String(summary.listingsCount || 0)} subtitle={`${summary.activeListingsCount || 0} activas ahora mismo`} accent="rgba(244,197,66,0.5)" />
            </div>

            {listings.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-white/60">Todavía no tienes listings con señal suficiente en el rango actual.</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {listings.map((item: any, index: number) => (
                  <div key={item.id} className="premium-hero-card p-4" style={{ ["--ph-accent" as any]: "rgba(111,168,255,0.44)", ["--ph-accent2" as any]: "rgba(123,77,255,0.24)" }}>
                    <div className="relative z-[1] flex gap-4">
                      <div className="w-28 h-28 rounded-[22px] overflow-hidden border border-white/10 bg-black/40 shrink-0">
                        {item.previewUrl ? <img src={item.previewUrl} className="w-full h-full object-cover" alt={item.name} /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">Rank #{index + 1}</div>
                            <div className="mt-2 text-lg font-semibold truncate">{item.name}</div>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs">{item.status}</div>
                        </div>
                        <div className="mt-2 text-sm text-white/62 line-clamp-2">{item.description || "Sin descripción cargada."}</div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                            <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Revenue</div>
                            <div className="mt-1 font-semibold">{formatPrimaryValue(item.netSalesCredits, displayUnit, usdMicrosPerCredit)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                            <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Sales</div>
                            <div className="mt-1 font-semibold">{item.rangeSalesCount}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                            <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Likes / comments</div>
                            <div className="mt-1 font-semibold">{item.likesCount} / {item.commentsCount}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                            <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Pending / confirmed</div>
                            <div className="mt-1 font-semibold">{item.pendingCredits} / {item.confirmedCredits}</div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/55">
                          <span>Price {item.priceCredits} credits</span>
                          <span>{formatDateTime(item.lastSaleAt || item.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      ) : null}

      {tab === "referrals" ? (
        !canReferrals ? (
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl border border-white/10 bg-white/[0.05] flex items-center justify-center"><Lock className="w-5 h-5" /></div>
              <div>
                <div className="text-xl font-semibold">Referral Engine locked</div>
                <div className="mt-2 text-white/68 max-w-3xl">{referralGateText}</div>
                <button type="button" className="mt-4 premium-hero-btn px-4 py-2.5" onClick={() => onNavigate(AppRoute.PROFILE)}>Ir a Perfil y Créditos</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <MetricCard icon={<Ticket className="w-5 h-5" />} title="Marketplace referrals" value={formatPrimaryValue(Number(summary.marketplaceReferralCredits) || 0, displayUnit, usdMicrosPerCredit)} subtitle={`${summary.marketplaceReferralCount || 0} conversiones en store`} accent="rgba(111,168,255,0.5)" />
              <MetricCard icon={<Crown className="w-5 h-5" />} title="Plan referrals" value={formatPrimaryValue(Number(summary.planReferralCredits) || 0, displayUnit, usdMicrosPerCredit)} subtitle={`${summary.planReferralCount || 0} altas de plan`} accent="rgba(240,107,87,0.52)" />
              <MetricCard icon={<TrendingUp className="w-5 h-5" />} title="Total referral revenue" value={formatPrimaryValue(Number(summary.totalReferralCredits) || 0, displayUnit, usdMicrosPerCredit)} subtitle="suma de store + plan referrals" accent="rgba(123,77,255,0.5)" />
              <MetricCard icon={<Star className="w-5 h-5" />} title="Buyer bonus delivered" value={String(refSummary?.totals?.totalBuyerBonusCredits || 0)} subtitle="valor entregado a compradores con tus códigos" accent="rgba(244,197,66,0.5)" />
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Codes rack</div>
                  <div className="mt-2 text-lg font-semibold">Tus códigos y su rendimiento real</div>
                </div>
                <Ticket className="w-5 h-5 text-white/70" />
              </div>

              {refLoading ? (
                <div className="text-white/60">Cargando Referral Engine...</div>
              ) : codes.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-white/60">No se pudieron cargar tus códigos.</div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  {codes.map((code: any) => {
                    const perf = codePerformance.find((item: any) => item.code === code.code) || null;
                    return (
                      <div key={code.id} className="premium-hero-card p-4" style={{ ["--ph-accent" as any]: "rgba(244,197,66,0.52)", ["--ph-accent2" as any]: "rgba(111,168,255,0.28)" }}>
                        <div className="relative z-[1]">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">Code {code.variant}</div>
                            <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs">{perf?.isActive === false ? "Paused" : "Active"}</div>
                          </div>
                          <div className="mt-3 text-lg font-mono break-all">{code.code}</div>
                          <div className="mt-3 text-sm text-white/62">Buyer discount {code.buyerDiscountPct}% · Reward {code.refRewardPct}%</div>
                          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                              <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Credits</div>
                              <div className="mt-1 font-semibold">{formatPrimaryValue(perf?.totalCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                              <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Conversions</div>
                              <div className="mt-1 font-semibold">{(perf?.marketplaceReferralCount || 0) + (perf?.planReferralCount || 0)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Code leaderboard</div>
                  <div className="mt-2 text-lg font-semibold">Qué código convierte mejor y qué línea te deja más retorno</div>
                </div>
                <BarChart3 className="w-5 h-5 text-white/70" />
              </div>
              {codePerformance.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-white/60">Todavía no hay rendimiento suficiente por código en el rango actual.</div>
              ) : (
                <div className="space-y-3">
                  {codePerformance.map((item: any) => (
                    <div key={item.code} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{item.code}</div>
                          <div className="mt-1 text-xs text-white/55">Store {item.marketplaceReferralCount} · Plans {item.planReferralCount} · Sales volume {item.marketplaceSalesVolumeCredits} cr</div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs">{formatPrimaryValue(item.totalCredits, displayUnit, usdMicrosPerCredit)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      ) : null}

      {tab === "purchases" ? (
        <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.72))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.42)]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Purchase vault</div>
              <div className="mt-2 text-lg font-semibold">Tus adquisiciones en Community Store</div>
            </div>
            <ShoppingBag className="w-5 h-5 text-white/70" />
          </div>

          {buyerLoading && buyerItems.length === 0 ? (
            <div className="text-white/60">Cargando purchases...</div>
          ) : buyerItems.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-white/55">Todavía no has comprado creaciones.</div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {buyerItems.map((item: any) => (
                <div key={item.id} className="premium-hero-card p-4" style={{ ["--ph-accent" as any]: "rgba(111,168,255,0.42)", ["--ph-accent2" as any]: "rgba(244,197,66,0.24)" }}>
                  <div className="relative z-[1] flex gap-4">
                    <div className="w-28 h-28 rounded-[22px] overflow-hidden border border-white/10 bg-black/40 shrink-0">
                      {item.previewUrl ? <img src={item.previewUrl} className="w-full h-full object-cover" alt={item.listingName || item.sellerUsername} /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">Purchased creation</div>
                      <div className="mt-2 text-lg font-semibold truncate">{item.listingName || item.sellerUsername}</div>
                      <div className="mt-1 text-sm text-white/62 line-clamp-2">{item.listingDescription}</div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Paid</div>
                          <div className="mt-1 font-semibold">{item.paidCredits} credits</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="text-white/50 text-[11px] uppercase tracking-[0.18em]">Seller</div>
                          <div className="mt-1 font-semibold truncate">{item.sellerUsername}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/55">
                        <span>{formatDateTime(item.createdAt)}</span>
                        <span>{item.isMatured ? "Confirmed" : `Pending until ${new Date(item.maturesAt).toLocaleDateString()}`}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {buyerHasMore ? (
            <button type="button" className="mt-4 premium-hero-btn px-4 py-2.5" onClick={() => loadBuyer("more")} disabled={buyerLoading}>
              {buyerLoading ? "Cargando..." : "Cargar más"}
            </button>
          ) : null}
        </div>
      ) : null}

      <EarningsActionsModal
        open={earningsModalOpen && canManageEarnings}
        availableCredits={walletAvailable}
        cashoutConfig={cashoutConfig}
        onClose={() => setEarningsModalOpen(false)}
        onTransfer={handleTransfer}
        onCashout={handleCashout}
      />

      <EarningsHistoryModal
        open={historyModalOpen}
        bucket={historyBucket}
        items={historyItems}
        loading={historyLoading}
        error={historyError}
        hasMore={historyHasMore}
        displayUnit={displayUnit}
        usdMicrosPerCredit={usdMicrosPerCredit}
        feeBps={feeBps}
        onClose={() => setHistoryModalOpen(false)}
        onLoadMore={() => loadHistory(historyBucket, "more")}
      />
    </div>
  );
}