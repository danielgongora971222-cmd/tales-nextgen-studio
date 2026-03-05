import React, { useEffect, useMemo, useState } from "react";
import { AppRoute } from "../types";
import { getWalletMe, listMyCashouts, listEarningsHistory, requestCashout, transferEarningsToGeneration } from "../services/walletApi";
import { getMyReferralCodes, getMyReferralSummary } from "../services/referralsApi";
import { getBuyerPurchases, getSellerListings } from "../services/tradesApi";
import EarningsActionsModal from "@/components/EarningsActionsModal";
import EarningsHistoryModal from "@/components/EarningsHistoryModal";

interface Props {
  onNavigate: (route: AppRoute) => void;
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

  const [buyerItems, setBuyerItems] = useState<any[]>([]);
  const [buyerOffset, setBuyerOffset] = useState(0);
  const [buyerHasMore, setBuyerHasMore] = useState(true);
  const [buyerLoading, setBuyerLoading] = useState(false);

  const [sellerItems, setSellerItems] = useState<any[]>([]);
  const [sellerOffset, setSellerOffset] = useState(0);
  const [sellerHasMore, setSellerHasMore] = useState(true);
  const [sellerLoading, setSellerLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const r = await getWalletMe();
        setWallet(r.wallet);
        setSubscription(r.subscription);
        setCashoutConfig((r as any).cashoutConfig || null);

        // cashouts list (no bloquea)
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
}

async function handleCashout(args: { amountCredits: number; payoutMethod: { kind: string; handle: string; note?: string } }) {
  if (!canManageEarnings) {
    throw new Error("Necesitas plan Pro o superior activo para gestionar earnings.");
  }

  await requestCashout(args.amountCredits, args.payoutMethod);
  await refreshWalletAndCashouts();
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

    // ✅ Si no cumple requisitos => NO llamamos API y NO mostramos "Cargando códigos..."
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
          // No pintamos error rojo si es gating (lo cubre el CTA)
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

    // ✅ Seller: solo si el plan lo permite (si no, mostramos CTA en UI y NO llamamos API)
    if (tab === "seller" && canSell && sellerItems.length === 0) loadSeller("reset");

    // referrals ya lo manejas aparte
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canSell]);

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

  async function loadSeller(mode: "reset" | "more") {
    try {
      setError(null);
      setSellerLoading(true);

      const nextOffset = mode === "reset" ? 0 : sellerOffset;
      const res = await getSellerListings({ limit: 12, offset: nextOffset });

      setSellerItems((prev) => (mode === "reset" ? res.items : [...prev, ...res.items]));
      setSellerOffset(res.nextOffset);
      setSellerHasMore(res.hasMore);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar listings.");
    } finally {
      setSellerLoading(false);
    }
  }

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <div className="text-2xl font-bold">My Trades</div>
          <div className="text-white/60 text-sm mt-1">Compras · Ventas · Referidos</div>
        </div>

        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
          onClick={() => onNavigate(AppRoute.COMMUNITY_STORE)}
        >
          Ir a Community Store
        </button>
      </div>

    {wallet ? (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-white/70">Wallet</div>
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

        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl bg-black/40 border border-white/10 p-3">
            <div className="text-white/60 text-xs">Créditos</div>
            <div className="text-xl font-bold">{wallet.generationCredits}</div>
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
            <div className="text-xl font-bold mt-1">{wallet.earnings_pending_credits}</div>
            <div className="text-[11px] text-white/50 mt-1">No disponibles aún.</div>
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
            <div className="text-xl font-bold mt-1">{wallet.earnings_matured_credits}</div>
            <div className="text-[11px] text-white/50 mt-1">
              {canManageEarnings ? "Click para transferir o cash out." : "Bloqueados hasta volver a Pro o superior."}
            </div>
          </div>
        </div>

        {!canManageEarnings ? (
          <div className="mt-3 text-[12px] text-amber-200/90">
            {earningsGateText}
          </div>
        ) : null}

        {/* Cashouts list */}
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
                      <td className="py-2 pr-3">
                        <span className="px-2 py-1 rounded-lg bg-white/10">{c.status}</span>
                      </td>
                      <td className="py-2 pr-3 text-white/80">{c.amountCredits}</td>
                      <td className="py-2 pr-3 text-white/80">
                        {(() => {
                          const v = (Number(c.netUsdMicros || 0) || 0) / 1_000_000;
                          return `$${v.toFixed(2)}`;
                        })()}
                      </td>
                      <td className="py-2 pr-3 text-white/60">
                        {c?.payoutMethod?.kind ? String(c.payoutMethod.kind) : "—"}
                      </td>
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

      <div className="flex gap-2 mb-4">
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
          Seller
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded-lg border border-white/10 ${tab === "referrals" ? "bg-white text-black" : "bg-black/30 text-white"}`}
          onClick={() => setTab("referrals")}
        >
          Referrals
        </button>
      </div>

      {error ? <div className="text-red-400 mb-4">{error}</div> : null}

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
                    {it.previewUrl ? (
                      <img src={it.previewUrl} className="w-full h-full object-cover" />
                    ) : null}
                  </div>

                  <div className="flex-1">
                    <div className="text-sm font-semibold">{it.sellerUsername}</div>
                    <div className="text-xs text-white/60 mt-1 line-clamp-2">{it.listingDescription}</div>
                    <div className="text-xs text-white/60 mt-2">
                      Pagaste <b className="text-white">{it.paidCredits}</b> credits · Price {it.listingPriceCredits}
                    </div>
                    <div className="text-[11px] text-white/50 mt-1">
                      {new Date(it.createdAt).toLocaleString()}
                    </div>
                    <div className="text-[11px] mt-1">
                      {it.isMatured ? (
                        <span className="text-green-300">Matured</span>
                      ) : (
                        <span className="text-yellow-300">Pending until {new Date(it.maturesAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {buyerHasMore ? (
            <button
              type="button"
              className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
              onClick={() => loadBuyer("more")}
              disabled={buyerLoading}
            >
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
            <button
              type="button"
              className="mt-4 px-4 py-2 rounded-lg bg-white text-black font-semibold"
              onClick={() => onNavigate(AppRoute.PROFILE)}
            >
              Ir a Perfil y Créditos
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm font-semibold mb-3">Tus listings</div>

            {sellerLoading && sellerItems.length === 0 ? (
              <div className="text-white/60">Cargando...</div>
            ) : sellerItems.length === 0 ? (
              <div className="text-white/60">Aún no has publicado listings.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sellerItems.map((it) => (
                  <div key={it.id} className="rounded-xl border border-white/10 bg-black/40 p-3 flex gap-3">
                    <div className="w-20 h-20 rounded-lg overflow-hidden border border-white/10 bg-black/50 shrink-0">
                      {it.previewUrl ? <img src={it.previewUrl} className="w-full h-full object-cover" /> : null}
                    </div>

                    <div className="flex-1">
                      <div className="text-sm font-semibold">Status: {it.status}</div>
                      <div className="text-xs text-white/60 mt-1 line-clamp-2">{it.description}</div>
                      <div className="text-xs text-white/60 mt-2">
                        Price <b className="text-white">{it.priceCredits}</b> · Sales {it.salesCount} · Likes {it.likesCount}
                      </div>
                      <div className="text-[11px] text-white/50 mt-1">
                        {new Date(it.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sellerHasMore ? (
              <button
                type="button"
                className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
                onClick={() => loadSeller("more")}
                disabled={sellerLoading}
              >
                {sellerLoading ? "Cargando..." : "Cargar más"}
              </button>
            ) : null}
          </div>
        )
      ) : null}

      {tab === "referrals" ? (
        !canReferrals ? (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm font-semibold mb-2">Desbloquea Referidos/Afiliados</div>
            <div className="text-white/70 text-sm">{referralGateText}</div>
            <button
              type="button"
              className="mt-4 px-4 py-2 rounded-lg bg-white text-black font-semibold"
              onClick={() => onNavigate(AppRoute.PROFILE)}
            >
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
                          <div className="text-xs text-white/60 mt-2">
                            Buyer BONUS: {c.buyerDiscountPct}% · Reward: {c.refRewardPct}%
                          </div>
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
                          <div className="text-sm font-semibold">
                            {r.referredUsername || "(sin username)"} · {r.planSlug || "-"}
                          </div>
                          <div className="text-xs text-white/60 mt-1">
                            Reward: <b className="text-white/80">{r.referrerRewardCredits}</b> · Buyer bonus:{" "}
                            <b className="text-white/80">{r.buyerBonusCredits}</b>
                          </div>
                          <div className="text-[11px] text-white/50 mt-1">{new Date(r.createdAt).toLocaleString()}</div>
                          <div className="text-[11px] mt-1">
                            {r.isMatured ? (
                              <span className="text-green-300">Matured</span>
                            ) : (
                              <span className="text-yellow-300">
                                Pending until {new Date(r.maturesAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-white/60">
                      Aún no tienes actividad de referidos. Comparte tus códigos y cuando alguien compre un plan con tu código,
                      aparecerá aquí.
                    </div>
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
