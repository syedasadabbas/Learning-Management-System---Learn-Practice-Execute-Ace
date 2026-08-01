// =============================================================================
// RESET E2E RESIDUE — the suite-level counterpart to reset-demo-student.ts.
// Owned by devops-testing (test support).
// -----------------------------------------------------------------------------
//   npx tsx scripts/reset-e2e-state.ts          # report and clean
//   npx tsx scripts/reset-e2e-state.ts --report # report only, write nothing
//
// WHY THIS EXISTS. `workers: 1` (playwright.config.ts:29) removes the RACE between
// specs but not the ORDER DEPENDENCE between them, and it does nothing at all about
// residue that OUTLIVES A RUN. Three kinds accumulate in the one shared database,
// and each one has been observed:
//
//   1. THROWAWAY ACCOUNTS. The registration and account specs create a student with
//      a random address each time and never delete it. On 2026-07-31 the shared
//      database held 25 of them (`e2e-…@codequeenshub.test`,
//      `e2e-account-…@codequeenshub.test`) against 3 real demo accounts. None is
//      in a cohort, so none reaches the leaderboard today — but every one is a row
//      that any future "how many students are there" assertion would count, and the
//      table only grows.
//   2. INGESTION-DERIVED SUBMISSIONS. Assignment ingestion genuinely writes now. Its
//      own spec cleans up (`sheet_row_ref LIKE 'v1:%'`), but the manual sweep
//      endpoint and the cron sweep run outside Playwright and never call a spec's
//      afterAll — and until dotenv was loaded into the test process, the spec's
//      cleanup silently no-op'd as well, which is how `submissions.id = 8` came to be
//      sitting in the table with nobody's name on it.
//   3. E2E VIDEO CANDIDATES. tests/e2e/fixtures.ts createVideoCandidate() writes a
//      `topic_videos` row with `source = 'e2e'` and removes it in afterEach. A killed
//      process skips that, and the leftover is then exactly the unowned state the
//      video-review spec was repaired to stop depending on.
//
// WHAT IT DOES NOT TOUCH, on purpose:
//   * the 3 demo accounts, and the 3 seeded activity accounts (advanced / steady /
//     struggling) — the leaderboard and analytics specs assert against their scores;
//   * the 77 harvested `topic_videos` rows and every approval decision on them —
//     the course-content specs assert a lecture PLAYS an approved video (46b9d4e);
//   * seed-derived submissions, whose refs are 'seed:<email>';
//   * the demo student's own attempts / progress / leaderboard row. That is
//     reset-demo-student.ts's job and it must stay separate, because it has to run
//     BETWEEN two groups of specs rather than once at the start. See its header.
//
// Idempotent: a second run reports zero of everything. Safe to run before every
// suite, which is where the checklist puts it.
// =============================================================================

import "dotenv/config";
import { pool } from "../src/db";

/** Accounts the suite creates and never removes. Anchored, so no real user matches. */
const THROWAWAY_EMAIL_PATTERN = "e2e-%@codequeenshub.test";

const reportOnly = process.argv.includes("--report");

interface Sweep {
  label: string;
  /** COUNT of rows the delete would remove. Run first so the report is honest. */
  count: string;
  del: string;
  params?: readonly unknown[];
}

const sweeps: Sweep[] = [
  {
    label: "topic_videos created by an e2e fixture (source = 'e2e')",
    count: "SELECT count(*)::int AS n FROM topic_videos WHERE source = 'e2e'",
    del: "DELETE FROM topic_videos WHERE source = 'e2e'",
  },
  {
    label: "ingestion-derived submissions for the demo student (sheet_row_ref 'v1:%')",
    count: `SELECT count(*)::int AS n FROM submissions
             WHERE sheet_row_ref LIKE 'v1:%'
               AND student_id = (SELECT id FROM users WHERE email = 'student@codequeenshub.test')`,
    del: `DELETE FROM submissions
           WHERE sheet_row_ref LIKE 'v1:%'
             AND student_id = (SELECT id FROM users WHERE email = 'student@codequeenshub.test')`,
  },
  {
    // Deleted last: every student-owned table references users.id ON DELETE CASCADE
    // (src/db/schema.ts:277, 382, 413, 430, 443, 461, 503, 623, 715), and the two
    // staff columns are ON DELETE SET NULL (:395, :548), so this cannot orphan a row
    // or strand a review stamp on a row that keeps its status.
    label: `throwaway accounts matching ${THROWAWAY_EMAIL_PATTERN}`,
    count: "SELECT count(*)::int AS n FROM users WHERE email LIKE $1 AND role = 'student'",
    del: "DELETE FROM users WHERE email LIKE $1 AND role = 'student'",
    params: [THROWAWAY_EMAIL_PATTERN],
  },
];

async function main() {
  console.log(
    reportOnly
      ? "E2E residue REPORT (nothing will be written).\n"
      : "Clearing e2e residue from the shared database.\n",
  );

  let total = 0;
  for (const sweep of sweeps) {
    const counted = await pool.query(sweep.count, sweep.params as unknown[] | undefined);
    const n = Number(counted.rows[0].n);
    total += n;

    if (n === 0) {
      console.log(`  clean   ${sweep.label}`);
      continue;
    }
    if (reportOnly) {
      console.log(`  ${String(n).padStart(5)}   ${sweep.label}`);
      continue;
    }
    const deleted = await pool.query(sweep.del, sweep.params as unknown[] | undefined);
    console.log(`  -${String(deleted.rowCount ?? n).padStart(4)}   ${sweep.label}`);
  }

  console.log(
    `\n${"-".repeat(70)}\n${total} residual row(s) ${reportOnly ? "found" : "removed"}.`,
  );

  // A non-zero count is information, not a failure: residue is expected after a run
  // and this script's job is to remove it, not to complain about it. Exiting non-zero
  // would make it unusable as a routine pre-suite step.
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nreset-e2e-state FAILED: ${err instanceof Error ? err.message : err}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
