// =============================================================================
// RATE ARITHMETIC (PURE) — instructor-admin stream.
// -----------------------------------------------------------------------------
// Split out of analytics.ts so it can be unit-tested without importing @/db.
// analytics.ts re-exports everything here.
//
// THE ONE RULE: a rate with a zero denominator has NO VALUE, and says so.
// On a fresh cohort nobody has attempted a quiz and nothing has been ingested, so
// every denominator is zero — that is the normal first state of the product, not
// an error state. `percent: null` propagates to the UI as the words "no data".
//
// "0%" is a different claim: "everyone failed". Conflating the two misinforms the
// instructor about their cohort, and `NaN%` / `Infinity%` on a page is a bug that
// gets reported as "analytics are broken".
// =============================================================================

/** A ratio that knows whether it is meaningful. */
export interface Rate {
  numerator: number;
  denominator: number;
  /** Percentage 0..100, or null when there is no denominator to divide by. */
  percent: number | null;
}

export const NO_DATA_LABEL = "no data";

/**
 * Build a Rate, refusing to divide by zero.
 *
 * Non-finite inputs (a NaN that leaked out of a driver coercion, an Infinity from
 * a bad cast) are normalised to 0 rather than propagated: one NaN in an aggregate
 * otherwise turns an entire dashboard into "NaN%".
 */
export function rate(numerator: number, denominator: number): Rate {
  const n = Number.isFinite(numerator) ? numerator : 0;
  const d = Number.isFinite(denominator) ? denominator : 0;
  if (d <= 0) return { numerator: n, denominator: 0, percent: null };
  return { numerator: n, denominator: d, percent: (n / d) * 100 };
}

/** Render a Rate for display. A null percent becomes "no data". */
export function formatRate(value: Rate | null | undefined, digits = 0): string {
  if (!value || value.percent === null) return NO_DATA_LABEL;
  return `${value.percent.toFixed(digits)}%`;
}

/** Render an average that may not exist. Same "no data" contract. */
export function formatAverage(
  value: number | null | undefined,
  digits = 1,
  suffix = "",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return NO_DATA_LABEL;
  }
  return `${value.toFixed(digits)}${suffix}`;
}

/** Coerce a Postgres numeric/decimal (returned as a string) to number | null. */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Combine per-week rates into one.
 *
 * Sums numerators and denominators rather than averaging percentages: averaging a
 * 100% week with one attempt against a 40% week with sixty flatters the cohort by
 * about thirty points. An all-zero-denominator set stays "no data".
 */
export function aggregateRate(parts: readonly Rate[]): Rate {
  let n = 0;
  let d = 0;
  for (const p of parts) {
    n += p.numerator;
    d += p.denominator;
  }
  return rate(n, d);
}

/** Bucket edges for the quiz score histogram. Mirrored in SQL in analytics.ts. */
export const QUIZ_BUCKETS: readonly { label: string; from: number; to: number }[] = [
  { label: "0-49", from: 0, to: 50 },
  { label: "50-59", from: 50, to: 60 },
  { label: "60-69", from: 60, to: 70 },
  { label: "70-79", from: 70, to: 80 },
  { label: "80-89", from: 80, to: 90 },
  { label: "90-100", from: 90, to: 101 },
];
