// =============================================================================
// GET /api/practice-problems/:problemId/hints  —  "student"
// Feature flag: learningEnhancements
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THE LADDER IS METERED SERVER-SIDE, and that is the whole reason this endpoint
// exists instead of the detail payload carrying `hints` outright.
//
// A client-side "reveal one more hint" over an array it already holds is a
// progress bar, not a gate: the second hint is in the response body from the
// first render. Metering here means each rung is a request the student chose to
// make. It is not a SECURITY boundary — hints are teaching material, and a
// determined student can call this endpoint with `upTo=10` — and pretending
// otherwise would be dishonest. What it buys is that the default path through
// the UI cannot accidentally show the whole ladder, and that a future stream
// which DOES want to record hint consumption has one call site to instrument.
//
// NOTHING IS RECORDED. `practice_problems` has no attempts ledger (see the
// contrast with `coding_problems` in schema.learning.ts), so there is nowhere to
// write "this student opened hint 3". Stated plainly so nobody builds a
// participation metric on the assumption that it is.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { practiceProblems } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { hintsUpTo, maxHintLevel } from "@/lib/learning/projection";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches `hintSchema.level` in src/lib/learning/schemas.ts. */
const MAX_HINT_LEVEL = 10;

/**
 * Reveal hints up to a level.
 *
 * @param request query: `upTo` — 1..10, defaults to 1 so a caller that forgets
 *        the parameter gets the FIRST hint rather than all of them. Defaulting
 *        the other way would undo the metering with a typo.
 * @param ctx     path: `problemId`
 * @returns 200 `{ problemId, hints: [{level, text}], revealedUpTo, maxLevel,
 *          hasMore }` — `hasMore` so the client can hide the button rather than
 *          discover the end by requesting an empty array
 * @throws 404 flag off, or no such problem
 * @throws 401 not signed in
 * @throws 422 `upTo` is not an integer in 1..10
 * @throws 400 `problemId` is not a positive integer
 */
export async function GET(
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

  const rawUpTo = new URL(request.url).searchParams.get("upTo");
  let upTo = 1;
  if (rawUpTo !== null) {
    if (!/^\d+$/.test(rawUpTo)) {
      return apiError(422, "upTo must be a positive integer.", "invalid_up_to");
    }
    upTo = Number(rawUpTo);
    if (upTo < 1 || upTo > MAX_HINT_LEVEL) {
      return apiError(422, `upTo must be between 1 and ${MAX_HINT_LEVEL}.`, "invalid_up_to");
    }
  }

  // Only the hints column. The rest of the row — including the solution — is not
  // part of this question and so is not selected.
  const [row] = await db
    .select({ id: practiceProblems.id, hints: practiceProblems.hints })
    .from(practiceProblems)
    .where(eq(practiceProblems.id, problemId))
    .limit(1);

  if (!row) return apiError(404, "Practice problem not found.", "not_found");

  const maxLevel = maxHintLevel(row.hints);
  return apiOk({
    problemId: row.id,
    hints: hintsUpTo(row.hints, upTo),
    revealedUpTo: Math.min(upTo, maxLevel),
    maxLevel,
    hasMore: upTo < maxLevel,
  });
}
