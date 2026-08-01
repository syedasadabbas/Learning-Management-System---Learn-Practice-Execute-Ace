// =============================================================================
// DATABASE SMOKE CHECK — owned by devops-testing.
// -----------------------------------------------------------------------------
//   npx tsx scripts/smoke-db.ts
//
// Executes each stream's real read query against the real database and prints
// what came back. This exists because unit tests across every stream mock at the
// query boundary — a deliberate and correct choice for testing pure derivation,
// but it means the SQL itself can be entirely unexercised. A wrong column name
// in a multi-CTE statement typechecks perfectly and fails only at runtime.
//
// Run this before the Playwright suite. It is far cheaper to diagnose a broken
// query here than through a browser three layers up, and it fails fast: a
// syntax error surfaces in seconds rather than as a mystery 500 in an e2e trace.
//
// Read-only. Writes nothing, so it is safe to run against any environment.
// =============================================================================

import "dotenv/config";
import { eq } from "drizzle-orm";

import { db, pool } from "../src/db";
import { users } from "../src/db/schema";
import type { AuthUser } from "../src/lib/guard";

type Check = { name: string; run: () => Promise<string> };

const DEMO_STUDENT_EMAIL = "student@codequeenshub.test";

let passed = 0;
let failed = 0;

/**
 * The seeded demo student, shaped as the session user guard.ts hands downstream.
 * Typed as AuthUser rather than a hand-rolled object literal: the first version
 * of this script passed a bare studentId where an AuthUser was expected, which
 * JavaScript accepted happily and reported as a PASS. Borrowing the real type is
 * what turns that into a compile error.
 */
async function resolveViewer(): Promise<AuthUser> {
  const [student] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      cohortId: users.cohortId,
    })
    .from(users)
    .where(eq(users.email, DEMO_STUDENT_EMAIL))
    .limit(1);
  if (!student) {
    throw new Error(
      `Demo student ${DEMO_STUDENT_EMAIL} not found. Run: npm run db:seed`,
    );
  }
  return student;
}

async function main() {
  console.log("Database smoke check — executing each stream's real SQL.\n");

  const viewer = await resolveViewer();
  const studentId = viewer.id;
  console.log(`Demo student id: ${studentId} (cohort ${viewer.cohortId ?? "none"})\n`);

  const checks: Check[] = [
    {
      // The single highest-risk query in the repo: one multi-CTE statement that
      // course-content, leaderboard, instructor-admin and the dashboard all read
      // through. Every one of them breaks together if this is wrong.
      name: "progress-tracking · fetchWeekAggregates (multi-CTE aggregate)",
      run: async () => {
        const { fetchWeekAggregates } = await import("../src/lib/progress/query");
        const rows = await fetchWeekAggregates(studentId);
        if (rows.length === 0) {
          return "0 rows — no weeks resolved for this student (check course resolution)";
        }
        const first = rows[0];
        return (
          `${rows.length} week row(s); week ${first.weekNumber} ` +
          `lectureTotal=${first.lectureTotal} ` +
          `quizBest=${first.quizBestPercent ?? "null"}`
        );
      },
    },
    {
      name: "progress-tracking · getWeekProgress (read model)",
      run: async () => {
        const { getWeekProgress } = await import("../src/lib/progress/read-model");
        const weeks = await getWeekProgress(studentId);
        const unlocked = weeks.filter((w) => w.unlocked).map((w) => w.weekNumber);
        return `${weeks.length} week(s); unlocked=[${unlocked.join(", ")}]`;
      },
    },
    {
      name: "progress-tracking · getDashboard",
      run: async () => {
        const mod = await import("../src/lib/progress/dashboard");
        const dash = await mod.getDashboard(studentId);
        const json = JSON.stringify(dash);
        // A zero-activity student is the normal first state; these tokens mean
        // an unguarded division or date reached the payload.
        for (const bad of ["NaN", "Infinity", "Invalid Date"]) {
          if (json.includes(bad)) throw new Error(`dashboard payload contains "${bad}"`);
        }
        return `built; no NaN/Infinity/Invalid Date in payload`;
      },
    },
    {
      name: "leaderboard · getLeaderboardView (overall)",
      run: async () => {
        const { getLeaderboardView } = await import("../src/lib/leaderboard/queries");
        const view = await getLeaderboardView(viewer, {
          scope: "overall",
          cohortId: null,
          weekId: null,
          sort: "rank",
          direction: null,
        });
        const json = JSON.stringify(view);
        // Privacy invariant: a student may read the whole cohort board, so no
        // email must ever reach the payload.
        if (/"email"/i.test(json)) throw new Error("leaderboard payload contains an email field");
        return `${view.entries?.length ?? 0} entr(ies); no email field present`;
      },
    },
    {
      name: "leaderboard · getLeaderboardView (per-week)",
      run: async () => {
        const { getLeaderboardView } = await import("../src/lib/leaderboard/queries");
        const view = await getLeaderboardView(viewer, {
          scope: "week",
          cohortId: null,
          weekId: null, // resolves to week 1 rather than erroring, by design
          sort: "rank",
          direction: null,
        });
        return `week scope resolved; ${view.entries?.length ?? 0} entr(ies)`;
      },
    },
    {
      name: "leaderboard · getMyStanding",
      run: async () => {
        const { getMyStanding } = await import("../src/lib/leaderboard/queries");
        const standing = await getMyStanding(viewer);
        return standing ? `rank=${standing.ranking ?? "unranked"}` : "no leaderboard row yet";
      },
    },
    {
      name: "quizzes · loadStudentQuizByWeek (week 1) + answer-key barrier",
      run: async () => {
        const svc = await import("../src/lib/quizzes/service");
        const quiz = await svc.loadStudentQuizByWeek(1, studentId);
        if (!quiz) return "no quiz found for week 1";
        const json = JSON.stringify(quiz);
        // The whole point of the payload builder: these must be absent on the wire.
        for (const leak of ["isCorrect", "explanation"]) {
          if (json.includes(leak)) throw new Error(`student quiz payload leaks "${leak}"`);
        }
        return `loaded; isCorrect and explanation both absent from the payload`;
      },
    },
    {
      name: "attendance · attendanceGridForWeek (week 1)",
      run: async () => {
        const svc = await import("../src/lib/attendance/service");
        const grid = await svc.attendanceGridForWeek(1);
        return `${Array.isArray(grid) ? grid.length : "?"} row(s)`;
      },
    },
    {
      name: "penalties · penaltySummary",
      run: async () => {
        const svc = await import("../src/lib/penalties/service");
        const summary = await svc.penaltySummary(studentId);
        return JSON.stringify(summary);
      },
    },
  ];

  for (const check of checks) {
    try {
      const detail = await check.run();
      passed += 1;
      console.log(`  PASS  ${check.name}\n        ${detail}`);
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${check.name}\n        ${message.split("\n")[0]}`);
    }
  }

  console.log(
    `\n${"-".repeat(70)}\n${passed} passed, ${failed} failed of ${checks.length} checks.`,
  );
  if (failed > 0) throw new Error(`${failed} smoke check(s) failed`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nSmoke check FAILED: ${err instanceof Error ? err.message : err}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
