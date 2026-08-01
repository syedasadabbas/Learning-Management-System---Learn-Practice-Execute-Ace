"use client";

// =============================================================================
// OVERRIDE PANEL — REQUIREMENT 4: the admin exception, and its visibility.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// An admin must be able to admit a student despite an unmet prerequisite, and the
// override must be VISIBLE rather than silent. Four things make it visible, and
// three of them are on this screen:
//
//   1. The reason is REQUIRED. The textarea is `required` for convenience and the
//      server action refuses a blank one, and `reason` is NOT NULL in the schema —
//      so an unexplained override cannot be stored by any route, including a
//      hand-rolled POST to the compiled action.
//   2. Every override is LISTED here with its reason, its author and its date, live
//      ones first, and revoked ones are kept below rather than deleted.
//   3. The snapshot of what was unmet AT GRANT TIME is shown, so the record still
//      means something after the rules have changed.
//   4. (Not here.) The STUDENT is told on their own course page that they are in on
//      an override — see PrerequisiteNotice. A record only the granter can read is
//      silent to the person it is about.
//
// THIS COMPONENT AUTHORISES NOTHING. Both actions call `requirePrerequisiteAdmin()`
// first, and `canGrantOverride` additionally refuses a duplicate override and one
// that would grant nothing. Rendering the form is not permission to use it.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, EmptyState, Toast } from "@/components/ui";
import { OVERRIDE_REASON_MAX } from "@/lib/prerequisites/labels";
import {
  grantPrerequisiteOverrideAction,
  revokePrerequisiteOverrideAction,
} from "@/lib/prerequisites/actions";

export interface OverrideView {
  id: number;
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  reason: string;
  /** What was unmet when it was granted. Audit text, never re-evaluated. */
  unmetAtGrant: string | null;
  /** ISO 8601 UTC. */
  grantedAt: string;
  grantedByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
}

export interface StudentOption {
  id: number;
  name: string;
  email: string;
}

export interface OverridePanelProps {
  overrides: OverrideView[];
  students: StudentOption[];
  /** Courses that actually have prerequisites — anything else has nothing to override. */
  courses: Array<{ id: number; title: string }>;
}

export function OverridePanel({ overrides, students, courses }: OverridePanelProps) {
  const [studentId, setStudentId] = React.useState("");
  const [courseId, setCourseId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const live = overrides.filter((o) => o.revokedAt == null);
  const revoked = overrides.filter((o) => o.revokedAt != null);

  async function grant(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await grantPrerequisiteOverrideAction(studentId, courseId, reason);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReason("");
    setNotice(result.message);
  }

  async function revoke(id: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await revokePrerequisiteOverrideAction(id);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else setNotice(result.message);
  }

  return (
    <div className="space-y-4" data-testid="override-panel">
      {error && <Toast tone="error" message={error} onDismiss={() => setError(null)} />}
      {notice && <Toast tone="success" message={notice} onDismiss={() => setNotice(null)} />}

      <Card
        title="Grant an override"
        subtitle="Admits one student to one course despite an unmet prerequisite. The reason is shown to the student and kept as the record."
        padded
      >
        {courses.length === 0 ? (
          <EmptyState
            title="No course has prerequisites yet"
            description="An override waives a requirement, so there is nothing to waive until a rule exists."
          />
        ) : (
          <form className="space-y-3" onSubmit={grant} data-testid="grant-override-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink-muted">Student</span>
                <select
                  className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  required
                  data-testid="override-student"
                >
                  <option value="">Select a student…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.email})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-ink-muted">Course</span>
                <select
                  className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  required
                  data-testid="override-course"
                >
                  <option value="">Select a course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-sm">
              <span className="text-ink-muted">Reason (required)</span>
              <textarea
                className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                rows={2}
                // Mirrors varchar(500) on the column. The attribute is presentation;
                // `normaliseOverrideReason` truncates server-side to the same number.
                maxLength={OVERRIDE_REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                placeholder="e.g. completed the equivalent course elsewhere — transcript on file"
                data-testid="override-reason-input"
              />
            </label>

            <Button type="submit" disabled={busy || !studentId || !courseId || !reason.trim()}>
              {busy ? "Saving…" : "Grant override"}
            </Button>
          </form>
        )}
      </Card>

      <Card title={`Live overrides (${live.length})`} padded={live.length === 0}>
        {live.length === 0 ? (
          <EmptyState
            title="No overrides are in force"
            description="Every student currently in a course with prerequisites satisfied them."
          />
        ) : (
          <ul className="divide-y divide-line" data-testid="live-override-list">
            {live.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-start justify-between gap-2 px-4 py-3"
                data-testid={`override-${o.id}`}
                data-override-state="live"
              >
                <div className="text-sm">
                  <p className="text-ink">
                    <strong>{o.studentName}</strong> in <strong>{o.courseTitle}</strong>
                  </p>
                  <p className="text-ink-muted">Reason: {o.reason}</p>
                  {o.unmetAtGrant && (
                    <p className="text-xs text-ink-muted">
                      Waived at grant time: {o.unmetAtGrant}
                    </p>
                  )}
                  <p className="text-xs text-ink-muted">
                    {o.grantedByName ? `Granted by ${o.grantedByName}` : "Granted"} on{" "}
                    {o.grantedAt.slice(0, 10)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="warning" size="sm">
                    Override
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => revoke(o.id)}
                    data-testid={`revoke-override-${o.id}`}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {revoked.length > 0 && (
        <Card
          title={`Revoked (${revoked.length})`}
          subtitle="Kept as the audit record of who granted an exception and who withdrew it."
        >
          <ul className="divide-y divide-line" data-testid="revoked-override-list">
            {revoked.map((o) => (
              <li
                key={o.id}
                className="px-4 py-3 text-sm"
                data-testid={`override-${o.id}`}
                data-override-state="revoked"
              >
                <p className="text-ink">
                  <strong>{o.studentName}</strong> in <strong>{o.courseTitle}</strong>
                </p>
                <p className="text-ink-muted">Reason given: {o.reason}</p>
                <p className="text-xs text-ink-muted">
                  {o.grantedByName ? `Granted by ${o.grantedByName}` : "Granted"} on{" "}
                  {o.grantedAt.slice(0, 10)} ·{" "}
                  {o.revokedByName ? `revoked by ${o.revokedByName}` : "revoked"} on{" "}
                  {o.revokedAt?.slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
