import React, { useEffect, useMemo, useState } from "react";
import { Coins, X } from "lucide-react";
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

      <div className="relative w-full max-w-2xl">
        <div className="rounded-[28px] bg-gradient-to-br from-white/20 via-white/5 to-transparent p-[1px] shadow-2xl">
          <div className="relative rounded-[28px] border border-white/10 bg-[#0b0b0b] p-6">
            <button
              className="absolute right-4 top-4 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-white/75 hover:text-white hover:bg-white/10"
              onClick={onClose}
              type="button"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3">
                <Coins className="w-5 h-5 text-[#DFB142]" />
              </span>
              <div className="min-w-0">
                <div className="text-2xl font-extrabold text-white tracking-tight">Créditos insuficientes</div>
                <div className="text-sm text-white/60 mt-1">Te faltan créditos para completar esta acción.</div>
              </div>
            </div>

            {details ? (
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-xs text-white/60">Necesitas</div>
                  <div className="text-lg font-bold text-white mt-1">{details.need}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-xs text-white/60">Tienes</div>
                  <div className="text-lg font-bold text-white mt-1">{details.have}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-xs text-white/60">Faltan</div>
                  <div className="text-lg font-bold text-white mt-1">{details.deficit}</div>
                </div>
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="text-sm font-semibold text-white">Recomendación</div>
              {loading ? (
                <div className="text-white/60 text-sm mt-2">Buscando packs…</div>
              ) : suggestion ? (
                <div className="text-white/70 text-sm mt-2">
                  Compra <b className="text-white">{suggestion.name}</b> ({suggestion.credits_amount} créditos) para cubrir el déficit.
                </div>
              ) : (
                <div className="text-white/60 text-sm mt-2">Ve a tu perfil para comprar créditos extra o cambiar de plan.</div>
              )}
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-r from-[#DFB142] to-[#F5E18A] text-black font-extrabold hover:brightness-105"
                onClick={onGoProfile}
              >
                Comprar créditos / Upgrade
              </button>

              <button
                type="button"
                className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white"
                onClick={onClose}
              >
                Ahora no
              </button>
            </div>

            <div className="mt-3 text-[11px] text-white/45">
              Si acabas de comprar créditos, espera unos segundos y vuelve a intentar (a veces tarda en reflejarse).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}