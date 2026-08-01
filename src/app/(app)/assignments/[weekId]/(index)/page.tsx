// =============================================================================
// /assignments/[weekId] — one week's assignment brief, submission link, status.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// The SKILL.md sketch put this page at (app)/course/[weekId]/assignment. It lives
// under (app)/assignments/[weekId] instead, because `(app)/course/**` is the
// course-content stream's route segment and two streams creating files in one
// segment is how a parallel build corrupts itself. Same content, same data, a
// path this stream owns. Flagged for the coordinator: course-content's week page
// should link here.
//
// AUTHORIZATION: `requireUser()`. See the note in ../page.tsx about
// `/assignments` being absent from middleware.ts's protected prefixes.
//
// The week is NOT checked for unlock state here. Unlock is the course-content /
// progress-tracking read model, and duplicating that rule in this stream would
// create a second definition of "locked" that can disagree with the first.
// TODO(coordination): once progress-tracking exposes its read model, gate this
// page on the same unlock decision the week list uses.
// =============================================================================

import { notFound } from "next/navigation";

import { AssignmentCard, SubmitLink } from "@/components/submissions";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/guard";
// NOTE: the loader is imported from src/lib/navigation/guards.ts, not from its own
// module. That wrapper is the shared React `cache()` memo, and the sibling
// layout.tsx guard calls the SAME one — which is what makes this route's 404
// correct (the guard runs above this route's loading.tsx boundary, where the HTTP
// status is still settable) without paying for the query twice at ~245 ms a round
// trip. See that file and src/components/nav/PageSkeleton.tsx.
import { loadAssignmentForWeek } from "@/lib/navigation/guards";

export const dynamic = "force-dynamic";

export default async function WeekAssignmentPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  // Next.js 15: dynamic params are async.
  const { weekId: rawWeekId } = await params;
  const weekId = Number(rawWeekId);
  if (!Number.isInteger(weekId) || weekId <= 0) notFound();

  const user = await requireUser(`/assignments/${weekId}`);
  const item = await loadAssignmentForWeek(weekId, user.id);
  if (!item) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <p className="text-sm text-ink-muted">
          Week {item.weekNumber} — {item.weekTitle}
        </p>
        <h1 className="text-2xl font-semibold">{item.assignmentTitle}</h1>
      </header>

      <Card title="Brief">
        <p className="whitespace-pre-wrap text-sm text-ink-muted">{item.description}</p>
      </Card>

      <Card title="Submit your work">
        <SubmitLink googleFormUrl={item.googleFormUrl} assignmentTitle={item.assignmentTitle} />
      </Card>

      <AssignmentCard item={item} showRequirements />
    </main>
  );
}
