// =============================================================================
// COURSE-CONTENT SERVER READS + THE GATE.
// -----------------------------------------------------------------------------
// Owner: course-content stream. Server-only (imports the Drizzle client).
//
// WHY THIS FILE LIVES UNDER components/course/ RATHER THAN lib/
// Parallel-stream file ownership: this stream owns `src/components/course/**`,
// its four API routes, and `src/app/(app)/weeks/**`, and nothing else. Putting
// the shared query layer here keeps ONE implementation behind both the pages and
// the route handlers instead of two that can disagree about who may read what.
//
// THE SECURITY PROPERTY THIS FILE EXISTS TO GUARANTEE
// Hiding a link is not access control. Every read of week or lecture content goes
// through `gateWeek`/`gateLecture` below, which resolve the student's own lock
// state from `getWeekProgress` and refuse locked content. A student who types
// /weeks/3/lectures/9 or curls /api/lectures/9 gets the same refusal as a student
// who never saw the link.
// =============================================================================

// -----------------------------------------------------------------------------
// PERFORMANCE NOTE — WHY EVERY READ BELOW IS WRAPPED IN React `cache()`
//
// Measured against the live Neon instance (scripts/perf-probe.ts): a bare
// `SELECT 1` costs ~257 ms warm and ~2 s cold. Nothing here is slow because of
// query complexity — `fetchWeekAggregates` returns four rows in ~240 ms, which
// IS the round trip. Page latency is therefore round-trip COUNT multiplied by
// ~257 ms, and the only fix that matters is issuing fewer of them.
//
// Two changes, neither of which alters a single result:
//
//   1. `cache()` — React's per-request memoisation. `gateWeek` calls
//      `getWeekList`, and several pages then call `getWeekList` AGAIN on the
//      locked branch, so the identical week+progress read was being paid for
//      twice in one render. /weeks/:id was 4 round trips where 2 were enough.
//      The cache is scoped to a single request, so no student ever sees another
//      student's rows and a quiz submitted in one request is visible in the next.
//
//   2. `loadCourseAndWeeks` — one statement instead of two SEQUENTIAL ones. The
//      old shape was `getActiveCourse()` and only THEN `getWeekSummaries(id)`,
//      because the second needed the first's id: an unavoidable serial pair,
//      ~514 ms before a row of progress was even requested. Joining the weeks to
//      the lowest-id course removes the data dependency, so the course, its
//      weeks and the student's progress now all resolve in ONE round trip via
//      the Promise.all in getWeekList.
//
// Net on /weeks: 3 sequential round trips -> 1. On /weeks/:weekId: 5 -> 2.
// -----------------------------------------------------------------------------

import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
// `weeks` and `courses` are no longer imported: loadCourseAndWeeks names those
// tables in raw SQL (see the note above it). `lectures` is still queried through
// the builder in getLectureSummaries.
import { lectures } from "@/db/schema";
import { getWeekProgress } from "@/lib/progress/read-model";

import { deriveWeekLockStates, type WeekLockState } from "./lock-state";
import { linkResourcesFrom } from "./resources";
import { extractYouTubeId } from "./youtube";

// ---------------------------------------------------------------------------
// Row shapes returned to pages and serialised by the API routes
// ---------------------------------------------------------------------------

export interface CourseSummary {
  id: number;
  title: string;
  description: string | null;
  durationWeeks: number;
}

export interface WeekSummary {
  id: number;
  weekNumber: number;
  title: string;
  description: string | null;
  /** ISO 8601 UTC, or null when no deadline is configured for this week. */
  dueAt: string | null;
  lectureTotal: number;
}

/** A week plus the current student's lock state for it. */
export type WeekListItem = WeekSummary & { lock: WeekLockState };

export interface LectureSummary {
  id: number;
  lectureNumber: number;
  title: string;
  hasVideo: boolean;
  /** Count of external practice links, so the list can show "2 practice links". */
  linkResourceCount: number;
}

