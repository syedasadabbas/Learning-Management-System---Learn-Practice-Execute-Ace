// =============================================================================
// /instructor/peer-review — open, allocate, release, withhold.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// AUTHORIZATION: `requireRole("instructor")`, which `ROLES_SATISFYING.instructor`
// also satisfies for admins — an admin covering for an instructor should not need a
// role change, the same choice src/app/api/instructor/submissions/[id]/grade/route.ts
// documents. src/middleware.ts additionally lists `/instructor` as an `instructor`
// prefix, so this path IS gated at the edge as well; unlike /peer-review, this guard
// is defence in depth rather than the only defence.
//
// THIS PAGE NEVER CALLS notFound(), AND MUST NOT START.
// `(staff)/instructor/loading.tsx` is a Suspense boundary at depth 2 of this route's
// ancestor chain, and there is no guard layout at or above that depth. By the rule in
// src/lib/navigation/boundary-scope.test.ts, a `notFound()` reached below that
// boundary would render the not-found UI under a 200 status. So an unknown round is
// rendered as an absence — an empty list — which is also the honest thing for a page
// whose whole job is to list what exists.
//
// THE PAGE IS A SERVER COMPONENT AND THE CONTROLS ARE A CLIENT ISLAND. All four
// mutations are server actions guarded independently (src/lib/peer-review/actions.ts),
// so the buttons being rendered is not what authorizes them.
// =============================================================================

import { RoundAdminPanel } from "@/components/peer-review";
import { Card, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { getRoundOverview, listRounds } from "@/lib/peer-review";

export const dynamic = "force-dynamic";

export const metadata = { title: "Peer review" };

export default async function InstructorPeerReviewPage() {
  await requireRole("instructor", "/instructor/peer-review");

  const rounds = await listRounds();
  // One overview per round. Sequential rather than parallel would be N round trips
  // in series; `Promise.all` makes it N in parallel, which on this Neon instance is
  // the difference between ~245 ms and ~245 ms × N (see src/db/index.ts).
  const overviews = await Promise.all(rounds.map((round) => getRoundOverview(round.roundId)));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Peer review</h1>
        <p className="text-sm text-ink-muted">
          Allocate reviewers, read what they wrote, and release feedback to the students it is
          about. Nothing here changes anyone&apos;s marks: peer review awards no points, so a
          student who writes empty reviews gains nothing — but they can still waste a
          classmate&apos;s feedback, which is what withholding is for.
        </p>
      </header>

      {rounds.length === 0 ? (
        <EmptyState
          title="No peer-review rounds yet"
          description={
            <>
              A round is opened per assignment. Open one from the admin assignments screen, or
              run the seed script for the demo cohort. Peer review needs at least two submitted
              assignments before anyone can be paired.
            </>
          }
        />
      ) : (
        <>
          <Card title="Rounds" data-testid="rounds-summary">
            <p className="text-sm text-ink-muted">
              {rounds.length} round(s).{" "}
              {rounds.filter((r) => r.releasedAt != null).length} released,{" "}
              {rounds.filter((r) => r.allocatedAt == null).length} not yet allocated.
            </p>
          </Card>

          {rounds.map((round, i) => (
            <RoundAdminPanel key={round.roundId} round={round} overview={overviews[i]} />
          ))}
        </>
      )}
    </main>
  );
}
