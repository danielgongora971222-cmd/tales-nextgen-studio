import React from "react";
import { BadgeCheck, CircleDollarSign, Coins, LoaderCircle, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

type Phase = "confirming" | "success" | "notice" | "error";

export default function StripeCheckoutStatusModal({
  open,
  phase,
  title,
  message,
  mode = null,
  busy = false,
  actionLabel = "OK",
  onAction,
}: {
  open: boolean;
  phase: Phase;
  title: string;
  message: string;
  mode?: "subscription" | "payment" | null;
  busy?: boolean;
  actionLabel?: string;
  onAction?: () => Promise<void> | void;
}) {
  if (!open) return null;

  const isConfirming = phase === "confirming";
  const isSuccess = phase === "success";
  const isError = phase === "error";
  const accent = isSuccess
    ? "from-emerald-300 via-[#F5E18A] to-emerald-500"
    : isError
      ? "from-rose-300 via-amber-200 to-orange-400"
      : phase === "notice"
        ? "from-amber-200 via-[#F5E18A] to-yellow-400"
        : "from-sky-300 via-[#F5E18A] to-cyan-400";

  const chipLabel = mode === "payment" ? "Extra credits" : mode === "subscription" ? "Membership" : "Stripe Checkout";

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6">
      <style>{`
        @keyframes stripeMoneyFloat {
          0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: 0.55; }
          50% { transform: translate3d(0, -10px, 0) rotate(6deg) scale(1.08); opacity: 1; }
          100% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: 0.55; }
        }
        @keyframes stripeMoneyOrbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes stripeMoneyPulse {
          0%, 100% { transform: scale(0.94); opacity: 0.45; }
          50% { transform: scale(1.06); opacity: 0.9; }
        }
        @keyframes stripeMoneySweep {
          0% { transform: translateX(-130%) skewX(-18deg); opacity: 0; }
          20% { opacity: 0.32; }
          100% { transform: translateX(130%) skewX(-18deg); opacity: 0; }
        }
        @keyframes stripeMoneyProgress {
          0% { transform: translateX(-75%); }
          50% { transform: translateX(15%); }
          100% { transform: translateX(85%); }
        }
      `}</style>

      <div className="absolute inset-0 bg-[#030303]/85 backdrop-blur-xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,225,138,0.12),transparent_40%),radial-gradient(circle_at_bottom,rgba(56,189,248,0.10),transparent_34%)]" />

      <div className="relative w-full max-w-[720px] overflow-hidden rounded-[34px] border border-white/10 bg-[#080808]/95 shadow-[0_40px_120px_rgba(0,0,0,0.65)]">
        <div className={`absolute inset-x-[-30%] top-[-38%] h-[62%] rounded-full bg-gradient-to-r ${accent} blur-3xl opacity-25`} />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(255,255,255,0.01)_42%,rgba(255,255,255,0.03))]" />
        <div className="absolute inset-0 overflow-hidden rounded-[34px]">
          <div className="absolute inset-y-0 -left-[30%] w-[30%] bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ animation: "stripeMoneySweep 3.2s ease-in-out infinite" }} />
          <div className="absolute left-[10%] top-[18%] grid h-12 w-12 place-items-center rounded-full border border-[#F5E18A]/30 bg-[#0b0b0b]/85 text-[#F5E18A] shadow-[0_0_24px_rgba(245,225,138,0.18)]" style={{ animation: "stripeMoneyFloat 4.6s ease-in-out infinite" }}>
            <CircleDollarSign className="h-5 w-5" />
          </div>
          <div className="absolute right-[12%] top-[20%] grid h-11 w-11 place-items-center rounded-full border border-emerald-300/25 bg-[#0b0b0b]/85 text-emerald-200 shadow-[0_0_24px_rgba(16,185,129,0.18)]" style={{ animation: "stripeMoneyFloat 5.2s ease-in-out infinite", animationDelay: "-1.2s" }}>
            <Coins className="h-5 w-5" />
          </div>
          <div className="absolute bottom-[18%] left-[16%] rounded-full border border-sky-300/25 bg-[#0b0b0b]/80 px-3 py-1 text-[11px] font-extrabold tracking-[0.22em] text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.18)]" style={{ animation: "stripeMoneyFloat 4.9s ease-in-out infinite", animationDelay: "-2.2s" }}>
            USD
          </div>
          <div className="absolute bottom-[16%] right-[16%] rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-extrabold tracking-[0.22em] text-white/75" style={{ animation: "stripeMoneyFloat 5.4s ease-in-out infinite", animationDelay: "-0.8s" }}>
            SECURE
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-6 px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex flex-col items-center text-center">
            <div className="relative grid h-[154px] w-[154px] place-items-center">
              <div className={`absolute inset-0 rounded-full bg-gradient-to-r ${accent} opacity-30 blur-2xl`} style={{ animation: "stripeMoneyPulse 3.2s ease-in-out infinite" }} />
              <div className="absolute inset-[8px] rounded-full border border-white/10" style={{ animation: "stripeMoneyOrbit 12s linear infinite" }} />
              <div className="absolute inset-[18px] rounded-full border border-white/10 border-dashed" style={{ animation: "stripeMoneyOrbit 18s linear infinite reverse" }} />
              <div className="absolute inset-[28px] rounded-full border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_48%),linear-gradient(180deg,rgba(16,16,16,0.95),rgba(8,8,8,0.98))] shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_20px_80px_rgba(0,0,0,0.42)]" />
              <div className={`relative grid h-[82px] w-[82px] place-items-center rounded-full border border-white/10 bg-gradient-to-br ${accent} text-[#050505] shadow-[0_18px_40px_rgba(0,0,0,0.38)]`}>
                {isConfirming ? (
                  <LoaderCircle className="h-10 w-10 animate-spin" />
                ) : isSuccess ? (
                  <BadgeCheck className="h-10 w-10" />
                ) : isError ? (
                  <TriangleAlert className="h-10 w-10" />
                ) : (
                  <ShieldCheck className="h-10 w-10" />
                )}
              </div>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.24em] text-white/72">
              <Sparkles className="h-3.5 w-3.5 text-[#F5E18A]" />
              <span>{chipLabel}</span>
            </div>

            <h2 className="mt-5 max-w-[560px] text-2xl font-black tracking-tight text-white sm:text-[2rem]">
              {title}
            </h2>
            <p className="mt-3 max-w-[560px] text-sm leading-6 text-white/66 sm:text-[15px]">
              {message}
            </p>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left">
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/45">Estado</div>
                <div className="mt-2 text-sm font-bold text-white">
                  {isConfirming ? "Confirmando" : isSuccess ? "Aplicado" : isError ? "Necesita revisión" : "Procesado"}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left">
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/45">Motor</div>
                <div className="mt-2 text-sm font-bold text-white">Stripe + Supabase</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left">
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/45">Seguridad</div>
                <div className="mt-2 text-sm font-bold text-white">Sincronización protegida</div>
              </div>
            </div>

            {isConfirming ? (
              <div className="mt-4 overflow-hidden rounded-full border border-white/10 bg-white/5 p-1">
                <div className="relative h-3 overflow-hidden rounded-full bg-black/30">
                  <div className={`absolute inset-y-0 left-0 w-[46%] rounded-full bg-gradient-to-r ${accent}`} style={{ animation: "stripeMoneyProgress 2.1s ease-in-out infinite" }} />
                </div>
              </div>
            ) : null}
          </div>

          {!isConfirming ? (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!busy) onAction?.();
                }}
                className={`min-w-[180px] rounded-2xl border border-white/10 bg-gradient-to-r ${accent} px-6 py-3 text-sm font-black text-[#050505] shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60`}
              >
                {busy ? "Aplicando..." : actionLabel}
              </button>
            </div>
          ) : (
            <div className="text-center text-[12px] text-white/46">
              No cierres esta ventana. Estamos validando el pago y sincronizando los cambios de tu cuenta.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
