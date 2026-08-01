// =============================================================================
// POST /api/exams/:attemptId/answer  —  ROUTE_AUTH: "student"
// Owner: grand-quiz stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// (See ../start/route.ts for why the folder slug is `[id]` rather than
// `[attemptId]`.)
// -----------------------------------------------------------------------------
// The autosave endpoint. Called every time a student changes a selection or stops
// typing in a code editor, which on a 50-question 120-minute exam is a lot of
// calls — so it is deliberately tiny: one upsert, no grading, no scoring.
//
// TWO REFUSALS THAT ARE NOT BUGS (invariant I3):
//   409 attempt_terminal — the exam is submitted. An answer written after that
//                          would be a mark recorded after the exam closed.
//   409 attempt_expired  — the clock ran out. The countdown in the browser may
//                          disagree; the STORED deadline and the SERVER clock
//                          decide (I2), and nothing in this request body can
//                          influence that — there is no timing field in the
//                          schema to send one in.
//
// OWNERSHIP is in the query predicate, not a post-hoc check: `selectAttempt`
// filters on `student_id`, so a student POSTing somebody else's attempt id gets
// 404 rather than writing into their exam.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { saveExamAnswer } from "@/lib/grand-quiz";
import { examAnswerSchema, firstIssue } from "@/lib/grand-quiz/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 409 for the two terminal refusals: the request is well-formed and authorised,
 * it conflicts with recorded state. 400 for a malformed target — that is a client
 * bug, not a state conflict.
 */
const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  attempt_terminal: 409,
  attempt_expired: 409,
  unknown_question: 400,
  option_not_in_question: 400,
  wrong_answer_shape: 400,
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  // The `[id]` segment is an ATTEMPT id on this route.
  const { id: rawAttemptId } = await ctx.params;
  const attemptId = parsePositiveInt(rawAttemptId);
  if (attemptId === null) {
    return apiError(400, "attemptId must be a positive integer.", "invalid_attempt_id");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = examAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, firstIssue(parsed.error), "invalid_body");
  }

  const outcome = await saveExamAnswer({
    attemptId,
    studentId: gate.user.id,
    questionId: parsed.data.questionId,
    // `undefined` means "leave this field alone"; `null` means "clear it". The
    // service normalises both, so the distinction stops here.
    ...(parsed.data.selectedOptionId === undefined
      ? {}
      : { selectedOptionId: parsed.data.selectedOptionId }),
    ...(parsed.data.codeAnswer === undefined ? {} : { codeAnswer: parsed.data.codeAnswer }),
  });

  if (!outcome.ok) {
    return apiError(STATUS_FOR[outcome.code] ?? 400, outcome.error, outcome.code);
  }
  return apiOk(outcome.data);
}
