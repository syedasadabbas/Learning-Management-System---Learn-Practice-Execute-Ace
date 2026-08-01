// =============================================================================
// /peer-review/[allocationId] — write one review. Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// THE MOST SENSITIVE STUDENT-FACING ROUTE IN THIS STREAM, because the id in the URL
// is guessable and the thing behind it is another student's work. So:
//
//   1. `requireUser()` first, before anything reads a parameter.
//   2. `getReviewTask(user.id, allocationId)` — the session id is the FIRST argument
//      and it becomes a `where reviewer_id = $1` predicate. A row belonging to
//      another reviewer never reaches this process, so there is no filtering-in-
//      JavaScript step that could be dropped.
//   3. Anything other than `ok` is `notFound()`. Deliberately a 404 and not a 403:
//      distinguishing "not yours" from "does not exist" confirms the existence of
//      another student's allocation to whoever is walking the ids.
//
// THIS PAGE CALLS notFound(), AND THAT IS SAFE HERE. `src/lib/navigation/
// boundary-scope.test.ts` fails any 404-capable route that has a Suspense boundary
// above it without a guard layout at or above that boundary's depth — a `loading.tsx`
// flushes the 200 status line first. There is no loading.tsx anywhere in this route's
// ancestor chain: the index page next door is inside a `(index)` group precisely so
// that a future boundary for /peer-review cannot land above this route. If a
// loading.tsx is ever added to `(app)/peer-review/` itself rather than to
// `(app)/peer-review/(index)/`, this route starts answering 200 for a missing id and
// that test will say so.
// =============================================================================

import { notFound } from "next/navigation";

import { PeerReviewForm } from "@/components/peer-review";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/guard";
import { getReviewTask } from "@/lib/peer-review";

export const dynamic = "force-dynamic";

export const metadata = { title: "Write a peer review" };

export default async function WritePeerReviewPage({
  params,
}: {
  params: Promise<{ allocationId: string }>;
}) {
  const user = await requireUser("/peer-review");
  const { allocationId } = await params;

  const id = Number(allocationId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const loaded = await getReviewTask(user.id, id);
  if (!loaded.ok) {
    // Every refusal reason collapses to 404. See the header: telling a prober the
    // difference between "not yours" and "does not exist" is the leak.
    notFound();
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Write a peer review</h1>
        <p className="text-sm text-ink-muted">
          You are not told whose work this is, and they will not be told who reviewed it. Your
          review does not affect their marks — it is feedback, and an instructor reads it before
          they do.
        </p>
      </header>

      <PeerReviewForm task={loaded.task} criteria={loaded.criteria} />

      <Card title="What makes a useful review" data-testid="review-guidance">
        <ul className="list-inside list-disc text-sm text-ink-muted">
          <li>Name a specific file, page or behaviour rather than saying &ldquo;good job&rdquo;.</li>
          <li>Say one thing that works and one thing you would change.</li>
          <li>Score each criterion honestly — an instructor can see every review and its author.</li>
        </ul>
      </Card>
    </main>
  );
}
