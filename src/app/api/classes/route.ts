// =============================================================================
// GET  /api/classes  —  "student"
// POST /api/classes  —  "instructor"
// Feature flag: liveClasses
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// `db.query.liveClasses` DOES NOT EXIST. src/db/index.ts builds the Drizzle
// client with `{ schema }` from src/db/schema.ts only, so the relational query
// builder knows nothing about the sibling modules. Every read in this feature is
// therefore an explicit `select()` with explicit joins — the same thing the
// peer-review, forums and notifications streams do, for the same reason. This is
// not a stylistic preference; `db.query.liveClasses.findFirst` is a runtime
// TypeError, and the technical spec's example code (LIVE_CLASSES_..._SPEC.md:432)
// uses exactly that call.
//
// THE INSTRUCTOR IS THE SESSION, NEVER THE PAYLOAD. `createClassSchema` has no
// `instructorId` field, so there is no path by which a request can schedule a
// class in a colleague's name.
// =============================================================================

import { and, asc, count, desc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { createClassSchema } from "@/lib/live-classes/schemas";
import { parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["scheduled", "active", "ended", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

/**
 * The columns a class LIST returns.
 *
 * `jitsi_room_name` and `jitsi_password` are absent on purpose. A list is
 * rendered for everyone who can see the week; the room credentials belong to
 * GET /api/classes/:id/join, which checks the lifecycle first and writes an
 * attendance row. Shipping them in the list would make the join gate decorative.
 */
const classListColumns = {
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
  startedAt: liveClasses.startedAt,
  endedAt: liveClasses.endedAt,
  isArchived: liveClasses.isArchived,
} as const;

/**
 * List classes, newest scheduled first.
 *
 * @param request query: `weekId`, `status`, `instructorId`, `includeArchived`
 *        ("true" only), `limit` (1..100, default 20), `offset`
 * @returns 200 `{ items, limit, offset, total }`, no room credentials
 * @throws 404 the feature flag is off
 * @throws 401 not signed in
 * @throws 422 an unrecognised `status`, a malformed id, or a bad page window
 */
export async function GET(request: Request): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;

  const pageResult = parsePage(params);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const filters: SQL[] = [];

  const rawWeek = params.get("weekId");
  if (rawWeek !== null) {
    const weekId = parsePositiveInt(rawWeek);
    if (weekId === null) return apiError(422, "weekId must be a positive integer.", "invalid_id");
    filters.push(eq(liveClasses.weekId, weekId));
  }

  const rawInstructor = params.get("instructorId");
  if (rawInstructor !== null) {
    const instructorId = parsePositiveInt(rawInstructor);
    if (instructorId === null) {
      return apiError(422, "instructorId must be a positive integer.", "invalid_id");
    }
    filters.push(eq(liveClasses.instructorId, instructorId));
  }

  const rawStatus = params.get("status");
  if (rawStatus !== null) {
    if (!isStatus(rawStatus)) {
      return apiError(422, `"${rawStatus}" is not a class status.`, "invalid_status");
    }
    filters.push(eq(liveClasses.status, rawStatus));
  }

  // Archived classes are excluded by default. `is_archived` exists so a term's
  // worth of finished sessions stops crowding the list; a caller that wants them
  // has to say so, and only the exact string "true" counts (same strictness as
  // src/lib/features.ts, and for the same reason).
  if (params.get("includeArchived")?.trim() !== "true") {
    filters.push(eq(liveClasses.isArchived, false));
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [items, [totals]] = await Promise.all([
    db
      .select(classListColumns)
      .from(liveClasses)
      // INNER join: `instructor_id` is NOT NULL with an ON DELETE CASCADE, so a
      // class without an instructor row cannot exist. A left join here would
      // suggest otherwise and force every consumer to handle a null name.
      .innerJoin(users, eq(users.id, liveClasses.instructorId))
      .where(where)
      .orderBy(desc(liveClasses.scheduledAt), asc(liveClasses.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(liveClasses).where(where),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Schedule a class.
 *
 * The row is created in the `scheduled` state with NO Jitsi room: the room is
 * minted by POST /api/classes/:id/start. See the column comment in
 * schema.live-classes.ts — a room name published days in advance is a room
 * strangers can be sitting in before the class begins.
 *
 * No transaction: one row, one statement, and `attendance_count` starts at its
 * default of 0 with nothing to reconcile.
 *
 * @param request JSON body validated by `createClassSchema`
 * @returns 201 the created class, with `id`
 * @throws 404 the feature flag is off
 * @throws 401 / 403 not signed in / not staff
 * @throws 422 body fails validation, or `weekId` / `lectureId` names a row that
 *          does not exist (foreign-key violation, mapped rather than thrown)
 */
export async function POST(request: Request): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const body = await parseBody(request, createClassSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const [row] = await db
      .insert(liveClasses)
      .values({
        weekId: body.value.weekId,
        lectureId: body.value.lectureId ?? null,
        // From the SESSION. See the module header.
        instructorId: gate.user.id,
        title: body.value.title,
        description: body.value.description,
        scheduledAt: body.value.scheduledAt,
        durationMinutes: body.value.durationMinutes,
        enableRecording: body.value.enableRecording,
        maxParticipants: body.value.maxParticipants ?? null,
        allowChat: body.value.allowChat,
        allowQa: body.value.allowQa,
        allowScreenShare: body.value.allowScreenShare,
        jitsiPassword: body.value.jitsiPassword,
      })
      .returning();

    return apiOk(row, 201);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 422) {
      return apiError(422, "The week or lecture named does not exist.", "unknown_parent");
    }
    if (status) return apiError(status, "The class was rejected by the database.", "db_rejected");
    throw error;
  }
}
