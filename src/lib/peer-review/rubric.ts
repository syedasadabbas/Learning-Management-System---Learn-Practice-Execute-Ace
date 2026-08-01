// =============================================================================
// RUBRIC — the criteria a reviewer scores against. PURE: no database, no clock.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// `grading_rubrics.criteria` and `peer_reviews.rubric_scores` are both jsonb, and
// jsonb accepts anything. Every function here therefore treats a value read back
// from the database as UNTRUSTED INPUT rather than as its declared type. That is
// not defensive habit: `criteria` is written by an instructor through a form, the
// column has no shape constraint, and a rubric that fails to parse must degrade to
// "this round has no usable rubric" on one page instead of throwing inside a
// server component and blanking the route for everyone.
//
// EACH CRITERION IS SCORED OUT OF 5, AND THAT NUMBER IS NOT ARBITRARY. The
// existing grading interaction in this repository is a 1..5 star rating —
// `submissions.instructor_rating` (schema.ts:396), the frozen
// `gradeSubmissionSchema.stars` bound of 1..5 (contracts/validation.ts:36), and
// src/components/ui/StarRating.tsx whose own prop comment says "The LMS grades out
// of 5 (see scoring.ts star rules)". The brief is explicit that peer review is the
// same shape of interaction by a different actor and must reuse that vocabulary, so
// a criterion is a 1..5 star rating and the peer-review form renders one
// `StarRating` per criterion. A 10-point rubric (roadmap:446 shows
// `maxPoints: 10`) would have needed a second scoring idiom and a second control.
//
// THE TOTAL IS ADVISORY. `sumRubricScores` produces the number stored in
// `peer_reviews.total_score`; nothing in src/lib/contracts/scoring.ts reads it and
// nothing in this stream writes it to `submissions`. See ./config.ts.
// =============================================================================

/** The maximum any single criterion may be worth. See the header. */
export const CRITERION_MAX_POINTS = 5;

/** Practical ceiling on rubric size, so a form cannot mint a 200-criterion rubric. */
export const MAX_CRITERIA = 8;

/**
 * One thing a reviewer scores.
 *
 * `key` is the STABLE identifier and is what `peer_reviews.rubric_scores` is keyed
 * on. roadmap:437 sketches positional keys (`criterion_1`, `criterion_2`), which
 * are rejected: reordering or inserting a criterion would silently reinterpret
 * every score already stored. A key derived from the criterion's meaning cannot do
 * that — at worst it disappears, which is detectable.
 */
export interface RubricCriterion {
  /** `[a-z0-9_]`, stable for the life of the rubric. */
  key: string;
  /** Shown to the reviewer, e.g. "Requirements met". */
  name: string;
  /** Shown under the name as guidance. Optional. */
  hint?: string;
  /** 1..CRITERION_MAX_POINTS. */
  maxPoints: number;
}

/**
 * The rubric a round gets when an instructor opens one without authoring their
 * own.
 *
 * Three criteria, not five. Each one costs the reviewer a judgement and the
 * reviewee attention; three covers "does it work", "is it built well" and "is it
 * communicated", which is the whole of what a peer can usefully judge about a
 * week-2 web assignment. The seeded curriculum is HTML/CSS/JS/Git
 * (tests/e2e/fixtures.ts SEEDED.weekTitles), so the wording is deliberately
 * technology-neutral within that.
 */
export const DEFAULT_RUBRIC_NAME = "Default peer review rubric";

export const DEFAULT_RUBRIC_CRITERIA: readonly RubricCriterion[] = [
  {
    key: "requirements",
    name: "Requirements met",
    hint: "Does the work do what the brief asked for?",
    maxPoints: CRITERION_MAX_POINTS,
  },
  {
    key: "quality",
    name: "Code quality",
    hint: "Is it readable, tidy, and sensibly structured?",
    maxPoints: CRITERION_MAX_POINTS,
  },
  {
    key: "presentation",
    name: "Presentation",
    hint: "Does the result look and read as finished work?",
    maxPoints: CRITERION_MAX_POINTS,
  },
] as const;

const KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

/**
 * Parse a stored `criteria` blob.
 *
 * Returns the criteria it could make sense of, DROPPING entries it could not, and
 * never throws. A partially readable rubric is more useful than an exception: the
 * reviewer scores what is there and the instructor sees that a criterion is
 * missing, which is a visible problem rather than a 500.
 *
 * Duplicate keys are dropped after the first occurrence, because two criteria with
 * one key would collapse to one score and the reviewer would not be told which of
 * their two ratings survived.
 */
