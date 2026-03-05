export const EVENT_INSUFFICIENT_CREDITS = "tales:insufficient-credits";
export const EVENT_PLAN_REQUIRED = "tales:plan-required";
export const EVENT_WALLET_REFRESH = "tales:wallet-refresh";
export const EVENT_PROFILE_REFRESH = "tales:profile-refresh";
export const EVENT_MY_CREATIONS_FILTER = "tales:set-creations-filter";

export type InsufficientCreditsDetail = { need: number; have: number; deficit: number };

export function emitInsufficientCredits(detail: InsufficientCreditsDetail) {
  window.dispatchEvent(new CustomEvent(EVENT_INSUFFICIENT_CREDITS, { detail }));
}

export function emitWalletRefresh() {
  window.dispatchEvent(new Event(EVENT_WALLET_REFRESH));
}

export function emitProfileRefresh() {
  window.dispatchEvent(new Event(EVENT_PROFILE_REFRESH));
}

export function emitMyCreationsFilter(filterKey: string) {
  window.dispatchEvent(new CustomEvent(EVENT_MY_CREATIONS_FILTER, { detail: { filterKey } }));
}

export type PlanRequiredDetail = { code: string; message: string };

export function emitPlanRequired(detail: PlanRequiredDetail) {
  window.dispatchEvent(new CustomEvent(EVENT_PLAN_REQUIRED, { detail }));
}