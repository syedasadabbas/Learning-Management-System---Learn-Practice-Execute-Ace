// =============================================================================
// GRADE PAYLOAD + SCORE DERIVATION (PURE) — instructor-admin stream.
// -----------------------------------------------------------------------------
// Split out of grading.ts on purpose: this module imports NO database. Unit tests
// can therefore exercise the whole validation and scoring decision without
// pulling in `pg` and opening a connection pool, which tests/setup.ts forbids.
//
// grading.ts re-exports everything here, so callers may import from either.
//
// Two rules, both delegated:
//  * legality of a grade -> `gradeSubmissionSchema` (frozen validation contract)
//  * value of a grade    -> `assignmentPoints` / `daysLate` (frozen scoring
//    contract). Stars below 3 cost 10 points each and late days cost up to 20%.
//    Neither number appears in this file.
// =============================================================================

import {
  gradeSubmissionSchema,
  type GradeSubmissionInput,
} from "@/lib/contracts/validation";
// pointsForSubmission is the submissions stream's own composition of
// `computeLateness` + `assignmentPoints`. Using it here rather than calling
// `assignmentPoints` directly means the score PREVIEWED in the grading form and
// the score WRITTEN by the grading path go through the same function, including
// the cohort grace window. A preview that disagrees with the saved value is worse
// than no preview.
import { pointsForSubmission } from "@/lib/submissions/lateness";

export type ParsedGrade =
  | { ok: true; data: GradeSubmissionInput }
  | { ok: false; error: string; fieldErrors: Record<string, string[]> };

/**
 * Validate an untrusted grade payload against the frozen schema.
 *
 * Returns a result rather than throwing so the route handler (which needs a 400
 * body) and the server action (which needs a form error) share one call site.
 */
export function parseGradePayload(raw: unknown): ParsedGrade {
  const result = gradeSubmissionSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const flat = result.error.flatten();
  const first =
    Object.values(flat.fieldErrors).flat().filter(Boolean)[0] ??
    flat.formErrors[0] ??
    "Invalid grade payload.";
  return {
    ok: false,
    error: String(first),
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}

export interface ScoreDerivationInput {
  submittedAt: Date;
  dueAt: Date;
  latePenaltyPercentPerDay: number;
  /**
   * The student's cohort grace window. Omitted/null means no grace, matching
   * `cohorts.gracePeriodDays` defaulting to 0.
   */
  gracePeriodDays?: number | null;
  stars: number;
  /**
   * An instructor override. When PRESENT it wins, including when it is 0 — a
   * human who types a number has looked at the work. Checked with `!== undefined`
   * rather than truthiness so a deliberate zero is not silently replaced by the
   * star-derived score. Bounded to 0..40 by the schema before it reaches here.
   */
  explicitScore?: number;
}

export interface ScoreDerivation {
  score: number;
  /** Days late AFTER the grace window, which is what the score depends on. */
  daysLate: number;
  /** True when the submission is past dueAt but still inside the grace window. */
  withinGrace: boolean;
  /** True when `explicitScore` overrode the `assignmentPoints` figure. */
  overridden: boolean;
  /** What the contract would have awarded, kept for the audit trail / UI. */
  derivedScore: number;
}

/** Derive the score to store. Pure — no clock, no database. */
export function deriveScore(input: ScoreDerivationInput): ScoreDerivation {
  const { points: derived, lateness } = pointsForSubmission({
    submittedAt: input.submittedAt,
    dueAt: input.dueAt,
    gracePeriodDays: input.gracePeriodDays ?? 0,
    latePenaltyPercentPerDay: input.latePenaltyPercentPerDay,
    stars: input.stars,
  });
  const overridden = input.explicitScore !== undefined;
  return {
    score: overridden ? (input.explicitScore as number) : derived,
    derivedScore: derived,
    daysLate: lateness.daysLate,
    withinGrace: lateness.withinGrace,
    overridden,
  };
}
