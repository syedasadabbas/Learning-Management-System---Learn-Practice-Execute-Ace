"use client";

// =============================================================================
// PENALTY / WARNING FORM — instructor-admin stream.
// -----------------------------------------------------------------------------
// The four types and three severities are listed locally and checked against the
// schema enums at COMPILE TIME by `_AssertEnumsMatchSchema` below, using a
// type-only import that is erased at build. Importing the enum values at runtime
// would pull Drizzle and the whole schema module into the browser bundle — the
// same reason @/components/nav/nav-links.ts declares its Role type locally.
//
// Point values are chosen by the issuer; the automated suggestions come from
// `evaluatePenalties` (penalties-attendance) via `suggestPenaltiesAction`, so a
// hand-issued penalty matches what the rules would have decided instead of
// establishing a rival policy.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, Toast } from "@/components/ui";
import type * as Schema from "@/db/schema";
import { POINTS } from "@/lib/contracts/scoring";
import type { PenaltyDecision } from "@/lib/contracts/events";
import { issuePenaltyAction, suggestPenaltiesAction } from "@/lib/instructor/actions";

type PenaltyTypeValue = (typeof Schema.penaltyType.enumValues)[number];
type PenaltySeverityValue = (typeof Schema.penaltySeverity.enumValues)[number];

const PENALTY_TYPES = [
  "late_submission",
  "quiz_failure",
  "missed_deadline",
  "low_score",
] as const;
const PENALTY_SEVERITIES = ["warning", "notice", "serious"] as const;

// Fails to compile if the schema gains, drops or renames a penalty type/severity.
type _AssertEnumsMatchSchema = [
  [PenaltyTypeValue] extends [(typeof PENALTY_TYPES)[number]] ? true : never,
  [(typeof PENALTY_TYPES)[number]] extends [PenaltyTypeValue] ? true : never,
  [PenaltySeverityValue] extends [(typeof PENALTY_SEVERITIES)[number]] ? true : never,
  [(typeof PENALTY_SEVERITIES)[number]] extends [PenaltySeverityValue] ? true : never,
];

const TYPE_LABEL: Record<string, string> = {
  late_submission: "Late submission",
  quiz_failure: "Quiz failure",
  missed_deadline: "Missed deadline",
  low_score: "Low score",
};

const SEVERITY_LABEL: Record<string, string> = {
  warning: "Warning",
  notice: "Notice",
  serious: "Serious",
};

export interface PenaltyFormProps {
  studentId: number;
  studentName: string;
  /** Context for the rules engine, from the student's current situation. */
  context?: { daysLate: number; quizBestPercent: number | null; missedEntirely: boolean };
  onIssued?: () => void;
}

export function PenaltyForm({
  studentId,
  studentName,
  context,
  onIssued,
}: PenaltyFormProps) {
  const [type, setType] = React.useState<string>(PENALTY_TYPES[0]);
  const [severity, setSeverity] = React.useState<string>(PENALTY_SEVERITIES[0]);
  const [description, setDescription] = React.useState("");
  const [points, setPoints] = React.useState("0");
  const [pending, setPending] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<PenaltyDecision[]>([]);
  const [toast, setToast] = React.useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

  async function loadSuggestions() {
    const result = await suggestPenaltiesAction({
      studentId,
      daysLate: context?.daysLate ?? 0,
      quizBestPercent: context?.quizBestPercent ?? null,
      missedEntirely: context?.missedEntirely ?? false,
    });
    if (result.ok) setSuggestions(result.data);
  }

  function applySuggestion(decision: PenaltyDecision) {
    setType(decision.type);
    setSeverity(decision.severity);
    setDescription(decision.description);
    setPoints(String(decision.penaltyPoints));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setToast(null);

    const result = await issuePenaltyAction({
      studentId,
      type,
      severity,
      description: description.trim() === "" ? undefined : description,
      penaltyPoints: Number(points) || 0,
    });
    setPending(false);

    if (!result.ok) {
      setToast({ tone: "error", message: result.error });
      return;
    }
    setToast({ tone: "success", message: `Penalty recorded for ${studentName}.` });
    setDescription("");
    setPoints("0");
    onIssued?.();
  }

  return (
    <Card
      title="Issue a penalty or warning"
      subtitle={studentName}
      data-testid="penalty-form-card"
    >
      <form onSubmit={onSubmit} className="space-y-3" data-testid="penalty-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Type</span>
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              data-testid="penalty-type"
              className="mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1"
            >
              {PENALTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium">Severity</span>
            <select
              name="severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              data-testid="penalty-severity"
              className="mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1"
            >
              {PENALTY_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm">
          <span className="font-medium">Points deducted</span>
          <input
            type="number"
            name="penaltyPoints"
            min={0}
            max={POINTS.WEEK_MAX}
            step={1}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            data-testid="penalty-points"
            className="mt-1 block w-28 rounded-md border border-line bg-panel px-2 py-1 tabular-nums"
          />
          <span className="text-xs text-ink-muted">
            0 records the warning without changing the score.
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium">Note to the student</span>
          <textarea
            name="description"
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="penalty-description"
            className="mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={pending} disabled={pending} data-testid="issue-penalty">
            Issue
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={loadSuggestions}
            data-testid="suggest-penalties"
          >
            What do the rules suggest?
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="space-y-2" data-testid="penalty-suggestions">
            {suggestions.map((s, i) => (
              <button
                key={`${s.type}-${i}`}
                type="button"
                onClick={() => applySuggestion(s)}
                className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1 text-left text-sm hover:bg-surface"
              >
                <Badge tone={s.severity === "serious" ? "danger" : "warning"} size="sm">
                  {SEVERITY_LABEL[s.severity] ?? s.severity}
                </Badge>
                <span className="flex-1">{s.description}</span>
                <span className="tabular-nums text-ink-muted">-{s.penaltyPoints}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {toast && (
        <div className="mt-3">
          <Toast
            tone={toast.tone}
            message={toast.message}
            autoDismissMs={toast.tone === "success" ? 5_000 : 0}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </Card>
  );
}
