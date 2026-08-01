// =============================================================================
// PERFORMANCE DISTRIBUTION — letter grades across the cohort, as a histogram.
// -----------------------------------------------------------------------------
// CSS bars, no charting dependency. See the note at the top of
// CourseProgressChart.tsx for the kB argument.
//
// THIS IS NOT THE QUIZ HISTOGRAM. `QuizDistribution`
// (src/components/instructor/AnalyticsPanels.tsx) buckets each student's best
// QUIZ PERCENTAGE and already ships on both analytics pages; it stays. This one
// buckets the COURSE TOTAL — `leaderboard.total_score` out of
// `courseMaxScore()` — into the A..F bands the scoring contract defines, so it is
// the distribution of grades rather than of one assessment. Both are shown,
// captioned, side by side.
//
// UNSCORED STUDENTS ARE STATED, NOT SILENTLY DROPPED OR COUNTED AS F. See the
// header of src/lib/analytics/distribution.ts.
// =============================================================================

import { Card } from "@/components/ui";
import type { GradeDistribution } from "@/lib/analytics/distribution";

export interface PerformanceDistributionProps {
  grades: GradeDistribution;
}

/** Bar colours per band. Tokens where they exist; the amber/red scale is the same
 *  one Badge uses for warning/danger, so the page has one visual language. */
const BAND_CLASS: Record<string, string> = {
  A: "bg-emerald-500",
  B: "bg-emerald-400",
  C: "bg-amber-400",
  D: "bg-amber-500",
  F: "bg-red-500",
};

export function PerformanceDistribution({ grades }: PerformanceDistributionProps) {
  const { buckets, scoredStudentCount, unscoredStudentCount, maxScore } = grades;
  // Scale against the tallest bar, not against the cohort: with 3 of 7 students
  // scored, scaling by cohort size makes every bar look like a failure.
  const tallest = buckets.reduce((n, b) => Math.max(n, b.count), 0);

  return (
    <Card
      padded
      title="Grade distribution"
      subtitle={`Course totals out of ${maxScore}, banded by the scoring contract.`}
      data-testid="analytics-grade-distribution"
    >
      {scoredStudentCount === 0 ? (
        <p className="mt-3 text-sm text-ink-muted" data-testid="grade-distribution-empty">
          No scores yet — nothing has been graded, so there is no distribution to
          draw. This is the normal state of a new cohort, not an error.
        </p>
      ) : (
        <div className="mt-4 flex items-end gap-3" style={{ height: "140px" }}>
          {buckets.map((bucket) => {
            const heightPct = tallest > 0 ? (bucket.count / tallest) * 100 : 0;
            return (
              <div
                key={bucket.grade}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                data-testid={`grade-bar-${bucket.grade}`}
                data-count={bucket.count}
              >
                <span className="text-xs tabular-nums text-ink-muted">
                  {bucket.count}
                </span>
                <div
                  className={`w-full rounded-t ${BAND_CLASS[bucket.grade] ?? "bg-brand"}`}
                  // A bar of exactly 0 still gets 2px so the band is visibly
                  // present and empty, rather than absent — the same reason
                  // getQuizDistribution returns empty buckets.
                  style={{ height: bucket.count === 0 ? "2px" : `${Math.max(4, heightPct)}%` }}
                  role="img"
                  aria-label={`${bucket.count} student(s) at grade ${bucket.grade}`}
                />
                <span className="text-sm font-semibold text-ink">{bucket.grade}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted" data-testid="grade-distribution-caption">
        {scoredStudentCount} student{scoredStudentCount === 1 ? "" : "s"} scored
        {unscoredStudentCount > 0 && (
          <>
            {" · "}
            <span data-testid="grade-unscored-count">
              {unscoredStudentCount} not yet scored
            </span>{" "}
            (excluded — an unscored student is not an F)
          </>
        )}
      </p>
    </Card>
  );
}
