// =============================================================================
// Loading state for /weeks — the week list.
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
// WHY THIS LIVES IN AN `(index)` ROUTE GROUP
// /weeks has two 404-capable descendants: /weeks/[weekId] and
// /weeks/[weekId]/lectures/[lectureId], both of which `notFound()` for an id
// that is not part of the course (deliberately indistinguishable from a locked
// one, so URLs cannot enumerate weeks). A boundary at the /weeks segment would
// cover both and turn those 404s into 200s, and they could NOT have been guarded
// from above, because a layout at /weeks is never handed a [weekId].
//
// A route group is not part of the URL, so /weeks still resolves through
// (index)/page.tsx — but [weekId] is a SIBLING of this group rather than a
// descendant of it, so this boundary cannot reach it. Each of those routes then
// carries its own boundary plus its own layout guard.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
