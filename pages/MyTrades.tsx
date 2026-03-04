import React, { useEffect, useMemo, useState } from "react";
import { AppRoute } from "../types";
import { getWalletMe } from "../services/walletApi";
import { getMyReferralCodes, getMyReferralSummary } from "../services/referralsApi";
import { getBuyerPurchases, getSellerListings } from "../services/tradesApi";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

export default function MyTrades({ onNavigate }: Props) {
  const [tab, setTab] = useState<"buyer" | "seller" | "referrals">("buyer");
  const [wallet, setWallet] = useState<any | null>(null);
  const [subscription, setSubscription] = useState<any | null>(null);

  const [codes, setCodes] = useState<any[]>([]);
  const [refSummary, setRefSummary] = useState<any | null>(null);
  const [refLoading, setRefLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const canSell = !!subscription?.can_sell;
  const canReferrals = !!subscription?.can_referrals;

  const referralGateText = useMemo(() => {
    if (!subscription) {
      return "Para obtener tus códigos de Referidos/Afiliados necesitas un plan activo (Partner o superior).";
    }
    return "Tu plan actual no incluye Referidos/Afiliados. Sube a Partner o superior para desbloquear códigos y comisiones.";
  }, [subscription]);

  const sellerGateText = useMemo(() => {
    if (!subscription) {
      return "Para vender en Community Store necesitas un plan activo con permiso de Seller.";
    }
    return "Tu plan actual no incluye Seller. Sube a un plan superior para publicar y vender.";
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
      } catch (e: any) {
        setError(e?.message || "No se pudo cargar wallet.");
      }
    })();
  }, []);

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
          <div className="text-sm text-white/70">Wallet</div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl bg-black/40 border border-white/10 p-3">
              <div className="text-white/60 text-xs">Créditos</div>
              <div className="text-xl font-bold">{wallet.generationCredits}</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/10 p-3">
              <div className="text-white/60 text-xs">Earnings (pending)</div>
              <div className="text-xl font-bold">{wallet.earnings_pending_credits}</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/10 p-3">
              <div className="text-white/60 text-xs">Earnings (matured)</div>
              <div className="text-xl font-bold">{wallet.earnings_matured_credits}</div>
            </div>
          </div>
        </div>
      ) : null}

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
              onClick={() => onNavigate(AppRoute.PAYWALL)}
            >
              Upgrade plan
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
              onClick={() => onNavigate(AppRoute.PAYWALL)}
            >
              Upgrade plan
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
