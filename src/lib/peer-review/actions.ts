"use server";

// =============================================================================
// SERVER ACTIONS — the peer-review stream's entire mutation surface.
// -----------------------------------------------------------------------------
// WHY ACTIONS AND NOT ROUTE HANDLERS. `ROUTES` in @/lib/contracts/api is FROZEN and
// grants this stream nothing — peer review post-dates it. src/lib/instructor/actions.ts
// states the consequence and this stream follows it exactly: "inventing
// `POST /api/instructor/quizzes` would add a path with no entry in `ROUTE_AUTH` —
// precisely the unguarded-by-omission bug that map exists to prevent". Adding four
// routes to the frozen contract at the tail of an eight-agent wave is also four more
// lines in a file every other stream is editing. Server actions keep these mutations
// inside the contract while still being guarded.
//
// EVERY EXPORT IN THIS FILE IS AN HTTP-REACHABLE POST ENDPOINT. Next.js compiles each
// one into a callable target, so an unguarded export is a public mutation. The FIRST
// STATEMENT of every action below is a guard, without exception:
//   * student actions  -> `requireUser()`, and the session's own id is the only
//     identity that reaches the query. No action takes a "reviewerId" parameter,
//     because a parameter is something a client can change.
//   * staff actions    -> `requireRole("instructor")`, which `ROLES_SATISFYING`
//     also satisfies for admins (an admin covering for an instructor should not
//     need a role change).
//
// Actions return a result object rather than throwing across the RSC boundary: a
// thrown error reaches the client as a generic "unexpected response", which tells a
// student nothing about whether their review was saved. Same contract as
// src/lib/instructor/actions.ts#ActionResult.
// =============================================================================

import { revalidatePath } from "next/cache";

import { requireRole, requireUser } from "@/lib/guard";
import { notifyPeerReviewAssigned } from "@/lib/notifications";

import { allocateRound, getRound, openRound, releaseRound, setReviewFlag } from "./rounds";
import { submitReview } from "./reviews";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: string[] };

function fail(error: string, issues?: string[]): ActionResult<never> {
  return { ok: false, error, issues };
}

// ---------------------------------------------------------------------------
// Student: submit a review
// ---------------------------------------------------------------------------

/**
 * Store the signed-in student's review.
 *
 * `reviewerId` is NOT a parameter. It comes from the session, and the query in
 * `submitReview` pins `peer_review_allocations.reviewer_id` to it, so there is no
 * value a client can supply that would let them write against somebody else's
 * allocation. That is the whole authorization story for this action and it is one
 * line long on purpose.
 */
export async function submitPeerReviewAction(input: {
  allocationId: number;
  content: string;
  rubricScores: Record<string, number>;
}): Promise<ActionResult<{ reviewId: number; totalScore: number }>> {
  const user = await requireUser("/peer-review");

  const result = await submitReview(input, user.id);
  if (!result.ok) {
    return fail(result.error, result.issues);
  }

  // Both surfaces the student can be looking at: the task list and the page they
  // just submitted from.
  revalidatePath("/peer-review");
  revalidatePath(`/peer-review/${input.allocationId}`);

  return { ok: true, data: { reviewId: result.reviewId, totalScore: result.totalScore } };
}

// ---------------------------------------------------------------------------
// Instructor: open, allocate, release, flag
// ---------------------------------------------------------------------------

export async function openPeerReviewRoundAction(input: {
  assignmentId: number;
  reviewsPerSubmission?: number;
}): Promise<ActionResult<{ roundId: number; created: boolean }>> {
  const user = await requireRole("instructor", "/instructor/peer-review");

  const result = await openRound(input, user.id);
  if (!result.ok) return fail(result.error);

  revalidatePath("/instructor/peer-review");
  return { ok: true, data: { roundId: result.round.roundId, created: result.created } };
}

/**
 * Allocate (or reconcile) reviewers, then notify the reviewers who gained work.
 *
 * THE NOTIFICATION IS DELIBERATELY AFTER THE COMMIT AND CANNOT FAIL THE
 * ALLOCATION. Identical contract, and for the identical reason, to the enqueue in
 * src/lib/instructor/grading.ts#applyGrade: `notifyPeerReviewAssigned` never throws,
 * it returns a reason and logs, so a mail problem cannot roll back or 500 an
 * allocation the instructor has already been told was saved.
 *
 * ONE MESSAGE PER REVIEWER PER RECONCILE, not one per allocation. The key is the
 * LOWEST new allocation id for that reviewer and the count is carried in the body —
 * see src/lib/notifications/keys.ts#peerReviewAssignedKey for why the key cannot be
 * the round instead. A reviewer who gains nothing is not messaged, which is what
 * makes re-running allocation safe to do repeatedly.
 *
 * COST, stated rather than hidden: one `resolveRecipient` round trip plus one INSERT
 * per newly-allocated reviewer, sequentially. src/db/index.ts measures a
 * primary-key read on this Neon instance at roughly 245 ms, so a first allocation
 * over a 20-student cohort is ~20 × (245 + 245 + insert) ms ≈ 15 s of round trips on
 * an instructor's click. That is why the loop is NOT run for a reconcile that adds
 * nobody, and it is the honest reason a TODO below suggests moving it onto the queue.
 *   TODO(peer-review): fan the per-reviewer notification out through a single
 *   `notification_email` job per reviewer enqueued in one batch INSERT, rather than
 *   one sequential producer call each. That needs a producer that accepts many
 *   recipients, which src/lib/notifications/ does not have today.
 */
