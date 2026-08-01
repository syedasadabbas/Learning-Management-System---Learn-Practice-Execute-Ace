// =============================================================================
// GET /api/classes/:classId/recording  —  "student"
// PUT /api/classes/:classId/recording  —  "instructor" AND owner (or admin)
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// A RECORDING CONTAINS STUDENTS' FACES, NAMES AND VOICES. `is_public` defaults
// to FALSE in the schema and the comment there says the default is the point.
// This route honours it: a student may read a recording only when it is public,
// and the visibility test is a WHERE clause, not a field the response omits.
// Staff (the owner or an admin) may read it regardless, because they are the
// ones who decide whether to publish.
//
// `transcription` IS NOT IN THE READ PROJECTION. It is a large TEXT column that
// the schema deliberately kept off the class table so it would not be dragged
// into every list query; returning it from the per-class read would reintroduce
// that cost on the one endpoint a class page calls on load. It is available to
// staff through the PUT round trip, which is the only consumer that needs it.
//
// SOFT DELETE IS RESPECTED. `deleted_at IS NOT NULL` means the file is gone but
// the fact that a recording existed is not — the schema says this distinction is
// a question students actually ask. Such a row reads as `{ status: "deleted" }`
// rather than as a 404, which would say "never recorded".
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { classRecordings, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { parseBody } from "@/lib/learning/schemas";
import { mustOwn } from "@/lib/live-classes/access";
import { upsertRecordingSchema } from "@/lib/live-classes/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * Read the recording of a class.
 *
 * @param ctx path: `classId`
 * @returns 200 the recording metadata (no transcript — see the module header),
 *          or `{ status: "deleted" }` for a soft-deleted one
 * @throws 404 flag off, no such class, no recording, or a recording that is not
 *          public and the caller is neither its instructor nor an admin. All
 *          four are the same answer on purpose: a student must not be able to
 *          distinguish "no recording" from "a recording you may not see", or
 *          the endpoint becomes a way to enumerate private recordings
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
      id: classRecordings.id,
      classId: classRecordings.classId,
      fileName: classRecordings.fileName,
      filePath: classRecordings.filePath,
      fileSizeMb: classRecordings.fileSizeMb,
      durationSeconds: classRecordings.durationSeconds,
      recordingStartedAt: classRecordings.recordingStartedAt,
      recordingEndedAt: classRecordings.recordingEndedAt,
      isPublic: classRecordings.isPublic,
      hlsUrl: classRecordings.hlsUrl,
      dashUrl: classRecordings.dashUrl,
      createdAt: classRecordings.createdAt,
      deletedAt: classRecordings.deletedAt,
      recordingStatus: liveClasses.recordingStatus,
      instructorId: liveClasses.instructorId,
    })
    .from(classRecordings)
    .innerJoin(liveClasses, eq(liveClasses.id, classRecordings.classId))
    .where(eq(classRecordings.classId, classId))
    .limit(1);

  if (!row) return apiError(404, "No recording for this class.", "not_found");

  // The visibility decision, made from the SESSION. A student sees a private
  // recording as "not found" — the same answer as no recording at all.
  const isStaffViewer =
    gate.user.role === "admin" ||
    (gate.user.role === "instructor" && row.instructorId === gate.user.id);

  if (!row.isPublic && !isStaffViewer) {
    return apiError(404, "No recording for this class.", "not_found");
  }

  if (row.deletedAt !== null) {
    // Distinguishable from "never recorded", which is the 404 above.
    return apiOk({
      classId: row.classId,
      status: "deleted" as const,
      deletedAt: row.deletedAt,
      recordedAt: row.recordingStartedAt,
    });
  }

  const { instructorId: _instructorId, deletedAt: _deletedAt, ...recording } = row;
  return apiOk({ ...recording, status: "available" as const });
}

/**
 * Create or replace the recording metadata for a class.
 *
 * UPSERT against `class_recordings_class_idx` (UNIQUE on `class_id`), which is
 * the ON CONFLICT target the schema header names for exactly this job. Not a
 * check-then-insert: the ingest job and an instructor pasting a URL can race,
 * and the unique index is what makes the race a no-op instead of two rows.
 *
 * Transactional, because it also denormalizes `recording_url` and
 * `recording_status` onto `live_classes` — the class list renders a "watch
 * recording" affordance for every row and the schema keeps those two columns so
 * that list needs no join. `class_recordings` stays the source of truth.
 *
 * @param request JSON body validated by `upsertRecordingSchema`
 * @param ctx     path: `classId`
 * @returns 200 the stored recording row. 200 rather than 201 on first write:
 *          the resource address is fixed by the class and does not change
 *          between create and replace, so a caller cannot act on the difference.
 * @throws 404 flag off, no such class, or the caller does not own it
 * @throws 401 / 403 not signed in / not staff
 * @throws 422 body fails validation, or a CHECK rejects it (an inverted
 *          recording window, a negative size)
 * @throws 400 `classId` is not a positive integer
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

  const body = await parseBody(request, upsertRecordingSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const ownerFilter = mustOwn(gate.user.role)
    ? and(eq(liveClasses.id, classId), eq(liveClasses.instructorId, gate.user.id))
    : eq(liveClasses.id, classId);

  try {
    const saved = await db.transaction(async (tx) => {
      const [cls] = await tx
        .select({ id: liveClasses.id })
        .from(liveClasses)
        .where(ownerFilter)
        .limit(1);
      if (!cls) return null;

      const values = {
        classId,
        fileName: body.value.fileName,
        filePath: body.value.filePath,
        fileSizeMb: body.value.fileSizeMb,
        durationSeconds: body.value.durationSeconds,
        recordingStartedAt: body.value.recordingStartedAt,
        recordingEndedAt: body.value.recordingEndedAt,
        transcription: body.value.transcription,
        isPublic: body.value.isPublic,
        hlsUrl: body.value.hlsUrl,
        dashUrl: body.value.dashUrl,
        // A re-PUT of a soft-deleted recording restores it: the operator is
        // explicitly saying a file is there again.
        deletedAt: null,
      };

      const [row] = await tx
        .insert(classRecordings)
        .values(values)
        .onConflictDoUpdate({ target: classRecordings.classId, set: values })
        .returning();

      await tx
        .update(liveClasses)
        .set({
          recordingStatus: body.value.status,
          // The URL the class list links to. HLS first because it is the format
          // a browser can actually stream; `file_path` is the fallback for a
          // plain file upload.
          recordingUrl: body.value.hlsUrl ?? body.value.filePath ?? null,
        })
        .where(eq(liveClasses.id, classId));

      return row;
    });

    if (!saved) return apiError(404, "Class not found.", "not_found");

    const { transcription: _transcription, ...withoutTranscript } = saved;
    return apiOk(withoutTranscript);
  } catch (error) {
    const status = statusForDbError(error);
    if (status) {
      return apiError(status, "The recording was rejected by the database.", "db_rejected");
    }
    throw error;
  }
}
