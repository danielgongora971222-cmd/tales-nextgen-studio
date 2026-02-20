const buckets = new Map();
let lastCleanupAt = 0;

function nowMs() {
  return Date.now();
}

function cleanupExpired(now) {
  // Limpieza ligera cada 5 minutos
  if (now - lastCleanupAt < 5 * 60 * 1000) return;
  lastCleanupAt = now;

  for (const [k, v] of buckets.entries()) {
    if (!v || v.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Rate limit por userId (fixed window).
 * Retorna:
 *  - { ok: true, remaining, resetAt }
 *  - { ok: false, retryAfterSeconds, resetAt }
 */
export function checkUserRateLimit({ userId, scope, windowMs, max }) {
  const now = nowMs();
  cleanupExpired(now);

  const key = `${scope}:${userId}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(max - 1, 0), resetAt };
  }

  const nextCount = existing.count + 1;
  existing.count = nextCount;

  if (nextCount > max) {
    const retryAfterSeconds = Math.max(Math.ceil((existing.resetAt - now) / 1000), 1);
    return { ok: false, retryAfterSeconds, resetAt: existing.resetAt };
  }

  return { ok: true, remaining: Math.max(max - nextCount, 0), resetAt: existing.resetAt };
}