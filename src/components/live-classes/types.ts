// =============================================================================
// CLIENT-SIDE SHAPES for the live-classes surfaces.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// Timestamps are STRINGS, not Dates — see the header of
// src/components/learn/samples/types.ts for the argument. It applies with more
// force here because these rows cross the wire on every poll.
// =============================================================================

export type ClassStatus = "scheduled" | "active" | "ended" | "cancelled";

export type RecordingStatus =
  | "not_recorded"
  | "processing"
  | "available"
  | "failed"
  | "deleted";

/** A row from `GET /api/classes` or `GET /api/classes/upcoming`. */
export interface LiveClassSummary {
  id: number;
  weekId: number;
  lectureId: number | null;
  instructorId: number;
  instructorName?: string | null;
  title: string;
  description: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: ClassStatus;
  startedAt: string | null;
  endedAt: string | null;
  attendanceCount: number;
  maxParticipants: number | null;
  allowChat: boolean;
  allowQa: boolean;
  allowScreenShare: boolean;
  enableRecording: boolean;
}

/** The `apiOk` payload of `GET /api/classes/:classId/join`. */
export interface JoinPayload {
  canJoin: true;
  jitsiConfig: {
    roomName: string;
    password: string | null;
    serverUrl: string;
  };
  attendance: {
    joinedAt: string;
    firstJoin: boolean;
  };
  class: {
    id: number;
    title: string;
    status: ClassStatus;
    durationMinutes: number;
    allowChat: boolean;
    allowQa: boolean;
    allowScreenShare: boolean;
    startedAt: string | null;
  };
}

/** A row from `GET /api/classes/:classId/chat`. */
export interface ChatRow {
  id: number;
  classId: number;
  senderId: number;
  senderName?: string | null;
  message: string;
  messageType: "text" | "system" | "poll" | "announcement";
  parentMessageId: number | null;
  isPinned: boolean;
  isDeleted: boolean;
  createdAt: string;
}

/** A row from `GET /api/classes/:classId/qa`. */
export interface QaRow {
  id: number;
  classId: number;
  studentId: number;
  studentName?: string | null;
  question: string;
  answer: string | null;
  instructorId: number | null;
  isAnswered: boolean;
  isPinned: boolean;
  upvotes: number;
  createdAt: string;
  answeredAt: string | null;
}

/**
 * A row from `GET /api/classes/:classId/attendance` (instructor only).
 *
 * Field names taken from the route's own `select({...})`, not guessed from the
 * table: the route renames `users.name` to `studentName` in the projection and
 * a component typed from `classAttendance` would look for a column that is not
 * in the response.
 */
export interface AttendanceRow {
  id: number;
  studentId: number;
  studentName: string | null;
  studentEmail: string | null;
  joinedAt: string;
  leftAt: string | null;
  timePresentMinutes: number;
  messagesSent: number;
  questionsAsked: number;
  screenShareCount: number;
  markedPresent: boolean;
  participationScore: number;
}

/** The attendance envelope: a page, plus the class's planned length. */
export interface AttendanceReportPayload {
  items: AttendanceRow[];
  limit: number;
  offset: number;
  total: number;
  classDurationMinutes: number;
}

/**
 * The `apiOk` payload of `GET /api/classes/:classId/recording`.
 *
 * Two shapes behind one route: a soft-deleted recording answers with
 * `{ status: "deleted" }` and almost nothing else, which is why every media
 * field below is optional. Modelled as one optional-heavy interface rather than
 * a union because the consumer's job is "render what is there", and a union
 * would push a discriminant check into JSX for no behavioural gain.
 *
 * Metric units, and the route's names are kept: MEGABYTES and SECONDS.
 * Converting to minutes here would leave two spellings of the same number.
 */
export interface RecordingPayload {
  id: number;
  classId: number;
  status: "available" | "deleted";
  fileName?: string | null;
  filePath?: string | null;
  fileSizeMb?: number | null;
  durationSeconds?: number | null;
  recordingStartedAt?: string | null;
  recordingEndedAt?: string | null;
  isPublic?: boolean;
  hlsUrl?: string | null;
  dashUrl?: string | null;
  createdAt?: string;
  deletedAt?: string | null;
  recordedAt?: string | null;
  recordingStatus?: RecordingStatus;
}

/**
 * An optimistically-rendered chat message that has no server id yet.
 *
 * Kept as a distinct type rather than a `ChatRow` with `id: -1`, because a
 * negative id would flow into the React key, the edit route and the delete
 * route identically to a real one, and the first bug that produces is a student
 * deleting message 1 by pressing delete on their own pending message.
 */
export interface PendingChatMessage {
  /** Client-generated correlation id. Never sent to a route as an identifier. */
  clientRef: string;
  message: string;
  senderName: string | null;
  createdAt: string;
  /** Set when the POST failed; the row stays visible with a retry affordance. */
  failed: boolean;
}
