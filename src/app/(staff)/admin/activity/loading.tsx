// =============================================================================
// Loading state for /admin/activity — the audit trail.
// -----------------------------------------------------------------------------
// Added by the coordinator. The activity stream added the sidebar row and could
// not add this: a NAV_LINKS href needs a leaf boundary
// (src/lib/navigation/boundary-scope.test.ts asserts one per destination), and
// routing is not that stream's to touch. `boundary-scope.test.ts` caught the gap
// by name — "/admin/activity" was the single entry in its `missing` list — which
// is the third time today that test has caught a nav row landing ahead of its
// boundary, and exactly what it exists for.
//
// Leaf placement, as everywhere. A group-level boundary fires only on first entry
// into the group and swallows the HTTP status of every route beneath it; see
// src/components/nav/PageSkeleton.tsx.
//
// This route needs a boundary more than most. An audit log is the largest table in
// the database by design, and this page filters it by actor, action and time
// range — so it is the slowest read in the staff console and the one most likely
// to be sat in front of while nothing appears to happen.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
