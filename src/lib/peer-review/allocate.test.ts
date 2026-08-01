// =============================================================================
// ALLOCATION PROPERTIES — asserted over every cohort size, not over one example.
// -----------------------------------------------------------------------------
// The four properties below are the whole of the fairness argument in
// ./allocate.ts, and each one is checked for EVERY n from 0 to 40 rather than for a
// hand-picked cohort. That matters because the interesting failures are all at
// boundaries — n=0, n=1, n=2 with K=2, n=K, n=K+1 — and a test written around a
// 20-student cohort passes through all of them without noticing.
//
// No database, no mocks. `planAllocations` is a pure function of (submissions, K,
// seed), which is exactly why it was written that way.
// =============================================================================

import { describe, expect, it } from "vitest";

import { planAllocations, seededShuffle, summarisePlan, type AllocatableSubmission } from "./allocate";
import { DEFAULT_REVIEWS_PER_SUBMISSION, MAX_REVIEWS_PER_SUBMISSION } from "./config";

/** n students, student ids 101.., submission ids 1001.. — distinct ranges so a
 *  test that confuses the two fails instead of coincidentally passing. */
function pool(n: number): AllocatableSubmission[] {
  return Array.from({ length: n }, (_, i) => ({
    studentId: 101 + i,
    submissionId: 1001 + i,
  }));
}

const SIZES = Array.from({ length: 41 }, (_, n) => n); // 0..40

describe("planAllocations — the invariant that matters most", () => {
  it.each(SIZES)("never allocates a student their own submission (n=%i)", (n) => {
    for (const k of [1, 2, 3]) {
      const plan = planAllocations({ submissions: pool(n), reviewsPerSubmission: k, seed: 7 });
      for (const pair of plan.pairs) {
        expect(pair.reviewerId).not.toBe(pair.revieweeId);
      }
    }
  });

  it("cannot be tricked into self-review by a duplicate submission for one student", () => {
    // Two submissions, one author. If both entered the ring the author would sit at
    // two positions and the offset between them would pair them with themselves.
    // `submissions_row_ref_idx` makes this unlikely, not impossible.
    const duplicated: AllocatableSubmission[] = [
      { studentId: 101, submissionId: 1001 },
      { studentId: 101, submissionId: 1002 },
      { studentId: 102, submissionId: 1003 },
      { studentId: 103, submissionId: 1004 },
    ];
    const plan = planAllocations({ submissions: duplicated, reviewsPerSubmission: 2, seed: 3 });

    expect(plan.poolSize).toBe(3);
    // The LOWEST submission id is the one kept, as documented.
    expect(plan.pairs.some((p) => p.submissionId === 1002)).toBe(false);
    for (const pair of plan.pairs) expect(pair.reviewerId).not.toBe(pair.revieweeId);
  });
});

