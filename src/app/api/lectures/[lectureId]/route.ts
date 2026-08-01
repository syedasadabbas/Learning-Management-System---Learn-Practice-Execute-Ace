// =============================================================================
// GET /api/lectures/:lectureId — ROUTE_AUTH "student".
// Owner: course-content stream.
// -----------------------------------------------------------------------------
// The full lecture body. THIS IS THE ENDPOINT A LOCK BYPASS WOULD TARGET: it is
// flat (no week id in the path), so a student who knows any lecture id could
// otherwise read a week they have not earned. `gateLecture` resolves the
// lecture's own week and applies the student's lock state before returning
// anything.
//
// The response pre-computes `embedUrl` (privacy-mode youtube-nocookie, null when
// there is no video — which is every seeded row today) and pre-filters resources
// to the external links, so no client re-implements the parsing rules.
// =============================================================================

import { gateLecture, getLectureNeighbours } from "@/components/course/data";
import { linkResourcesFrom, sandpackResourceCount } from "@/components/course/resources";
import { youTubeEmbedUrl } from "@/components/course/youtube";
import { ROUTE_AUTH } from "@/lib/contracts/api";
import { apiError, apiGuard, apiOk } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ lectureId: string }> },
): Promise<Response> {
  const gate = await apiGuard(ROUTE_AUTH["GET  /api/lectures/:lectureId"]);
  if (!gate.ok) return gate.response;

  const { lectureId: raw } = await context.params;
  const lectureId = Number(raw);
  if (!Number.isInteger(lectureId) || lectureId <= 0) {
    return apiError(400, "lectureId must be a positive integer.", "bad_lecture_id");
  }

  try {
    const result = await gateLecture(gate.user.id, lectureId);

    if (!result.ok && result.kind === "not_found") {
      return apiError(404, "Lecture not found.", "lecture_not_found");
    }
    if (!result.ok) {
      return apiError(
        403,
        result.lock.reason ?? "This week is not yet available.",
        "week_locked",
      );
    }

    const { lecture, week } = result;
    const neighbours = await getLectureNeighbours(week.id, lecture.id);

    return apiOk({
      lecture: {
        id: lecture.id,
        weekId: lecture.weekId,
        lectureNumber: lecture.lectureNumber,
        title: lecture.title,
        content: lecture.content,
        // Null for every seeded row: scripts/seed-content.ts leaves youtubeUrl
        // null on purpose. Clients must render a placeholder, not a broken frame.
        embedUrl: youTubeEmbedUrl(lecture.youtubeUrl),
        practiceLinks: linkResourcesFrom(lecture.resources),
        interactiveExerciseCount: sandpackResourceCount(lecture.resources),
      },
      week: { id: week.id, weekNumber: week.weekNumber, title: week.title },
      previousLectureId: neighbours.previous?.id ?? null,
      nextLectureId: neighbours.next?.id ?? null,
    });
  } catch (error) {
    console.error(`GET /api/lectures/${lectureId} failed`, error);
    return apiError(500, "Could not load the lecture.", "lecture_read_failed");
  }
}