export interface LectureDetail {
  id: number;
  weekId: number;
  lectureNumber: number;
  title: string;
  content: string | null;
  youtubeUrl: string | null;
  /**
   * `lectures.topic_key` — the join key to reviewed videos in `topic_videos`.
   * Null means no curated videos are mapped to this lecture yet, and the page
   * falls back to `youtubeUrl` and then to the "Video coming soon" placeholder.
   */
  topicKey: string | null;
  /** Raw jsonb; parse with `linkResourcesFrom` before rendering. */
  resources: unknown;
}

// ---------------------------------------------------------------------------
// Raw reads
// ---------------------------------------------------------------------------

/**
 * The single active course.
 *
 * The schema allows many `courses` rows, but the app is single-course today
 * (appConfig.course) and nothing yet says which one is "current". Lowest id wins,
 * which is the seeded course. TODO(shared-contracts): if a second course is ever
 * seeded this needs an explicit "active course" marker on the row.
 */
/**
 * The active course AND all of its weeks, in ONE round trip.
 *
 * LEFT JOIN, not an inner one: a course seeded with no weeks yet must still
 * resolve as a course with an empty week list, otherwise /weeks would render
 * "no course" and hide a real (if empty) cohort behind a wrong message.
 *
 * The lecture count stays a correlated subquery rather than a second join — a
 * join to `lectures` would multiply the week rows and force a de-duplication
 * pass in JS. It runs inside the same statement, so it costs no extra trip.
 *
 * Memoised per request: `gateWeek` and the page that called it both need this,
 * and it is identical for every student in the cohort.
 */
const loadCourseAndWeeks = cache(async function loadCourseAndWeeks(): Promise<{
  course: CourseSummary | null;
  weeks: WeekSummary[];
}> {
  type Row = {
    courseId: number | string;
    courseTitle: string;
    courseDescription: string | null;
    durationWeeks: number | string;
    weekId: number | string | null;
    weekNumber: number | string | null;
    weekTitle: string | null;
    weekDescription: string | null;
    dueAt: Date | string | null;
    lectureTotal: number | string | null;
  };

  const result = await db.execute(sql`
    WITH active AS (
      SELECT id, title, description, duration_weeks
      FROM courses
      ORDER BY id ASC
      LIMIT 1
    )
    SELECT
      active.id              AS "courseId",
      active.title           AS "courseTitle",
      active.description     AS "courseDescription",
      active.duration_weeks  AS "durationWeeks",
      w.id                   AS "weekId",
      w.week_number          AS "weekNumber",
      w.title                AS "weekTitle",
      w.description          AS "weekDescription",
      w.due_at               AS "dueAt",
      (SELECT count(*)::int FROM lectures l WHERE l.week_id = w.id) AS "lectureTotal"
    FROM active
    LEFT JOIN weeks w ON w.course_id = active.id
    ORDER BY w.week_number ASC
  `);

  // Same driver-shape defence as src/lib/progress/query.ts: node-postgres
  // returns a QueryResult, neon-http returns the rows directly.
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows?: Row[] }).rows ?? []);

  const first = rows[0];
  if (!first) return { course: null, weeks: [] };

  const course: CourseSummary = {
    id: Number(first.courseId),
    title: String(first.courseTitle),
    description: first.courseDescription,
    durationWeeks: Number(first.durationWeeks),
  };

  // The LEFT JOIN yields one all-null week row for a course with no weeks.
  const weekRows = rows.filter((r) => r.weekId != null);

  return {
    course,
    weeks: weekRows.map((r) => ({
      id: Number(r.weekId),
      weekNumber: Number(r.weekNumber),
      title: String(r.weekTitle ?? ""),
      description: r.weekDescription,
      dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
      lectureTotal: Number(r.lectureTotal ?? 0),
    })),
  };
});

/**
 * The single active course.
 *
 * The schema allows many `courses` rows, but the app is single-course today
 * (appConfig.course) and nothing yet says which one is "current". Lowest id wins,
 * which is the seeded course. TODO(shared-contracts): if a second course is ever
 * seeded this needs an explicit "active course" marker on the row.
 */
export async function getActiveCourse(): Promise<CourseSummary | null> {
  return (await loadCourseAndWeeks()).course;
}

