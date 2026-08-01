// =============================================================================
// GRAND-QUIZ BARREL — import from "@/lib/grand-quiz".
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// `./queries` is NOT re-exported. It is the only module here that imports @/db,
// and keeping it behind a deep import means a page or a component cannot reach a
// raw query by accident — everything goes through ./service, which applies the
// invariants. `src/lib/execution/index.ts` withholds `runOnPiston` for the same
// reason and states it as a rule.
//
// Nothing exported here carries an answer key. `./payload` is the barrier; see its
// header for what must never cross it.
// =============================================================================

export {
  loadExam,
  loadExamOverview,
  saveExamAnswer,
  startExam,
  submitExam,
  sweepExpiredExams,
  SWEEP_LIMIT,
} from "./service";
export type {
  ExamErrorCode,
  ExamOutcome,
  ExamOverview,
  ExamView,
  SaveAnswerInput,
  SubmitExamInput,
  SweepReport,
} from "./service";

export type {
  ExamAttemptMeta,
  ExamInProgressPayload,
  ExamMeta,
  ExamOption,
  ExamQuestion,
  ExamResult,
  ExamResultAnswer,
  ExamSavedSelection,
} from "./payload";

export {
  clampAwarded,
  provisionalCeiling,
  summariseExam,
  sumAwarded,
} from "./grading";
export type { ExamAnswerRow, ExamSummary } from "./grading";

export {
  countdownSeed,
  effectiveTimeLimitMinutes,
  elapsedMs,
  GRAND_QUIZ_DEFAULT_MINUTES,
  isExpired,
  MS_PER_MINUTE,
  remainingMs,
} from "./timing";
export type { CountdownSeed } from "./timing";

export {
  ATTEMPT_STATUSES,
  autosaveDecision,
  isProvisionalStatus,
  isTerminal,
  statusForFinalized,
  TERMINAL_STATUSES,
} from "./state";
export type { AttemptStatus, AutosaveDecision, AutosaveRefusal } from "./state";

/** Route param parsing is shared with the quizzes stream — one parser, not two. */
export { parsePositiveInt } from "@/lib/quizzes/params";
