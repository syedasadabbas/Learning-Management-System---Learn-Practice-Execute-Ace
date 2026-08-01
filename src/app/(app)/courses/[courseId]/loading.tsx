// =============================================================================
// Loading state for /courses/[courseId] — one course's outline.
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
// NO layout guard here, and that is deliberate rather than an omission. This
// route never calls `notFound()`: a course that does not exist, a course closed
// to this student, a pending request and a rejected request all render a REFUSAL
// PAGE at 200, because a 404 would tell a student with a pending request that the
// course does not exist and they would file it again (see the header of
// ./page.tsx). Nothing below this boundary has a status code to protect.
//
// The only `notFound()` in that file is a word inside a comment explaining why it
// is not used — which is why `grep -rln "notFound()"` lists this route and no
// guard was written for it.
// =============================================================================

import { PageSkeleton } from "@/components/nav/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}
