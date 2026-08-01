// =============================================================================
// /assignments — the student's submission history. Owner: submissions stream.
// -----------------------------------------------------------------------------
// AUTHORIZATION: `requireUser()` from @/lib/guard, which redirects to /login when
// there is no session. This is not belt-and-braces with middleware.ts — that file
// (owned by the auth stream, not editable from here) lists `/submissions` and
// `/dashboard` as protected prefixes but NOT `/assignments`, so the edge does not
// gate this path and this guard is the actual enforcement. Flagged for the
// coordinator: `{ prefix: "/assignments", required: "student" }` belongs in
// middleware.ts's PROTECTED table as a fast edge reject.
//
// Every row is scoped to `user.id` from the session. There is no student selector.
// =============================================================================

import { AssignmentCard } from "@/components/submissions";
import { Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/guard";
import { getAssignmentHistory } from "@/lib/submissions/history";

export const dynamic = "force-dynamic";

export const metadata = { title: "My submissions" };

export default async function SubmissionHistoryPage() {
  const user = await requireUser("/assignments");
  const items = await getAssignmentHistory(user.id);

  const submittedCount = items.filter((i) => i.status !== "not_submitted").length;
  const gradedCount = items.filter((i) => i.status === "graded").length;
  const earned = items.reduce((sum, i) => sum + (i.score ?? 0), 0);
  const possibleFromGraded = gradedCount * (items[0]?.maxScore ?? 0);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">My submissions</h1>
        <p className="text-sm text-ink-muted">
          One row per assignment. Responses are ingested from the Google Form response sheet once
          an hour, so a form you have just filled in may not appear immediately.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="No assignments yet"
          description="Assignments appear here as each week is published."
        />
      ) : (
        <>
          <Card title="Summary" data-testid="submissions-summary">
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-ink-muted">Submitted</dt>
                <dd className="text-lg font-semibold" data-testid="summary-submitted">
                  {submittedCount} / {items.length}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Graded</dt>
                <dd className="text-lg font-semibold">{gradedCount}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Points from graded work</dt>
                {/*
                  Denominator is the graded assignments only, not the whole course.
                  Dividing by the course total before everything is marked would
                  show a student a falling score as the weeks pass, which is the
                  opposite of what is happening.
                */}
                <dd className="text-lg font-semibold">
                  {earned} / {possibleFromGraded}
                </dd>
              </div>
            </dl>
          </Card>

          <ul className="flex flex-col gap-4">
            {items.map((item) => (
              <li key={item.assignmentId}>
                <AssignmentCard item={item} href={`/assignments/${item.weekId}`} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
