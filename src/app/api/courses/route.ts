// =============================================================================
// GET /api/courses — ROUTE_AUTH "student". Owner: course-content stream.
// -----------------------------------------------------------------------------
// The week list as data: the course plus every week with the CALLING student's
// own lock state. Deliberately returns locked weeks too (with `locked: true` and
// the reason) rather than filtering them out — a client that cannot see a locked
// week cannot render the padlock that tells the student what to do next. The
// content behind a locked week is what is withheld, by /api/weeks/:weekId.
//
// Note the plural route name is fixed by the frozen ROUTES map even though the
// app is single-course today.
// =============================================================================

import { getWeekList } from "@/components/course/data";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { ROUTE_AUTH } from "@/lib/contracts/api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const gate = await apiGuard(ROUTE_AUTH["GET  /api/courses"]);
  if (!gate.ok) return gate.response;

  try {
    const { course, items } = await getWeekList(gate.user.id);

    if (!course) {
      return apiError(404, "No course has been published.", "no_course");
    }

    return apiOk({
      course,
      weeks: items.map((w) => ({
        id: w.id,
        weekNumber: w.weekNumber,
        title: w.title,
        description: w.description,
        dueAt: w.dueAt,
        lectureTotal: w.lectureTotal,
        locked: w.lock.locked,
        lockReason: w.lock.reason,
        quizBestPercent: w.lock.quizBestPercent,
        lecturesCompleted: w.lock.lecturesCompleted,
        completionPercent: w.lock.completionPercent,
      })),
    });
  } catch (error) {
    console.error("GET /api/courses failed", error);
    return apiError(500, "Could not load the course.", "course_read_failed");
  }
}
