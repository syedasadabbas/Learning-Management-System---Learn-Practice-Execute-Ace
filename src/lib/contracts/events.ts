// =============================================================================
// CROSS-STREAM EVENT CONTRACT (frozen)
// -----------------------------------------------------------------------------
// Owner: shared-contracts skill. Do not edit inside feature streams.
//
// Wave 2 and Wave 3 streams call into each other. Rather than let each caller
// invent its own shape, the payloads and signatures live here, and each
// implementing stream fills in the body of its own designated module:
//
//   src/lib/leaderboard/on-scoring-event.ts   -> owned by `leaderboard`
//   src/lib/penalties/rules.ts                -> owned by `penalties-attendance`
//   src/lib/progress/read-model.ts            -> owned by `progress-tracking`
//
// Those three files ship as no-op stubs so that callers (quizzes, submissions,
// course-content) compile and can be wired up from minute one. An owning stream
// replaces the body and MUST NOT change the exported signature — that would
// break its callers on another branch.
// =============================================================================

import type { penaltyType, penaltySeverity } from "@/db/schema";

/** What caused a score to change. Drives leaderboard rebuilds. */
export type ScoringSource = "quiz" | "assignment" | "participation" | "final_project";

/**
 * Emitted whenever a student's score changes. The leaderboard listens; nothing
 * else should. Callers pass the points they just awarded — the leaderboard is
 * responsible for aggregation, so no caller needs to know the running total.
 */
export type ScoringEvent = {
  studentId: number;
  cohortId: number | null;
  source: ScoringSource;
  /** The week this score belongs to. Null for the final project. */
  weekId: number | null;
  /** Points awarded for this source in this week, already scored. */
  points: number;
};

/** Inputs a penalty rule evaluates. Rules are pure — they decide, they do not write. */
export type PenaltyRuleInput = {
  studentId: number;
  /** Days past the deadline, 0 when on time. Use scoring.daysLate() to compute. */
  daysLate: number;
  /** Best quiz percentage for the week, null if no attempt yet. */
  quizBestPercent: number | null;
  /** Whether the deadline passed with nothing submitted at all. */
  missedEntirely: boolean;
};

/** A penalty a rule decided to issue. The caller persists it. */
export type PenaltyDecision = {
  type: (typeof penaltyType.enumValues)[number];
  severity: (typeof penaltySeverity.enumValues)[number];
  description: string;
  penaltyPoints: number;
};

/** Per-week progress, as the dashboard and the week list both need it. */
export type WeekProgress = {
  weekId: number;
  weekNumber: number;
  title: string;
  unlocked: boolean;
  lecturesCompleted: number;
  lectureTotal: number;
  quizCompleted: boolean;
  quizBestPercent: number | null;
  assignmentCompleted: boolean;
  /** Aggregated week score, capped at POINTS.WEEK_MAX. */
  overallScore: number;
};
