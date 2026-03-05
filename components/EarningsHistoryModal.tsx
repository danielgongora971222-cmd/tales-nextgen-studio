import React from "react";

type HistoryBucket = "pending" | "available";

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

export default function EarningsHistoryModal({
  open,
  bucket,
  items,
  loading,
  error,
  hasMore,
  onClose,
  onLoadMore,
}: {
  open: boolean;
  bucket: HistoryBucket;
  items: HistoryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onClose: () => void;
  onLoadMore: () => void;
}) {
  if (!open) return null;

  const title = bucket === "pending" ? "Historial de Earnings (pending)" : "Historial de Earnings (available)";
  const subtitle =
    bucket === "pending"
      ? "Aquí ves cada ingreso pendiente y la fecha exacta en la que quedará disponible."
      : "Aquí ves cada ingreso ya disponible, con su origen y cuándo se liberó.";

  return (
    <div className="fixed inset-0 z-[5100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-[0_0_50px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-bold">{title}</div>
            <div className="text-sm text-white/60 mt-1">{subtitle}</div>
          </div>

          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[calc(85vh-96px)]">
          {loading && items.length === 0 ? (
            <div className="text-white/60">Cargando historial...</div>
          ) : error ? (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-red-200 text-sm">{error}</div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-white/60 text-sm">
              No hay registros en este bucket todavía.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{item.sourceLabel}</div>
                      <div className="text-xs text-white/60 mt-1">
                        {item.sourceKind === "sale" ? "Ingreso por venta" : item.sourceKind === "referral" ? "Ingreso por referido" : "Ingreso"}
                      </div>
                    </div>
                    <div className="px-3 py-1 rounded-full bg-white/10 text-sm font-semibold">+{item.amountCredits} credits</div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">Origen</div>
                      <div className="mt-1 text-white/90">{item.sourceName || "—"}</div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">
                        {item.sourceKind === "referral" ? "Código" : "Detalle"}
                      </div>
                      <div className="mt-1 text-white/90">{item.sourceCode || item.planSlug || "—"}</div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">Fecha del ingreso</div>
                      <div className="mt-1 text-white/90">{formatDateTime(item.createdAt)}</div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">
                        {bucket === "pending" ? "Disponible el" : "Disponible desde"}
                      </div>
                      <div className="mt-1 text-white/90">{formatDateTime(item.availableAt)}</div>
                    </div>
                  </div>

                  {item.referredUsername ? (
                    <div className="mt-3 text-xs text-white/60">
                      Referido: <span className="text-white/85">{item.referredUsername}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {items.length > 0 ? (
            <div className="mt-4 flex justify-center">
              {hasMore ? (
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm disabled:opacity-60"
                  onClick={onLoadMore}
                  disabled={loading}
                >
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