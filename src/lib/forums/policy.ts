// =============================================================================
// FORUM AUTHORIZATION POLICY — the whole decision, as pure functions.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// NO DATABASE, NO SESSION, NO `next/*` IMPORT IN THIS FILE. Everything here is a
// total function over plain data, which is what makes the NEGATIVE paths testable
// without a server: "a student cannot edit another student's post" is asserted as
// a property of `canEditPost` in policy.test.ts, not inferred from an Edit button
// not being rendered. That is the same split, for the same stated reason, as
// src/lib/courses/policy.ts:6-12 and `roleSatisfies` in src/lib/guard.ts:68.
//
// NO ROLE STRING IS COMPARED TO A LITERAL HERE. Every role question goes through
// `roleSatisfies`, which reads the frozen `ROLES_SATISFYING` table in
// src/lib/contracts/api.ts. Two rules that an `if (role === "instructor")` check
// gets wrong, both of which matter to a forum:
//   * `ROLES_SATISFYING.instructor` is ["instructor","admin"], so an admin
//     moderates without anyone having to remember to add them; and
//   * `ROLES_SATISFYING.student` includes staff, so "signed in" and "is a student"
//     are different questions and this file never conflates them.
// Re-levelling who may moderate is then a contract edit, not a grep.
//
// -----------------------------------------------------------------------------
// HOW THIS GATE RELATES TO THE THREE THAT ALREADY EXIST
//
// This stream adds NO new visibility layer. docs/SUBJECT_SECTIONS.md documents
// two (section release, quiz progression) and src/lib/courses/policy.ts:26-30
// documents a third (course access) sitting in front of both. A forum thread is
// anchored to a WEEK, so "may this student read this thread?" is answered by
// `gateWeek` (src/components/course/data.ts:338) — the existing derivation that
// already resolves all three — and this file does not restate it:
//
//   | Question                                        | Decided by            |
//   |-------------------------------------------------|-----------------------|
//   | May I open this COURSE?                         | decideCourseAccess    |
//   | Has the cohort been given this SUBJECT?         | section release       |
//   | Have I passed the previous week?                | shouldUnlockNextWeek  |
//   | ...all three, as one answer for one week        | gateWeek  <-- CONSUMED|
//   | May I WRITE here, and may I write on THIS ROW?  | THIS FILE             |
//
// So the read gate is inherited and the write gate is new. A student refused by
// `gateWeek` never reaches any function in this file (see src/lib/forums/access.ts,
// which gates before it loads a row), and nothing here can grant what gateWeek
// refused.
//
// All lengths are character counts; all durations elsewhere in this stream are
// milliseconds (house rule: metric units).
// =============================================================================

// ROLES_SATISFYING from the frozen contract, NOT `roleSatisfies` from
// src/lib/guard.ts — and this is a build-breaking distinction rather than a
// stylistic one.
//
// This module is imported by src/components/forums/PostComposer.tsx, a CLIENT
// component that wants two character limits from it. Importing guard.ts dragged
// its whole module graph into the browser bundle:
//
//   PostComposer.tsx -> forums/policy.ts -> lib/guard.ts -> lib/auth.ts
//     -> src/db/index.ts -> pg -> "Can't resolve 'fs' / 'dns' / 'net'"
//
// `next build` failed on that; `tsc` did not, and neither did any unit test,
// because vitest resolves node built-ins happily. It is the same hazard
// src/components/nav/nav-links.ts documents at its head, where a type-only import
// of schema.ts is used precisely so Drizzle never reaches the client.
//
// `roleSatisfies` is four lines over a frozen lookup table (guard.ts:68-72), so
// reading the table directly costs nothing and keeps this module what its own
// header claims: pure, dependency-free, and safe to import from anywhere.
import { ROLES_SATISFYING, type RouteAuth } from "@/lib/contracts/api";

/**
 * Local, dependency-free `roleSatisfies`.
 *
 * Mirrors src/lib/guard.ts:68-72 exactly, including that `public` admits everyone
 * and a missing role admits nobody. It reads the SAME frozen table, so the two
 * cannot disagree about who counts as staff — the duplication is four lines of
 * logic, not a second source of truth.
 */
function roleSatisfies(required: RouteAuth, role: string | null | undefined): boolean {
  if (required === "public") return true;
  if (!role) return false;
  return ROLES_SATISFYING[required].includes(role);
}

// ---------------------------------------------------------------------------
// Who moderates
// ---------------------------------------------------------------------------

