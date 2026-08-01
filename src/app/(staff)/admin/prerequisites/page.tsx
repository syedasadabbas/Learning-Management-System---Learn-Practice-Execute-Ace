// =============================================================================
// /admin/prerequisites — the course prerequisite graph and its exceptions.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream (feature 8).
//
// ADMIN ONLY, at three levels. The `(staff)` layout already applied
// `requireRole("instructor")`, which admits instructors too
// (`ROLES_SATISFYING.instructor` is ["instructor","admin"]); `src/middleware.ts`
// gates the `/admin` prefix at the edge; and this page restates
// `requireRole("admin")` because authoring a prerequisite is an ENROLMENT act — it
// decides who may be on the roll of a course, which downstream changes the
// leaderboard population and who a deadline applies to. That is the identical
// argument /admin/course-requests/page.tsx:10 makes, and keeping the level the same
// matters: a feature that admitted instructors to an enrolment decision the
// neighbouring feature reserves for admins would be a privilege escalation by
// inconsistency. NO MIDDLEWARE EDIT WAS NEEDED — the `{ prefix: "/admin",
// required: "admin" }` row already covers this path.
//
// The guard is repeated inside every server action the buttons call. A page guard
// protects the render; it does not protect the mutation, and the mutation is the
// thing that decides who gets into a course.
//
// PLACED UNDER /admin RATHER THAN AS A NEW CONSOLE, matching the existing surface:
// (staff)/admin/*, the shared AppShell from the (staff) layout,
// `dynamic = "force-dynamic"`, a StatTile row, and the same shape
// /admin/course-requests uses. No new console, no new layout, no second navigation.
//
// -----------------------------------------------------------------------------
// THE CYCLE TRIPWIRE IS ON THIS PAGE, and it is the third of three defences.
// Nothing in the application can create a cycle: a self-edge is forbidden by a
// database CHECK, and a longer cycle is refused inside the insert transaction under
// an advisory lock (see src/lib/prerequisites/store.ts's `insertPrerequisite`). So
// a non-null `findCycle` here means the data was changed by something outside the
// application — a restored dump, a manual INSERT. It is rendered as a named defect
// rather than left to look like a mystery unreachable course.
// =============================================================================

import type { Metadata } from "next";

import { OverridePanel, PrerequisiteRules } from "@/components/prerequisites";
import type { CourseOption, OverrideView, RuleView } from "@/components/prerequisites";
import { StatTile } from "@/components/instructor";
import { Card } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { getActiveCourseId } from "@/lib/courses/store";
import { findCycle, topologicalOrder } from "@/lib/prerequisites/graph";
import {
  listCourseNames,
  listEdges,
  listOverrides,
  listRules,
  listStudents,
} from "@/lib/prerequisites/store";
import { db } from "@/db";
import { courseAccessRequests } from "@/db/schema.access";
import { and, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Course prerequisites",
};

/**
 * Approved-student counts for EVERY course in one statement.
 *
 * The editor shows, per course, how many students already have access and would
 * therefore be refused by a new rule (see `CourseOption.approvedStudents`). Calling
 * `countApprovedStudents` once per course would be one round trip per course at
 * ~245 ms each — the 1-vs-n mistake docs/SUBJECT_SECTIONS.md's appendix is entirely
 * about. Declared here rather than in ./store.ts because it serves this page's
 * layout and nothing else reads it.
 */
async function approvedCountsByCourse(): Promise<Map<number, number>> {
  const rows = await db
    .select({
      courseId: courseAccessRequests.courseId,
      count: sql<number>`count(*)::int`,
    })
    .from(courseAccessRequests)
    .where(and(eq(courseAccessRequests.status, "approved")))
    .groupBy(courseAccessRequests.courseId);
  return new Map(rows.map((r) => [r.courseId, r.count]));
}

