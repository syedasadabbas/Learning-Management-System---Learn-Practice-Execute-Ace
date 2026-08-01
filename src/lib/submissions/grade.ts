// =============================================================================
// GRADING — the data side of instructor grading.
// Owner: submissions stream. CALLED BY the instructor-admin stream's UI/route
// (POST /api/instructor/submissions/:id/grade, ROUTE_AUTH "instructor").
// -----------------------------------------------------------------------------
// The seam with instructor-admin is `gradeSubmissionSchema` in
// src/lib/contracts/validation.ts (stars 1..5, score 0..40, feedback <= 4000
// chars). This module validates with that schema itself rather than trusting a
// caller to have done it: it is the last place before the UPDATE, and a stars
// value of 0 or 7 would silently produce a nonsense score through
// `assignmentPoints`.
//
// AUTHORIZATION IS NOT DONE HERE. The calling route handler must have passed
// `apiGuard("instructor")` first. This function takes the acting instructor's id
// as an argument precisely so it cannot invent one from a session.
// =============================================================================

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  cohorts,
  penalties,
  quizAttempts,
  quizzes,
  submissions,
  users,
  weeks,
} from "@/db/schema";
import type { PenaltyDecision } from "@/lib/contracts/events";
import { gradeSubmissionSchema, type GradeSubmissionInput } from "@/lib/contracts/validation";
import { onScoringEvent } from "@/lib/leaderboard/on-scoring-event";
import { evaluatePenaltiesWithGrace } from "@/lib/penalties/rules";

import { normaliseGraceDays, pointsForSubmission } from "./lateness";

export type GradeFailureCode =
  | "invalid_input"
  | "submission_not_found"
  | "assignment_not_found";

export type GradeResult =
  | {
      ok: true;
      submissionId: number;
      studentId: number;
      weekId: number;
      /** Points recorded on the submission, 0..40. */
      score: number;
      /** What `assignmentPoints` computed, before any instructor override. */
      computedScore: number;
      /** True when the caller supplied a `score` that differs from the computed one. */
      overridden: boolean;
      stars: number;
      daysLate: number;
      isLate: boolean;
      /** Penalty rows actually written by this call. */
      penaltiesIssued: number;
      /** Wall-clock duration in milliseconds (metric units). */
      durationMs: number;
    }
  | { ok: false; code: GradeFailureCode; error: string; issues?: string[] };

/**
 * Record an instructor's grade for one submission.
 *
 * Score precedence: `assignmentPoints` computes the score from the star rating
 * and the late penalty. If the caller passes an explicit `score`, that wins —
 * the field exists in `gradeSubmissionSchema`, so the contract clearly intends an
 * instructor to be able to override — but the computed value is returned
 * alongside as `computedScore` and `overridden` is set, so an override is visible
 * rather than indistinguishable from a normal grade.
 *
 * The leaderboard is notified AFTER the transaction commits and its rejection is
 * swallowed. A failure to update a ranking must never roll back a grade the
 * instructor has already been told was saved.
 */
