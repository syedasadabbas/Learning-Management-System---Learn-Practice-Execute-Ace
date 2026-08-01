// =============================================================================
// REQUEST VALIDATION — live-classes write payloads.
// Owner: the API stream.
// -----------------------------------------------------------------------------
// Same two conventions as src/lib/learning/schemas.ts and for the same reasons:
// camelCase keys matching the Drizzle columns (DECISIONS.md resolved the
// snake_case-in-the-spec tension in favour of camelCase), and `.strict()` so an
// unknown key is a 422 rather than a silently dropped field.
//
// TIMESTAMPS ARE ISO 8601 STRINGS, PARSED TO `Date`, AND ARE UTC.
// `z.coerce.date()` accepts anything `new Date(x)` accepts, which includes
// `"tomorrow"` (Invalid Date) and the ambiguous `"03/04/2026"`. `z.string()
// .datetime()` requires a real ISO 8601 instant with an offset, which is the
// only form that means the same thing to the browser that sent it and the
// Postgres `timestamptz` that stores it.
//
// WHAT IS NOT ACCEPTED FROM A CLIENT, ANYWHERE IN THIS FILE:
//   `instructorId`  — taken from the session. Accepting it would let an
//                     instructor schedule a class in a colleague's name.
//   `status`        — moved only by /start, /end and DELETE, which enforce the
//                     lifecycle in src/lib/live-classes/access.ts. A settable
//                     status is a client that can mark a class `ended` and strand
//                     everyone in it.
//   `startedAt` / `endedAt` / `attendanceCount` — server facts about what
//                     happened, not requests.
//   `jitsiRoomName` — minted at start. A room name published at schedule time is
//                     a room strangers can be sitting in before the class begins
//                     (the schema says exactly this at the column).
// =============================================================================

import { z } from "zod";

/**
 * An absolute instant in ISO 8601 with an offset, e.g. `2026-08-01T14:00:00Z`.
 *
 * `.datetime({ offset: true })` accepts both `Z` and `+05:00`. A local-time
 * string with no offset is rejected: stored into a `timestamptz` it would be
 * interpreted in the SERVER's zone, so the same request would schedule a
 * different class depending on where it was deployed.
 */
const isoInstant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

/** Planned length. Metric (minutes), CHECKed > 0 in the database. */
const durationMinutes = z.number().int().min(5).max(600);

export const createClassSchema = z
  .object({
    weekId: z.number().int().positive(),
    /** Optional: office hours belong to a week without belonging to a lecture. */
    lectureId: z.number().int().positive().nullable().optional(),
    title: z.string().min(1).max(255),
    description: z.string().max(5_000).optional(),
    scheduledAt: isoInstant,
    durationMinutes: durationMinutes.default(60),
    enableRecording: z.boolean().default(true),
    maxParticipants: z.number().int().positive().max(1_000).nullable().optional(),
    allowChat: z.boolean().default(true),
    allowQa: z.boolean().default(true),
    allowScreenShare: z.boolean().default(true),
    /**
     * The room password an instructor sets. NOT a credential this system mints
     * — see the "what is NOT here" note in schema.live-classes.ts. It is handed
     * to Jitsi and to the students who may join, nothing more.
     */
    jitsiPassword: z.string().min(4).max(255).optional(),
  })
  .strict();

export const updateClassSchema = createClassSchema
  .partial()
  // `weekId` is deliberately still updatable: a class rescheduled into another
  // week is a real correction. What is not updatable is anything in the "NOT
  // accepted" list in the module header, and those are absent from the base
  // object so `.partial()` cannot reintroduce them.
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied");

export type CreateClassInput = z.infer<typeof createClassSchema>;
export type UpdateClassInput = z.infer<typeof updateClassSchema>;

/**
 * Starting a class.
 *
 * `jitsiRoomName` is accepted here and ONLY here, because start is the moment
 * the room is minted. Optional: when absent the handler generates one, which is
 * the normal path — the field exists so an instructor who has already opened a
 * room by hand can attach it rather than being sent to a second one.
 *
 * Constrained to a URL-safe token because it is interpolated into a Jitsi URL.
 * A room name containing `/` or `?` is a different room, or a redirect.
 */
export const startClassSchema = z
  .object({
    jitsiRoomName: z
      .string()
      .min(8)
      .max(255)
      .regex(/^[A-Za-z0-9_-]+$/, "room name must be URL-safe: letters, digits, - and _")
      .optional(),
  })
  .strict();

export type StartClassInput = z.infer<typeof startClassSchema>;

