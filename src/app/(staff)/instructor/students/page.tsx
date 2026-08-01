// =============================================================================
// /instructor/students — roster, per-student detail, penalty issuing.
// instructor-admin stream.
// -----------------------------------------------------------------------------
// Per-week progress comes from `getWeekProgress` (progress-tracking's read
// model), not from a second calculation here, so the instructor sees exactly the
// numbers the student sees on their own dashboard.
//
// Nothing on this page can render a password hash: every row arrives through the
// explicit `STUDENT_COLUMNS` projection.
// =============================================================================

import {
  AttendanceList,
  PenaltyForm,
  PenaltyList,
  StudentProgressPanel,
  StudentTable,
} from "@/components/instructor";
import { requireRole } from "@/lib/guard";
import { getStudentDetail, listStudents } from "@/lib/instructor/students";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ studentId?: string; cohort?: string }>;
}

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function StudentsPage({ searchParams }: PageProps) {
  await requireRole("instructor");
  const params = await searchParams;

  const studentId = positiveInt(params.studentId);
  const cohortId = positiveInt(params.cohort);

  const [students, detail] = await Promise.all([
    listStudents(cohortId),
    studentId ? getStudentDetail(studentId) : Promise.resolve(null),
  ]);

  // Context for the penalty rules engine. `quizBestPercent` is the worst
  // unlocked week's best attempt — the situation a warning would be about.
  const quizBestPercent =
    detail && detail.weekProgress.length > 0
      ? detail.weekProgress.reduce<number | null>((worst, w) => {
          if (w.quizBestPercent === null) return worst;
          return worst === null ? w.quizBestPercent : Math.min(worst, w.quizBestPercent);
        }, null)
      : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Students</h1>
        <p className="text-sm text-ink-muted">
          {students.length} enrolled student{students.length === 1 ? "" : "s"}.
        </p>
      </header>

      <StudentTable students={students} selectedId={studentId ?? null} />

      {studentId && !detail && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Student {studentId} was not found.
        </p>
      )}

      {detail && (
        <section className="space-y-4" data-testid="student-detail">
          <h2 className="text-xl font-semibold">
            {detail.name}{" "}
            <span className="text-sm font-normal text-ink-muted">{detail.email}</span>
          </h2>

          <div className="grid gap-4 lg:grid-cols-2">
            <StudentProgressPanel weeks={detail.weekProgress} />
            <AttendanceList
              records={detail.attendance}
              attendedCount={detail.attendedCount}
              lectureTotal={detail.lectureTotal}
            />
            <PenaltyList penalties={detail.penalties} />
            <PenaltyForm
              studentId={detail.id}
              studentName={detail.name}
              context={{
                daysLate: 0,
                quizBestPercent,
                missedEntirely: detail.weekProgress.every(
                  (w) => !w.assignmentCompleted,
                ),
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}
