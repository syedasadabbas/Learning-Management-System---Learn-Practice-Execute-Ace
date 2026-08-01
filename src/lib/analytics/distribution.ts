// =============================================================================
// DISTRIBUTIONS AND HEATMAP SHAPING (PURE) — advanced-analytics extension.
// -----------------------------------------------------------------------------
// GRADE BANDS COME FROM THE SCORING CONTRACT, NOT FROM HERE.
// `gradeDistribution` buckets students by calling `letterGrade` and
// `courseMaxScore` from src/lib/contracts/scoring.ts on totals read out of the
// denormalised `leaderboard` table. Two things follow, and both are the point:
//
//   1. The totals are not recomputed. `leaderboard.total_score` is written by
//      src/lib/leaderboard/rebuild.ts, which is the only writer and which applies
//      the scoring contract at write time. Re-deriving a total here would be a
//      second implementation of scoring, which scoring.ts explicitly forbids, and
//      it would have gone WRONG today: the contract changed on 2026-07-31 so that
//      an ungraded submission scores 0 rather than 40 (see the long note on
//      `assignmentPoints`). Any hand-rolled `40 - penalties` arithmetic in an
//      analytics query would still be showing the old, inflated number.
//   2. The A/B/C/D/F cut-offs are not restated. `letterGrade` owns them. A CASE
//      expression in SQL would have been one round trip cheaper and one source of
//      truth worse.
//
// A student with no `leaderboard` row is ABSENT from the distribution rather than
// counted as an F. Nothing has been scored for them; "F" is a claim about their
// work and would be a false one. The count of students omitted is returned so the
// UI can say so out loud.
// =============================================================================

import { courseMaxScore, letterGrade } from "@/lib/contracts/scoring";

export type Letter = "A" | "B" | "C" | "D" | "F";

/** The bands, in the order they are displayed. */
export const LETTERS: readonly Letter[] = ["A", "B", "C", "D", "F"];

export interface GradeBucket {
  grade: Letter;
  count: number;
}

export interface GradeDistribution {
  buckets: GradeBucket[];
  /** Students with a leaderboard row, i.e. the denominator of the chart. */
  scoredStudentCount: number;
  /** Students in the cohort with no scored row at all. Displayed, not hidden. */
  unscoredStudentCount: number;
  /** The ceiling `letterGrade` was called with, so the page can state it. */
  maxScore: number;
}

/**
 * Bucket cohort totals into letter grades.
 *
 * @param totals            one `leaderboard.total_score` per scored student
 * @param cohortStudentCount total students in scope, scored or not
 */
export function gradeDistribution(
  totals: readonly number[],
  cohortStudentCount: number,
): GradeDistribution {
  const maxScore = courseMaxScore();
  const counts = new Map<Letter, number>(LETTERS.map((l) => [l, 0]));

  let scored = 0;
  for (const total of totals) {
    // A non-finite total is a driver coercion that went wrong, not a grade.
    // Skipping it keeps one bad row from turning the chart into NaN, the same
    // defensive stance `rate()` takes in src/lib/instructor/rates.ts.
    if (!Number.isFinite(total)) continue;
    scored += 1;
    const letter = letterGrade(total, maxScore);
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }

  return {
    buckets: LETTERS.map((grade) => ({ grade, count: counts.get(grade) ?? 0 })),
    scoredStudentCount: scored,
    unscoredStudentCount: Math.max(0, cohortStudentCount - scored),
    maxScore,
  };
}

// ---------------------------------------------------------------------------
// Activity heatmap
// ---------------------------------------------------------------------------

/**
 * Six four-hour blocks. Labels are UTC, and the UI says so: the timestamps in
 * the database are `timestamptz` and the statement extracts the hour in the
 * session time zone, which on this Neon instance is UTC. Rendering them as if
 * they were local time would silently shift every bar by the viewer's offset,
 * and "students work at 02:00" is exactly the kind of wrong conclusion an
 * unlabelled heatmap invites.
 */
export const HOUR_BLOCKS: readonly { block: number; label: string }[] = [
  { block: 0, label: "00-04" },
  { block: 1, label: "04-08" },
  { block: 2, label: "08-12" },
  { block: 3, label: "12-16" },
  { block: 4, label: "16-20" },
  { block: 5, label: "20-24" },
];

/** ISO day of week, 1 = Monday (Postgres `EXTRACT(ISODOW ...)`). */
export const ISO_DAYS: readonly { dow: number; label: string }[] = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 7, label: "Sun" },
];

/** One cell of the heatmap as the statement returns it. */
export interface HeatmapCellRow {
  dow: number;
  block: number;
  count: number;
}

export interface HeatmapCell extends HeatmapCellRow {
  /** 0..1 against the busiest cell. 0 for every cell when the grid is empty. */
  intensity: number;
}

export interface Heatmap {
  cells: HeatmapCell[];
  max: number;
  total: number;
}

/**
 * Fill the 7x6 grid, including empty cells.
 *
 * Sparse input would render as a grid with holes, and a hole reads as "no data
 * available" when it means "nobody worked then" — the same distinction
 * `getQuizDistribution` makes when it returns empty buckets.
 *
 * Intensity is relative to the busiest cell, not absolute: the useful question
 * is "when is this cohort working", which is a shape, not a magnitude. `max` and
 * `total` are returned so the legend can state the magnitude too.
 */
export function buildHeatmap(rows: readonly HeatmapCellRow[]): Heatmap {
  const byKey = new Map<string, number>();
  let max = 0;
  let total = 0;
  for (const row of rows) {
    const n = Number.isFinite(row.count) ? row.count : 0;
    byKey.set(`${row.dow}:${row.block}`, n);
    if (n > max) max = n;
    total += n;
  }

  const cells: HeatmapCell[] = [];
  for (const day of ISO_DAYS) {
    for (const hb of HOUR_BLOCKS) {
      const count = byKey.get(`${day.dow}:${hb.block}`) ?? 0;
      cells.push({
        dow: day.dow,
        block: hb.block,
        count,
        intensity: max > 0 ? count / max : 0,
      });
    }
  }
  return { cells, max, total };
}
