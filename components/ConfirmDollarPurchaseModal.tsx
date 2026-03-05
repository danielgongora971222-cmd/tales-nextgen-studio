import React, { useEffect, useState } from "react";

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
      // No cerramos al hacer click; cerramos solo cuando termina OK.
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

      <div className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-[#0b0b0b] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-extrabold text-white tracking-tight">Confirmar pago</div>
            <div className="text-sm text-white/70 mt-2">
              Se hará efectivo el pago de <b className="text-white">{itemLabel}</b> por{" "}
              <b className="text-white">{amountLabel}</b>. ¿Deseas continuar?
            </div>
            {note ? <div className="text-xs text-white/55 mt-2">{note}</div> : null}
          </div>

          <button
            className={`text-white/70 hover:text-white text-sm ${busy ? "opacity-40 pointer-events-none" : ""}`}
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
          <label className="flex items-start gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              className="mt-1"
              checked={accepted}
              disabled={busy}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              He leído y acepto los{" "}
              <a className="underline text-[#DFB142]" href={termsUrl} target="_blank" rel="noreferrer">
                Términos y Condiciones
              </a>
              . (Incluye descargos de responsabilidad y, si aplica, suscripciones recurrentes.)
            </span>
          </label>

          {!accepted ? (
            <div className="text-xs text-yellow-200/80 mt-3">Debes marcar la casilla para poder continuar.</div>
          ) : null}

          {error ? <div className="text-xs text-red-300 mt-3">{error}</div> : null}
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            className={`px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white ${
              busy ? "opacity-40 pointer-events-none" : ""
            }`}
            onClick={onClose}
          >
            No
          </button>

          <button
            type="button"
            disabled={!accepted || busy}
            className="flex-1 px-4 py-3 rounded-xl bg-white text-black font-bold disabled:opacity-50"
            onClick={handleConfirm}
          >
            {busy ? "Procesando..." : "Sí, continuar"}
          </button>
        </div>

        <div className="absolute inset-0 rounded-3xl pointer-events-none border border-white/5" />
      </div>
    </div>
  );
}