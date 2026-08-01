// =============================================================================
// Loading state for /practice — the practice index.
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
// `(index)` route group, for the same reason /weeks uses one: /practice has two
// 404-capable siblings — /practice/[lectureId] (guarded since 7055ff7) and
// /practice/concept/[conceptId] — and a boundary on the /practice segment itself
// would commit a 200 before either guard could run. Being in the group scopes
// this boundary to the index page alone.
//
// ../error.tsx is deliberately NOT moved in here. An error boundary SHOULD cover
// the whole practice subtree; it is only the loading boundary that has to be
// narrow.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