/**
 * The auth level required to moderate — remove any post, lock, pin, and mark a
 * solution. One constant, one place to change.
 *
 * INSTRUCTOR, not admin, and this is the opposite call to the one
 * src/lib/courses/policy.ts:84 makes for course approval. The difference is what
 * the act IS. Approving course access is an ENROLMENT act: it changes who is on
 * the roll, which changes the leaderboard population and who a deadline applies
 * to, so it is reserved to admins. Taking down an abusive reply is a TEACHING
 * act on content inside a week the instructor already grades — the same remit as
 * /instructor/grading. Reserving it to admins would mean the person actually
 * reading the thread cannot act on it, and moderation that has to be escalated
 * is moderation that happens tomorrow.
 *
 * `ROLES_SATISFYING.instructor` is ["instructor","admin"], so admins are included
 * automatically. The roadmap's requirement is "an instructor or admin must be
 * able to remove a post"; this constant is that sentence.
 */
export const FORUM_MODERATION_AUTH: RouteAuth = "instructor";

/** May `role` moderate — remove any post, lock, pin, mark a solution? */
export function canModerate(role: string | null | undefined): boolean {
  return roleSatisfies(FORUM_MODERATION_AUTH, role);
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/**
 * The state of one post, as an authorization decision needs to see it.
 *
 * `topicLocked` and `topicRemoved` are on this shape rather than fetched
 * separately because every write decision needs them: a locked thread refuses
 * edits to posts inside it, and a post inside a removed thread is unreachable.
 * The store loads all five fields in ONE statement (store.ts#loadPostForWrite),
 * so this is not five round trips dressed up as a type.
 */
export interface PostSubject {
  authorId: number;
  /** True when the post already carries a tombstone. */
  removed: boolean;
  topicLocked: boolean;
  topicRemoved: boolean;
}

export interface Viewer {
  id: number;
  role: string | null | undefined;
}

// ---------------------------------------------------------------------------
// Writing a reply
// ---------------------------------------------------------------------------

export type ReplyRefusal =
  /** The thread was tombstoned by a moderator. */
  | "topic_removed"
  /** A moderator closed the thread to new posts. */
  | "topic_locked";

export type ReplyEligibility =
  | { canReply: true }
  | { canReply: false; refusal: ReplyRefusal };

/**
 * May this viewer add a reply to this thread?
 *
 * NOTE WHAT IS **NOT** CHECKED HERE: whether the viewer may read the week. That
 * is `gateWeek`'s answer and it is checked BEFORE this function is reached, in
 * src/lib/forums/access.ts. Restating it here would be a second copy of the
 * access rule that can drift from the first — and, as
 * src/components/course/data.ts:350 records, "the copy that drifts is always the
 * one guarding the deeper URL".
 *
 * A LOCKED THREAD REFUSES **STAFF** TOO, deliberately. A moderator who locked a
 * thread and then wants the last word should unlock it, which leaves a state
 * change anyone can see, rather than posting into a thread students cannot answer
 * in. Asymmetric closure — "closed for you, open for me" — is the specific thing
 * that makes a locked thread feel like censorship rather than housekeeping.
 */
export function canReply(input: {
  viewer: Viewer;
  topicLocked: boolean;
  topicRemoved: boolean;
}): ReplyEligibility {
  if (input.topicRemoved) return { canReply: false, refusal: "topic_removed" };
  if (input.topicLocked) return { canReply: false, refusal: "topic_locked" };
  return { canReply: true };
}

// ---------------------------------------------------------------------------
// Editing a post  —  the "not someone else's words" rule
// ---------------------------------------------------------------------------

export type EditRefusal =
  /** Someone else wrote it. THE rule this feature must not get wrong. */
  | "not_author"
  /** Already tombstoned; there is no live text to change. */
  | "removed"
  | "topic_locked"
  | "topic_removed";

export type EditEligibility =
  | { canEdit: true }
  | { canEdit: false; refusal: EditRefusal };

/**
 * May this viewer edit this post?
 *
 * ONLY THE AUTHOR. A MODERATOR MAY **NOT** EDIT, and that is a deliberate refusal
 * rather than an omission — it is the single most important line in this file:
 *
 *   Removal is attributable and visible: the tombstone records `removed_by`, and
 *   the reader is told the post was removed. An EDIT is neither. If an instructor
 *   could rewrite a student's post, the post would still be attributed to the
 *   student, with no marker distinguishing the student's words from the
 *   instructor's. That is putting words in a student's mouth under their name,
 *   and it is not recoverable by them. A moderator who objects to a post removes
 *   it and says why; that leaves the student able to point at what happened.
 *
 * `editedAt` reinforces this: the column exists so the UI can say "edited", and
 * it would be a false statement about a student if a moderator's change set it.
 * See src/db/schema.forums.ts's `editedAt` block.
 *
 * ORDER MATTERS AND IT IS THE SECURITY ORDER. `not_author` is checked FIRST, so a
 * student probing a guessed post id learns nothing about that post's state — not
 * whether it is removed, and not whether its thread is locked. The refusal for
 * "someone else's post" and "someone else's post in a locked thread" is the same
 * refusal, which is the property that makes the id un-probeable.
 */
export function canEditPost(input: {
  viewer: Viewer;
  post: PostSubject;
}): EditEligibility {
  const { viewer, post } = input;

  // Authorship first. See the note above — this ordering is what stops the
  // refusal message from being an oracle about other people's rows.
  if (viewer.id !== post.authorId) return { canEdit: false, refusal: "not_author" };

  if (post.topicRemoved) return { canEdit: false, refusal: "topic_removed" };
  if (post.removed) return { canEdit: false, refusal: "removed" };
  if (post.topicLocked) return { canEdit: false, refusal: "topic_locked" };

  return { canEdit: true };
}

// ---------------------------------------------------------------------------
// Removing a post  —  the moderation rule
// ---------------------------------------------------------------------------

export type RemoveRefusal =
  /** Neither the author nor a moderator. */
  | "not_permitted"
  /** Already tombstoned. A second removal would only overwrite the audit trail. */
  | "already_removed"
  | "topic_removed";

export type RemoveEligibility =
  /**
   * `asModerator` is NOT decoration. It selects which tombstone is written:
   * a moderator's removal records the moderator in `removed_by`, an author's
   * records the author, and that is the only way a reader (or an auditor) can
   * tell a self-delete from a moderation action. See src/db/schema.forums.ts's
   * `removedAt` block.
   */
  | { canRemove: true; asModerator: boolean }
  | { canRemove: false; refusal: RemoveRefusal };

/**
 * May this viewer remove this post?
 *
 * TWO PRINCIPALS, ONE ACTION:
 *   * the AUTHOR, retracting their own post — the ordinary case, and the reason
 *     a student is not stuck with a typo'd or regretted post forever;
 *   * a MODERATOR (instructor or admin), on ANY post — the roadmap's requirement.
 *
 * A locked thread does NOT block removal. Locking closes a thread to new
 * discussion; it must not freeze an abusive post in place where a moderator can
 * no longer take it down. `topicRemoved` DOES block it, because the whole thread
 * is already unreachable and a per-post tombstone inside it would record a
 * moderation decision nobody made.
 *
 * ORDER: permission first, for the same probing reason as `canEditPost`.
 */
export function canRemovePost(input: {
  viewer: Viewer;
  post: PostSubject;
}): RemoveEligibility {
  const { viewer, post } = input;

  const moderator = canModerate(viewer.role);
  const author = viewer.id === post.authorId;
  if (!moderator && !author) return { canRemove: false, refusal: "not_permitted" };

  if (post.topicRemoved) return { canRemove: false, refusal: "topic_removed" };
  if (post.removed) return { canRemove: false, refusal: "already_removed" };

  // A moderator removing THEIR OWN post is recorded as an author retraction, not
  // as a moderation action: `asModerator` answers "was this an exercise of
  // authority over someone else's words?", and on your own post it was not.
  return { canRemove: true, asModerator: moderator && !author };
}

// ---------------------------------------------------------------------------
// Staff-only thread controls
// ---------------------------------------------------------------------------

/**
 * May this viewer mark a reply as the accepted solution?
 *
 * MODERATORS ONLY, following the roadmap explicitly: `is_solution` is documented
 * in its schema snippet as "Instructor marks best answer"
 * (IMPLEMENTATION_ROADMAP.md:408). Letting the asker mark their own thread solved
 * was considered and rejected for this cohort: the mark is a teaching signal that
 * the next student reads as "this answer is correct", and a beginner is not placed
 * to certify that — a confidently wrong reply marked solved is worse than an
 * unmarked thread.
 *
 * TODO(forums): if instructor load makes this a bottleneck, the natural next step
 * is to let the TOPIC AUTHOR mark a solution and render the two marks
 * differently ("asker accepted" vs "instructor verified"). That needs a second
 * column, not a relaxation of this function.
 */
export function canMarkSolution(role: string | null | undefined): boolean {
  return canModerate(role);
}

/** May this viewer lock/unlock or pin/unpin a thread? Moderators only. */
export function canAdministerTopic(role: string | null | undefined): boolean {
  return canModerate(role);
}

/**
 * May this viewer remove a whole thread? Moderators only — NOT the author.
 *
 * Asymmetric with `canRemovePost` on purpose. Retracting your own reply costs the
 * thread one message; retracting the OPENING post takes down every answer other
 * students wrote underneath it, which is other people's work. A student who
 * regrets their question can retract their own opening post's body via
 * `canEditPost`... which they cannot, because the opening body lives on the topic
 * row. Stated as the known gap rather than papered over:
 *
 * TODO(forums): a topic author cannot currently edit or retract their opening
 * text at all — only a moderator can remove the thread. The clean fix is to store
 * the opening post as the first `forum_posts` row instead of as
 * `forum_topics.description`, which makes it subject to `canEditPost` like every
 * other post and removes this special case entirely. Not done here because the
 * roadmap's schema snippet puts the opening text on the topic
 * (IMPLEMENTATION_ROADMAP.md:393) and following it keeps the migration matching
 * the spec.
 */
export function canRemoveTopic(role: string | null | undefined): boolean {
  return canModerate(role);
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

/** Must equal `TOPIC_TITLE_CHARS` in src/db/schema.forums.ts. */
export const TOPIC_TITLE_MAX = 200;
/** Must equal `POST_CONTENT_CHARS` in src/db/schema.forums.ts. */
export const POST_CONTENT_MAX = 10_000;
/** Length cap on a moderator's removal reason. Matches the column. */
export const REMOVAL_REASON_MAX = 200;

/**
 * Normalise a student-supplied title.
 *
 * Returns null when there is nothing usable, so the caller REFUSES rather than
 * writing a blank-titled thread that nobody can identify in a list. This differs
 * from `normaliseRequestMessage` in src/lib/courses/policy.ts:268, which returns
 * null for "the optional note was empty" — here null means "reject".
 *
 * TRUNCATES rather than refusing an over-long title, matching that same function:
 * losing the tail of a title is a better outcome than discarding a thread a
 * student meant to open. The server action calls this — a form's `maxLength` is
 * presentation, and an action is a plain HTTP POST target that no client-side
 * attribute protects (src/lib/courses/actions.ts:16).
 *
 * WHAT THIS DOES **NOT** DO: it does not strip, escape or sanitise anything. A
 * title containing `<script>` is stored verbatim and is safe, because it is
 * rendered as a React text child — see src/components/forums/ForumTopicList.tsx.
 * Escaping here would corrupt every legitimate title containing `<`, `&` or `>`
 * ("Why does `a < b` fail?") for every future reader AND for the author's own
 * next edit, which is the double-escaping bug that makes sanitise-on-write wrong.
 */
export function normaliseTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Collapse internal whitespace as well as trimming the ends: a title padded
  // with newlines breaks the single-line list layout, and a title that is
  // ENTIRELY whitespace must read as empty rather than as 40 spaces.
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, TOPIC_TITLE_MAX);
}