export default async function AdminPrerequisitesPage() {
  await requireRole("admin");

  // Six reads, ZERO sequential depth beyond one: none depends on another's result.
  // At ~245 ms per Neon round trip a serial chain here would be a page that takes
  // a second and a half to say "no prerequisites are configured".
  const [rules, edges, courses, overrides, students, activeCourseId, approvedCounts] =
    await Promise.all([
      listRules(),
      listEdges(),
      listCourseNames(),
      listOverrides(),
      listStudents(),
      getActiveCourseId(),
      approvedCountsByCourse(),
    ]);

  const cycle = findCycle(edges);
  const courseTitleById = new Map(courses.map((c) => [c.id, c.title]));

  // The DERIVED learning path — see `topologicalOrder`'s docstring for why feature
  // 8's `learning_paths` table was deliberately not built.
  const { order, cycle: orderCycle } = topologicalOrder(
    edges,
    courses.map((c) => c.id),
  );

  const courseOptions: CourseOption[] = courses.map((c) => ({
    id: c.id,
    title: c.title,
    isActiveCourse: activeCourseId != null && c.id === activeCourseId,
    approvedStudents: approvedCounts.get(c.id) ?? 0,
  }));

  const ruleViews: RuleView[] = rules.map((r) => ({
    id: r.id,
    courseId: r.courseId,
    courseTitle: r.courseTitle,
    prerequisiteCourseId: r.prerequisiteCourseId,
    prerequisiteTitle: r.prerequisiteTitle,
    minScore: r.minScore,
    // Dates cross the server/client boundary as ISO strings, never as Date.
    createdAt: r.createdAt.toISOString(),
    createdByName: r.createdByName,
  }));

  const overrideViews: OverrideView[] = overrides.map((o) => ({
    id: o.id,
    studentName: o.studentName,
    studentEmail: o.studentEmail,
    courseTitle: o.courseTitle,
    reason: o.reason,
    unmetAtGrant: o.unmetAtGrant,
    grantedAt: o.grantedAt.toISOString(),
    grantedByName: o.grantedByName,
    revokedAt: o.revokedAt ? o.revokedAt.toISOString() : null,
    revokedByName: o.revokedByName,
  }));

  // Only courses that HAVE prerequisites can be overridden — an override waives a
  // requirement, so offering a course with none would offer a no-op that
  // `canGrantOverride` refuses with `nothing_unmet`.
  const constrainedCourseIds = new Set(rules.map((r) => r.courseId));
  const constrainedCourses = courses.filter((c) => constrainedCourseIds.has(c.id));

  const liveOverrides = overrideViews.filter((o) => o.revokedAt == null).length;

  return (
    <div className="space-y-6" data-testid="admin-prerequisites">
      <header>
        <h1 className="text-2xl font-semibold">Course prerequisites</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Require one course before another. A student who does not satisfy a
          requirement is refused entry and told which course is missing; an admin can
          override that for one student, and the override is recorded here and shown
          to them.
        </p>
      </header>

      {cycle && (
        // See this file's header: unreachable through the application, so its
        // presence is a data defect and is named rather than hidden.
        <Card
          title="Circular requirement detected"
          subtitle="This cannot be created through this page, so it arrived from outside the application."
          data-testid="cycle-warning"
        >
          <p className="max-w-prose text-sm text-red-800">
            {cycle.map((id) => courseTitleById.get(id) ?? `course ${id}`).join(" → ")}
          </p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            None of these courses can ever be entered. Remove one of the rules below
            to break the chain.
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Rules" value={rules.length} muted={rules.length === 0} />
        <StatTile
          label="Courses with requirements"
          value={constrainedCourseIds.size}
          muted={constrainedCourseIds.size === 0}
        />
        <StatTile label="Live overrides" value={liveOverrides} muted={liveOverrides === 0} />
      </div>

      <PrerequisiteRules rules={ruleViews} courses={courseOptions} />

      <Card
        title="Recommended order"
        subtitle="Derived from the rules above — prerequisites before the courses that need them."
      >
        {orderCycle ? (
          <p className="px-4 py-3 text-sm text-red-800" data-testid="learning-path-broken">
            The courses cannot be ordered while the circular requirement above exists.
          </p>
        ) : (
          <ol
            className="list-decimal space-y-1 px-8 py-3 text-sm text-ink"
            data-testid="learning-path"
          >
            {order.map((id) => (
              <li key={id} data-course-id={id}>
                {courseTitleById.get(id) ?? `course ${id}`}
              </li>
            ))}
          </ol>
        )}
        <p className="px-4 pb-3 text-xs text-ink-muted">
          This order is COMPUTED from the prerequisite rules, not stored separately.
          IMPLEMENTATION_ROADMAP.md:491 specifies a <code>learning_paths</code> table
          holding an explicit course order; it was deliberately not built, because a
          stored order and a prerequisite graph are two sources of truth for the same
          fact and they disagree the first time a rule is added without re-editing the
          path — at which point this page would recommend an order the gate refuses to
          let a student follow.
        </p>
      </Card>

      <OverridePanel
        overrides={overrideViews}
        students={students}
        courses={constrainedCourses}
      />

      <Card title="How access works" subtitle="Four layers, and prerequisites are part of the first.">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">Course access — the enrolment decision.</strong>{" "}
            A student requests a course and an admin approves it
            (<code>/admin/course-requests</code>). PREREQUISITES ARE PART OF THIS SAME
            DECISION, not a separate one: an unmet requirement refuses the request when
            it is filed and refuses entry if a rule is added later.{" "}
            <code>decideCourseAccess</code> remains the only function that answers
            &ldquo;may this student open this course&rdquo;.
          </li>
          <li>
            <strong className="text-ink">The cohort&apos;s own course is always open.</strong>{" "}
            A prerequisite recorded against it is stored but does not gate entry —
            gating it would silently revoke the course every existing student is on.
            See the compatibility rule in <code>src/lib/courses/policy.ts</code>.
          </li>
          <li>
            <strong className="text-ink">Section release.</strong> Within a course a
            subject is opened by <code>appConfig.curriculumSections</code> and a deploy
            — see <code>docs/SUBJECT_SECTIONS.md</code>. An override granted here does{" "}
            <strong className="text-ink">not</strong> open a withheld subject.
          </li>
          <li>
            <strong className="text-ink">Quiz progression.</strong> Inside an open
            subject a student still has to pass the previous week&apos;s quiz.
            Satisfying a prerequisite does not unlock a week, and passing a week quiz
            does not satisfy a prerequisite for another course.
          </li>
        </ol>
      </Card>
    </div>
  );
}
