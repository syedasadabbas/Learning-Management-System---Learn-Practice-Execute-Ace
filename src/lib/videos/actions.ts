"use server";

// =============================================================================
// SERVER ACTIONS — approve / reject / return-to-queue. video-ingestion stream.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// WHY ACTIONS AND NOT API ROUTES. `ROUTES` in `@/lib/contracts/api` is frozen and
// contains no video endpoint. Adding `POST /api/videos/:id/approve` would create a
// path with no entry in `ROUTE_AUTH` — the unguarded-by-omission bug that map
// exists to prevent. Server actions keep the mutation inside the frozen contract
// while still being guarded.
//
// EVERY EXPORT HERE IS AN HTTP-REACHABLE POST TARGET. The first statement of each
// one is `requireVideoCurator()` (admin — see access.ts for the reasoning and its
// cost). No exception, and any action added later must open the same way.
//
// Actions return a result object instead of throwing across the RSC boundary: a
// thrown error reaches the browser as a generic "unexpected response", which tells
// an admin nothing about whether the video they just approved is now live.
//
// REVALIDATION covers /admin/videos (the queue the admin is looking at) and
// /weeks (where an approved video becomes visible to students). Without the second
// one an approval would appear to do nothing until the route cache aged out.
// =============================================================================

import { revalidatePath } from "next/cache";

import { requireVideoCurator, VideoForbiddenError } from "./access";
import { resetVideoToCandidate, setVideoStatus } from "./store";

export type VideoActionResult =
  | { ok: true; status: "approved" | "rejected" | "candidate" }
  | { ok: false; error: string };

function fail(error: string): VideoActionResult {
  return { ok: false, error };
}

function toFailure(error: unknown): VideoActionResult {
  if (error instanceof VideoForbiddenError) return fail(error.message);
  // A database error string in the browser is an information leak.
  console.error("[video-ingestion] action failed", error);
  return fail("The review decision could not be saved. Please try again.");
}

function validId(videoId: unknown): number | null {
  const n = Number(videoId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function revalidate(): void {
  revalidatePath("/admin/videos");
  // Lecture pages live under /weeks/[weekId]/lectures/[lectureId]; revalidating
  // the segment root is the cheapest way to let an approval show up for students.
  revalidatePath("/weeks");
}

/**
 * Approve a candidate: this is the act that puts a video in front of the cohort.
 * `setVideoStatus` stamps `reviewed_by`/`reviewed_at` in the same UPDATE, so an
 * approved row without an accountable reviewer is not a reachable state.
 */
export async function approveVideoAction(videoId: unknown): Promise<VideoActionResult> {
  try {
    const user = await requireVideoCurator();
    const id = validId(videoId);
    if (!id) return fail("Invalid video id.");

    const changed = await setVideoStatus(id, "approved", user.id);
    if (!changed) return fail("That candidate no longer exists.");

    revalidate();
    return { ok: true, status: "approved" };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Reject a candidate. The row is KEPT (not deleted) so that re-running the
 * harvester over the same curated list does not push a video an admin already
 * refused back into the queue every week.
 */
export async function rejectVideoAction(videoId: unknown): Promise<VideoActionResult> {
  try {
    const user = await requireVideoCurator();
    const id = validId(videoId);
    if (!id) return fail("Invalid video id.");

    const changed = await setVideoStatus(id, "rejected", user.id);
    if (!changed) return fail("That candidate no longer exists.");

    revalidate();
    return { ok: true, status: "rejected" };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Undo a decision. Exists because approval is a publishing act and a misclick
 * that reaches a cohort needs a one-click retraction, not a database session.
 * Clears the review stamp so it cannot claim a reviewer vouched for the current
 * state.
 */
export async function returnVideoToQueueAction(
  videoId: unknown,
): Promise<VideoActionResult> {
  try {
    await requireVideoCurator();
    const id = validId(videoId);
    if (!id) return fail("Invalid video id.");

    const changed = await resetVideoToCandidate(id);
    if (!changed) return fail("That video no longer exists.");

    revalidate();
    return { ok: true, status: "candidate" };
  } catch (error) {
    return toFailure(error);
  }
}
