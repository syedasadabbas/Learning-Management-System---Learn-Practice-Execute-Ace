// =============================================================================
// CERTIFICATE ELIGIBILITY — "has this student finished the course?"
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// THIS FILE RUNS NO SQL OF ITS OWN, AND THAT IS THE POINT.
//
// The roadmap's integration note for this feature (IMPLEMENTATION_ROADMAP.md:206)
// says "hook into progress calculation (src/lib/progress/)". The tempting version
// is a bespoke `SELECT ... FROM progress WHERE student_id = $1` that counts
// completed weeks, and it would be wrong within a week of being written: the
// definition of "complete" lives in `isWeekComplete`
// (src/lib/progress/dashboard.ts:88) and it is not obvious —
//
//   * a week with no authored work is NOT complete ("hasWork"), so a
//     half-authored course cannot mint certificates;
//   * `quizCompleted` is satisfied by a week with zero quizzes, but only if the
//     week has other work;
//   * `assignmentCompleted` means DELIVERED, not graded (aggregate.ts:63) — so a
//     student who has handed everything in has "completed" the course even while
//     an instructor still owes them marks;
//   * `unlocked` folds in BOTH gates: the quiz-progression chain and the
//     `appConfig.curriculumSections` release switch.
//
// A second implementation of that would drift, and the direction it drifts is
// the dangerous one: issuing a credential to a student who has not earned it.
// So eligibility is a PURE PREDICATE over `DashboardModel`, which is already the
// one read model the dashboard, the week list and the leaderboard share.
//
// The db-backed entry point is `getCertificateEligibility`, which is one call to
// `getDashboard` — i.e. exactly ONE database round trip (see its header), the
// same statement the dashboard page already runs.
// =============================================================================

import { getDashboard, isWeekComplete, type DashboardModel } from "@/lib/progress";

/**
 * Why a student cannot be issued a certificate yet. `null` when they can.
 *
 * A discriminated reason rather than a boolean because the gallery page has to
 * TELL the student what is missing, and "not eligible" is the message that makes
 * a support request. `no_content` and `weeks_incomplete` are genuinely different
 * situations — one is the course's fault and one is the student's.
 */
export type IneligibilityReason =
  /** The course has no weeks authored at all. Nothing to complete. */
  | "no_content"
  /** At least one week is not finished (or is still locked). */
  | "weeks_incomplete";

export interface CertificateEligibility {
  eligible: boolean;
  reason: IneligibilityReason | null;
  weeksCompleted: number;
  weeksTotal: number;
  /** Week numbers still outstanding, ascending. Empty when eligible. */
  outstandingWeekNumbers: number[];
  /** Points earned / available at the moment of the check. */
  scorePoints: number;
  maxScorePoints: number;
  /**
   * The date that would be printed as the completion date, or null when not
   * eligible. See `completionDateFor` for why this is "now" and not a stored
   * event timestamp.
   */
  completedAt: Date | null;
}

/**
 * 100% OF THE COURSE, WHICH MEANS EVERY WEEK, NOT A POINTS THRESHOLD.
 *
 * The roadmap says "on 100% course completion" (line 135). Read as a points
 * percentage that is unreachable in practice and wrong in principle: an
 * assignment scores 0 until an instructor rates it (scoring.ts#assignmentPoints,
 * changed 2026-07-31) and 3 stars out of 5 is full marks, so a student who has
 * done everything asked of them sits well under 100% of `maxScorePoints` and
 * would never qualify. Worse, the number MOVES after issuance as marking lands.
 *
 * Completion is therefore DELIVERY of every week, exactly as the dashboard's
 * `weeksCompleted` counter already reports it. The score is recorded on the
 * certificate as evidence, and it gates nothing.
 *
 * Pure. `model` in, verdict out — no clock, no database, no config.
 */
