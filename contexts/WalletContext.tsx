import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { getWalletMe } from "../services/walletApi";
import { EVENT_WALLET_REFRESH } from "../services/appEvents";

type WalletRefreshOptions = {
  silent?: boolean;
  syncStripe?: boolean;
  strictSync?: boolean;
};

type WalletCtx = {
  wallet: any | null;
  subscription: any | null;
  loading: boolean;
  error: string | null;
  refresh: (opts?: WalletRefreshOptions) => Promise<void>;
};

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<any | null>(null);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (opts?: WalletRefreshOptions) => {
    if (!user) {
      setWallet(null);
      setSubscription(null);
      setLoading(false);
      return;
    }

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const silent = opts?.silent === true;

    const run = (async () => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await getWalletMe({
          syncStripe: opts?.syncStripe === true,
          strictSync: opts?.strictSync === true,
        });
        setWallet(data.wallet);
        setSubscription(data.subscription || null);
      } catch (e: any) {
        setError(e?.message || "No se pudo cargar wallet.");
      } finally {
        if (!silent) setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = run;
    return run;
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      void refresh({ silent: true });
    };
    window.addEventListener(EVENT_WALLET_REFRESH, handler as any);
    return () => window.removeEventListener(EVENT_WALLET_REFRESH, handler as any);
  }, [refresh]);

  const value = useMemo(() => ({ wallet, subscription, loading, error, refresh }), [wallet, subscription, loading, error, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used within <WalletProvider>");
  return v;
}