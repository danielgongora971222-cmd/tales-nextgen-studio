// config/pricing.js
// Fuente única de verdad para costos en créditos (UI + backend).
// Mantén estas reglas alineadas con tu estrategia de pricing.

function clampInt(n, min, max) {
  const x = Math.trunc(Number(n));
  if (Number.isNaN(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

// -----------------------------
// IMAGE
// -----------------------------
export function estimateImageUnitCredits({ model, quality }) {
  // Base por resolución
  const q = String(quality || "1K").toUpperCase();
  let unit = 1;
  if (q === "2K") unit = 2;
  if (q === "4K") unit = 4;

  // Multiplicadores por familia de modelo (ajustables)
  const m = String(model || "").toLowerCase();
  if (m.startsWith("kling")) unit *= 3;
  else if (m.startsWith("openai:")) unit *= 2;
  else if (m.includes("pro")) unit *= 2;

  return unit;
}

export function estimateImageCostCredits({ model, quality, count }) {
  const n = Math.max(1, Number(count || 1));
  const unit = estimateImageUnitCredits({ model, quality });
  return unit * n;
}

// -----------------------------
// VIDEO
// -----------------------------
export function estimateVideoCostCredits({
  modelNorm = undefined,
  durationSeconds = undefined,
  isKling = undefined,
} = {}) {
  const dur = clampInt(durationSeconds != null ? durationSeconds : 5, 3, 15);

  const inferredIsKling =
    typeof isKling === "boolean" ? isKling : String(modelNorm || "").toLowerCase().includes("kling");

  // Base por segundo (ajustable)
  let perSecond = inferredIsKling ? 30 : 15;

  const m = String(modelNorm || "").toLowerCase();
  if (m.includes("v3")) perSecond += 5;
  if (m.includes("pro")) perSecond += 5;

  return perSecond * dur;
}

// -----------------------------
// FACE SWAP / UPSCALE (por ahora fijo)
// -----------------------------
export function estimateFaceSwapCostCredits() {
  return 1;
}

export function estimateUpscaleCostCredits() {
  return 1;
}