/**
 * Leaving a class.
 *
 * The client reports how long it was connected SINCE ITS LAST JOIN, and the
 * handler ADDS that to the accumulated total. It is a client-supplied number
 * and is therefore bounded hard (0..600 minutes, one class's maximum length):
 * this feeds a participation score, so an unbounded value is a student typing
 * their own mark. The server-side cross-check is in the handler, which also
 * clamps against wall-clock time since `joined_at`.
 */
export const leaveClassSchema = z
  .object({
    minutesPresent: z.number().int().min(0).max(600).optional(),
  })
  .strict();

export type LeaveClassInput = z.infer<typeof leaveClassSchema>;

/** Chat message. */
export const postChatSchema = z
  .object({
    /**
     * 2000 characters. Long enough to paste a stack trace, short enough that a
     * class of 80 cannot fill the transcript table in an afternoon. The column
     * is unbounded TEXT, so this ceiling is the only one there is.
     */
    message: z.string().min(1).max(2_000),
    messageType: z.enum(["text", "system", "poll", "announcement"]).default("text"),
    /** One level of threading; the renderer flattens anything deeper. */
    parentMessageId: z.number().int().positive().optional(),
  })
  .strict();

export type PostChatInput = z.infer<typeof postChatSchema>;

/**
 * Editing or moderating one message.
 *
 * `message` is the author's own edit; `isPinned` and `isDeleted` are moderation.
 * They are in one schema because they are one HTTP method on one resource, and
 * the handler — not the schema — decides which of them THIS caller may set.
 * Putting the authorization in the schema would mean two schemas that must
 * agree about which fields exist.
 */
export const patchChatSchema = z
  .object({
    message: z.string().min(1).max(2_000).optional(),
    isPinned: z.boolean().optional(),
    isDeleted: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied");

export type PatchChatInput = z.infer<typeof patchChatSchema>;

/** Asking a question. */
export const askQuestionSchema = z
  .object({
    question: z.string().min(1).max(2_000),
  })
  .strict();

export type AskQuestionInput = z.infer<typeof askQuestionSchema>;

/**
 * Answering a question.
 *
 * `answer` is optional because an instructor may answer VERBALLY and mark the
 * question resolved — the schema anticipates this (`is_answered` exists
 * separately from `answer` precisely for it). What is NOT optional is that
 * `answered_at` and `is_answered` move together, which
 * `class_qa_answered_consistent` enforces and the handler sets as a pair.
 */
export const answerQuestionSchema = z
  .object({
    answer: z.string().max(10_000).optional(),
  })
  .strict();

export type AnswerQuestionInput = z.infer<typeof answerQuestionSchema>;

/** Instructor moderation of a question. */
export const patchQuestionSchema = z
  .object({
    isPinned: z.boolean().optional(),
    /** Reopening a question that was marked answered in error. */
    isAnswered: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied");

export type PatchQuestionInput = z.infer<typeof patchQuestionSchema>;

/**
 * The instructor's override on one attendance row.
 *
 * `markedPresent` is separate from the existence of the row for the reason the
 * schema states: the row says "this account opened the session", the flag says
 * "I count this as attendance". Un-ticking it must not delete the engagement
 * counters that justify the decision, so those are not settable here.
 */
export const patchAttendanceSchema = z
  .object({
    markedPresent: z.boolean().optional(),
    participationScore: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied");

export type PatchAttendanceInput = z.infer<typeof patchAttendanceSchema>;

/**
 * Recording metadata, written by the ingest job or by an instructor pasting a
 * URL after uploading elsewhere.
 *
 * Metric units, named in the field: megabytes and seconds, matching the columns.
 */
export const upsertRecordingSchema = z
  .object({
    fileName: z.string().max(500).optional(),
    filePath: z.string().max(500).optional(),
    fileSizeMb: z.number().int().min(0).max(1_000_000).optional(),
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
    recordingStartedAt: isoInstant.optional(),
    recordingEndedAt: isoInstant.optional(),
    transcription: z.string().max(2_000_000).optional(),
    /**
     * Defaults to FALSE and the default is the point: a recording contains
     * students' faces, names and voices. Publishing one is an explicit act.
     */
    isPublic: z.boolean().default(false),
    hlsUrl: z.string().url().max(500).optional(),
    dashUrl: z.string().url().max(500).optional(),
    status: z
      .enum(["not_started", "recording", "processing", "available", "failed"])
      .default("available"),
  })
  .strict()
  .refine(
    (v) =>
      v.recordingStartedAt === undefined ||
      v.recordingEndedAt === undefined ||
      v.recordingEndedAt > v.recordingStartedAt,
    "recordingEndedAt must be after recordingStartedAt",
  );

export type UpsertRecordingInput = z.infer<typeof upsertRecordingSchema>;
