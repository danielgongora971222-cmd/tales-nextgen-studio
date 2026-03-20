import React from "react";
import { BadgeCheck, CircleDollarSign, Coins, LoaderCircle, TriangleAlert } from "lucide-react";

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
      ? "from-rose-300 via-orange-200 to-amber-400"
      : phase === "notice"
        ? "from-amber-200 via-[#F5E18A] to-yellow-400"
        : "from-sky-300 via-[#F5E18A] to-cyan-400";

  const chipLabel = mode === "payment" ? "Extra credits" : mode === "subscription" ? "Upgrade / Plan" : "Stripe Checkout";

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6">
      <style>{`
        @keyframes talesMoneyFloat {
          0%, 100% { transform: translateY(0) scale(1); opacity: .55; }
          50% { transform: translateY(-8px) scale(1.08); opacity: 1; }
        }
        @keyframes talesMoneyRing {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes talesMoneyPulse {
          0%,100% { transform: scale(.96); opacity: .38; }
          50% { transform: scale(1.05); opacity: .9; }
        }
        @keyframes talesMoneyShine {
          0% { transform: translateX(-140%) skewX(-18deg); opacity: 0; }
          30% { opacity: .22; }
          100% { transform: translateX(140%) skewX(-18deg); opacity: 0; }
        }
        @keyframes talesMoneyProgress {
          0% { transform: translateX(-72%); }
          50% { transform: translateX(12%); }
          100% { transform: translateX(86%); }
        }
      `}</style>

      <div className="absolute inset-0 bg-black/82 backdrop-blur-md" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,225,138,0.12),transparent_42%),radial-gradient(circle_at_bottom,rgba(34,197,94,0.10),transparent_34%)]" />

      <div className="relative w-full max-w-[520px] overflow-hidden rounded-[30px] border border-white/10 bg-[#090909]/95 shadow-[0_30px_90px_rgba(0,0,0,0.6)] sm:max-w-[560px]">
        <div className={`absolute inset-x-[-15%] top-[-30%] h-[48%] rounded-full bg-gradient-to-r ${accent} opacity-25 blur-3xl`} />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02)_44%,rgba(255,255,255,0.04))]" />
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-y-0 -left-[30%] w-[28%] bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ animation: "talesMoneyShine 3.4s ease-in-out infinite" }} />
          <div className="absolute left-[10%] top-[18%] grid h-10 w-10 place-items-center rounded-full border border-[#F5E18A]/30 bg-[#0b0b0b]/88 text-[#F5E18A] sm:h-12 sm:w-12" style={{ animation: "talesMoneyFloat 4.6s ease-in-out infinite" }}>
            <CircleDollarSign className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="absolute right-[10%] top-[22%] grid h-9 w-9 place-items-center rounded-full border border-emerald-300/25 bg-[#0b0b0b]/88 text-emerald-200 sm:h-11 sm:w-11" style={{ animation: "talesMoneyFloat 5.1s ease-in-out infinite", animationDelay: "-1.1s" }}>
            <Coins className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>

        <div className="relative z-10 px-5 py-6 sm:px-7 sm:py-7">
          <div className="mx-auto flex max-w-[420px] flex-col items-center text-center">
            <div className="relative grid h-[118px] w-[118px] place-items-center sm:h-[132px] sm:w-[132px]">
              <div className={`absolute inset-0 rounded-full bg-gradient-to-r ${accent} blur-2xl opacity-30`} style={{ animation: "talesMoneyPulse 3s ease-in-out infinite" }} />
              <div className="absolute inset-[10px] rounded-full border border-white/10" style={{ animation: "talesMoneyRing 10s linear infinite" }} />
              <div className="absolute inset-[21px] rounded-full border border-white/10 border-dashed" style={{ animation: "talesMoneyRing 15s linear infinite reverse" }} />
              <div className="absolute inset-[30px] rounded-full border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_48%),linear-gradient(180deg,rgba(16,16,16,0.96),rgba(8,8,8,0.98))] shadow-[inset_0_1px_1px_rgba(255,255,255,0.16),0_18px_50px_rgba(0,0,0,0.32)]" />
              <div className={`relative grid h-[62px] w-[62px] place-items-center rounded-full border border-white/10 bg-gradient-to-br ${accent} text-[#050505] shadow-[0_14px_32px_rgba(0,0,0,0.36)] sm:h-[72px] sm:w-[72px]`}>
                {isConfirming ? (
                  <LoaderCircle className="h-7 w-7 animate-spin sm:h-8 sm:w-8" />
                ) : isSuccess ? (
                  <BadgeCheck className="h-7 w-7 sm:h-8 sm:w-8" />
                ) : isError ? (
                  <TriangleAlert className="h-7 w-7 sm:h-8 sm:w-8" />
                ) : (
                  <CircleDollarSign className="h-7 w-7 sm:h-8 sm:w-8" />
                )}
              </div>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.22em] text-white/72 sm:px-4">
              <span className="h-1.5 w-1.5 rounded-full bg-[#F5E18A]" />
              <span>{chipLabel}</span>
            </div>

            <h2 className="mt-4 text-xl font-black tracking-tight text-white sm:text-[1.7rem]">{title}</h2>
            <p className="mt-2 max-w-[360px] text-sm leading-6 text-white/68 sm:max-w-[420px] sm:text-[14px]">{message}</p>
          </div>

          <div className="mx-auto mt-5 max-w-[420px] rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] sm:p-5">
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/42">Estado</div>
                <div className="mt-1.5 text-sm font-bold text-white">{isConfirming ? "Confirmando" : isSuccess ? "Aplicado" : isError ? "Revisar" : "Procesado"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/42">Seguridad</div>
                <div className="mt-1.5 text-sm font-bold text-white">Stripe + Sync</div>
              </div>
            </div>

            {isConfirming ? (
              <div className="mt-4 overflow-hidden rounded-full border border-white/10 bg-white/5 p-1">
                <div className="relative h-2.5 overflow-hidden rounded-full bg-black/35">
                  <div className={`absolute inset-y-0 left-0 w-[48%] rounded-full bg-gradient-to-r ${accent}`} style={{ animation: "talesMoneyProgress 1.9s ease-in-out infinite" }} />
                </div>
              </div>
            ) : null}
          </div>

          {!isConfirming ? (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!busy) onAction?.();
                }}
                className={`min-w-[118px] rounded-full border border-white/10 bg-gradient-to-r ${accent} px-5 py-2.5 text-sm font-black text-[#050505] shadow-[0_14px_30px_rgba(0,0,0,0.25)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60`}
              >
                {busy ? "Aplicando..." : actionLabel}
              </button>
            </div>
          ) : (
            <div className="mt-4 text-center text-[11px] text-white/45">No cierres esta ventana. Solo tomará unos segundos.</div>
          )}
        </div>
      </div>
    </div>
  );
}