/**
 * Normalise a post/opening body.
 *
 * Only the ENDS are trimmed — internal newlines are load-bearing in markdown
 * (paragraph breaks, list items, fenced code blocks), so the whitespace collapse
 * `normaliseTitle` performs would destroy every code sample a student posts.
 *
 * Returns null for an empty body. `optional: true` is for the topic opener, where
 * a title-only thread is legitimate and null means "store SQL NULL"; the default
 * is for a reply, where the caller refuses.
 */
export function normaliseBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, POST_CONTENT_MAX);
}

/** Normalise a moderator's removal reason. Optional — null is a valid outcome. */
export function normaliseRemovalReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, REMOVAL_REASON_MAX);
}

/**
 * Coerce an untrusted id from a form field or a route parameter.
 *
 * Every id crossing the wire goes through this. `Number("1e3")` is 1000 and
 * `Number("")` is 0, so a bare `Number()` on a form value is not a validation.
 */
export function validId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Refusal copy
// ---------------------------------------------------------------------------

/**
 * Student-facing wording for every refusal.
 *
 * The two "someone else's row" refusals — `not_author` and `not_permitted` — say
 * the SAME thing about the same class of row on purpose. A message that
 * distinguished "that post is not yours" from "that post does not exist" would
 * turn a guessed id into a membership oracle.
 */
