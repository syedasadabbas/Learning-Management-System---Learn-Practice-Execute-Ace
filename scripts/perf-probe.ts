// =============================================================================
// PER-QUERY TIMING PROBE — find the expensive read, do not guess at it.
// -----------------------------------------------------------------------------
// Owner: coordinator. Read-only: runs the app's own read models and reports how
// long each takes against the live database.
//
// WHY: page timings showed /leaderboard at ~2.1 s and /exams at ~1.6 s with TTFB
// accounting for ~99% of it, so the cost is server-side, not bundle weight. Both
// pages already use Promise.all, so it is not sequential-await sloppiness — it is
// one or more genuinely slow statements. This tells us which, before anything is
// "optimised" on a hunch.
//
// Run: npx tsx scripts/perf-probe.ts
// =============================================================================

import "dotenv/config";

import { pool, db } from "../src/db";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";

interface Timing {
  label: string;
  ms: number;
  note?: string;
}

const timings: Timing[] = [];

async function time<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const started = performance.now();
  try {
    const value = await fn();
    timings.push({
      label,
      ms: Math.round(performance.now() - started),
      note: Array.isArray(value) ? `${value.length} row(s)` : undefined,
    });
    return value;
  } catch (error) {
    timings.push({
      label,
      ms: Math.round(performance.now() - started),
      note: `THREW: ${(error as Error).message.slice(0, 80)}`,
    });
    return null;
  }
}

async function main(): Promise<void> {
  // A bare round trip, to separate network latency from query cost. Everything
  // below is at least this expensive no matter how good the SQL is.
  await time("baseline: SELECT 1", () => pool.query("SELECT 1"));
  await time("baseline: SELECT 1 (warm)", () => pool.query("SELECT 1"));

  const [student] = await db
    .select({ id: users.id, cohortId: users.cohortId, role: users.role, name: users.name })
    .from(users)
    .where(eq(users.email, "student@codequeenshub.test"))
    .limit(1);

  if (!student) {
    console.error("demo student not found — run npm run db:seed first");
    await pool.end();
    process.exit(1);
  }

  const viewer = {
    id: student.id,
    role: student.role,
    cohortId: student.cohortId,
    name: student.name,
    email: "student@codequeenshub.test",
  };

  // --- leaderboard: the worst page at ~2.1 s -------------------------------
  const lb = await import("../src/lib/leaderboard/queries");
  await time("leaderboard: getLeaderboardView (overall)", () =>
    lb.getLeaderboardView(viewer as never, { scope: "overall" } as never),
  );
  await time("leaderboard: getLeaderboardView (overall, warm)", () =>
    lb.getLeaderboardView(viewer as never, { scope: "overall" } as never),
  );
  await time("leaderboard: getLeaderboardView (per-week)", () =>
    lb.getLeaderboardView(viewer as never, { scope: "week" } as never),
  );
  await time("leaderboard: getMyStanding", () => lb.getMyStanding(viewer as never));

  // --- dashboard / progress: the most-visited page -------------------------
  const progress = await import("../src/lib/progress/query");
  await time("progress: fetchWeekAggregates (one statement)", () =>
    progress.fetchWeekAggregates(student.id),
  );
  await time("progress: fetchWeekAggregates (warm)", () =>
    progress.fetchWeekAggregates(student.id),
  );

  // --- problems: ~0.6-0.9 s ------------------------------------------------
  const problems = await import("../src/lib/problems/service");
  await time("problems: browse list", () =>
    problems.listProblems({ studentId: student.id, bank: "practice" }),
  );

  // --- analytics: the staff dashboard (Phase 2 feature 7) ------------------
  // The question this section answers: does extending /instructor/analytics with
  // five more aggregates make it a multi-second page? It does not, because the
  // five are ONE statement. The rows to compare are "instructor+admin analytics:
  // existing" (3 round trips, already parallel) against "advanced: one statement"
  // — if the second is ever much more than the baseline round trip above, the
  // statement itself has become expensive and wants an EXPLAIN, not a rewrite.
  const cohortAnalytics = await import("../src/lib/instructor/analytics");
  const advancedAnalytics = await import("../src/lib/analytics/queries");

  await time("analytics: getCohortAnalytics (existing, 3 statements)", () =>
    cohortAnalytics.getCohortAnalytics(null),
  );
  await time("analytics: getAdvancedAnalytics (feature 7, 1 statement)", () =>
    advancedAnalytics.getAdvancedAnalytics(null),
  );
  await time("analytics: getAdvancedAnalytics (warm)", () =>
    advancedAnalytics.getAdvancedAnalytics(null),
  );
  // Both read models the way the page actually loads them: one Promise.all.
  // This row IS the page's server cost.
  await time("analytics: BOTH in one wave (= the page)", () =>
    Promise.all([
      cohortAnalytics.getCohortAnalytics(null),
      advancedAnalytics.getAdvancedAnalytics(null),
    ]),
  );

  console.log("\nper-query timing (ms), against live Neon:\n");
  const width = Math.max(...timings.map((t) => t.label.length));
  for (const t of timings) {
    const bar = "#".repeat(Math.min(60, Math.round(t.ms / 25)));
    console.log(
      `${t.label.padEnd(width)}  ${String(t.ms).padStart(6)}ms  ${bar}${t.note ? `  (${t.note})` : ""}`,
    );
  }

  const baseline = timings.find((t) => t.label.includes("warm)") && t.label.includes("SELECT 1"));
  if (baseline) {
    console.log(
      `\nbaseline round trip: ${baseline.ms}ms — anything near a multiple of this is ` +
        `paying for round trips, not for query work.`,
    );
  }

  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
