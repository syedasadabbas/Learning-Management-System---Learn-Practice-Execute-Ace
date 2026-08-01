// =============================================================================
// Loading state for /problems — the practice problem browser.
// -----------------------------------------------------------------------------
// A loading.tsx is a Suspense boundary, so it decides two things at once: what a
// pending navigation paints, and whether a `notFound()` below it can still set
// the HTTP status. It must therefore sit at a LEAF — a group-level boundary shows
// only on first entry into the group (so it never fired on a sidebar click, which
// was the whole point) and it swallows the status code of every route beneath it.
// The full account, with the seven e2e specs that caught the second failure, is
// in src/components/nav/PageSkeleton.tsx.
//
// The shape is chosen from the pathname the router has already committed to, so
// this file needs no props. See src/lib/navigation/loading-shape.ts.
//
// `(index)` route group: /problems/[slug] 404s for an unknown slug AND for a
// slug belonging to the interview bank, which is a real access decision (the
// level ladders are scoped per bank) and must not be answered with a 200.
//
// This is also the slowest page measured in the app — 1002 ms
// (scripts/perf-probe.ts, 2026-07-31) — so it is the one that most needed a
// skeleton and the one where getting the scoping wrong would have cost the most.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
