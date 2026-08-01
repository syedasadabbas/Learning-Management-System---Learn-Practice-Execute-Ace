// =============================================================================
// REQUEST VALIDATION — learning-enhancement write payloads.
// Owner: the API stream.
// -----------------------------------------------------------------------------
// These are NOT in src/lib/contracts/validation.ts. That file is the frozen
// Wave 0 seam shared by every stream; these schemas belong to three tables that
// did not exist when it was frozen and are read by nothing outside this wave.
// Adding them there would widen a frozen file for no consumer.
//
// TWO CONVENTIONS THAT ARE LOAD-BEARING:
//
// 1. camelCase, matching the Drizzle column keys. The technical spec writes
//    request bodies in snake_case (`sample_output_html`), and DECISIONS.md
//    already resolved that tension for the schema in favour of camelCase TS
//    keys. Accepting snake_case at the API boundary would reintroduce exactly
//    the two-spellings problem that decision closed, one layer up. The
//    frontend stream builds against these schemas, not against the spec's
//    prose.
//
// 2. `.strict()` on every object. An unknown key is a 422, not a silent drop.
//    A client sending `sampleOrder` when the field is `sample_order` gets told;
//    with `.strip()` (zod's default) it gets a 201 and a row at position 0, and
//    finds out when the carousel is in the wrong order in production.
//
// PARTIAL UPDATES: the PUT schemas are `.partial()` derivations with an
// explicit "at least one field" refinement, because an empty PUT that returns
// 200 is indistinguishable from one that worked.
// =============================================================================

import { z } from "zod";

/** Reuses the `proficiency_level` pgEnum's labels — see DECISIONS.md. */
export const proficiencySchema = z.enum(["beginner", "intermediate", "advanced"]);

/**
 * Reuses the `execution_mode` pgEnum's labels EXACTLY (src/db/schema.ts:86).
 *
 * `piston`, not `server`: the spec's prose says "server", the enum says
 * `piston` after the name of the sandbox that actually runs it, and the enum
 * wins — a parallel spelling here would be a value Postgres rejects at INSERT
 * time with a 500 that names neither the field nor the allowed set.
 */
export const executionModeSchema = z.enum(["browser", "piston", "none"]);

/**
 * A URL a browser will actually navigate to or embed.
 *
 * `http`/`https` only, for the reason src/lib/presentations/types.ts gives at
 * length: a `javascript:` or `data:` URL stored here is a stored-XSS payload
 * the moment a renderer puts it in an `href` or a `src`. The length ceilings
 * match the varchar widths in the schema so a 600-character URL fails
 * validation instead of failing the INSERT.
 */
const httpUrl = (max: number) =>
  z
    .string()
    .url()
    .max(max)
    .refine((v) => /^https?:\/\//i.test(v), "only http(s) URLs are allowed");

/** A non-negative ordering index, matching the CHECK constraints in the schema. */
const orderIndex = z.number().int().min(0).max(10_000);

// ---------------------------------------------------------------------------
// assignment_samples
// ---------------------------------------------------------------------------

/** `CodeExampleFile` — TECHNICAL_SPECIFICATION.md:311-333. */
export const codeExampleFileSchema = z
  .object({
    filename: z.string().min(1).max(255),
    language: z.string().min(1).max(32),
    code: z.string().max(100_000),
    explanation: z.string().max(5_000).optional(),
    /** 1-based line numbers to highlight in the viewer. */
    highlightedLines: z.array(z.number().int().min(1)).max(500).optional(),
    lineExplanations: z.record(z.string(), z.string().max(1_000)).optional(),
  })
  .strict();

export const createSampleSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(2_000).optional(),
    sampleOrder: orderIndex.default(0),
    /**
     * Authored HTML. NOT sanitised here, and that is deliberate: the column
     * comment in schema.learning.ts states this is rendered inside a sandboxed
     * iframe, never injected into the app document. Sanitising it at write time
     * would silently break legitimate sample markup (a `<script>` demonstrating
     * an onclick handler is the point of some samples) while giving a false
     * sense that the render site no longer needs its sandbox.
     */
    sampleOutputHtml: z.string().max(200_000).optional(),
    screenshotUrl: httpUrl(500).optional(),
    codeExample: z.array(codeExampleFileSchema).max(50).optional(),
    liveUrl: httpUrl(500).optional(),
    features: z.array(z.string().max(120)).max(50).optional(),
    videoWalkthroughUrl: httpUrl(500).optional(),
  })
  .strict();

