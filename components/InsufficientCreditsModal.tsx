import React, { useEffect, useMemo, useState } from "react";
import { billingTopups } from "../services/billingApi";
import type { InsufficientCreditsDetail } from "../services/appEvents";

export default function InsufficientCreditsModal({
  open,
  details,
  onClose,
  onGoProfile,
}: {
  open: boolean;
  details: InsufficientCreditsDetail | null;
  onClose: () => void;
  onGoProfile: () => void;
}) {
  const deficit = details?.deficit || 0;

  const [topups, setTopups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        const t = await billingTopups();
        setTopups(t);
      } catch {
        setTopups([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const suggestion = useMemo(() => {
    if (!deficit || !topups.length) return null;
    const sorted = [...topups].sort((a, b) => (a.credits_amount || 0) - (b.credits_amount || 0));
    return sorted.find((t) => (t.credits_amount || 0) >= deficit) || sorted[sorted.length - 1];
  }, [deficit, topups]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b0b0b] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-bold text-white">Insufficient Credits</div>
            <div className="text-sm text-white/60 mt-1">Necesitas más créditos para completar esta acción.</div>
          </div>
          <button className="text-white/70 hover:text-white" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>

        {details ? (
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="text-xs text-white/60">Need</div>
              <div className="text-lg font-bold">{details.need}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="text-xs text-white/60">Have</div>
              <div className="text-lg font-bold">{details.have}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="text-xs text-white/60">Deficit</div>
              <div className="text-lg font-bold">{details.deficit}</div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold">Recomendación</div>
          {loading ? (
            <div className="text-white/60 text-sm mt-2">Buscando packs...</div>
          ) : suggestion ? (
            <div className="text-white/70 text-sm mt-2">
              Compra <b>{suggestion.name}</b> ({suggestion.credits_amount} credits) para cubrir el déficit.
            </div>
          ) : (
            <div className="text-white/60 text-sm mt-2">Ve a tu perfil para comprar créditos extra o cambiar de plan.</div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" className="flex-1 px-4 py-2 rounded-lg bg-white text-black font-semibold" onClick={onGoProfile}>
            Buy credits / Upgrade
          </button>
          <button type="button" className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15" onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}