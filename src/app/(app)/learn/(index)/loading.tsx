// =============================================================================
// Loading state for /learn — the track list.
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
// `(index)` route group: /learn/[track] 404s when a track has no PUBLISHED
// modules, and /learn/[track]/[moduleSlug] 404s for an unpublished or
// mismatched slug. Both of those responses are what stops a draft curriculum
// being enumerable by URL, so turning them into 200s would leak the existence of
// unpublished content. Scoping the boundary to the index page keeps them intact;
// each has its own boundary and layout guard.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
