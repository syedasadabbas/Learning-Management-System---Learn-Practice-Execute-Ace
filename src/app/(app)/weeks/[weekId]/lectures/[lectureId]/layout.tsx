// =============================================================================
// EXISTENCE GUARD for /weeks/[weekId]/lectures/[lectureId].
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; course-content — the gate it calls.
//
// Same mechanism as ../../layout.tsx: this route has its own `loading.tsx`, a
// `loading.tsx` is a Suspense boundary, and once its fallback flushes the status
// is committed as 200. The layout renders above that boundary, so the `notFound()`
// here is the one that can still set 404. See src/components/nav/PageSkeleton.tsx.
//
// WHAT THIS ADDS THAT THE WEEK'S GUARD CANNOT. The layout two levels up already
// refuses a [weekId] that is not part of the course, but it is never handed a
// [lectureId]. `gateLecture` decides the two facts only this segment knows:
//   1. the lecture exists at all, and
//   2. it belongs to the [weekId] in the path — so /weeks/1/lectures/12 cannot
//      serve a Week 4 lecture through a Week 1 URL, which would otherwise pass
//      the week guard above cleanly.
//
// LOCKED IS NOT MISSING: only `not_found` is a 404 here. A locked week still
// renders LockedNotice at 200 from the page below, because the refusal has to
// explain itself and name the week that must be passed first.
//
// COST: one round trip, not two. `loadLectureGate` is the `cache()`d wrapper in
// src/lib/navigation/guards.ts and the page imports the SAME wrapper, so the
// guard's lookup and the render's lookup are one query. `gateLecture` needed the
// wrapper where `gateWeek` did not, because it issues its own `SELECT` against
// `lectures` on top of the already-memoised week list — ~245 ms
// (scripts/perf-roundtrips.ts) that would have been paid twice.
// =============================================================================

import { notFound } from "next/navigation";

import { requireUser } from "@/lib/guard";
import { loadLectureGate } from "@/lib/navigation/guards";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ weekId: string; lectureId: string }>;
}

export default async function LectureLayout({ children, params }: LayoutProps) {
  const { weekId: rawWeekId, lectureId: rawLectureId } = await params;

  const user = await requireUser(`/weeks/${rawWeekId}/lectures/${rawLectureId}`);

  const weekId = Number(rawWeekId);
  const lectureId = Number(rawLectureId);
  if (!Number.isInteger(weekId) || weekId <= 0) notFound();

  const gate = await loadLectureGate(user.id, lectureId, weekId);
  if (!gate.ok && gate.kind === "not_found") notFound();

  return <>{children}</>;
}