export const updateSampleSchema = createSampleSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied");

export type CreateSampleInput = z.infer<typeof createSampleSchema>;
export type UpdateSampleInput = z.infer<typeof updateSampleSchema>;

// ---------------------------------------------------------------------------
// practice_problems
// ---------------------------------------------------------------------------

/**
 * One rung of the hint ladder. `level` is 1-based and bounded at 10 — a
 * ten-step ladder is already more scaffolding than any problem here needs, and
 * the bound stops a seeder writing level 9999 which `hintsUpTo` would then have
 * to sort past on every read.
 */
export const hintSchema = z
  .object({
    level: z.number().int().min(1).max(10),
    text: z.string().min(1).max(2_000),
  })
  .strict();

export const acceptanceCriterionSchema = z
  .object({
    criteria: z.string().min(1).max(1_000),
    howToVerify: z.string().max(1_000).optional(),
  })
  .strict();

export const testCaseSchema = z
  .object({
    name: z.string().min(1).max(200),
    input: z.string().max(10_000),
    expected: z.string().max(10_000),
  })
  .strict();

export const createPracticeProblemSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(5_000).optional(),
    difficultyLevel: proficiencySchema.default("beginner"),
    learningObjectives: z.array(z.string().max(300)).max(20).optional(),
    /** NOT NULL in the schema: a problem with no motivation is a chore. */
    problemContext: z.string().min(1).max(10_000),
    problemStatement: z.string().min(1).max(20_000),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).max(30).optional(),
    starterCode: z.string().max(50_000).optional(),
    starterLanguage: z.string().max(32).optional(),
    /**
     * Required, with `[]` as the explicit way to say "no hints" — the column is
     * NOT NULL for the reason the schema header gives, and defaulting it here
     * would let an author ship a hint button that opens nothing without ever
     * making the choice.
     */
    hints: z.array(hintSchema).max(10),
    solutionCode: z.string().max(50_000).optional(),
    solutionExplanation: z.string().max(20_000).optional(),
    solutionScreenshotUrl: httpUrl(500).optional(),
    testCases: z.array(testCaseSchema).max(50).optional(),
    execution: executionModeSchema.default("browser"),
    problemOrder: orderIndex.default(0),
  })
  .strict()
  .refine(
    (v) => new Set(v.hints.map((h) => h.level)).size === v.hints.length,
    "hint levels must be unique",
  );

export const updatePracticeProblemSchema = createPracticeProblemSchema
  .innerType()
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied")
  .refine(
    (v) => v.hints === undefined || new Set(v.hints.map((h) => h.level)).size === v.hints.length,
    "hint levels must be unique",
  );

export type CreatePracticeProblemInput = z.infer<typeof createPracticeProblemSchema>;
export type UpdatePracticeProblemInput = z.infer<typeof updatePracticeProblemSchema>;

/**
 * A practice attempt.
 *
 * WHAT THIS ENDPOINT DOES NOT DO, said here because the shape implies it:
 * nothing is persisted. There is no attempts ledger for `practice_problems` —
 * the table was created without one on purpose (schema.learning.ts contrasts it
 * with `coding_problems`, which HAS `coding_attempts`). So `code` is validated,
 * bounded, and used to shape the self-check response; it is not stored, not
 * executed server-side, and not scored.
 */
export const practiceAttemptSchema = z
  .object({
    code: z.string().max(100_000),
    language: z.string().min(1).max(32),
    /** Which rung of the hint ladder the student has already opened. */
    hintsUsed: z.number().int().min(0).max(10).default(0),
  })
  .strict();

export type PracticeAttemptInput = z.infer<typeof practiceAttemptSchema>;

// ---------------------------------------------------------------------------
// interview_questions
// ---------------------------------------------------------------------------

export const commonMistakeSchema = z
  .object({
    mistake: z.string().min(1).max(1_000),
    whyWrong: z.string().max(2_000).optional(),
    correction: z.string().max(2_000).optional(),
  })
  .strict();

