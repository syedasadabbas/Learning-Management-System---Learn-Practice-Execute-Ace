// =============================================================================
// DEMO ACTIVITY — students who have actually DONE something.
// -----------------------------------------------------------------------------
// Added at integration because three streams independently reported the same
// gap: the base seed creates users, content and deadlines but zero attempts and
// zero submissions, so nothing downstream of scoring could be verified.
//
//   progress-tracking  could not assert "passed Week 1 -> Week 2 unlocked"
//   quizzes            could not assert a stored best-attempt percentage
//   leaderboard        seeded no leaderboard rows, so its ordering specs
//                      test.skip'd below two rows
//   instructor-admin   had an empty grading queue, so its 4-star grade test
//                      test.skip'd
//
// WHY THE LEADERBOARD IS NOT INSERTED DIRECTLY.
// Scores reach the board through `onScoringEvent`, so this module calls that hook
// rather than writing `leaderboard` rows itself. Two reasons: hand-written rows
// could disagree with what the real grading path would have produced (which is
// exactly the bug the hook exists to prevent), and calling it means the seed
// exercises the hook — the ranking transaction and its advisory lock get run on
// every seed rather than only in production.
//
// The plain demo student is deliberately left at ZERO activity. A brand-new
// account is the most common first-load state and the easiest to break, so one
// account must always represent it.
//
// Idempotent: every insert is preceded by a natural-key lookup, matching seed.ts.
// =============================================================================

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

import { db } from "../src/db";
import {
  assignments,
  cohorts,
  leaderboard,
  progress,
  quizAttempts,
  quizzes,
  submissions,
  users,
  weeks,
} from "../src/db/schema";
import {
  POINTS,
  assignmentPoints,
  daysLate,
  quizPointsFromPercent,
  shouldUnlockNextWeek,
} from "../src/lib/contracts/scoring";
import { onScoringEvent } from "../src/lib/leaderboard/on-scoring-event";

const BCRYPT_ROUNDS = 10;

/**
 * Three profiles spanning the bands scoring.ts actually distinguishes, so the
 * leaderboard has a deterministic order and the analytics panels have a real
 * distribution rather than three identical rows.
 *
 * TODO(security): development accounts sharing a published password, like the
 * base seed's. Delete or rotate before a real cohort enrols.
 */
const PROFILES = [
  {
    email: "advanced@codequeenshub.test",
    name: "Ayesha Advanced",
    // 90% -> full quiz marks (>=70 band) and unlocks Week 2.
    quizPercent: 90,
    stars: 5,
    daysLateOnAssignment: 0,
  },
  {
    email: "steady@codequeenshub.test",
    name: "Bilal Steady",
    // 70% -> exactly the pass boundary. Pins that >= is inclusive in real data,
    // not just in unit tests.
    quizPercent: 70,
    stars: 3,
    daysLateOnAssignment: 1, // inside the seeded 2-day grace window: NOT late
  },
  {
    email: "struggling@codequeenshub.test",
    name: "Chandni Struggling",
    // 60% -> the middle band (15 of 20) and BELOW the unlock line, so Week 2
    // stays locked. Gives the at-risk analytics something to report.
    quizPercent: 60,
    stars: 2,
    daysLateOnAssignment: 4, // past grace: genuinely late
  },
] as const;

type Counters = { created: number; existed: number };

