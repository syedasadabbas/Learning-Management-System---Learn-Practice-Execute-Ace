// =============================================================================
// GET  /api/presentations  —  "student"
// POST /api/presentations  —  "student"
// Feature flag: presentations
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// A DECK IS STUDENT-OWNED WORK, so "student" as the auth level is the floor and
// the real decision is per row: `readableFilter` in ./_access.ts. Authorizing by
// role alone would let any signed-in student list every other student's
// unpublished coursework.
//
// THE LIST NEVER RETURNS `slides_json`. It is the whole editor document — up to
// 500 slides of text, code and base64 nothing-in-particular — and a gallery page
// that ships one per card is megabytes of JSON to render thumbnails. The list
// carries `slideCount` instead, counted from the projection table.
// =============================================================================

import { and, count, desc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { presentationSlides, presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { parseBody } from "@/lib/learning/schemas";
import { emptyDeck } from "@/lib/presentations/types";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { readableFilter, slideProjectionRow } from "./_access";
import { createPresentationSchema } from "./_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List decks the caller may see.
 *
 * @param request query: `mine` ("true" restricts to the caller's own),
 *        `templates` ("true" restricts to reusable templates),
 *        `assignmentId`, `limit` (1..100, default 20), `offset`
 * @returns 200 `{ items, limit, offset, total }`. Each item carries metadata,
 *          the creator's name and `slideCount` — never `slidesJson`.
 * @throws 404 the feature flag is off
 * @throws 401 not signed in
 * @throws 422 a bad page window or a malformed `assignmentId`
 */
export async function GET(request: Request): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;
  const pageResult = parsePage(params);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const filters: SQL[] = [];

  // The visibility clause. `undefined` for staff, who may read every deck.
  const visible = readableFilter(gate.user);
  if (visible) filters.push(visible);

  if (params.get("mine")?.trim() === "true") {
    filters.push(eq(presentations.creatorId, gate.user.id));
  }
  if (params.get("templates")?.trim() === "true") {
    filters.push(eq(presentations.isTemplate, true));
  }

  const rawAssignment = params.get("assignmentId");
  if (rawAssignment !== null) {
    const assignmentId = parsePositiveInt(rawAssignment);
    if (assignmentId === null) {
      return apiError(422, "assignmentId must be a positive integer.", "invalid_id");
    }
    filters.push(eq(presentations.assignmentId, assignmentId));
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [items, [totals]] = await Promise.all([
    db
      .select({
        id: presentations.id,
        creatorId: presentations.creatorId,
        creatorName: users.name,
        assignmentId: presentations.assignmentId,
        relatedClassId: presentations.relatedClassId,
        title: presentations.title,
        description: presentations.description,
        theme: presentations.theme,
        isPublished: presentations.isPublished,
        isTemplate: presentations.isTemplate,
        isPublic: presentations.isPublic,
        viewCount: presentations.viewCount,
        presentationCount: presentations.presentationCount,
        createdAt: presentations.createdAt,
        updatedAt: presentations.updatedAt,
        publishedAt: presentations.publishedAt,
        // A correlated subquery rather than a join + group by: the alternative
        // would collapse the deck row across its slides and force a GROUP BY on
        // every column above.
        slideCount: sql<number>`(
          select count(*)::int from ${presentationSlides}
          where ${presentationSlides.presentationId} = ${presentations.id}
        )`,
      })
      .from(presentations)
      .innerJoin(users, eq(users.id, presentations.creatorId))
      .where(where)
      .orderBy(desc(presentations.updatedAt), desc(presentations.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(presentations).where(where),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Create a deck.
 *
 * Transactional, because two tables are written: `presentations` (the editor
 * document) and `presentation_slides` (its queryable projection). The order is
 * load-bearing and is the rule DECISIONS.md records — `slides_json` is the
 * source of truth and the projection is derived FROM it, so it is written first
 * and the rows are built from what was stored.
 *
 * THE CREATOR IS THE SESSION. `createPresentationSchema` has no `creatorId`.
 *
 * @param request JSON body validated by `createPresentationSchema`; `deck` is
 *        optional and defaults to `emptyDeck()` from the canonical contract, so
 *        the API and the editor's "new presentation" produce identical JSON
 * @returns 201 the created deck, with `id`
 * @throws 404 the feature flag is off
 * @throws 401 not signed in
 * @throws 422 body fails validation (including a malformed slide, reported with
 *          its field path by the canonical `slideDeckSchema`), or the named
 *          assignment / class does not exist
 */
export async function POST(request: Request): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const body = await parseBody(request, createPresentationSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const deck = body.value.deck ?? emptyDeck();

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(presentations)
        .values({
          creatorId: gate.user.id,
          assignmentId: body.value.assignmentId ?? null,
          relatedClassId: body.value.relatedClassId ?? null,
          title: body.value.title,
          description: body.value.description,
          theme: body.value.theme,
          slidesJson: deck,
          // Unpublished, and `published_at` therefore null — the CHECK
          // `(published_at IS NOT NULL) = is_published` requires the pair.
        })
        .returning();

      if (deck.slides.length > 0) {
        await tx.insert(presentationSlides).values(
          // One shared mapper, so the three write paths cannot disagree about
          // how a slide lands in the projection table.
          deck.slides.map((slide) => slideProjectionRow(row.id, slide)),
        );
      }

      return row;
    });

    return apiOk(created, 201);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 422) {
      return apiError(422, "The assignment or class named does not exist.", "unknown_parent");
    }
    if (status) {
      return apiError(status, "The presentation was rejected by the database.", "db_rejected");
    }
    throw error;
  }
}
