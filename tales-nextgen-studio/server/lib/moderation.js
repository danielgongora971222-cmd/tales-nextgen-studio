const moderationCache = new Map();

function nowMs() {
  return Date.now();
}

export function evaluateCommentText(text) {
  const t = String(text || "").trim();
  const lower = t.toLowerCase();

  const reasons = [];

  // Links (spam típico)
  if (lower.includes("http://") || lower.includes("https://") || lower.includes("www.")) {
    reasons.push("link_detected");
  }

  // Flood: mismo carácter repetido muchas veces
  if (/(\S)\1{10,}/.test(t)) {
    reasons.push("flood_repetition");
  }

  // Demasiados signos/ruido
  const nonWord = (t.match(/[^\p{L}\p{N}\s]/gu) || []).length;
  if (t.length >= 20 && nonWord / t.length > 0.55) {
    reasons.push("noisy_text");
  }

  // Caps excesivo (evita gritos/spam)
  const letters = (t.match(/\p{L}/gu) || []).length;
  const caps = (t.match(/\p{Lu}/gu) || []).length;
  if (letters >= 12 && caps / letters > 0.8) {
    reasons.push("excessive_caps");
  }

  return { shouldShadow: reasons.length > 0, reasons };
}

/**
 * Lee estado de moderación (shadow ban) con cache TTL (30s).
 */
export async function getUserModeration(supabaseAdmin, userId) {
  const now = nowMs();
  const cached = moderationCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;

  const { data, error } = await supabaseAdmin
    .from("user_moderation")
    .select("shadow_banned, reason")
    .eq("user_id", userId)
    .maybeSingle();

  const value = {
    shadowBanned: Boolean(data?.shadow_banned),
    reason: data?.reason || null,
    error: error ? String(error.message || "moderation_query_failed") : null,
  };

  moderationCache.set(userId, { value, expiresAt: now + 30 * 1000 });
  return value;
}