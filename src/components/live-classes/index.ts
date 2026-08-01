// =============================================================================
// LIVE-CLASSES COMPONENT BARREL.
// -----------------------------------------------------------------------------
// Every component here is a client component and several of them contact a
// third-party host (Jitsi) or poll an API. NONE of them may be mounted on a page
// that has not called `requireFeature("liveClasses")` first — the flag defaults
// OFF and the guard is what makes a disabled feature indistinguishable from one
// that was never built.
// =============================================================================

export { LiveClassRoom, useIsWide, SIDE_BY_SIDE_MIN_PX } from "./LiveClassRoom";
export type { LiveClassRoomProps } from "./LiveClassRoom";

export { JitsiEmbed, loadJitsiScript } from "./JitsiEmbed";
export type { JitsiEmbedProps, JitsiApi, JitsiApiConstructor } from "./JitsiEmbed";

export { ChatPanel, CHAT_MAX_CHARS, REST_POLL_MS } from "./ChatPanel";
export type { ChatPanelProps } from "./ChatPanel";

export { QAPanel, QA_MAX_CHARS, QA_POLL_MS } from "./QAPanel";
export type { QAPanelProps } from "./QAPanel";

export { ParticipantsPanel, ROSTER_POLL_MS } from "./ParticipantsPanel";
export type { ParticipantsPanelProps } from "./ParticipantsPanel";

export { ClassScheduler, toIsoInstant } from "./ClassScheduler";
export type { ClassSchedulerProps } from "./ClassScheduler";

export { ClassCalendar, groupByLocalDay, formatLocalTime } from "./ClassCalendar";
export type { ClassCalendarProps } from "./ClassCalendar";

export { ClassRecording, formatDuration, formatSize } from "./ClassRecording";
export type { ClassRecordingProps } from "./ClassRecording";

export { AttendanceReport, presencePercent } from "./AttendanceReport";
export type { AttendanceReportProps } from "./AttendanceReport";

export { ClassStatusBadge, RealtimeStatusLine } from "./ClassStatusBadge";
export type { ClassStatusBadgeProps, RealtimeStatusLineProps } from "./ClassStatusBadge";

export type {
  ClassStatus,
  RecordingStatus,
  LiveClassSummary,
  JoinPayload,
  ChatRow,
  QaRow,
  AttendanceRow,
  AttendanceReportPayload,
  RecordingPayload,
  PendingChatMessage,
} from "./types";
