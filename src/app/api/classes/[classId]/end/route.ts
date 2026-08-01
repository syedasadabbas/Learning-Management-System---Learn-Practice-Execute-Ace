// =============================================================================
// POST /api/classes/:classId/end  —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// IDEMPOTENT for the same reason /start is, and by the same mechanism: the
// UPDATE carries `status = 'active'` in its WHERE clause, so a second call
// matches nothing and is answered 200 with the existing end time. Re-stamping
// `ended_at` would lengthen the recorded session every time somebody clicked.
//
// A CLASS THAT NEVER STARTED CANNOT BE ENDED (409). `live_classes_ends_after_
// starts` CHECKs `ended_at > started_at`, and nulls are exempt from it — so an
// `ended_at` on a class with a null `started_at` would pass the constraint and
// leave a row that ended without beginning. No attendance report can interpret
// that. `canEnd` in src/lib/live-classes/access.ts states the rule once.
//
// TRANSACTIONAL, because two rows change: the class, and every attendance row
// still showing the student as present. See the JSDoc on `POST` for why the
// sweep is here rather than left to each student's /leave call.
// =============================================================================

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { classAttendance, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { canEnd, ownershipFilter, type ClassStatus } from "@/lib/live-classes/access";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * End a running class and close out every open attendance row.
 *
 * WHY THE SWEEP IS HERE. `POST /api/classes/:id/leave` is best-effort: it fires
 * from a browser that is closing, and a student who shuts the laptop lid never
 * sends it. Without this sweep those rows keep `left_at IS NULL` forever and
 * their `time_present_minutes` stays null, so the participation mark silently
 * treats a student who attended the whole class as having attended none of it.
 * Ending the class is the one moment at which the true upper bound on presence
 * is known, so it is the right place to close the books.
 *
 * The minutes written are computed IN SQL from `joined_at` and the end instant,
 * floored at zero and capped at the class's planned duration:
 *   - floored, because `class_attendance_time_present_non_negative` would
 *     otherwise abort the whole transaction on a clock step;
 *   - capped, because a student who joined and left the tab open through the
 *     night would otherwise accrue several hundred minutes of "presence" in a
 *     sixty-minute class, and that number feeds a mark.
 * `coalesce` preserves any value /leave already accumulated rather than
 * overwriting it — a student who left properly is not re-measured.
 *
 * @param ctx path: `classId`
 * @returns 200 `{ status: "ended", endedAt, alreadyEnded, attendanceClosed }`
 * @throws 404 flag off, no such class, or the caller does not own it
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 the class never started, or was cancelled
 * @throws 400 `classId` is not a positive integer
 */
export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  const owner = ownershipFilter(gate.user);
  const endedAt = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [ended] = await tx
      .update(liveClasses)
      .set({
        status: "ended",
        endedAt,
        // A class whose recording was running moves to `processing`; one that
        // was not recording keeps whatever state it had. Expressed as a CASE so
        // it is one statement and cannot disagree with the status change.
        recordingStatus: sql`case when ${liveClasses.recordingStatus} = 'recording'
                                  then 'processing'::recording_status
                                  else ${liveClasses.recordingStatus} end`,
      })
      .where(and(eq(liveClasses.id, classId), eq(liveClasses.status, "active"), owner))
      .returning({
        id: liveClasses.id,
        endedAt: liveClasses.endedAt,
        durationMinutes: liveClasses.durationMinutes,
      });

    if (!ended) return null;

    const closed = await tx
      .update(classAttendance)
      .set({
        leftAt: endedAt,
        timePresentMinutes: sql`least(
          greatest(coalesce(${classAttendance.timePresentMinutes}, 0),
                   floor(extract(epoch from (${endedAt.toISOString()}::timestamptz - ${classAttendance.joinedAt})) / 60)::int,
                   0),
          ${ended.durationMinutes}
        )`,
      })
      .where(and(eq(classAttendance.classId, classId), isNull(classAttendance.leftAt)))
      .returning({ id: classAttendance.id });

    return { endedAt: ended.endedAt, attendanceClosed: closed.length };
  });

  if (outcome) {
    return apiOk({
      status: "ended" as const,
      endedAt: outcome.endedAt,
      alreadyEnded: false,
      attendanceClosed: outcome.attendanceClosed,
    });
  }

  const [current] = await db
    .select({ status: liveClasses.status, endedAt: liveClasses.endedAt })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), owner))
    .limit(1);

  if (!current) return apiError(404, "Class not found.", "not_found");

  const verdict = canEnd(current.status as ClassStatus);
  if (verdict.kind === "already") {
    return apiOk({
      status: "ended" as const,
      endedAt: current.endedAt,
      alreadyEnded: true,
      attendanceClosed: 0,
    });
  }

  return apiError(
    409,
    verdict.kind === "refused" ? verdict.reason : "This class cannot be ended.",
    "wrong_status",
  );
}
