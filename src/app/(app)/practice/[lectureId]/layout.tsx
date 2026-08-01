// =============================================================================
// EXISTENCE GUARD for /practice/[lectureId]
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; interactive-exercises — the query.
//
// WHY A LAYOUT EXISTS HERE AT ALL, WHEN IT RENDERS NOTHING BUT ITS CHILDREN
//
// A `loading.tsx` is a Suspense boundary. The moment its fallback flushes, the
// HTTP response has begun and the status line is already sent as 200 — so a
// `notFound()` reached later still renders the not-found UI but CANNOT change the
// status. The response is a 200 that says "not found", which misleads monitoring,
// crawlers and any API client.
//
// That is not hypothetical. When this app briefly carried one route-group-wide
// `(app)/loading.tsx`, seven previously-passing e2e specs went red — two in
// interactive-exercises, two in interactive-learning, two in coding-problems and
// the locked-week refusal in course-content — every one of them asserting a 404
// and receiving a 200. Content never leaked; only the status was wrong.
//
// A layout renders ABOVE its own segment's loading boundary. So the existence
// decision made here happens BEFORE the stream opens, the 404 is sent correctly,
// and the page below still gets its skeleton. That is the whole trick, and it is
// why the boundary was moved down out of the route group and paired with a guard
// at each route that can 404.
//
// COST: none in round trips. `loadPracticeLecture` is `cache()`d, so the lookup
// here and the page's own lookup are one query per request.
// =============================================================================

import { notFound } from "next/navigation";

import { parseLectureIdParam } from "@/lib/exercises";
import { requireRole } from "@/lib/guard";

import { loadPracticeLecture } from "../exercise-queries";

interface LayoutProps {
  children: React.ReactNode;
  // Next.js 15: route params are async.
  params: Promise<{ lectureId: string }>;
}

export default async function PracticeLectureLayout({ children, params }: LayoutProps) {
  const { lectureId: rawId } = await params;

  // The role check stays here too. It must run before anything streams, for the
  // same reason: a redirect cannot be issued once the response has begun.
  await requireRole("student", `/practice/${rawId}`);

  const lectureId = parseLectureIdParam(rawId);
  if (lectureId === null) notFound();

  const lecture = await loadPracticeLecture(lectureId);
  if (!lecture) notFound();

  return <>{children}</>;
}
