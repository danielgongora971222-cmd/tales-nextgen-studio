import React, { useEffect, useState } from "react";
import { AppRoute } from "../types";
import { getMyWallet } from "../services/walletApi";
import { getMyReferralCodes } from "../services/referralsApi";

interface Props {
  onNavigate: (route: AppRoute) => void;
}

export default function MyTrades({ onNavigate }: Props) {
  const [tab, setTab] = useState<"buyer" | "seller" | "referrals">("buyer");
  const [wallet, setWallet] = useState<any | null>(null);
  const [codes, setCodes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

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
              <div className="text-xl font-bold">{wallet.earningsPendingCredits}</div>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/10 p-3">
              <div className="text-white/60 text-xs">Earnings (matured)</div>
              <div className="text-xl font-bold">{wallet.earningsMaturedCredits}</div>
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
        <div className="text-white/70">Buyer: aquí (en el siguiente paso) conectamos el endpoint /api/trades/buyer/purchases.</div>
      ) : null}

      {tab === "seller" ? (
        <div className="text-white/70">Seller: aquí (en el siguiente paso) conectamos /api/trades/seller/listings.</div>
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
