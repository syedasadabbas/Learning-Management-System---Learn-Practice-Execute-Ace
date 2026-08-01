// =============================================================================
// POST /api/classes/:classId/start  —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// IDEMPOTENT, AND THE IDEMPOTENCE IS THE FEATURE. An instructor on a flaky
// connection will hit this twice. The second call must not:
//   - restamp `started_at`, which would silently shorten every attendance
//     duration computed from it;
//   - mint a SECOND Jitsi room, stranding the students already in the first;
//   - return an error page over a class that is, in fact, running.
//
// So the UPDATE carries `status = 'scheduled'` in its WHERE clause. A second
// call matches no row, and the handler then reads the current state and returns
// 200 with it. There is no read-then-write race: `canStart` classifies the
// state, but the state that DECIDES is the one in the WHERE clause.
//
// THE ROOM NAME IS MINTED HERE, not at schedule time — schema.live-classes.ts
// states why at the column: a room name published days in advance is a room
// strangers can be sitting in before the class begins.
// =============================================================================

import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { liveClasses } from "@/db/schema.live-classes";
import { liveClassesConfig } from "@/lib/features";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { formatZodError } from "@/lib/learning/schemas";
import { canStart, ownershipFilter, type ClassStatus } from "@/lib/live-classes/access";
import { startClassSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * Generate a Jitsi room name.
 *
 * 96 bits of `randomBytes`, hex-encoded, prefixed with the class id. The
 * randomness is load-bearing: `meet.jit.si` is shared public infrastructure with
 * no access control beyond the room name and an optional password, so a
 * guessable name IS an open door. A name derived from the title or the schedule
 * would be guessable by anyone holding the timetable.
 *
 * The `lms-<id>-` prefix is for humans reading a URL in a support ticket; it
 * leaks only a class id, which is already in every path this feature serves.
 */
function mintRoomName(classId: number): string {
  return `lms-${classId}-${randomBytes(12).toString("hex")}`;
}

/**
 * Start a scheduled class.
 *
 * @param request optional JSON body validated by `startClassSchema`; supply
 *        `jitsiRoomName` to attach a room the instructor already opened
 * @param ctx     path: `classId`
 * @returns 200 `{ status, startedAt, recordingEnabled, jitsiRoomName,
 *          jitsiUrl }`. 200 and NOT 201 even on the first call: the class row
 *          already existed, nothing was created, and a caller cannot tell a
 *          first call from a retry — claiming "created" on one and not the other
 *          would be wrong in one of the two cases.
 * @throws 404 flag off, no such class, or the caller does not own it
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 the class has already ended or was cancelled
 * @throws 422 body fails validation (a room name that is not URL-safe)
 * @throws 400 `classId` is not a positive integer
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  // An EMPTY BODY IS THE NORMAL CASE here — the client usually sends none at
  // all — so an absent body is `{}` rather than a validation failure. This is
  // why the route does not use the shared `parseBody`: that helper treats an
  // unreadable body as a 422, which is correct everywhere except on a POST
  // whose entire payload is optional.
  const rawBody = (await request.text()).trim();
  let input: { jitsiRoomName?: string } = {};
  if (rawBody.length > 0) {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return apiError(422, "Request body must be valid JSON.", "validation_failed");
    }
    const parsed = startClassSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(422, formatZodError(parsed.error), "validation_failed");
    }
    input = parsed.data;
  }

  const owner = ownershipFilter(gate.user);
  const startedAt = new Date();

  const [started] = await db
    .update(liveClasses)
    .set({
      status: "active",
      startedAt,
      jitsiRoomName: input.jitsiRoomName ?? mintRoomName(classId),
      // `recording_status` is NOT set here: whether to flip it depends on
      // `enable_recording`, which this statement does not know until it
      // returns the row. Handled in the follow-up below.
    })
    .where(and(eq(liveClasses.id, classId), eq(liveClasses.status, "scheduled"), owner))
    .returning();

  if (started) {
    // Second statement rather than a CASE expression: `enable_recording` is not
    // known until the row is returned, and a SQL CASE here would be three more
    // lines of template for a column that only matters when recording is on.
    if (started.enableRecording) {
      await db
        .update(liveClasses)
        .set({ recordingStatus: "recording" })
        .where(eq(liveClasses.id, classId));
    }

    return apiOk({
      status: "active" as const,
      startedAt: started.startedAt,
      recordingEnabled: started.enableRecording,
      jitsiRoomName: started.jitsiRoomName,
      jitsiUrl: `https://${liveClassesConfig.jitsiDomain}/${started.jitsiRoomName}`,
      alreadyStarted: false,
    });
  }

  // No row moved. Either the caller cannot see this class, or it is not in the
  // `scheduled` state. The follow-up read is ownership-scoped so the answer
  // cannot reveal a class belonging to someone else.
  const [current] = await db
    .select({
      status: liveClasses.status,
      startedAt: liveClasses.startedAt,
      enableRecording: liveClasses.enableRecording,
      jitsiRoomName: liveClasses.jitsiRoomName,
    })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), owner))
    .limit(1);

  if (!current) return apiError(404, "Class not found.", "not_found");

  const verdict = canStart(current.status as ClassStatus);
  if (verdict.kind === "already") {
    // THE IDEMPOTENT PATH. Same shape as a first successful start, so a retrying
    // client needs no special case.
    return apiOk({
      status: "active" as const,
      startedAt: current.startedAt,
      recordingEnabled: current.enableRecording,
      jitsiRoomName: current.jitsiRoomName,
      jitsiUrl: current.jitsiRoomName
        ? `https://${liveClassesConfig.jitsiDomain}/${current.jitsiRoomName}`
        : null,
      alreadyStarted: true,
    });
  }

  return apiError(
    409,
    verdict.kind === "refused" ? verdict.reason : "This class cannot be started.",
    "wrong_status",
  );
}
