import React from "react";

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

      <div className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-[#0b0b0b] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-extrabold text-white tracking-tight">
              Desbloquea la Generación IA
            </div>
            <div className="text-sm text-white/60 mt-2">
              {message || "Para comenzar a generar imágenes y video, necesitas activar un plan."}
            </div>
          </div>

          <button
            className="text-white/70 hover:text-white text-sm"
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm font-semibold text-white">¿Qué obtienes con un plan?</div>
          <ul className="mt-3 space-y-2 text-sm text-white/70 list-disc pl-5">
            <li>Acceso a generación (imagen y video) desde tus herramientas.</li>
            <li>Créditos incluidos y control de consumo por wallet.</li>
            <li>Acceso a funciones premium según el plan.</li>
          </ul>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            className="flex-1 px-4 py-3 rounded-xl bg-white text-black font-bold hover:scale-[1.01] transition"
            onClick={onGoPlans}
          >
            Ir a Perfil y Créditos
          </button>

          <button
            type="button"
            className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white"
            onClick={onClose}
          >
            Seguir explorando
          </button>
        </div>

        <div className="absolute inset-0 rounded-3xl pointer-events-none border border-white/5" />
      </div>
    </div>
  );
}