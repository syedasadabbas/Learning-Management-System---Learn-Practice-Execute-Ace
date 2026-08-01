// =============================================================================
// GRADE APPLICATION — instructor-admin stream.
// -----------------------------------------------------------------------------
// This module is a THIN ADAPTER. The grading write path belongs to the
// `submissions` stream (`gradeSubmission` in src/lib/submissions/grade.ts), which
// owns the `submissions` table, the grace-window lateness rules and the penalty
// side effects. instructor-admin calls it rather than issuing its own UPDATE:
// two write paths against the same row is how a grade ends up scored one way by
// the API and another way by a background job.
//
// What this file adds on top of that call:
//   * a `GradeError` carrying an HTTP status, so the route handler can answer
//     404 vs 400 vs 500 without knowing the submissions stream's error codes;
//   * the pure preview helpers in ./grade-payload.ts, re-exported, so the grading
//     form can show the score a rating will award before saving.
//
// Rules the submissions stream guarantees and this file must not duplicate:
//   * validation with the frozen `gradeSubmissionSchema` (stars 1..5 required,
//     score 0..40 optional, feedback <= 4000 chars);
//   * the score from `assignmentPoints` (stars below 3 cost 10 points each, late
//     days cost up to 20%);
//   * `onScoringEvent` fired AFTER the transaction commits, with its rejection
//     swallowed so a leaderboard failure cannot roll back a grade.
// =============================================================================

import { gradeSubmission } from "@/lib/submissions/grade";
import type { GradeSubmissionInput } from "@/lib/contracts/validation";
// async-queues stream: the graded-notification producer. See the block comment
// at its call site in `applyGrade` for why it lives here and why it is safe.
import { enqueueGradedNotification } from "@/lib/queue/producers";

// The pure half lives in ./grade-payload.ts (no database import, so it is unit
// testable). Re-exported so callers may import either module.
export {
  deriveScore,
  parseGradePayload,
  type ParsedGrade,
  type ScoreDerivation,
  type ScoreDerivationInput,
} from "./grade-payload";

// ---------------------------------------------------------------------------
// Adapter over the submissions stream's write path
// ---------------------------------------------------------------------------

export interface GradeResult {
  submissionId: number;
  studentId: number;
  weekId: number;
  score: number;
  /** What the scoring contract computed, before any instructor override. */
  derivedScore: number;
  /** True when the instructor's explicit score differed from the computed one. */
  overridden: boolean;
  stars: number;
  /** Days late after the cohort grace window. */
  daysLate: number;
  isLate: boolean;
  /** Penalty rows written as a side effect of this grade. */
  penaltiesIssued: number;
  /** Wall-clock duration of the write, in milliseconds (metric units). */
  durationMs: number;
}

/** A grading failure with the HTTP status the route handler should answer. */
export class GradeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "GradeError";
  }
}

/**
 * Persist a grade by delegating to the submissions stream.
 *
 * `actingInstructorId` is passed in rather than read from a session on purpose:
 * this function cannot authorize anything, and taking the id as an argument makes
 * that obvious. The CALLER must already have passed `apiGuard("instructor")` (the
 * route handler) or `requireStaffAction()` (the server action).
 *
 * Throws `GradeError` on failure so callers get one error type with a status
 * attached, instead of having to map the submissions stream's `GradeFailureCode`
 * union in two places.
 */
export async function applyGrade(
  input: GradeSubmissionInput | unknown,
  actingInstructorId: number,
): Promise<GradeResult> {
  const result = await gradeSubmission(input, actingInstructorId);

  if (!result.ok) {
    // "not found" is a 404; a bad payload is a 400. Anything unrecognised is
    // treated as a 400 rather than a 500: the submissions stream only returns
    // these codes for caller-caused failures, and a genuine database fault throws
    // rather than returning ok:false.
    const status =
      result.code === "submission_not_found" || result.code === "assignment_not_found"
        ? 404
        : 400;
    const detail = result.issues?.length ? ` ${result.issues.join("; ")}` : "";
    throw new GradeError(`${result.error}${detail}`, status, result.code);
  }

  // ---------------------------------------------------------------------------
  // ASYNC-QUEUES STREAM — the queue's one real producer. Three lines, additive,
  // and deliberately placed HERE rather than inside `gradeSubmission`.
  //
  // WHY HERE. `gradeSubmission` is also reached by `recordGrade` and by the
  // ingestion path in the submissions stream; putting the enqueue there would
  // fire it from call sites that are not "an instructor just graded this", and
  // one of them (a re-ingest touching graded_at) would email a student about a
  // grade they were told about days ago. `applyGrade` is the single adapter the
  // instructor UI and the instructor route both go through, which is exactly the
  // scope the notification means.
  //
  // WHY IT CANNOT DOUBLE-SEND. The idempotency key is (submission, graded_at) and
  // `jobs.idempotency_key` carries a UNIQUE INDEX, so two concurrent invocations
  // of this line — an instructor's double-click routed to two serverless
  // instances — produce one row, decided by Postgres and not by this code. See
  // src/lib/queue/keys.ts.
  //
  // WHY IT IS AWAITED BUT CANNOT FAIL THE GRADE. `enqueueGradedNotification`
  // never throws; it returns a reason and logs. Identical contract to
  // `onScoringEvent` two layers down, and for the identical reason: a
  // notification problem must not roll back or 500 a grade the instructor has
  // already been told was saved.
  //
  // COST: one extra primary-key read plus one INSERT on the grading request
  // (~490 ms of round trip on this Neon instance). The read disappears when
  // `gradeSubmission` returns its `graded_at` — TODO noted in
  // src/lib/queue/producers.ts.
  // ---------------------------------------------------------------------------
  await enqueueGradedNotification({ submissionId: result.submissionId });

  return {
    submissionId: result.submissionId,
    studentId: result.studentId,
    weekId: result.weekId,
    score: result.score,
    derivedScore: result.computedScore,
    overridden: result.overridden,
    stars: result.stars,
    daysLate: result.daysLate,
    isLate: result.isLate,
    penaltiesIssued: result.penaltiesIssued,
    durationMs: result.durationMs,
  };
}
