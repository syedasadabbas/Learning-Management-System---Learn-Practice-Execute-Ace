// =============================================================================
// Loading state for /notifications — the student's notification history.
// -----------------------------------------------------------------------------
// Added by the coordinator, not by the notifications stream, because a sidebar row
// requires TWO things that stream was told not to touch: this boundary (asserted
// by src/lib/navigation/boundary-scope.test.ts for every nav destination) and a
// shape rule in src/lib/navigation/loading-shape.ts. The certificates and badges
// streams both hit the same wall today; badges added the pair itself and flagged
// it, certificates reverted its nav row rather than break a shared suite. Adding
// the pair here is what lets the row exist at all.
//
// Leaf placement, like every other boundary in this app. A group-level one shows
// only on first entry into the group — so it would never fire on a sidebar click,
// which was the original defect — and it swallows the HTTP status of everything
// beneath it, which turned seven passing 404 assertions into 200s. The full
// account is in src/components/nav/PageSkeleton.tsx. /notifications has no
// children and never calls notFound(), so neither hazard applies.
//
// A boundary is genuinely warranted rather than merely required by a test: the
// page reads a 50-row history joined against its preference row, on a
// force-dynamic route where a warm Neon round trip is ~245 ms
// (scripts/perf-roundtrips.ts).
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
