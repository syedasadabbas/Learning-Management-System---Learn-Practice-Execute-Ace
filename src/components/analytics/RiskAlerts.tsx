// =============================================================================
// RISK ALERTS — the forward-looking half of "who needs help".
// -----------------------------------------------------------------------------
// THIS SITS BESIDE THE EXISTING AT-RISK LIST, IT DOES NOT REPLACE IT.
// `AtRiskList` (src/components/instructor/AnalyticsPanels.tsx) shows students with
// >= 3 unresolved penalties and still renders on both analytics pages. A penalty
// is issued AFTER a deadline has been missed, so that list cannot show a student
// who has quietly stopped opening the course — see the header of
// src/lib/analytics/risk.ts. Both cards are labelled with what they measure so an
// instructor is never left guessing why one list has a name the other does not.
//
// NAMES YES, EMAIL ADDRESSES NO. Naming the student is the entire point of an
// alert list — "someone needs help" is not actionable — and both analytics pages
// are staff-only, guarded by requireRole() and by src/middleware.ts at the edge.
// The address is a different matter: it is not needed to identify a student to
// their own instructor, and it is what turns a screenshot into a contact list. The
// leaderboard stream reached the same conclusion for the same data
// (tests/e2e/leaderboard/leaderboard.spec.ts). This component has no email field
// to render, and src/lib/analytics/privacy.ts redacts the one the existing
// penalty list carries.
//
// THE SCORE IS AN ORDERING, NOT A PREDICTION OF A GRADE, and the card says so.
// Nothing here touches the scoring contract; a risk score is 0-100 on a scale
// that means nothing outside this list.
// =============================================================================

import { Badge, Card } from "@/components/ui";
import type { RiskAssessment, RiskBand } from "@/lib/analytics/risk";

export interface RiskAlertsProps {
  risk: readonly RiskAssessment[];
}

const BAND_TONE: Record<RiskBand, "danger" | "warning" | "neutral"> = {
  high: "danger",
  watch: "warning",
  low: "neutral",
};

const BAND_LABEL: Record<RiskBand, string> = {
  high: "High",
  watch: "Watch",
  low: "Low",
};

export function RiskAlerts({ risk }: RiskAlertsProps) {
  return (
    <Card
      padded
      title="Early warning"
      subtitle="Silence, un-attempted quizzes and unresolved penalties, weighted. An ordering for your attention — not a predicted grade."
      data-testid="analytics-risk-alerts"
      data-count={risk.length}
    >
      {risk.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted" data-testid="risk-alerts-empty">
          Nobody is showing warning signs. Every student has been active recently
          and has attempted their quizzes.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {risk.map((student) => (
            <li
              key={student.studentId}
              className="flex items-start justify-between gap-3 py-2.5"
              data-testid={`risk-row-${student.studentId}`}
              data-score={student.score}
              data-band={student.band}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{student.name}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {student.reasons.join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {student.score}
                </span>
                <Badge tone={BAND_TONE[student.band]} size="sm">
                  {BAND_LABEL[student.band]}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Weights: no recent activity 40, weeks with no quiz attempt 30, unresolved
        penalties 20, work awaiting marking 10. Students in the &quot;low&quot; band
        are not listed.
      </p>
    </Card>
  );
}
