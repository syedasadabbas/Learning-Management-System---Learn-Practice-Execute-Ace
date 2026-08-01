// =============================================================================
// /peer-review — the student's peer-review home. Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// Two halves, and they are two different authorization stories on one page:
//   REVIEWS I OWE      — scoped by `reviewer_id = session user` in SQL.
//   FEEDBACK I RECEIVED — scoped by `reviewee_id = session user` in SQL, AND gated on
//                         the instructor's release switch, AND stripped of every
//                         reviewer identity by the read model's own type.
//
// AUTHORIZATION: `requireUser()` from @/lib/guard, which redirects to /login when
// there is no session. THIS IS THE ACTUAL ENFORCEMENT, not belt-and-braces:
// src/middleware.ts (owned by the auth stream, not editable from here) lists
// /dashboard, /weeks, /quizzes and others in its PROTECTED table but NOT
// /peer-review, so the edge does not gate this path. The same gap exists for
// /assignments and is flagged in that page's header in the same words.
//   TODO(auth): `{ prefix: "/peer-review", required: "student" }` belongs in
//   src/middleware.ts's PROTECTED table as a fast edge reject. Flagged to the
//   coordinator; the guard below is correct either way.
//
// WHY THIS PAGE LIVES IN A `(index)` ROUTE GROUP. `/peer-review/[allocationId]` can
// `notFound()`, and src/lib/navigation/boundary-scope.test.ts enforces that a
// Suspense boundary must never sit above a 404-capable route without a guard layout
// at or above it — a `loading.tsx` flushes the 200 status line before the page can
// set 404. Putting this page in `(index)` means a future `loading.tsx` beside it
// covers only this route and not its dynamic sibling, which is the validated pattern
// used by /assignments, /weeks, /problems and /learn.
//   NOTE FOR THE COORDINATOR: this stream ships NO loading.tsx and NO nav row, on
//   purpose (routing files are the parent's). If /peer-review is added to NAV_LINKS,
//   two shared tests need it to arrive with (a) `(index)/loading.tsx` and (b) a rule
//   in src/lib/navigation/loading-shape.ts — suggested `{ prefix: "/peer-review",
//   shape: "list", count: 3 }`, matching /assignments, which this page's layout is
//   modelled on.
// =============================================================================

import { ReceivedReviews, ReviewTaskList } from "@/components/peer-review";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/guard";
import { getMyReviewTasks, getReceivedReviews } from "@/lib/peer-review";

export const dynamic = "force-dynamic";

export const metadata = { title: "Peer review" };

export default async function PeerReviewPage() {
  const user = await requireUser("/peer-review");

  // Two independent queries rather than one join: they are scoped by DIFFERENT
  // columns (`reviewer_id` and `reviewee_id`) and have different privacy rules, and
  // src/lib/peer-review/reviews.ts's header argues at length why those must not
  // become one function.
  const [tasks, received] = await Promise.all([
    getMyReviewTasks(user.id),
    getReceivedReviews(user.id),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Peer review</h1>
        <p className="text-sm text-ink-muted">
          You review classmates&apos; work anonymously, and classmates review yours. Peer
          feedback does not change anyone&apos;s marks — your assignment score comes from your
          instructor&apos;s rating only.
        </p>
      </header>

      <section aria-labelledby="reviews-i-owe">
        <h2 id="reviews-i-owe" className="mb-3 text-lg font-semibold">
          Reviews to write
        </h2>
        <ReviewTaskList tasks={tasks} />
      </section>

      <section aria-labelledby="feedback-received">
        <h2 id="feedback-received" className="mb-3 text-lg font-semibold">
          Feedback on your work
        </h2>
        <ReceivedReviews groups={received} />
      </section>

      <Card title="How this works" data-testid="peer-review-explainer">
        <ul className="list-inside list-disc text-sm text-ink-muted">
          <li>
            You are given work to review only if you submitted the assignment yourself.
          </li>
          <li>You never review your own submission.</li>
          <li>
            Reviews are anonymous: the person you review is never told who reviewed them.
          </li>
          <li>A submitted review cannot be edited.</li>
          <li>
            An instructor reads reviews before releasing them, so feedback on your work
            appears only once they have.
          </li>
        </ul>
      </Card>
    </main>
  );
}
