import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import { getWalletMe } from "../services/walletApi";
import { EVENT_WALLET_REFRESH } from "../services/appEvents";

type WalletCtx = {
  wallet: any | null;
  subscription: any | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<any | null>(null);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) {
      setWallet(null);
      setSubscription(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getWalletMe();
      setWallet(data.wallet);
      setSubscription(data.subscription || null);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar wallet.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener(EVENT_WALLET_REFRESH, handler as any);
    return () => window.removeEventListener(EVENT_WALLET_REFRESH, handler as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = useMemo(() => ({ wallet, subscription, loading, error, refresh }), [wallet, subscription, loading, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used within <WalletProvider>");
  return v;
}