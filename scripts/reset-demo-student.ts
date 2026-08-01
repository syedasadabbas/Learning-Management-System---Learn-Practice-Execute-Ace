// =============================================================================
// RESET THE DEMO STUDENT — restores the zero-activity state.
// -----------------------------------------------------------------------------
//   npx tsx scripts/reset-demo-student.ts
//
// Why this exists: the e2e suite has shared mutable state that makes spec ORDER
// load-bearing, which is not something Playwright can express.
//
//   * course-content's weeks.spec.ts asserts Weeks 2-4 are LOCKED. True only
//     while the demo student has no passing Week 1 quiz attempt. It is GET-only
//     and consumes nothing.
//   * quizzes' quiz-attempt.spec.ts deliberately consumes ALL THREE Week 1
//     attempts (fail -> pass -> exhaustion, in that order, because unlocking is
//     intentionally monotone) and unlocks Week 2 as a side effect.
//
// So the order is: seed -> course-content -> THIS SCRIPT -> quizzes -> the rest.
// Without the reset in the middle, whichever spec runs second fails on state the
// first one legitimately created — a false failure that looks like a real defect.
//
// SCOPE: touches ONLY student@codequeenshub.test. The seeded activity accounts
// (advanced/steady/struggling) are left alone, because the leaderboard and
// analytics specs assert against their scores.
// =============================================================================

import "dotenv/config";
import { eq, inArray } from "drizzle-orm";

import { db, pool } from "../src/db";
import { answers, leaderboard, progress, quizAttempts, submissions, users } from "../src/db/schema";

const DEMO_STUDENT_EMAIL = "student@codequeenshub.test";

async function main() {
  const [student] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, DEMO_STUDENT_EMAIL))
    .limit(1);

  if (!student) {
    throw new Error(`${DEMO_STUDENT_EMAIL} not found. Run: npm run db:seed`);
  }

  console.log(`Resetting ${student.name} (id ${student.id}) to zero activity.\n`);

  // Answers reference attempts, and the FK is ON DELETE CASCADE — but delete them
  // explicitly anyway so the printed count is honest about what was removed
  // rather than hiding rows behind a cascade.
  const attemptIds = (
    await db
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(eq(quizAttempts.studentId, student.id))
  ).map((row) => row.id);

  if (attemptIds.length > 0) {
    const deletedAnswers = await db
      .delete(answers)
      .where(inArray(answers.attemptId, attemptIds))
      .returning({ id: answers.id });
    console.log(`  - ${deletedAnswers.length} answer(s)`);
  }

  const deletedAttempts = await db
    .delete(quizAttempts)
    .where(eq(quizAttempts.studentId, student.id))
    .returning({ id: quizAttempts.id });
  console.log(`  - ${deletedAttempts.length} quiz attempt(s)`);

  // Progress carries the unlock flags. Deleting the rows returns the student to
  // "week 1 open, the rest locked", which is what the locked-week specs need.
  const deletedProgress = await db
    .delete(progress)
    .where(eq(progress.studentId, student.id))
    .returning({ id: progress.id });
  console.log(`  - ${deletedProgress.length} progress row(s)`);

  const deletedSubmissions = await db
    .delete(submissions)
    .where(eq(submissions.studentId, student.id))
    .returning({ id: submissions.id });
  console.log(`  - ${deletedSubmissions.length} submission(s)`);

  // Remove the board row too. Leaving a stale total would make the student appear
  // ranked with no scores behind it, and rebuildLeaderboard does not re-derive
  // component columns from the source tables by design.
  const deletedBoard = await db
    .delete(leaderboard)
    .where(eq(leaderboard.studentId, student.id))
    .returning({ id: leaderboard.id });
  console.log(`  - ${deletedBoard.length} leaderboard row(s)`);

  console.log(`\n${DEMO_STUDENT_EMAIL} is back to zero activity.`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nReset FAILED: ${err instanceof Error ? err.message : err}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
