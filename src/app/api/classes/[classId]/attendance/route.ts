// =============================================================================
// GET /api/classes/:classId/attendance  —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// INSTRUCTOR-ONLY, AND OWNER-SCOPED ON TOP OF THAT. This is a roster: every
// student who attended, how long they were there, how much they said, and the
// participation mark that follows from it. That is other people's assessment
// data, so "signed in" is not enough and neither is "is a teacher" — the
// ownership predicate is ANDed into the class lookup, so instructor B reading
// instructor A's roster gets a 404.
//
// A student who wants their OWN attendance reads it from the /join and /leave
// responses, which return exactly their own row and nothing else.
// =============================================================================

import { and, asc, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { classAttendance, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { ownershipFilter } from "@/lib/live-classes/access";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * The attendance roster for one class, in arrival order.
 *
 * @param request query: `limit` (1..100, default 20), `offset`
 * @param ctx     path: `classId`
 * @returns 200 `{ items, limit, offset, total }` plus, per row, the student's
 *          id, name and email, their join/leave instants, accumulated minutes,
 *          engagement counters and participation score
 * @throws 404 flag off, no such class, or the caller does not own it
 * @throws 401 / 403 not signed in / not staff
 * @throws 422 a bad page window
 * @throws 400 `classId` is not a positive integer
 *
 * NOTE that `total` here is the count of ATTENDANCE ROWS, computed from the
 * rows themselves — not `live_classes.attendance_count`. The denormalized
 * counter is a display hint and must never be the number a report is built on;
 * if the two disagree, this one is right.
 */
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  const pageResult = parsePage(new URL(request.url).searchParams);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  // Ownership is enforced HERE, on the parent, because `class_attendance` has no
  // instructor column of its own. A caller who does not own the class never
  // learns whether it exists.
  const [cls] = await db
    .select({ id: liveClasses.id, durationMinutes: liveClasses.durationMinutes })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), ownershipFilter(gate.user)))
    .limit(1);

  if (!cls) return apiError(404, "Class not found.", "not_found");

  const [items, [totals]] = await Promise.all([
    db
      .select({
        studentId: classAttendance.studentId,
        studentName: users.name,
        studentEmail: users.email,
        joinedAt: classAttendance.joinedAt,
        leftAt: classAttendance.leftAt,
        timePresentMinutes: classAttendance.timePresentMinutes,
        messagesSent: classAttendance.messagesSent,
        questionsAsked: classAttendance.questionsAsked,
        screenShareCount: classAttendance.screenShareCount,
        markedPresent: classAttendance.markedPresent,
        participationScore: classAttendance.participationScore,
      })
      .from(classAttendance)
      .innerJoin(users, eq(users.id, classAttendance.studentId))
      .where(eq(classAttendance.classId, classId))
      // Matches `class_attendance_class_joined_idx`, which is (class_id,
      // joined_at) precisely so the roster is an index walk.
      .orderBy(asc(classAttendance.joinedAt), asc(classAttendance.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(classAttendance).where(eq(classAttendance.classId, classId)),
  ]);

  return apiOk({
    ...paginated(items, page, totals?.total ?? 0),
    classDurationMinutes: cls.durationMinutes,
  });
}
