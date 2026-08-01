// =============================================================================
// COMPLETION — DERIVED, never stored. Pure. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// The schema comment on `codingAttempts` (src/db/schema.ts) states the rule and
// the reason, and this file is its only implementation:
//
//     solved(problem, student)  <=>  EXISTS an attempt row for that pair with
//                                   total_count > 0 AND passed_count = total_count
//
// There is no `solved` column and there must never be one. The precedent is
// `src/lib/progress/unlock.ts`, which refuses to read `progress.week_unlocked` as
// a source of truth for the same reason: a stored mirror of a computed fact is a
// second source of truth, and its failure mode is the one that matters — a flag
// reading "solved" when no passing run exists. A derived predicate cannot drift,
// because there is nothing for it to drift from.
//
// `total_count > 0` is load-bearing. A problem whose tests were deleted, or a
// row written before its tests existed, yields 0 = 0, and without the guard that
// arithmetic would report every such problem as solved for every student.
// =============================================================================

/** The two columns the predicate reads. Structural, so tests need no DB row. */
export interface AttemptCounts {
  problemId: number;
  passedCount: number;
  totalCount: number;
}

/** Did this single run pass every test it ran? */
export function attemptPassed(attempt: Pick<AttemptCounts, "passedCount" | "totalCount">): boolean {
  return attempt.totalCount > 0 && attempt.passedCount === attempt.totalCount;
}

/**
 * Is this problem solved, given this student's runs against it?
 *
 * ANY passing run counts, not the latest. A student who solves a problem and then
 * breaks their code while experimenting has still solved it; making the newest
 * attempt authoritative would punish exactly the behaviour practice is for.
 */
export function isSolved(attempts: readonly AttemptCounts[], problemId: number): boolean {
  return attempts.some((a) => a.problemId === problemId && attemptPassed(a));
}

/** The set of problem ids this student has solved. One pass over the rows. */
export function solvedProblemIds(attempts: readonly AttemptCounts[]): Set<number> {
  const solved = new Set<number>();
  for (const attempt of attempts) {
    if (attemptPassed(attempt)) solved.add(attempt.problemId);
  }
  return solved;
}

/** How many runs this student has recorded per problem. */
export function attemptCountsByProblem(attempts: readonly AttemptCounts[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const attempt of attempts) {
    counts.set(attempt.problemId, (counts.get(attempt.problemId) ?? 0) + 1);
  }
  return counts;
}
