import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const buckets = new Map();
let lastCleanupAt = 0;

const hasUpstash =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const upstashRedis = hasUpstash ? Redis.fromEnv() : null;
const limiterCache = new Map();

function cleanupExpired(now) {
  // Limpieza ligera cada 5 minutos
  if (now - lastCleanupAt < 5 * 60 * 1000) return;
  lastCleanupAt = now;

  for (const [k, v] of buckets.entries()) {
    if (!v || v.resetAt <= now) buckets.delete(k);
  }
}

function getUpstashLimiter({ scope, windowMs, max }) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const prefixBase = String(process.env.UPSTASH_RATELIMIT_PREFIX || "tales_rl").trim() || "tales_rl";
  const cacheKey = `${scope}:${max}:${windowSeconds}:${prefixBase}`;

  const existing = limiterCache.get(cacheKey);
  if (existing) return existing;

  const rl = new Ratelimit({
    redis: upstashRedis,
    limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
    analytics: false,
    prefix: `${prefixBase}:${scope}`,
  });

  limiterCache.set(cacheKey, rl);
  return rl;
}

/**
 * Rate limit por userId.
 * - Si hay Upstash: distribuido (ideal al escalar a múltiples instancias)
 * - Si no: fallback en memoria (dev/local o sin Redis)
 *
 * Retorna:
 *  - { ok: true, remaining, resetAt }
 *  - { ok: false, retryAfterSeconds, resetAt }
 */
export async function checkUserRateLimit({ userId, scope, windowMs, max }) {
  const now = Date.now();

  if (hasUpstash) {
    try {
      const ratelimit = getUpstashLimiter({ scope, windowMs, max });
      const identifier = `${scope}:${userId}`;

      const result = await ratelimit.limit(identifier);

      if (!result.success) {
        const retryAfterSeconds = Math.max(Math.ceil((result.reset - now) / 1000), 1);
        return { ok: false, retryAfterSeconds, resetAt: result.reset };
      }

      return {
        ok: true,
        remaining: Math.max(Number(result.remaining), 0),
        resetAt: Number(result.reset),
      };
    } catch {
      // Si Upstash falla por red, NO tumbamos la app: degradamos a memoria
    }
  }

  // Fallback en memoria (fixed window)
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