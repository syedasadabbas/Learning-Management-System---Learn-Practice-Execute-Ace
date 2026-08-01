"use server";

// =============================================================================
// SERVER ACTIONS — open a thread, reply, edit, remove, moderate.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// WHY ACTIONS AND NOT API ROUTES, even though IMPLEMENTATION_ROADMAP.md:422 lists
// `src/app/api/forum/topics/route.ts`.
//
// `ROUTES` in @/lib/contracts/api is frozen and lists no forum endpoint. Adding
// `POST /api/forum/topics` would create a path with no `ROUTE_AUTH` entry — the
// unguarded-by-omission bug that map exists to prevent, and the reason its own
// header (src/lib/contracts/api.ts:61) calls an unlisted route "a defeat of the
// compile-time check". That file is owned by shared-contracts, and adding rows to
// a frozen cross-stream contract while seven other agents hold the same file open
// is the collision this wave is explicitly avoiding.
//
// Server actions keep the mutation inside the frozen contract while still being
// guarded. It is the same call the courses stream made
// (src/lib/courses/actions.ts:8) and the video-ingestion stream before it
// (src/lib/videos/actions.ts:8), so it is the house pattern rather than a
// one-off. Flagged for the coordinator in the stream report: if forum endpoints
// are wanted for a mobile client later, they belong in ROUTES first.
//
// -----------------------------------------------------------------------------
// THE FOUR RULES EVERY ACTION IN THIS FILE KEEPS
//
//  1. THE FIRST STATEMENT IS A GUARD. Once Next.js compiles an action, the export
//     IS a public HTTP POST target; the button that calls it is markup, not a
//     control. `requireForumWriter` re-runs the WEEK gate on every write — see
//     src/lib/forums/access.ts for the three ways a write arrives without a
//     matching read.
//
//  2. NO ACTION TAKES AN AUTHOR ID. Every row is written FOR the session user. An
//     `authorId` parameter would let any signed-in user post, edit or retract as
//     anyone else. The only ids crossing the wire are WEEK, TOPIC and POST ids,
//     all of which are re-resolved server-side and re-checked.
//
//  3. THE POLICY FUNCTION DECIDES, AND THE SQL BACKS IT UP. Every decision comes
//     from policy.ts over freshly-loaded row facts — never from an inline role or
//     ownership comparison — and the statement that performs the write ALSO
//     carries the constraint in its WHERE clause (store.ts property (b)). Both
//     layers, because the read-then-write window is ~245 ms wide on this database
//     and a moderator's lock can land inside it.
//
//  4. A TYPED RESULT, NEVER A THROW ACROSS THE RSC BOUNDARY. A thrown error
//     reaches the browser as a generic "unexpected response", which tells a
//     student nothing about whether their post was saved.
// =============================================================================

import { revalidatePath } from "next/cache";

import { getSessionUser } from "@/lib/guard";

import {
  ForumForbiddenError,
  FORUM_NOT_FOUND_MESSAGE,
  requireForumWriter,
} from "./access";
import {
  canAdministerTopic,
  canEditPost,
  canMarkSolution,
  canRemovePost,
  canRemoveTopic,
  canReply,
  EDIT_REFUSAL_MESSAGE,
  normaliseBody,
  normaliseRemovalReason,
  normaliseTitle,
  REMOVE_REFUSAL_MESSAGE,
  REPLY_REFUSAL_MESSAGE,
  validId,
} from "./policy";
import {
  insertPost,
  insertTopic,
  loadPostForWrite,
  loadTopicForWrite,
  setPostSolution,
  setTopicLocked,
  setTopicPinned,
  tombstonePost,
  tombstoneTopic,
  updatePostContent,
} from "./store";

export type ForumActionResult =
  | { ok: true; topicId?: number; postId?: number }
  | { ok: false; error: string };

function fail(error: string): ForumActionResult {
  return { ok: false, error };
}

/**
 * Convert a thrown guard error into a result.
 *
 * A database error string in the browser is an information leak (table names,
 * column names, sometimes a fragment of another row), so anything that is not a
 * `ForumForbiddenError` becomes one generic sentence and the detail goes to the
 * server log. Same shape as src/lib/courses/actions.ts:58.
 */
