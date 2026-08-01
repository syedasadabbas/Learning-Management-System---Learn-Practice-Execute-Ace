"use client";

// =============================================================================
// ADMIN REQUEST QUEUE — approve or decline course access.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// THIS COMPONENT DECIDES NOTHING ABOUT ACCESS. Both buttons call an
// admin-guarded server action, which additionally refuses a self-approval and a
// second decision on a settled row (`canDecideRequest` in
// src/lib/courses/policy.ts). Rendering the buttons to an instructor would still
// be refused server-side.
//
// WHAT AN ADMIN NEEDS TO DECIDE, and therefore what every row shows: who is
// asking (name AND email, because two students share a first name and the email
// is the account key), which course, when they asked, and their own note. The
// decision note field is offered on BOTH outcomes — the student sees it, and a
// rejection with no reason generates a support email that a one-line note would
// have prevented.
//
// OPTIMISTIC-ISH, like the video review queue: the row is marked busy, the
// action runs, and the returned status replaces the row's state locally as well
// as revalidating the page. On failure the row reverts and a STICKY error toast
// says so — the "already decided by another admin" refusal is a real outcome
// here, not a transport error, and an admin must not be left believing they
// granted access when they did not.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, EmptyState, Toast } from "@/components/ui";
import {
  approveCourseAccessAction,
  rejectCourseAccessAction,
} from "@/lib/courses/actions";
// PURE module only — see src/lib/courses/labels.ts.
import { REQUEST_MESSAGE_MAX } from "@/lib/courses/labels";

export type QueueStatus = "pending" | "approved" | "rejected";

export interface RequestQueueItem {
  id: number;
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  status: QueueStatus;
  message: string | null;
  decisionNote: string | null;
  /** ISO 8601 UTC strings — serialised by the page, not Date objects. */
  createdAt: string;
  decidedAt: string | null;
  deciderName: string | null;
}

export interface RequestQueueProps {
  items: RequestQueueItem[];
  title: string;
  subtitle?: React.ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
}

const STATUS_TONE: Record<QueueStatus, "warning" | "success" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
};

export function RequestQueue({
  items,
  title,
  subtitle,
  emptyTitle,
  emptyDescription,
}: RequestQueueProps) {
  const [pendingId, setPendingId] = React.useState<number | null>(null);
  const [overrides, setOverrides] = React.useState<Record<number, QueueStatus>>({});
  const [notes, setNotes] = React.useState<Record<number, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  async function run(
    id: number,
    action: (requestId: number, note?: unknown) => Promise<{ ok: boolean; error?: string; status?: string }>,
  ) {
    setPendingId(id);
    setError(null);
    const result = await action(id, notes[id] ?? "");
    setPendingId(null);

    if (!result.ok) {
      setError(result.error ?? "The decision was not saved.");
      return;
    }
    setOverrides((prev) => ({ ...prev, [id]: (result.status ?? "pending") as QueueStatus }));
  }

  if (items.length === 0) {
    return (
      <Card title={title} subtitle={subtitle}>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </Card>
    );
  }

  return (
    <Card padded={false} title={title} subtitle={subtitle}>
      {error && (
        <div className="px-4 pt-3">
          <Toast tone="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      <ul className="divide-y divide-line" data-testid="access-request-list">
        {items.map((item) => {
          const status = overrides[item.id] ?? item.status;
          const busy = pendingId === item.id;

          return (
            <li
              key={item.id}
              data-testid={`access-request-${item.id}`}
              data-status={status}
              className="space-y-2 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  {item.studentName}{" "}
                  <span className="font-normal text-ink-muted">({item.studentEmail})</span>
                </p>
                <Badge tone={STATUS_TONE[status]} size="sm">
                  {status}
                </Badge>
              </div>

              <p className="text-xs text-ink-muted">
                wants <strong className="text-ink">{item.courseTitle}</strong> · asked{" "}
                <time dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time>
              </p>

              {item.message && (
                <p className="rounded border border-line bg-surface p-2 text-sm text-ink">
                  {item.message}
                </p>
              )}

              {status === "pending" ? (
                <div className="space-y-2">
                  <label className="sr-only" htmlFor={`decision-note-${item.id}`}>
                    Note to the student (optional)
                  </label>
                  <input
                    id={`decision-note-${item.id}`}
                    type="text"
                    maxLength={REQUEST_MESSAGE_MAX}
                    placeholder="Note to the student (optional, shown on a decline)"
                    value={notes[item.id] ?? ""}
                    onChange={(event) =>
                      setNotes((prev) => ({ ...prev, [item.id]: event.target.value }))
                    }
                    className="w-full rounded border border-line bg-panel p-2 text-sm text-ink"
                    data-testid={`decision-note-${item.id}`}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy}
                      disabled={busy}
                      data-testid={`approve-request-${item.id}`}
                      onClick={() => run(item.id, approveCourseAccessAction)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      disabled={busy}
                      data-testid={`reject-request-${item.id}`}
                      onClick={() => run(item.id, rejectCourseAccessAction)}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ink-muted" data-testid={`decided-by-${item.id}`}>
                  {/* No Undo button, unlike the video queue. Reversing an
                      approval REVOKES a course a student may already be working
                      through, which is not a one-click act; and a re-application
                      after a decline is the student's to make, so an admin
                      un-deciding it would file a request nobody asked for. */}
                  {status === "approved" ? "Approved" : "Declined"}
                  {item.deciderName ? ` by ${item.deciderName}` : ""}
                  {item.decidedAt ? ` on ${item.decidedAt.slice(0, 10)}` : ""}
                  {item.decisionNote ? ` — “${item.decisionNote}”` : ""}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
