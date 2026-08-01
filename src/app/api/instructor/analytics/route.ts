// =============================================================================
// GET /api/instructor/analytics  —  ROUTE_AUTH: "instructor"
// -----------------------------------------------------------------------------
// Pass rates, quiz score distribution, submission and completion rates, at-risk
// students. Aggregated in Postgres (see @/lib/instructor/analytics); this handler
// only guards, parses ?cohort=, and serialises.
//
// ZERO DENOMINATORS. Each rate is serialised as
// `{ numerator, denominator, percent }` with `percent: null` when the denominator
// is zero, so the client renders "no data" instead of receiving NaN — which JSON
// cannot represent and `JSON.stringify` would silently turn into `null` anyway,
// making a genuine zero indistinguishable from a missing one. The explicit
// numerator/denominator pair removes that ambiguity.
// =============================================================================

import { apiGuard, apiOk } from "@/lib/guard";
import { authLevelFor } from "@/lib/instructor/access";
import { getCohortAnalytics } from "@/lib/instructor/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_KEY = "GET  /api/instructor/analytics" as const;

export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard(authLevelFor(ROUTE_KEY));
  if (!gate.ok) return gate.response;

  const raw = new URL(request.url).searchParams.get("cohort");
  const parsed = raw === null ? null : Number(raw);
  const cohortId =
    parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  const analytics = await getCohortAnalytics(cohortId);
  return apiOk(analytics);
}
