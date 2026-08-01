// =============================================================================
// /courses — the catalog, and where a student reads their own request status.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// GUARDED HERE, NOT ONLY AT THE EDGE. `src/middleware.ts` gates the /courses
// prefix, but its own header (line 24) is explicit that middleware is "defence in
// depth, not the only defence" — it covers path prefixes, and a page under an
// unlisted prefix slips through the matcher. `requireUser()` below is the
// enforcement; the middleware row is the fast reject.
//
// EVERY ACCESS DECISION ON THIS PAGE IS MADE BY `decideCourseAccess` /
// `canRequestAccess`, never by an inline comparison. The component receives the
// ANSWERS as props and re-derives nothing, and the server action re-derives both
// again before it writes — so the button, the page and the mutation cannot
// disagree about who may do what.
//
// ONE DATABASE ROUND TRIP FOR THE WHOLE PAGE'S DATA. `listCourseCatalog` joins
// the caller's own request rows to `courses` in one statement, and it is issued
// concurrently with `getActiveCourseId` (no data dependency). At ~245 ms per trip
// against the Neon instance (docs/SUBJECT_SECTIONS.md appendix), a serial chain
// here would be the difference between one page-load and three.
//
// NOT IN THE NAV, and this is a deliberate refusal rather than an oversight.
// `tests/unit/cross-stream-contracts.test.ts` asserts that no nav href starts
// with "/course" — a guard against the historical `/course`-vs-`/weeks` defect —
// and "/courses" trips it. The assertion is over-broad (it should test for the
// exact segment `/course`), but that file is owned by the coordinator, and
// loosening someone else's security-adjacent guard to make my own feature
// reachable is the wrong trade to make unilaterally. Flagged in the stream
// report: tighten that assertion to `href === "/course" || startsWith("/course/")`
// and then add the nav row. Until then /courses is reachable by URL and from the
// admin console.
// =============================================================================

import type { Metadata } from "next";

import { CourseCatalog, type CatalogCourse } from "@/components/courses";
// FEATURE 8 (prerequisites stream). Server component + zero-import labels module,
// so nothing is added to this page's client bundle.
import { PrerequisiteNotice } from "@/components/prerequisites";
import { Card } from "@/components/ui";
import { evaluateCatalogPrerequisites } from "@/lib/prerequisites/gate";
import { requireUser } from "@/lib/guard";
import { canRequestAccess, decideCourseAccess } from "@/lib/courses/policy";
import { getActiveCourseId, listCourseCatalog } from "@/lib/courses/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Courses",
};

/** Dates cross the server/client boundary as ISO strings, never as Date. */
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export default async function CoursesPage() {
  const user = await requireUser("/courses");

  const [rows, activeCourseId] = await Promise.all([
    listCourseCatalog(user.id),
    getActiveCourseId(),
  ]);

  // FEATURE 8 (prerequisites). ONE bulk evaluation, not one per course:
  // `evaluateCatalogPrerequisites` reads every course's requirements in a single
  // statement and then evaluates purely, so this page keeps its stated property
  // (see this file's header, line 18) of costing a fixed number of round trips
  // rather than one per row. It returns an EMPTY map when no course has
  // prerequisites, which is the state until an admin authors one.
  const prerequisiteByCourse = await evaluateCatalogPrerequisites(
    user.id,
    rows.map((r) => r.id),
    activeCourseId,
    user.role,
  );

  const courses: CatalogCourse[] = rows.map((row) => {
    // `courseExists: true` is honest here and nowhere else in this stream: the
    // row came back from a SELECT over `courses`, so its existence is proven by
    // the read rather than assumed from the id.
    // Absent from the map means the course has no prerequisites at all, which both
    // policy functions treat as unconstrained — the pre-feature-8 behaviour.
    const prerequisites = prerequisiteByCourse.get(row.id) ?? null;

    const decision = decideCourseAccess({
      courseId: row.id,
      activeCourseId,
      role: user.role,
      courseExists: true,
      requestStatus: row.requestStatus,
      prerequisites,
    });

    const eligibility = canRequestAccess({
      courseId: row.id,
      activeCourseId,
      role: user.role,
      requestStatus: row.requestStatus,
      // The auto-refusal: a request an admin would only decline is not offered.
      // `requestCourseAccessAction` re-derives this before it writes, so hiding the
      // button is presentation and the action is the control.
      prerequisites,
    });

    // The badge state is the STUDENT'S OWN position, derived from the request
    // row and the open-course rule — not from `decision.allowed`, which is true
    // for staff on every course and would render "Enrolled" on all of them.
    const state: CatalogCourse["state"] =
      decision.allowed && decision.via === "open_course"
        ? "open"
        : row.requestStatus ?? "none";

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      weekCount: row.weekCount,
      durationWeeks: row.durationWeeks,
      state,
      canRequest: eligibility.canRequest,
      decisionNote: row.decisionNote,
      requestedAt: iso(row.requestedAt),
      decidedAt: iso(row.decidedAt),
    };
  });

  const viewerIsStaff = user.role === "instructor" || user.role === "admin";
  const pending = courses.filter((c) => c.state === "pending").length;

  /**
   * FEATURE 8, REQUIREMENT 5, ON THE CATALOG.
   *
   * `canRequestAccess` has already withheld the Request button for these courses.
   * A button that silently disappears is exactly the "Locked with no reason"
   * failure this feature exists to remove, so the reason is rendered here.
   *
   * DELIBERATELY A SEPARATE CARD RATHER THAN A CHANGE TO `CourseCatalog`.
   * `src/components/courses/**` belongs to the courses / access-requests stream;
   * adding a prop to `CatalogCourse` and a branch to that component would be a
   * larger edit to another stream's file than this feature needs. The trade-off,
   * stated rather than hidden: the explanation sits above the list instead of on
   * the card it refers to, so it names the course in its own text. If that stream
   * later wants it inline, `PrerequisiteNotice` is the component to drop in.
   */
  const blockedByPrerequisite = rows
    .map((row) => ({ row, evaluation: prerequisiteByCourse.get(row.id) }))
    .filter((entry) => entry.evaluation && !entry.evaluation.satisfied);

  return (
    <div className="space-y-6" data-testid="courses-page">
      <header>
        <h1 className="text-2xl font-semibold">Courses</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Your cohort&apos;s course is open to you. Any other course needs an
          admin&apos;s approval — request it here and the outcome appears on this
          page.
        </p>
      </header>

      {pending > 0 && (
        <p className="text-sm text-ink-muted" data-testid="pending-request-count">
          {pending} request{pending === 1 ? "" : "s"} awaiting a decision.
        </p>
      )}

      {blockedByPrerequisite.length > 0 && (
        <Card
          title="Some courses have entry requirements"
          subtitle="You cannot request these yet. Here is what each one needs."
          data-testid="catalog-prerequisites"
        >
          <div className="space-y-4 px-4 py-3">
            {blockedByPrerequisite.map(({ row, evaluation }) => (
              <div key={row.id} data-testid={`catalog-prerequisite-${row.id}`}>
                <p className="text-sm font-semibold text-ink">{row.title}</p>
                <div className="mt-1">
                  <PrerequisiteNotice unmet={evaluation!.unmet} variant="advisory" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <CourseCatalog courses={courses} viewerIsStaff={viewerIsStaff} />
    </div>
  );
}
