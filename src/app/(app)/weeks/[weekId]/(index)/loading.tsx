// =============================================================================
// Loading state for /weeks/[weekId] — one week's lecture list.
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
// `(index)` route group, one level deeper than /weeks's own: this route has a
// 404-capable descendant of its own in
// /weeks/[weekId]/lectures/[lectureId], which refuses a lecture that does not
// belong to the [weekId] in the path. The group keeps that route out from under
// this boundary.
//
// The existence of [weekId] itself is decided in ../layout.tsx, which renders
// ABOVE this boundary and above the lectures subtree — one guard for both.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