export async function allocatePeerReviewersAction(input: {
  roundId: number;
}): Promise<
  ActionResult<{
    inserted: number;
    removed: number;
    reviewers: number;
    reviewsPerSubmission: number;
    degraded: boolean;
    reason: string | null;
    notified: number;
  }>
> {
  const user = await requireRole("instructor", "/instructor/peer-review");

  const result = await allocateRound(input.roundId, user.id);
  if (!result.ok) return fail(result.error);

  const round = await getRound(input.roundId);
  let notified = 0;

  if (round && result.newlyAllocatedReviewerIds.length > 0) {
    // Lowest new allocation id per reviewer, so the key is stable and one reconcile
    // produces one message. Recomputed from the plan rather than returned by
    // `allocateRound`, which reports ids it inserted without grouping them.
    const lowestByReviewer = new Map<number, number>();
    for (const reviewerId of result.newlyAllocatedReviewerIds) {
      const owed = result.plan.pairs.filter((p) => p.reviewerId === reviewerId);
      if (owed.length === 0) continue;
      lowestByReviewer.set(reviewerId, Math.min(...owed.map((p) => p.submissionId)));
    }

    for (const [reviewerId, keySeed] of lowestByReviewer) {
      const outcome = await notifyPeerReviewAssigned({
        reviewerId,
        // The key seed is the lowest SUBMISSION id this reviewer was given, not an
        // allocation id: `allocateRound` does not return the ids it inserted mapped
        // back to their pairs, and a submission id is equally insert-once and
        // equally stable. Documented here because ./keys.ts's parameter is named
        // `allocationId` — the shape of the key is what matters, not which
        // insert-once id fills it, and mixing the two would be a collision only if
        // the same reviewer were notified once by each, which never happens.
        allocationId: keySeed,
        count: result.plan.pairs.filter((p) => p.reviewerId === reviewerId).length,
        assignmentTitle: round.assignmentTitle,
        weekNumber: round.weekNumber,
        dueAt: round.reviewDueAt,
      });
      if (outcome.ok) notified += 1;
    }
  }

  revalidatePath("/instructor/peer-review");
  revalidatePath("/peer-review");

  return {
    ok: true,
    data: {
      inserted: result.inserted,
      removed: result.removed,
      reviewers: result.plan.reason ? 0 : result.plan.poolSize,
      reviewsPerSubmission: result.plan.effectiveReviewsPerSubmission,
      degraded: result.plan.degraded,
      reason: result.plan.reason,
      notified,
    },
  };
}

/**
 * THE RELEASE SWITCH. Nothing a student can call, ever — the guard is the first
 * statement and `requireRole("instructor")` redirects a student to
 * /login?error=forbidden rather than returning a result they could act on.
 */
export async function releasePeerReviewRoundAction(input: {
  roundId: number;
}): Promise<ActionResult<{ revealed: number; alreadyReleased: boolean }>> {
  const user = await requireRole("instructor", "/instructor/peer-review");

  const result = await releaseRound(input.roundId, user.id);
  if (!result.ok) return fail(result.error);

  revalidatePath("/instructor/peer-review");
  // Every reviewee's own page changes state the instant this lands.
  revalidatePath("/peer-review");

  return {
    ok: true,
    data: { revealed: result.revealed, alreadyReleased: result.alreadyReleased },
  };
}

/**
 * Flag or unflag a review. The gaming defence's one write — see
 * ./config.ts for why the answer to gaming is visibility rather than a deduction.
 */
export async function setPeerReviewFlagAction(input: {
  reviewId: number;
  flagged: boolean;
  note?: string;
}): Promise<ActionResult<{ flagged: boolean }>> {
  const user = await requireRole("instructor", "/instructor/peer-review");

  const result = await setReviewFlag(input, user.id);
  if (!result.ok) return fail(result.error);

  revalidatePath("/instructor/peer-review");
  revalidatePath("/peer-review");
  return { ok: true, data: { flagged: result.flagged } };
}
