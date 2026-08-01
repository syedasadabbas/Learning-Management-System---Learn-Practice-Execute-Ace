"use client";

// =============================================================================
// MODULE RUNNER — the stepped module: one step on screen, progress underneath.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// PER-STEP COMPLETION IS WHAT MAKES A CLOSED TAB HARMLESS. Advancing a step POSTs
// that step's completion before moving on, so state lives in the database rather
// than in this component. Two consequences worth stating:
//
//   * The runner OPENS at the first step the student has not completed
//     (`firstIncompleteIndex`), not at step 1. Landing a returning student back at
//     the beginning is the failure per-step completion exists to prevent.
//   * A failed POST does NOT block navigation. The step stays un-ticked and a
//     message says so; refusing to advance would strand a student behind a network
//     blip on ungraded content. `created: false` from the idempotent route means it
//     was already saved, which is a success, not a duplicate.
//
// ACCESSIBILITY
//   * Every control is a real button, so tab/enter/space come from the platform.
//     There is no click-only affordance and no keyboard trap.
//   * Progress is announced through ONE `aria-live="polite"` region carrying the
//     sentence the server derived (`progressAnnouncement`), so a screen-reader user
//     hears the same counts a sighted user reads off the bar.
//   * The step list marks the current step with `aria-current="step"` and marks
//     completion with the word "done" as well as the tick, so no state is
//     colour-only.
//
// BUNDLE: LabStep reaches the runner through `LazyCodeRunner`, so no runtime is in
// this route's initial JavaScript. Nothing here should statically import
// `CodeRunner`, Pyodide or sql.js.
// =============================================================================

import * as React from "react";

import { MarkdownContent } from "@/components/course/MarkdownContent";
import { Badge, Button, Card, ProgressBar, cn } from "@/components/ui";
import { postStepComplete } from "@/lib/learn/client";
import {
  firstIncompleteIndex,
  moduleProgress,
  progressAnnouncement,
  type CheckOutcome,
  type LearnModuleDetail,
} from "@/lib/learn";

import { CheckStep } from "./CheckStep";
import { LabStep } from "./LabStep";
import { StepDiagram } from "./StepDiagram";

export interface ModuleRunnerProps {
  module: LearnModuleDetail;
}

const KIND_LABEL: Record<string, string> = {
  explain: "Explainer",
  lab: "Lab",
  check: "Check",
};

