// =============================================================================
// STUDENT ROSTER TABLE — instructor-admin stream.
// -----------------------------------------------------------------------------
// Renders `StudentSummary` rows, which come from a projection that names its
// columns. There is no field on the incoming type that could hold a credential,
// so this component cannot leak one.
// =============================================================================

import Link from "next/link";

import { Badge, buttonClasses, Card, EmptyState, ProgressBar } from "@/components/ui";
import type { WeekProgress } from "@/lib/contracts/events";
import { POINTS } from "@/lib/contracts/scoring";
import type {
  AttendanceRecord,
  PenaltyRecord,
  StudentSummary,
} from "@/lib/instructor/students";

export function StudentTable({
  students,
  selectedId = null,
  basePath = "/instructor/students",
}: {
  students: readonly StudentSummary[];
  selectedId?: number | null;
  basePath?: string;
}) {
  if (students.length === 0) {
    return (
      <EmptyState
        title="No students enrolled"
        description="Assign accounts to a cohort from the admin console to see them here."
      />
    );
  }

  return (
    <Card padded={false} data-testid="student-table-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="student-table">
          <caption className="sr-only">Enrolled students and their counters</caption>
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Student</th>
              <th scope="col" className="px-3 py-2">Cohort</th>
              <th scope="col" className="px-3 py-2">Score</th>
              <th scope="col" className="px-3 py-2">Submissions</th>
              <th scope="col" className="px-3 py-2">Late</th>
              <th scope="col" className="px-3 py-2">Attendance</th>
              <th scope="col" className="px-3 py-2">Penalties</th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr
                key={s.id}
                data-testid="student-row"
                data-student-id={s.id}
                className={
                  s.id === selectedId
                    ? "border-t border-line bg-brand/5"
                    : "border-t border-line"
                }
              >
                <td className="px-3 py-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-xs text-ink-muted">{s.email}</span>
                </td>
                <td className="px-3 py-2">{s.cohortName ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{s.totalScore}</td>
                <td className="px-3 py-2 tabular-nums">
                  {s.gradedSubmissionCount} / {s.submissionCount}
                </td>
                <td className="px-3 py-2 tabular-nums">{s.lateSubmissionCount}</td>
                <td className="px-3 py-2 tabular-nums">{s.attendedLectureCount}</td>
                <td className="px-3 py-2">
                  {s.openPenaltyCount === 0 ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    <Badge tone={s.openPenaltyCount >= 3 ? "danger" : "warning"} size="sm">
                      {s.openPenaltyCount} open
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`${basePath}?studentId=${s.id}`}
                    className={buttonClasses("secondary", "sm")}
                    data-testid="open-student"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function StudentProgressPanel({ weeks }: { weeks: readonly WeekProgress[] }) {
  return (
    <Card title="Progress by week" data-testid="student-progress-card">
      {weeks.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No progress recorded yet. The per-week read model is owned by the
          progress-tracking stream; an empty list means the student has not started
          (or that stream has not landed).
        </p>
      ) : (
        <ul className="space-y-3 text-sm">
          {weeks.map((w) => (
            <li key={w.weekId} data-testid={`progress-week-${w.weekNumber}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  Week {w.weekNumber} — {w.title}
                </span>
                <span className="flex items-center gap-1">
                  {!w.unlocked && (
                    <Badge tone="neutral" size="sm">
                      Locked
                    </Badge>
                  )}
                  {w.quizCompleted && (
                    <Badge tone="success" size="sm">
                      Quiz
                    </Badge>
                  )}
                  {w.assignmentCompleted && (
                    <Badge tone="success" size="sm">
                      Assignment
                    </Badge>
                  )}
                </span>
              </div>
              <ProgressBar
                // POINTS.WEEK_MAX is a positive constant from the scoring
                // contract, so this denominator can never be zero.
                percent={(w.overallScore / POINTS.WEEK_MAX) * 100}
                label={`${w.overallScore} / ${POINTS.WEEK_MAX} points`}
                size="sm"
              />
              <span className="text-xs text-ink-muted">
                {w.lecturesCompleted} of {w.lectureTotal} lectures
                {w.quizBestPercent === null
                  ? " — no quiz attempt"
                  : ` — best quiz ${w.quizBestPercent}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PenaltyList({ penalties }: { penalties: readonly PenaltyRecord[] }) {
  return (
    <Card title="Penalties" data-testid="penalty-list-card">
      {penalties.length === 0 ? (
        <p className="text-sm text-ink-muted">No penalties on record.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {penalties.map((p) => (
            <li key={p.id} className="py-2" data-testid="penalty-row">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.type.replace(/_/g, " ")}</span>
                <Badge
                  tone={
                    p.resolved
                      ? "neutral"
                      : p.severity === "serious"
                        ? "danger"
                        : "warning"
                  }
                  size="sm"
                >
                  {p.resolved ? "resolved" : p.severity}
                </Badge>
              </div>
              {p.description && (
                <p className="text-xs text-ink-muted">{p.description}</p>
              )}
              <p className="text-xs text-ink-muted tabular-nums">
                -{p.penaltyPoints} pts · {new Date(p.issuedAt).toISOString().slice(0, 10)}
                {p.issuedByName ? ` · by ${p.issuedByName}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AttendanceList({
  records,
  attendedCount,
  lectureTotal,
}: {
  records: readonly AttendanceRecord[];
  attendedCount: number;
  lectureTotal: number;
}) {
  return (
    <Card
      title="Attendance"
      subtitle={
        lectureTotal > 0
          ? `${attendedCount} of ${lectureTotal} lectures attended`
          : "No lectures configured yet"
      }
      data-testid="attendance-card"
    >
      {records.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No attendance has been recorded for this student.
        </p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {records.map((r) => (
            <li
              key={r.lectureId}
              className="flex items-center justify-between py-1.5"
              data-testid="attendance-row"
            >
              <span>
                <span className="text-xs text-ink-muted">W{r.weekNumber}</span>{" "}
                {r.lectureTitle}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={r.attended ? "success" : "neutral"} size="sm">
                  {r.attended ? "present" : "absent"}
                </Badge>
                <span className="tabular-nums text-ink-muted">
                  {r.participationScore} pts
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
