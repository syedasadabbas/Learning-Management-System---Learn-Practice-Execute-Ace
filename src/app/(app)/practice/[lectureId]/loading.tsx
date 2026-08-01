// =============================================================================
// Loading state for /practice/[lectureId].
// -----------------------------------------------------------------------------
// Placed at the ROUTE, not at the (app) route group. Two reasons, both learned by
// doing it the other way first:
//
//   1. STATUS CODES. A group-level boundary streams every descendant, so every
//      `notFound()` in the group returned HTTP 200 (see ./layout.tsx). A boundary
//      here only covers this route, and this route's layout guards it.
//
//   2. IT ACTUALLY FIRES. A group-level `loading.tsx` shows when you first enter
//      the group, NOT when one child segment swaps for a sibling — so clicking
//      between sidebar destinations painted nothing, which was the entire point.
//      A boundary at the leaf fires on that navigation.
//
// The shape comes from the pathname, so this file needs no props.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
