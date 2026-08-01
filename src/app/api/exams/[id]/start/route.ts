// =============================================================================
// POST /api/exams/:weekId/start  —  ROUTE_AUTH: "student"
// Owner: grand-quiz stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// FOLDER-SLUG NOTE, raised rather than silently resolved.
//
// The frozen route map names four exam paths whose first dynamic segment is
// sometimes a week id and sometimes an attempt id:
//
//     POST /api/exams/:weekId/start
//     POST /api/exams/:attemptId/answer
//     POST /api/exams/:attemptId/submit
//     GET  /api/exams/:attemptId
//
// Next.js App Router forbids two different slug NAMES at the same position — a
// tree containing both `[weekId]/start` and `[attemptId]/answer` fails the build
// with "You cannot use different slug names for the same dynamic path". So the
// folder is `[id]` for all four and each handler names what it actually received.
// The URLs are byte-for-byte the ones the contract declares; only the directory
// name differs, and no other stream's path is affected. Flagged to the
// coordinator in the stream report.
//
// WHAT THIS HANDLER DOES NOT DO: it does not check whether the student has
// already sat this exam. Invariant I1 is enforced by the UNIQUE index
// (student_id, quiz_id, attempt_number) and by `startAttempt` catching the
// violation — a read-then-write check here would reintroduce exactly the race the
// index exists to close. Two concurrent POSTs to this route return the same
// attempt id, and there is no code path in which they do not.
// =============================================================================

import { gateWeek } from "@/components/course/data";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { startExam } from "@/lib/grand-quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  quiz_empty: 409,
};

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  // The `[id]` segment is a WEEK id on this route.
  const { id: rawWeekId } = await ctx.params;
  const weekId = parsePositiveInt(rawWeekId);
  if (weekId === null) {
    return apiError(400, "weekId must be a positive integer.", "invalid_week_id");
  }

  // WEEK-LOCK GATE. Applied before anything is written, so a locked week burns no
  // attempt: an attempt row created and then discarded would be indistinguishable
  // from a sitting, and I1 means the student could never get it back. Reuses
  // course-content's own gate so this route cannot disagree with the week list.
  const week = await gateWeek(gate.user.id, weekId);
  if (!week.ok) {
    return week.kind === "locked"
      ? apiError(
          403,
          "This week is locked. Pass the previous week's quiz to unlock it.",
          "week_locked",
        )
      : apiError(404, "This week has no exam.", "not_found");
  }

  const outcome = await startExam({ weekId, studentId: gate.user.id });
  if (!outcome.ok) {
    return apiError(STATUS_FOR[outcome.code] ?? 400, outcome.error, outcome.code);
  }

  // 200 rather than 201 even when the attempt was just created: this endpoint is
  // idempotent by design and the caller cannot tell the two apart, so claiming
  // "created" on one call and not the next would be a lie either way.
  return apiOk(outcome.data);
}
