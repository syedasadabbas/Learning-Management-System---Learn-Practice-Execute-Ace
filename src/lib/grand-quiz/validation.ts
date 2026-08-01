// =============================================================================
// EXAM REQUEST VALIDATION — Zod schemas for the grand-quiz route handlers.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream.
//
// WHY THESE ARE HERE AND NOT IN `src/lib/contracts/validation.ts`.
// That file is part of the frozen seam and carries no exam schema. Adding one
// would be a seam edit, which this stream may not make. Keeping them in the
// stream's own module is the alternative the brief prescribes — reported, not
// silently reached across.
//
// WHAT IS DELIBERATELY ABSENT
//
//   * No `remainingMs`, `elapsedMs`, `clientNow` or `deadlineAt` field anywhere.
//     Invariant I2 makes the server the only authority on time, and the surest way
//     to keep a client-sent clock out of a decision is to have no field to put it
//     in. If a future request body needs one, that is a defect to argue about, not
//     a schema to extend.
//   * No bulk "final answers" array on submit. Everything is autosaved as the
//     student works, so submit takes no body at all beyond the auto-submit flag.
//     A submit that carried answers could introduce one after the deadline.
// =============================================================================

import { z } from "zod";

/**
 * Ceiling on one stored code answer, in characters.
 *
 * Matched to `MAX_SOURCE_CHARS` in `src/lib/execution/truncate.ts` in intent: a
 * program longer than the runner will accept cannot be graded, so storing it
 * would only guarantee a deferral. Refused with a clear message instead, while
 * the student still has time to shorten it.
 */
export const MAX_CODE_ANSWER_CHARS = 20_000;

/**
 * One autosaved answer.
 *
 * `selectedOptionId` and `codeAnswer` are both optional and both nullable —
 * null is how a student CLEARS an answer, which must be possible: an exam where
 * a first guess cannot be withdrawn is worse than one with no autosave. Which of
 * the two is legal for a given question is decided server-side from the
 * question's own `type`, not from what the client chose to send.
 */
export const examAnswerSchema = z
  .object({
    questionId: z.number().int().positive(),
    selectedOptionId: z.number().int().positive().nullable().optional(),
    codeAnswer: z.string().max(MAX_CODE_ANSWER_CHARS).nullable().optional(),
  })
  .refine(
    (value) => value.selectedOptionId !== undefined || value.codeAnswer !== undefined,
    { message: "Send either selectedOptionId or codeAnswer (null to clear)." },
  );

export type ExamAnswerInput = z.infer<typeof examAnswerSchema>;

/**
 * The submit body. One optional flag, and it is a HINT ONLY.
 *
 * `autoSubmitted: true` is what the client's countdown sends when it reaches
 * zero. It can only ever ADD the flag, never remove it: the server ORs it with its
 * own `now >= deadline_at` check, so a client that submits late while claiming a
 * manual submit is still recorded as auto-submitted. And the flag changes nothing
 * about the score either way — it records how the exam closed, which is the first
 * thing a student asks about.
 */
export const examSubmitSchema = z.object({
  autoSubmitted: z.boolean().optional(),
});

export type ExamSubmitInput = z.infer<typeof examSubmitSchema>;

/** The first Zod issue as one line of prose, for the `ApiErr` envelope. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
