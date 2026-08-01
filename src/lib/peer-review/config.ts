// =============================================================================
// PEER REVIEW — CONSTANTS, AND THE ONE DECISION THE WHOLE FEATURE TURNS ON.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// =============================================================================
// PEER REVIEW AWARDS NO MARKS. Read this before adding any number to any score.
// =============================================================================
//
// This is the single most consequential choice in the stream, so it is argued
// here rather than left implicit in the absence of a write.
//
// THE SCORING CONTRACT IS FROZEN AND IT WAS CHANGED TODAY IN THE OPPOSITE
// DIRECTION. src/lib/contracts/scoring.ts#assignmentPoints now returns 0 for a
// submission with `stars: null`, and the note above it (lines ~65-100 of that
// file) explains why at length: it previously started at POINTS.ASSIGNMENT_MAX and
// only deducted, so merely INGESTING a Google Form response awarded a student the
// full 40 marks, and the number went DOWN when a human finally marked it — "the
// one direction a grade must never move for a reason the student cannot see". The
// fix was to make one function the single answer to "is this graded?": null means
// ungraded, ungraded means no marks.
//
// A peer-review score that reached `submissions.score` would undo exactly that.
// It would be a SECOND path that awards points for an assignment, and it would be
// the optimistic one again: a submission nobody on staff had looked at would carry
// marks derived from two classmates. The frozen breakdown in scoring.ts has four
// buckets — quizzes 20, assignments 40, participation 10, final 30 — and there is
// no reading of it in which a classmate's opinion contributes to the assignment 40.
//
// SO WHAT DOES PEER REVIEW PRODUCE? Two things, neither of them points:
//
//   1. FEEDBACK to the reviewee, revealed when an instructor releases the round.
//      That is the feature's actual value proposition (INTEGRATION_SUMMARY.md:141,
//      "Scales feedback across cohort").
//   2. A RECORD, per reviewer, of reviews completed / outstanding / flagged, shown
//      to the instructor (src/lib/peer-review/reviews.ts#getRoundOverview).
//
// PARTICIPATION IS THE INSTRUCTOR'S TO AWARD, THROUGH THE MECHANISM THAT ALREADY
// EXISTS. POINTS.PARTICIPATION_MAX is 10 per week and lives in
// `attendance.participation_score` (src/db/schema.ts:426-438), owned by the
// penalties-attendance stream. An instructor looking at the round overview can see
// who reviewed and who did not, and can award participation there. This stream
// writes NOTHING to `attendance`, `submissions`, `progress` or `leaderboard`, and
// fires no `ScoringEvent` — so there is no second path that can award points, and
// therefore nothing for `onScoringEvent` (src/lib/leaderboard/on-scoring-event.ts)
// or the badges fan-out riding it to react to.
//
// WHY NOT A BADGE. src/lib/badges/catalogue.ts:23-24 records that
// `peer_review_master` was left out of the badge catalogue because "there is no
// `peer_reviews` table" when that stream was written. There is one now, so the
// badge is newly buildable — and it is still not built here, because the badges
// stream owns its catalogue and its `ScoringEvent` fan-out, and a peer-review
// completion is not a scoring event. Handed over rather than reached into:
//   TODO(badges): `peer_review_master` is now implementable. The fact it needs is
//   "reviewer R submitted N reviews", available as
//   `countSubmittedReviewsByReviewer(reviewerId)` in
//   src/lib/peer-review/reviews.ts. It is not a ScoringEvent, so it needs either a
//   producer call from this stream's submit path or a query in
//   src/lib/badges/facts.ts. Flagged to the badges owner; not decided here.
//
// =============================================================================
// THE GAMING QUESTION, answered plainly.
// =============================================================================
//
// A student who submits three empty reviews gains NOTHING, because there is
// nothing to gain: no marks, no badge, no leaderboard movement. That is the
// primary defence and it is structural rather than a rule.
//
// Three secondary defences exist because "no points" does not stop a student
// WASTING a classmate's reveal on the word "fine":
//   * A FLOOR ON EFFORT. `MIN_REVIEW_CHARS` and "every criterion must be scored"
//     are refusals at submit time (./validate.ts), not warnings. A 12-character
//     review cannot be stored at all.
//   * THE REVEAL IS HUMAN-GATED. `peer_review_rounds.released_at` is an instructor
//     action, so a thin review is visible to staff before it is visible to the
//     student it was written about.
//   * FLAGGING. An instructor can flag a review; a flagged review is withheld from
//     the reviewee (./visibility.ts) and listed WITH the reviewer's name for the
//     instructor. This is the "an instructor can see and override" answer, stated
//     as such.
//
// What is NOT defended: a student who writes 150 characters of fluent nonsense
// passes every automated check. No automated check can catch that, the length floor
// is a floor and not a quality measure, and pretending otherwise would be worse
// than saying so.
//
// All durations are milliseconds and all lengths are characters (house rules).
// =============================================================================

/**
 * K — peer reviews requested per submission.
 *
 * INTEGRATION_SUMMARY.md:138 says "Assign 2-3 peers to review each assignment".
 * 2 is chosen from that range as the default because K is a MULTIPLIER on the
 * reviewer's workload as well as on the reviewee's feedback: with K=3 every student
 * in a 20-strong cohort writes three ≥240-character reviews per week on top of the
 * assignment itself. The round stores its own value
 * (`peer_review_rounds.reviews_per_submission`), so an instructor opening a round
 * for a large cohort can raise it without a code change.
 */
export const DEFAULT_REVIEWS_PER_SUBMISSION = 2;

/** Hard ceiling on K, so a typo cannot ask 40 students to write 39 reviews each. */
export const MAX_REVIEWS_PER_SUBMISSION = 5;

/**
 * The effort floor, in characters of written feedback.
 *
 * 120 is roughly two full sentences. Chosen as the smallest number that cannot be
 * met by a single word or a stock phrase, and deliberately NOT higher: a floor
 * high enough to force paragraphs makes padding the rational strategy, which
 * produces worse feedback than a terse honest note. The check is on trimmed
 * length, so 120 spaces is not a review.
 */
export const MIN_REVIEW_CHARS = 120;

/**
 * Ceiling, matching the 4000 of `gradeSubmissionSchema.feedback` in the frozen
 * src/lib/contracts/validation.ts:33-38. Same interaction, same actor shape (see
 * the brief: peer review is the instructor grading interaction by a different
 * actor), so the same limit rather than a second number to reconcile.
 */
export const MAX_REVIEW_CHARS = 4000;

/**
 * Default review window from the moment a round is opened, in milliseconds.
 * 5 days: long enough to cross a weekend, short enough that reviews arrive while
 * the assignment is still fresh in the reviewer's mind.
 */
export const DEFAULT_REVIEW_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
