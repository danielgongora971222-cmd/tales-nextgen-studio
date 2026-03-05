import React from "react";

type HistoryBucket = "pending" | "available";
type DisplayUnit = "credits" | "usd";

type HistoryItem = {
  id: string;
  entryType: string;
  bucket: HistoryBucket;
  amountCredits: number;
  sourceKind: "sale" | "referral" | "other";
  sourceLabel: string;
  sourceName: string | null;
  sourceCode: string | null;
  planSlug: string | null;
  referredUsername: string | null;
  createdAt: number | null;
  availableAt: number | null;
  ledgerCreatedAt: number | null;
};

function formatDateTime(value: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function creditsToUsd(credits: number, usdMicrosPerCredit: number) {
  return ((Number(credits) || 0) * (Number(usdMicrosPerCredit) || 0)) / 1_000_000;
}

function formatAmount(credits: number, unit: DisplayUnit, usdMicrosPerCredit: number) {
  if (unit === "usd") return `$${creditsToUsd(credits, usdMicrosPerCredit).toFixed(2)}`;
  return `${credits} credits`;
}

function formatSecondary(credits: number, unit: DisplayUnit, usdMicrosPerCredit: number) {
  if (unit === "usd") return `${credits} credits`;
  return `$${creditsToUsd(credits, usdMicrosPerCredit).toFixed(2)} ref.`;
}

export default function EarningsHistoryModal({
  open,
  bucket,
  items,
  loading,
  error,
  hasMore,
  displayUnit = "credits",
  usdMicrosPerCredit = 4990,
  feeBps = 3700,
  onClose,
  onLoadMore,
}: {
  open: boolean;
  bucket: HistoryBucket;
  items: HistoryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  displayUnit?: DisplayUnit;
  usdMicrosPerCredit?: number;
  feeBps?: number;
  onClose: () => void;
  onLoadMore: () => void;
}) {
  if (!open) return null;

  const title = bucket === "pending" ? "Pending earnings history" : "Available earnings history";
  const subtitle =
    bucket === "pending"
      ? "Cada registro muestra el origen del ingreso y la fecha exacta en la que se libera."
      : "Cada registro muestra el origen del ingreso y el momento en que quedó disponible.";

  return (
    <div className="fixed inset-0 z-[5100] bg-black/85 backdrop-blur-md p-4 flex items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(0,0,0,0.82))] shadow-[0_28px_90px_rgba(0,0,0,0.58)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 md:p-6 border-b border-white/10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-white/55">
              {bucket === "pending" ? "Pipeline" : "Confirmed ledger"}
            </div>
            <div className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">{title}</div>
            <div className="mt-2 text-sm text-white/60 max-w-2xl">{subtitle}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">Display: {displayUnit === "usd" ? "USD ref." : "Credits"}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">1 credit ≈ ${(usdMicrosPerCredit / 1_000_000).toFixed(4)}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">Cash-out fee {(feeBps / 100).toFixed(0)}%</span>
            </div>
          </div>

          <button type="button" className="px-4 py-2.5 rounded-2xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] text-sm" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="p-5 md:p-6 overflow-y-auto max-h-[calc(88vh-126px)] space-y-4">
          {loading && items.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-white/60">Cargando historial...</div>
          ) : error ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-red-200">{error}</div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-white/60">No hay movimientos registrados en este bucket todavía.</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="premium-hero-card p-4" style={{ ["--ph-accent" as any]: bucket === "pending" ? "rgba(244,197,66,0.50)" : "rgba(111,168,255,0.50)", ["--ph-accent2" as any]: "rgba(240,107,87,0.24)" }}>
                <div className="relative z-[1]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{item.sourceLabel}</div>
                      <div className="mt-1 text-xs text-white/60">
                        {item.sourceKind === "sale" ? "Revenue from creation sale" : item.sourceKind === "referral" ? "Revenue from referral" : "Ledger movement"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-sm font-semibold">
                        +{formatAmount(item.amountCredits, displayUnit, usdMicrosPerCredit)}
                      </div>
                      <div className="mt-1 text-[11px] text-white/45">{formatSecondary(item.amountCredits, displayUnit, usdMicrosPerCredit)}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Source</div>
                      <div className="mt-1 text-white/90">{item.sourceName || "—"}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Code / detail</div>
                      <div className="mt-1 text-white/90">{item.sourceCode || item.planSlug || "—"}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Entry date</div>
                      <div className="mt-1 text-white/90">{formatDateTime(item.createdAt)}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{bucket === "pending" ? "Available on" : "Available since"}</div>
                      <div className="mt-1 text-white/90">{formatDateTime(item.availableAt)}</div>
                    </div>
                  </div>

                  {item.referredUsername ? (
                    <div className="mt-3 text-xs text-white/60">
                      Referred user: <span className="text-white/85">{item.referredUsername}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}

          {items.length > 0 ? (
            <div className="pt-2 flex justify-center">
              {hasMore ? (
                <button type="button" className="px-4 py-2.5 rounded-2xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] text-sm disabled:opacity-60" onClick={onLoadMore} disabled={loading}>
                  {loading ? "Cargando..." : "Cargar más"}
                </button>
              ) : (
                <div className="text-xs text-white/40">No hay más registros.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}