export function evaluateEligibility(
  model: DashboardModel,
  now: Date = new Date(),
): CertificateEligibility {
  const weeksTotal = model.weeks.length;

  // BOTH `isWeekComplete` AND `unlocked`, and the second half is not redundant.
  // `isWeekComplete` (src/lib/progress/dashboard.ts:88) looks only at lectures,
  // quiz and assignment — it never consults `unlocked`. That is right for the
  // dashboard's completion counter and wrong for issuing a credential, because a
  // week can hold completed work AND be shut: `deriveWeekLockStates` puts the
  // `appConfig.curriculumSections` release switch AHEAD of everything, including
  // the "week 1 is always unlocked" rule, so an admin who withdraws a subject
  // closes weeks whose work is already recorded. Certifying "all 4 weeks of this
  // course" while one of them has been withdrawn from the cohort is the claim this
  // conjunction refuses to make.
  //
  // The conservative direction, deliberately: closing a subject BLOCKS new
  // certificates and cannot alter one already issued, because an issued
  // certificate asserts its frozen snapshot and is never recomputed.
  const done = (w: (typeof model.weeks)[number]) => isWeekComplete(w) && w.unlocked;

  const outstandingWeekNumbers = model.weeks
    .filter((w) => !done(w))
    .map((w) => w.weekNumber)
    .sort((a, b) => a - b);

  const base = {
    // Counted with the same predicate as `outstandingWeekNumbers`, NOT taken from
    // `model.weeksCompleted`: that field uses `isWeekComplete` alone, so on a
    // course with a withdrawn subject the two would disagree and the certificate
    // would print a week count its own eligibility rule rejected.
    weeksCompleted: model.weeks.filter(done).length,
    weeksTotal,
    outstandingWeekNumbers,
    scorePoints: model.totalScore,
    maxScorePoints: model.maxScore,
  };

  // An empty course is checked FIRST and separately. Without this branch
  // `outstandingWeekNumbers.length === 0` is vacuously true on zero weeks and a
  // brand-new deployment with no content would hand every registered student a
  // certificate for finishing nothing.
  if (weeksTotal === 0) {
    return { ...base, eligible: false, reason: "no_content", completedAt: null };
  }

  if (outstandingWeekNumbers.length > 0) {
    return { ...base, eligible: false, reason: "weeks_incomplete", completedAt: null };
  }

  return { ...base, eligible: true, reason: null, completedAt: completionDateFor(now) };
}

/**
 * The date a certificate records as the completion date.
 *
 * IT IS "NOW", AND THE HONEST VERSION OF WHY: nothing in this schema records
 * when the last outstanding item was finished. `progress.updated_at` is a
 * denormalised column several streams write (see the note in aggregate.ts about
 * `overallScore`), submissions carry `submitted_at` but a week can complete on a
 * lecture view instead, and the unlock chain is derived rather than event-sourced.
 * Reconstructing a true completion instant would mean adding an event log, which
 * is a different feature.
 *
 * So completion is observed at the moment eligibility is first checked and then
 * FROZEN into `certificates.completed_at`. The consequence, stated rather than
 * hidden: a student who finishes on Friday and does not open the site until
 * Monday gets Monday's date. That is a small inaccuracy in one direction (never
 * earlier than the truth), it is stable forever once issued, and it is strictly
 * better than a date that changes on every re-read.
 *
 * TODO(progress): if a completion EVENT is ever emitted (the natural home is
 * `onScoringEvent`, src/lib/leaderboard/on-scoring-event.ts, which already fires
 * on every grading event), pass its timestamp to `issueCertificate` and this
 * approximation disappears.
 */
export function completionDateFor(now: Date): Date {
  return now;
}

/**
 * Eligibility for one student, read from the shared progress model.
 *
 * ONE database round trip. `getDashboard` runs the single aggregate statement in
 * src/lib/progress/query.ts and everything after it is the pure function above.
 */
export async function getCertificateEligibility(
  studentId: number,
  now: Date = new Date(),
): Promise<CertificateEligibility> {
  const model = await getDashboard(studentId, now);
  return evaluateEligibility(model, now);
}
