// =============================================================================
// Loading state for /forums — the per-week discussion index.
// -----------------------------------------------------------------------------
// WRITTEN BY THE FORUMS STREAM, WHICH DOES NOT OWN ROUTING, AND HERE IS WHY.
//
// src/lib/navigation/boundary-scope.test.ts asserts that EVERY sidebar
// destination has a loading boundary, and this stream added a sidebar row
// ("Discussions" -> /forums). Without this file the unit suite goes red, so the
// choice was between leaving the nav row out — making the whole feature reachable
// only by typing a URL, against a roadmap success metric of "50+ posts per week" —
// and adding the boundary the repo's own contract requires. Same call, for the
// same stated reason, as src/app/(app)/badges/loading.tsx in this wave.
//
// It carries NO routing decision of its own: it is the same two-line delegation to
// `PageSkeleton` as the other thirty-odd loading.tsx files, and the SHAPE it paints
// is decided elsewhere, by the "/forums" rule in src/lib/navigation/loading-shape.ts.
//
// WHY THIS LIVES IN AN `(index)` ROUTE GROUP — copied from
// src/app/(app)/weeks/(index)/loading.tsx, whose header explains it in full.
//
// A loading.tsx is a Suspense boundary, so it covers its segment AND everything
// nested beneath it. /forums has two 404-capable descendants:
// /forums/[weekId] and /forums/[weekId]/[topicId], both of which `notFound()` for
// an id that is not part of the active course — deliberately indistinguishable
// from a withheld one, so a URL cannot enumerate the weeks of courses a student is
// not enrolled in. A boundary placed at the `forums` segment would cover both and
// turn those 404s into 200s, and they could NOT have been guarded from above:
// a layout at /forums is never handed a [weekId].
//
// A route group is not part of the URL, so /forums still resolves through
// (index)/page.tsx — but [weekId] is a SIBLING of this group rather than a
// descendant of it, so this boundary cannot reach it.
//
// The two dynamic routes deliberately get NO boundary of their own. They are not
// sidebar destinations, so nothing requires one, and adding one would mean also
// adding the layout.tsx guard that keeps their `notFound()` honest — and
// layout.tsx belongs to the routing owner, not to this stream.
// TODO(routing): if a boundary is wanted on the thread pages, it needs
// forums/[weekId]/layout.tsx calling notFound() for a non-numeric segment, exactly
// as src/app/(app)/weeks/[weekId]/layout.tsx does.
//
// This route genuinely needs the boundary rather than merely satisfying a test:
// the page issues three statements at sequential depth 1 — the week list with the
// student's own lock state, plus the per-week topic aggregate — measured at ~245 ms
// per Neon round trip (docs/SUBJECT_SECTIONS.md appendix). That is inside the
// window where a frozen previous page is what a reader notices.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
