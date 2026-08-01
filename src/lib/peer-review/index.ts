// =============================================================================
// PEER REVIEW BARREL — what this stream exposes.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// Deliberately narrow, following src/lib/notifications/index.ts's reasoning. In
// particular it does NOT re-export `submitReview`, `releaseRound`, `allocateRound`
// or `setReviewFlag`: those are the write paths, they cannot authorize anything
// themselves (they take an acting user id as an argument, which is the point), and
// the only correct way to reach them is through ./actions.ts, whose every export
// begins with a guard. A caller that imports a write path from here is a caller that
// has skipped the guard.
//
// `countSubmittedReviewsByReviewer` IS exported, because it is the fact another
// stream would need — see the badge TODO in ./config.ts.
// =============================================================================

// --- pure: allocation ------------------------------------------------------
export { planAllocations, seededShuffle, summarisePlan } from "./allocate";
export type {
  AllocatableSubmission,
  AllocationPair,
  AllocationPlan,
  AllocationSkipReason,
} from "./allocate";

// --- pure: rubric ----------------------------------------------------------
export {
  CRITERION_MAX_POINTS,
  DEFAULT_RUBRIC_CRITERIA,
  DEFAULT_RUBRIC_NAME,
  parseRubricCriteria,
  rubricMaxTotal,
  sumRubricScores,
  toRubricScoreLines,
  validateRubricScores,
} from "./rubric";
export type { RubricCriterion, RubricScoreLine } from "./rubric";

// --- pure: authorization and the reveal point ------------------------------
export {
  canReadReview,
  canWriteReview,
  isRevealedToReviewee,
  isRoundReleased,
} from "./visibility";
export type { Decision, DenyReason } from "./visibility";

// --- pure: validation ------------------------------------------------------
export { charsRemaining, parseSubmitPeerReview, submitPeerReviewSchema } from "./validate";
export type { SubmitPeerReviewInput } from "./validate";

// --- constants -------------------------------------------------------------
export {
  DEFAULT_REVIEW_WINDOW_MS,
  DEFAULT_REVIEWS_PER_SUBMISSION,
  MAX_REVIEW_CHARS,
  MAX_REVIEWS_PER_SUBMISSION,
  MIN_REVIEW_CHARS,
} from "./config";

// --- read models -----------------------------------------------------------
export {
  countSubmittedReviewsByReviewer,
  getMyReviewTasks,
  getReceivedReviews,
  getReviewTask,
  getRoundOverview,
  readReviewAsParty,
} from "./reviews";
export type {
  InstructorReviewRow,
  ReceivedReviewsForAssignment,
  RevealedReview,
  ReviewTask,
  ReviewTaskLoad,
  RoundOverview,
} from "./reviews";

export { getRound, listRounds } from "./rounds";
export type { RoundSummary } from "./rounds";
