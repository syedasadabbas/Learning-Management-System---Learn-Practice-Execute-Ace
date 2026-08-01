// =============================================================================
// POST /api/quizzes/:quizId/submit  —  ROUTE_AUTH: "student"
// -----------------------------------------------------------------------------
// Owner: quizzes stream. Path is fixed by ROUTES in src/lib/contracts/api.ts.
//
// This handler is intentionally thin. Validation is `quizSubmitSchema` from the
// frozen contract; everything else — the transaction, the attempt-budget check,
// grading, the unlock, penalties, the scoring event — is `submitQuizAttempt` in
// src/lib/quizzes/service.ts. Splitting it that way is what lets the take-a-quiz
// page and this route share one definition of a graded attempt.
//
// The 4th attempt is refused HERE, on the server, inside the transaction — not
// by hiding a button. Bypassing the UI and POSTing directly gets a 409.
//
// WEEK-LOCK GATE (added at integration).
// Gating only the GET is not enough. Option ids are sequential integers, so a
// student who never fetched a locked week's quiz could still POST plausible
// answers to it — and a passing score would award points, write progress and fire
// a scoring event for a week they had not earned. Both verbs are gated.
// =============================================================================

import { ZodError } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { quizzes } from "@/db/schema";
import { quizSubmitSchema } from "@/lib/contracts/validation";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { gateWeek } from "@/components/course/data";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { submitQuizAttempt } from "@/lib/quizzes/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Maps a service failure to its HTTP status. 409 for the exhausted budget:
 *  the request is well-formed and authorised, it conflicts with recorded state. */
const STATUS_FOR: Record<string, number> = {
  quiz_not_found: 404,
  quiz_empty: 409,
  attempts_exhausted: 409,
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ quizId: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const { quizId: rawQuizId } = await ctx.params;
  const quizId = parsePositiveInt(rawQuizId);
  if (quizId === null) {
    return apiError(400, "quizId must be a positive integer.", "invalid_quiz_id");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = quizSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, firstIssue(parsed.error), "invalid_body");
  }

  // The quiz id appears in both the path and the body. Trusting the body would
  // let a request to /api/quizzes/1/submit grade quiz 4; trusting the path
  // silently would hide a client bug. Mismatch is rejected.
  if (parsed.data.quizId !== quizId) {
    return apiError(
      400,
      "Body quizId does not match the URL.",
      "quiz_id_mismatch",
    );
  }

  // Resolve the quiz's own week and refuse if that week is locked for this
  // student. Deliberately before submitQuizAttempt, so a locked week records no
  // attempt at all rather than one that is then discarded.
  const [owning] = await db
    .select({ weekId: quizzes.weekId })
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);
  if (!owning) {
    return apiError(404, "Quiz not found.", "quiz_not_found");
  }
  const week = await gateWeek(gate.user.id, owning.weekId);
  if (!week.ok) {
    return week.kind === "locked"
      ? apiError(
          403,
          "This week is locked. Pass the previous week's quiz to unlock it.",
          "week_locked",
        )
      : apiError(404, "Quiz not found.", "quiz_not_found");
  }

  const outcome = await submitQuizAttempt({
    quizId,
    studentId: gate.user.id,
    cohortId: gate.user.cohortId,
    submitted: parsed.data.answers,
  });

  if (!outcome.ok) {
    return apiError(STATUS_FOR[outcome.code] ?? 400, outcome.error, outcome.code);
  }

  return apiOk(outcome.data, 201);
}

function firstIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid submission.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
