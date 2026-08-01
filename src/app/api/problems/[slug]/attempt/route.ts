// =============================================================================
// POST /api/problems/:slug/attempt  —  ROUTE_AUTH: "student"
// -----------------------------------------------------------------------------
// Owner: coding-problems stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
//
// Body: { "code": "<the student's program>" }
//
// THE CLIENT DOES NOT REPORT A RESULT, AND MUST NOT.
// An earlier shape for this route accepted `passedCount` / `totalCount` from the
// browser, because the browser had just run the visible tests anyway. That makes
// `coding_attempts` a table of claims: the execution stream's contract states
// plainly that a browser result "was produced on the student's machine and can be
// forged". Since completion is DERIVED from these rows, a forged pass count is a
// forged "solved". So this handler ignores anything in the body except `code`, and
// the server re-runs every test itself.
//
// A `graded: false` outcome is a 200 with a truthful body, not an error status: the
// request was well-formed and authorized, and the client needs to distinguish
// "Piston is rate-limited, try again in a moment" from "your code is wrong". A 500
// would collapse those two into one.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { gradeAndRecordAttempt } from "@/lib/problems/service";
import { MAX_SOURCE_CHARS } from "@/lib/execution/truncate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const { slug } = await ctx.params;
  if (typeof slug !== "string" || slug.trim() === "") {
    return apiError(400, "A problem slug is required.", "invalid_slug");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Body must be JSON.", "invalid_body");
  }

  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code.trim() === "") {
    return apiError(400, "Send the code you want graded as a non-empty `code` string.", "missing_code");
  }
  if (code.length > MAX_SOURCE_CHARS) {
    // Refused rather than truncated: grading a program we silently cut in half
    // produces a failure the student cannot explain.
    return apiError(
      413,
      `Your program is longer than ${MAX_SOURCE_CHARS} characters and was not graded.`,
      "source_too_long",
    );
  }

  const outcome = await gradeAndRecordAttempt({ slug, studentId: gate.user.id, code });
  return apiOk(outcome);
}
