// =============================================================================
// ZERO-DENOMINATOR ANALYTICS TESTS — instructor-admin stream.
// -----------------------------------------------------------------------------
// A cohort with no attempts is the NORMAL first state of the product: no Google
// Form URL is configured in seeded data, so nothing has been ingested and nobody
// has taken a quiz. Every rate on the analytics page therefore divides by zero on
// day one, and every one of them must read "no data".
//
// These assertions exist because the failure they prevent is not a crash. It is a
// page that confidently displays "NaN%" or "0% pass rate" to an instructor, who
// then believes their cohort is failing.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  aggregateRate,
  formatAverage,
  formatRate,
  NO_DATA_LABEL,
  QUIZ_BUCKETS,
  rate,
  toNumberOrNull,
} from "./rates";

describe("rate — zero denominator", () => {
  it("returns percent null, not NaN, for 0/0", () => {
    const r = rate(0, 0);
    expect(r.percent).toBeNull();
    expect(Number.isNaN(r.percent as unknown as number)).toBe(false);
  });

  it("returns percent null for a positive numerator over a zero denominator", () => {
    // Should not happen, but Infinity must never reach a page if it does.
    expect(rate(5, 0).percent).toBeNull();
  });

  it("returns percent null for a negative denominator", () => {
    expect(rate(1, -3).percent).toBeNull();
  });

  it("keeps the denominator at 0 so the UI can explain why there is no value", () => {
    expect(rate(0, 0).denominator).toBe(0);
  });

  it("does not throw for any of the degenerate inputs", () => {
    expect(() => rate(0, 0)).not.toThrow();
    expect(() => rate(Number.NaN, Number.NaN)).not.toThrow();
    expect(() => rate(Number.POSITIVE_INFINITY, 0)).not.toThrow();
  });

  it("normalises non-finite inputs to 0 instead of propagating them", () => {
    expect(rate(Number.NaN, 10).percent).toBe(0);
    expect(rate(5, Number.NaN).percent).toBeNull();
    expect(rate(5, Number.POSITIVE_INFINITY).percent).toBeNull();
  });
});

describe("rate — real denominators", () => {
  it("computes a percentage", () => {
    expect(rate(7, 10).percent).toBeCloseTo(70);
    expect(rate(1, 3).percent).toBeCloseTo(33.3333, 3);
    expect(rate(10, 10).percent).toBe(100);
  });

  it("distinguishes a genuine 0% from no data", () => {
    // The whole point: 0 of 12 passed is a fact; 0 of 0 is an absence.
    const everyoneFailed = rate(0, 12);
    const nobodyTried = rate(0, 0);
    expect(everyoneFailed.percent).toBe(0);
    expect(nobodyTried.percent).toBeNull();
    expect(formatRate(everyoneFailed)).toBe("0%");
    expect(formatRate(nobodyTried)).toBe(NO_DATA_LABEL);
  });
});

describe("formatRate", () => {
  it("renders 'no data' for a zero denominator", () => {
    expect(formatRate(rate(0, 0))).toBe(NO_DATA_LABEL);
  });

  it("renders 'no data' for null and undefined", () => {
    expect(formatRate(null)).toBe(NO_DATA_LABEL);
    expect(formatRate(undefined)).toBe(NO_DATA_LABEL);
  });

  it("never emits NaN or Infinity", () => {
    for (const [n, d] of [
      [0, 0],
      [1, 0],
      [Number.NaN, 0],
      [Number.NaN, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
    ] as const) {
      const text = formatRate(rate(n, d));
      expect(text).not.toMatch(/NaN|Infinity/);
    }
  });

  it("rounds to whole percent by default and honours a digit count", () => {
    expect(formatRate(rate(2, 3))).toBe("67%");
    expect(formatRate(rate(2, 3), 1)).toBe("66.7%");
  });
});

describe("formatAverage", () => {
  it("renders 'no data' for null, undefined and NaN", () => {
    expect(formatAverage(null)).toBe(NO_DATA_LABEL);
    expect(formatAverage(undefined)).toBe(NO_DATA_LABEL);
    expect(formatAverage(Number.NaN)).toBe(NO_DATA_LABEL);
    expect(formatAverage(Number.POSITIVE_INFINITY)).toBe(NO_DATA_LABEL);
  });

  it("renders a genuine zero average", () => {
    expect(formatAverage(0)).toBe("0.0");
  });

  it("appends a suffix", () => {
    expect(formatAverage(72.456, 1, "%")).toBe("72.5%");
  });
});

describe("aggregateRate", () => {
  it("returns 'no data' when every part has a zero denominator", () => {
    const empty = aggregateRate([rate(0, 0), rate(0, 0), rate(0, 0), rate(0, 0)]);
    expect(empty.percent).toBeNull();
    expect(formatRate(empty)).toBe(NO_DATA_LABEL);
  });

  it("returns 'no data' for an empty list of weeks", () => {
    expect(aggregateRate([]).percent).toBeNull();
  });

  it("sums numerators and denominators rather than averaging percentages", () => {
    // A naive average of 100% and 40% is 70%. The correct pooled figure is
    // 1+24 over 1+60 = 41%.
    const pooled = aggregateRate([rate(1, 1), rate(24, 60)]);
    expect(pooled.percent).toBeCloseTo((25 / 61) * 100, 6);
    expect(pooled.percent).not.toBeCloseTo(70, 0);
  });

  it("ignores zero-denominator weeks when other weeks have data", () => {
    const pooled = aggregateRate([rate(0, 0), rate(3, 4)]);
    expect(pooled.percent).toBe(75);
  });
});

describe("toNumberOrNull — Postgres numeric coercion", () => {
  it("maps null and undefined to null (an AVG over no rows is NULL)", () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
  });

  it("parses the string form a decimal column comes back as", () => {
    expect(toNumberOrNull("72.50")).toBeCloseTo(72.5);
  });

  it("maps unparseable values to null rather than NaN", () => {
    expect(toNumberOrNull("not a number")).toBeNull();
    expect(toNumberOrNull({})).toBeNull();
  });

  it("keeps a genuine zero", () => {
    expect(toNumberOrNull(0)).toBe(0);
    expect(toNumberOrNull("0")).toBe(0);
  });
});

describe("QUIZ_BUCKETS", () => {
  it("covers 0..100 with no gap and no overlap", () => {
    for (let i = 1; i < QUIZ_BUCKETS.length; i += 1) {
      expect(QUIZ_BUCKETS[i].from).toBe(QUIZ_BUCKETS[i - 1].to);
    }
    expect(QUIZ_BUCKETS[0].from).toBe(0);
    expect(QUIZ_BUCKETS[QUIZ_BUCKETS.length - 1].to).toBeGreaterThan(100);
  });

  it("puts the 70% pass threshold at a bucket boundary", () => {
    // QUIZ_PASS_PERCENT is 70; a bucket straddling it would make the histogram
    // unable to show "passed" versus "failed".
    expect(QUIZ_BUCKETS.some((b) => b.from === 70)).toBe(true);
  });
});
