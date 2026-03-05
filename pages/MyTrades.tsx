import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  BarChart3,
  Clock3,
  Download,
  Filter,
  Heart,
  Image as ImageIcon,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AppRoute } from "../types";
import { getWalletMe, listMyCashouts, listEarningsHistory, requestCashout, transferEarningsToGeneration } from "../services/walletApi";
import { getMyReferralCodes, getMyReferralSummary } from "../services/referralsApi";
import { getBuyerPurchases, getTradesDashboard } from "../services/tradesApi";
import EarningsActionsModal from "@/components/EarningsActionsModal";
import EarningsHistoryModal from "@/components/EarningsHistoryModal";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

type DisplayUnit = "credits" | "usd";
type SellerRange = "7d" | "30d" | "90d" | "all";
type SellerCompare = "none" | "previous" | "7d" | "30d" | "90d" | "all";
type SellerSort = "revenue_desc" | "sales_desc" | "likes_desc" | "comments_desc" | "latest_sale_desc" | "traction_drop_desc";
type SellerMediaFilter = "all" | "image" | "video" | "other";

const PREFS_KEY = "tales.myTrades.analyticsPrefs.v2";

function numberCompact(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }).format(Number(value) || 0);
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

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function deltaTone(value: number) {
  if (value > 0.01) return "text-emerald-300";
  if (value < -0.01) return "text-rose-300";
  return "text-white/55";
}

function deltaPrefix(value: number) {
  return value > 0 ? "+" : "";
}

function readPrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function MyTrades({ onNavigate }: Props) {
  const [tab, setTab] = useState<"buyer" | "seller" | "referrals">("buyer");
  const [wallet, setWallet] = useState<any | null>(null);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [cashoutConfig, setCashoutConfig] = useState<any | null>(null);

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

  const [error, setError] = useState<string | null>(null);

  const [buyerItems, setBuyerItems] = useState<any[]>([]);
  const [buyerOffset, setBuyerOffset] = useState(0);
  const [buyerHasMore, setBuyerHasMore] = useState(true);
  const [buyerLoading, setBuyerLoading] = useState(false);

  const [sellerDashboard, setSellerDashboard] = useState<any | null>(null);
  const [sellerDashboardLoading, setSellerDashboardLoading] = useState(false);
  const [sellerDashboardError, setSellerDashboardError] = useState<string | null>(null);

  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>("credits");
  const [sellerRange, setSellerRange] = useState<SellerRange>("30d");
  const [sellerCompare, setSellerCompare] = useState<SellerCompare>("previous");
  const [sellerMediaFilter, setSellerMediaFilter] = useState<SellerMediaFilter>("all");
  const [sellerSort, setSellerSort] = useState<SellerSort>("revenue_desc");

  const canSell = !!subscription?.can_sell;
  const canReferrals = !!subscription?.can_referrals;
  const canManageEarnings = !!subscription?.can_sell;

  const referralGateText = useMemo(() => {
    if (!subscription) {
      return "Para obtener tus códigos de Referidos/Afiliados necesitas un plan activo Partner o superior. Si cancelas, no renuevas o bajas de nivel, tus códigos dejan de funcionar automáticamente hasta volver a Partner o superior.";
    }
    return "Tu plan actual no incluye Referidos/Afiliados. Tus códigos quedan pausados y dejan de funcionar hasta volver a Partner o superior.";
  }, [subscription]);

  const sellerGateText = useMemo(() => {
    if (!subscription) {
      return "Para vender en Community Store necesitas un plan Pro o superior activo. Si cancelas, no renuevas o bajas de nivel, tus listings públicos se ocultan automáticamente hasta volver a Pro o superior.";
    }
    return "Tu plan actual no incluye Seller. Tus listings públicos quedan ocultos automáticamente y tus earnings de ventas quedan bloqueados hasta volver a Pro o superior.";
  }, [subscription]);

  const earningsGateText = useMemo(() => {
    if (!subscription) {
      return "Tus earnings y créditos de ventas se conservan, pero no puedes gestionarlos sin un plan Pro o superior activo.";
    }
    return "Tus earnings y créditos de ventas están retenidos. Vuelve a Pro o superior para transferirlos o solicitar cash out.";
  }, [subscription]);

  const usdMicrosPerCredit = Number(cashoutConfig?.usdMicrosPerCredit) || 4990;
  const feeBps = Number(cashoutConfig?.feeBps) || 3700;
  const grossUsdPerCredit = usdMicrosPerCredit / 1_000_000;
  const netUsdPerCredit = grossUsdPerCredit * (1 - feeBps / 10000);

  useEffect(() => {
    const prefs = readPrefs();
    if (!prefs) return;
    if (prefs.displayUnit === "credits" || prefs.displayUnit === "usd") setDisplayUnit(prefs.displayUnit);
    if (["7d", "30d", "90d", "all"].includes(prefs.sellerRange)) setSellerRange(prefs.sellerRange);
    if (["none", "previous", "7d", "30d", "90d", "all"].includes(prefs.sellerCompare)) setSellerCompare(prefs.sellerCompare);
    if (["all", "image", "video", "other"].includes(prefs.sellerMediaFilter)) setSellerMediaFilter(prefs.sellerMediaFilter);
    if (["revenue_desc", "sales_desc", "likes_desc", "comments_desc", "latest_sale_desc", "traction_drop_desc"].includes(prefs.sellerSort)) setSellerSort(prefs.sellerSort);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ displayUnit, sellerRange, sellerCompare, sellerMediaFilter, sellerSort })
      );
    } catch {}
  }, [displayUnit, sellerRange, sellerCompare, sellerMediaFilter, sellerSort]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const r = await getWalletMe();
        setWallet(r.wallet);
        setSubscription(r.subscription);
        setCashoutConfig((r as any).cashoutConfig || null);

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
      } catch (e: any) {
        setError(e?.message || "No se pudo cargar wallet.");
      }
    })();
  }, []);

  async function refreshWalletAndCashouts() {
    const r = await getWalletMe();
    setWallet(r.wallet);
    setSubscription(r.subscription);
    setCashoutConfig((r as any).cashoutConfig || null);

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

  async function handleTransfer(amountCredits: number) {
    if (!canManageEarnings) {
      throw new Error("Necesitas plan Pro o superior activo para gestionar earnings.");
    }

    await transferEarningsToGeneration(amountCredits);
    await refreshWalletAndCashouts();
    if (tab === "seller" && canSell) await loadSellerDashboard();
  }

  async function handleCashout(args: { amountCredits: number; payoutMethod: { kind: string; handle: string; note?: string } }) {
    if (!canManageEarnings) {
      throw new Error("Necesitas plan Pro o superior activo para gestionar earnings.");
    }

    await requestCashout(args.amountCredits, args.payoutMethod);
    await refreshWalletAndCashouts();
    if (tab === "seller" && canSell) await loadSellerDashboard();
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

  useEffect(() => {
    if (tab !== "referrals") return;

    if (!canReferrals) {
      setCodes([]);
      setRefSummary(null);
      setRefLoading(false);
      return;
    }

    (async () => {
      setError(null);
      setRefLoading(true);
      try {
        const [c, s] = await Promise.all([getMyReferralCodes(), getMyReferralSummary()]);
        setCodes(c);
        setRefSummary(s);
      } catch (e: any) {
        const code = e?.code ? String(e.code) : "";
        if (code === "PLAN_UPGRADE_REQUIRED" || code === "NO_ACTIVE_PLAN") {
          setError(null);
        } else {
          setError(e?.message || "No se pudieron cargar tus referidos.");
        }
        setCodes([]);
        setRefSummary(null);
      } finally {
        setRefLoading(false);
      }
    })();
  }, [tab, canReferrals]);

  useEffect(() => {
    if (tab === "buyer" && buyerItems.length === 0) loadBuyer("reset");
    if (tab === "seller" && canSell) loadSellerDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canSell, sellerRange, sellerCompare]);

  async function loadBuyer(mode: "reset" | "more") {
    try {
      setError(null);
      setBuyerLoading(true);

      const nextOffset = mode === "reset" ? 0 : buyerOffset;
      const res = await getBuyerPurchases({ limit: 12, offset: nextOffset });

      setBuyerItems((prev) => (mode === "reset" ? res.items : [...prev, ...res.items]));
      setBuyerOffset(res.nextOffset);
      setBuyerHasMore(res.hasMore);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar compras.");
    } finally {
      setBuyerLoading(false);
    }
  }

  async function loadSellerDashboard() {
    try {
      setSellerDashboardLoading(true);
      setSellerDashboardError(null);
      const data = await getTradesDashboard(sellerRange, sellerCompare);
      setSellerDashboard(data);
    } catch (e: any) {
      setSellerDashboard(null);
      setSellerDashboardError(e?.message || "No se pudo cargar Trade Intelligence.");
    } finally {
      setSellerDashboardLoading(false);
    }
  }

  const sellerSummary = sellerDashboard?.summary || {};
  const sellerCompareSummary = sellerDashboard?.compareSummary || {};
  const sellerDeltas = sellerDashboard?.deltas || {};
  const alerts = Array.isArray(sellerDashboard?.alerts) ? sellerDashboard.alerts : [];

  const filteredSellerListings = useMemo(() => {
    const raw = Array.isArray(sellerDashboard?.listings) ? sellerDashboard.listings : [];
    const filtered = raw.filter((item: any) => {
      if (sellerMediaFilter === "all") return true;
      if (sellerMediaFilter === "other") return item.mediaTag !== "image" && item.mediaTag !== "video";
      return item.mediaTag === sellerMediaFilter;
    });

    return [...filtered].sort((a: any, b: any) => {
      if (sellerSort === "sales_desc") return (b.currentSalesCount || 0) - (a.currentSalesCount || 0);
      if (sellerSort === "likes_desc") return (b.currentLikesCount || 0) - (a.currentLikesCount || 0);
      if (sellerSort === "comments_desc") return (b.currentCommentsCount || 0) - (a.currentCommentsCount || 0);
      if (sellerSort === "latest_sale_desc") return (b.lastSaleAt || 0) - (a.lastSaleAt || 0);
      if (sellerSort === "traction_drop_desc") return (a.revenueDeltaPct || 0) - (b.revenueDeltaPct || 0);
      return (b.currentNetSalesCredits || 0) - (a.currentNetSalesCredits || 0);
    });
  }, [sellerDashboard, sellerMediaFilter, sellerSort]);

  function exportSellerCsv() {
    if (!filteredSellerListings.length) return;
    downloadCsv(
      `my-trades-seller-${sellerRange}.csv`,
      filteredSellerListings.map((item: any) => ({
        listing_name: item.name,
        status: item.status,
        media_type: item.mediaTag,
        listing_kind: item.listingKind,
        price_credits: item.priceCredits,
        current_sales_count: item.currentSalesCount,
        current_net_sales_credits: item.currentNetSalesCredits,
        current_pending_credits: item.currentPendingCredits,
        current_confirmed_credits: item.currentConfirmedCredits,
        compare_sales_count: item.compareSalesCount,
        compare_net_sales_credits: item.compareNetSalesCredits,
        current_likes: item.currentLikesCount,
        compare_likes: item.compareLikesCount,
        current_comments: item.currentCommentsCount,
        compare_comments: item.compareCommentsCount,
        revenue_delta_pct: Number(item.revenueDeltaPct || 0).toFixed(2),
        last_sale_at: item.lastSaleAt ? new Date(item.lastSaleAt).toISOString() : "",
      }))
    );
  }

  return (
    <div className="p-6 text-white space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold">My Trades</div>
          <div className="text-white/60 text-sm mt-1">Compras · Ventas · Referidos · Trade intelligence</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded-lg border border-white/10 ${displayUnit === "credits" ? "bg-white text-black" : "bg-black/30 text-white"}`}
            onClick={() => setDisplayUnit("credits")}
          >
            Credits
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded-lg border border-white/10 ${displayUnit === "usd" ? "bg-white text-black" : "bg-black/30 text-white"}`}
            onClick={() => setDisplayUnit("usd")}
          >
            USD ref.
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
            onClick={() => onNavigate(AppRoute.COMMUNITY_STORE)}
          >
            Ir a Community Store
          </button>
        </div>
      </div>

      {wallet ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
            <div>
              <div className="text-sm text-white/70">Wallet</div>
              <div className="text-[12px] text-white/50 mt-1">
                1 credit ≈ ${grossUsdPerCredit.toFixed(4)} ref. · Net cash-out ≈ ${netUsdPerCredit.toFixed(4)} por credit · Fee {(feeBps / 100).toFixed(0)}%
              </div>
            </div>
            <button
              type="button"
              className={`px-3 py-2 rounded-lg text-xs ${canManageEarnings ? "bg-white/10 hover:bg-white/15" : "bg-white/5 text-white/40 cursor-not-allowed"}`}
              onClick={() => {
                if (!canManageEarnings) return;
                setEarningsModalOpen(true);
              }}
              disabled={!canManageEarnings}
              title={canManageEarnings ? "Gestionar earnings" : "Necesitas plan Pro o superior activo para gestionar earnings"}
            >
              Gestionar earnings
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl bg-black/40 border border-white/10 p-3">
              <div className="text-white/60 text-xs">Créditos de generación</div>
              <div className="text-xl font-bold">{wallet.generationCredits}</div>
              <div className="text-[11px] text-white/50 mt-1">Siempre se muestran en credits.</div>
            </div>

            <div className="rounded-xl bg-black/40 border border-white/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-white/60 text-xs">Earnings (pending)</div>
                <button
                  type="button"
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px]"
                  onClick={() => openHistory("pending")}
                >
                  Historial
                </button>
              </div>
              <div className="text-xl font-bold mt-1">{formatPrimaryValue(wallet.earnings_pending_credits, displayUnit, usdMicrosPerCredit)}</div>
              <div className="text-[11px] text-white/50 mt-1">{formatSecondaryValue(wallet.earnings_pending_credits, displayUnit, usdMicrosPerCredit)} · No disponibles aún.</div>
            </div>

            <div
              className={`rounded-xl bg-black/40 border border-white/10 p-3 ${canManageEarnings ? "cursor-pointer hover:bg-black/50" : "opacity-70"}`}
              role={canManageEarnings ? "button" : undefined}
              tabIndex={canManageEarnings ? 0 : -1}
              onClick={() => {
                if (!canManageEarnings) return;
                setEarningsModalOpen(true);
              }}
              onKeyDown={(e) => {
                if (!canManageEarnings) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setEarningsModalOpen(true);
                }
              }}
              title={canManageEarnings ? "Click para transferir a créditos o solicitar cash out" : "Necesitas plan Pro o superior activo para gestionar earnings"}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-white/60 text-xs">Earnings (available)</div>
                <button
                  type="button"
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    openHistory("available");
                  }}
                >
                  Historial
                </button>
              </div>
              <div className="text-xl font-bold mt-1">{formatPrimaryValue(wallet.earnings_matured_credits, displayUnit, usdMicrosPerCredit)}</div>
              <div className="text-[11px] text-white/50 mt-1">
                {formatSecondaryValue(wallet.earnings_matured_credits, displayUnit, usdMicrosPerCredit)} · {canManageEarnings ? "Click para transferir o cash out." : "Bloqueados hasta volver a Pro o superior."}
              </div>
            </div>
          </div>

          {!canManageEarnings ? <div className="mt-3 text-[12px] text-amber-200/90">{earningsGateText}</div> : null}

          <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-3">
            <div className="text-sm font-semibold">Cashouts</div>
            {cashoutsLoading ? (
              <div className="text-white/60 text-sm mt-2">Cargando...</div>
            ) : cashoutsError ? (
              <div className="text-red-300 text-sm mt-2">{cashoutsError}</div>
            ) : cashouts.length === 0 ? (
              <div className="text-white/60 text-sm mt-2">Aún no has solicitado cashouts.</div>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/60">
                      <th className="text-left py-2 pr-3">Fecha</th>
                      <th className="text-left py-2 pr-3">Status</th>
                      <th className="text-left py-2 pr-3">Credits</th>
                      <th className="text-left py-2 pr-3">Net USD</th>
                      <th className="text-left py-2 pr-3">Método</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashouts.map((c) => (
                      <tr key={c.id} className="border-t border-white/10">
                        <td className="py-2 pr-3 text-white/80">{new Date(c.createdAt).toLocaleString()}</td>
                        <td className="py-2 pr-3"><span className="px-2 py-1 rounded-lg bg-white/10">{c.status}</span></td>
                        <td className="py-2 pr-3 text-white/80">{c.amountCredits}</td>
                        <td className="py-2 pr-3 text-white/80">${(((Number(c.netUsdMicros || 0) || 0) / 1_000_000)).toFixed(2)}</td>
                        <td className="py-2 pr-3 text-white/60">{c?.payoutMethod?.kind ? String(c.payoutMethod.kind) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <EarningsActionsModal
        open={earningsModalOpen && canManageEarnings}
        availableCredits={Number(wallet?.earnings_matured_credits) || 0}
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
        onClose={() => setHistoryModalOpen(false)}
        onLoadMore={() => loadHistory(historyBucket, "more")}
      />

      <div className="flex gap-2">
        <button
          type="button"
          className={`px-4 py-2 rounded-lg border border-white/10 ${tab === "buyer" ? "bg-white text-black" : "bg-black/30 text-white"}`}
          onClick={() => setTab("buyer")}
        >
          Buyer
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded-lg border border-white/10 ${tab === "seller" ? "bg-white text-black" : "bg-black/30 text-white"}`}
          onClick={() => setTab("seller")}
        >
          Seller Studio
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded-lg border border-white/10 ${tab === "referrals" ? "bg-white text-black" : "bg-black/30 text-white"}`}
          onClick={() => setTab("referrals")}
        >
          Referral Engine
        </button>
      </div>

      {error ? <div className="text-red-400">{error}</div> : null}

      {tab === "buyer" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold mb-3">Tus compras</div>

          {buyerLoading && buyerItems.length === 0 ? (
            <div className="text-white/60">Cargando...</div>
          ) : buyerItems.length === 0 ? (
            <div className="text-white/60">Aún no tienes compras.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {buyerItems.map((it) => (
                <div key={it.id} className="rounded-xl border border-white/10 bg-black/40 p-3 flex gap-3">
                  <div className="w-20 h-20 rounded-lg overflow-hidden border border-white/10 bg-black/50 shrink-0">
                    {it.previewUrl ? <img src={it.previewUrl} className="w-full h-full object-cover" /> : null}
                  </div>

                  <div className="flex-1">
                    <div className="text-sm font-semibold">{it.listingName || it.sellerUsername}</div>
                    <div className="text-xs text-white/60 mt-1 line-clamp-2">{it.listingDescription}</div>
                    <div className="text-xs text-white/60 mt-2">Pagaste <b className="text-white">{it.paidCredits}</b> credits · Price {it.listingPriceCredits}</div>
                    <div className="text-[11px] text-white/50 mt-1">{new Date(it.createdAt).toLocaleString()}</div>
                    <div className="text-[11px] mt-1">
                      {it.isMatured ? <span className="text-green-300">Matured</span> : <span className="text-yellow-300">Pending until {new Date(it.maturesAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {buyerHasMore ? (
            <button type="button" className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm" onClick={() => loadBuyer("more")} disabled={buyerLoading}>
              {buyerLoading ? "Cargando..." : "Cargar más"}
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "seller" ? (
        !canSell ? (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm font-semibold mb-2">Desbloquea Seller</div>
            <div className="text-white/70 text-sm">{sellerGateText}</div>
            <button type="button" className="mt-4 px-4 py-2 rounded-lg bg-white text-black font-semibold" onClick={() => onNavigate(AppRoute.PROFILE)}>
              Ir a Perfil y Créditos
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="premium-hero-card p-4" style={{ ["--ph-accent" as any]: "rgba(111,168,255,0.45)", ["--ph-accent2" as any]: "rgba(240,107,87,0.24)" }}>
              <div className="relative z-[1] space-y-4">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                  <div>
                    <div className="premium-hero-badge"><span className="premium-hero-dot" /> Seller Studio hardening</div>
                    <div className="mt-3 text-2xl font-semibold tracking-tight">Filtro por media, orden persistente, benchmark entre rangos, export CSV y alert center.</div>
                    <div className="mt-2 text-sm text-white/65 max-w-3xl">
                      Usa esta vista para detectar qué listing pierde tracción, qué formato convierte mejor y cómo cambia tu revenue frente a otra ventana temporal.
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(["7d", "30d", "90d", "all"] as SellerRange[]).map((range) => (
                      <button
                        key={range}
                        type="button"
                        className={`px-3 py-2 rounded-lg border border-white/10 text-sm ${sellerRange === range ? "bg-white text-black" : "bg-black/30 text-white hover:bg-white/10"}`}
                        onClick={() => setSellerRange(range)}
                      >
                        {range.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-white/45 mb-1">Benchmark</div>
                    <select className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" value={sellerCompare} onChange={(e) => setSellerCompare(e.target.value as SellerCompare)}>
                      <option value="none">Sin comparación</option>
                      <option value="previous">Previous equivalent</option>
                      <option value="7d">Últimos 7 días</option>
                      <option value="30d">Últimos 30 días</option>
                      <option value="90d">Últimos 90 días</option>
                      <option value="all">All time</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-white/45 mb-1">Media type</div>
                    <select className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" value={sellerMediaFilter} onChange={(e) => setSellerMediaFilter(e.target.value as SellerMediaFilter)}>
                      <option value="all">Todos</option>
                      <option value="image">Solo image</option>
                      <option value="video">Solo video</option>
                      <option value="other">Otros</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-white/45 mb-1">Orden</div>
                    <select className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" value={sellerSort} onChange={(e) => setSellerSort(e.target.value as SellerSort)}>
                      <option value="revenue_desc">Mayor revenue</option>
                      <option value="sales_desc">Más ventas</option>
                      <option value="likes_desc">Más likes</option>
                      <option value="comments_desc">Más comentarios</option>
                      <option value="latest_sale_desc">Venta más reciente</option>
                      <option value="traction_drop_desc">Mayor caída de tracción</option>
                    </select>
                  </div>

                  <div className="flex items-end gap-2">
                    <button type="button" className="flex-1 rounded-xl border border-white/10 bg-white/10 hover:bg-white/15 px-3 py-2 text-sm flex items-center justify-center gap-2" onClick={loadSellerDashboard}>
                      <RefreshCw className="w-4 h-4" /> Refresh
                    </button>
                    <button type="button" className="flex-1 rounded-xl border border-white/10 bg-white/10 hover:bg-white/15 px-3 py-2 text-sm flex items-center justify-center gap-2" onClick={exportSellerCsv} disabled={!filteredSellerListings.length}>
                      <Download className="w-4 h-4" /> CSV
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {sellerDashboardError ? <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-red-200">{sellerDashboardError}</div> : null}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-white/55 text-xs uppercase tracking-wide">Revenue actual</div>
                <div className="mt-2 text-2xl font-bold">{formatPrimaryValue(sellerSummary.netSalesCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                <div className="mt-2 text-xs text-white/50">{sellerDashboard?.currentWindow?.label || sellerRange.toUpperCase()} · {sellerSummary.salesCount || 0} ventas</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-white/55 text-xs uppercase tracking-wide">Benchmark</div>
                <div className="mt-2 text-2xl font-bold">{formatPrimaryValue(sellerCompareSummary.netSalesCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                <div className="mt-2 text-xs text-white/50">{sellerDashboard?.compareWindow?.label || "Sin benchmark activo"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-white/55 text-xs uppercase tracking-wide">Delta revenue</div>
                <div className={`mt-2 text-2xl font-bold flex items-center gap-2 ${deltaTone(Number(sellerDeltas.netSalesCreditsPct) || 0)}`}>
                  {(Number(sellerDeltas.netSalesCreditsPct) || 0) < 0 ? <TrendingDown className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
                  {deltaPrefix(Number(sellerDeltas.netSalesCreditsPct) || 0)}{(Number(sellerDeltas.netSalesCreditsPct) || 0).toFixed(1)}%
                </div>
                <div className="mt-2 text-xs text-white/50">Comparación de revenue neto entre ventanas.</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-white/55 text-xs uppercase tracking-wide">Referral revenue</div>
                <div className="mt-2 text-2xl font-bold">{formatPrimaryValue(sellerSummary.totalReferralCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                <div className="mt-2 text-xs text-white/50">Store + plan referrals en la ventana actual.</div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_1fr] gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-sm font-semibold">Alert center</div>
                    <div className="text-xs text-white/55 mt-1">Listings con caída de tracción, pérdida de conversación o interés sin conversión.</div>
                  </div>
                  <AlertTriangle className="w-5 h-5 text-amber-300" />
                </div>

                {sellerDashboardLoading && !sellerDashboard ? (
                  <div className="text-white/60">Cargando intelligence...</div>
                ) : alerts.length === 0 ? (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-emerald-100 text-sm">Sin alertas relevantes en la combinación actual. Tu portfolio no muestra señales fuertes de deterioro.</div>
                ) : (
                  <div className="space-y-3">
                    {alerts.map((alert: any) => (
                      <div key={alert.id} className="rounded-xl border border-white/10 bg-black/40 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{alert.title}</div>
                            <div className="text-xs text-white/55 mt-1">{alert.message}</div>
                          </div>
                          <div className={`px-2 py-1 rounded-lg text-[11px] ${alert.severity === "high" ? "bg-rose-500/15 text-rose-200" : alert.severity === "medium" ? "bg-amber-500/15 text-amber-200" : "bg-sky-500/15 text-sky-200"}`}>{alert.severity}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold">Signals snapshot</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <div className="text-white/55 text-[11px] uppercase tracking-wide flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Pending</div>
                    <div className="mt-2 text-lg font-bold">{formatPrimaryValue(sellerSummary.pendingCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <div className="text-white/55 text-[11px] uppercase tracking-wide flex items-center gap-2"><Wallet className="w-3.5 h-3.5" /> Confirmed</div>
                    <div className="mt-2 text-lg font-bold">{formatPrimaryValue(sellerSummary.confirmedCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <div className="text-white/55 text-[11px] uppercase tracking-wide flex items-center gap-2"><Heart className="w-3.5 h-3.5" /> Likes</div>
                    <div className="mt-2 text-lg font-bold">{sellerSummary.likesCount || 0}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <div className="text-white/55 text-[11px] uppercase tracking-wide flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5" /> Comments</div>
                    <div className="mt-2 text-lg font-bold">{sellerSummary.commentsCount || 0}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div>
                  <div className="text-sm font-semibold">Portfolio by listing</div>
                  <div className="text-xs text-white/55 mt-1">Orden persistente, filtro por media type y comparativa directa por creación.</div>
                </div>
                <div className="text-xs text-white/45 flex items-center gap-2"><Filter className="w-3.5 h-3.5" /> {filteredSellerListings.length} resultados</div>
              </div>

              {sellerDashboardLoading && !sellerDashboard ? (
                <div className="text-white/60">Cargando listings...</div>
              ) : filteredSellerListings.length === 0 ? (
                <div className="text-white/60">No hay listings que coincidan con el filtro actual.</div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {filteredSellerListings.map((it: any) => (
                    <div key={it.id} className="premium-hero-card p-4" style={{ ["--ph-accent" as any]: "rgba(111,168,255,0.38)", ["--ph-accent2" as any]: "rgba(123,77,255,0.24)" }}>
                      <div className="relative z-[1] flex gap-4">
                        <div className="w-24 h-24 rounded-2xl overflow-hidden border border-white/10 bg-black/50 shrink-0">
                          {it.previewUrl ? <img src={it.previewUrl} className="w-full h-full object-cover" /> : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold truncate">{it.name}</div>
                              <div className="text-[11px] text-white/50 mt-1 flex items-center gap-2">
                                {it.mediaTag === "video" ? <PlayCircle className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
                                {it.mediaTag || "other"} · {it.status}
                              </div>
                            </div>
                            <div className={`text-xs rounded-lg px-2 py-1 border border-white/10 ${deltaTone(Number(it.revenueDeltaPct) || 0)}`}>
                              {deltaPrefix(Number(it.revenueDeltaPct) || 0)}{(Number(it.revenueDeltaPct) || 0).toFixed(1)}%
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                              <div className="text-white/50 text-[11px] uppercase tracking-wide">Revenue actual</div>
                              <div className="mt-1 font-semibold">{formatPrimaryValue(it.currentNetSalesCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                              <div className="text-white/50 text-[11px] uppercase tracking-wide">Benchmark</div>
                              <div className="mt-1 font-semibold">{formatPrimaryValue(it.compareNetSalesCredits || 0, displayUnit, usdMicrosPerCredit)}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                              <div className="text-white/50 text-[11px] uppercase tracking-wide">Sales</div>
                              <div className="mt-1 font-semibold">{it.currentSalesCount} <span className="text-white/45 text-xs">vs {it.compareSalesCount}</span></div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                              <div className="text-white/50 text-[11px] uppercase tracking-wide">Likes / comments</div>
                              <div className="mt-1 font-semibold">{it.currentLikesCount} / {it.currentCommentsCount}</div>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-white/50">
                            <span>Price {it.priceCredits} credits</span>
                            <span>Pending {it.currentPendingCredits}</span>
                            <span>Confirmed {it.currentConfirmedCredits}</span>
                            <span>Last sale {formatDateTime(it.lastSaleAt || it.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      ) : null}

      {tab === "referrals" ? (
        !canReferrals ? (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm font-semibold mb-2">Desbloquea Referidos/Afiliados</div>
            <div className="text-white/70 text-sm">{referralGateText}</div>
            <button type="button" className="mt-4 px-4 py-2 rounded-lg bg-white text-black font-semibold" onClick={() => onNavigate(AppRoute.PROFILE)}>
              Ir a Perfil y Créditos
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm font-semibold mb-2">Referidos</div>

            {refLoading ? (
              <div className="text-white/70">Cargando panel...</div>
            ) : (
              <>
                {refSummary ? (
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mb-4">
                    <div className="text-sm font-semibold">Resumen</div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-xl bg-black/40 border border-white/10 p-3">
                        <div className="text-white/60 text-xs">Referrals</div>
                        <div className="text-lg font-bold">{refSummary.totals?.count ?? 0}</div>
                      </div>
                      <div className="rounded-xl bg-black/40 border border-white/10 p-3">
                        <div className="text-white/60 text-xs">Reward pending</div>
                        <div className="text-lg font-bold">{refSummary.totals?.pendingRewardCredits ?? 0}</div>
                      </div>
                      <div className="rounded-xl bg-black/40 border border-white/10 p-3">
                        <div className="text-white/60 text-xs">Reward matured</div>
                        <div className="text-lg font-bold">{refSummary.totals?.maturedRewardCredits ?? 0}</div>
                      </div>
                      <div className="rounded-xl bg-black/40 border border-white/10 p-3">
                        <div className="text-white/60 text-xs">Buyer bonuses</div>
                        <div className="text-lg font-bold">{refSummary.totals?.totalBuyerBonusCredits ?? 0}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-sm font-semibold mb-2">Tus 3 códigos</div>

                  {codes.length ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {codes.map((c) => (
                        <div key={c.id} className="rounded-xl bg-black/40 border border-white/10 p-3">
                          <div className="text-xs text-white/60">Código {c.variant}</div>
                          <div className="text-sm font-mono mt-1">{c.code}</div>
                          <div className="text-xs text-white/60 mt-2">Buyer BONUS: {c.buyerDiscountPct}% · Reward: {c.refRewardPct}%</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-white/70">No se pudieron cargar tus códigos.</div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-sm font-semibold mb-2">Actividad reciente</div>

                  {refSummary?.referrals?.length ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {refSummary.referrals.slice(0, 10).map((r: any) => (
                        <div key={r.id} className="rounded-xl bg-black/40 border border-white/10 p-3">
                          <div className="text-sm font-semibold">{r.referredUsername || "(sin username)"} · {r.planSlug || "-"}</div>
                          <div className="text-xs text-white/60 mt-1">Reward: <b className="text-white/80">{r.referrerRewardCredits}</b> · Buyer bonus: <b className="text-white/80">{r.buyerBonusCredits}</b></div>
                          <div className="text-[11px] text-white/50 mt-1">{new Date(r.createdAt).toLocaleString()}</div>
                          <div className="text-[11px] mt-1">
                            {r.isMatured ? <span className="text-green-300">Matured</span> : <span className="text-yellow-300">Pending until {new Date(r.maturesAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-white/60">Aún no tienes actividad de referidos. Comparte tus códigos y cuando alguien compre un plan con tu código, aparecerá aquí.</div>
                  )}
                </div>
              </>
            )}
          </div>
        )
      ) : null}
    </div>
  );
}