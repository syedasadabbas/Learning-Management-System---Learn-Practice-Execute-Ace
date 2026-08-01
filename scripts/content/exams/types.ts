// =============================================================================
// GRAND-EXAM CONTENT TYPES — seed data only. Owner: curriculum-content stream.
// -----------------------------------------------------------------------------
// Four grand quizzes, one per EXISTING week, built to the blueprint in
// docs/research/CURRICULUM_PLAN.md Section A. Nothing in the owner's existing
// syllabus is modified: these add `quizzes` rows with `kind = 'grand'` and their
// questions/options only.
//
// The three question shapes are a discriminated union rather than one optional-
// heavy object, because the fields are genuinely disjoint and the validator has
// to be able to say "a code_write item has no options" as a type error rather
// than as a runtime surprise:
//
//   mcq        — 4 options, exactly one correct, 2 points, always explained.
//   code_fix   — broken code in `starterCode` plus 4 candidate patches as
//                OPTIONS, exactly one correct, 3 points. This is why the item
//                auto-grades with no runtime at all: it is an MCQ whose stem
//                happens to be a program.
//   code_write — free-form source, 8 points, graded server-side against hidden
//                `tests`. Never serialise `tests` to a student.
// =============================================================================

/** One candidate answer. `correct` omitted means false, as in scripts/seed-content.ts. */
export type SeedExamOption = { text: string; correct?: boolean };

/**
 * One hidden test case. Shape is fixed by `questions.tests` in src/db/schema.ts:
 * `Array<{ name, input, expected }>`.
 *
 * For `javascript` items (weeks 3 and 4) `input` is literal stdin and `expected`
 * is the exact trimmed stdout, so the case is executable by Piston as written.
 *
 * For `html` and `css` items (weeks 1 and 2) there is no runtime that can
 * "execute" markup, so `input` names a STRUCTURAL PROBE over the submitted
 * source and `expected` is the value that probe must yield. See the note in
 * index.ts — this is a documented gap, not a claim that Piston can grade HTML.
 */
export type SeedExamTest = { name: string; input: string; expected: string };

export type SeedMcqQuestion = {
  type: "mcq";
  questionText: string;
  explanation: string;
  options: SeedExamOption[];
};

export type SeedCodeFixQuestion = {
  type: "code_fix";
  questionText: string;
  explanation: string;
  language: string;
  /** The BROKEN artefact the student reads. Never the answer. */
  starterCode: string;
  options: SeedExamOption[];
};

export type SeedCodeWriteQuestion = {
  type: "code_write";
  questionText: string;
  explanation: string;
  language: string;
  /** A skeleton, not a solution. */
  starterCode: string;
  tests: SeedExamTest[];
};

export type SeedExamQuestion = SeedMcqQuestion | SeedCodeFixQuestion | SeedCodeWriteQuestion;

export type SeedExam = {
  /** Resolved to a week id at runtime. NEVER a hardcoded id — serials are reassigned by every reseed. */
  weekNumber: number;
  title: string;
  questions: SeedExamQuestion[];
};

// ---------------------------------------------------------------------------
// The blueprint, as values the validator checks against
// ---------------------------------------------------------------------------

/**
 * Marks per type. Fixed here rather than per question so a typo cannot make one
 * exam total 149: the seeder derives `questions.points` from the item's `type`.
 */
export const EXAM_POINTS: Record<SeedExamQuestion["type"], number> = {
  mcq: 2,
  code_fix: 3,
  code_write: 8,
};

/** Type counts per exam, from Section A.0. 30 + 14 + 6 = 50. */
export const EXAM_TYPE_COUNTS: Record<SeedExamQuestion["type"], number> = {
  mcq: 30,
  code_fix: 14,
  code_write: 6,
};

export const EXAM_QUESTION_COUNT = 50;
/** (30 x 2) + (14 x 3) + (6 x 8) = 60 + 42 + 48 = 150. */
export const EXAM_TOTAL_POINTS = 150;
export const EXAM_COUNT = 4;
export const EXAM_TIME_LIMIT_MINUTES = 120;
export const EXAM_ATTEMPTS_ALLOWED = 1;
/** 60% of 150 = 90 points. Stored as a percent, like every other quiz row. */
export const EXAM_PASSING_SCORE_PERCENT = 60;
export const EXAM_OPTIONS_PER_QUESTION = 4;
export const EXAM_MIN_TESTS_PER_CODE_WRITE = 3;

/**
 * The difficulty curve as a flat expected type sequence: 30 mcq, then 14
 * code_fix, then 6 code_write. Asserting the ORDER and not just the counts is
 * what makes the curve real — the blueprint's whole point is that a student who
 * runs out of time loses the items they were least likely to earn, and that
 * property is destroyed by an exam whose 8-point item sits at position 3.
 */
export const EXAM_TYPE_SEQUENCE: SeedExamQuestion["type"][] = [
  ...Array<SeedExamQuestion["type"]>(EXAM_TYPE_COUNTS.mcq).fill("mcq"),
  ...Array<SeedExamQuestion["type"]>(EXAM_TYPE_COUNTS.code_fix).fill("code_fix"),
  ...Array<SeedExamQuestion["type"]>(EXAM_TYPE_COUNTS.code_write).fill("code_write"),
];
