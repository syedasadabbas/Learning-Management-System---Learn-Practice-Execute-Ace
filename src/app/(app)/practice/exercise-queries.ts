// =============================================================================
// PRACTICE — server-side reads
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream. Server-only: imported exclusively by the
// pages in this folder, never by a client component.
//
// SCOPE, stated so it is not mistaken for something it is not: these queries read
// `weeks` and `lectures` and nothing else. Week lock state is the course-content
// stream's read model, and progress is progress-tracking's; duplicating either
// here would create a second source of truth for "can this student see week 3".
// Practice is therefore not gated by unlock state — it is reference material and
// an editor, carrying no marks. If the coordinator decides practice must follow
// the unlock rules, the fix is to consume course-content's read model here, not to
// re-derive it. Flagged in the report rather than silently chosen.
// =============================================================================

import { cache } from "react";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { lectures, weeks } from "@/db/schema";
import {
  conceptsForLecture,
  countSandpackResources,
  parseSandpackResources,
  type ConceptMeta,
  type ExerciseEntry,
} from "@/lib/exercises";

export interface PracticeLectureSummary {
  lectureId: number;
  lectureNumber: number;
  lectureTitle: string;
  weekId: number;
  weekNumber: number;
  weekTitle: string;
  /** Number of `sandpack` resources, malformed ones included. */
  exerciseCount: number;
  concepts: ConceptMeta[];
}

export interface PracticeLectureDetail extends PracticeLectureSummary {
  entries: ExerciseEntry[];
}

/** Every lecture, in syllabus order, annotated with what practice it offers. */
export async function listPracticeLectures(): Promise<PracticeLectureSummary[]> {
  const rows = await db
    .select({
      lectureId: lectures.id,
      lectureNumber: lectures.lectureNumber,
      lectureTitle: lectures.title,
      content: lectures.content,
      resources: lectures.resources,
      weekId: weeks.id,
      weekNumber: weeks.weekNumber,
      weekTitle: weeks.title,
    })
    .from(lectures)
    .innerJoin(weeks, eq(lectures.weekId, weeks.id))
    .orderBy(asc(weeks.weekNumber), asc(lectures.orderIndex), asc(lectures.lectureNumber));

  return rows.map((row) => ({
    lectureId: row.lectureId,
    lectureNumber: row.lectureNumber,
    lectureTitle: row.lectureTitle,
    weekId: row.weekId,
    weekNumber: row.weekNumber,
    weekTitle: row.weekTitle,
    exerciseCount: countSandpackResources(row.resources),
    concepts: conceptsForLecture({ title: row.lectureTitle, content: row.content }),
  }));
}

/** One lecture with its resources parsed. Null when the id does not exist. */
/**
 * Request-scoped memo of `getPracticeLecture`.
 *
 * WHY THIS EXISTS: the route's `layout.tsx` resolves the lecture to decide
 * whether to `notFound()`, and then the page resolves it again to render. Both
 * run in the same request, so without `cache()` that is two identical round trips
 * to Neon — and a round trip measures ~245 ms on this connection
 * (scripts/perf-roundtrips.ts), which would have doubled the cost of every
 * practice lecture to buy a status code.
 *
 * The layout MUST be the one that calls notFound(), not the page: the page sits
 * inside this route's `loading.tsx` Suspense boundary, and once that boundary
 * flushes its fallback the HTTP status is already committed as 200. The layout is
 * ABOVE the boundary, so a notFound() there still sets 404. See
 * src/components/nav/PageSkeleton.tsx for the full account.
 *
 * Same `cache()` pattern as src/components/course/data.ts:50.
 */
export const loadPracticeLecture = cache(getPracticeLecture);

export async function getPracticeLecture(
  lectureId: number,
): Promise<PracticeLectureDetail | null> {
  if (!Number.isInteger(lectureId) || lectureId <= 0) return null;

  const rows = await db
    .select({
      lectureId: lectures.id,
      lectureNumber: lectures.lectureNumber,
      lectureTitle: lectures.title,
      content: lectures.content,
      resources: lectures.resources,
      weekId: weeks.id,
      weekNumber: weeks.weekNumber,
      weekTitle: weeks.title,
    })
    .from(lectures)
    .innerJoin(weeks, eq(lectures.weekId, weeks.id))
    .where(eq(lectures.id, lectureId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    lectureId: row.lectureId,
    lectureNumber: row.lectureNumber,
    lectureTitle: row.lectureTitle,
    weekId: row.weekId,
    weekNumber: row.weekNumber,
    weekTitle: row.weekTitle,
    exerciseCount: countSandpackResources(row.resources),
    concepts: conceptsForLecture({ title: row.lectureTitle, content: row.content }),
    entries: parseSandpackResources(row.lectureId, row.resources),
  };
}
