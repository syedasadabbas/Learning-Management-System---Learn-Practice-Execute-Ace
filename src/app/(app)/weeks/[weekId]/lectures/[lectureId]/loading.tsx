// =============================================================================
// Loading state for /weeks/[weekId]/lectures/[lectureId] — the lecture view.
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
// The deepest route in the student app and, at 512 ms across 4 statements
// (scripts/perf-roundtrips.ts), one of the slowest — so it is worth a skeleton
// on the click from the week's lecture list.
//
// Safe because ./layout.tsx resolves the lecture and its week ABOVE this
// boundary, and because neither ../../(index)/loading.tsx nor
// ../../../(index)/loading.tsx is an ancestor of this segment: both are inside
// `(index)` route groups precisely so that they are not.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
