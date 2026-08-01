"use client";

// =============================================================================
// PREREQUISITE RULES — the admin editor for the course graph.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// THIS COMPONENT VALIDATES NOTHING THAT MATTERS. The `<select>` elements cannot
// offer a self-reference and the number input is `min=0 max=100`, and both of those
// are CONVENIENCE. Every rule is re-validated in
// `addPrerequisiteAction` — role, existence, self-reference, score range,
// duplicate, and the cycle — and the cycle is re-checked a THIRD time inside the
// insert transaction under an advisory lock. A form is markup; the action is a
// public HTTP POST target. See src/lib/prerequisites/actions.ts's header.
//
// So: "a DAG whose validity is only checked in the UI is not checked", and nothing
// on this screen is where the check lives.
//
// IT IMPORTS FROM `@/lib/prerequisites/labels` AND `.../actions`, never from
// ./policy or ./store — the pure module for constants, the action module for the
// mutation. Importing policy.ts here would drag `pg` into the browser bundle and
// break `next build`; see src/lib/prerequisites/labels.ts's header for the
// precedent.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, EmptyState, Toast } from "@/components/ui";
import {
  addPrerequisiteAction,
  removePrerequisiteAction,
} from "@/lib/prerequisites/actions";

export interface RuleView {
  id: number;
  courseId: number;
  courseTitle: string;
  prerequisiteCourseId: number;
  prerequisiteTitle: string;
  minScore: number | null;
  /** ISO 8601 UTC. */
  createdAt: string;
  createdByName: string | null;
}

export interface CourseOption {
  id: number;
  title: string;
  /**
   * True for the ACTIVE course — the one /weeks serves, open to every signed-in
   * student. A prerequisite recorded against it has NO EFFECT on entry, because
   * `decideCourseAccess` returns allowed on its `isOpenCourse` branch before the
   * prerequisite verdict is consulted. The form says so out loud rather than
   * letting an admin author a rule that silently does nothing.
   */
  isActiveCourse: boolean;
  /** How many students currently hold an approved request for this course. */
  approvedStudents: number;
}

export interface PrerequisiteRulesProps {
  rules: RuleView[];
  courses: CourseOption[];
}

export function PrerequisiteRules({ rules, courses }: PrerequisiteRulesProps) {
  const [courseId, setCourseId] = React.useState<string>("");
  const [prerequisiteId, setPrerequisiteId] = React.useState<string>("");
  const [minScore, setMinScore] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const selected = courses.find((c) => String(c.id) === courseId) ?? null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const result = await addPrerequisiteAction(courseId, prerequisiteId, minScore);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // No optimistic row is inserted. The action calls
    // revalidatePath("/admin/prerequisites"), so the server sends back the real
    // list — and an optimistic edge could disagree with a graph the database
    // refused to change, which on a page about cycles is the worst possible lie.
    setPrerequisiteId("");
    setMinScore("");
    setNotice(result.message);
  }

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await removePrerequisiteAction(id);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else setNotice(result.message);
  }

  return (
    <div className="space-y-4" data-testid="prerequisite-rules">
      {error && (
        // Sticky (no autoDismissMs): an admin must not be left believing a rule is
        // in force when the write was refused.
        <Toast tone="error" message={error} onDismiss={() => setError(null)} />
      )}
      {notice && (
        <Toast tone="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      <Card
        title="Add a prerequisite"
        subtitle="“To take this course, a student must first have that one.” Circular chains are refused."
        padded
      >
        <form className="space-y-3" onSubmit={submit} data-testid="add-prerequisite-form">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-ink-muted">Course</span>
              <select
                className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                required
                data-testid="prerequisite-course"
              >
                <option value="">Select a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-ink-muted">Requires</span>
              <select
                className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                value={prerequisiteId}
                onChange={(e) => setPrerequisiteId(e.target.value)}
                required
                data-testid="prerequisite-required-course"
              >
                <option value="">Select a course…</option>
                {courses
                  // Convenience only. `validateNewPrerequisite` refuses a
                  // self-reference server-side and a database CHECK makes it
                  // unrepresentable — omitting it here just avoids offering it.
                  .filter((c) => String(c.id) !== courseId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-ink-muted">Minimum score % (optional)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                placeholder="blank = enrolment is enough"
                data-testid="prerequisite-min-score"
              />
            </label>
          </div>

          {selected?.isActiveCourse && (
            // Stated BEFORE the save, not discovered afterwards. See
            // CourseOption.isActiveCourse.
            <p className="text-sm text-amber-900" data-testid="active-course-warning">
              <strong>{selected.title}</strong> is the cohort&apos;s active course. It is open
              to every signed-in student by design, so a prerequisite on it will be
              recorded but will not gate entry. See{" "}
              <code>src/lib/courses/policy.ts</code> — the compatibility rule.
            </p>
          )}

          {selected && !selected.isActiveCourse && selected.approvedStudents > 0 && (
            // The honest cost of enforcing at read time, disclosed before the click.
            <p className="text-sm text-ink-muted" data-testid="affected-students-warning">
              {selected.approvedStudents} student
              {selected.approvedStudents === 1 ? " is" : "s are"} already approved for{" "}
              <strong>{selected.title}</strong>. Adding a requirement will refuse them
              until they satisfy it or you grant an override below.
            </p>
          )}

          <Button type="submit" disabled={busy || !courseId || !prerequisiteId}>
            {busy ? "Saving…" : "Add prerequisite"}
          </Button>
        </form>
      </Card>

      <Card title={`Rules (${rules.length})`} padded={rules.length === 0}>
        {rules.length === 0 ? (
          <EmptyState
            title="No prerequisites are configured"
            description="Every course is open to anyone an admin approves. Add a rule above to require one course before another."
          />
        ) : (
          <ul className="divide-y divide-line" data-testid="prerequisite-rule-list">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                data-testid={`prerequisite-rule-${rule.id}`}
                data-course-id={rule.courseId}
                data-prerequisite-course-id={rule.prerequisiteCourseId}
              >
                <div className="text-sm">
                  <p className="text-ink">
                    <strong>{rule.courseTitle}</strong> requires{" "}
                    <strong>{rule.prerequisiteTitle}</strong>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {rule.minScore == null
                      ? "Enrolment in the prerequisite is enough"
                      : `At least ${rule.minScore}% in the prerequisite`}
                    {" · "}
                    {rule.createdByName ? `added by ${rule.createdByName}` : "added"} on{" "}
                    {rule.createdAt.slice(0, 10)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {rule.minScore != null && (
                    <Badge tone="brand" size="sm">
                      min {rule.minScore}%
                    </Badge>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => remove(rule.id)}
                    data-testid={`remove-prerequisite-${rule.id}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