function toFailure(error: unknown): ForumActionResult {
  if (error instanceof ForumForbiddenError) return fail(error.message);
  console.error("[forums] action failed", error);
  return fail("That could not be saved. Please try again.");
}

/**
 * Revalidate every surface a forum write changes.
 *
 * All three, because they show overlapping derived facts: the index shows a
 * per-week topic COUNT, the week page shows per-thread REPLY COUNTS and the
 * last-activity ordering, and the thread page shows the posts. Without the first
 * two, a new reply would appear in the thread while the list behind it still said
 * "3 replies" — and "my post saved but the list disagrees" is indistinguishable
 * from "my post did not save".
 */
function revalidate(weekId: number, topicId?: number): void {
  revalidatePath("/forums");
  revalidatePath(`/forums/${weekId}`);
  if (topicId != null) revalidatePath(`/forums/${weekId}/${topicId}`);
}

// ---------------------------------------------------------------------------
// Opening a thread
// ---------------------------------------------------------------------------

/**
 * Open a new thread in one week's forum.
 *
 * Any signed-in user who may READ the week may open a thread in it — there is no
 * separate "may post" privilege, deliberately. A forum whose members can read but
 * not write is a noticeboard, and the roadmap's stated goal is a 30% reduction in
 * instructor email (INTEGRATION_SUMMARY.md:307), which requires students to be
 * able to ask.
 */
