// =============================================================================
// AUTHORIZATION AND THE REVEAL POINT. PURE: no database, no session, no clock
// except the one passed in.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// This file answers hard questions 2 and 3 of the brief. It is pure so that the
// NEGATIVES — the cases that must be refused — can be enumerated as a table in
// ./visibility.test.ts. That matters more than usual here: an authorization bug in
// this feature does not throw, it silently shows one student another student's
// feedback, and an e2e test can only cover the paths someone thought to click.
//
// =============================================================================
// WHAT THIS STREAM'S AUTHORIZATION IS *NOT*.
// =============================================================================
// It is NOT the role check. That is src/lib/guard.ts against the frozen
// ROLES_SATISFYING table, and every page and action in this stream calls it first.
// Role authorization answers "is this a signed-in student?"; this file answers the
// question role authorization cannot: "is this signed-in student allowed to see
// THIS row?" — which for peer review is the whole game, because every actor is a
// student with an identical role.
//
// =============================================================================
// THE ANONYMITY MODEL, stated exactly.
// =============================================================================
//
// REVIEWS ARE ANONYMOUS TO THE REVIEWEE. The person whose work was reviewed never
// learns who reviewed it, from any surface this stream ships. That is the roadmap's
// own stated mitigation for bias (roadmap:758, "Anonymous reviews by default") and
// INTEGRATION_SUMMARY.md:139.
//
// IT IS NOT DOUBLE-BLIND, AND CLAIMING OTHERWISE WOULD BE A LIE. A reviewer opens a
// submission whose artefacts are `submissions.github_url` and
// `submissions.live_url` (schema.ts:384-385) — a GitHub repository URL contains its
// owner's account name, and a deployed site commonly carries the author's name in
// its footer. So:
//   * this stream does NOT send the author's name, email or user id to the reviewer
//     (see `REVIEWER_FACING_FIELDS` and the projection in ./reviews.ts), and
//   * the reviewer can very often work out who they are reviewing anyway, from the
//     artefact itself.
// The honest description is SINGLE-BLIND, ENFORCED, plus best-effort reviewer-side
// blinding that the data model supports and the artefact defeats. Making it truly
// double-blind would mean proxying or rehosting student repositories, which is a
// different project.
//
// HOW THE DATA MODEL ENFORCES THE HALF THAT IS ENFORCED:
//   1. `peer_reviews` HAS NO `reviewer_id` COLUMN (src/db/schema.peer-review.ts,
//      §2 of its header). The reviewer is reachable only by joining
//      `peer_review_allocations`. A reviewee-facing query cannot leak an identity
//      by forgetting a projection, because the identity is not in the table it
//      reads.
//   2. The reviewee-facing type `RevealedReview` (./reviews.ts) HAS NO FIELD in
//      which an identity could travel. There is nowhere to put one, so a future
//      edit that wanted to leak one would have to widen a type — a visible act.
//   3. It is asserted against the real returned object, not against prose:
//      ./reviews.anonymity.test.ts serialises what the reviewee-facing read model
//      returns and fails if the reviewer's id, name or email appears anywhere in
//      it, including nested.
//
// =============================================================================
// THE REVEAL POINT.
// =============================================================================
// A review becomes visible to its reviewee when ALL of:
//   (a) it has been submitted (a row exists — there are no drafts),
//   (b) the round has been RELEASED by an instructor (`released_at` is not null),
//   (c) it has not been flagged by an instructor.
// Before (b), no student can read any review of their own work, and that is checked
// here rather than in the query, so a second read path cannot forget it.
//
// WHY AN INSTRUCTOR SWITCH RATHER THAN "AFTER THE REVIEW DEADLINE". A calendar
// reveal fires unattended, which means the first person to read a one-word review
// is the student it is about. The switch puts a human between a thin review and the
// person it would land on, and that human gate IS the gaming defence named in
// ./config.ts. It follows the release-switch pattern already on this branch
// (commit e4c0329, subject sections).
//
// A REVIEWER CAN ALWAYS SEE THEIR OWN SUBMITTED REVIEW, released or not. It is
// their own writing; withholding it would be theatre, and they need to be able to
// check what they said.
// =============================================================================

/** The round facts an authorization decision needs. */
export interface RoundVisibilityState {
  releasedAt: Date | null;
}

/** The allocation facts an authorization decision needs. */
export interface AllocationAuthzState {
  reviewerId: number;
  revieweeId: number;
}

/** The review facts an authorization decision needs. */
export interface ReviewVisibilityState {
  submittedAt: Date | null;
  flaggedAt: Date | null;
}

export type DenyReason =
  /** The viewer is neither the reviewer nor the reviewee of this allocation. */
  | "not_a_party"
  /** The viewer is the reviewee and the round has not been released. */
  | "not_released"
  /** No review has been written yet. */
  | "not_submitted"
  /** An instructor withheld this review. */
  | "flagged"
  /** The viewer already submitted this review; there is no edit path. */
  | "already_submitted"
  /** The viewer is not the reviewer this allocation belongs to. */
  | "not_the_reviewer";

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason };

