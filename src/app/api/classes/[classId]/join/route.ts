// =============================================================================
// GET /api/classes/:classId/join  —  "student"
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// A GET THAT WRITES. The verb is the spec's (LIVE_CLASSES_..._SPEC.md:412) and
// is kept so the frontend contract does not fork; the effect is an idempotent
// upsert of one attendance row. Flagged rather than silently accepted: a GET
// with a side effect can be replayed by a prefetch or a link scanner. It is
// safe here BECAUSE the write is idempotent — replaying it produces the same
// single row — which is exactly the property that makes the verb tolerable.
//
// IDEMPOTENCE IS THE UNIQUE INDEX, NOT A CHECK. `class_attendance` has
// UNIQUE(class_id, student_id), and this handler uses
// `onConflictDoUpdate` against it. There is no read-then-insert anywhere in this
// file: two tabs opening at once would both see "no row" and both insert, and
// the second insert is exactly what the index exists to reject. The schema
// header calls this out as THE constraint of the module.
//
// THE COUNTER ONLY MOVES ON A REAL FIRST JOIN. `attendance_count` is
// incremented only when the INSERT actually inserted, detected by comparing the
// returned `joined_at` to the instant this request generated. A reconnecting
// student must not inflate the count — the schema header says the unique index
// is "what keeps it honest", and this is the other half of that.
// =============================================================================

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { classAttendance, liveClasses } from "@/db/schema.live-classes";
import { liveClassesConfig } from "@/lib/features";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment } from "@/lib/learning/db-errors";
import { canJoin, type ClassStatus } from "@/lib/live-classes/access";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * Join a class: record attendance and receive the room configuration.
 *
 * NO JITSI JWT IS MINTED, diverging from the spec's example code, which signs
 * one with `process.env.JITSI_SECRET || 'secret'`. Three reasons, all of them
 * decisive on their own: the default deployment target is `meet.jit.si`, which
 * does not accept our JWTs at all; a signing secret that falls back to the
 * literal string `'secret'` is worse than no token; and the app already has a
 * signed handshake for the parts it actually controls
 * (src/lib/live-classes/realtime-token.ts, owned by the real-time stream). The
 * room name is a 96-bit random token minted at /start, which is the access
 * control `meet.jit.si` actually offers.
 *
 * @param ctx path: `classId`
 * @returns 200 `{ jitsiConfig: { roomName, password, serverUrl }, canJoin: true,
 *          attendance: { joinedAt, firstJoin }, class: {...} }`
 * @throws 404 flag off, or no such class
 * @throws 401 not signed in
 * @throws 409 the class has ended or was cancelled
 * @throws 409 the class is at `max_participants` and this caller is not already
 *          counted — a cap that only applies to NEW joiners, so a reconnecting
 *          student is never locked out of a full room they were already in
 * @throws 425 the class has not started, so there is no room to enter yet.
 *          425 "Too Early" rather than 409: the client's correct response is to
 *          wait and retry, which is a different instruction from "this will
 *          never work".
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

  const joinedAt = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [cls] = await tx
      .select({
        id: liveClasses.id,
        status: liveClasses.status,
        title: liveClasses.title,
        durationMinutes: liveClasses.durationMinutes,
        jitsiRoomName: liveClasses.jitsiRoomName,
        jitsiPassword: liveClasses.jitsiPassword,
        allowChat: liveClasses.allowChat,
        allowQa: liveClasses.allowQa,
        allowScreenShare: liveClasses.allowScreenShare,
        maxParticipants: liveClasses.maxParticipants,
        attendanceCount: liveClasses.attendanceCount,
        startedAt: liveClasses.startedAt,
      })
      .from(liveClasses)
      .where(eq(liveClasses.id, classId))
      .limit(1);

    if (!cls) return { kind: "not_found" as const };

    const verdict = canJoin(cls.status as ClassStatus);
    if (verdict.kind === "refused") {
      return { kind: "refused" as const, reason: verdict.reason };
    }

    // A scheduled class has no room yet — the room is minted at /start. The
    // student is told to wait rather than handed a null room name they would
    // navigate to.
    if (cls.jitsiRoomName === null) {
      return { kind: "not_started" as const, title: cls.title };
    }

    // CAPACITY. Checked against an EXISTING attendance row rather than against
    // the denormalized counter alone: `attendance_count` is a display hint and
    // must never gate a decision (schema header), and a returning student is
    // already counted, so a cap applied blindly would lock out the very person
    // whose reconnection the unique index exists to handle.
    const [existing] = await tx
      .select({ id: classAttendance.id, joinedAt: classAttendance.joinedAt })
      .from(classAttendance)
      .where(
        and(eq(classAttendance.classId, classId), eq(classAttendance.studentId, gate.user.id)),
      )
      .limit(1);

    if (existing === undefined && cls.maxParticipants !== null) {
      // The authoritative headcount, from the rows themselves. One extra
      // statement, taken only on a genuine first join, on the path where being
      // wrong means either refusing a student who should be admitted or
      // admitting one past a hard cap.
      const [{ live }] = await tx
        .select({ live: sql<number>`count(*)::int` })
        .from(classAttendance)
        .where(eq(classAttendance.classId, classId));

      if (live >= cls.maxParticipants) {
        return { kind: "full" as const, cap: cls.maxParticipants };
      }
    }

    // THE UPSERT. `onConflictDoUpdate` against the unique index, never
    // check-then-insert. On conflict `joined_at` is deliberately NOT touched —
    // the schema says the row is upserted, not replaced, and `joined_at` is the
    // FIRST join. What the update does is clear a stale `left_at`, so a
    // reconnecting student is "here" again for the /end sweep.
    const [row] = await tx
      .insert(classAttendance)
      .values({ classId, studentId: gate.user.id, joinedAt })
      .onConflictDoUpdate({
        target: [classAttendance.classId, classAttendance.studentId],
        set: { leftAt: null },
      })
      .returning({ joinedAt: classAttendance.joinedAt });

    // Did this actually insert? The returned `joined_at` equals the instant this
    // request generated only when the row is new; on a conflict it is the
    // original first join. Comparing timestamps rather than trusting a row count
    // is what lets the counter move exactly once per student.
    const firstJoin = row.joinedAt.getTime() === joinedAt.getTime();

    if (firstJoin) {
      await tx
        .update(liveClasses)
        .set({ attendanceCount: increment(liveClasses.attendanceCount) })
        .where(eq(liveClasses.id, classId));
    }

    return {
      kind: "ok" as const,
      firstJoin,
      joinedAt: row.joinedAt,
      cls,
    };
  });

  switch (outcome.kind) {
    case "not_found":
      return apiError(404, "Class not found.", "not_found");
    case "refused":
      return apiError(409, outcome.reason, "wrong_status");
    case "not_started":
      return apiError(
        425,
        "This class has not started yet. Try again when the instructor opens the room.",
        "not_started",
      );
    case "full":
      return apiError(
        409,
        `This class is full (${outcome.cap} participants).`,
        "class_full",
      );
    case "ok":
      return apiOk({
        canJoin: true,
        jitsiConfig: {
          roomName: outcome.cls.jitsiRoomName,
          password: outcome.cls.jitsiPassword,
          serverUrl: `https://${liveClassesConfig.jitsiDomain}`,
        },
        attendance: {
          joinedAt: outcome.joinedAt,
          firstJoin: outcome.firstJoin,
        },
        class: {
          id: outcome.cls.id,
          title: outcome.cls.title,
          status: outcome.cls.status,
          durationMinutes: outcome.cls.durationMinutes,
          allowChat: outcome.cls.allowChat,
          allowQa: outcome.cls.allowQa,
          allowScreenShare: outcome.cls.allowScreenShare,
          startedAt: outcome.cls.startedAt,
        },
      });
  }
}
