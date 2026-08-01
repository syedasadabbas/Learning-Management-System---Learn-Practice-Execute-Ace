// =============================================================================
// GET /api/badges  —  guard: "student" ("signed in", any role)
// Owner: badges stream. Roadmap: IMPLEMENTATION_ROADMAP.md:262 ("Badge CRUD").
// -----------------------------------------------------------------------------
// READ-ONLY, AND THERE IS NO C, U OR D. The roadmap asks for "Badge CRUD" against a
// `badges` definitions table; this build has no such table, because the catalogue
// lives in code — src/db/schema.badges.ts:29-64 sets out that argument in full, and
// src/lib/badges/catalogue.ts:56-63 records what an admin surface would need
// decided first. Writing to a TypeScript constant over HTTP is not a thing, so a
// POST/PATCH/DELETE here could only ever have been a stub that returned 501. It is
// absent instead: Next's App Router answers an unimplemented method with 405
// automatically, which is the honest answer.
//
// What it IS good for: a client that wants the catalogue without a session's award
// state (a marketing page, a future admin read-only view, or an e2e test asserting
// the catalogue matches the code). Guarded at "student" — i.e. signed in — rather
// than public, because "which achievements exist and what are their thresholds" is
// course content and this app has no anonymous surface for course content.
//
// See src/app/api/me/badges/route.ts:12-24 for why neither badges route appears in
// `ROUTES`, and the TODO(shared-contracts) that names the two lines to add.
// =============================================================================

import { BADGE_LIST } from "@/lib/badges";
import { apiError, apiGuard, apiOk } from "@/lib/guard";

export const runtime = "nodejs";
// The catalogue is a compile-time constant, so this response is genuinely static —
// but the GUARD is per-session, and a cached response would be served to a caller
// whose session had since expired. `force-dynamic` for the auth check, not the data.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  try {
    // Spread into a new array so a caller mutating the response body cannot reach
    // the module-level constant every other request shares.
    return apiOk({ badges: [...BADGE_LIST] });
  } catch (error) {
    console.error("[badges] GET /api/badges failed", error);
    return apiError(500, "Could not load the badge catalogue.", "badges_catalogue_failed");
  }
}
