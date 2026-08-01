import * as React from "react";

import { Badge, type BadgeTone } from "@/components/ui";
import type { PenaltySeverityName, PenaltyTypeName } from "@/lib/penalties";

// Severity -> tone. The ladder reads warning < notice < serious, so the tones
// escalate with it. No hex here: tones resolve to the design tokens in
// globals.css (ui-shell owns them).
const TONES: Record<PenaltySeverityName, BadgeTone> = {
  warning: "warning",
  notice: "accent",
  serious: "danger",
};

const SEVERITY_LABELS: Record<PenaltySeverityName, string> = {
  warning: "Warning",
  notice: "Notice",
  serious: "Serious",
};

/** Human labels for the four schema penalty types. */
export const PENALTY_TYPE_LABELS: Record<PenaltyTypeName, string> = {
  late_submission: "Late submission",
  quiz_failure: "Quiz failure",
  missed_deadline: "Missed deadline",
  low_score: "Low score",
};

export interface SeverityBadgeProps {
  severity: PenaltySeverityName;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <Badge
      tone={TONES[severity]}
      dot
      className={className}
      data-testid={`severity-${severity}`}
    >
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}
