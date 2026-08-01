// =============================================================================
// GET /api/presentations/:presentationId/theme  —  "student" (visibility-scoped)
// PUT /api/presentations/:presentationId/theme  —  "student" (creator or admin)
// Feature flag: presentations
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// A ONE-FIELD ROUTE, and it earns its existence twice over. The theme picker
// changes a single varchar and nothing else; routing it through
// PUT /api/presentations/:id would make the client send — and this server
// rewrite — the entire `slides_json` document to change a colour scheme, which
// on a 500-slide deck is megabytes per click and a window in which a concurrent
// editor's save is overwritten by a stale document.
//
// THE THEME NAME IS NOT VALIDATED AGAINST A REGISTRY, and that is a stated gap
// rather than an oversight. `src/lib/presentations/theme.ts` (the Reveal.js
// stream's file, which this stream does not own) exports colour helpers but no
// enumeration of known theme keys, so there is nothing to check against. The
// consequence: a typo'd theme is stored, Reveal silently ignores it, and the
// author sees "my theme setting does nothing" with no error anywhere — the same
// failure the canonical slide contract calls out for transitions and solves by
// enumerating them.
//
// TODO(presentations): when that module exports a `PRESENTATION_THEMES` list,
// import it and reject anything outside it with a 422. The column stays a free
// varchar either way, so a theme can still ship without a migration; the check
// belongs at this layer, which is updated in the same commit as the theme.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { readableFilter, writableFilter } from "../../_access";
import { themeSchema } from "../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ presentationId: string }> };

/**
 * Read a deck's presentation settings.
 *
 * @returns 200 `{ theme, showSpeakerNotes, showSlideNumbers, allowExport }` —
 *          the render-time settings as a group, because a viewer needs all four
 *          before it can mount Reveal and fetching them one at a time is three
 *          extra round trips before the first slide paints
 * @throws 404 flag off, no such deck, or a deck this caller may not see
 * @throws 401 not signed in
 * @throws 400 `presentationId` is not a positive integer
 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const [row] = await db
    .select({
      theme: presentations.theme,
      showSpeakerNotes: presentations.showSpeakerNotes,
      showSlideNumbers: presentations.showSlideNumbers,
      allowExport: presentations.allowExport,
    })
    .from(presentations)
    .where(and(eq(presentations.id, presentationId), readableFilter(gate.user)))
    .limit(1);

  if (!row) return apiError(404, "Presentation not found.", "not_found");
  return apiOk(row);
}

/**
 * Change a deck's theme.
 *
 * @param request JSON body `{ theme: string }`
 * @returns 200 `{ theme }`
 * @throws 404 flag off, no such deck, or the caller is not its creator
 * @throws 401 not signed in
 * @throws 422 body fails validation
 * @throws 400 `presentationId` is not a positive integer
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, themeSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const [row] = await db
    .update(presentations)
    .set({ theme: body.value.theme, updatedAt: new Date() })
    .where(and(eq(presentations.id, presentationId), writableFilter(gate.user)))
    .returning({ theme: presentations.theme });

  if (!row) return apiError(404, "Presentation not found.", "not_found");
  return apiOk(row);
}
