// =============================================================================
// EXPECTATION PARSING — the untrusted-jsonb boundary for learning steps.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// `learning_steps.expectation` is jsonb, and the schema comment is explicit:
// "validated on read, never trusted, exactly like lectures.resources". So this
// file is the only place that looks at the raw value, and it is a total function
// in both directions:
//
//   * A malformed expectation NEVER throws. It returns null, and the step
//     renders as prose with no diagram / no editor / no question. A content typo
//     must not 500 a page a cohort is sitting in front of.
//   * A `check` expectation is split in two. `parseCheck` keeps the answer key
//     for the server; `publicCheck` produces the client payload with every
//     `correct` flag removed. `evaluateCheck` is pure so the grading branch can
//     be unit-tested without a database or a request.
//
// Zod is already a dependency and is used elsewhere for request bodies, but the
// parsers here are hand-written on purpose: they must degrade to null field by
// field (a diagram with one bad frame keeps its other frames) rather than
// rejecting a whole object, and expressing that as a Zod schema costs more than
// it saves.
// =============================================================================

import type {
  CheckExpectation,
  CheckOption,
  DiagramFrame,
  ExplainExpectation,
  LabExpectation,
  LearnStepKind,
  PublicCheck,
} from "./types";
import { LEARN_STEP_KINDS } from "./types";

/** Longest string we will echo out of jsonb, so a huge cell cannot bloat a page. */
const MAX_TEXT = 4_000;
/** Most frames one diagram may declare. */
const MAX_FRAMES = 12;
/** Most options one check may declare. */
const MAX_OPTIONS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty trimmed string, clipped, or null. */
function str(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Narrow an arbitrary value to a known step kind. Unknown kinds become "explain". */
export function parseStepKind(value: unknown): LearnStepKind {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (LEARN_STEP_KINDS as readonly string[]).includes(candidate)
    ? (candidate as LearnStepKind)
    : "explain";
}

// ---------------------------------------------------------------------------
// explain
// ---------------------------------------------------------------------------

function parseFrame(value: unknown): DiagramFrame | null {
  if (!isRecord(value)) return null;
  const label = str(value.label, 120);
  const caption = str(value.caption, 600);
  if (!label || !caption) return null;
  const code = str(value.code, 600);
  return code ? { label, caption, code } : { label, caption };
}

/**
 * Parse an `explain` expectation. Returns null when there is no usable diagram
 * at all; a diagram with some bad frames keeps the good ones.
 */
export function parseExplain(value: unknown): ExplainExpectation | null {
  if (!isRecord(value)) return null;
  if (value.kind !== undefined && value.kind !== "explain") return null;

  const raw = Array.isArray(value.frames) ? value.frames : [];
  const frames = raw
    .slice(0, MAX_FRAMES)
    .map(parseFrame)
    .filter((f): f is DiagramFrame => f !== null);
  if (frames.length === 0) return null;

  return {
    kind: "explain",
    diagramTitle: str(value.diagramTitle, 200) ?? "Diagram",
    frames,
  };
}

// ---------------------------------------------------------------------------
// lab
// ---------------------------------------------------------------------------

/**
 * Parse a `lab` expectation. A lab with no goal is still a lab — the editor is
 * useful on its own — so the goal falls back rather than nulling the whole thing.
 */
export function parseLab(value: unknown): LabExpectation | null {
  if (!isRecord(value)) return null;
  if (value.kind !== undefined && value.kind !== "lab") return null;

  const lab: LabExpectation = {
    kind: "lab",
    goal: str(value.goal, 800) ?? "Edit the program and run it.",
  };
  const hint = str(value.hint, 800);
  if (hint) lab.hint = hint;
  const setup = str(value.setup, MAX_TEXT);
  if (setup) lab.setup = setup;
  if (value.notProductionReady === true) lab.notProductionReady = true;
  return lab;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function parseOption(value: unknown): CheckOption | null {
  if (typeof value === "string") {
    const text = str(value, 400);
    return text ? { text } : null;
  }
  if (!isRecord(value)) return null;
  const text = str(value.text, 400);
  if (!text) return null;
  return value.correct === true ? { text, correct: true } : { text };
}

/**
 * Parse a `check` expectation INCLUDING its answer key. Server-side only.
 *
 * Returns null unless there are at least two options and exactly one is marked
 * correct. "Exactly one" mirrors the rule `scripts/seed-content.ts` already
 * enforces for MCQs: zero correct answers is an unanswerable question and two is
 * an ambiguous one, and both are content bugs better shown as "no question here"
 * than as a question the student cannot get right.
 */
export function parseCheck(value: unknown): CheckExpectation | null {
  if (!isRecord(value)) return null;
  if (value.kind !== undefined && value.kind !== "check") return null;

  const prompt = str(value.prompt, 1_000);
  if (!prompt) return null;

  const raw = Array.isArray(value.options) ? value.options : [];
  const options = raw
    .slice(0, MAX_OPTIONS)
    .map(parseOption)
    .filter((o): o is CheckOption => o !== null);
  if (options.length < 2) return null;
  if (options.filter((o) => o.correct === true).length !== 1) return null;

  return {
    kind: "check",
    prompt,
    options,
    explanation: str(value.explanation, 1_500) ?? "",
  };
}

/**
 * The client-safe projection of a check: options in the same order, no keys.
 *
 * Order is preserved so the index the browser posts back lines up with the
 * server's own array. Shuffling would need the permutation stored per session,
 * which buys nothing here — the answer never leaves the server anyway.
 */
export function publicCheck(check: CheckExpectation): PublicCheck {
  return {
    prompt: check.prompt,
    options: check.options.map((o) => ({ text: o.text })),
  };
}

/** Index of the correct option, or -1 if somehow absent. */
export function correctIndex(check: CheckExpectation): number {
  return check.options.findIndex((o) => o.correct === true);
}

export interface CheckOutcome {
  correct: boolean;
  correctIndex: number;
  explanation: string;
}

/**
 * Grade one answer. Pure, so the grading branch is unit-testable.
 *
 * An out-of-range or non-integer index is "wrong", not an error: it can only
 * come from a hand-made request, and there is no grade at stake to protect.
 */
export function evaluateCheck(check: CheckExpectation, answerIndex: unknown): CheckOutcome {
  const key = correctIndex(check);
  const picked =
    typeof answerIndex === "number" && Number.isInteger(answerIndex) ? answerIndex : -1;
  return {
    correct: key >= 0 && picked === key,
    correctIndex: key,
    explanation: check.explanation,
  };
}
