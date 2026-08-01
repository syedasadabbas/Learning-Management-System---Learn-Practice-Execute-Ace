// =============================================================================
// GET /api/classes/upcoming  —  "student"
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// WHY THIS IS NOT `GET /api/classes?status=scheduled`.
//
// Two things differ, and both are scoped by the CALLER rather than by a filter
// value a client supplies:
//
//   1. AN ACTIVE CLASS IS "UPCOMING". A session that started ten minutes ago is
//      the one a student most needs to see, and it has status `active`, not
//      `scheduled`. A client filtering on `status=scheduled` misses exactly the
//      class that is happening right now.
//   2. AN INSTRUCTOR SEES THEIR OWN. For staff this is "my next sessions"; for a
//      student it is "sessions I can attend". Expressing that as a query
//      parameter would let a student pass `instructorId=...` and get a personal
//      teaching schedule, which is the sort of thing that is never a hole until
//      it is.
//
// The window is a bounded look-ahead rather than "everything in the future", so
// the response is a screenful and not the whole term.
//
// STATIC SEGMENT: `/api/classes/upcoming` is matched by the App Router before
// `/api/classes/[classId]`, so this route shadows the id `"upcoming"` — which
// `parsePositiveInt` would have rejected anyway.
// =============================================================================

import { and, asc, count, eq, gte, lte, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { paginated, parsePage } from "@/lib/learning/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Default look-ahead, in DAYS.
 *
 * 14 covers "the rest of this fortnight", which is the horizon a student plans
 * over. Beyond that the list stops being a to-do and becomes a calendar, and the
 * calendar is what the unfiltered `GET /api/classes` is for.
 */
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 90;

/**
 * Sessions the caller should be looking at, soonest first.
 *
 * @param request query: `days` (1..90, default 14), `limit` (1..100, default 20),
 *        `offset`
 * @returns 200 `{ items, limit, offset, total }`. Items are classes that are
 *          either `active` right now, or `scheduled` between now and the end of
 *          the window. Instructors and admins see only their OWN classes;
 *          students see every non-archived class in the window.
 * @throws 404 the feature flag is off
 * @throws 401 not signed in
 * @throws 422 `days` is out of range, or a bad page window
 *
 * COHORT SCOPING IS NOT APPLIED and that is a known gap, stated rather than
 * hidden: `live_classes` hangs off a WEEK, and weeks are not cohort-scoped in
 * this schema, so there is no column to filter a student's classes by their
 * cohort. Every student sees every class in the window. When cohorts become
 * concurrent (DECISIONS.md lists `concurrentCohorts: false` as the current
 * setting) this query needs a join that does not exist yet.
 */
export async function GET(request: Request): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;

  const pageResult = parsePage(params);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const rawDays = params.get("days");
  let windowDays = DEFAULT_WINDOW_DAYS;
  if (rawDays !== null) {
    if (!/^\d+$/.test(rawDays)) {
      return apiError(422, "days must be a positive integer.", "invalid_days");
    }
    windowDays = Number(rawDays);
    if (windowDays < 1 || windowDays > MAX_WINDOW_DAYS) {
      return apiError(422, `days must be between 1 and ${MAX_WINDOW_DAYS}.`, "invalid_days");
    }
  }

  // UTC throughout — `scheduled_at` is `timestamptz` and `Date` is an instant,
  // so no zone conversion happens anywhere in this comparison.
  const now = new Date();
  const until = new Date(now.getTime() + windowDays * 86_400_000);

  const upcomingWindow = or(
    // Happening now. Included regardless of the window: a class that started
    // before `now` still needs to appear, and `scheduled_at >= now` would drop it.
    eq(liveClasses.status, "active"),
    and(
      eq(liveClasses.status, "scheduled"),
      gte(liveClasses.scheduledAt, now),
      lte(liveClasses.scheduledAt, until),
    ),
  );

  const filters: SQL[] = [eq(liveClasses.isArchived, false)];
  if (upcomingWindow) filters.push(upcomingWindow);

  // Staff see their own schedule; students see the cohort's. Derived from the
  // SESSION, never from a parameter — see the module header.
  const isStaff = gate.user.role === "instructor" || gate.user.role === "admin";
  if (isStaff) {
    filters.push(eq(liveClasses.instructorId, gate.user.id));
  }

  const where = and(...filters);

  const [items, [totals]] = await Promise.all([
    db
      .select({
        id: liveClasses.id,
        weekId: liveClasses.weekId,
        lectureId: liveClasses.lectureId,
        instructorId: liveClasses.instructorId,
        instructorName: users.name,
        title: liveClasses.title,
        description: liveClasses.description,
        scheduledAt: liveClasses.scheduledAt,
        durationMinutes: liveClasses.durationMinutes,
        status: liveClasses.status,
        allowChat: liveClasses.allowChat,
        allowQa: liveClasses.allowQa,
        attendanceCount: liveClasses.attendanceCount,
        startedAt: liveClasses.startedAt,
      })
      .from(liveClasses)
      .innerJoin(users, eq(users.id, liveClasses.instructorId))
      .where(where)
      // Soonest first: this list is a queue, not an archive.
      .orderBy(asc(liveClasses.scheduledAt), asc(liveClasses.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(liveClasses).where(where),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}
