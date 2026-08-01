// =============================================================================
// GET / POST /api/cron/drain-jobs  —  auth level "cron"
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// SECURITY — the same shape as the two cron routes that already exist here
// (src/app/api/cron/ingest-submissions/route.ts and .../finalize-exams). Read
// either of those headers for the full argument; the short version is:
//
//   - the ONLY accepted credential is `Authorization: Bearer $CRON_SECRET`,
//     enforced by `requireCron`, which fails CLOSED (503) when the secret is
//     unset. No user role satisfies "cron" — `ROLES_SATISFYING.cron` is empty;
//   - any request carrying a session cookie is refused even with a valid token,
//     as a confused-deputy defence. A real scheduler never sends cookies;
//   - `/api/cron/` is in middleware.ts's ALWAYS_ALLOWED list, so the edge does
//     not gate this path and this handler is the ONLY thing in front of the
//     write. The guard is therefore not optional.
//
// `ROUTE_AUTH["POST /api/cron/drain-jobs"]` is "cron" and
// `ROLES_SATISFYING.cron` is the empty array, so the map now says out loud what
// `requireCron` already enforced. (It was left out of the contract while that file
// was frozen mid-wave; the coordinator's call was to add it, since a route map
// that omits a live route cannot use its own exhaustiveness check to notice a
// route that forgot to authorize itself.)
//
// -----------------------------------------------------------------------------
// THE SCHEDULED CALLER IS .github/workflows/drain-jobs.yml, NOT vercel.json
//
// The obvious move is a third `crons` entry in vercel.json. It is not available:
// FREE_STACK.md commits this project to the Vercel HOBBY plan, whose documented
// limits are TWO cron jobs per project invoked at most ONCE PER DAY regardless of
// the expression written. vercel.json already declares two (ingest-submissions and
// finalize-exams), so the slots are spent — and a once-a-day drain would be worse
// than no scheduled trigger at all, because it would look like one. (Plan limits
// change; verify before relying on this paragraph.)
//
// So the scheduled caller is a free GitHub Actions cron on `*/5 * * * *`, which
// FREE_STACK.md already names as this project's scheduler ("Grand-quiz sweeper ...
// GitHub Actions cron (free) or Vercel Cron hobby", with a shared secret). That
// workflow requires two repository secrets, APP_ORIGIN and CRON_SECRET, and fails
// loudly on anything that is not a 200 — the limits of GitHub's own scheduler are
// written up in its header rather than assumed away.
//
// WHY BOTH TRIGGERS AND NOT JUST THE CRON: `after()`-attached drains fire on the
// grading request itself (src/lib/queue/schedule.ts), so the common path — grade,
// email seconds later — does not wait for a tick. The cron is the FLOOR under a
// retry, which is the part that used to be missing: a job whose backoff expires
// 240_000 ms out no longer waits for the next student to load a page.
// =============================================================================

import { apiOk, requireCron } from "@/lib/guard";
import { DRAIN_BATCH_SIZE, DRAIN_BUDGET_MS, drainJobs, queueCounts } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Seconds (Vercel's unit — the only place seconds appear in this stream).
 *
 * The drain's own budget is DRAIN_BUDGET_MS = 25_000 ms, comfortably inside
 * this, so the function returns a report rather than being killed. The headroom
 * exists because the budget is checked BETWEEN jobs: one handler that runs long
 * (an SMTP send can take up to ~30 s against three 10 s timeouts) can overshoot
 * the budget by its own duration.
 */
export const maxDuration = 60;

/** Auth.js v5 session cookie names — the plain and the HTTPS-prefixed form. */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

async function handle(request: Request): Promise<Response> {
  const denied = requireCron(request);
  if (denied) return denied;

  const cookieHeader = request.headers.get("cookie") ?? "";
  if (SESSION_COOKIE_NAMES.some((name) => cookieHeader.includes(`${name}=`))) {
    return Response.json(
      {
        ok: false,
        error: "This endpoint is server-to-server only and does not accept browser sessions.",
        code: "cron_only",
      },
      { status: 403 },
    );
  }

  const report = await drainJobs({
    batchSize: DRAIN_BATCH_SIZE,
    budgetMs: DRAIN_BUDGET_MS,
    workerId: undefined,
  });

  // Counts read AFTER the drain, so the response says what is left rather than
  // what was there. `dead` being non-zero is the number an operator watches.
  const counts = await queueCounts().catch(() => null);

  // 200 even when `deadLettered` is non-zero, and even when nothing was claimed.
  // Same reasoning the other two cron routes state: a sweep that ran and
  // reported problems is a successful sweep, and a 500 would leave the schedule
  // permanently red and hide the jobs that DID succeed. `deadLettered > 0` is
  // the signal; the HTTP status is not.
  return apiOk({ ...report, counts });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

/** Vercel Cron and most schedulers issue GET. Same guard, same body. */
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
