// =============================================================================
// POST /api/classes/:classId/leave  —  "student"
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// BEST-EFFORT BY NATURE. This fires from a tab that is closing (usually via
// `navigator.sendBeacon`), so it will sometimes not arrive at all. The safety
// net is the sweep in POST /api/classes/:id/end, which closes every row still
// showing a student as present. Nothing here may assume it is the only writer.
//
// IDEMPOTENT: leaving twice adds no minutes the second time. The mechanism is
// that presence is recomputed as `max(existing, wall-clock since joined_at)`
// rather than accumulated by addition — an additive `+= minutes` would double
// a student's presence on a retried beacon, and that number feeds a mark.
//
// THE CLIENT'S NUMBER IS A HINT, NOT AN INPUT. `minutesPresent` in the body is
// accepted, bounded by the schema, and then CLAMPED against two server facts:
// wall-clock time since `joined_at`, and the class's planned duration. A student
// who edits the beacon payload cannot award themselves presence they did not
// have, because the server never takes their number as an upper bound.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { classAttendance, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { formatZodError } from "@/lib/learning/schemas";
import { minutesBetween, participationScore } from "@/lib/live-classes/access";
import { leaveClassSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * Record that the caller left a class, and finalise their participation score.
 *
 * @param request optional JSON body `{ minutesPresent?: number }`. Absent is the
 *        normal case for a `sendBeacon` with no payload.
 * @param ctx     path: `classId`
 * @returns 200 `{ leftAt, timePresentMinutes, participationScore }`
 * @throws 404 flag off, no such class, or the caller has no attendance row for
 *          it — never having joined and the class not existing are both "there
 *          is nothing at this address for you", and distinguishing them would
 *          let a student probe which class ids exist
 * @throws 401 not signed in
 * @throws 422 body fails validation
 * @throws 400 `classId` is not a positive integer
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  // A beacon frequently carries no body. Absent is `{}`, not a 422 — see the
  // same reasoning in the /start handler.
  const rawBody = (await request.text()).trim();
  let input: { minutesPresent?: number } = {};
  if (rawBody.length > 0) {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return apiError(422, "Request body must be valid JSON.", "validation_failed");
    }
    const parsed = leaveClassSchema.safeParse(json);
    if (!parsed.success) return apiError(422, formatZodError(parsed.error), "validation_failed");
    input = parsed.data;
  }

  const leftAt = new Date();

  const outcome = await db.transaction(async (tx) => {
    // The ownership predicate IS `student_id = session.id`. There is no path by
    // which a student can close out another student's attendance: the row is
    // located by the pair, not by an id from the payload.
    const [row] = await tx
      .select({
        id: classAttendance.id,
        joinedAt: classAttendance.joinedAt,
        timePresentMinutes: classAttendance.timePresentMinutes,
        messagesSent: classAttendance.messagesSent,
        questionsAsked: classAttendance.questionsAsked,
        durationMinutes: liveClasses.durationMinutes,
      })
      .from(classAttendance)
      .innerJoin(liveClasses, eq(liveClasses.id, classAttendance.classId))
      .where(and(eq(classAttendance.classId, classId), eq(classAttendance.studentId, gate.user.id)))
      .limit(1);

    if (!row) return null;

    // The three bounds, in order. `wallClock` is the server's own measurement
    // and is the ceiling the client's claim is clamped to; `durationMinutes` is
    // the second ceiling, because a tab left open overnight must not accrue
    // hundreds of minutes in a sixty-minute class.
    const wallClock = minutesBetween(row.joinedAt, leftAt);
    const claimed = input.minutesPresent ?? wallClock;
    const thisSession = Math.min(claimed, wallClock, row.durationMinutes);

    // MAX, not sum — see the module header on why addition double-counts a
    // retried beacon.
    const timePresentMinutes = Math.max(row.timePresentMinutes ?? 0, thisSession);

    const score = participationScore({
      timePresentMinutes,
      durationMinutes: row.durationMinutes,
      messagesSent: row.messagesSent,
      questionsAsked: row.questionsAsked,
    });

    await tx
      .update(classAttendance)
      .set({ leftAt, timePresentMinutes, participationScore: score })
      .where(eq(classAttendance.id, row.id));

    return { leftAt, timePresentMinutes, participationScore: score };
  });

  if (!outcome) return apiError(404, "No attendance record for this class.", "not_found");
  return apiOk(outcome);
}
