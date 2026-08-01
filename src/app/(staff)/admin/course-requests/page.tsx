// =============================================================================
// /admin/course-requests — approve or decline course access. Admin console.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// ADMIN ONLY, at two levels and on purpose. The `(staff)` layout already applied
// `requireRole("instructor")`, which admits instructors too
// (`ROLES_SATISFYING.instructor` is ["instructor","admin"]). This page restates
// `requireRole("admin")` because granting course access is an ENROLMENT act — it
// changes who is on the roll, and therefore the leaderboard population and who a
// deadline applies to. That is the same class of act as `/admin/students`
// ("Roles and cohort enrolment"), which is admin-only for the same reason. The
// full argument is in src/lib/courses/policy.ts:63.
//
// The guard is repeated in every server action the buttons call. A page guard
// protects the render; it does not protect the mutation — and the mutation is
// the thing that hands out access.
//
// PLACED UNDER /admin RATHER THAN AS A NEW CONSOLE. The brief said to match the
// existing admin surface, and this is it: (staff)/admin/* with the shared
// AppShell from the (staff) layout, `dynamic = "force-dynamic"`, a StatTile row,
// and the same review-queue shape /admin/videos uses. No new console, no new
// layout, no second navigation.
// =============================================================================

import type { Metadata } from "next";

import { RequestQueue, type RequestQueueItem } from "@/components/courses";
import { StatTile } from "@/components/instructor";
import { Card } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { countRequestsByStatus, listRequestQueue, type QueueRow } from "@/lib/courses/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Course access requests",
};

/** Dates cross the server/client boundary as ISO strings, never as Date. */
function toItem(row: QueueRow): RequestQueueItem {
  return {
    id: row.id,
    studentName: row.studentName,
    studentEmail: row.studentEmail,
    courseTitle: row.courseTitle,
    status: row.status,
    message: row.message,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    deciderName: row.deciderName,
  };
}

export default async function AdminCourseRequestsPage() {
  await requireRole("admin");

  const [rows, counts] = await Promise.all([listRequestQueue(), countRequestsByStatus()]);

  const pending = rows.filter((r) => r.status === "pending").map(toItem);
  const decided = rows.filter((r) => r.status !== "pending").map(toItem);

  return (
    <div className="space-y-6" data-testid="admin-course-requests">
      <header>
        <h1 className="text-2xl font-semibold">Course access requests</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Students request access to a course they are not enrolled in.
          Approving one is what lets them open it — nothing else does.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Awaiting decision" value={counts.pending} muted={counts.pending === 0} />
        <StatTile label="Approved" value={counts.approved} muted={counts.approved === 0} />
        <StatTile label="Declined" value={counts.rejected} muted={counts.rejected === 0} />
      </div>

      <RequestQueue
        title={`Awaiting decision (${pending.length})`}
        subtitle="Approving grants access to the whole course. A note is optional but is shown to the student."
        items={pending}
        emptyTitle="No requests awaiting a decision"
        emptyDescription={
          counts.approved + counts.rejected > 0
            ? "Everything filed so far has been decided."
            : "No student has requested access to a course yet. Only courses other than the cohort's own course can be requested — the cohort course is open to everyone."
        }
      />

      {decided.length > 0 && (
        <RequestQueue
          title={`Already decided (${decided.length})`}
          subtitle="Kept as the audit record of who decided what, and when."
          items={decided}
          emptyTitle="Nothing decided yet"
        />
      )}

      <Card title="How access works" subtitle="Three layers, and this is only the first.">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">Course access — this page.</strong> The
            cohort&apos;s own course is open to every signed-in student and cannot be
            requested or revoked here. Every other course needs an approval below.
          </li>
          <li>
            <strong className="text-ink">Section release.</strong> Within a course a
            subject is opened by <code>appConfig.curriculumSections</code> and a deploy —
            see <code>docs/SUBJECT_SECTIONS.md</code>. Approving access here does{" "}
            <strong className="text-ink">not</strong> open a withheld subject.
          </li>
          <li>
            <strong className="text-ink">Quiz progression.</strong> Inside an open
            subject a student still has to pass the previous week&apos;s quiz.
          </li>
        </ol>
      </Card>
    </div>
  );
}