/**
 * Every week of a course, ordered, each with its lecture count.
 *
 * Kept for API compatibility. `courseId` is validated against the active course
 * rather than queried separately — asking for a different course's weeks returns
 * empty, which is the same answer the old query gave and costs no round trip.
 */
export async function getWeekSummaries(courseId: number): Promise<WeekSummary[]> {
  const { course, weeks: rows } = await loadCourseAndWeeks();
  return course?.id === courseId ? rows : [];
}

/**
 * Lectures of one week, ordered by the explicit order index then number.
 *
 * Memoised per request: `getLectureNeighbours` and the lecture page both want
 * the same week's list, and that was two identical round trips per render.
 */
export const getLectureSummaries = cache(async function getLectureSummaries(
  weekId: number,
): Promise<LectureSummary[]> {
  const rows = await db
    .select({
      id: lectures.id,
      lectureNumber: lectures.lectureNumber,
      title: lectures.title,
      youtubeUrl: lectures.youtubeUrl,
      topicKey: lectures.topicKey,
      resources: lectures.resources,
    })
    .from(lectures)
    .where(eq(lectures.weekId, weekId))
    .orderBy(asc(lectures.orderIndex), asc(lectures.lectureNumber));

  return rows.map((r) => ({
    id: r.id,
    lectureNumber: r.lectureNumber,
    title: r.title,
    // A lecture "has video" if it either pins one directly OR is mapped to a
    // topic that curated videos exist for. This is deliberately OPTIMISTIC for
    // the topic case: confirming an APPROVED row would cost a second query per
    // lecture on a list page, and the badge is a hint, not a guarantee. The
    // lecture page itself resolves the real answer and still shows the honest
    // placeholder when no video is approved.
    hasVideo: extractYouTubeId(r.youtubeUrl) !== null || r.topicKey != null,
    linkResourceCount: linkResourcesFrom(r.resources).length,
  }));
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type GateFailure =
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "locked"; lock: WeekLockState };

export type WeekGate =
  | { ok: true; week: WeekSummary; lock: WeekLockState; course: CourseSummary }
  | GateFailure;

/**
 * Resolve the whole week list for a student, with lock state attached.
 *
 * One `getWeekProgress` call for the whole page — the read model is documented as
 * "callers must not have to run a second query to learn lock state".
 */
export const getWeekList = cache(async function getWeekList(
  studentId: number,
): Promise<{ course: CourseSummary | null; items: WeekListItem[] }> {
  // ONE round trip: the course+weeks statement and the progress aggregate have
  // no data dependency on each other, so they are issued concurrently. Both are
  // themselves memoised, so a second call in the same request costs nothing.
  const [{ course, weeks: summaries }, progress] = await Promise.all([
    loadCourseAndWeeks(),
    getWeekProgress(studentId),
  ]);

  if (!course) return { course: null, items: [] };

  const locks = deriveWeekLockStates(summaries, progress);
  const lockById = new Map(locks.map((l) => [l.weekId, l]));

  const items: WeekListItem[] = summaries.map((w) => ({
    ...w,
    // deriveWeekLockStates returns one entry per input week, so this is always
    // present; the fallback exists so a future filtered call cannot crash.
    lock:
      lockById.get(w.id) ??
      ({
        weekId: w.id,
        weekNumber: w.weekNumber,
        title: w.title,
        locked: true,
        // No section claimed it and no progression rule ran, so "section" is the
        // honest attribution: nothing the student does opens this.
        lockedBy: "section",
        reason: "This week is not yet available.",
        quizBestPercent: null,
        lecturesCompleted: 0,
        lectureTotal: w.lectureTotal,
        completionPercent: 0,
      } satisfies WeekLockState),
  }));

  return { course, items };
});

/**
 * Authorize one week for one student.
 *
 * Returns `not_found` for a week id that is not part of the course — deliberately
 * indistinguishable from a nonexistent id, so probing cannot enumerate weeks.
 * Returns `locked` (with the reason) when the week exists but is not yet earned.
 */
export async function gateWeek(studentId: number, weekId: number): Promise<WeekGate> {
  return decideWeekGate(await getWeekList(studentId), weekId);
}

/**
 * THE week authorization decision, over an already-fetched week list.
 *
 * Pure and synchronous, and it is the ONLY place the rule is written. `gateWeek`
 * fetches then calls it; `gateLecture` fetches the list concurrently with the
 * lecture row and calls it with the result. Re-stating "not in the list means
 * not_found, locked means locked" inside gateLecture would be a second copy of
 * the access rule that could drift from this one — and the copy that drifts is
 * always the one guarding the deeper URL.
 */
function decideWeekGate(
  list: { course: CourseSummary | null; items: WeekListItem[] },
  weekId: number,
): WeekGate {
  if (!Number.isInteger(weekId) || weekId <= 0) return { ok: false, kind: "not_found" };
  if (!list.course) return { ok: false, kind: "not_found" };

  const item = list.items.find((w) => w.id === weekId);
  if (!item) return { ok: false, kind: "not_found" };
  if (item.lock.locked) return { ok: false, kind: "locked", lock: item.lock };

  const { lock, ...week } = item;
  return { ok: true, week, lock, course: list.course };
}

export type LectureGate =
  | { ok: true; lecture: LectureDetail; week: WeekSummary; lock: WeekLockState }
  | GateFailure;

/**
 * Authorize one lecture for one student.
 *
 * The lecture's own week is looked up first and then gated — this is the check
 * that stops a hand-typed /weeks/4/lectures/12 URL. `weekIdHint`, when supplied
 * by a nested route, must match the lecture's real week or the request is a
 * not_found: otherwise /weeks/1/lectures/12 would render a Week 4 lecture behind
 * a Week 1 path.
 */
export async function gateLecture(
  studentId: number,
  lectureId: number,
  weekIdHint?: number,
): Promise<LectureGate> {
  if (!Number.isInteger(lectureId) || lectureId <= 0) return { ok: false, kind: "not_found" };

  // PERFORMANCE: these two are issued CONCURRENTLY, not one after the other.
  // The obvious order — fetch the lecture, read its weekId, then gate that week
  // — is a forced serial pair, and at ~257 ms per Neon round trip it put the
  // lecture page at a sequential depth of 3. But the student's week list does
  // not depend on which lecture was asked for: it is the same list whatever the
  // answer. Only the FINAL check needs both, and that check is done below in
  // JavaScript on data that has already arrived.
  //
  // THE GATE IS NOT WEAKENED BY THIS. Fetching the week list earlier grants
  // nothing; the refusal still happens before any lecture content is returned,
  // and it is still driven by the same `getWeekList` result. The only change is
  // when the request was put on the wire.
  const [rows, list] = await Promise.all([
    db
      .select({
        id: lectures.id,
        weekId: lectures.weekId,
        lectureNumber: lectures.lectureNumber,
        title: lectures.title,
        content: lectures.content,
        youtubeUrl: lectures.youtubeUrl,
        topicKey: lectures.topicKey,
        resources: lectures.resources,
      })
      .from(lectures)
      .where(
        weekIdHint == null
          ? eq(lectures.id, lectureId)
          : and(eq(lectures.id, lectureId), eq(lectures.weekId, weekIdHint)),
      )
      .limit(1),
    getWeekList(studentId),
  ]);

  const lecture = rows[0];
  if (!lecture) return { ok: false, kind: "not_found" };

  // Exactly the decision gateWeek makes — the SAME function, over the list that
  // has already arrived. No second copy of the access rule.
  const gate = decideWeekGate(list, lecture.weekId);
  if (!gate.ok) return gate;

  return { ok: true, lecture, week: gate.week, lock: gate.lock };
}

/** Previous/next lecture within the same week, for the footer navigation. */
export async function getLectureNeighbours(
  weekId: number,
  lectureId: number,
): Promise<{ previous: LectureSummary | null; next: LectureSummary | null }> {
  const all = await getLectureSummaries(weekId);
  const index = all.findIndex((l) => l.id === lectureId);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: index > 0 ? all[index - 1] : null,
    next: index < all.length - 1 ? all[index + 1] : null,
  };
}
