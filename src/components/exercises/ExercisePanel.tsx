// =============================================================================
// EXERCISE PANEL — one parsed resource, rendered either way
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// This is the only component that knows how to render an `ExerciseEntry`, which
// is deliberately a discriminated union: the parser turns a malformed
// `starterCode` blob into `{ ok: false, problem }` rather than throwing, and this
// component turns that into a visible card explaining what is missing. A jsonb
// column written by a seed script (and later by the admin console) must never be
// able to 500 a lecture page.
//
// Not a client component: it renders LiveEditor (which is), so the editor's
// JavaScript is the only thing that has to reach the browser.
// =============================================================================

import * as React from "react";

import { Badge, Card } from "@/components/ui";
import type { ExerciseEntry } from "@/lib/exercises";

import { LiveEditor } from "./LiveEditor";

export interface ExercisePanelProps {
  entry: ExerciseEntry;
  /** Editor height in CSS pixels. */
  heightPx?: number;
}

export function ExercisePanel({ entry, heightPx }: ExercisePanelProps) {
  if (!entry.ok) {
    const { problem } = entry;
    return (
      <Card
        title={problem.title}
        subtitle="This exercise cannot be opened"
        action={<Badge tone="warning">Unavailable</Badge>}
        data-testid="exercise-problem"
        data-exercise-id={problem.id}
      >
        <p className="text-sm text-ink">{problem.reason}</p>
        <p className="mt-2 text-sm text-ink-muted">
          Nothing is wrong with your work — the exercise itself is incomplete. The rest of
          this lecture still works; please tell your instructor so it can be fixed.
        </p>
      </Card>
    );
  }

  const { exercise } = entry;
  return (
    <Card
      title={exercise.title}
      subtitle="Edit the code — the preview updates as you type"
      data-testid="exercise-panel"
      data-exercise-id={exercise.id}
    >
      <LiveEditor exercise={exercise} heightPx={heightPx} />
    </Card>
  );
}

export interface ExerciseListProps {
  entries: ExerciseEntry[];
  heightPx?: number;
}

/** Every exercise on a lecture, in the order the resources array lists them. */
export function ExerciseList({ entries, heightPx }: ExerciseListProps) {
  return (
    <div className="space-y-6" data-testid="exercise-list">
      {entries.map((entry) => (
        <ExercisePanel
          key={entry.ok ? entry.exercise.id : entry.problem.id}
          entry={entry}
          heightPx={heightPx}
        />
      ))}
    </div>
  );
}
