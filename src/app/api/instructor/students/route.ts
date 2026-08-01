// =============================================================================
// GET /api/instructor/students  —  ROUTE_AUTH: "instructor"
// -----------------------------------------------------------------------------
// The student roster with progress counters. Optional ?cohort= narrows it, and
// ?studentId= returns one student's full detail (progress, penalties, attendance).
//
// NO PASSWORD HASHES. Every projection comes from `STUDENT_COLUMNS` in
// `@/lib/instructor/students`, which names columns explicitly. This handler
// serialises whatever that read model returns, so the "select explicit columns"
// rule is enforced at the query, not by remembering to strip a field here.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { authLevelFor } from "@/lib/instructor/access";
import { getStudentDetail, listStudents } from "@/lib/instructor/students";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_KEY = "GET  /api/instructor/students" as const;

function positiveIntParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard(authLevelFor(ROUTE_KEY));
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const studentId = positiveIntParam(url.searchParams.get("studentId"));
  const cohortId = positiveIntParam(url.searchParams.get("cohort"));

  if (studentId !== undefined) {
    const detail = await getStudentDetail(studentId);
    if (!detail) return apiError(404, "Student not found.", "student_not_found");
    return apiOk(detail);
  }

  const students = await listStudents(cohortId);
  return apiOk({ students, count: students.length, cohortId: cohortId ?? null });
}
