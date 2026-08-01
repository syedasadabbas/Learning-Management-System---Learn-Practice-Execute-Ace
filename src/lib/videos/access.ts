// =============================================================================
// AUTHORIZATION FOR VIDEO CURATION — the choice, and why.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// THE CHOICE: ADMIN, not instructor.
//
// The `(staff)` layout already gates this whole subtree with
// `requireRole("instructor")`, and `ROLES_SATISFYING.instructor` is
// ["instructor", "admin"] — so that layer alone would let any instructor approve
// videos. `/admin/videos` and every action here additionally require `"admin"`,
// whose satisfying set is ["admin"] alone.
//
// Why the stricter level:
//   1. APPROVING A VIDEO IS PUBLISHING TO THE WHOLE COHORT. It is a content act,
//      not a teaching act. The precedent in this repo is explicit: quiz and
//      assignment authoring — the other "this changes what every student sees"
//      surfaces — are admin-only, and the (staff) layout's own header comment says
//      an instructor must not reach quiz CRUD. Video curation is the same class of
//      act, so it gets the same level.
//   2. AN EMBED IS THIRD-PARTY CONTENT. An approved id causes every student's
//      browser to load a frame from a domain we do not control. That is a
//      wider blast radius than grading one submission, which is the instructor's
//      actual remit.
//   3. THE AUDIT STAMP MEANS SOMETHING NARROWER. `reviewed_by` on a
//      two-person-wide role is a more useful record than on a role held by every
//      teaching assistant.
//
// THE COST, stated rather than hidden: an instructor who spots a dead video cannot
// clear it themselves; they must ask an admin. If the owner would rather
// instructors curated, the change is one call — swap `requireAdminAction` for a
// `requireStaffAction` equivalent here and `requireRole("admin")` for
// `"instructor"` on the page — and nothing else in the stream depends on it.
//
// No role string is compared to a literal anywhere in this stream: every decision
// routes through `roleSatisfies` in `@/lib/guard`, which reads the frozen
// `ROLES_SATISFYING` table. Re-levelling a role is then a contract edit, not a
// grep across nine streams.
// =============================================================================

import { getSessionUser, roleSatisfies, type AuthUser } from "@/lib/guard";
import type { RouteAuth } from "@/lib/contracts/api";

/** The auth level required to curate videos. One constant, one place to change. */
export const VIDEO_CURATION_AUTH: RouteAuth = "admin";

/**
 * Thrown by the action guards below.
 *
 * A server action has no response envelope and redirecting out of a mutation
 * would throw away the admin's place in a long review queue, so an action refuses
 * by throwing and the caller turns it into a message.
 */
export class VideoForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have access to video curation.") {
    super(message);
    this.name = "VideoForbiddenError";
  }
}

/** Pure decision, unit-tested: may `role` curate videos? */
export function canCurateVideos(role: string | null | undefined): boolean {
  return roleSatisfies(VIDEO_CURATION_AUTH, role);
}

/**
 * Guard every exported server action with this as its FIRST statement. Each
 * exported action is a public HTTP POST target once Next.js compiles it; an
 * unguarded export is an unauthenticated mutation, not a hidden button.
 */
export async function requireVideoCurator(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new VideoForbiddenError("Not signed in.");
  if (!canCurateVideos(user.role)) throw new VideoForbiddenError();
  return user;
}
