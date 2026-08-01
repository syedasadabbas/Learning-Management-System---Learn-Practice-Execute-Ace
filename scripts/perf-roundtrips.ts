// =============================================================================
// ROUND-TRIP COUNTER — verifies the perf claim instead of asserting it.
// -----------------------------------------------------------------------------
// Owner: coordinator. Read-only: it runs the app's own read models against the
// live database and counts how many statements each page's data layer issues,
// and how many of those are SEQUENTIAL (a statement that could not start until
// an earlier one had returned).
//
// WHY COUNT ROUND TRIPS RATHER THAN TIME PAGES
// scripts/perf-probe.ts already established the shape of the problem: a bare
// SELECT 1 against Neon (us-east-2) costs ~257 ms warm and ~2 s cold, while
// fetchWeekAggregates returns four rows in ~240 ms. The query work is close to
// free; the latency IS the round trip. So the honest metric for "did this get
// faster" is how many round trips a page waits on in sequence — a wall-clock
// number would mostly measure whichever network this happened to run on.
//
// SEQUENTIAL DEPTH is the number that matters. Two statements issued
// concurrently cost one round trip of latency; two issued one after the other
// cost two. The counter below tracks both.
//
// Run: npx tsx scripts/perf-roundtrips.ts
// =============================================================================

import "dotenv/config";

import { pool, db } from "../src/db";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

interface Issued {
  startedAt: number;
  endedAt: number;
}

let issued: Issued[] = [];
let recording = false;

// Wrap Pool.query so EVERY statement is counted no matter which module issued
// it — Drizzle's builder, db.execute, and any raw call all funnel through here.
const originalQuery = pool.query.bind(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pool as any).query = function patchedQuery(...args: unknown[]) {
  if (!recording) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalQuery as any)(...args);
  }
  const startedAt = performance.now();
  const record: Issued = { startedAt, endedAt: startedAt };
  issued.push(record);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (originalQuery as any)(...args);
  if (result && typeof result.then === "function") {
    return result.then(
      (value: unknown) => {
        record.endedAt = performance.now();
        return value;
      },
      (error: unknown) => {
        record.endedAt = performance.now();
        throw error;
      },
    );
  }
  return result;
};

/**
 * Longest chain of statements where each began only after the previous ended.
 *
 * This is the latency depth: the page cannot render faster than
 * `sequentialDepth x round-trip time`, however many statements ran in parallel
 * alongside. Computed as a longest-path over "started after this one finished".
 */
function sequentialDepth(records: readonly Issued[]): number {
  const ordered = [...records].sort((a, b) => a.startedAt - b.startedAt);
  const depth = new Array<number>(ordered.length).fill(1);
  let best = 0;

  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < i; j++) {
      // A 1 ms tolerance: two statements dispatched in the same tick can have
      // start times that straddle an earlier one's end by a fraction.
      if (ordered[j].endedAt <= ordered[i].startedAt + 1) {
        depth[i] = Math.max(depth[i], depth[j] + 1);
      }
    }
    best = Math.max(best, depth[i]);
  }
  return best;
}

interface Measurement {
  label: string;
  statements: number;
  depth: number;
  wallMs: number;
  note?: string;
}

const results: Measurement[] = [];

async function measure(label: string, fn: () => Promise<unknown>, note?: string) {
  issued = [];
  recording = true;
  const started = performance.now();
  try {
    await fn();
  } catch (error) {
    recording = false;
    results.push({
      label,
      statements: issued.length,
      depth: sequentialDepth(issued),
      wallMs: Math.round(performance.now() - started),
      note: `THREW: ${(error as Error).message.slice(0, 70)}`,
    });
    return;
  }
  recording = false;
  results.push({
    label,
    statements: issued.length,
    depth: sequentialDepth(issued),
    wallMs: Math.round(performance.now() - started),
    note,
  });
}

// ---------------------------------------------------------------------------
// The measurements
// ---------------------------------------------------------------------------

async function main() {
  const [student] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "student"))
    .limit(1);

  if (!student) {
    console.error("No student row found. Run `npm run db:seed` first.");
    process.exitCode = 1;
    return;
  }

  const course = await import("../src/components/course/data");

  // Warm the pool and the plan cache so the first measurement is not paying for
  // a TCP+TLS handshake that the others get for free.
  await db.execute("select 1");

  // NOTE ON React `cache()`: outside a request context it is a no-op passthrough,
  // so these numbers are the WORST case — the un-memoised count. Inside a real
  // request the duplicate calls collapse further. That makes this a safe floor
  // to quote rather than an optimistic one.

  await measure("/weeks            getWeekList", () => course.getWeekList(student.id));

  const { items } = await course.getWeekList(student.id);
  const openWeek = items.find((w) => !w.lock.locked) ?? items[0];

  if (openWeek) {
    await measure("/weeks/:id        gateWeek + getLectureSummaries", async () => {
      const gate = await course.gateWeek(student.id, openWeek.id);
      if (gate.ok) await course.getLectureSummaries(gate.week.id);
    });

    const lectures = await course.getLectureSummaries(openWeek.id);
    const lecture = lectures[0];
    if (lecture) {
      await measure("/weeks/:id/lectures/:id  gateLecture + neighbours", async () => {
        const gate = await course.gateLecture(student.id, lecture.id, openWeek.id);
        if (gate.ok) await course.getLectureNeighbours(openWeek.id, lecture.id);
      });
    }
  }

  const progress = await import("../src/lib/progress/dashboard");
  await measure("/dashboard        getDashboard", () => progress.getDashboard(student.id));

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  console.log("\nDatabase round trips per page data-layer call:\n");
  const width = Math.max(...results.map((r) => r.label.length));
  console.log(
    `${"page".padEnd(width)}  ${"stmts".padStart(6)}  ${"depth".padStart(6)}  ${"wall".padStart(8)}`,
  );
  console.log("-".repeat(width + 26));
  for (const r of results) {
    console.log(
      `${r.label.padEnd(width)}  ${String(r.statements).padStart(6)}  ${String(r.depth).padStart(6)}  ${String(r.wallMs).padStart(6)}ms${r.note ? `  ${r.note}` : ""}`,
    );
  }
  console.log(
    "\n'depth' is the sequential chain length — the page cannot render faster",
  );
  console.log("than depth x round-trip time, whatever else runs in parallel.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
