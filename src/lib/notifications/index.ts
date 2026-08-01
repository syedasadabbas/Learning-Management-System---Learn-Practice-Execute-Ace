// =============================================================================
// NOTIFICATIONS BARREL — the surface other streams import.
// Owner: the email-notifications stream.
// -----------------------------------------------------------------------------
// Deliberately NARROW. It exports the three producers, the preference read/write,
// and the history read model — and it does NOT export the record/enqueue internals
// or the queue handler. A caller that reaches for `recordAndEnqueue` directly is
// about to mint an idempotency key inline, which is the mistake ./keys.ts exists to
// prevent; the queue handler is reached only through ../queue/registry.ts.
//
// The one deliberate exception is `src/lib/queue/handlers/notification-email.ts`,
// which imports "@/lib/notifications/record" directly. That is the consumer half of
// this module and re-exporting its internals here just to satisfy a barrel would
// widen the surface for everyone else — the same reason src/lib/mail/index.ts does
// not re-export ./dispatch.
// =============================================================================

export {
  notifyExamCompleted,
  notifyPeerReviewAssigned,
  notifyPenaltyIssued,
  notifyQuizSubmitted,
} from "./producers";
export type {
  ExamCompletedEvent,
  PeerReviewAssignedEvent,
  PenaltyIssuedEvent,
  QuizSubmittedEvent,
} from "./producers";

export {
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  UNIMPLEMENTED_PREFERENCE_KEYS,
  isEnabled,
  isEnabledFor,
  preferencesFromFormData,
  resolvePreferences,
  resolvePreferencesOrDefault,
  savePreferences,
} from "./preferences";
export type { NotificationPreferences } from "./preferences";

export { HISTORY_LIMIT, listNotifications, markAllRead, unreadCount } from "./history";
export type { HistoryEntry } from "./history";

export {
  NOTIFICATION_JOB_KIND,
  NOTIFICATION_TYPE_LABELS,
  PREFERENCE_COLUMN_FOR_TYPE,
} from "./types";
export type {
  NotificationMetadata,
  NotificationType,
  NotifyResult,
  NotifySkipReason,
} from "./types";

export {
  quizSubmittedKey,
  examCompletedKey,
  peerReviewAssignedKey,
  penaltyIssuedKey,
} from "./keys";
