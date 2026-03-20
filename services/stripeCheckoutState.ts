const STRIPE_CHECKOUT_SESSION_TEMPLATE = "{CHECKOUT_SESSION_ID}";
const STRIPE_PENDING_CHECKOUT_STORAGE_KEY = "tales_pending_stripe_checkout";

export type PendingStripeCheckoutState = {
  sessionId: string;
  mode: "subscription" | "payment";
  createdAt: number;
};

export function isStripeCheckoutSessionTemplate(value: string | null | undefined) {
  return String(value || "").trim() === STRIPE_CHECKOUT_SESSION_TEMPLATE;
}

export function readPendingStripeCheckout(): PendingStripeCheckoutState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STRIPE_PENDING_CHECKOUT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const sessionId = typeof parsed?.sessionId === "string" ? parsed.sessionId.trim() : "";
    const mode = parsed?.mode === "payment" ? "payment" : parsed?.mode === "subscription" ? "subscription" : null;
    const createdAt = Number(parsed?.createdAt || 0);

    if (!sessionId || !mode) {
      window.localStorage.removeItem(STRIPE_PENDING_CHECKOUT_STORAGE_KEY);
      return null;
    }

    if (Number.isFinite(createdAt) && createdAt > 0) {
      const ageMs = Date.now() - createdAt;
      if (ageMs > 1000 * 60 * 60 * 48) {
        window.localStorage.removeItem(STRIPE_PENDING_CHECKOUT_STORAGE_KEY);
        return null;
      }
    }

    return {
      sessionId,
      mode,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    };
  } catch {
    window.localStorage.removeItem(STRIPE_PENDING_CHECKOUT_STORAGE_KEY);
    return null;
  }
}

export function persistPendingStripeCheckout(sessionId: string, mode: PendingStripeCheckoutState["mode"]) {
  if (typeof window === "undefined") return;
  const cleanSessionId = String(sessionId || "").trim();
  if (!cleanSessionId) return;

  window.localStorage.setItem(
    STRIPE_PENDING_CHECKOUT_STORAGE_KEY,
    JSON.stringify({ sessionId: cleanSessionId, mode, createdAt: Date.now() })
  );
}

export function clearPendingStripeCheckout() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STRIPE_PENDING_CHECKOUT_STORAGE_KEY);
}

export function clearBillingSearchParams() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("route");
  url.searchParams.delete("stripe_status");
  url.searchParams.delete("session_id");
  url.searchParams.delete("portal");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function hasStripeCheckoutSearchParams() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("stripe_status") || params.get("session_id"));
}