export async function gradeSubmission(
  rawInput: GradeSubmissionInput | unknown,
  actingInstructorId: number,
): Promise<GradeResult> {
  const startedAt = Date.now();

  const parsed = gradeSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      error: "The grading payload failed validation.",
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const input = parsed.data;

  // One join to gather everything the score depends on: the submission, its
  // assignment's deadline and per-day penalty, the week it belongs to, and the
  // student's cohort grace window.
  const [context] = await db
    .select({
      submissionId: submissions.id,
      studentId: submissions.studentId,
      submittedAt: submissions.submittedAt,
      status: submissions.status,
      assignmentId: assignments.id,
      dueAt: assignments.dueAt,
      latePenaltyPercentPerDay: assignments.latePenaltyPercentPerDay,
      assignmentTitle: assignments.title,
      weekId: weeks.id,
      cohortId: users.cohortId,
      gracePeriodDays: cohorts.gracePeriodDays,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .innerJoin(users, eq(submissions.studentId, users.id))
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(eq(submissions.id, input.submissionId))
    .limit(1);

  if (!context) {
    return {
      ok: false,
      code: "submission_not_found",
      error: `No submission with id ${input.submissionId}.`,
    };
  }

  const { points: computedScore, lateness } = pointsForSubmission({
    submittedAt: context.submittedAt,
    dueAt: context.dueAt,
    gracePeriodDays: context.gracePeriodDays,
    latePenaltyPercentPerDay: context.latePenaltyPercentPerDay,
    stars: input.stars,
  });

  const score = input.score ?? computedScore;
  const overridden = input.score != null && input.score !== computedScore;

  const quizBestPercent = await bestQuizPercentForWeek(context.studentId, context.weekId);

  // Pure decision, no writes — see src/lib/penalties/rules.ts. Persisting is our
  // job. `missedEntirely` is false by definition: we are holding a submission.
  //
  // TWO THINGS THAT ARE EASY TO GET WRONG HERE, both about the grace window:
  //
  //  1. `rawDaysLate`, not `daysLate`. The rules module applies the grace window
  //     itself (`effectiveDaysLate(input.daysLate, gracePeriodDays)`), so handing
  //     it the already-graced figure would subtract the grace twice and
  //     under-issue every late-submission penalty.
  //  2. `evaluatePenaltiesWithGrace`, not `evaluatePenalties`. The frozen
  //     `evaluatePenalties` wrapper falls back to appConfig's default grace
  //     because `PenaltyRuleInput` has no cohort field. We DO know the student's
  //     cohort grace, and the rules module documents this variant as the call to
  //     make when you do.
  const decisions = evaluatePenaltiesWithGrace(
    {
      studentId: context.studentId,
      daysLate: lateness.rawDaysLate,
      quizBestPercent,
      missedEntirely: false,
    },
    normaliseGraceDays(context.gracePeriodDays),
  );

  let penaltiesIssued = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(submissions)
      .set({
        score,
        feedback: input.feedback ?? null,
        instructorRating: input.stars,
        instructorId: actingInstructorId,
        status: "graded",
        gradedAt: new Date(),
        // Recorded from the same calculation that produced the score, so the flag
        // shown to the student and the penalty applied to it cannot disagree.
        isLate: lateness.isLate,
      })
      .where(eq(submissions.id, context.submissionId));

    penaltiesIssued = await persistPenaltyDecisions(tx, {
      studentId: context.studentId,
      issuedBy: actingInstructorId,
      decisions,
      contextLabel: context.assignmentTitle,
    });
  });

  // OUTSIDE the transaction, and deliberately not awaited into the failure path.
  // The leaderboard stub is a no-op today; when it becomes a real multi-row
  // rebuild, a deadlock or timeout there must not undo this grade.
  await onScoringEvent({
    studentId: context.studentId,
    cohortId: context.cohortId,
    source: "assignment",
    weekId: context.weekId,
    points: score,
  }).catch((error: unknown) => {
    console.error(
      `[submissions/grade] leaderboard update failed for student ${context.studentId} ` +
        `after grading submission ${context.submissionId}. The grade IS saved; the ` +
        `ranking will be corrected on the next scoring event.`,
      error,
    );
  });

  return {
    ok: true,
    submissionId: context.submissionId,
    studentId: context.studentId,
    weekId: context.weekId,
    score,
    computedScore,
    overridden,
    stars: input.stars,
    daysLate: lateness.daysLate,
    isLate: lateness.isLate,
    penaltiesIssued,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// The seam instructor-admin asked for
// ---------------------------------------------------------------------------

/**
 * Grace-aware score derivation for one existing submission.
 *
 * WHY THIS EXISTS — a real divergence, reported to the coordinator:
 * `src/lib/instructor/grading.ts#deriveScore` (instructor-admin stream) computes
 * `daysLate(submittedAt, dueAt)` with NO cohort grace window. With the seeded
 * 2-day grace, a submission handed in one day past the published deadline is
 * "on time, 40/40" everywhere in this stream — the student's history page, the
 * ingested `is_late` flag — and "1 day late, 36/40" when that function grades it.
 * Same submission, two answers, and the student is the one who notices.
 *
 * The fix is one import: instructor-admin's `deriveScore` should either take a
 * `gracePeriodDays` argument or call this. It is not fixed from here, because
 * `src/lib/instructor/**` is that stream's file.
 */
export async function deriveGradeScoreForSubmission(input: {
  submissionId: number;
  stars: number;
  /** Instructor override, 0..40. When present it wins, as the schema intends. */
  explicitScore?: number;
}): Promise<
  | {
      ok: true;
      score: number;
      computedScore: number;
      overridden: boolean;
      daysLate: number;
      rawDaysLate: number;
      isLate: boolean;
      gracePeriodDays: number;
    }
  | { ok: false; code: "submission_not_found" }
> {
  const [context] = await db
    .select({
      submittedAt: submissions.submittedAt,
      dueAt: assignments.dueAt,
      latePenaltyPercentPerDay: assignments.latePenaltyPercentPerDay,
      gracePeriodDays: cohorts.gracePeriodDays,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(users, eq(submissions.studentId, users.id))
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(eq(submissions.id, input.submissionId))
    .limit(1);

  if (!context) return { ok: false, code: "submission_not_found" };

  const { points: computedScore, lateness } = pointsForSubmission({
    submittedAt: context.submittedAt,
    dueAt: context.dueAt,
    gracePeriodDays: context.gracePeriodDays,
    latePenaltyPercentPerDay: context.latePenaltyPercentPerDay,
    stars: input.stars,
  });

  return {
    ok: true,
    score: input.explicitScore ?? computedScore,
    computedScore,
    overridden: input.explicitScore !== undefined && input.explicitScore !== computedScore,
    daysLate: lateness.daysLate,
    rawDaysLate: lateness.rawDaysLate,
    isLate: lateness.isLate,
    gracePeriodDays: normaliseGraceDays(context.gracePeriodDays),
  };
}

/**
 * The narrow write helper `src/lib/instructor/grading.ts` asked for by name in its
 * `TODO(integration)` block. Signature matched deliberately so adopting it is a
 * one-line change in that file:
 *
 *     recordGrade({ submissionId, instructorId, stars, score, feedback })
 *       -> { studentId, weekId, cohortId }
 *
 * The return value is a superset of what was requested (it adds `isLate`,
 * `penaltiesIssued` and the grace-aware `computedScore`), which is structurally
 * compatible with the declared shape.
 *
 * It writes the score it is GIVEN — it does not silently substitute its own — so
 * an instructor override is honoured. `computedScore` is returned alongside so a
 * caller whose derivation ignored the grace window can see the disagreement
 * rather than have it corrected behind its back.
 *
 * `onScoringEvent` is NOT called here: the caller in instructor-admin already
 * fires it, and firing it twice would double-count the assignment points in the
 * leaderboard. Use `gradeSubmission` instead if you want the whole path.
 */
export async function recordGrade(input: {
  submissionId: number;
  instructorId: number;
  /** 1..5, already validated against `gradeSubmissionSchema`. */
  stars: number;
  /** 0..40, already derived by the caller. */
  score: number;
  feedback: string | null;
}): Promise<{
  studentId: number;
  weekId: number;
  cohortId: number | null;
  isLate: boolean;
  daysLate: number;
  /** What a grace-aware derivation would have awarded for these stars. */
  computedScore: number;
  penaltiesIssued: number;
}> {
  const [context] = await db
    .select({
      submissionId: submissions.id,
      studentId: submissions.studentId,
      submittedAt: submissions.submittedAt,
      dueAt: assignments.dueAt,
      latePenaltyPercentPerDay: assignments.latePenaltyPercentPerDay,
      assignmentTitle: assignments.title,
      weekId: weeks.id,
      cohortId: users.cohortId,
      gracePeriodDays: cohorts.gracePeriodDays,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .innerJoin(users, eq(submissions.studentId, users.id))
    .leftJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(eq(submissions.id, input.submissionId))
    .limit(1);

  if (!context) {
    throw new Error(`recordGrade: no submission with id ${input.submissionId}.`);
  }

  const { points: computedScore, lateness } = pointsForSubmission({
    submittedAt: context.submittedAt,
    dueAt: context.dueAt,
    gracePeriodDays: context.gracePeriodDays,
    latePenaltyPercentPerDay: context.latePenaltyPercentPerDay,
    stars: input.stars,
  });

  const quizBestPercent = await bestQuizPercentForWeek(context.studentId, context.weekId);
  const decisions = evaluatePenaltiesWithGrace(
    {
      studentId: context.studentId,
      // Raw days — the rules module applies the grace window itself.
      daysLate: lateness.rawDaysLate,
      quizBestPercent,
      missedEntirely: false,
    },
    normaliseGraceDays(context.gracePeriodDays),
  );

  let penaltiesIssued = 0;
  await db.transaction(async (tx) => {
    await tx
      .update(submissions)
      .set({
        score: input.score,
        feedback: input.feedback,
        instructorRating: input.stars,
        instructorId: input.instructorId,
        status: "graded",
        gradedAt: new Date(),
        isLate: lateness.isLate,
      })
      .where(eq(submissions.id, context.submissionId));

    penaltiesIssued = await persistPenaltyDecisions(tx, {
      studentId: context.studentId,
      issuedBy: input.instructorId,
      decisions,
      contextLabel: context.assignmentTitle,
    });
  });

  return {
    studentId: context.studentId,
    weekId: context.weekId,
    cohortId: context.cohortId,
    isLate: lateness.isLate,
    daysLate: lateness.daysLate,
    computedScore,
    penaltiesIssued,
  };
}

/**
 * Best quiz percentage the student has achieved for this week, or null.
 *
 * `PenaltyRuleInput.quizBestPercent` documents null as "no attempt yet". Passing
 * a hardcoded null would be a lie that the penalties stream's future rules could
 * act on (a quiz-failure penalty for a student who passed), so the real value is
 * read even though the rules are a stub today.
 */
async function bestQuizPercentForWeek(
  studentId: number,
  weekId: number,
): Promise<number | null> {
  const rows = await db
    .select({ percentage: quizAttempts.percentage })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    // `quizzes.kind = 'practice'` added in the add-on wave: the week's "best quiz
    // percentage" must keep meaning the practice quiz. Two more kinds now share
    // this table, and letting a grand exam or an ungraded realtime check win this
    // ORDER BY would silently change a figure the existing four weeks already
    // compute — the one thing the owner asked to leave untouched.
    .where(
      and(
        eq(quizAttempts.studentId, studentId),
        eq(quizzes.weekId, weekId),
        eq(quizzes.kind, "practice"),
      ),
    )
    .orderBy(desc(quizAttempts.percentage))
    .limit(1);

  if (rows.length === 0) return null;
  // `percentage` is a Postgres numeric; node-postgres returns it as a string to
  // avoid float rounding. Number() here, never a bare arithmetic coercion.
  const value = Number(rows[0].percentage);
  return Number.isFinite(value) ? value : null;
}

/** Minimal shape of the transaction handle, so this helper needs no drizzle generics. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Write penalty decisions, skipping any that are already open for this student.
 *
 * Regrading a submission re-evaluates the same rules and would otherwise stack a
 * second identical warning on the student's record every time an instructor
 * adjusts a star rating. `penalties` has no natural unique key in the frozen
 * schema, so the de-duplication is done here on (student, type, description)
 * among rows that are not yet resolved. The description is generated
 * deterministically below, which is what makes that comparison reliable.
 */
export async function persistPenaltyDecisions(
  tx: Tx,
  input: {
    studentId: number;
    issuedBy: number | null;
    decisions: readonly PenaltyDecision[];
    contextLabel: string;
  },
): Promise<number> {
  if (input.decisions.length === 0) return 0;

  const types = [...new Set(input.decisions.map((d) => d.type))];
  const open = await tx
    .select({ type: penalties.type, description: penalties.description })
    .from(penalties)
    .where(
      and(
        eq(penalties.studentId, input.studentId),
        eq(penalties.resolved, false),
        inArray(penalties.type, types),
      ),
    );
  const alreadyOpen = new Set(open.map((p) => `${p.type}::${p.description ?? ""}`));

  const toInsert = input.decisions
    .map((d) => ({
      studentId: input.studentId,
      type: d.type,
      severity: d.severity,
      description: `${d.description} (${input.contextLabel})`,
      penaltyPoints: d.penaltyPoints,
      issuedBy: input.issuedBy,
      resolved: false,
    }))
    .filter((row) => !alreadyOpen.has(`${row.type}::${row.description}`));

  if (toInsert.length === 0) return 0;
  await tx.insert(penalties).values(toInsert);
  return toInsert.length;
}
