// LOAD .env INTO THE TEST PROCESS. This import is load-bearing, not tidiness.
//
// The specs run in a Node process that Playwright starts directly; it does NOT
// inherit anything Next.js loads for the app under test. Nothing in this repo put
// DATABASE_URL into the shell environment either — `node -e "console.log(!!process.env.DATABASE_URL)"`
// prints false, and it only becomes defined after `require('dotenv').config()`.
//
// The consequence was a silent one, which is why it survived. Every DB-touching
// test helper guards itself with `if (!process.env.DATABASE_URL) return;` so that a
// contributor without a database still gets a usable run — see
// tests/e2e/submissions/submissions.spec.ts:60. With the variable absent, that
// guard fired on EVERY run, so `clearStandInSubmissions` never deleted anything and
// the file's documented "every group that can cause a write cleans up after itself"
// (submissions.spec.ts:32-37) was not happening at all. Proof, found in the shared
// database on 2026-07-31: one orphaned ingestion row for the demo student,
// `submissions.id = 8`, `sheet_row_ref = 'v1:9a8db52f...'` — exactly the shape that
// cleanup exists to remove, left behind by a run that believed it had cleaned up.
//
// Those rows are read by the leaderboard, progress and dashboard specs, so the
// leak turns one file's side effect into another file's failure. Loading dotenv
// here makes the guards inert and the cleanups real.
//
// ONE MORE CONSEQUENCE, added 2026-07-31 by the submissions stream: it is not only
// the cleanup guards. `test.skip(!process.env.CRON_SECRET, ...)` gated FOUR specs in
// tests/e2e/submissions/submissions.spec.ts — three on CRON_SECRET (including the
// cron-sweep assertion, the only thing that proves the hourly ingest works at all)
// and one on DATABASE_URL (fixture-CSV ingestion + idempotency) — plus five more
// across tests/e2e/queue and tests/e2e/grand-quiz. A skip reports as "skipped", not
// "failed", so a full suite looked green while those assertions had never once
// executed, which is worse than a red run. They run now.
//
// dotenv does not overwrite a variable that is already set, so CI secrets still win.
import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

// End-to-end harness. Every stream contributes specs under tests/e2e/<stream>/.
//
// These run against a REAL database seeded by `npm run db:seed`, because the
// behaviour under test (week unlocking, attempt limits, late penalties) is
// database state, and mocking it would test nothing worth testing.
const PORT = 3000;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Timeouts in milliseconds throughout (metric units, per house rules).
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // Compile every route ONCE before the first assertion. Locally the suite runs
  // against `next dev`, which compiles on first request: measured 17 706 ms for a
  // cold /practice and 9 728 ms for a cold /practice/1 against this 10 000 ms
  // expect budget, so the first spec to touch a route was asserting against
  // webpack rather than against the app. It cost 8 false failures across
  // interactive-exercises, quizzes and course-content in one run — one of them
  // inside loginAs, which read as a broken session and was a slow build.
  //
  // Deliberately NOT solved by raising the timeouts until the slowest cold
  // compile fits: that would hide genuine slowness in the place we most want to
  // see it, and make every real failure take longer to report. See the file's
  // header for why it logs in per role, and why it never fails the run.
  globalSetup: "./tests/e2e/global-setup.ts",

  // Shared mutable database state means specs cannot safely race each other: two
  // workers taking the same quiz as the same demo student exhaust the 3-attempt
  // limit unpredictably, and the demo student's unlock flags are read by several
  // streams' specs at once.
  //
  // ONE WORKER EVERYWHERE, not just in CI. This was `process.env.CI ? 1 : 2`,
  // which contradicted the comment above it and did cause false failures at
  // integration: progress-tracking's "later weeks are locked" ran while the
  // quizzes spec was unlocking Week 2 in the other worker. `fullyParallel: false`
  // alone is not enough — it serialises tests within a file, not files against
  // each other.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Responsive behaviour is an explicit MVP requirement, so a mobile viewport
    // is a first-class target rather than a manual spot-check.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],

  // Reuse a dev server that is already running locally; always start a fresh
  // production build in CI so e2e exercises the same output Vercel deploys.
  //
  // HAZARD, learned the hard way: `next dev` and `next start` share the SAME
  // .next directory. If a dev server runs while a production server is serving,
  // the dev build replaces the production output and every hashed chunk the
  // already-served HTML references starts returning 400. Nothing appears in the
  // server log — the pages still render, but no client JavaScript loads, so only
  // the tests that need interactivity fail. It looks exactly like a hydration bug.
  //
  // For a trustworthy full-suite run, prefer `CI=true npx playwright test`: that
  // builds and starts the server itself, so the build and the server cannot
  // disagree. Do not hand-start `next start` and then run a command that might
  // launch dev.
  webServer: {
    command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // TWO DIFFERENT WAITS, because `command` above is two different things.
    //
    // Without CI this waits for `next dev` to bind a port: seconds, and 180 s was
    // always generous. With CI it waits for `next build && next start` — a full
    // production build first. That measured 46 s to compile plus static generation
    // and build traces on a cold cache, and overran the shared 180 s: the build
    // itself SUCCEEDED ("✓ Generating static pages (8/8)", then "Collecting build
    // traces …") and Playwright killed it mid-trace with "Timed out waiting
    // 180000ms from config.webServer". Nothing in the report says "build", so it
    // reads as the server failing to start.
    //
    // "⚠ No build cache found" is the normal state for a fresh CI runner, so the
    // cold path is the one that has to fit, not the warm one.
    timeout: process.env.CI ? 900_000 : 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
