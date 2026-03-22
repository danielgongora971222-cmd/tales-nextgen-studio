import React, { useEffect, useMemo, useState } from "react";

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.trunc(x);
  if (xi < min) return min;
  if (xi > max) return max;
  return xi;
}

function moneyFromUsdMicros(micros: number) {
  const v = (Number(micros || 0) || 0) / 1_000_000;
  return `$${v.toFixed(2)}`;
}

type CashoutConfig = {
  usdMicrosPerCredit: number;
  feeBps: number;
  minCashoutCredits: number;
} | null;

export default function EarningsActionsModal({
  open,
  availableCredits,
  cashoutConfig,
  onClose,
  onTransfer,
  onCashout,
}: {
  open: boolean;
  availableCredits: number;
  cashoutConfig: CashoutConfig;
  onClose: () => void;
  onTransfer: (amountCredits: number) => Promise<void>;
  onCashout: (args: { amountCredits: number; payoutMethod: { kind: string; handle: string; note?: string } }) => Promise<void>;
}) {
  const [tab, setTab] = useState<"transfer" | "cashout">("transfer");
  const [amount, setAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "transfer" | "cashout"; amountCredits: number }>(null);

  // payout method (placeholder)
  const [methodKind, setMethodKind] = useState<"paypal" | "bank" | "other">("paypal");
  const [methodHandle, setMethodHandle] = useState<string>("");
  const [methodNote, setMethodNote] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setTab("transfer");
    setAmount(Math.max(0, Math.trunc(availableCredits || 0)));
    setBusy(false);
    setError(null);
    setConfirm(null);
    setMethodKind("paypal");
    setMethodHandle("");
    setMethodNote("");
  }, [open, availableCredits]);

  const maxAmount = Math.max(0, Math.trunc(availableCredits || 0));
  const cfg = cashoutConfig || { usdMicrosPerCredit: 4505, feeBps: 3700, minCashoutCredits: 1 };
  const feePct = (cfg.feeBps || 0) / 100;

  const cashoutPreview = useMemo(() => {
    const amt = clampInt(amount, 0, maxAmount, 0);
    const gross = BigInt(amt) * BigInt(cfg.usdMicrosPerCredit || 0);
    const fee = (gross * BigInt(cfg.feeBps || 0)) / BigInt(10000);
    const net = gross - fee;

    return {
      grossUsdMicros: Number(gross),
      feeUsdMicros: Number(fee),
      netUsdMicros: Number(net),
    };
  }, [amount, maxAmount, cfg.usdMicrosPerCredit, cfg.feeBps]);

  if (!open) return null;

  const isZero = maxAmount <= 0;
  const amt = clampInt(amount, 0, maxAmount, 0);

  async function runConfirmed() {
    if (!confirm) return;
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      if (confirm.kind === "transfer") {
        await onTransfer(confirm.amountCredits);
      } else {
        await onCashout({
          amountCredits: confirm.amountCredits,
          payoutMethod: {
            kind: methodKind,
            handle: methodHandle.trim(),
            note: methodNote.trim() || undefined,
          },
        });
      }

      setConfirm(null);
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-[0_0_50px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-white/60">Earnings disponibles</div>
            <div className="text-2xl font-bold">{maxAmount}</div>
            <div className="text-[11px] text-white/50 mt-1">
              Nota: El fee de plataforma ({(feePct || 0).toFixed(2)}%) se aplica <b>solo</b> cuando haces Cash out.
            </div>
          </div>

          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
            onClick={onClose}
            disabled={busy}
          >
            Cerrar
          </button>
        </div>

        <div className="p-5">
          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              className={`px-4 py-2 rounded-lg border border-white/10 ${tab === "transfer" ? "bg-white text-black" : "bg-black/30 text-white"}`}
              onClick={() => {
                setTab("transfer");
                setConfirm(null);
                setError(null);
              }}
              disabled={busy}
            >
              Transferir a créditos de generación
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-lg border border-white/10 ${tab === "cashout" ? "bg-white text-black" : "bg-black/30 text-white"}`}
              onClick={() => {
                setTab("cashout");
                setConfirm(null);
                setError(null);
              }}
              disabled={busy}
            >
              Cash out
            </button>
          </div>

          {/* Amount */}
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm font-semibold">Monto</div>
            <div className="text-xs text-white/60 mt-1">Elige total o parcial. Máximo: {maxAmount}</div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={maxAmount}
                value={amount}
                onChange={(e) => setAmount(clampInt(e.target.value, 0, maxAmount, 0))}
                className="w-40 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30"
                disabled={busy || isZero}
              />
              <div className="text-sm text-white/70">credits</div>
              <div className="flex-1" />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  onClick={() => setAmount(Math.floor(maxAmount * 0.25))}
                  disabled={busy || isZero}
                >
                  25%
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  onClick={() => setAmount(Math.floor(maxAmount * 0.5))}
                  disabled={busy || isZero}
                >
                  50%
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  onClick={() => setAmount(maxAmount)}
                  disabled={busy || isZero}
                >
                  100%
                </button>
              </div>
            </div>

            {tab === "cashout" ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="text-sm font-semibold">Preview Cash out</div>
                <div className="text-xs text-white/60 mt-1">
                  Conversión usada: 1 crédito = ${(cfg.usdMicrosPerCredit / 1_000_000).toFixed(6)} · Fee: {(feePct || 0).toFixed(2)}%
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2">
                    <div className="text-white/60 text-[11px]">Gross</div>
                    <div className="font-bold">{moneyFromUsdMicros(cashoutPreview.grossUsdMicros)}</div>
                  </div>
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2">
                    <div className="text-white/60 text-[11px]">Fee</div>
                    <div className="font-bold">{moneyFromUsdMicros(cashoutPreview.feeUsdMicros)}</div>
                  </div>
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2">
                    <div className="text-white/60 text-[11px]">Net</div>
                    <div className="font-bold">{moneyFromUsdMicros(cashoutPreview.netUsdMicros)}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Cashout method */}
          {tab === "cashout" ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="text-sm font-semibold">Método de pago (placeholder)</div>
              <div className="text-xs text-white/60 mt-1">
                Por ahora solo guardamos el método y dejamos el payout real para cuando integremos la plataforma.
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white"
                  value={methodKind}
                  onChange={(e) => setMethodKind(e.target.value as any)}
                  disabled={busy}
                >
                  <option value="paypal">PayPal</option>
                  <option value="bank">Bank transfer</option>
                  <option value="other">Other</option>
                </select>
                <input
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30"
                  placeholder={methodKind === "paypal" ? "paypal@email.com" : methodKind === "bank" ? "IBAN / Cuenta" : "Detalle"}
                  value={methodHandle}
                  onChange={(e) => setMethodHandle(e.target.value)}
                  disabled={busy}
                />
              </div>

              <textarea
                className="mt-2 w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30"
                rows={3}
                placeholder="Notas (opcional)"
                value={methodNote}
                onChange={(e) => setMethodNote(e.target.value)}
                disabled={busy}
              />
            </div>
          ) : null}

          {/* Error */}
          {error ? <div className="mt-4 text-red-300 text-sm">{error}</div> : null}

          {/* Confirm */}
          {confirm ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="text-sm font-semibold">Confirmación</div>
              {confirm.kind === "transfer" ? (
                <div className="text-xs text-white/70 mt-2">
                  Vas a transferir <b className="text-white">{confirm.amountCredits}</b> credits desde earnings disponibles a créditos de generación.
                  <div className="mt-1 text-white/60">Esta acción NO aplica fee.</div>
                </div>
              ) : (
                <div className="text-xs text-white/70 mt-2">
                  Vas a solicitar un cash out de <b className="text-white">{confirm.amountCredits}</b> credits.
                  <div className="mt-1 text-white/60">
                    Se convierten a USD y se aplica fee de plataforma. Neto estimado: <b className="text-white">{moneyFromUsdMicros(cashoutPreview.netUsdMicros)}</b>
                  </div>
                  <div className="mt-1 text-white/60">El payout real quedará en estado “requested” hasta integrar el proveedor.</div>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
                  onClick={() => setConfirm(null)}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`px-4 py-2 rounded-lg ${busy ? "bg-white/30" : "bg-white text-black hover:bg-gray-100"}`}
                  onClick={runConfirmed}
                  disabled={busy}
                >
                  {busy ? "Procesando..." : "Sí, continuar"}
                </button>
              </div>
            </div>
          ) : null}

          {/* Actions */}
          {!confirm ? (
            <div className="mt-4 flex justify-end gap-2">
              {tab === "transfer" ? (
                <button
                  type="button"
                  className={`px-4 py-2 rounded-lg ${isZero || amt <= 0 ? "bg-white/10 text-white/40" : "bg-white text-black hover:bg-gray-100"}`}
                  onClick={() => setConfirm({ kind: "transfer", amountCredits: amt })}
                  disabled={busy || isZero || amt <= 0}
                >
                  Transferir
                </button>
              ) : (
                <button
                  type="button"
                  className={`px-4 py-2 rounded-lg ${
                    isZero ||
                    amt < (cfg.minCashoutCredits || 1) ||
                    !methodHandle.trim()
                      ? "bg-white/10 text-white/40"
                      : "bg-white text-black hover:bg-gray-100"
                  }`}
                  onClick={() => setConfirm({ kind: "cashout", amountCredits: amt })}
                  disabled={
                    busy ||
                    isZero ||
                    amt < (cfg.minCashoutCredits || 1) ||
                    !methodHandle.trim()
                  }
                >
                  Solicitar cash out
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}