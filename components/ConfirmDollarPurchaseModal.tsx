import React, { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";

export default function ConfirmDollarPurchaseModal({
  open,
  itemLabel,
  amountLabel,
  note,
  termsUrl = "/terms.html",
  onClose,
  onConfirm,
}: {
  open: boolean;
  itemLabel: string;
  amountLabel: string;
  note?: string | null;
  termsUrl?: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAccepted(false);
    setBusy(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const { body, documentElement } = document;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = documentElement.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevHtmlOverscroll = documentElement.style.overscrollBehavior;

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    documentElement.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = prevBodyOverflow;
      documentElement.style.overflow = prevHtmlOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
      documentElement.style.overscrollBehavior = prevHtmlOverscroll;
    };
  }, [open]);

  if (!open) return null;

  async function handleConfirm() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo completar la compra.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[99999] overflow-y-auto overscroll-contain p-3 sm:p-4">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onClose();
        }}
      />

      <div className="relative flex min-h-full items-end justify-center sm:items-center">
        <div className="relative w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-[28px] bg-gradient-to-br from-white/20 via-white/5 to-transparent p-[1px] shadow-2xl">
            <div className="relative flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0b0b]">
              <button
                className={`absolute right-3 top-3 z-10 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-white/75 hover:bg-white/10 hover:text-white sm:right-4 sm:top-4 ${
                  busy ? "opacity-40 pointer-events-none" : ""
                }`}
                onClick={onClose}
                type="button"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="overflow-y-auto overscroll-contain px-4 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
                <div className="flex items-start gap-3 pr-10">
                  <span className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3">
                    <ShieldCheck className="h-5 w-5 text-[#DFB142]" />
                  </span>

                  <div className="min-w-0">
                    <div className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">Confirmar compra</div>
                    <div className="mt-1 text-sm text-white/60">Revisa el resumen y confirma el pago.</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="text-xs text-white/60">Producto</div>
                  <div className="mt-1 break-words font-semibold text-white">{itemLabel}</div>

                  <div className="mt-4 text-xs text-white/60">Monto</div>
                  <div className="mt-1 text-lg font-extrabold text-white">{amountLabel}</div>

                  {note ? <div className="mt-3 text-xs text-white/55">{note}</div> : null}
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <label className="flex items-start gap-3 text-sm text-white/80">
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={accepted}
                      disabled={busy}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    <span className="min-w-0 leading-6">
                      Acepto los{" "}
                      <a className="underline text-[#DFB142]" href={termsUrl} target="_blank" rel="noreferrer">
                        Términos y Condiciones
                      </a>
                      .
                      <span className="mt-1 block text-xs text-white/55">
                        (Incluye descargos de responsabilidad y, si aplica, suscripciones recurrentes.)
                      </span>
                    </span>
                  </label>

                  {!accepted ? <div className="mt-3 text-xs text-yellow-200/80">Debes marcar la casilla para continuar.</div> : null}
                  {error ? <div className="mt-3 text-xs text-red-300">{error}</div> : null}
                </div>
              </div>

              <div className="border-t border-white/10 bg-[#0b0b0b]/95 px-4 py-4 backdrop-blur sm:px-6">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className={`px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white ${
                      busy ? "opacity-40 pointer-events-none" : ""
                    }`}
                    onClick={onClose}
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    disabled={!accepted || busy}
                    className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-r from-[#DFB142] to-[#F5E18A] text-black font-extrabold hover:brightness-105 disabled:opacity-50"
                    onClick={handleConfirm}
                  >
                    {busy ? "Procesando..." : "Confirmar y pagar"}
                  </button>
                </div>

                <div className="mt-3 text-[11px] text-white/45">
                  Seguridad: no guardamos tu información de pago en el cliente; el cobro se procesa por tu proveedor configurado.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}