describe("planAllocations — fairness is symmetric and exact", () => {
  it.each(SIZES.filter((n) => n >= 2))(
    "gives every submission and every reviewer exactly K (n=%i)",
    (n) => {
      const k = DEFAULT_REVIEWS_PER_SUBMISSION;
      const plan = planAllocations({ submissions: pool(n), reviewsPerSubmission: k, seed: 11 });
      const expected = Math.min(k, n - 1);

      expect(plan.effectiveReviewsPerSubmission).toBe(expected);

      const reviewsReceived = new Map<number, number>();
      const reviewsWritten = new Map<number, number>();
      for (const pair of plan.pairs) {
        reviewsReceived.set(pair.submissionId, (reviewsReceived.get(pair.submissionId) ?? 0) + 1);
        reviewsWritten.set(pair.reviewerId, (reviewsWritten.get(pair.reviewerId) ?? 0) + 1);
      }

      // Every one of the n submissions is reviewed, and by exactly K reviewers.
      expect(reviewsReceived.size).toBe(n);
      expect([...reviewsReceived.values()].every((c) => c === expected)).toBe(true);
      // Every one of the n students writes exactly K reviews. "You are reviewed by
      // as many people as you review" is the fairness claim; this is it.
      expect(reviewsWritten.size).toBe(n);
      expect([...reviewsWritten.values()].every((c) => c === expected)).toBe(true);
      expect(plan.pairs.length).toBe(n * expected);
    },
  );

  it.each(SIZES.filter((n) => n >= 2))("never pairs the same two people twice (n=%i)", (n) => {
    const plan = planAllocations({ submissions: pool(n), reviewsPerSubmission: 3, seed: 5 });
    const keys = plan.pairs.map((p) => `${p.reviewerId}->${p.submissionId}`);
    // A duplicate pair would be swallowed by `peer_review_allocations_pair_idx` at
    // INSERT time and silently reduce that submission's review count below K.
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("planAllocations — the degenerate cases the brief asks about", () => {
  it("allocates nothing for an empty pool and says why", () => {
    const plan = planAllocations({ submissions: [], reviewsPerSubmission: 2, seed: 1 });
    expect(plan.pairs).toEqual([]);
    expect(plan.reason).toBe("no_submissions");
    expect(plan.degraded).toBe(false);
  });

  it("refuses a single-submission cohort rather than self-allocating", () => {
    const plan = planAllocations({ submissions: pool(1), reviewsPerSubmission: 2, seed: 1 });
    expect(plan.pairs).toEqual([]);
    expect(plan.reason).toBe("cohort_too_small");
    expect(plan.poolSize).toBe(1);
  });

  it("degrades K to n-1 for a cohort too small, and reports the degradation", () => {
    // Two submissions, two reviews each requested: only one other person exists.
    const two = planAllocations({ submissions: pool(2), reviewsPerSubmission: 2, seed: 1 });
    expect(two.effectiveReviewsPerSubmission).toBe(1);
    expect(two.requestedReviewsPerSubmission).toBe(2);
    expect(two.degraded).toBe(true);
    expect(two.pairs).toHaveLength(2);
    expect(two.reason).toBeNull();

    // Three submissions, three requested -> 2. The surface must be able to say
    // "3 requested, 2 possible" rather than quietly allocating 2.
    const three = planAllocations({ submissions: pool(3), reviewsPerSubmission: 3, seed: 1 });
    expect(three.effectiveReviewsPerSubmission).toBe(2);
    expect(three.degraded).toBe(true);

    // Big enough cohort: not degraded.
    const many = planAllocations({ submissions: pool(10), reviewsPerSubmission: 2, seed: 1 });
    expect(many.degraded).toBe(false);
    expect(many.effectiveReviewsPerSubmission).toBe(2);
  });

  it("clamps a nonsense K instead of allocating zero or thousands of reviews", () => {
    const zero = planAllocations({ submissions: pool(6), reviewsPerSubmission: 0, seed: 1 });
    expect(zero.effectiveReviewsPerSubmission).toBe(1);

    const huge = planAllocations({ submissions: pool(30), reviewsPerSubmission: 999, seed: 1 });
    expect(huge.effectiveReviewsPerSubmission).toBe(MAX_REVIEWS_PER_SUBMISSION);

    const fractional = planAllocations({ submissions: pool(6), reviewsPerSubmission: 2.7, seed: 1 });
    expect(fractional.effectiveReviewsPerSubmission).toBe(2);
  });

  it("excludes a student who has no submission — they are neither reviewed nor reviewing", () => {
    // The pool IS the set of submitters; a non-submitter simply is not in it. This
    // asserts the consequence the header states plainly: no submission, no feedback.
    const submitters = pool(4);
    const plan = planAllocations({ submissions: submitters, reviewsPerSubmission: 2, seed: 9 });
    const involved = new Set(plan.pairs.flatMap((p) => [p.reviewerId, p.revieweeId]));
    expect([...involved].sort()).toEqual([101, 102, 103, 104]);
    expect(involved.has(999)).toBe(false);
  });
});

describe("planAllocations — determinism, because reconciliation depends on it", () => {
  it("produces an identical plan for identical input", () => {
    const a = planAllocations({ submissions: pool(12), reviewsPerSubmission: 2, seed: 42 });
    const b = planAllocations({ submissions: pool(12), reviewsPerSubmission: 2, seed: 42 });
    expect(a.pairs).toEqual(b.pairs);
    expect(a.ring).toEqual(b.ring);
  });

  it("does not depend on the order the submissions arrive in", () => {
    // The database has no guaranteed row order without an ORDER BY, and the caller
    // must not have to remember to add one.
    const forwards = pool(12);
    const backwards = [...forwards].reverse();
    const a = planAllocations({ submissions: forwards, reviewsPerSubmission: 2, seed: 42 });
    const b = planAllocations({ submissions: backwards, reviewsPerSubmission: 2, seed: 42 });
    expect(a.ring).toEqual(b.ring);
    expect(new Set(a.pairs.map((p) => `${p.reviewerId}->${p.submissionId}`))).toEqual(
      new Set(b.pairs.map((p) => `${p.reviewerId}->${p.submissionId}`)),
    );
  });

  it("varies the pairing between assignments", () => {
    // The point of seeding at all: without it the lowest-id student reviews the
    // second-lowest every week of the course. This asserts the rings differ for two
    // different assignment ids — not that they always differ, which is untrue for
    // small n and is not claimed anywhere.
    const week1 = planAllocations({ submissions: pool(20), reviewsPerSubmission: 2, seed: 1 });
    const week2 = planAllocations({ submissions: pool(20), reviewsPerSubmission: 2, seed: 2 });
    expect(week1.ring).not.toEqual(week2.ring);
  });
});

describe("seededShuffle", () => {
  it.each(SIZES)("is a permutation — nobody is dropped or duplicated (n=%i)", (n) => {
    // If this ever stopped being a permutation, a student would vanish from the ring
    // and their submission would go unreviewed with nothing reporting a problem.
    const input = Array.from({ length: n }, (_, i) => i);
    const shuffled = seededShuffle(input, 12345);
    expect(shuffled).toHaveLength(n);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    seededShuffle(input, 99);
    expect(input).toEqual(copy);
  });
});

describe("summarisePlan", () => {
  it("reports zero reviewers when nothing could be allocated", () => {
    const plan = planAllocations({ submissions: pool(1), reviewsPerSubmission: 2, seed: 1 });
    expect(summarisePlan(plan)).toEqual({
      reviewers: 0,
      reviewsToWritePerReviewer: 0,
      reviewsPerSubmission: 0,
      totalReviews: 0,
    });
  });

  it("matches the plan it summarises", () => {
    const plan = planAllocations({ submissions: pool(8), reviewsPerSubmission: 2, seed: 4 });
    const summary = summarisePlan(plan);
    expect(summary.reviewers).toBe(8);
    expect(summary.totalReviews).toBe(16);
    expect(summary.reviewsPerSubmission).toBe(2);
  });
});
