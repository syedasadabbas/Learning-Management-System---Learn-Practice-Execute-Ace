// =============================================================================
// PATCH /api/classes/:classId/attendance/:studentId
//   —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THE INSTRUCTOR'S OVERRIDE, and the reason it exists as its own route rather
// than as a field on the roster read: `marked_present` is a JUDGEMENT, separate
// from the fact of the row. The row says "this account opened the session"; the
// flag says "I count this as attendance". A student who joined and immediately
// left, or who was in the room under someone else's account, is a case only a
// human can settle.
//
// WHAT CANNOT BE PATCHED, and why: `messages_sent`, `questions_asked`,
// `screen_share_count`, `joined_at`, `left_at` and `time_present_minutes`. They
// are the EVIDENCE the judgement is made from. An instructor un-ticking
// `marked_present` must not be able to also erase the counters that justify or
// contradict the decision — that is the difference between an override and a
// rewrite of the record.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { classAttendance, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parseBody } from "@/lib/learning/schemas";
import { ownershipFilter } from "@/lib/live-classes/access";
import { patchAttendanceSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string; studentId: string }> };

/**
 * Override one student's attendance verdict or participation score.
 *
 * @param request JSON body validated by `patchAttendanceSchema`:
 *        `{ markedPresent?: boolean, participationScore?: 0..100 }`
 * @param ctx     path: `classId`, `studentId`
 * @returns 200 the updated attendance row
 * @throws 404 flag off, the class does not exist or is not the caller's, OR
 *          that student has no attendance row for it — a 404 rather than
 *          creating one, because "mark someone present who never joined" is a
 *          different operation and inventing a row here would put a
 *          `joined_at` in the record that never happened
 * @throws 401 / 403 not signed in / not staff
 * @throws 422 body fails validation
 * @throws 400 either path segment is not a positive integer
 */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const raw = await ctx.params;
  const classId = parsePositiveInt(raw.classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }
  const studentId = parsePositiveInt(raw.studentId);
  if (studentId === null) {
    return apiError(400, "studentId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, patchAttendanceSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  // Ownership is on the parent class; `class_attendance` has no instructor
  // column. Checked first so a caller who does not own the class cannot learn
  // whether a given student attended it.
  const [cls] = await db
    .select({ id: liveClasses.id })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), ownershipFilter(gate.user)))
    .limit(1);

  if (!cls) return apiError(404, "Class not found.", "not_found");

  const [row] = await db
    .update(classAttendance)
    .set(body.value)
    .where(and(eq(classAttendance.classId, classId), eq(classAttendance.studentId, studentId)))
    .returning();

  if (!row) return apiError(404, "No attendance record for that student.", "not_found");
  return apiOk(row);
}
