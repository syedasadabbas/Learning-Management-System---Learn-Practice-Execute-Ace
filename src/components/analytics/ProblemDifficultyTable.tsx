// =============================================================================
// PROBLEM DIFFICULTY — which practice problems the cohort cannot get past.
// -----------------------------------------------------------------------------
// HARDEST FIRST, and "hardest" is defined rather than implied: ascending solve
// rate (distinct solvers / distinct students who ran it), ties broken by attempt
// count. A problem 12 people ran and 2 solved sits above one 2 people ran and
// 1 solved, which is the ordering an instructor wants — the second is noise.
//
// SOLVED USES THE SAME PREDICATE AS THE STUDENT-FACING PAGES.
// `src/lib/problems/completion.ts:attemptPassed` is `totalCount > 0 &&
// passedCount === totalCount`, and the statement's FILTER clause is
// `ca.total_count > 0 AND ca.passed_count = ca.total_count` — the same rule, and
// deliberately not a looser one. `passed_count > 0` would count a partial run as
// a solve and this table would then disagree with the student's own "solved"
// badge about the same row. The reason it is restated in SQL at all is that
// `attemptPassed` is a JavaScript predicate over a row: applying it would mean
// fetching every coding_attempts row for the cohort into Node, which is the N+1
// shape src/lib/progress/query.ts exists to avoid. The duplication is one
// boolean, it is pinned by the comment on both sides, and the alternative was a
// per-student round trip.
//
// `avgRuntimeMs` IS METRIC AND LABELLED. It is `coding_attempts.runtime_ms`, the
// measured execution time of a run — not a proxy for how long a student spent.
// =============================================================================

import { Card } from "@/components/ui";
import type { ProblemDifficulty } from "@/lib/analytics/queries";
import { NO_DATA_LABEL } from "@/lib/instructor/rates";

export interface ProblemDifficultyTableProps {
  problems: readonly ProblemDifficulty[];
  /** Rows to show. The statement returns all of them; the page trims. */
  limit?: number;
}

function pct(value: number | null): string {
  return value === null ? NO_DATA_LABEL : `${value.toFixed(0)}%`;
}

export function ProblemDifficultyTable({
  problems,
  limit = 10,
}: ProblemDifficultyTableProps) {
  const rows = problems.slice(0, limit);

  return (
    <Card
      padded
      title="Problem difficulty"
      subtitle="Hardest first: lowest share of students who got every test passing."
      data-testid="analytics-problem-difficulty"
    >
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted" data-testid="problem-difficulty-empty">
          Nobody in this cohort has run a coding problem yet — no difficulty to
          measure.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Problem
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Track
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Solved
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Runs
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Runs / solver
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Avg runtime
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.problemId}
                  className="border-b border-line/60 last:border-0"
                  data-testid={`problem-row-${p.problemId}`}
                  data-solve-rate={p.solveRatePercent ?? ""}
                >
                  <td className="py-2 pr-3 text-ink">{p.title}</td>
                  <td className="py-2 pr-3 text-xs text-ink-muted">
                    {p.track} · {p.level}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <span
                      data-testid="problem-solve-rate"
                      data-has-data={p.solveRatePercent !== null}
                      className={p.solveRatePercent === null ? "text-ink-muted" : undefined}
                    >
                      {pct(p.solveRatePercent)}
                    </span>
                    <span className="ml-1 text-xs text-ink-muted">
                      ({p.solverCount}/{p.studentCount})
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.attemptCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {p.attemptsPerSolver === null ? (
                      <span className="text-ink-muted">{NO_DATA_LABEL}</span>
                    ) : (
                      p.attemptsPerSolver.toFixed(1)
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.avgRuntimeMs === null ? (
                      <span className="text-ink-muted">{NO_DATA_LABEL}</span>
                    ) : (
                      // Milliseconds. House rule: metric units, stated.
                      `${p.avgRuntimeMs.toFixed(0)} ms`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {problems.length > rows.length && (
        <p className="mt-2 text-xs text-ink-muted">
          Showing the {rows.length} hardest of {problems.length} attempted problems.
        </p>
      )}
    </Card>
  );
}
