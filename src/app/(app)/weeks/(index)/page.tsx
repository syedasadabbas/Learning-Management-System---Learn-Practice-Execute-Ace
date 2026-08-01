// =============================================================================
// /weeks — the week list. Owner: course-content stream.
// -----------------------------------------------------------------------------
// Server component. `requireUser()` runs here even though middleware.ts already
// protects the /weeks prefix: middleware is a fast edge reject, this is the
// server-side re-check, and it is also how we obtain the student id the lock
// state is computed for.
//
// RENDERS CORRECTLY WITH AN EMPTY READ MODEL. getWeekProgress is a stub returning
// [] until the progress-tracking stream lands. With [] every week after the first
// is locked with the "pass the Week N quiz" reason, which is exactly the correct
// state for a freshly enrolled student — so this page is not blocked on that
// stream and does not fake data to compensate.
// =============================================================================

import type { Metadata } from "next";

import { SectionHeading } from "@/components/course/SectionHeading";
import { WeekCard } from "@/components/course/WeekCard";
import { getWeekList } from "@/components/course/data";
import { UNLOCK_THRESHOLD_PERCENT } from "@/components/course/lock-state";
import { groupWeeksBySection } from "@/components/course/sections";
import { EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/guard";

export const metadata: Metadata = {
  title: "Course weeks",
};

// Lock state is per-student and changes the moment a quiz is graded, so this
// must never be statically cached.
export const dynamic = "force-dynamic";

export default async function WeeksPage() {
  const user = await requireUser("/weeks");
  const { course, items } = await getWeekList(user.id);

  const unlockedCount = items.filter((w) => !w.lock.locked).length;

  // Group into subject sections. `unsectioned` is normally empty — it holds any
  // week that no configured section claims. Those weeks are LOCKED by rule 0 in
  // lock-state.ts; rendering them under their own heading rather than dropping
  // them means a misconfigured section shows up on the page instead of silently
  // making content disappear. See components/course/sections.ts.
  const { groups, unsectioned } = groupWeeksBySection(items);
  const openSections = groups.filter((g) => g.section.enabled);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{course?.title ?? "Course"}</h1>
        {course?.description && (
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{course.description}</p>
        )}
        <p className="mt-2 text-sm text-ink-muted">
          {items.length === 0
            ? "No weeks published yet."
            : `${openSections.length} of ${groups.length} subjects open · ${unlockedCount} of ${items.length} weeks unlocked. Within an open subject, score ${UNLOCK_THRESHOLD_PERCENT}% or higher on a week's quiz to unlock the next one.`}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="No weeks published yet"
          description="The course content has not been set up for your cohort. Check back shortly, or contact your instructor if this persists."
        />
      ) : (
        <div data-testid="section-list" className="flex flex-col gap-8">
          {groups.map(({ section, weeks }) => (
            <section
              key={section.slug}
              aria-labelledby={`section-${section.slug}`}
              data-testid="course-section"
              data-section-slug={section.slug}
              data-section-enabled={section.enabled ? "true" : "false"}
              className="flex flex-col gap-4"
            >
              <SectionHeading
                slug={section.slug}
                title={section.title}
                subtitle={section.subtitle}
                description={section.description}
                enabled={section.enabled}
                weekCount={weeks.length}
              />

              {/* data-testid="week-list" is kept on every group: the existing
                  e2e specs select week cards through it, and splitting the one
                  list into several must not silently orphan those selectors. */}
              <ul data-testid="week-list" className="grid gap-4 sm:grid-cols-2">
                {weeks.map((week) => (
                  <li key={week.id}>
                    <WeekCard
                      weekId={week.id}
                      weekNumber={week.weekNumber}
                      title={week.title}
                      description={week.description}
                      lectureTotal={week.lectureTotal}
                      dueAt={week.dueAt}
                      lock={week.lock}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {unsectioned.length > 0 && (
            <section
              aria-labelledby="section-unsectioned"
              data-testid="course-section"
              data-section-slug="unsectioned"
              data-section-enabled="false"
              className="flex flex-col gap-4"
            >
              <SectionHeading
                slug="unsectioned"
                title="Not yet assigned to a subject"
                subtitle="Awaiting release"
                description="These weeks exist in the course but have not been placed in a subject yet, so they are not open."
                enabled={false}
                weekCount={unsectioned.length}
              />
              <ul data-testid="week-list" className="grid gap-4 sm:grid-cols-2">
                {unsectioned.map((week) => (
                  <li key={week.id}>
                    <WeekCard
                      weekId={week.id}
                      weekNumber={week.weekNumber}
                      title={week.title}
                      description={week.description}
                      lectureTotal={week.lectureTotal}
                      dueAt={week.dueAt}
                      lock={week.lock}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
