// =============================================================================
// E2E GLOBAL SETUP — compile every route before the first assertion runs.
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Locally the suite runs against `next dev`, which compiles a route the first
// time it is requested. Measured in the integration run of 2026-07-31, on a tree
// that had just gained 34 `loading.tsx` files and 8 route `layout.tsx` guards:
//
//     GET /practice        200 in 17 706 ms   <- first hit, cold
//     GET /practice/1      200 in  9 728 ms   <- first hit, cold
//     GET /practice/1      200 in    485 ms   <- every hit after
//
// The default `expect` timeout is 10 000 ms (playwright.config.ts). So the first
// spec to touch a route was asserting against webpack, not against the app, and
// four specs in interactive-exercises failed on cold compilation alone — one of
// them inside `loginAs`, which made it look like a broken session rather than a
// slow build. Nothing was wrong with the product.
//
// The honest fix is to pay compilation ONCE, before any assertion, rather than to
// raise timeouts until the slowest cold compile fits. Raising them would hide
// genuine slowness in exactly the place we care about it, and would make every
// real failure take longer to report.
//
// WHY IT LOGS IN, RATHER THAN JUST FETCHING URLS
//
// `src/middleware.ts` redirects an unauthenticated request at the edge, so an
// anonymous GET to /weeks compiles the middleware and the login page and never
// touches the route it was supposed to warm. Warming therefore needs a real
// session per role — and warming as all three roles is not thoroughness for its
// own sake: the (staff) group's routes are a separate compilation unit from
// (app)'s, and the staff specs were slow for the same reason.
//
// COST, AND WHY IT IS PAID ONCE
//
// `reuseExistingServer` is true outside CI, so the dev server survives between
// invocations and its compilation cache survives with it. The first run pays the
// full cost; later runs re-request already-compiled routes and finish in seconds.
// In CI this is close to free either way, because webServer runs
// `npm run build && npm run start` — there is no per-route compilation to warm.
// It is still correct to run there: it fails fast and loudly if the server is not
// actually serving, instead of letting the first spec report that as a timeout.
//
// FAILURE POLICY: warming NEVER fails the suite. A route that 404s, redirects or
// 500s during warm-up is reported and skipped — the specs are what judge
// correctness, and a warm-up that can veto the run would be a second, weaker
// source of truth. The one exception is the server not responding at all, which
// is a genuine setup failure and is thrown.
// =============================================================================

import { chromium, type FullConfig } from "@playwright/test";

import { DEMO, DEMO_PASSWORD, type DemoRole } from "./fixtures";

/**
 * Roles to warm, and the paths each one can actually reach.
 *
 * THE DYNAMIC ROUTES MATTER MORE THAN THE INDEX ONES, which is the opposite of
 * what the first version of this file assumed. Warming only the ten sidebar
 * destinations fixed interactive-exercises (17/17, from 13/4) and left `quizzes`
 * and course-content still failing — because every cold-compile timeout was on a
 * DYNAMIC route: /quizzes/1 (30 s `page.goto` timeout), /practice/1 (9 728 ms),
 * /weeks/1/lectures/N (a click that never left /weeks/1). A dynamic segment is a
 * separate compilation unit from its index, and each now also carries a
 * `layout.tsx` guard and a `loading.tsx` of its own, so there is strictly more to
 * compile than before.
 *
 * The ids below are the SEEDED ones. Week, lecture and assignment ids are serial
 * and reassigned by a reseed, so a wrong id here warms a 404 page instead — which
 * is why a non-2xx is reported rather than ignored. It is a warm-up, not an
 * assertion: a stale id costs a slow first spec, never a false pass.
 */
const WARM_TARGETS: ReadonlyArray<{ role: DemoRole; paths: string[] }> = [
  {
    role: "student",
    paths: [
      "/dashboard",
      "/weeks",
      "/courses",
      "/practice",
      "/assignments",
      "/learn",
      "/problems",
      "/interview",
      "/leaderboard",
      "/settings",
      // Dynamic routes, each its own compilation unit.
      "/weeks/1",
      "/weeks/1/lectures/1",
      "/practice/1",
      "/practice/concept/box-model",
      "/quizzes/1",
      "/assignments/1",
      "/problems/html-valid-document-skeleton",
      "/interview/ai-tool-call-parse",
      "/learn/oop",
      "/leaderboard/me",
      // Week 2 is section-locked for the demo student, so this compiles the
      // LockedNotice path rather than the lecture body. Both are routes a spec
      // navigates to, and both were cold.
      "/weeks/2",
    ],
  },
  {
    role: "instructor",
    paths: ["/instructor", "/instructor/grading", "/instructor/students", "/instructor/analytics"],
  },
  {
    role: "admin",
    paths: [
      "/admin",
      "/admin/quizzes",
      "/admin/assignments",
      "/admin/students",
      "/admin/deadlines",
      "/admin/reports",
      "/admin/analytics",
      "/admin/videos",
      "/admin/course-requests",
      "/attendance",
    ],
  },
];

