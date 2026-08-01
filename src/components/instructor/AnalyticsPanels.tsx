// =============================================================================
// ANALYTICS PANELS — instructor-admin stream.
// -----------------------------------------------------------------------------
// Server components: the numbers arrive already aggregated by Postgres, so there
// is nothing for the client to compute and no reason to ship JavaScript for it.
//
// EVERY RATE PASSES THROUGH RateText / RateTile, which render the word "no data"
// when the denominator is zero. There is no `${x/y*100}%` template anywhere in
// this file — that expression is how "NaN%" reaches a page.
// =============================================================================

import { Badge, Card, EmptyState, ProgressBar } from "@/components/ui";
import type {
  AtRiskStudent,
  CohortAnalytics,
  ScoreBucket,
  WeekAnalytics,
} from "@/lib/instructor/analytics";
import { AverageText, RateText, RateTile, StatTile } from "./StatTile";

export function AnalyticsSummary({ analytics }: { analytics: CohortAnalytics }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="analytics-summary">
      <StatTile
        label="Students"
        value={analytics.studentCount}
        hint={analytics.cohortId === null ? "All cohorts" : `Cohort ${analytics.cohortId}`}
        muted={analytics.studentCount === 0}
      />
      <RateTile
        label="Quiz pass rate"
        rate={analytics.overallQuizPassRate}
        denominatorNoun="quiz attempts by student and week"
        testId="tile-pass-rate"
      />
      <RateTile
        label="Submission rate"
        rate={analytics.overallSubmissionRate}
        denominatorNoun="expected submissions"
        testId="tile-submission-rate"
      />
      <StatTile
        label="At risk"
        value={analytics.atRisk.length}
        hint="3 or more unresolved penalties"
        muted={analytics.atRisk.length === 0}
      />
    </div>
  );
}

export function WeekAnalyticsTable({ weeks }: { weeks: readonly WeekAnalytics[] }) {
  if (weeks.length === 0) {
    return (
      <EmptyState
        title="No weeks configured"
        description="Analytics are grouped by course week. Seed or create the course structure first."
      />
    );
  }

  return (
    <Card padded={false} title="Per-week analytics" data-testid="week-analytics-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="week-analytics-table">
          <caption className="sr-only">
            Pass rate, submission rate and completion rate by week
          </caption>
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Week</th>
              <th scope="col" className="px-3 py-2">Quiz pass rate</th>
              <th scope="col" className="px-3 py-2">Avg best quiz</th>
              <th scope="col" className="px-3 py-2">Submissions</th>
              <th scope="col" className="px-3 py-2">Graded</th>
              <th scope="col" className="px-3 py-2">Late</th>
              <th scope="col" className="px-3 py-2">Completion</th>
              <th scope="col" className="px-3 py-2">Avg stars</th>
              <th scope="col" className="px-3 py-2">Avg score</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekId} className="border-t border-line" data-testid="week-analytics-row">
                <td className="px-3 py-2">
                  <span className="font-medium">Week {w.weekNumber}</span>
                  <span className="block text-xs text-ink-muted">{w.title}</span>
                </td>
                <td className="px-3 py-2">
                  <RateText rate={w.quizPassRate} />
                  <span className="block text-xs text-ink-muted">
                    {w.quizPassedCount}/{w.quizAttemptedCount} attempted
                  </span>
                </td>
                <td className="px-3 py-2">
                  <AverageText value={w.quizAvgBestPercent} suffix="%" />
                </td>
                <td className="px-3 py-2">
                  <RateText rate={w.submissionRate} />
                  <span className="block text-xs text-ink-muted">
                    {w.submissionCount} of {w.studentCount} students
                  </span>
                </td>
                <td className="px-3 py-2">
                  <RateText rate={w.gradedRate} />
                </td>
                <td className="px-3 py-2 tabular-nums">{w.lateCount}</td>
                <td className="px-3 py-2">
                  <RateText rate={w.completionRate} />
                </td>
                <td className="px-3 py-2">
                  <AverageText value={w.avgStars} />
                </td>
                <td className="px-3 py-2">
                  <AverageText value={w.avgAssignmentScore} suffix=" / 40" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function QuizDistribution({ buckets }: { buckets: readonly ScoreBucket[] }) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <Card
      title="Quiz score distribution"
      subtitle="Each student's best percentage per week"
      data-testid="quiz-distribution-card"
    >
      {total === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="distribution-no-data">
          No quiz attempts recorded yet, so there is no distribution to show. This
          is the expected state before the first quiz is taken.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="quiz-distribution">
          {buckets.map((b) => (
            <li key={b.label} data-testid={`bucket-${b.label}`}>
              <ProgressBar
                // total > 0 is guaranteed in this branch, so this division is
                // safe; clampPercent inside ProgressBar would catch it anyway.
                percent={(b.count / total) * 100}
                label={`${b.label}%`}
                tone={b.from >= 70 ? "success" : b.from >= 50 ? "accent" : "danger"}
                size="sm"
                showValue={false}
              />
              <span className="text-xs text-ink-muted tabular-nums">
                {b.count} student-week{b.count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AtRiskList({ students }: { students: readonly AtRiskStudent[] }) {
  return (
    <Card
      title="At-risk students"
      subtitle="Three or more unresolved penalties"
      data-testid="at-risk-card"
    >
      {students.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No student is carrying three or more unresolved penalties.
        </p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {students.map((s) => (
            <li key={s.studentId} className="flex items-center justify-between py-2">
              {/*
                NAME ONLY. This used to render `s.email` underneath, which put
                every at-risk student's address on three staff surfaces and in the
                API response body. `getAtRiskStudents` no longer selects the
                column, so there is nothing to render even if someone adds the
                line back — see the note on that function for why fixing it at the
                query beat redacting it per call site (one of the three call sites
                had already been missed).
              */}
              <span className="font-medium">{s.name}</span>
              <span className="flex items-center gap-2">
                <Badge tone="danger" size="sm">
                  {s.penaltyCount} penalties
                </Badge>
                <span className="tabular-nums text-ink-muted">-{s.penaltyPoints} pts</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
