// =============================================================================
// Loading state for /instructor — the cohort overview.
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
// This boundary also spans /instructor/grading, /instructor/students and
// /instructor/analytics, which is harmless — no staff route calls `notFound()`.
// It is NOT sufficient for them, though: an ancestor boundary that has already
// resolved does not re-show when one child segment swaps for a sibling, which is
// the exact reason the old route-group boundary never fired. Each subpage
// therefore has its own loading.tsx as well, and the nearest boundary is the one
// that paints.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
