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
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onClose();
        }}
      />

      <div className="relative w-full max-w-2xl">
        <div className="rounded-[28px] bg-gradient-to-br from-white/20 via-white/5 to-transparent p-[1px] shadow-2xl">
          <div className="relative rounded-[28px] border border-white/10 bg-[#0b0b0b] p-6">
            <button
              className={`absolute right-4 top-4 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-white/75 hover:text-white hover:bg-white/10 ${
                busy ? "opacity-40 pointer-events-none" : ""
              }`}
              onClick={onClose}
              type="button"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3">
                <ShieldCheck className="w-5 h-5 text-[#DFB142]" />
              </span>

              <div className="min-w-0">
                <div className="text-2xl font-extrabold text-white tracking-tight">Confirmar compra</div>
                <div className="text-sm text-white/60 mt-1">Revisa el resumen y confirma el pago.</div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="text-xs text-white/60">Producto</div>
              <div className="text-white font-semibold mt-1">{itemLabel}</div>

              <div className="mt-4 text-xs text-white/60">Monto</div>
              <div className="text-white font-extrabold text-lg mt-1">{amountLabel}</div>

              {note ? <div className="mt-3 text-xs text-white/55">{note}</div> : null}
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
              <label className="flex items-start gap-3 text-sm text-white/80">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={accepted}
                  disabled={busy}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>
                  Acepto los{" "}
                  <a className="underline text-[#DFB142]" href={termsUrl} target="_blank" rel="noreferrer">
                    Términos y Condiciones
                  </a>
                  .
                  <span className="block text-xs text-white/55 mt-1">
                    (Incluye descargos de responsabilidad y, si aplica, suscripciones recurrentes.)
                  </span>
                </span>
              </label>

              {!accepted ? <div className="text-xs text-yellow-200/80 mt-3">Debes marcar la casilla para continuar.</div> : null}
              {error ? <div className="text-xs text-red-300 mt-3">{error}</div> : null}
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-2">
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
  );
}