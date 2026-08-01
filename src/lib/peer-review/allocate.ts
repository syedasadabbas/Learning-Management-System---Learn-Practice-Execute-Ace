// =============================================================================
// ALLOCATION — who reviews whom. PURE: no database, no clock, no randomness.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// This file answers hard question 1 of the brief, and it is a pure function on
// purpose: the fairness and no-self-review properties are properties of a
// PERMUTATION, so they can be asserted exhaustively over cohort sizes 0..40 in
// milliseconds with no database (./allocate.test.ts). A version of this that read
// `submissions` inline could only ever be tested against whatever the shared seeded
// database happened to contain today.
//
// =============================================================================
// THE RULE, stated once: A SEEDED RING WITH FIXED OFFSETS.
// =============================================================================
//
//   1. Take every student who HAS A SUBMISSION for this assignment. Sort by student
//      id ascending — a total order that does not depend on query plan or on
//      insertion order.
//   2. Permute that list with Fisher-Yates driven by a PRNG seeded from the
//      assignment id. Deterministic: the same assignment always produces the same
//      ring, so re-running allocation is a no-op rather than a reshuffle, and an
//      instructor asking "why is X reviewing Y?" gets an answer that can be
//      reproduced.
//   3. Reviewer at ring position i reviews the submissions at positions
//      (i+1), (i+2), … (i+K) modulo n.
//
// WHY A RING AND NOT A RANDOM MATCHING. The ring makes all four properties
// structural rather than checked-after-the-fact:
//   * NO SELF-REVIEW — the offsets are 1..K and K <= n-1, so (i+d) mod n is never i.
//     There is no rejection loop that could fail to terminate and no retry that
//     could silently give up and pair a student with themselves.
//   * NO DUPLICATE PAIR — two distinct offsets from one i give distinct positions.
//   * EXACTLY K REVIEWS PER SUBMISSION — position j is hit by exactly the reviewers
//     at j-1 … j-K. Load is equal for everyone; nobody gets five reviews while a
//     classmate gets none, which is what a random matching produces at cohort sizes
//     this small.
//   * EXACTLY K REVIEWS TO WRITE PER REVIEWER — symmetric to the above. "You are
//     reviewed by as many people as you review" is the fairness statement students
//     actually care about.
//
// WHY SEED FROM THE ASSIGNMENT ID. Without the permutation the ring is just the
// id-sorted list, so the same neighbours would review each other in week 1, 2, 3
// and 4 — the student with the lowest id would review the second-lowest every
// single week. Seeding from the assignment id varies the pairing per week while
// keeping it reproducible. It does NOT guarantee different pairs across weeks; with
// n=3 and K=2 everyone reviews everyone regardless, and even at n=20 a repeat pair
// is expected. Stated because "varied" is the claim, not "never repeated".
//
// WHY NOT SEED FROM A TIMESTAMP OR Math.random(). Both make re-running allocation
// destructive: the second run computes a different ring, so a student who has
// already written a review finds it attached to a pairing that no longer exists.
// Reconciliation (./rounds.ts#allocateRound) depends on this function being a pure
// function of (student set, K, seed).
//
// =============================================================================
// THE TWO DEGENERATE CASES the brief asks about explicitly.
// =============================================================================
//
// A STUDENT WITH NO SUBMISSION IS NOT IN THE RING — neither as reviewer nor as
// reviewee. Both halves of that are deliberate:
//   * not as a REVIEWEE, because there is nothing to review;
//   * not as a REVIEWER, because the ring is symmetric and a non-submitter in it
//     would receive nothing while consuming a review slot. It is also the fair
//     reading: you are reviewed by the people you review.
//   The consequence is stated rather than hidden: a student who misses the deadline
//   gets no peer feedback at all. That is a real cost, and it is preferred to the
//   alternative, which is asking students who did the work to spend an hour
//   reviewing for someone who did not. If they submit LATE, re-running allocation
//   brings them in (see ./rounds.ts) and they are reviewed from then on.
//
// A COHORT TOO SMALL DEGRADES K, IT DOES NOT FAIL. K is reduced to n-1, the most
// distinct reviewers a submission can have without self-review, and `degraded` says
// so, so the surface can tell the instructor "2 requested, 1 possible with 2
// submissions" instead of silently allocating fewer than asked. At n <= 1 nothing is
// allocated and `reason` is `cohort_too_small`: with one submission the only
// available reviewer is its author.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { MAX_REVIEWS_PER_SUBMISSION } from "./config";

/** One submission in the pool, as the allocator needs it. */
export interface AllocatableSubmission {
  submissionId: number;
  /** Author. Becomes `peer_review_allocations.reviewee_id`. */
  studentId: number;
}

/** One reviewer-reviewee pairing. */
export interface AllocationPair {
  submissionId: number;
  revieweeId: number;
  reviewerId: number;
}

export type AllocationSkipReason =
  /** Fewer than two submissions: the only possible reviewer is the author. */
  | "cohort_too_small"
  /** No submissions at all. */
  | "no_submissions";

export interface AllocationPlan {
  pairs: AllocationPair[];
  /** Submissions that entered the ring. */
  poolSize: number;
  /** K as asked for. */
  requestedReviewsPerSubmission: number;
  /** K as allocated: min(requested, n-1). */
  effectiveReviewsPerSubmission: number;
  /** True when the cohort forced K down. The surface must say so. */
  degraded: boolean;
  /** Set when nothing was allocated. */
  reason: AllocationSkipReason | null;
  /** The ring, reviewee ids in order. Exposed so an instructor surface can show it. */
  ring: number[];
}

