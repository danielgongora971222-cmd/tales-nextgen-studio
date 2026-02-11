// services/videoModels/utils.ts
export function normalizeModelId(raw: string): string {
  return String(raw || "").trim().replace(/^models\//i, "");
}

export function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}
