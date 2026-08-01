// =============================================================================
// PENALTIES BARREL — pure modules only.
// -----------------------------------------------------------------------------
// `./service` imports @/db and `./actions` is a "use server" module; both are
// deliberately NOT re-exported here so that a client component importing the
// barrel cannot drag a database pool into the browser bundle. Import those two
// directly from server code:
//     import { penaltySummary } from "@/lib/penalties/service";
//     import { resolvePenaltyAction } from "@/lib/penalties/actions";
// =============================================================================

export {
  MS_PER_DAY,
  SEVERITY_DEMERITS,
  LATE_WARNING_MAX_DAYS,
  LATE_NOTICE_MAX_DAYS,
  effectiveDaysLate,
  lateSeverity,
  evaluatePenalties,
  evaluatePenaltiesWithGrace,
  evaluateSubmissionPenalty,
  evaluateMissedDeadlinePenalty,
  evaluateQuizPenalty,
} from "./rules";
export type { PenaltySeverityName, PenaltyTypeName } from "./rules";

export {
  ESCALATION_PENALTY_COUNT,
  ESCALATION_DEMERIT_POINTS,
  escalationFor,
  dedupeAgainstExisting,
} from "./accumulation";
export type { CountablePenalty, EscalationState } from "./accumulation";
