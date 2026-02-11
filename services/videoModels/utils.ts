// services/videoModels/utils.ts
export function normalizeModelId(raw: string): string {
  return String(raw || "").trim().replace(/^models\//i, "");
}

export function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

export function coerceAllowedNumber(
  value: any,
  allowed: readonly number[],
  fallback?: number
) {
  const fb = fallback ?? allowed[0] ?? 0;
  const x0 = Number(value);

  if (!Number.isFinite(x0)) return fb;

  const x = Math.trunc(x0);
  if (allowed.includes(x)) return x;

  // si no está permitido, escogemos el permitido más cercano (reduce fallos del modelo)
  let best = allowed[0] ?? fb;
  let bestDist = Math.abs(best - x);

  for (const a of allowed) {
    const d = Math.abs(a - x);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

export function coerceAllowedString<T extends string>(
  value: any,
  allowed: readonly T[],
  fallback: T
): T {
  const v = String(value || "") as T;
  return (allowed as readonly string[]).includes(v) ? v : fallback;
}
