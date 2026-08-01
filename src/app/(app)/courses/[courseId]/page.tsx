// =============================================================================
// /courses/[courseId] — THE GATE. This is the page the whole stream is about.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// HIDING A LINK IS NOT ACCESS CONTROL. The catalog renders no anchor for a
// course the student may not read, and that is worth nothing on its own: a
// student who types /courses/2 must get the same refusal as one who never saw a
// link. This page is where that refusal happens, and it happens BEFORE any
// course content is read from the database — `listCourseWeeks` is not called on
// the denied branch at all, so a denied request cannot leak an outline through a
// render bug further down. The same property `src/components/course/data.ts:12`
// documents for `gateWeek`, enforced the same way.
//
// WHY A REFUSAL PAGE AND NOT A `notFound()` OR A REDIRECT.
// A student with a PENDING request needs to be told it is pending; a student
// with a rejected one needs to be told it was declined and why. A 404 tells both
// of them the course does not exist, so the honest answer to "did anyone look at
// my request?" becomes unreachable and they file it again. The one case that DOES
// render as a flat refusal is `not_found` — a course that does not exist and a
// course that exists but is closed to this student are deliberately given the
// same words (DENIAL_MESSAGE.not_found), so probing ids enumerates nothing.
//
// WHAT AN APPROVED STUDENT SEES, AND THE LIMIT OF IT — stated rather than
// implied. This page renders the course's WEEK OUTLINE (numbers, titles,
// descriptions). It does not render lectures, quizzes or assignments, because
// the surface that serves those (`/weeks`) is hard-wired to the lowest-id course
// by `loadCourseAndWeeks` (src/components/course/data.ts:160) and this stream
// does not own that file. So an approved student of a SECOND course can see what
// it covers and cannot yet study it. That is a real, honest gap, not a rendering
// oversight — see the TODO below.
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";

