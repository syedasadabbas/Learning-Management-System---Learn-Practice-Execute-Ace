import * as React from "react";

import { Card, EmptyState } from "@/components/ui";
import type { EscalationState, PenaltySeverityName, PenaltyTypeName } from "@/lib/penalties";

import { PENALTY_TYPE_LABELS, SeverityBadge } from "./SeverityBadge";

/**
 * The shape this list renders. Structural rather than `Penalty` from the schema
 * so the component stays presentational and unit-testable without a database,
 * and so a caller can pass a resolved row for the history view.
 */
export type PenaltyListItem = {
  id: number;
  type: PenaltyTypeName;
  severity: PenaltySeverityName;
  description: string | null;
  penaltyPoints: number;
  resolved: boolean;
  issuedAt: Date | string;
  resolvedAt: Date | string | null;
};

export interface PenaltyListProps {
  items: readonly PenaltyListItem[];
  /** Escalation state, when the caller has computed it. Shown as a banner. */
  escalation?: EscalationState;
  /** Rendered on each unresolved row — the instructor's "clear" control. */
  renderAction?: (item: PenaltyListItem) => React.ReactNode;
  className?: string;
}

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown date";
  // ISO date (UTC) — unambiguous for a cohort spread across time zones.
  return d.toISOString().slice(0, 10);
}

/**
 * A student's warnings and notices, newest first.
 *
 * A resolved penalty is rendered muted and struck through rather than hidden
 * when the caller passes it: the student should be able to see that something was
 * cleared, while it visibly no longer counts.
 */
export function PenaltyList({
  items,
  escalation,
  renderAction,
  className,
}: PenaltyListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No warnings or notices"
        description="Nothing is on your record. Keep submitting on time to keep it that way."
        className={className}
      />
    );
  }

  return (
    <div className={className} data-testid="penalty-list">
      {escalation?.escalated && (
        <div
          role="status"
          data-testid="escalation-banner"
          className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <strong className="font-semibold">Escalated to your instructor.</strong>{" "}
          {escalation.reason}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card
              data-testid={`penalty-${item.id}`}
              title={PENALTY_TYPE_LABELS[item.type]}
              subtitle={`Issued ${formatDate(item.issuedAt)}`}
              action={
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={item.severity} />
                  {!item.resolved && renderAction?.(item)}
                </div>
              }
              className={item.resolved ? "opacity-60" : undefined}
            >
              <p
                className={
                  item.resolved ? "text-sm text-ink-muted line-through" : "text-sm text-ink"
                }
              >
                {item.description ?? "No further detail was recorded."}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                {item.resolved ? (
                  <span data-testid="penalty-resolved">
                    Cleared by your instructor
                    {item.resolvedAt ? ` on ${formatDate(item.resolvedAt)}` : ""} — no longer
                    counts against you.
                  </span>
                ) : (
                  <>
                    {item.penaltyPoints} demerit point
                    {item.penaltyPoints === 1 ? "" : "s"} on your record.
                  </>
                )}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
