// =============================================================================
// "Your standing" summary. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// Sits above the table so the signed-in user can see their own position without
// hunting for the highlighted row in a 60-row cohort. Rank and total come from
// the same query as the table (see queries.ts), so the two can never disagree.
// =============================================================================

import Link from "next/link";

import { Badge, Card, ProgressBar } from "@/components/ui";
import type { MyStanding } from "@/lib/leaderboard/types";

export interface StandingCardProps {
  standing: MyStanding | null;
  /** Copy shown to a viewer who has no standing of their own (staff). */
  emptyNote: string;
}

export function StandingCard({ standing, emptyNote }: StandingCardProps) {
  if (!standing) {
    return (
      <Card data-testid="lb-my-standing-empty">
        <p className="text-sm text-ink-muted">{emptyNote}</p>
      </Card>
    );
  }

  const percent = (standing.totalScore / standing.maxScore) * 100;

  return (
    <Card
      data-testid="lb-my-standing"
      title="Your standing"
      subtitle={standing.cohortName ?? "Not assigned to a cohort"}
      action={
        <Badge tone="brand" data-testid="lb-my-rank">
          {standing.ranking === null
            ? "Unranked"
            : `${ordinal(standing.ranking)} of ${standing.studentCount}`}
        </Badge>
      }
      footer={
        <Link
          href="/leaderboard#me"
          className="text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          Jump to my row
        </Link>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums" data-testid="lb-my-total">
            {standing.totalScore}
          </span>
          <span className="text-sm text-ink-muted">/ {standing.maxScore} points</span>
          <Badge tone="neutral" size="sm">
            Grade {standing.letterGrade}
          </Badge>
        </div>

        <ProgressBar
          percent={percent}
          size="md"
          ariaLabel={`Course total: ${standing.totalScore} of ${standing.maxScore} points`}
        />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Stat label="Quiz" value={standing.quizScore} />
          <Stat label="Assignments" value={standing.assignmentScore} />
          <Stat label="Participation" value={standing.participationScore} />
          <Stat label="Final project" value={standing.finalProjectScore} />
        </dl>

        {standing.avgStars !== null && (
          <p className="text-xs text-ink-muted">
            Average instructor rating {standing.avgStars.toFixed(1)} / 5 stars.
          </p>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * 1st, 2nd, 3rd, 4th... including the 11th/12th/13th exceptions, which the naive
 * `n % 10` version gets wrong ("11st").
 */
export function ordinal(n: number): string {
  const abs = Math.abs(n);
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
