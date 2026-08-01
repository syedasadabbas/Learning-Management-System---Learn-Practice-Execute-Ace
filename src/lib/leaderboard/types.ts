// =============================================================================
// LEADERBOARD READ-MODEL TYPES — the shape the API and the page both consume.
// Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// PRIVACY NOTE (load-bearing, not a comment for decoration)
//
// A student may read the whole cohort's standings. So these row types carry
// ONLY name, avatar and scores. There is deliberately no `email` field, and no
// index signature: a later `select()` that accidentally pulls users.email will
// fail to type-check against `LeaderboardEntry` instead of quietly serialising
// 60 classmates' email addresses to the browser.
// =============================================================================

import type { ComponentScores } from "./ranking";

/** Which board the client is asking for. */
export type LeaderboardScope = "overall" | "week";

/** Columns the table can be sorted by. Rank order is the default. */
export type LeaderboardSortKey =
  | "rank"
  | "name"
  | "total"
  | "quiz"
  | "assignment"
  | "participation"
  | "finalProject"
  | "stars";

export type SortDirection = "asc" | "desc";

export const SORT_KEYS: readonly LeaderboardSortKey[] = [
  "rank",
  "name",
  "total",
  "quiz",
  "assignment",
  "participation",
  "finalProject",
  "stars",
];

/** One row of the overall board. */
export interface LeaderboardEntry extends ComponentScores {
  studentId: number;
  name: string;
  avatarUrl: string | null;
  totalScore: number;
  /** Ordinal rank within the cohort, 1-based. */
  ranking: number;
  /** Mean instructor star rating over graded submissions, null when unrated. */
  avgStars: number | null;
  /** Letter grade from scoring.ts — never computed in a component. */
  letterGrade: "A" | "B" | "C" | "D" | "F";
  /** True for the signed-in viewer's own row. Drives the highlight. */
  isCurrentUser: boolean;
}

/** One row of a per-week board. Weekly boards have no component breakdown. */
export interface WeeklyLeaderboardEntry {
  studentId: number;
  name: string;
  avatarUrl: string | null;
  ranking: number;
  /** progress.overallScore for this week, capped at POINTS.WEEK_MAX upstream. */
  weekScore: number;
  /** Mean stars on this week's assignment only. */
  avgStars: number | null;
  lecturesCompleted: number;
  quizCompleted: boolean;
  assignmentCompleted: boolean;
  isCurrentUser: boolean;
}

/** A selectable week in the per-week tab. */
export interface LeaderboardWeekOption {
  weekId: number;
  weekNumber: number;
  title: string;
}

/** A selectable cohort. Only staff ever receive more than one. */
export interface LeaderboardCohortOption {
  cohortId: number;
  name: string;
}

/** `GET /api/leaderboard` payload. */
export interface LeaderboardView {
  scope: LeaderboardScope;
  cohortId: number | null;
  cohortName: string | null;
  /** Null on the overall board. */
  weekId: number | null;
  sort: LeaderboardSortKey;
  direction: SortDirection;
  /** Course-wide maximum from scoring.ts, so the UI never hardcodes 310. */
  maxScore: number;
  /** Populated when scope === "overall". */
  entries: LeaderboardEntry[];
  /** Populated when scope === "week". */
  weeklyEntries: WeeklyLeaderboardEntry[];
  weeks: LeaderboardWeekOption[];
  cohorts: LeaderboardCohortOption[];
  /** Total ranked students in this cohort — the "of 52" in "7th of 52". */
  studentCount: number;
  /** The viewer's own standing, null for staff with no row of their own. */
  me: MyStanding | null;
}

/** `GET /api/leaderboard/me` payload. */
export interface MyStanding {
  studentId: number;
  name: string;
  cohortId: number | null;
  cohortName: string | null;
  ranking: number | null;
  studentCount: number;
  totalScore: number;
  maxScore: number;
  letterGrade: "A" | "B" | "C" | "D" | "F";
  avgStars: number | null;
  quizScore: number;
  assignmentScore: number;
  participationScore: number;
  finalProjectScore: number;
  /** Milliseconds since the row was last rebuilt (metric units, per house rules). */
  staleForMs: number | null;
}
