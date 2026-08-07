// =============================================================================
// POST /api/cron/ingest-submissions  —  ROUTE_AUTH: "cron"
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// SECURITY — READ BEFORE EDITING
//
// `ROUTE_AUTH["POST /api/cron/ingest-submissions"]` is "cron", and
// `ROLES_SATISFYING.cron` is an EMPTY ARRAY. That is not an oversight: NO user
// role satisfies this route. Not student, not instructor, not admin. The only
// accepted credential is `Authorization: Bearer $CRON_SECRET`, enforced by
// `requireCron` from the auth stream, which also fails CLOSED (503) when the
// secret is unset — an unconfigured secret must never mean "everyone may run
// ingestion".
//
// `apiGuard("cron")` exists and returns a flat 403 for exactly this reason; it is
// not used here because `requireCron` is the guard that can actually admit the
// scheduler. Do not "simplify" this handler by swapping in a role check.
//
// This route also refuses any request that carries a session cookie, even one
// presenting a valid bearer token. That is defence in depth against a confused
// deputy: if the secret ever leaked into client-side code, a logged-in browser
// could otherwise drive a privileged write path. A real scheduler never sends
// cookies, so the check costs nothing.
//
// The route is in middleware.ts's ALWAYS_ALLOWED list (`/api/cron/`), which means
// the edge does not gate it and this handler is the ONLY thing standing in front
// of the write path. That makes the guard below non-optional.
//
// vercel.json schedules this DAILY ("0 0 * * *"). Instructors who cannot wait for
// the next run press the button on /instructor/grading, which calls
// `syncSubmissionsAction` — the same two domain calls under a staff session guard.
// It deliberately does not reach this route: no browser may hold CRON_SECRET.
//
// TRANSPORT NOTE: Vercel Cron invokes a scheduled path with GET, while the frozen
// route contract names this endpoint as POST. Both verbs are implemented and both
// run the identical `requireCron` check, so the scheduler works without weakening
// authorization. A GET that writes would normally be a CSRF risk; it is not one
// here, because no cookie or browser context can satisfy the bearer requirement,
// and cookie-bearing requests are rejected outright. Flagged to shared-contracts:
// if the contract is meant to be GET-only, this file drops the POST export.
// =============================================================================

import { apiOk, requireCron } from "@/lib/guard";
import { persistMissedDeadlinePenalties } from "@/lib/submissions/deadline-penalties";
import { ingestAllAssignments } from "@/lib/submissions/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds (Vercel's unit). One CSV fetch per assignment at 15_000 ms each. */
export const maxDuration = 60;

/** Auth.js v5 session cookie names — the plain and the HTTPS-prefixed form. */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

async function handle(request: Request): Promise<Response> {
  // 1. The only credential that admits the scheduler. Returns a Response when the
  //    request is NOT authorised: 503 if CRON_SECRET is unset, 401 otherwise.
  const denied = requireCron(request);
  if (denied) return denied;

  // 2. Defence in depth: a browser, not a scheduler. Checked AFTER the secret so
  //    an unauthenticated prober learns nothing about cookie handling.
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

  const startedAt = Date.now();
  const sweep = await ingestAllAssignments();

  // Ingestion first, then missed-deadline penalties: the "who has not submitted"
  // picture must be computed AFTER new rows land, or a student whose response was
  // ingested in this very run would be penalised for missing the deadline.
  sweep.missedDeadlinePenalties = await persistMissedDeadlinePenalties();
  sweep.durationMs = Date.now() - startedAt;

  // 200 even when every assignment aborted with `no_csv_url`. That is the seeded
  // state (scripts/seed.ts leaves both Google URLs null) and a reported no-op is
  // not a failure; returning 500 would leave the schedule permanently red.
  return apiOk(sweep);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

/** See the TRANSPORT NOTE above: Vercel Cron issues GET. Same guard, same body. */
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
