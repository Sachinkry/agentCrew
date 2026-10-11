// Failure injection — controlled bugs for demo scenarios.
// Activated via config.inject array.

import { config } from "../core/config.js";

export type FailureType =
  | "unverified_claim"
  | "angry_refund"
  | "negative_margin_discount"
  | "thin_data_rotation";

export function isInjected(failure: FailureType): boolean {
  return config.inject.includes(failure);
}

// When unverified_claim is injected, verify service skips the gate
export function shouldSkipVerifyGate(): boolean {
  return isInjected("unverified_claim");
}

// When negative_margin_discount is injected, policy skips the floor check
export function shouldSkipPriceFloor(): boolean {
  return isInjected("negative_margin_discount");
}

// When thin_data_rotation is injected, min sample is 0 (no threshold)
export function getMinSampleOverride(): number | null {
  return isInjected("thin_data_rotation") ? 0 : null;
}

// When angry_refund is injected, 50% of tickets request max refund
export function getRefundAmountOverride(
  orderedAmountCents: number,
  rng: () => number
): number | null {
  if (!isInjected("angry_refund")) return null;
  return rng() < 0.5 ? orderedAmountCents : null;
}
