// =============================================================================
// MISSED-DEADLINE PENALTIES — the "nothing was handed in" half of the penalty
// wiring. Owner: submissions stream (persisting); rules owned by
// penalties-attendance (deciding).
// -----------------------------------------------------------------------------
// `PenaltyRuleInput.missedEntirely` can only be evaluated by something that knows
// a deadline has passed with no submission row. Grading cannot: it is holding a
// submission. So this runs from the cron sweep, immediately after ingestion, when
// the picture of who has submitted is as fresh as it will ever be.
//
// `evaluatePenalties` is PURE and currently a stub returning []. That means this
// module writes nothing today. That is intentional and is the point of wiring it
// now: when penalties-attendance fills in the rules, missed deadlines start being
// recorded with no change here.
// =============================================================================

import { and, eq, isNull, max } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  cohorts,
  quizAttempts,
  quizzes,
  submissions,
  users,
  weeks,
} from "@/db/schema";
import { daysLate } from "@/lib/contracts/scoring";
import { evaluatePenaltiesWithGrace } from "@/lib/penalties/rules";

import { persistPenaltyDecisions } from "./grade";
import { deadlineHasPassed, effectiveDueAt, normaliseGraceDays } from "./lateness";

/**
 * Issue missed-deadline penalties for every student who has passed an
 * assignment's effective deadline (including their cohort grace window) with no
 * submission row.
 *
 * Idempotent: `persistPenaltyDecisions` skips a decision that is already open for
 * the student with the same type and description, so re-running this does not
 * stack a new warning every hour.
 *
 * Returns the number of penalty rows actually written.
 */
export async function persistMissedDeadlinePenalties(
  options: { now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();

  // Assignments, newest deadline last. `dueAt` is notNull in the schema.
  const assignmentRows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      dueAt: assignments.dueAt,
      weekId: weeks.id,
    })
    .from(assignments)
    .innerJoin(weeks, eq(assignments.weekId, weeks.id));

  if (assignmentRows.length === 0) return 0;

  // Only students, and only those in a cohort: a student with no cohort has no
  // negotiated grace window and, more importantly, no cohort deadline to miss.
  const studentRows = await db
    .select({
      id: users.id,
      cohortId: users.cohortId,
      gracePeriodDays: cohorts.gracePeriodDays,
      cohortActive: cohorts.isActive,
    })
    .from(users)
    .innerJoin(cohorts, eq(users.cohortId, cohorts.id))
    .where(eq(users.role, "student"));

  const activeStudents = studentRows.filter((s) => s.cohortActive);
  if (activeStudents.length === 0) return 0;

  // Who HAS submitted what, as one query rather than one per (student,
  // assignment) pair — 80 students x 4 assignments would otherwise be 320
  // round trips.
  const submitted = await db
    .select({ studentId: submissions.studentId, assignmentId: submissions.assignmentId })
    .from(submissions);
  const hasSubmitted = new Set(submitted.map((s) => `${s.studentId}:${s.assignmentId}`));

  // Best quiz percentage per (student, week), so the rule input is truthful
  // rather than a hardcoded null. See the same reasoning in grade.ts.
  const quizBest = await db
    .select({
      studentId: quizAttempts.studentId,
      weekId: quizzes.weekId,
      best: max(quizAttempts.percentage),
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    // Practice quizzes only. Added in the add-on wave: this best-percentage feeds
    // the penalty rules, so without the filter a low score on the 50-question
    // exam — or an ungraded 'realtime' check, which carries no marks by design —
    // could issue a quiz_failure penalty against a student whose practice quiz
    // was fine. Whether sitting and failing a grand exam SHOULD carry its own
    // penalty is a policy question for the owner; this preserves the behaviour
    // the existing four weeks already have rather than inventing one.
    .where(eq(quizzes.kind, "practice"))
    .groupBy(quizAttempts.studentId, quizzes.weekId);
  const bestByStudentWeek = new Map<string, number>();
  for (const row of quizBest) {
    const value = Number(row.best);
    if (Number.isFinite(value)) bestByStudentWeek.set(`${row.studentId}:${row.weekId}`, value);
  }

  let written = 0;

  for (const assignment of assignmentRows) {
    for (const student of activeStudents) {
      if (hasSubmitted.has(`${student.id}:${assignment.id}`)) continue;

      const grace = normaliseGraceDays(student.gracePeriodDays);
      if (!deadlineHasPassed({ now, dueAt: assignment.dueAt, gracePeriodDays: grace })) continue;

      const decisions = evaluatePenaltiesWithGrace(
        {
          studentId: student.id,
          // RAW days past `dueAt`, grace NOT applied — the rules module applies
          // the grace window itself. Passing the graced figure here would
          // subtract it twice. See the same note in grade.ts.
          daysLate: daysLate(now, assignment.dueAt),
          quizBestPercent: bestByStudentWeek.get(`${student.id}:${assignment.weekId}`) ?? null,
          missedEntirely: true,
        },
        grace,
      );
      if (decisions.length === 0) continue;

      await db.transaction(async (tx) => {
        written += await persistPenaltyDecisions(tx, {
          studentId: student.id,
          // No human issued this; a nullable `issued_by` is what the schema
          // provides for a system-generated penalty.
          issuedBy: null,
          decisions,
          contextLabel: assignment.title,
        });
      });
    }
  }

  console.info(
    `[submissions/deadline-penalties] ${written} penalty row(s) written across ` +
      `${assignmentRows.length} assignment(s) and ${activeStudents.length} student(s) ` +
      `in ${Date.now() - startedAt} ms`,
  );

  return written;
}

/**
 * Students who have not submitted a given assignment past their deadline.
 * Exposed for the instructor-admin stream's chase-up view; no writes.
 */
export async function listMissingSubmitters(
  assignmentId: number,
  options: { now?: Date } = {},
): Promise<Array<{ studentId: number; email: string; name: string; daysLate: number }>> {
  const now = options.now ?? new Date();

  const [assignment] = await db
    .select({ id: assignments.id, dueAt: assignments.dueAt })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) return [];

  const rows = await db
    .select({
      studentId: users.id,
      email: users.email,
      name: users.name,
      gracePeriodDays: cohorts.gracePeriodDays,
      submissionId: submissions.id,
    })
    .from(users)
    .innerJoin(cohorts, eq(users.cohortId, cohorts.id))
    .leftJoin(
      submissions,
      and(eq(submissions.studentId, users.id), eq(submissions.assignmentId, assignmentId)),
    )
    .where(and(eq(users.role, "student"), eq(cohorts.isActive, true), isNull(submissions.id)));

  return rows
    .map((row) => {
      const grace = normaliseGraceDays(row.gracePeriodDays);
      return {
        studentId: row.studentId,
        email: row.email,
        name: row.name,
        daysLate: daysLate(now, effectiveDueAt(assignment.dueAt, grace)),
      };
    })
    .filter((row) => row.daysLate > 0);
}
