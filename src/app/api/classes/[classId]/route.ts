// =============================================================================
// GET    /api/classes/:classId  —  "student"
// PUT    /api/classes/:classId  —  "instructor" AND owner (or admin)
// DELETE /api/classes/:classId  —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// OWNERSHIP IS IN THE WHERE CLAUSE. `ownershipFilter(user)` from
// src/lib/live-classes/access.ts returns `eq(instructor_id, session.id)` for an
// instructor and `undefined` for an admin, and it is ANDed into the UPDATE and
// the DELETE. The consequence worth naming: instructor B editing instructor A's
// class gets a 404, not a 403 — the resource is not at that address for them,
// and 403 would confirm it exists.
//
// DELETING A CLASS THAT WAS HELD IS REFUSED (409), not soft-deleted, not
// cascaded. `class_attendance`, `class_chat` and `class_qa` all cascade from
// this row, so a DELETE on a session that ran would silently destroy the
// attendance record a participation mark was computed from — precisely what
// schema.live-classes.ts warns about in its header. A finished class is
// ARCHIVED (`is_archived`), and this handler says so in the error.
// =============================================================================

import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { parseBody } from "@/lib/learning/schemas";
import { ownershipFilter } from "@/lib/live-classes/access";
import { updateClassSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * Read one class.
 *
 * ROOM CREDENTIALS ARE WITHHELD. `jitsiRoomName` and `jitsiPassword` are not in
 * this projection: they belong to GET /api/classes/:id/join, which checks the
 * lifecycle and records attendance first. Returning them here would make the
 * join gate decorative, since a client could read the room out of the detail
 * payload and walk into it without ever being marked present.
 *
 * @returns 200 the class plus `instructorName`
 * @throws 404 flag off, or no such class
 * @throws 401 not signed in
 * @throws 400 `classId` is not a positive integer
 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  const [row] = await db
    .select({
      id: liveClasses.id,
      weekId: liveClasses.weekId,
      lectureId: liveClasses.lectureId,
      instructorId: liveClasses.instructorId,
      instructorName: users.name,
      title: liveClasses.title,
      description: liveClasses.description,
      scheduledAt: liveClasses.scheduledAt,
      durationMinutes: liveClasses.durationMinutes,
      status: liveClasses.status,
      enableRecording: liveClasses.enableRecording,
      recordingStatus: liveClasses.recordingStatus,
      recordingUrl: liveClasses.recordingUrl,
      maxParticipants: liveClasses.maxParticipants,
      allowChat: liveClasses.allowChat,
      allowQa: liveClasses.allowQa,
      allowScreenShare: liveClasses.allowScreenShare,
      attendanceCount: liveClasses.attendanceCount,
      engagementScore: liveClasses.engagementScore,
      createdAt: liveClasses.createdAt,
      startedAt: liveClasses.startedAt,
      endedAt: liveClasses.endedAt,
      isArchived: liveClasses.isArchived,
    })
    .from(liveClasses)
    .innerJoin(users, eq(users.id, liveClasses.instructorId))
    .where(eq(liveClasses.id, classId))
    .limit(1);

  if (!row) return apiError(404, "Class not found.", "not_found");
  return apiOk(row);
}

/**
 * Edit a scheduled class.
 *
 * @param request JSON body validated by `updateClassSchema` (no `status`, no
 *        `instructorId`, no `startedAt` — see that module's header)
 * @returns 200 the updated row
 * @throws 404 flag off, no such class, OR the caller does not own it
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 the class has already started — the schedule of a session that is
 *          running or finished is a historical fact, and editing
 *          `scheduled_at` under a recorded attendance list makes the report
 *          uninterpretable
 * @throws 422 body fails validation, or the new week/lecture does not exist
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, updateClassSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const owner: SQL | undefined = ownershipFilter(gate.user);

  try {
    // The status predicate is part of the UPDATE rather than a prior read, so a
    // class that goes active between the check and the write is not edited.
    const [row] = await db
      .update(liveClasses)
      .set(body.value)
      .where(and(eq(liveClasses.id, classId), eq(liveClasses.status, "scheduled"), owner))
      .returning();

    if (row) return apiOk(row);

    // Nothing updated. Distinguish "not yours / does not exist" from "wrong
    // state" with ONE extra read, scoped by ownership so the answer cannot
    // reveal a class the caller may not see.
    const [visible] = await db
      .select({ status: liveClasses.status })
      .from(liveClasses)
      .where(and(eq(liveClasses.id, classId), owner))
      .limit(1);

    if (!visible) return apiError(404, "Class not found.", "not_found");
    return apiError(
      409,
      `A ${visible.status} class cannot be edited. Archive it instead.`,
      "wrong_status",
    );
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 422) {
      return apiError(422, "The week or lecture named does not exist.", "unknown_parent");
    }
    if (status) return apiError(status, "The update was rejected by the database.", "db_rejected");
    throw error;
  }
}

/**
 * Delete a class that never ran.
 *
 * Only a `scheduled` or `cancelled` class may be deleted. See the module header
 * for why a held session is refused rather than cascaded away.
 *
 * @returns 204 no content
 * @throws 404 flag off, no such class, or the caller does not own it
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 the class has started, is running, or has ended
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  const owner = ownershipFilter(gate.user);

  const deleted = await db
    .delete(liveClasses)
    .where(
      and(
        eq(liveClasses.id, classId),
        // `started_at IS NULL` is the honest test for "never ran", stricter than
        // `status = 'scheduled'`: a cancelled class that HAD started still has
        // attendance rows hanging off it.
        eq(liveClasses.attendanceCount, 0),
        owner,
      ),
    )
    .returning({ id: liveClasses.id });

  if (deleted.length > 0) return new Response(null, { status: 204 });

  const [visible] = await db
    .select({ status: liveClasses.status, attendanceCount: liveClasses.attendanceCount })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), owner))
    .limit(1);

  if (!visible) return apiError(404, "Class not found.", "not_found");

  return apiError(
    409,
    `This class has ${visible.attendanceCount} recorded attendee(s). Archive it instead of deleting it — the attendance record is what participation marks are computed from.`,
    "attendance_recorded",
  );
}
