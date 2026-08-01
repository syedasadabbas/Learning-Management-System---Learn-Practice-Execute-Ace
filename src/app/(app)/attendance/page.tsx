// =============================================================================
// /attendance — instructor marks per-lecture attendance for a week.
// Owner: penalties-attendance stream.
// -----------------------------------------------------------------------------
// PATH NOTE (raised, not silently resolved): the SKILL names
// `src/app/api/attendance/route.ts` and `(app)/me/notices/page.tsx`. Neither is
// available to this stream — the frozen ROUTES map has no attendance or penalty
// endpoint (so no API route may be added here) and `(app)/me/**` belongs to the
// progress-tracking stream. Attendance therefore lives at this segment and talks
// to the database through server actions; the student notices view ships as the
// reusable `PenaltyList` component for whichever stream owns `(app)/me`.
// Flagged to the coordinator.
//
// Attendance changes per request and is staff-only; never statically cached.
// =============================================================================

import { Card } from "@/components/ui";
import { AttendanceTable } from "@/components/attendance";
import { markAttendanceAction } from "@/lib/attendance/actions";
import { attendanceGridForWeek, listWeeks } from "@/lib/attendance/service";
import { MIN_ATTENDANCE_PERCENT } from "@/lib/attendance";
import { POINTS } from "@/lib/contracts/scoring";
import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

function parseWeekId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("instructor", "/attendance");

  const sp = await searchParams;
  const weeks = await listWeeks();
  const requested = parseWeekId(sp.week);
  const selected =
    weeks.find((w) => w.id === requested) ?? weeks[0] ?? null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4">
      <header>
        <h1 className="text-xl font-semibold">Attendance</h1>
        <p className="text-sm text-ink-muted">
          Tick a lecture to record attendance. Re-ticking corrects an earlier entry.
          Participation is worth {POINTS.PARTICIPATION_MAX} points a week and is zero
          below {MIN_ATTENDANCE_PERCENT}% attendance.
        </p>
      </header>

      {weeks.length > 0 && (
        <nav aria-label="Select week" className="flex flex-wrap gap-2">
          {weeks.map((w) => (
            <a
              key={w.id}
              href={`/attendance?week=${w.id}`}
              aria-current={selected?.id === w.id ? "page" : undefined}
              data-testid={`attendance-week-${w.weekNumber}`}
              className={
                selected?.id === w.id
                  ? "rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand"
                  : "rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface"
              }
            >
              Week {w.weekNumber}
            </a>
          ))}
        </nav>
      )}

      {selected === null ? (
        <Card title="No weeks yet">
          <p className="text-sm text-ink-muted">
            Attendance can be recorded once the course has weeks and lectures.
          </p>
        </Card>
      ) : (
        <AttendanceGrid weekId={selected.id} title={selected.title} />
      )}
    </main>
  );
}

async function AttendanceGrid({ weekId, title }: { weekId: number; title: string }) {
  const grid = await attendanceGridForWeek(weekId);

  return (
    <Card title={title} subtitle="One column per lecture">
      <AttendanceTable
        weekId={grid.weekId}
        lectures={grid.lectures}
        students={grid.students}
        onMark={markAttendanceAction}
      />
    </Card>
  );
}
