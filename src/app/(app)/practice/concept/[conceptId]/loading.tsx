// =============================================================================
// Loading state for /practice/concept/[conceptId] — one animated explainer.
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
// Guarded from ./layout.tsx. That guard is the cheapest one in the app: the
// concept registry is a static table in src/lib/exercises, so the existence
// decision costs no round trip at all and needs no `cache()` wrapper.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