export const EDIT_REFUSAL_MESSAGE: Record<EditRefusal, string> = {
  not_author: "You can only edit your own posts.",
  removed: "That post has been removed and can no longer be edited.",
  topic_locked: "This discussion is locked, so its posts can no longer be edited.",
  topic_removed: "This discussion has been removed.",
};

export const REMOVE_REFUSAL_MESSAGE: Record<RemoveRefusal, string> = {
  not_permitted: "You can only remove your own posts.",
  already_removed: "That post has already been removed.",
  topic_removed: "This discussion has been removed.",
};

export const REPLY_REFUSAL_MESSAGE: Record<ReplyRefusal, string> = {
  topic_locked: "This discussion is locked. No new replies can be added.",
  topic_removed: "This discussion has been removed.",
};

/**
 * What a reader is told in place of a removed post's body.
 *
 * Exported as a constant so the component and the e2e spec assert the same
 * string, and so there is exactly one place that decides a removed post shows a
 * NOTICE rather than nothing at all. Showing nothing would silently renumber the
 * conversation — the failure the tombstone exists to avoid (see
 * src/db/schema.forums.ts, `removedAt`).
 */
export const REMOVED_POST_NOTICE = "This post was removed by a moderator.";
/** The same, when the author took their own post down. */
export const RETRACTED_POST_NOTICE = "This post was removed by its author.";
