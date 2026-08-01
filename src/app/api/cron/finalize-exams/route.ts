// =============================================================================
// POST /api/cron/finalize-exams  —  ROUTE_AUTH: "cron"
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// SECURITY — READ BEFORE EDITING
//
// `ROUTE_AUTH["POST /api/cron/finalize-exams"]` is "cron", and
// `ROLES_SATISFYING.cron` is an EMPTY ARRAY. No user role satisfies this route —
// not student, not instructor, not admin. The only accepted credential is
// `Authorization: Bearer $CRON_SECRET`, checked by `requireCron`, which fails
// CLOSED (503) when the secret is unset.
//
// That matters more here than on most endpoints: this route CLOSES EXAMS. A
// logged-in user who could reach it would be able to end other students' sittings
// early. `apiGuard("cron")` exists and returns a flat 403 for exactly this reason;
// it is not used, because `requireCron` is the guard that can actually admit the
// scheduler. Do not "simplify" this into a role check.
//
// It also refuses any request carrying a session cookie, even one presenting a
// valid token — the confused-deputy defence the ingest sweeper uses, for the same
// reason: a real scheduler never sends cookies, so the check costs nothing.
//
// `/api/cron/` is in middleware.ts's ALWAYS_ALLOWED list, so the edge does not
// gate this path and this handler is the ONLY thing in front of the write. The
// guard below is therefore not optional.
//
// EXPIRY TRIGGER 3 OF 3. The other two — the client's countdown and the lazy
// finalize on read — cover every case where somebody is present. This one exists
// because neither runs when the student closed the laptop and never came back, and
// an attempt left `in_progress` forever holds a result they can never see.
// Overlapping with the other two is SAFE and expected: submission is idempotent
// and terminal (I3), so an attempt another trigger already closed is counted as
// `alreadyClosed` rather than re-scored.
//
// WHAT IT DOES NOT DO: it does not extend, reopen or reschedule anything. There is
// no code path in this stream that writes `deadline_at` after start (I2).
//
// SCHEDULING: not yet in vercel.json — that file is outside this stream's
// allowlist. Reported to the coordinator; hourly ("0 * * * *") matches the ingest
// sweeper and is well inside the tolerance, since triggers 1 and 2 handle anyone
// who is actually waiting for a result.
//
// TRANSPORT NOTE: Vercel Cron invokes a scheduled path with GET while the frozen
// contract names this endpoint POST. Both verbs are implemented and run the
// identical guard, so the scheduler works without weakening authorization. A GET
// that writes is normally a CSRF risk; it is not one here, because no cookie or
// browser context can satisfy the bearer requirement and cookie-bearing requests
// are rejected outright. Same precedent as
// src/app/api/cron/ingest-submissions/route.ts.
// =============================================================================

import { apiOk, requireCron } from "@/lib/guard";
import { sweepExpiredExams, SWEEP_LIMIT } from "@/lib/grand-quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds (Vercel's unit). Up to SWEEP_LIMIT attempts, each possibly running code. */
export const maxDuration = 300;

/** Auth.js v5 session cookie names — the plain and the HTTPS-prefixed form. */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

async function handle(request: Request): Promise<Response> {
  // 1. The only credential that admits the scheduler.
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

  const report = await sweepExpiredExams({ limit: SWEEP_LIMIT });

  // 200 even when `failed` is non-empty. The sweep is per-attempt isolated: 49
  // finalized exams and one failure is a successful sweep with a reported problem,
  // and returning 500 would leave the schedule permanently red and hide the 49.
  // 200 with `examined: 0` is the normal state — it means nothing was abandoned.
  return apiOk(report);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

/** See the TRANSPORT NOTE above: Vercel Cron issues GET. Same guard, same body. */
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
