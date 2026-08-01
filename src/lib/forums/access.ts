// =============================================================================
// SESSION-BOUND FORUM GATES — where the READ decision is inherited, not invented.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// `policy.ts` decides who may WRITE to a row. This file decides who may reach a
// week's forum at all, and it decides it by ASKING `gateWeek` — the derivation
// that already exists — rather than by writing a fourth visibility rule.
//
// Split in two so the write rules stay unit-testable without a session (see
// policy.test.ts), which is the same split src/lib/courses/access.ts:8 makes
// against src/lib/courses/policy.ts and src/lib/videos/access.ts makes between
// `canCurateVideos` and `requireVideoCurator`.
//
// =============================================================================
// WHY `gateWeek` AND NOT A NEW CHECK — the requirement "a student must not read a
// thread in a course they have no access to", answered by reuse.
// =============================================================================
//
// `gateWeek` (src/components/course/data.ts:338) already resolves, as ONE answer:
//
//   * COURSE ACCESS — it serves only the active course's weeks
//     (`loadCourseAndWeeks`: `FROM courses ORDER BY id ASC LIMIT 1`), and
//     src/lib/courses/policy.ts:36-48 records that the active course is the open
//     one every enrolled student may read. A week id belonging to any OTHER
//     course is simply absent from the list `gateWeek` searches, so it returns
//     `not_found` — the same answer as a nonexistent id, which is what stops a
//     probe enumerating another course's weeks.
//   * SECTION RELEASE — the withheld-subject switch in
//     `appConfig.curriculumSections`, per docs/SUBJECT_SECTIONS.md.
//   * QUIZ PROGRESSION — `shouldUnlockNextWeek`.
//
// A THREAD IS ANCHORED TO A WEEK precisely so that this is the whole answer. Had
// forums re-derived visibility from, say, `users.cohort_id`, there would now be
// two rules for "can this student see week 3 material" and the forum copy would
// be the one that drifts — and, as src/components/course/data.ts:350 puts it,
// "the copy that drifts is always the one guarding the deeper URL". Withdrawing
// the CSS3 subject tomorrow closes its discussion with it, automatically, because
// nothing here knows what a subject is.
//
// WHAT THIS INHERITS, STATED HONESTLY: docs/SUBJECT_SECTIONS.md:109-116 records
// that `gateWeek` is student-scoped and takes no role, so an instructor sees the
// same section locks as a student and there is no staff preview of a withheld
// subject. That applies to forums unchanged. A moderator therefore cannot moderate
// a withheld week's threads — which is currently harmless (a withheld week has no
// students in it to post) and is the pre-existing behaviour rather than a
// regression this stream introduced. If a staff preview is ever wanted it belongs
// in `deriveWeekLockStates`, not as a bypass here.
//
// EVERY EXPORTED SERVER ACTION IN THIS STREAM OPENS WITH ONE OF THESE. Once
// Next.js compiles an action, the export IS a public HTTP POST endpoint — the
// button that calls it is markup, not a control (src/lib/courses/access.ts:12).
// =============================================================================

import { gateWeek, type WeekGate } from "@/components/course/data";
import { getSessionUser, requireUser, type AuthUser } from "@/lib/guard";

/**
 * Thrown by the write guards below and caught by each action's `catch`.
 *
 * Actions refuse by THROWING rather than redirecting, for the reason
 * src/lib/courses/access.ts:25 gives: `redirect()` inside a mutation throws away
 * the reader's place in the thread, and a raw thrown Error reaches the browser as
 * a generic "unexpected response" that tells nobody whether the post was saved.
 * Each action converts this into a typed result object instead.
 */
export class ForumForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have access to this discussion.") {
    super(message);
    this.name = "ForumForbiddenError";
  }
}

/**
 * Copy for a refused read. Identical for "no such week" and "another course's
 * week" on purpose — see the header. A message that distinguished them would let
 * a student enumerate the weeks of courses they are not enrolled in.
 */
export const FORUM_NOT_FOUND_MESSAGE =
  "That discussion does not exist, or is not available to you.";

// ---------------------------------------------------------------------------
// Page-side reads
// ---------------------------------------------------------------------------

/**
 * The signed-in user, or a redirect to /login carrying `next`.
 *
 * A thin pass-through over `requireUser` so that every page in this stream opens
 * with a forums-named call and nothing has to remember which guard module to
 * import. Session reads cost no database round trip — `auth()` verifies the JWT —
 * so this is free and can safely precede the concurrent data fetch.
 */
export async function requireForumUser(next: string): Promise<AuthUser> {
  return requireUser(next);
}

/**
 * THE read decision for one week's forum, delegated wholesale to `gateWeek`.
 *
 * Re-exported through this stream rather than imported directly by the pages so
 * that there is one place to look for "how do forums decide visibility" — and so
 * that if the answer ever has to change, it changes here rather than in three
 * pages that could each be updated separately.
 *
 * Pages call this INSIDE a `Promise.all` alongside their content read. That is
 * safe and is argued in src/lib/forums/store.ts, PART 1: the content query goes
 * on the wire early but its result is discarded unread unless this gate allowed
 * it, exactly as `gateLecture` does at src/components/course/data.ts:395.
 */
export async function gateForumWeek(studentId: number, weekId: number): Promise<WeekGate> {
  return gateWeek(studentId, weekId);
}

// ---------------------------------------------------------------------------
// Write-side guards, for server actions
// ---------------------------------------------------------------------------

/**
 * A signed-in user who may reach `weekId` — the guard every mutating action opens
 * with.
 *
 * THE WEEK GATE IS RE-CHECKED ON EVERY WRITE, not only on the read that rendered
 * the form. Three ways a write can arrive without a matching read, all of them
 * real:
 *   1. the page was rendered while the week was open and the subject has since
 *      been withheld (a config deploy, docs/SUBJECT_SECTIONS.md), and the student
 *      still has the tab open;
 *   2. a quiz retake changed the student's progression state;
 *   3. the action was called directly. It is an HTTP POST endpoint; nothing
 *      requires it to have been reached from a page at all.
 * Case 3 alone makes this mandatory — a form that was never rendered is not a
 * constraint on anything.
 *
 * Throws rather than returning a union so that an action author cannot forget to
 * branch on the result. A guard whose refusal is a value that compiles when
 * ignored is a guard that gets ignored.
 */
export async function requireForumWriter(weekId: number): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new ForumForbiddenError("Not signed in.");

  const gate = await gateForumWeek(user.id, weekId);
  if (!gate.ok) {
    // Deliberately ONE message for `not_found` and `locked` alike. The lock reason
    // is safe to show on a page the student reached legitimately (that is what
    // LockedNotice is for), but as the response to a POST it would confirm that a
    // week — and therefore a thread — exists behind a URL they were refused.
    throw new ForumForbiddenError(FORUM_NOT_FOUND_MESSAGE);
  }

  return user;
}