export async function createTopicAction(
  weekId: unknown,
  title: unknown,
  description?: unknown,
): Promise<ForumActionResult> {
  try {
    const week = validId(weekId);
    if (!week) return fail(FORUM_NOT_FOUND_MESSAGE);

    // GUARD FIRST, before the input is even looked at: a refused caller must not
    // be able to tell a valid week id from an invalid one by the error they get
    // for a blank title.
    const user = await requireForumWriter(week);

    const cleanTitle = normaliseTitle(title);
    if (!cleanTitle) return fail("Give your question a title so classmates can find it.");

    // `null` here is a legitimate outcome, not a validation failure: a thread whose
    // whole content is its title ("Is anyone else stuck on flexbox?") is a real
    // question. See src/db/schema.forums.ts, `description`.
    const cleanBody = normaliseBody(description);

    const topicId = await insertTopic({
      weekId: week,
      title: cleanTitle,
      description: cleanBody,
      createdBy: user.id,
    });
    if (!topicId) return fail("The discussion could not be created. Please try again.");

    revalidate(week, topicId);
    return { ok: true, topicId };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Replying
// ---------------------------------------------------------------------------

export async function createPostAction(
  topicId: unknown,
  content: unknown,
): Promise<ForumActionResult> {
  try {
    const topic = validId(topicId);
    if (!topic) return fail(FORUM_NOT_FOUND_MESSAGE);

    // The thread is loaded FIRST because its `weekId` is what the guard needs —
    // the client sends a topic id, and trusting a week id from the same form
    // would let a caller pair a readable week with someone else's thread.
    const subject = await loadTopicForWrite(topic);
    if (!subject) return fail(FORUM_NOT_FOUND_MESSAGE);

    const user = await requireForumWriter(subject.weekId);

    const eligibility = canReply({
      viewer: { id: user.id, role: user.role },
      topicLocked: subject.locked,
      topicRemoved: subject.removed,
    });
    if (!eligibility.canReply) return fail(REPLY_REFUSAL_MESSAGE[eligibility.refusal]);

    const cleanBody = normaliseBody(content);
    if (!cleanBody) return fail("Write something before posting.");

    const postId = await insertPost({
      topicId: topic,
      authorId: user.id,
      content: cleanBody,
    });
    // Null means the `WHERE EXISTS` guard inside the INSERT matched nothing, i.e.
    // the thread was locked or removed in the ~245 ms since it was read. Report
    // the truth rather than claiming a post that does not exist.
    if (!postId) return fail(REPLY_REFUSAL_MESSAGE.topic_locked);

    revalidate(subject.weekId, topic);
    return { ok: true, postId };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Editing — the "not someone else's words" path
// ---------------------------------------------------------------------------

/**
 * Edit your own post.
 *
 * THE AUTHORIZATION NEGATIVE THIS FEATURE MUST NOT GET WRONG runs through here.
 * Three independent things stop a student editing a classmate's post, and they
 * are three because any one of them could be removed by a future edit:
 *   1. `canEditPost` refuses a non-author (policy.test.ts asserts it);
 *   2. `updatePostContent`'s WHERE clause carries `author_id = <session user>`,
 *      so a bypassed policy call still matches zero rows;
 *   3. the session user id comes from the cookie, never from the form.
 */
export async function updatePostAction(
  postId: unknown,
  content: unknown,
): Promise<ForumActionResult> {
  try {
    const post = validId(postId);
    if (!post) return fail(FORUM_NOT_FOUND_MESSAGE);

    const subject = await loadPostForWrite(post);
    if (!subject) return fail(FORUM_NOT_FOUND_MESSAGE);

    const user = await requireForumWriter(subject.weekId);

    const eligibility = canEditPost({
      viewer: { id: user.id, role: user.role },
      post: {
        authorId: subject.authorId,
        removed: subject.removed,
        topicLocked: subject.topicLocked,
        topicRemoved: subject.topicRemoved,
      },
    });
    if (!eligibility.canEdit) return fail(EDIT_REFUSAL_MESSAGE[eligibility.refusal]);

    const cleanBody = normaliseBody(content);
    // An edit to empty is NOT silently treated as a delete. Deleting on empty
    // input would make a mis-click destroy a post, and removal is a separate,
    // explicitly-confirmed action that writes an attributable tombstone.
    if (!cleanBody) return fail("A post cannot be empty. Remove it instead if you meant to.");

    const changed = await updatePostContent({
      postId: post,
      authorId: user.id,
      content: cleanBody,
    });
    if (!changed) return fail(EDIT_REFUSAL_MESSAGE.topic_locked);

    revalidate(subject.weekId, subject.topicId);
    return { ok: true, postId: post };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Removal — moderation, and author retraction
// ---------------------------------------------------------------------------

/**
 * Remove a post. TOMBSTONE, NOT DELETE — see src/db/schema.forums.ts's
 * `removedAt` block for the three reasons (thread coherence, audit record,
 * dangling solution flag).
 *
 * One action serves both principals — the author retracting and a moderator
 * moderating — because they perform the same write and differ only in who is
 * recorded in `removed_by`. Two actions would be two places for the tombstone
 * shape to drift, and the risk of a "self-delete" action that forgot to check
 * authorship.
 *
 * The `reason` is only stored for a MODERATOR's removal: a student's own
 * retraction needs no justification to anybody, and prompting for one would imply
 * it does.
 */
export async function removePostAction(
  postId: unknown,
  reason?: unknown,
): Promise<ForumActionResult> {
  try {
    const post = validId(postId);
    if (!post) return fail(FORUM_NOT_FOUND_MESSAGE);

    const subject = await loadPostForWrite(post);
    if (!subject) return fail(FORUM_NOT_FOUND_MESSAGE);

    const user = await requireForumWriter(subject.weekId);

    const eligibility = canRemovePost({
      viewer: { id: user.id, role: user.role },
      post: {
        authorId: subject.authorId,
        removed: subject.removed,
        topicLocked: subject.topicLocked,
        topicRemoved: subject.topicRemoved,
      },
    });
    if (!eligibility.canRemove) return fail(REMOVE_REFUSAL_MESSAGE[eligibility.refusal]);

    const removed = await tombstonePost({
      postId: post,
      removedBy: user.id,
      reason: eligibility.asModerator ? normaliseRemovalReason(reason) : null,
    });
    if (!removed) return fail(REMOVE_REFUSAL_MESSAGE.already_removed);

    revalidate(subject.weekId, subject.topicId);
    return { ok: true, postId: post };
  } catch (error) {
    return toFailure(error);
  }
}

/** Remove a whole thread. Moderators only — see policy.ts#canRemoveTopic. */
export async function removeTopicAction(
  topicId: unknown,
  reason?: unknown,
): Promise<ForumActionResult> {
  return administer(topicId, canRemoveTopic, async (subject, userId) =>
    tombstoneTopic({
      topicId: subject.topicId,
      removedBy: userId,
      reason: normaliseRemovalReason(reason),
    }),
  );
}

// ---------------------------------------------------------------------------
// Staff-only thread controls
// ---------------------------------------------------------------------------

/**
 * Shared body of every moderator-only topic mutation.
 *
 * The ROLE CHECK RUNS BEFORE THE ROW IS READ — `permits(user.role)` is evaluated
 * on the session's role first, so a student probing these actions with a guessed
 * topic id learns nothing about whether it exists or what state it is in. That is
 * the same ordering, for the same reason, as `decide()` in
 * src/lib/courses/actions.ts:150.
 *
 * NOTE the sequence: session -> role -> row -> WEEK GATE -> write. The week gate
 * is still applied to staff, because `gateWeek` is student-scoped and takes no
 * role (docs/SUBJECT_SECTIONS.md:109). A moderator cannot act inside a withheld
 * subject, which is the pre-existing behaviour recorded in access.ts's header.
 */
async function administer(
  topicId: unknown,
  permits: (role: string | null | undefined) => boolean,
  write: (
    subject: { topicId: number; weekId: number },
    userId: number,
  ) => Promise<boolean>,
): Promise<ForumActionResult> {
  try {
    const topic = validId(topicId);
    if (!topic) return fail(FORUM_NOT_FOUND_MESSAGE);

    // The session is read directly rather than through requireForumWriter first,
    // because the role refusal must not be preceded by a week-gate refusal that
    // would leak which weeks exist. Role, then row, then gate.
    const user = await getSessionUser();
    if (!user) return fail("Not signed in.");
    if (!permits(user.role)) return fail("Only an instructor can do that.");

    const subject = await loadTopicForWrite(topic);
    if (!subject) return fail(FORUM_NOT_FOUND_MESSAGE);

    // The gate applies to staff too. See the note above.
    await requireForumWriter(subject.weekId);

    const changed = await write(subject, user.id);
    if (!changed) {
      return fail("That discussion has already changed. Reload the page to see its state.");
    }

    revalidate(subject.weekId, subject.topicId);
    return { ok: true, topicId: subject.topicId };
  } catch (error) {
    return toFailure(error);
  }
}

/** Lock or unlock a thread. Locking closes it to new replies for EVERYONE. */
export async function setTopicLockedAction(
  topicId: unknown,
  locked: unknown,
): Promise<ForumActionResult> {
  return administer(topicId, canAdministerTopic, async (subject) =>
    setTopicLocked({ topicId: subject.topicId, locked: locked === true || locked === "true" }),
  );
}

/** Pin or unpin a thread. Pinned threads sort first within their week. */
export async function setTopicPinnedAction(
  topicId: unknown,
  pinned: unknown,
): Promise<ForumActionResult> {
  return administer(topicId, canAdministerTopic, async (subject) =>
    setTopicPinned({ topicId: subject.topicId, pinned: pinned === true || pinned === "true" }),
  );
}

/**
 * Mark or unmark a reply as the accepted solution. Moderators only — the roadmap
 * specifies "Instructor marks best answer" (IMPLEMENTATION_ROADMAP.md:408) and
 * policy.ts#canMarkSolution argues why the asker does not.
 *
 * Not routed through `administer` because it acts on a POST id, so the row it
 * must load and the week it must resolve come from `loadPostForWrite`.
 */
export async function setSolutionAction(
  postId: unknown,
  isSolution: unknown,
): Promise<ForumActionResult> {
  try {
    const post = validId(postId);
    if (!post) return fail(FORUM_NOT_FOUND_MESSAGE);

    const user = await getSessionUser();
    if (!user) return fail("Not signed in.");
    // Role first, before the row is read — the anti-probing ordering again.
    if (!canMarkSolution(user.role)) return fail("Only an instructor can mark a solution.");

    const subject = await loadPostForWrite(post);
    if (!subject) return fail(FORUM_NOT_FOUND_MESSAGE);
    if (subject.removed) return fail("A removed post cannot be marked as the solution.");

    await requireForumWriter(subject.weekId);

    const changed = await setPostSolution({
      postId: post,
      isSolution: isSolution === true || isSolution === "true",
    });
    if (!changed) return fail("That post has already changed. Reload the page.");

    revalidate(subject.weekId, subject.topicId);
    return { ok: true, postId: post };
  } catch (error) {
    return toFailure(error);
  }
}