export async function seedDemoActivity(log: (line: string) => void): Promise<Counters> {
  const counters: Counters = { created: 0, existed: 0 };

  const [cohort] = await db.select().from(cohorts).orderBy(cohorts.id).limit(1);
  if (!cohort) {
    log("  ! no cohort found — skipping demo activity");
    return counters;
  }

  // Week 1 is the only week these profiles complete: it is the week every
  // stream's fixtures reference, and leaving weeks 2-4 untouched keeps the
  // "later weeks are locked" assertions meaningful.
  const [week1] = await db
    .select()
    .from(weeks)
    .where(eq(weeks.weekNumber, 1))
    .orderBy(weeks.id)
    .limit(1);
  if (!week1) {
    log("  ! week 1 not found — skipping demo activity");
    return counters;
  }

  // KIND FILTER, added by qa-hardening. Week 1 now holds three quizzes (practice,
  // grand, realtime). Without `kind = 'practice'` this unordered LIMIT 1 could
  // return the GRAND exam row, and the insert below would burn each demo
  // student's single, unrepeatable exam attempt (invariant I1) while leaving the
  // practice quiz — the row progress, unlock and the leaderboard actually read —
  // with no attempt at all.
  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.weekId, week1.id), eq(quizzes.kind, "practice")))
    .limit(1);
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.weekId, week1.id))
    .limit(1);

  const [instructor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "instructor@codequeenshub.test"))
    .limit(1);

  const passwordHash = await bcrypt.hash("Passw0rd!demo", BCRYPT_ROUNDS);

  for (const profile of PROFILES) {
    // ---- the student -------------------------------------------------------
    let [student] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
    if (!student) {
      [student] = await db
        .insert(users)
        .values({
          email: profile.email,
          name: profile.name,
          passwordHash,
          role: "student",
          cohortId: cohort.id,
        })
        .returning();
      counters.created += 1;
      log(`  + student ${profile.email}`);
    } else {
      counters.existed += 1;
      log(`  = student ${profile.email} (exists)`);
    }

    let quizPoints = 0;
    let assignmentAward = 0;

    // ---- a graded quiz attempt --------------------------------------------
    if (quiz) {
      const [existingAttempt] = await db
        .select()
        .from(quizAttempts)
        .where(and(eq(quizAttempts.studentId, student.id), eq(quizAttempts.quizId, quiz.id)))
        .limit(1);

      const total = quiz.totalQuestions;
      const correct = Math.round((profile.quizPercent / 100) * total);
      quizPoints = quizPointsFromPercent(profile.quizPercent);

      if (!existingAttempt) {
        await db.insert(quizAttempts).values({
          studentId: student.id,
          quizId: quiz.id,
          score: correct,
          totalPossible: total,
          // decimal columns take a string in Drizzle; passing a number silently
          // stringifies and can lose the scale the column declares.
          percentage: profile.quizPercent.toFixed(2),
          status: "graded",
          attemptNumber: 1,
          submittedAt: new Date(),
        });
        counters.created += 1;
        log(`    + quiz attempt ${profile.quizPercent}% (${quizPoints}/${POINTS.QUIZ_MAX} pts)`);
      } else {
        counters.existed += 1;
      }
    }

    // ---- a graded submission ----------------------------------------------
    if (assignment) {
      const [existingSubmission] = await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.studentId, student.id),
            eq(submissions.assignmentId, assignment.id),
          ),
        )
        .limit(1);

      const submittedAt = new Date(
        assignment.dueAt.getTime() + profile.daysLateOnAssignment * 86_400_000,
      );
      // Grace is applied by shifting the deadline, exactly as the submissions
      // stream does, so seeded lateness agrees with what the app computes.
      const graceMs = cohort.gracePeriodDays * 86_400_000;
      const effectiveDue = new Date(assignment.dueAt.getTime() + graceMs);
      const late = daysLate(submittedAt, effectiveDue);

      assignmentAward = assignmentPoints({
        daysLate: late,
        latePenaltyPercentPerDay: assignment.latePenaltyPercentPerDay,
        stars: profile.stars,
      });

      if (!existingSubmission) {
        await db.insert(submissions).values({
          studentId: student.id,
          assignmentId: assignment.id,
          githubUrl: `https://github.com/example/${profile.email.split("@")[0]}-week1`,
          liveUrl: null,
          // Marks these as seeded rather than sheet-ingested. Non-null so the
          // unique index on (assignmentId, sheetRowRef) actually constrains them:
          // Postgres unique indexes do NOT constrain NULLs, so a null ref here
          // would let a re-seed insert a duplicate.
          sheetRowRef: `seed:${profile.email}`,
          description: "Seeded submission for local development and e2e fixtures.",
          submittedAt,
          isLate: late > 0,
          status: "graded",
          score: assignmentAward,
          feedback:
            profile.stars >= 4
              ? "Clean semantic structure and a genuinely accessible form. Well done."
              : "Structure is sound; check your heading order and label associations.",
          instructorRating: profile.stars,
          instructorId: instructor?.id ?? null,
          gradedAt: new Date(),
        });
        counters.created += 1;
        log(
          `    + submission ${profile.stars}★ ${late > 0 ? `${late}d late` : "on time"} ` +
            `(${assignmentAward}/${POINTS.ASSIGNMENT_MAX} pts)`,
        );
      } else {
        counters.existed += 1;
      }
    }

    // ---- progress row -----------------------------------------------------
    const unlocksNext = shouldUnlockNextWeek(profile.quizPercent);
    const weekScore = Math.min(quizPoints + assignmentAward, POINTS.WEEK_MAX);

    const [existingProgress] = await db
      .select()
      .from(progress)
      .where(and(eq(progress.studentId, student.id), eq(progress.weekId, week1.id)))
      .limit(1);

    if (!existingProgress) {
      await db.insert(progress).values({
        studentId: student.id,
        weekId: week1.id,
        lecturesCompleted: 3,
        quizCompleted: true,
        assignmentCompleted: Boolean(assignment),
        overallScore: weekScore,
        // Week 1 itself is always reachable; this flag records that the student
        // reached it. Whether week 2 opens is DERIVED from the quiz percentage by
        // progress-tracking, which deliberately ignores this column.
        weekUnlocked: true,
        unlockedAt: new Date(),
      });
      counters.created += 1;
      log(`    + progress week 1: ${weekScore}/${POINTS.WEEK_MAX}, unlocks week 2: ${unlocksNext}`);
    } else {
      counters.existed += 1;
    }

    // ---- push the scores onto the leaderboard through the real hook --------
    //
    // The student's board row is DELETED first, then rebuilt from the profile
    // facts. This is not belt-and-braces; it is required for the seed to be
    // idempotent.
    //
    // `onScoringEvent` is ADDITIVE for weekly sources by design — the leaderboard
    // stream documents that weekly awards are not exactly repeat-immune, because
    // exact immunity would need a per-(source, week) ledger the frozen schema has
    // no room for. The guards above correctly skip re-inserting the attempt and
    // submission on a second run, but firing the events again on top of an
    // existing row doubled every component. Observed, not theorised: a second
    // `npm run db:seed` produced quiz 40 / assignment 80 instead of 20 / 40. The
    // stream's component clamps bounded the damage well under the course ceiling,
    // which is exactly what they are for, but the numbers were still wrong.
    //
    // Deleting first makes each run compute the same final state from scratch.
    await db.delete(leaderboard).where(eq(leaderboard.studentId, student.id));

    if (quizPoints > 0) {
      await onScoringEvent({
        studentId: student.id,
        cohortId: cohort.id,
        source: "quiz",
        weekId: week1.id,
        points: quizPoints,
      });
    }
    if (assignmentAward > 0) {
      await onScoringEvent({
        studentId: student.id,
        cohortId: cohort.id,
        source: "assignment",
        weekId: week1.id,
        points: assignmentAward,
      });
    }
  }

  return counters;
}
