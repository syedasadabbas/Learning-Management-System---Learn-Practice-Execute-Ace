// =============================================================================
// /weeks/[weekId] — lecture list for one week. Owner: course-content stream.
// -----------------------------------------------------------------------------
// GATED SERVER-SIDE. `gateWeek` resolves the student's own lock state and this
// page renders the refusal instead of the lecture list when the week is locked.
// Hiding the card on /weeks is a UX affordance; this is the control.
//
// A week id that does not belong to the course produces notFound() — the same
// response as a nonexistent id, so the URL cannot be used to enumerate weeks.
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LockedNotice } from "@/components/course/LockedNotice";
import { gateWeek, getLectureSummaries, getWeekList } from "@/components/course/data";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Week",
};

interface PageProps {
  // Next.js 15: dynamic route params are a Promise.
  params: Promise<{ weekId: string }>;
}

export default async function WeekDetailPage({ params }: PageProps) {
  const { weekId: rawWeekId } = await params;
  const weekId = Number(rawWeekId);

  const user = await requireUser(`/weeks/${rawWeekId}`);
  const gate = await gateWeek(user.id, weekId);

  if (!gate.ok && gate.kind === "not_found") notFound();

  if (!gate.ok) {
    // Locked. Offer a link back to the week the student must pass first.
    const { items } = await getWeekList(user.id);
    const previous = items.find((w) => w.weekNumber === gate.lock.weekNumber - 1);

    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <LockedNotice
          weekNumber={gate.lock.weekNumber}
          title={gate.lock.title}
          reason={gate.lock.reason ?? "This week is not yet available."}
          previousWeekId={previous?.id}
        />
      </main>
    );
  }

  const { week, lock } = gate;
  const lectureList = await getLectureSummaries(week.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link href="/weeks" className="text-brand underline underline-offset-2">
          All weeks
        </Link>
      </nav>

      <header className="mb-5">
        <h1 data-testid="week-title" className="text-2xl font-bold text-ink">
          Week {week.weekNumber}: {week.title}
        </h1>
        {week.description && (
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{week.description}</p>
        )}
        <p className="mt-2 text-sm text-ink-muted">
          {lock.lecturesCompleted} of {lock.lectureTotal} lectures completed.
        </p>
      </header>

      {lectureList.length === 0 ? (
        <EmptyState
          title="No lectures in this week yet"
          description="This week has been created but its lectures have not been published."
        />
      ) : (
        <ul data-testid="lecture-list" className="space-y-3">
          {lectureList.map((lecture) => (
            <li key={lecture.id}>
              <Link
                href={`/weeks/${week.id}/lectures/${lecture.id}`}
                className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <Card
                  interactive
                  data-testid="lecture-card"
                  title={`${lecture.lectureNumber}. ${lecture.title}`}
                  action={
                    <div className="flex gap-1">
                      <Badge tone={lecture.hasVideo ? "brand" : "neutral"} size="sm">
                        {lecture.hasVideo ? "Video" : "No video yet"}
                      </Badge>
                      {lecture.linkResourceCount > 0 && (
                        <Badge tone="accent" size="sm">
                          {lecture.linkResourceCount} practice link
                          {lecture.linkResourceCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                  }
                >
                  <span className="text-sm text-ink-muted">Open lecture →</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