/** How long to allow ONE cold route compile, in ms. Generous by design. */
const WARM_TIMEOUT_MS = 120_000;
/** How long to wait for the dev server to answer at all, in ms. */
const SERVER_TIMEOUT_MS = 180_000;

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    process.env.E2E_BASE_URL ?? config.projects[0]?.use?.baseURL ?? "http://127.0.0.1:3000";

  // -------------------------------------------------------------------------
  // ENVIRONMENT PRECHECK — before a browser launches, because the two most
  // expensive debugging sessions on this project were both a missing variable
  // reported as a feature regression. Full account in src/lib/env.ts; the short
  // version is that DATABASE_URL absent gave "48 failed, 2 passed" with fifteen
  // failures in a feature nobody had edited, and AUTH_SECRET absent then gave a
  // second, different 48.
  //
  // THROWING HERE ABORTS THE WHOLE RUN, which is the point. A suite that runs on
  // a broken environment does not produce a weaker signal than one that refuses
  // to run — it produces a WRONG one, and a wrong signal costs more than no
  // signal because it is acted upon. Two sessions of reading innocent code paths
  // is the evidence.
  const { inspectEnv } = await import("../../src/lib/env");
  const env = inspectEnv();
  for (const warning of env.warnings) {
    // Not fatal, but say it loudly: an unset CRON_SECRET makes nine specs across
    // submissions, queue and grand-quiz assert against a 503 they will read as a
    // feature failure. playwright.config.ts's header records that those specs
    // used to be SKIPPED for the same reason, which was worse.
    console.warn(`[e2e env] WARNING: ${warning}`);
  }
  if (env.fatal.length > 0) {
    throw new Error(
      `Refusing to run the suite: ${env.fatal.length} environment problem(s).\n` +
        env.fatal.map((p) => `  - ${p}`).join("\n") +
        `\n\nEvery failure this run would report would be this, wearing a feature's name.`,
    );
  }

  const browser = await chromium.launch();
  const started = Date.now();
  let warmed = 0;
  const problems: string[] = [];

  try {
    // The server may still be booting: webServer readiness and globalSetup
    // ordering have differed across Playwright versions, so do not assume.
    const probe = await browser.newContext({ baseURL });
    const probePage = await probe.newPage();
    const probeResponse = await probePage.goto("/login", {
      timeout: SERVER_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });

    // ASSERT THE STATUS, do not merely arrive. `goto` resolves happily on a 500
    // error page, and every subsequent `page.fill` then times out waiting for an
    // input that a Next.js error page does not contain — which is EXACTLY the
    // report that sent two sessions into src/lib/account and src/lib/problems:
    // "waiting for locator('input[name=\"name\"]')" while /register was serving
    // status 500. One status check turns thirty minutes of misdirection into one
    // line. Kept separate from the env precheck above because it also catches the
    // faults no variable explains: an unmigrated database, a dev build being
    // served as production (playwright.config.ts's webServer header), a crash on
    // boot.
    const probeStatus = probeResponse?.status() ?? 0;
    if (probeStatus !== 200) {
      throw new Error(
        `GET /login returned ${probeStatus}, not 200. The application is not ` +
          `serving, so every assertion in this run would fail for that reason and ` +
          `report it against whichever feature it belongs to. Check the server log ` +
          `for the first error — a 500 here is usually a missing environment ` +
          `variable, an unapplied migration, or a build that did not finish.`,
      );
    }
    await probe.close();

    for (const { role, paths } of WARM_TARGETS) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      try {
        await page.goto("/login", { waitUntil: "domcontentloaded", timeout: WARM_TIMEOUT_MS });
        await page.fill('input[name="email"]', DEMO[role].email);
        await page.fill('input[name="password"]', DEMO_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
          timeout: WARM_TIMEOUT_MS,
        });

        for (const path of paths) {
          const response = await page.goto(path, {
            waitUntil: "domcontentloaded",
            timeout: WARM_TIMEOUT_MS,
          });
          const status = response?.status() ?? 0;
          if (status >= 400) problems.push(`${role} ${path} -> ${status}`);
          warmed += 1;
        }
      } catch (error) {
        // Not fatal. See FAILURE POLICY above.
        problems.push(`${role}: ${(error as Error).message.split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const elapsedMs = Date.now() - started;
  console.log(`[e2e warm-up] ${warmed} route(s) compiled in ${elapsedMs} ms.`);
  if (problems.length > 0) {
    // Printed, never thrown: the specs decide what is broken.
    console.log(`[e2e warm-up] ${problems.length} route(s) did not warm cleanly:`);
    for (const problem of problems) console.log(`[e2e warm-up]   ${problem}`);
  }
}
