// =============================================================================
// POST /api/learn/steps/:stepId/complete — owned by the interactive-learning stream.
// -----------------------------------------------------------------------------
// Contract: `ROUTES["POST /api/learn/steps/:stepId/complete"]`, `ROUTE_AUTH` =
// "student". The path is taken verbatim from the frozen route map; this stream
// declared no routes of its own.
//
// SECURITY. The student id comes from the SESSION only. There is no `studentId`
// field in the body and there will not be one: accepting it would let any signed-
// in user write progress rows against a classmate. The step id, in contrast, DOES
// come from the URL — so it is validated as (a) an integer and (b) belonging to a
// PUBLISHED module, which `findPublishedStep` enforces in SQL. A guessed id
// inside a draft module is refused with 404, the same answer a nonexistent id
// gets, so the response cannot be used to probe for unreleased content.
//
// IDEMPOTENT BY CONTRACT. Two identical POSTs produce one row and both return
// 200. `created` distinguishes them for the caller without turning a repeat into
// an error — the client fires this on step advance, and a double-click must not
// surface a failure.
// =============================================================================

import { ROUTE_AUTH } from "@/lib/contracts/api";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { completeStep } from "@/lib/learn/complete";

/** Pulled from the frozen map so the route and the contract cannot drift. */
const REQUIRED_AUTH = ROUTE_AUTH["POST /api/learn/steps/:stepId/complete"];

// A write endpoint; nothing here is cacheable.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RouteContext {
  params: Promise<{ stepId: string }>;
}

/**
 * Read `answerIndex` out of the body, tolerating no body at all.
 *
 * Most calls carry nothing (an `explain` or `lab` step just completes), so an
 * absent or unparseable body is normal rather than an error. Anything that is not
 * a non-negative integer becomes undefined and the step completes ungraded.
 */
async function readAnswerIndex(request: Request): Promise<number | undefined> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const raw = (parsed as { answerIndex?: unknown }).answerIndex;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return undefined;
  return raw;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  const { stepId: rawStepId } = await context.params;
  const stepId = Number(rawStepId);
  if (!Number.isInteger(stepId) || stepId <= 0) {
    return apiError(400, "That is not a valid step id.", "invalid_step_id");
  }

  const answerIndex = await readAnswerIndex(request);

  const result = await completeStep({ studentId: gate.user.id, stepId, answerIndex });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return apiError(404, result.message, "step_not_found");
    }
    if (result.reason === "invalid_step") {
      return apiError(400, result.message, "invalid_step_id");
    }
    return apiError(500, result.message, "learn_progress_write_failed");
  }

  return apiOk({
    created: result.created,
    stepId: result.stepId,
    moduleId: result.moduleId,
    progress: result.progress,
    announcement: result.announcement,
    check: result.check,
  });
}
