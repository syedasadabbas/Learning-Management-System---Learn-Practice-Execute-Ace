// =============================================================================
// INTERACTIVE LEARNING — types for the self-paced concept tracks.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// These tracks are DELIBERATELY UNGRADED. `src/db/schema.ts` says so in the
// `learning_modules` docstring: they sit outside weeks/lectures precisely so
// they never touch unlock rules, weekly scores or the leaderboard. Two design
// consequences follow, and both are load-bearing:
//
//   1. Completion is a BOOLEAN PER STEP, not a mark. There is no score column on
//      `learning_progress` and this stream does not add one.
//   2. Track/module percentages are DERIVED from completed-steps / total-steps
//      on every read (see progress.ts). Nothing stores a percentage, so a
//      stored number can never disagree with the rows underneath it.
//
// `learning_steps.expectation` is `jsonb`, which means it is untrusted by
// contract — exactly like `lectures.resources`. Every shape below has a
// validating parser in expectation.ts; nothing reads `expectation` raw.
// =============================================================================

import type { proficiencyLevel } from "@/db/schema";

/** The three step kinds. Mirrors the `learning_steps.kind` comment. */
export const LEARN_STEP_KINDS = ["explain", "lab", "check"] as const;
export type LearnStepKind = (typeof LEARN_STEP_KINDS)[number];

/** Difficulty ladder, from the frozen `proficiency_level` enum. */
export type LearnLevel = (typeof proficiencyLevel.enumValues)[number];
export const LEARN_LEVELS: readonly LearnLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
] as const;

/** Languages a lab may name. Every one of these has an in-browser runner. */
export const LAB_LANGUAGES = ["javascript", "python", "sql"] as const;
export type LabLanguage = (typeof LAB_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Expectation payloads, one per step kind
// ---------------------------------------------------------------------------

/**
 * One frame of an `explain` step's diagram.
 *
 * A frame is a labelled state with a caption, so the diagram is readable as
 * prose with the motion switched off. That is the whole reason the shape carries
 * a caption per frame rather than one caption for the animation: with
 * `prefers-reduced-motion: reduce` every frame is rendered at once as a static
 * stack, and the captions are what keeps the information intact.
 */
export interface DiagramFrame {
  /** Short label; also the accessible name of the frame's step control. */
  label: string;
  /** One or two sentences: what this frame shows and why it matters. */
  caption: string;
  /** Optional code line the frame corresponds to. */
  code?: string;
}

export interface ExplainExpectation {
  kind: "explain";
  /** Heading for the diagram region. */
  diagramTitle: string;
  frames: DiagramFrame[];
}

export interface LabExpectation {
  kind: "lab";
  /** What the student should end up having done. Shown above the editor. */
  goal: string;
  /** Optional nudge, revealed on request rather than shown by default. */
  hint?: string;
  /**
   * Setup fed to the runner's stdin. For SQL this is the schema + fixture
   * script, because SQLite has no stdin — see sqljs-worker.ts.
   */
  setup?: string;
  /**
   * True when the lab implements a primitive for teaching rather than for use.
   * Rendered as a prominent warning. Required by the cryptography content rule:
   * a hand-rolled primitive must say it is not production-ready.
   */
  notProductionReady?: boolean;
}

/** One option of a `check` step. `correct` is stripped before this reaches a client. */
export interface CheckOption {
  text: string;
  correct?: boolean;
}

export interface CheckExpectation {
  kind: "check";
  prompt: string;
  options: CheckOption[];
  /** Shown after the student answers, whichever way they answered. */
  explanation: string;
}

export type StepExpectation = ExplainExpectation | LabExpectation | CheckExpectation;

/**
 * A `check` step as the BROWSER is allowed to see it: no `correct` flags.
 *
 * The answer key is graded server-side in complete.ts. These checks carry no
 * marks, so the key protects a moment of learning rather than a grade — but
 * shipping it to the client anyway would have been a second, weaker precedent
 * next to `src/lib/quizzes/payload.ts`, and there is no reason to set one.
 */
export interface PublicCheck {
  prompt: string;
  options: { text: string }[];
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** A step as a page renders it. `expectation` is already parsed and trusted. */
export interface LearnStepView {
  id: number;
  stepNumber: number;
  kind: LearnStepKind;
  title: string;
  body: string;
  /** Lab steps only. */
  starterCode: string | null;
  language: string | null;
  execution: "browser" | "piston" | "none";
  /** Parsed expectation, or null when the row carried nothing usable. */
  explain: ExplainExpectation | null;
  lab: LabExpectation | null;
  /** Answer key already removed. */
  check: PublicCheck | null;
}

/** A module row, without steps. */
export interface LearnModuleSummary {
  id: number;
  slug: string;
  track: string;
  title: string;
  summary: string;
  level: LearnLevel;
  estimatedMinutes: number | null;
  orderIndex: number;
  stepCount: number;
  /** Steps this student has completed. 0 when signed-out or untouched. */
  completedSteps: number;
}

export interface LearnModuleDetail extends LearnModuleSummary {
  steps: LearnStepView[];
  /** Step ids this student has already completed. */
  completedStepIds: number[];
}

/** One track as the /learn index shows it. */
export interface LearnTrackSummary {
  track: string;
  title: string;
  summary: string;
  moduleCount: number;
  stepCount: number;
  completedSteps: number;
  /** Levels that actually have a published module, in ladder order. */
  levels: LearnLevel[];
}