const ALLOW: Decision = { allowed: true };
const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

/**
 * May `viewerId` READ the review attached to this allocation?
 *
 * The three refusals, in the order they are checked, are the three negatives the
 * brief asks to be tested:
 *   not_a_party   — reading a review of work that is not yours and that you were
 *                   not asked to review. The commonest attack is guessing an
 *                   allocation id, and the FIRST check refuses it.
 *   not_submitted — there is nothing there yet.
 *   not_released  — the reveal point, for the reviewee only.
 *   flagged       — withheld from the reviewee, still visible to its author.
 *
 * A STAFF VIEWER IS NOT HANDLED HERE. Instructors read through
 * ./reviews.ts#getRoundOverview, which is guarded by `requireRole("instructor")`
 * and is a different query with different columns (it deliberately DOES carry
 * reviewer identity — accountability is the point of it). Threading a role through
 * this function would create one code path whose answer depends on a boolean, and
 * that boolean defaulting wrong is how a student reads the instructor's view.
 */
export function canReadReview(params: {
  viewerId: number;
  allocation: AllocationAuthzState;
  round: RoundVisibilityState;
  review: ReviewVisibilityState | null;
}): Decision {
  const { viewerId, allocation, round, review } = params;

  const isReviewer = viewerId === allocation.reviewerId;
  const isReviewee = viewerId === allocation.revieweeId;
  if (!isReviewer && !isReviewee) return deny("not_a_party");

  if (!review || review.submittedAt == null) return deny("not_submitted");

  // The author of a review may always re-read it. Checked before the release gate
  // because the release gate is about the REVIEWEE seeing feedback, not about the
  // reviewer seeing their own writing.
  if (isReviewer) return ALLOW;

  if (round.releasedAt == null) return deny("not_released");
  if (review.flaggedAt != null) return deny("flagged");
  return ALLOW;
}

/**
 * May `viewerId` WRITE the review for this allocation?
 *
 * Two refusals, both of which the brief asks to be tested:
 *   not_the_reviewer  — including the case where the viewer is the REVIEWEE, who
 *                       has more motive than anyone to write their own review.
 *   already_submitted — there is no edit path. The database backs this up
 *                       (`peer_reviews_allocation_idx` is UNIQUE), so even if this
 *                       returned `allowed` the INSERT would be refused; the check
 *                       exists so the refusal is a sentence rather than a 23505.
 *
 * NOTE WHAT IS NOT A CONDITION: the review deadline. `review_due_at` is advisory
 * (./config.ts) and a late review is better than no review. Refusing after the
 * deadline would produce reviewees with no feedback in exchange for punctuality
 * nobody is scored on.
 */
export function canWriteReview(params: {
  viewerId: number;
  allocation: AllocationAuthzState;
  existingReview: ReviewVisibilityState | null;
}): Decision {
  const { viewerId, allocation, existingReview } = params;
  if (viewerId !== allocation.reviewerId) return deny("not_the_reviewer");
  if (existingReview && existingReview.submittedAt != null) return deny("already_submitted");
  return ALLOW;
}

/**
 * Is the round released, i.e. may reviewees read their feedback at all?
 *
 * A named function rather than an inline `!= null` at four call sites, because
 * "released" is a product concept and the day it stops being "one column is not
 * null" there must be one place to change.
 */
export function isRoundReleased(round: RoundVisibilityState): boolean {
  return round.releasedAt != null;
}

/**
 * Would this review be shown to its reviewee if they looked right now?
 *
 * Used by the instructor overview to render "released / withheld / not yet
 * submitted" without duplicating the rule, and by the reviewee read model as the
 * filter. Same three conditions as `canReadReview`'s reviewee branch, expressed
 * once.
 */
export function isRevealedToReviewee(params: {
  round: RoundVisibilityState;
  review: ReviewVisibilityState | null;
}): boolean {
  const { round, review } = params;
  if (!review || review.submittedAt == null) return false;
  if (round.releasedAt == null) return false;
  return review.flaggedAt == null;
}

/**
 * The ONLY fields of a submission a reviewer is given.
 *
 * A list of literal field names, exported as a value, so that
 * ./reviews.anonymity.test.ts can assert the reviewer-facing projection contains
 * nothing else — in particular not `studentName`, `studentEmail` or `studentId`.
 * See the header for why this is best-effort blinding rather than a guarantee: the
 * URLs themselves frequently identify their author.
 */
export const REVIEWER_FACING_SUBMISSION_FIELDS = [
  "submissionId",
  "githubUrl",
  "liveUrl",
  "description",
  "assignmentTitle",
  "weekNumber",
] as const;

/**
 * Field names that must NEVER appear in anything a reviewee can read about a
 * review of their own work.
 *
 * Exported as data so the anonymity test is a loop over this list rather than six
 * hand-written assertions that a seventh field can be added past.
 */
export const REVIEWER_IDENTITY_FIELDS = [
  "reviewerId",
  "reviewerName",
  "reviewerEmail",
  "reviewer",
  "revieweeId",
  "allocationId",
] as const;
