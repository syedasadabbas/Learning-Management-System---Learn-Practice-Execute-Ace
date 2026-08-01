// =============================================================================
// DRAIN-ON-REQUEST — the primary trigger, and an honest account of its limits.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// THE PROBLEM. Vercel gives this app no place to run a background worker. A
// serverless function is frozen when its response is flushed; there is no
// process that outlives a request, so there is nothing for a `setInterval` to
// tick inside. That is not a limitation to work around cleverly — it is the
// platform's model, and a design that pretends otherwise works in `next dev`
// (long-lived Node process) and silently processes nothing in production.
//
// THE THREE TRIGGERS THIS QUEUE ACTUALLY HAS, in order of who fires first:
//
//   1. THIS FILE — `after()` from next/server. Next runs the callback AFTER the
//      response has been sent but still WITHIN the same invocation, and on
//      Vercel that keeps the function alive for it (it is built on the platform's
//      waitUntil). So grading a submission enqueues a job and then, with the
//      instructor's response already delivered, drains it in the same request.
//      In practice this means the email goes out seconds after the grade, and
//      the instructor waited zero extra milliseconds for it.
//
//      WHAT IT DOES NOT GUARANTEE, stated plainly:
//        - it is best-effort. The callback can be cut short by the function's
//          `maxDuration`, and a job already flipped to `running` when that
//          happens stays leased until LEASE_MS expires;
//        - it only fires when SOMEBODY MAKES A REQUEST. A job whose retry is
//          scheduled 240 s out will sit there until the next request that
//          triggers a drain, or until trigger 2 runs. On a cohort-sized app
//          with real traffic that is usually soon; at 3 a.m. it is not;
//        - it cannot run at all outside a request context, which is why the
//          call below is guarded rather than assumed.
//
//   2. GET/POST /api/cron/drain-jobs with the CRON_SECRET bearer token, called
//      every 5 minutes by .github/workflows/drain-jobs.yml. The scheduled floor
//      under trigger 1, so a retry does not depend on a student happening to load
//      a page. It is a GitHub Actions cron rather than a vercel.json entry because
//      the Hobby plan's two cron slots are spent and are daily anyway — argued in
//      full in that route's header and that workflow's. The route works with any
//      caller that can present the secret.
//
//   3. A human, or an operator script, hitting the same route (the workflow's
//      `workflow_dispatch` is exactly this). The repair path.
//
// NET EFFECT ON VERCEL: yes, this survives the serverless model — because
// nothing in it assumes a process that outlives a request. What it gives up
// versus a real worker is precision: trigger 2 is a best-effort GitHub schedule,
// so the floor under a retry is "usually within about 5-10 minutes" rather than a
// guarantee. A missed tick delays a retry and cannot lose one, because eligibility
// is a comparison against the DATABASE's clock (../queue/store.ts) and nothing
// expires a queued row.
//
// WHY TRIGGER 1 STILL MATTERS NOW THAT TRIGGER 2 EXISTS, since deleting it would
// look like a simplification: without it, EVERY graded-assignment email waits for
// the next tick, so the median notification latency goes from about a second to
// about two and a half minutes for no saving at all — the drain it performs is
// bounded at REQUEST_DRAIN_MAX_JOBS jobs on an invocation that is already warm.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { after } from "next/server";

import { DRAIN_BATCH_SIZE } from "./policy";

/**
 * Budget for a piggybacked drain, in milliseconds.
 *
 * Much smaller than the cron route's DRAIN_BUDGET_MS. This runs attached to a
 * user's request, and although the response has already been flushed, the
 * invocation is still billed and still counts against that route's
 * `maxDuration`. 8 s is enough for one SMTP send (bounded at ~30 s worst case by
 * SMTP_TIMEOUT_MS, but typically well under a second) plus its database writes,
 * without turning a grading request into a long-running function. Anything left
 * over is trigger 2's problem, which is what trigger 2 is for.
 */
export const REQUEST_DRAIN_BUDGET_MS = 8_000;

/**
 * How many jobs a piggybacked drain will process. Deliberately small: the point
 * is to deliver the job THIS request just enqueued, not to empty the queue on
 * somebody else's invocation.
 */
export const REQUEST_DRAIN_MAX_JOBS = Math.min(3, DRAIN_BATCH_SIZE);

/** Set false (`QUEUE_AUTO_DRAIN=false`) to leave draining entirely to the cron trigger. */
function autoDrainEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.QUEUE_AUTO_DRAIN?.trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0");
}

/**
 * Ask for a drain once the current response has been sent.
 *
 * Fire-and-forget and TOTALLY silent about its own failures, by design. This is
 * called from a producer that has already committed a grade; an exception
 * escaping here would either fail that request or surface as an unhandled
 * rejection after it — and the fallback for "the drain did not happen" is
 * trigger 2, which is a perfectly good fallback.
 *
 * `after()` throws when there is no request context (a script, a test, a module
 * evaluated at build time). That is caught rather than prevented, because
 * detecting "am I in a request" is not something Next exposes and the throw is
 * the documented signal.
 */
export function scheduleDrain(options: { budgetMs?: number; maxJobs?: number } = {}): void {
  if (!autoDrainEnabled()) return;

  try {
    after(async () => {
      try {
        // Imported lazily so that a module importing `scheduleDrain` does not
        // pull the database client, the mail transports and every handler into
        // its bundle — this seam is reached from request paths that otherwise
        // touch none of them.
        const { drainJobs } = await import("./drain");
        await drainJobs({
          budgetMs: options.budgetMs ?? REQUEST_DRAIN_BUDGET_MS,
          maxJobs: options.maxJobs ?? REQUEST_DRAIN_MAX_JOBS,
          workerId: undefined,
        });
      } catch (error) {
        // drainJobs already promises not to throw; this is the guard for the
        // dynamic import itself.
        console.error("[queue] request-attached drain failed", error);
      }
    });
  } catch {
    // No request context. Not an error: the cron trigger covers it.
  }
}