export function ModuleRunner({ module }: ModuleRunnerProps) {
  const steps = module.steps;
  const stepIds = React.useMemo(() => steps.map((s) => s.id), [steps]);

  const [completed, setCompleted] = React.useState<ReadonlySet<number>>(
    () => new Set(module.completedStepIds),
  );
  const [index, setIndex] = React.useState(() =>
    firstIncompleteIndex(stepIds, new Set(module.completedStepIds)),
  );
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [checkOutcomes, setCheckOutcomes] = React.useState<Record<number, CheckOutcome>>({});
  const [announcement, setAnnouncement] = React.useState("");

  const progress = moduleProgress({
    stepCount: steps.length,
    completedSteps: completed.size,
  });

  if (steps.length === 0) {
    return (
      <Card title={module.title} data-testid="learn-module-empty">
        <p className="text-sm text-ink-muted">
          This module has no steps yet. Nothing is broken — the content has not been
          written.
        </p>
      </Card>
    );
  }

  const current = steps[Math.min(index, steps.length - 1)];
  const atFirst = index === 0;
  const atLast = index >= steps.length - 1;
  const currentDone = completed.has(current.id);

  /** Record `stepId` locally. Kept separate so both callers stay in sync. */
  const markLocal = (stepId: number, sentence: string) => {
    setCompleted((prev) => {
      if (prev.has(stepId)) return prev;
      const next = new Set(prev);
      next.add(stepId);
      return next;
    });
    setAnnouncement(sentence);
  };

  /** Save a step. Resolves to true when the server has it (new or already there). */
  const save = async (stepId: number, answerIndex?: number): Promise<CheckOutcome | null> => {
    setSaving(true);
    setSaveError(null);
    const response = await postStepComplete(stepId, answerIndex);
    setSaving(false);

    if (!response.ok) {
      setSaveError(response.error);
      // Still announce, so a screen-reader user is not left with silence after
      // pressing a button.
      setAnnouncement(response.error);
      return null;
    }

    markLocal(stepId, response.data.announcement);
    if (response.data.check) {
      setCheckOutcomes((prev) => ({ ...prev, [stepId]: response.data.check as CheckOutcome }));
    }
    return response.data.check;
  };

  const completeAndAdvance = async () => {
    if (!currentDone) await save(current.id);
    if (!atLast) setIndex((i) => Math.min(steps.length - 1, i + 1));
  };

  const goTo = (target: number) => {
    setSaveError(null);
    setIndex(Math.max(0, Math.min(steps.length - 1, target)));
  };

  return (
    <div className="space-y-6" data-testid="learn-module-runner" data-module-slug={module.slug}>
      {/* ---------------- progress ---------------- */}
      <section aria-labelledby="learn-progress-heading" className="space-y-2">
        <h2 id="learn-progress-heading" className="sr-only">
          Module progress
        </h2>
        <ProgressBar
          percent={progress.percent}
          label={`${progress.completedSteps} of ${progress.stepCount} steps complete`}
          showValue
          tone={progress.status === "complete" ? "success" : "brand"}
          ariaLabel={`Module progress: ${progress.percent} per cent`}
        />
        {/* The single live region. Deliberately not the ProgressBar itself: a bar
            that announces on every render is noise, whereas this announces once
            per completed step, with the counts spelled out. */}
        <p
          aria-live="polite"
          data-testid="learn-progress-announcement"
          className="text-xs text-ink-muted"
        >
          {announcement || progressAnnouncement(progress)}
        </p>
      </section>

      {/* ---------------- step navigator ---------------- */}
      <nav aria-label="Steps in this module">
        <ol className="flex flex-wrap gap-2" data-testid="learn-step-list">
          {steps.map((step, i) => {
            const done = completed.has(step.id);
            const isCurrent = i === index;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={isCurrent ? "step" : undefined}
                  data-testid="learn-step-tab"
                  data-step-number={step.stepNumber}
                  // The KIND is on the tab as well as on the step card
                  // (data-step-kind, below). Added 2026-07-31 because without it
                  // the only way anything outside this component can reach "the
                  // lab step" is to press "Mark done and continue" repeatedly
                  // until one appears — which WRITES a completion row per press.
                  // Three e2e specs did exactly that, so they mutated the state
                  // they depended on and failed from the second run onwards (see
                  // tests/e2e/interactive-learning/learn.spec.ts). One attribute
                  // makes a step addressable without completing anything.
                  data-step-kind={step.kind}
                  data-done={done ? "true" : "false"}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    isCurrent
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-line bg-panel text-ink hover:bg-surface",
                  )}
                >
                  {/* "done" in words: the tick is a duplicate cue, not the cue. */}
                  {step.stepNumber}
                  {done ? " ✓" : ""}
                  <span className="sr-only">
                    {` ${KIND_LABEL[step.kind] ?? step.kind}: ${step.title}${done ? " — done" : ""}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ---------------- the step ---------------- */}
      <Card
        data-testid="learn-current-step"
        data-step-kind={current.kind}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" size="sm">
              {KIND_LABEL[current.kind] ?? current.kind}
            </Badge>
            <span>
              Step {current.stepNumber} of {steps.length}: {current.title}
            </span>
          </span>
        }
      >
        <div className="space-y-5">
          {current.body && <MarkdownContent markdown={current.body} />}

          {current.kind === "explain" && current.explain && (
            <StepDiagram explain={current.explain} diagramId={`learn-diagram-${current.id}`} />
          )}

          {current.kind === "lab" && <LabStep step={current} />}

          {current.kind === "check" && current.check && (
            <CheckStep
              check={current.check}
              checkId={`learn-check-${current.id}`}
              initialOutcome={checkOutcomes[current.id] ?? null}
              onAnswer={(answerIndex) => save(current.id, answerIndex)}
            />
          )}
        </div>
      </Card>

      {/* ---------------- controls ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          data-testid="learn-prev-step"
          disabled={atFirst}
          onClick={() => goTo(index - 1)}
        >
          Previous step
        </Button>
        <Button
          data-testid="learn-next-step"
          loading={saving}
          disabled={saving}
          onClick={completeAndAdvance}
        >
          {atLast
            ? currentDone
              ? "Module complete"
              : "Finish module"
            : currentDone
              ? "Next step"
              : "Mark done and continue"}
        </Button>
        {currentDone && (
          <span className="text-xs text-ink-muted" data-testid="learn-step-done-marker">
            This step is saved.
          </span>
        )}
      </div>

      {saveError && (
        <p role="alert" data-testid="learn-save-error" className="text-sm text-ink-muted">
          {saveError}
        </p>
      )}
    </div>
  );
}

export default ModuleRunner;