export function parseRubricCriteria(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: RubricCriterion[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;

    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (!KEY_PATTERN.test(key) || seen.has(key)) continue;

    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name === "") continue;

    // A stored maxPoints outside 1..5 is clamped rather than rejected: the
    // criterion is still meaningful and the control can only render five stars, so
    // clamping is the interpretation that loses the least.
    const rawMax = Number(record.maxPoints);
    const maxPoints = Number.isFinite(rawMax)
      ? Math.min(CRITERION_MAX_POINTS, Math.max(1, Math.trunc(rawMax)))
      : CRITERION_MAX_POINTS;

    const hint = typeof record.hint === "string" && record.hint.trim() !== ""
      ? record.hint.trim()
      : undefined;

    seen.add(key);
    out.push(hint ? { key, name, hint, maxPoints } : { key, name, maxPoints });
    if (out.length >= MAX_CRITERIA) break;
  }

  return out;
}

/** The largest total a review under this rubric can carry. */
export function rubricMaxTotal(criteria: readonly RubricCriterion[]): number {
  return criteria.reduce((sum, c) => sum + c.maxPoints, 0);
}

/**
 * Validate a reviewer's scores against the rubric they are scoring.
 *
 * EVERY CRITERION MUST BE SCORED. That is the rule the gaming defence in
 * ./config.ts relies on: a review that skips two of three criteria and writes 120
 * characters is the cheapest possible pass, and refusing it costs an honest
 * reviewer nothing. An unknown key is an error rather than an ignored extra,
 * because it means the form and the rubric disagree and silently discarding the
 * score would show the reviewee a total that does not match what was submitted.
 */
export interface RubricScoreValidation {
  ok: boolean;
  /** Only the criteria named by the rubric, integer-clamped. Empty when !ok. */
  scores: Record<string, number>;
  total: number;
  /** One message per problem, safe to show the reviewer. */
  issues: string[];
}

export function validateRubricScores(
  criteria: readonly RubricCriterion[],
  input: unknown,
): RubricScoreValidation {
  const issues: string[] = [];

  if (criteria.length === 0) {
    return {
      ok: false,
      scores: {},
      total: 0,
      issues: ["This round's rubric has no usable criteria; an instructor must fix it."],
    };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, scores: {}, total: 0, issues: ["No rubric scores were supplied."] };
  }

  const record = input as Record<string, unknown>;
  const known = new Set(criteria.map((c) => c.key));
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      issues.push(`"${key}" is not a criterion on this rubric.`);
    }
  }

  const scores: Record<string, number> = {};
  for (const criterion of criteria) {
    const raw = record[criterion.key];
    if (raw === undefined || raw === null || raw === "") {
      issues.push(`Score "${criterion.name}" before submitting.`);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      issues.push(`"${criterion.name}" must be a whole number of stars.`);
      continue;
    }
    // 1 is the floor, matching gradeSubmissionSchema's `stars: 1..5`: zero stars
    // is "not rated", and "not rated" is what the missing-value branch above
    // reports. Allowing 0 here would make the two states indistinguishable.
    if (value < 1 || value > criterion.maxPoints) {
      issues.push(`"${criterion.name}" must be between 1 and ${criterion.maxPoints} stars.`);
      continue;
    }
    scores[criterion.key] = value;
  }

  if (issues.length > 0) return { ok: false, scores: {}, total: 0, issues };
  return { ok: true, scores, total: sumRubricScores(scores), issues: [] };
}

/** Sum of scores. Non-numeric values contribute nothing rather than NaN. */
export function sumRubricScores(scores: Record<string, unknown>): number {
  let total = 0;
  for (const value of Object.values(scores)) {
    const n = Number(value);
    if (Number.isFinite(n)) total += n;
  }
  return Math.round(total);
}

/**
 * Stored scores, projected onto a rubric for display.
 *
 * Criteria the stored blob has no score for are returned with `score: null` rather
 * than omitted, so a reviewee reading a review written under an older rubric sees
 * "not scored" instead of a shorter list that looks complete.
 */
export interface RubricScoreLine {
  key: string;
  name: string;
  score: number | null;
  maxPoints: number;
}

export function toRubricScoreLines(
  criteria: readonly RubricCriterion[],
  stored: unknown,
): RubricScoreLine[] {
  const record =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  return criteria.map((criterion) => {
    const raw = Number(record[criterion.key]);
    const score = Number.isFinite(raw)
      ? Math.min(criterion.maxPoints, Math.max(0, Math.trunc(raw)))
      : null;
    return { key: criterion.key, name: criterion.name, score, maxPoints: criterion.maxPoints };
  });
}
