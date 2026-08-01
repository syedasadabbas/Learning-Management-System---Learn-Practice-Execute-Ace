// =============================================================================
// Loading state for /certificates — the student's credential gallery.
// -----------------------------------------------------------------------------
// Added by the coordinator. The certificates stream WROTE a sidebar row and then
// reverted it, because a NAV_LINKS href needs both this boundary
// (src/lib/navigation/boundary-scope.test.ts asserts one per nav destination) and
// a rule in src/lib/navigation/loading-shape.ts, and it was told not to touch
// routing. Reverting rather than leaving two shared suites red was the right call;
// this file plus the shape rule is the other half of it, so /certificates stops
// being reachable only by typing the URL.
//
// Leaf placement, as everywhere else. A group-level boundary fires only on first
// entry into the group and swallows the HTTP status of every route beneath it —
// see src/components/nav/PageSkeleton.tsx for what that cost. /certificates has
// no dynamic children under it that 404 (the PDF and verify routes live at
// /api/certificates and /verify), so neither hazard applies.
//
// Warranted on its own merits: issuing is idempotent but the gallery still reads
// the student's rows on a force-dynamic route, and a certificate is the page a
// student is most likely to open expecting something immediately.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
