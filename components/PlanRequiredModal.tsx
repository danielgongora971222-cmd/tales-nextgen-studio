import React from "react";
import { Sparkles, X } from "lucide-react";

export default function PlanRequiredModal({
  open,
  message,
  onClose,
  onGoPlans,
}: {
  open: boolean;
  message?: string | null;
  onClose: () => void;
  onGoPlans: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

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
                <Sparkles className="w-5 h-5 text-[#DFB142]" />
              </span>
              <div className="min-w-0">
                <div className="text-2xl font-extrabold text-white tracking-tight">Plan requerido</div>
                <div className="text-sm text-white/60 mt-1">
                  {message || "Para comenzar a generar imágenes y video, necesitas activar un plan."}
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/60">Generación</div>
                <div className="text-sm text-white mt-1 font-semibold">Imagen y video</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/60">Wallet</div>
                <div className="text-sm text-white mt-1 font-semibold">Créditos y control</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/60">Premium</div>
                <div className="text-sm text-white mt-1 font-semibold">Herramientas pro</div>
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-r from-[#DFB142] to-[#F5E18A] text-black font-extrabold hover:brightness-105"
                onClick={onGoPlans}
              >
                Ver planes y activar
              </button>

              <button
                type="button"
                className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white"
                onClick={onClose}
              >
                Seguir explorando
              </button>
            </div>

            <div className="mt-3 text-[11px] text-white/45">
              Si ya tienes un plan activo y ves esto, cierra y vuelve a intentar (a veces tarda unos segundos en sincronizar).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}