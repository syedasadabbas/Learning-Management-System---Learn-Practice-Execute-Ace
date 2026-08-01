// =============================================================================
// SUBMIT-REVIEW VALIDATION — PURE. Zod for the shape, ./rubric.ts for the scores.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// WHY THE SCHEMA LIVES HERE AND NOT IN src/lib/contracts/validation.ts. That file
// is the FROZEN Wave 0 seam owned by the shared-contracts skill; it holds the
// schemas more than one stream validates against (login, quiz submit, grade
// submit). Nothing outside this stream submits a peer review, so adding a schema
// there would edit a frozen shared file to declare something with one consumer.
// The bounds it DOES own are reused rather than restated: MAX_REVIEW_CHARS is 4000
// to match `gradeSubmissionSchema.feedback` (contracts/validation.ts:37), and the
// star range is 1..5 to match `gradeSubmissionSchema.stars` (line 36) — see
// ./rubric.ts.
//
// THE LENGTH FLOOR IS ENFORCEMENT, NOT A HINT. `MIN_REVIEW_CHARS` is checked on the
// TRIMMED string, server-side, in the one function every write path calls. The form
// mirrors it as a courtesy (src/components/peer-review/PeerReviewForm.tsx says so
// in its own header, in the same words src/components/instructor/GradeForm.tsx
// uses: "never treat a disabled button as a guard").
// =============================================================================

import { z } from "zod";

import { MAX_REVIEW_CHARS, MIN_REVIEW_CHARS } from "./config";
import { validateRubricScores, type RubricCriterion } from "./rubric";

/**
 * The submit payload's SHAPE. The rubric scores are `unknown` at this layer on
 * purpose: which keys are valid depends on the round's rubric, which is a database
 * read, so the shape check and the rubric check are two steps rather than one
 * schema that would need the rubric injected into it.
 */
export const submitPeerReviewSchema = z.object({
  allocationId: z.number().int().positive(),
  content: z
    .string()
    .trim()
    .min(
      MIN_REVIEW_CHARS,
      `Write at least ${MIN_REVIEW_CHARS} characters. A review shorter than that is not ` +
        `useful to the person receiving it.`,
    )
    .max(MAX_REVIEW_CHARS, `Keep the review under ${MAX_REVIEW_CHARS} characters.`),
  rubricScores: z.record(z.string(), z.unknown()),
});

export type SubmitPeerReviewInput = z.infer<typeof submitPeerReviewSchema>;

export type ParsedPeerReview =
  | {
      ok: true;
      data: {
        allocationId: number;
        content: string;
        rubricScores: Record<string, number>;
        totalScore: number;
      };
    }
  | { ok: false; error: string; issues: string[] };

/**
 * Validate a submit payload against a specific rubric.
 *
 * Returns a result rather than throwing, matching
 * src/lib/instructor/grade-payload.ts#parseGradePayload: this is called from a
 * server action, and a thrown error crosses the RSC boundary as "an unexpected
 * response occurred", which tells a student nothing about whether their review was
 * saved.
 *
 * The `issues` array carries every problem at once. A form that reports one error
 * per submit makes a reviewer who missed two criteria press Save three times.
 */
export function parseSubmitPeerReview(
  payload: unknown,
  criteria: readonly RubricCriterion[],
): ParsedPeerReview {
  const shape = submitPeerReviewSchema.safeParse(payload);
  if (!shape.success) {
    const issues = shape.error.issues.map((issue) => issue.message);
    return { ok: false, error: issues[0] ?? "The review could not be saved.", issues };
  }

  const scores = validateRubricScores(criteria, shape.data.rubricScores);
  if (!scores.ok) {
    return {
      ok: false,
      error: scores.issues[0] ?? "Score every criterion before submitting.",
      issues: scores.issues,
    };
  }

  return {
    ok: true,
    data: {
      allocationId: shape.data.allocationId,
      // The trimmed value, so the stored review cannot be 4000 characters of
      // whitespace around 12 characters of text.
      content: shape.data.content,
      rubricScores: scores.scores,
      totalScore: scores.total,
    },
  };
}

/**
 * How far a draft is from being submittable, for the live counter on the form.
 *
 * PURE and shared with the component so the number under the textarea and the
 * server's refusal cannot disagree — the same reason
 * src/components/instructor/GradeForm.tsx computes its score preview with the real
 * `deriveScore` instead of its own arithmetic.
 */
export function charsRemaining(content: string): number {
  return Math.max(0, MIN_REVIEW_CHARS - content.trim().length);
}
