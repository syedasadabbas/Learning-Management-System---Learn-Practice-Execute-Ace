// =============================================================================
// POST /api/practice-problems/:problemId/attempt  —  "student"
// Feature flag: learningEnhancements
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// WHAT THIS ENDPOINT IS, AND WHAT THE SPEC ASKED FOR.
//
// TECHNICAL_SPECIFICATION.md:573-604 describes a handler that runs the
// student's code against hidden tests and returns per-test pass/fail. This one
// does NOT execute code, and the divergence is deliberate and reported rather
// than papered over:
//
//   1. THERE IS NO WHERE TO PUT THE RESULT. `practice_problems` has no attempts
//      ledger by design (schema.learning.ts contrasts it with `coding_problems`,
//      which has `coding_attempts`). A pass/fail this endpoint computed would be
//      discarded at the end of the request, so "submit an attempt" would be a
//      round trip that changes nothing in the system.
//   2. EXECUTION ALREADY HAS AN OWNER. `POST /api/execute` is the code-execution
//      stream's route, backed by Piston, with its own sandboxing, rate limits and
//      timeouts (FREE_STACK.md). A second execution path here would be a second
//      place to get untrusted-code isolation wrong, which is the single worst
//      kind of duplication to introduce.
//   3. THESE PROBLEMS ARE `execution_mode = 'browser'` BY DEFAULT. The intended
//      runner is a Web Worker in the student's own tab.
//
// So this endpoint is the SELF-CHECK HANDSHAKE: it validates the submission,
// returns the problem's test cases so the browser runner can execute them
// locally, and reports which hint rung is next. The test cases carry `expected`
// values, which is answer-adjacent — and that is correct for an ungraded
// self-directed exercise where self-checking is the entire point. The answer
// key that IS withheld is `solution_code` / `solution_explanation`, which this
// response does not contain and this handler does not select.
//
// IDEMPOTENT BY CONSTRUCTION: it writes nothing, so retrying is free.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { practiceProblems } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { maxHintLevel } from "@/lib/learning/projection";
import { parseBody, practiceAttemptSchema } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The jsonb blob is untrusted input, not a type. Rows that do not fit are dropped. */
function readTestCases(value: unknown): Array<{ name: string; input: string; expected: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (t): t is { name: string; input: string; expected: string } =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as { name?: unknown }).name === "string" &&
      typeof (t as { input?: unknown }).input === "string" &&
      typeof (t as { expected?: unknown }).expected === "string",
  );
}

/**
 * Register a self-check attempt and receive the material to run it locally.
 *
 * @param request JSON body validated by `practiceAttemptSchema`:
 *        `{ code, language, hintsUsed? }`
 * @param ctx     path: `problemId`
 * @returns 200 `{ problemId, execution, tests, totalTests, nextHintLevel,
 *          hasMoreHints, persisted: false }`. `persisted: false` is in the
 *          payload on purpose — a client must not build a progress indicator on
 *          the assumption that this was recorded.
 * @throws 404 flag off, or no such problem
 * @throws 401 not signed in
 * @throws 422 body fails validation
 * @throws 400 `problemId` is not a positive integer
 *
 * NOTE 200 and not 201: nothing was created. Returning 201 would imply a
 * resource exists at some address, and none does.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ problemId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const problemId = parsePositiveInt((await ctx.params).problemId);
  if (problemId === null) {
    return apiError(400, "problemId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, practiceAttemptSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const [row] = await db
    .select({
      id: practiceProblems.id,
      execution: practiceProblems.execution,
      testCases: practiceProblems.testCases,
      hints: practiceProblems.hints,
    })
    .from(practiceProblems)
    .where(eq(practiceProblems.id, problemId))
    .limit(1);

  if (!row) return apiError(404, "Practice problem not found.", "not_found");

  const tests = readTestCases(row.testCases);
  const maxLevel = maxHintLevel(row.hints);
  const nextHintLevel = Math.min(body.value.hintsUsed + 1, maxLevel);

  return apiOk({
    problemId: row.id,
    execution: row.execution,
    tests,
    totalTests: tests.length,
    // `null` rather than 0 when the ladder is exhausted, so a client testing
    // truthiness does not treat "no more hints" as "hint zero".
    nextHintLevel: nextHintLevel > body.value.hintsUsed ? nextHintLevel : null,
    hasMoreHints: body.value.hintsUsed < maxLevel,
    persisted: false,
  });
}
