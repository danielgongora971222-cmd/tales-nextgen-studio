import React from "react";
import { BadgeCheck, CircleDollarSign, Coins, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";

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
    ? "from-emerald-300 via-lime-200 to-[#F5E18A]"
    : isError
      ? "from-rose-300 via-orange-200 to-amber-200"
      : phase === "notice"
        ? "from-amber-200 via-[#F5E18A] to-yellow-200"
        : "from-[#F5E18A] via-emerald-200 to-cyan-200";

  const accentText = isSuccess
    ? "text-emerald-100"
    : isError
      ? "text-rose-100"
      : phase === "notice"
        ? "text-amber-100"
        : "text-sky-100";

  const chipLabel = mode === "payment" ? "Extra credits" : mode === "subscription" ? "Membership" : "Stripe Checkout";

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6">
      <style>{`
        @keyframes billingCoinFloat {
          0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: .18; }
          50% { transform: translate3d(0, -12px, 0) rotate(8deg) scale(1.06); opacity: .6; }
          100% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: .18; }
        }
        @keyframes billingCoinOrbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes billingPulse {
          0%,100% { transform: scale(.96); opacity: .32; }
          50% { transform: scale(1.04); opacity: .78; }
        }
        @keyframes billingShimmer {
          0% { transform: translateX(-145%) skewX(-18deg); opacity: 0; }
          20% { opacity: .24; }
          100% { transform: translateX(145%) skewX(-18deg); opacity: 0; }
        }
        @keyframes billingBar {
          0% { transform: translateX(-82%); }
          50% { transform: translateX(4%); }
          100% { transform: translateX(88%); }
        }
        @keyframes billingBillDrift {
          0% { transform: translate3d(0, 0, 0) rotate(-8deg); opacity: 0; }
          20% { opacity: .85; }
          100% { transform: translate3d(0, 40px, 0) rotate(10deg); opacity: 0; }
        }
      `}</style>

      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,225,138,0.10),transparent_35%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.10),transparent_30%)]" />

      <div className="relative w-full max-w-[360px] overflow-hidden rounded-[28px] border border-white/10 bg-[#070707]/95 shadow-[0_30px_120px_rgba(0,0,0,0.72)] sm:max-w-[390px]">
        <div className={`absolute inset-x-[-30%] top-[-34%] h-[52%] rounded-full bg-gradient-to-r ${accent} opacity-25 blur-3xl`} />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.01)_38%,rgba(255,255,255,0.03))]" />
        <div className="absolute inset-0 overflow-hidden rounded-[28px]">
          <div className="absolute inset-y-0 -left-[44%] w-[42%] bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ animation: "billingShimmer 3.4s ease-in-out infinite" }} />
          <div className="absolute left-[11%] top-[17%] h-8 w-8 rounded-full border border-[#F5E18A]/25 bg-[#0b0b0b]/85 text-[#F5E18A] grid place-items-center" style={{ animation: "billingCoinFloat 4.4s ease-in-out infinite" }}>
            <CircleDollarSign className="h-4 w-4" />
          </div>
          <div className="absolute right-[12%] top-[15%] h-8 w-8 rounded-full border border-emerald-300/25 bg-[#0b0b0b]/85 text-emerald-200 grid place-items-center" style={{ animation: "billingCoinFloat 5s ease-in-out infinite", animationDelay: "-1s" }}>
            <Coins className="h-4 w-4" />
          </div>
          {isConfirming ? (
            <>
              <div className="absolute left-[18%] top-[24%] rounded-lg border border-emerald-300/20 bg-emerald-200/8 px-2 py-1 text-[9px] font-bold tracking-[0.18em] text-emerald-100" style={{ animation: "billingBillDrift 2.8s linear infinite" }}>
                USD
              </div>
              <div className="absolute right-[20%] top-[26%] rounded-lg border border-[#F5E18A]/20 bg-[#F5E18A]/8 px-2 py-1 text-[9px] font-bold tracking-[0.18em] text-[#F8EDB3]" style={{ animation: "billingBillDrift 3s linear infinite", animationDelay: "-1.2s" }}>
                PAID
              </div>
            </>
          ) : null}
        </div>

        <div className="relative z-10 px-5 pb-5 pt-6 sm:px-6 sm:pb-6 sm:pt-7">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-4 grid h-[112px] w-[112px] place-items-center sm:h-[124px] sm:w-[124px]">
              <div className={`absolute inset-0 rounded-full bg-gradient-to-r ${accent} blur-2xl opacity-25`} style={{ animation: "billingPulse 3s ease-in-out infinite" }} />
              <div className="absolute inset-[8px] rounded-full border border-white/10" style={{ animation: "billingCoinOrbit 14s linear infinite" }} />
              <div className="absolute inset-[18px] rounded-full border border-white/10 border-dashed" style={{ animation: "billingCoinOrbit 18s linear infinite reverse" }} />
              <div className="absolute inset-[24px] rounded-full border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_45%),linear-gradient(180deg,rgba(14,14,14,0.98),rgba(7,7,7,0.98))] shadow-[inset_0_1px_1px_rgba(255,255,255,0.16),0_14px_44px_rgba(0,0,0,0.45)]" />
              <div className={`relative grid h-[62px] w-[62px] place-items-center rounded-full bg-gradient-to-br ${accent} text-[#070707] shadow-[0_16px_36px_rgba(0,0,0,0.34)]`}>
                {isConfirming ? (
                  <LoaderCircle className="h-7 w-7 animate-spin" />
                ) : isSuccess ? (
                  <BadgeCheck className="h-7 w-7" />
                ) : isError ? (
                  <TriangleAlert className="h-7 w-7" />
                ) : (
                  <ShieldCheck className="h-7 w-7" />
                )}
              </div>
            </div>

            <div className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] ${accentText}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              <span>{chipLabel}</span>
            </div>

            <h2 className="mt-4 text-[1.2rem] font-black tracking-tight text-white sm:text-[1.35rem]">
              {title}
            </h2>
            <p className="mt-2 max-w-[290px] text-[13px] leading-6 text-white/68 sm:max-w-[310px] sm:text-[14px]">
              {message}
            </p>
          </div>

          {isConfirming ? (
            <div className="mt-5">
              <div className="overflow-hidden rounded-full border border-white/10 bg-white/6 p-1">
                <div className="relative h-2.5 overflow-hidden rounded-full bg-black/35">
                  <div className={`absolute inset-y-0 left-0 w-[44%] rounded-full bg-gradient-to-r ${accent}`} style={{ animation: "billingBar 2s ease-in-out infinite" }} />
                </div>
              </div>
              <div className="mt-3 text-center text-[11px] text-white/42">
                Un momento. Estamos aplicando los cambios.
              </div>
            </div>
          ) : (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!busy) onAction?.();
                }}
                className={`inline-flex min-h-[40px] items-center justify-center rounded-full border border-white/10 bg-gradient-to-r ${accent} px-5 py-2.5 text-sm font-black text-[#060606] shadow-[0_16px_36px_rgba(0,0,0,0.24)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60`}
              >
                {busy ? "Aplicando..." : actionLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
