import React, { useEffect, useState } from "react";
import { AppRoute } from "../types";
import { getMyWallet } from "../services/walletApi";
import { getMyReferralCodes } from "../services/referralsApi";
import { getBuyerPurchases, getSellerListings } from "../services/tradesApi";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

export default function MyTrades({ onNavigate }: Props) {
  const [tab, setTab] = useState<"buyer" | "seller" | "referrals">("buyer");
  const [wallet, setWallet] = useState<any | null>(null);
  const [codes, setCodes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        const w = await getMyWallet();
        setWallet(w);
      } catch (e: any) {
        setError(e?.message || "No se pudo cargar wallet.");
      }
    })();
  }, []);

  useEffect(() => {
    if (tab !== "referrals") return;

    (async () => {
      try {
        const c = await getMyReferralCodes();
        setCodes(c);
      } catch (e: any) {
        setError(e?.message || "No se pudieron cargar tus códigos.");
      }
    })();
  }, [tab]);

  useEffect(() => {
    if (tab === "buyer" && buyerItems.length === 0) loadBuyer("reset");
    if (tab === "seller" && sellerItems.length === 0) loadSeller("reset");
    // referrals ya lo manejas aparte
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
      ) : null}

      {tab === "referrals" ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold mb-2">Tus 3 códigos</div>
          {codes.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {codes.map((c) => (
                <div key={c.id} className="rounded-xl bg-black/40 border border-white/10 p-3">
                  <div className="text-xs text-white/60">Código {c.variant}</div>
                  <div className="text-sm font-mono mt-1">{c.code}</div>
                  <div className="text-xs text-white/60 mt-2">
                    Buyer OFF: {c.buyerDiscountPct}% · Reward: {c.refRewardPct}%
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-white/70">Cargando códigos...</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