export const createInterviewQuestionSchema = z
  .object({
    /**
     * EXACTLY ONE parent. The database enforces it with a CHECK
     * (`(lecture_id IS NULL) <> (week_id IS NULL)`); validating it here as well
     * turns a 500 from a constraint violation into a 422 that names the field.
     * Duplicating the rule is acceptable where the database keeps the authority
     * and this layer only improves the error.
     */
    lectureId: z.number().int().positive().optional(),
    weekId: z.number().int().positive().optional(),
    title: z.string().min(1).max(255),
    difficultyLevel: proficiencySchema.default("intermediate"),
    category: z.string().max(50).optional(),
    questionText: z.string().min(1).max(10_000),
    context: z.string().max(5_000).optional(),
    /** NOT NULL: a question with no model answer is a quiz item, not prep. */
    sampleAnswer: z.string().min(1).max(20_000),
    answerExplanation: z.string().max(20_000).optional(),
    commonMistakes: z.array(commonMistakeSchema).max(20).optional(),
    followUpQuestions: z.array(z.string().max(500)).max(20).optional(),
    visualWalkthroughHtml: z.string().max(200_000).optional(),
    codeExample: z.string().max(50_000).optional(),
    relatedConcepts: z.array(z.string().max(120)).max(30).optional(),
    relatedPracticeId: z.number().int().positive().optional(),
    questionOrder: orderIndex.default(0),
  })
  .strict()
  .refine(
    (v) => (v.lectureId === undefined) !== (v.weekId === undefined),
    "exactly one of lectureId or weekId must be supplied",
  );

export const updateInterviewQuestionSchema = createInterviewQuestionSchema
  .innerType()
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied")
  .refine(
    // Re-parenting is allowed but must not produce the neither/both states the
    // CHECK forbids. Supplying neither on an update means "leave the parent
    // alone", which is why this only fires when at least one is present.
    (v) =>
      !(v.lectureId !== undefined && v.weekId !== undefined) ||
      (v.lectureId === undefined) !== (v.weekId === undefined),
    "a question may not be attached to both a lecture and a week",
  );

export type CreateInterviewQuestionInput = z.infer<typeof createInterviewQuestionSchema>;
export type UpdateInterviewQuestionInput = z.infer<typeof updateInterviewQuestionSchema>;

// ---------------------------------------------------------------------------
// lecture_visualizations
// ---------------------------------------------------------------------------

/**
 * Renderer key. A free string rather than an enum, matching the column: the
 * schema header states the registry grows faster than a migration cadence and
 * an unrecognised type must degrade to "unsupported visualisation" rather than
 * crash the lecture. Validating it as an enum here would move that failure from
 * a graceful fallback to a 422 at authoring time for a renderer that ships next
 * week.
 */
export const createVisualizationSchema = z
  .object({
    type: z.string().min(1).max(50),
    title: z.string().min(1).max(255),
    description: z.string().max(2_000).optional(),
    topicKey: z.string().max(120).optional(),
    svgMarkup: z.string().max(500_000).optional(),
    animationSpec: z.record(z.string(), z.unknown()).optional(),
    interactiveData: z.record(z.string(), z.unknown()).optional(),
    explanation: z.string().max(10_000).optional(),
    learningPoint: z.string().max(1_000).optional(),
    /** Pixels, and CHECKed > 0 in the database. See the schema's `sizePositive`. */
    widthPx: z.number().int().positive().max(10_000).optional(),
    heightPx: z.number().int().positive().max(10_000).optional(),
    isInteractive: z.boolean().default(false),
    orderIndex: orderIndex.default(0),
  })
  .strict();

export const updateVisualizationSchema = createVisualizationSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied");

export type CreateVisualizationInput = z.infer<typeof createVisualizationSchema>;
export type UpdateVisualizationInput = z.infer<typeof updateVisualizationSchema>;

// ---------------------------------------------------------------------------
// Shared request helpers
// ---------------------------------------------------------------------------

/** A parsed body, or the message a 422 should carry. */
export type ParsedBody<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Read and validate a JSON request body.
 *
 * Folds three failure modes into one result so no handler repeats the
 * try/catch: unreadable body, non-JSON body, and schema violation. The caller
 * answers 422 for all three — they are all "the request you sent cannot be
 * processed", and distinguishing malformed JSON from a bad field buys a client
 * nothing it cannot see in the message.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: formatZodError(result.error) };
}

/**
 * Render a zod error as one line naming the fields.
 *
 * Field paths are included because "Invalid input" costs the client an hour.
 * The number of issues is capped at five so a `.strict()` violation listing
 * forty unknown keys does not produce an error string larger than the request.
 */
export function formatZodError(error: z.ZodError): string {
  const parts = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
  const suffix = error.issues.length > 5 ? ` (+${error.issues.length - 5} more)` : "";
  return parts.join("; ") + suffix;
}
