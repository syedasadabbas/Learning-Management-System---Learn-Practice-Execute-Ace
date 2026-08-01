// =============================================================================
// ATTEMPT HISTORY — server-rendered summary of previous attempts.
// Owner: quizzes stream.
// -----------------------------------------------------------------------------
// Summary only: score, percentage, pass/fail, timestamp. No per-question detail,
// therefore no explanations — a student who has attempts left must not be able
// to read the answer key off their own history.
//
// Pass/fail comes from the server-computed `passed` flag on each row.
// =============================================================================

import { Badge, Card, EmptyState } from "@/components/ui";
import type { AttemptHistory } from "@/lib/quizzes/service";

export interface AttemptHistoryListProps {
  history: AttemptHistory;
}

export function AttemptHistoryList({ history }: AttemptHistoryListProps) {
  if (history.attempts.length === 0) {
    return (
      <Card title="Previous attempts">
        <EmptyState
          title="No attempts yet"
          description={`You have ${history.attemptsAllowed} attempts for this quiz.`}
        />
      </Card>
    );
  }

  return (
    <Card
      title="Previous attempts"
      subtitle={`${history.attemptsUsed} of ${history.attemptsAllowed} used · ${history.attemptsRemaining} left`}
      action={
        history.bestPercent != null ? (
          <Badge tone={history.passed ? "success" : "neutral"} data-testid="history-best">
            Best {history.bestPercent}%
          </Badge>
        ) : null
      }
    >
      <ul className="divide-y divide-line" data-testid="attempt-history">
        {history.attempts.map((attempt) => (
          <li
            key={attempt.id}
            className="flex items-center justify-between gap-3 py-2 text-sm"
            data-testid={`attempt-row-${attempt.attemptNumber}`}
          >
            <span>Attempt {attempt.attemptNumber}</span>
            <span className="text-ink-muted">
              {attempt.score}/{attempt.totalPossible} · {attempt.percentage}%
            </span>
            <Badge tone={attempt.passed ? "success" : "danger"} size="sm">
              {attempt.passed ? "PASS" : "FAIL"}
            </Badge>
            <time
              className="text-ink-muted"
              dateTime={attempt.submittedAt ?? attempt.startedAt}
            >
              {formatUtc(attempt.submittedAt ?? attempt.startedAt)}
            </time>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * ISO timestamp -> "YYYY-MM-DD HH:MM UTC".
 *
 * Formatted in UTC deliberately: the schema stores UTC (see schema.ts header),
 * and a locale-dependent format would render differently on the server and the
 * client, which React reports as a hydration mismatch.
 */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}