import { Badge, Card, EmptyState } from "@/components/ui";
// FEATURE 8 (prerequisites stream). The notice is a server component importing only
// the zero-import labels module, so it adds nothing to the client bundle.
import { PrerequisiteNotice } from "@/components/prerequisites";
import { evaluateCoursePrerequisites } from "@/lib/prerequisites/gate";
import { requireUser } from "@/lib/guard";
import { DENIAL_MESSAGE, decideCourseAccess } from "@/lib/courses/policy";
import {
  getActiveCourseId,
  getCourse,
  getOwnRequest,
  listCourseWeeks,
} from "@/lib/courses/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Course",
};

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId: raw } = await params;
  const user = await requireUser(`/courses/${raw}`);

  // `Number(raw)` on a path segment can be NaN, a float, or negative.
  // `decideCourseAccess` rejects all three as not_found; parsing here only
  // decides what to hand it.
  const courseId = Number(raw);

  // Concurrent: none of the three depends on another's result. The own-request
  // read takes the SESSION id — there is no code path on this page that reads a
  // request belonging to anyone else.
  const [course, activeCourseId, ownRequest] = await Promise.all([
    getCourse(courseId),
    getActiveCourseId(),
    Number.isInteger(courseId) && courseId > 0
      ? getOwnRequest(user.id, courseId)
      : Promise.resolve(null),
  ]);

  // FEATURE 8 (prerequisites). A SECOND await, not folded into the Promise.all
  // above, because it needs `activeCourseId`: the open course is never
  // prerequisite-gated, and evaluating without that fact would spend three round
  // trips computing a verdict that cannot apply. The cost is one extra unit of
  // sequential depth — and only on courses that HAVE prerequisites, since
  // `evaluateCoursePrerequisites` short-circuits after one query when the course
  // has no rules, which is every course until an admin authors one.
  //
  // IT IS EVALUATED BEFORE `listCourseWeeks`, which is the property this page's
  // header documents at line 10 and which this stream preserves rather than
  // relaxes: a student refused for an unmet prerequisite has had NO course content
  // read on their behalf.
  const prerequisites = await evaluateCoursePrerequisites(
    user.id,
    courseId,
    activeCourseId,
    user.role,
  );

  const decision = decideCourseAccess({
    courseId,
    activeCourseId,
    role: user.role,
    courseExists: course !== null,
    requestStatus: ownRequest?.status ?? null,
    // ONE decision function, one extra fact. This page does not combine two
    // verdicts — `decideCourseAccess` stays the single authority on course entry,
    // and the prerequisite is an input to it exactly as `requestStatus` is.
    prerequisites,
  });

  if (!decision.allowed) {
    return (
      <div
        className="space-y-4"
        data-testid="course-access-denied"
        data-denial={decision.denial}
      >
        <header>
          <h1 className="text-2xl font-semibold">
            {/* The title is shown ONLY when the denial is not `not_found`. On
                not_found there is nothing to name, and naming a course would
                confirm an id the caller may not know about. */}
            {decision.denial === "not_found" ? "Not available" : course?.title}
          </h1>
        </header>

        <Card>
          <p className="max-w-prose text-sm text-ink" data-testid="denial-message">
            {DENIAL_MESSAGE[decision.denial]}
          </p>
          {decision.denial === "rejected" && ownRequest?.decisionNote && (
            <p className="mt-2 text-sm text-ink-muted" data-testid="denial-note">
              Admin note: {ownRequest.decisionNote}
            </p>
          )}
          {/* FEATURE 8, REQUIREMENT 5: "Locked" with no reason is the failure mode
              the feature exists to remove. `DENIAL_MESSAGE.prerequisite_unmet` is
              deliberately generic — it cannot name a course title from a constant —
              so it must never appear WITHOUT this list beside it. Rendered at HTTP
              200, like a locked week's LockedNotice: locked is not missing, and a
              404 here would destroy the only information this page has to give. */}
          {decision.denial === "prerequisite_unmet" && (
            <div className="mt-3">
              <PrerequisiteNotice unmet={prerequisites.unmet} variant="blocked" />
            </div>
          )}
          <p className="mt-3 text-sm">
            <Link href="/courses" className="text-brand underline underline-offset-2">
              Back to courses
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  // ---- allowed from here; content reads happen only now --------------------
  const weeks = await listCourseWeeks(courseId);
  const isActive = decision.via === "open_course" || courseId === activeCourseId;

  return (
    <div className="space-y-6" data-testid="course-detail" data-course-id={courseId}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{course!.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success" size="sm" data-testid="access-via">
            {decision.via === "staff"
              ? "Staff access"
              : decision.via === "open_course"
                ? "Open to your cohort"
                : "Access approved"}
          </Badge>
          <span className="text-sm text-ink-muted">
            {course!.durationWeeks}-week programme
          </span>
        </div>
        {course!.description && (
          <p className="max-w-prose text-sm text-ink-muted">{course!.description}</p>
        )}
      </header>

      {/* FEATURE 8, REQUIREMENT 4 — the override made visible to the STUDENT, not
          only on the admin console. A record only the granter can read is silent to
          the person it is about, and a student who believes they satisfied a
          prerequisite they did not will be surprised by the next course that cites
          it. Rendered on the ALLOWED branch, because that is where an override has
          an effect. */}
      {prerequisites.overridden && prerequisites.override && (
        <Card>
          <PrerequisiteNotice
            unmet={prerequisites.unmet}
            override={prerequisites.override}
            variant="granted"
          />
        </Card>
      )}

      {isActive ? (
        <Card
          title="Study this course"
          subtitle="Lectures, quizzes and assignments live on the week pages."
        >
          <Link
            href="/weeks"
            className="text-sm text-brand underline underline-offset-2"
            data-testid="go-to-weeks"
          >
            Open the week list
          </Link>
        </Card>
      ) : (
        // TODO(shared-contracts): make /weeks course-aware. `loadCourseAndWeeks`
        // in src/components/course/data.ts:160 selects `FROM courses ORDER BY id
        // ASC LIMIT 1`, so it serves the lowest-id course to everyone and cannot
        // be pointed at this one. That file is owned by the course-content
        // stream, and the fix it needs is the explicit "active course" marker its
        // own TODO at line 123 already asks for. Until then an approved student
        // of a second course can read the outline below and nothing more —
        // which is stated here rather than papered over with a link that would
        // silently serve them the WRONG course's weeks.
        <Card title="Lecture content is not wired up for this course yet">
          <p className="max-w-prose text-sm text-ink-muted">
            Your access is approved. The lecture, quiz and assignment pages
            currently serve one course only, so the outline below is what is
            available here for now.
          </p>
        </Card>
      )}

      <Card title={`Weeks (${weeks.length})`} padded={weeks.length === 0}>
        {weeks.length === 0 ? (
          <EmptyState
            title="No weeks have been authored yet"
            description="This course exists but no week has been added to it."
          />
        ) : (
          <ol className="divide-y divide-line" data-testid="course-week-outline">
            {weeks.map((week) => (
              <li key={week.id} className="px-4 py-3" data-testid={`course-week-${week.weekNumber}`}>
                <p className="text-sm font-semibold text-ink">
                  Week {week.weekNumber} — {week.title}
                </p>
                {week.description && (
                  <p className="text-sm text-ink-muted">{week.description}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
