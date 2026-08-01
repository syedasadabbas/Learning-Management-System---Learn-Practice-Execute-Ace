// =============================================================================
// PENALTY ACCUMULATION — pure. Owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// `PenaltyDecision` is frozen and has no room for an "escalate now" flag, so
// accumulation lives here as a separate pure judgement over the rows the caller
// already holds. Nothing in this file touches a database.
//
// RESOLVED PENALTIES DO NOT COUNT. An instructor clearing a penalty
// (`penalties.resolved = true`) is a statement that the offence was addressed;
// if a cleared penalty still pushed a student toward escalation, "resolved"
// would mean nothing. Every count below filters on `resolved === false`.
// =============================================================================

import type { PenaltyDecision } from "@/lib/contracts/events";
import { SEVERITY_DEMERITS, type PenaltySeverityName } from "./rules";

/**
 * The subset of a `penalties` row this module needs. Deliberately structural
 * rather than `typeof penalties.$inferSelect` so the function can be called with
 * plain objects in tests and with real rows in production.
 */
export type CountablePenalty = {
  severity: PenaltySeverityName;
  penaltyPoints: number;
  resolved: boolean;
};

/**
 * Unresolved penalties at or above which a student is escalated to the
 * instructor. Three is the syllabus figure: two slips is a pattern, three is a
 * conversation.
 */
export const ESCALATION_PENALTY_COUNT = 3;

/**
 * Demerit total at or above which a student is escalated regardless of count.
 * Two `serious` penalties (3 + 3) reach it, so a student cannot collect two
 * outright failures and stay un-escalated just because the count is under three.
 */
export const ESCALATION_DEMERIT_POINTS = SEVERITY_DEMERITS.serious * 2;

export type EscalationState = {
  /** Penalties still counting against the student (resolved ones excluded). */
  activeCount: number;
  /** Demerit total of those active penalties. */
  activeDemerits: number;
  /** Active penalties broken down by severity. */
  bySeverity: Record<PenaltySeverityName, number>;
  /** True when the instructor should be prompted to intervene. */
  escalated: boolean;
  /** Plain-language reason, safe to show staff. Empty when not escalated. */
  reason: string;
};

/**
 * Fold a student's penalty rows into an escalation decision.
 *
 * Two independent triggers, either sufficient:
 *   1. `activeCount >= ESCALATION_PENALTY_COUNT` (3) — a pattern of slips.
 *   2. `activeDemerits >= ESCALATION_DEMERIT_POINTS` (6) — severity, not volume.
 */
export function escalationFor(penalties: readonly CountablePenalty[]): EscalationState {
  const active = penalties.filter((p) => !p.resolved);

  const bySeverity: Record<PenaltySeverityName, number> = {
    warning: 0,
    notice: 0,
    serious: 0,
  };
  let activeDemerits = 0;

  for (const p of active) {
    bySeverity[p.severity] += 1;
    // Trust the stored points (an instructor may have adjusted them) but fall
    // back to the severity ladder when they are absent or nonsensical.
    activeDemerits += Number.isFinite(p.penaltyPoints) && p.penaltyPoints > 0
      ? p.penaltyPoints
      : SEVERITY_DEMERITS[p.severity];
  }

  const byCount = active.length >= ESCALATION_PENALTY_COUNT;
  const byWeight = activeDemerits >= ESCALATION_DEMERIT_POINTS;

  let reason = "";
  if (byCount && byWeight) {
    reason = `${active.length} unresolved penalties totalling ${activeDemerits} demerit points.`;
  } else if (byCount) {
    reason = `${active.length} unresolved penalties (threshold ${ESCALATION_PENALTY_COUNT}).`;
  } else if (byWeight) {
    reason = `${activeDemerits} demerit points from unresolved penalties (threshold ${ESCALATION_DEMERIT_POINTS}).`;
  }

  return {
    activeCount: active.length,
    activeDemerits,
    bySeverity,
    escalated: byCount || byWeight,
    reason,
  };
}

/**
 * Would issuing these decisions duplicate a penalty the student already holds
 * unresolved? Callers use this so that re-ingesting the same late submission, or
 * re-grading the same quiz, does not stack identical penalties.
 *
 * Matching is by `type` only: a student should not hold two unresolved
 * `late_submission` rows for the same reason, even if the severity changed
 * because more days have passed. Callers wanting to reflect the worse severity
 * should resolve the old row and issue the new one.
 */
export function dedupeAgainstExisting(
  decisions: readonly PenaltyDecision[],
  existing: readonly { type: PenaltyDecision["type"]; resolved: boolean }[],
): PenaltyDecision[] {
  const held = new Set(existing.filter((e) => !e.resolved).map((e) => e.type));
  return decisions.filter((d) => !held.has(d.type));
}
