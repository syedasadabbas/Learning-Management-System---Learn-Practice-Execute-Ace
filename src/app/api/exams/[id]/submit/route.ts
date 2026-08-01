// =============================================================================
// POST /api/exams/:attemptId/submit  —  ROUTE_AUTH: "student"
// Owner: grand-quiz stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// (See ../start/route.ts for why the folder slug is `[id]`.)
// -----------------------------------------------------------------------------
// Expiry trigger 1 of 3 arrives here: the client's countdown reaches zero and
// POSTs `{ autoSubmitted: true }`. So does the student pressing Submit, and so
// does an impatient second click.
//
// ALL THREE GET THE SAME BODY. `submitExam` is idempotent and terminal (I3): the
// first call to take the attempt's row lock scores it, and every later call —
// including the cron sweeper's — returns the recorded result unchanged, with
// `replayed: true`. So this handler answers 200 for a repeat submit rather than
// 409. A 409 would be technically defensible and practically awful: the student's
// browser would show an error over a perfectly good exam it had already recorded,
// at the end of two hours they cannot repeat.
//
// A `body` is optional. `fetch(url, {method:"POST"})` with no body is the shape a
// `navigator.sendBeacon`-style unload handler produces, and refusing it would lose
// the last-moment submit that matters most.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { submitExam } from "@/lib/grand-quiz";
import { examSubmitSchema, firstIssue } from "@/lib/grand-quiz/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Seconds (Vercel's unit). Grading `code_write` items is one Piston round trip
 * per hidden test, sequentially — a generous ceiling, and the deferral rule means
 * a slow instance costs marks to nobody.
 */
export const maxDuration = 60;

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const { id: rawAttemptId } = await ctx.params;
  const attemptId = parsePositiveInt(rawAttemptId);
  if (attemptId === null) {
    return apiError(400, "attemptId must be a positive integer.", "invalid_attempt_id");
  }

  // An absent or unparseable body is treated as `{}` — a manual submit. The flag
  // it would have carried can only ever ADD `autoSubmitted`, and the server
  // recomputes expiry from the stored deadline anyway (I2), so nothing is lost.
  let autoSubmitted = false;
  const raw = await request.text().catch(() => "");
  if (raw.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(400, "Request body must be JSON.", "invalid_json");
    }
    const parsed = examSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, firstIssue(parsed.error), "invalid_body");
    }
    autoSubmitted = parsed.data.autoSubmitted ?? false;
  }

  const outcome = await submitExam({
    attemptId,
    studentId: gate.user.id,
    autoSubmitted,
  });

  if (!outcome.ok) {
    return apiError(STATUS_FOR[outcome.code] ?? 400, outcome.error, outcome.code);
  }

  // 200, not 201. A repeat submit created nothing, and the caller cannot tell
  // which call it made — see the header.
  return apiOk(outcome.data);
}
