// =============================================================================
// Loading state for /badges — the achievements grid.
// -----------------------------------------------------------------------------
// WRITTEN BY THE BADGES STREAM, WHICH DOES NOT OWN ROUTING, AND HERE IS WHY.
//
// This file exists because src/lib/navigation/boundary-scope.test.ts asserts that
// EVERY sidebar destination has a loading boundary, and the badges stream added a
// sidebar row. Without it the unit suite goes red — so the choice was between
// leaving a nav link out (making /badges reachable only by typing the URL) and
// adding the boundary the repo's own contract requires. It carries no routing
// decision of its own: it is the same two-line delegation to `PageSkeleton` as the
// other thirty-odd loading.tsx files, and the SHAPE it paints is decided elsewhere,
// by the "/badges" rule in src/lib/navigation/loading-shape.ts.
//
// A loading.tsx is a Suspense boundary, so it must sit at a LEAF: a group-level
// boundary shows only on first entry into the group (so it would never fire on a
// sidebar click) and it swallows the HTTP status of every route beneath it. The
// full account is in src/components/nav/PageSkeleton.tsx. /badges has no children
// and never calls `notFound()`, so neither hazard applies here.
//
// This route genuinely needs the boundary rather than merely satisfying a test:
// the page re-evaluates every badge criterion on read (the backfill path argued in
// src/lib/badges/queries.ts:60-79), which is a facts query plus at most one insert
// — measured at ~250-500 ms against this Neon instance. That is well inside the
// window where a frozen page is what a user notices.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
