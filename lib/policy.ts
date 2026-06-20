import type { WindowType } from "./types";

/**
 * Computes a deterministic "bucket" string for a duplicate-prevention policy
 * window. The bucket is part of a UNIQUE INDEX (see db/schema.sql,
 * uq_entitlement_claim), which is what actually enforces "one per household
 * per window" — not a SELECT-then-INSERT check, which two concurrent
 * transactions could both pass (see README "Why this beats inventory
 * counting" section).
 *
 * Buckets are fixed-width slices of absolute time (epoch-aligned), not a
 * rolling window measured from the household's last claim. That's a
 * deliberate simplification: a rolling window can't be expressed as a single
 * deterministic key, so it can't be enforced by a unique index without a
 * locking read first — exactly the race we're trying to avoid. A fixed
 * window is what the strategic brief calls "fixed policy windows only," and
 * it's enough to prove the point convincingly in a live demo.
 */
export function computePolicyWindowBucket(
  windowType: WindowType,
  windowValue: number | null,
  now: Date = new Date()
): string {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  switch (windowType) {
    case "HOURS": {
      const hours = windowValue ?? 24;
      const bucketSeconds = hours * 3600;
      return `H${hours}:${Math.floor(epochSeconds / bucketSeconds)}`;
    }
    case "DAYS": {
      const days = windowValue ?? 7;
      const bucketSeconds = days * 86400;
      return `D${days}:${Math.floor(epochSeconds / bucketSeconds)}`;
    }
    case "EVENT":
      return "EVENT";
    case "ACTIVE":
      return "ACTIVE";
    default:
      return "EVENT";
  }
}

export function describePolicy(windowType: WindowType, windowValue: number | null): string {
  switch (windowType) {
    case "HOURS":
      return `one per household · per ${windowValue ?? 24} hours`;
    case "DAYS":
      return `one per household · per ${windowValue ?? 7} days`;
    case "EVENT":
      return "one per household · this event";
    case "ACTIVE":
      return "one active per household";
    default:
      return "one per household";
  }
}