/**
 * mulberry32 — a 32-bit PRNG.
 *
 * Hand-written rather than a dependency, and the reason is the same one
 * src/lib/queue/keys.ts gives for refusing to hash: this is a place where a
 * "reasonable" library choice quietly changes behaviour. `Math.random()` cannot be
 * seeded, so it is unusable here; a dependency could change its stream between
 * minor versions and silently re-pair every historical round. Twelve lines with a
 * fixed algorithm cannot.
 *
 * The statistical quality required is low — it shuffles at most a few dozen
 * integers — and it is NOT used for anything security-bearing. If it were, this
 * comment would say to use `crypto`.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, seeded. Returns a new array; does not mutate the input.
 *
 * Exported for the test that asserts it is a PERMUTATION (same multiset in, same
 * multiset out) — the property that, if broken, would drop a student from the ring
 * entirely and leave their submission unreviewed with nothing reporting a problem.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Plan the allocation for one round.
 *
 * @param submissions one per student. Duplicates by `studentId` are collapsed to
 *   the LOWEST submission id — a student cannot be in the ring twice, or they would
 *   review themselves through the back door (two positions, offsets between them).
 *   `submissions_row_ref_idx` (schema.ts:405) makes duplicates unlikely rather than
 *   impossible, so this is handled rather than assumed away.
 * @param reviewsPerSubmission K as the round requests it.
 * @param seed normally `assignments.id`. Any integer.
 */
export function planAllocations(params: {
  submissions: readonly AllocatableSubmission[];
  reviewsPerSubmission: number;
  seed: number;
}): AllocationPlan {
  const requested = clampK(params.reviewsPerSubmission);

  // One entry per student, lowest submission id wins. Sorted by student id first so
  // the collapse is deterministic and does not depend on input order.
  const byStudent = new Map<number, AllocatableSubmission>();
  for (const candidate of [...params.submissions].sort(
    (a, b) => a.studentId - b.studentId || a.submissionId - b.submissionId,
  )) {
    if (!Number.isInteger(candidate.studentId) || !Number.isInteger(candidate.submissionId)) {
      continue;
    }
    if (!byStudent.has(candidate.studentId)) byStudent.set(candidate.studentId, candidate);
  }

  const sorted = [...byStudent.values()];
  const n = sorted.length;

  if (n === 0) {
    return emptyPlan(requested, 0, "no_submissions");
  }
  if (n === 1) {
    // The one available reviewer is the author. Refusing is the only correct move.
    return { ...emptyPlan(requested, 1, "cohort_too_small"), ring: [sorted[0].studentId] };
  }

  const effective = Math.min(requested, n - 1);
  const ring = seededShuffle(sorted, normaliseSeed(params.seed));

  const pairs: AllocationPair[] = [];
  for (let i = 0; i < n; i += 1) {
    const reviewer = ring[i];
    for (let offset = 1; offset <= effective; offset += 1) {
      const target = ring[(i + offset) % n];
      // Structurally impossible (offset is 1..n-1, so (i+offset) % n !== i), and
      // asserted anyway: this is the invariant the whole feature's integrity rests
      // on, and a future edit to the offset arithmetic must fail loudly here rather
      // than produce a self-allocation that the database CHECK then rejects at
      // INSERT time with a constraint-violation stack trace.
      if (target.studentId === reviewer.studentId) {
        throw new Error(
          `planAllocations: self-allocation at ring position ${i} offset ${offset} ` +
            `(student ${reviewer.studentId}, n=${n}, K=${effective}). This is a bug in ` +
            `the offset arithmetic, not a data problem.`,
        );
      }
      pairs.push({
        submissionId: target.submissionId,
        revieweeId: target.studentId,
        reviewerId: reviewer.studentId,
      });
    }
  }

  return {
    pairs,
    poolSize: n,
    requestedReviewsPerSubmission: requested,
    effectiveReviewsPerSubmission: effective,
    degraded: effective < requested,
    reason: null,
    ring: ring.map((s) => s.studentId),
  };
}

function emptyPlan(
  requested: number,
  poolSize: number,
  reason: AllocationSkipReason,
): AllocationPlan {
  return {
    pairs: [],
    poolSize,
    requestedReviewsPerSubmission: requested,
    effectiveReviewsPerSubmission: 0,
    degraded: false,
    reason,
    ring: [],
  };
}

/** K clamped into 1..MAX. A round asking for 0 reviews is a configuration error. */
function clampK(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_REVIEWS_PER_SUBMISSION, Math.max(1, Math.trunc(value)));
}

/**
 * Seeds must be non-negative 32-bit integers for mulberry32 to be well defined.
 * A negative or fractional seed is folded rather than rejected: the caller passes
 * an `assignments.id`, and a plan is not the place to refuse one.
 */
function normaliseSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1;
  return Math.abs(Math.trunc(seed)) % 0xffffffff || 1;
}

/**
 * How many reviews each participant owes and is owed, for the instructor surface.
 * Derived from the plan rather than recounted from the database, so the number
 * shown before allocation matches the number allocated.
 */
export function summarisePlan(plan: AllocationPlan): {
  reviewers: number;
  reviewsToWritePerReviewer: number;
  reviewsPerSubmission: number;
  totalReviews: number;
} {
  return {
    reviewers: plan.reason ? 0 : plan.poolSize,
    reviewsToWritePerReviewer: plan.effectiveReviewsPerSubmission,
    reviewsPerSubmission: plan.effectiveReviewsPerSubmission,
    totalReviews: plan.pairs.length,
  };
}
