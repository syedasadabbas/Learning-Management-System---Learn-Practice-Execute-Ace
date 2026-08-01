// =============================================================================
// FORUM AUTHORIZATION — THE NEGATIVE PATHS.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// WHY THIS FILE IS MOSTLY REFUSALS. A forum is the first surface in this app where
// one student's row is displayed to another student and is writable by its owner.
// The two failures that matter are both negatives — "a student edited someone
// else's post" and "a student read a thread they have no access to" — and a suite
// of happy paths cannot detect either. So the happy paths here exist mainly as
// CONTROLS: without them a policy function that returned `false` unconditionally
// would pass every refusal assertion and the file would be worthless.
//
// These are pure-function assertions, no database and no session, which is the
// whole reason policy.ts holds no I/O (see its header). The read gate — "not a
// thread in a course/week you cannot access" — is NOT decided in policy.ts; it is
// `gateWeek`'s answer, consumed in src/lib/forums/access.ts. The unit-level
// assertion for that is at the bottom of this file (the access module must call
// the gate before it loads a row) and the behavioural one is the direct-URL spec
// in tests/e2e/forums/forums.spec.ts, because "hiding a link is not access
// control" (src/components/course/data.ts:14) and a URL refusal can only be
// proven by requesting the URL.
// =============================================================================

import { describe, it, expect } from "vitest";

// NO `vi.mock("@/lib/auth")` HERE, unlike src/lib/guard.test.ts:17 and
// src/lib/courses/policy.test.ts:26 — and the absence is worth a note, because it
// is the visible consequence of a deliberate design choice in the module under
// test.
//
// Those two files must stub auth.ts because the policy they test imports
// `roleSatisfies` from src/lib/guard.ts, which reaches @/lib/auth -> next-auth ->
// pg. forums/policy.ts deliberately does NOT: it reads the frozen
// `ROLES_SATISFYING` table directly, because it is also imported by a CLIENT
// component (src/components/forums/PostComposer.tsx, for two character limits) and
// the guard.ts route dragged `pg` into the browser bundle and broke `next build`.
// See that file's import comment.
//
// So this suite exercises the real table with no test doubles at all, which is the
// stronger position: every role assertion below is a statement about the contract
// rather than about a mock.

import {
  canAdministerTopic,
  canEditPost,
  canMarkSolution,
  canModerate,
  canRemovePost,
  canRemoveTopic,
  canReply,
  EDIT_REFUSAL_MESSAGE,
  normaliseBody,
  normaliseRemovalReason,
  normaliseTitle,
  POST_CONTENT_MAX,
  REMOVE_REFUSAL_MESSAGE,
  TOPIC_TITLE_MAX,
  validId,
  type PostSubject,
} from "./policy";
import { POST_CONTENT_CHARS, TOPIC_TITLE_CHARS } from "@/db/schema.forums";

/** Two students and one instructor. Ids are arbitrary but distinct. */
const AUTHOR = { id: 11, role: "student" };
const OTHER_STUDENT = { id: 22, role: "student" };
const INSTRUCTOR = { id: 33, role: "instructor" };
const ADMIN = { id: 44, role: "admin" };
const ANONYMOUS = { id: 0, role: null };

/** A live post by AUTHOR in an open thread. Every case below varies one field. */
const LIVE: PostSubject = {
  authorId: AUTHOR.id,
  removed: false,
  topicLocked: false,
  topicRemoved: false,
};

// ===========================================================================
describe("editing is restricted to the author — the rule this feature must not get wrong", () => {
  it("the author may edit their own live post", () => {
    // CONTROL. Without this, a `canEdit: false` stub passes every refusal below.
    expect(canEditPost({ viewer: AUTHOR, post: LIVE })).toEqual({ canEdit: true });
  });

  it("ANOTHER STUDENT may not edit it", () => {
    expect(canEditPost({ viewer: OTHER_STUDENT, post: LIVE })).toEqual({
      canEdit: false,
      refusal: "not_author",
    });
  });

  it("AN INSTRUCTOR may not edit it either — moderators remove, they do not rewrite", () => {
    // This is the deliberate refusal argued in policy.ts#canEditPost: an edit is
    // unattributable, so a moderator's change would appear under the student's
    // name. If this assertion ever flips to `canEdit: true`, staff have gained
    // the ability to put words in a student's mouth.
    expect(canEditPost({ viewer: INSTRUCTOR, post: LIVE })).toEqual({
      canEdit: false,
      refusal: "not_author",
    });
  });

  it("an admin may not edit it", () => {
    expect(canEditPost({ viewer: ADMIN, post: LIVE }).canEdit).toBe(false);
  });

  it("an anonymous viewer may not edit it", () => {
    // id 0 can never equal a serial primary key, which starts at 1. Asserted
    // rather than assumed: a fallback of `viewer.id ?? 0` matching an authorId of
    // 0 would be an authentication bypass.
    expect(canEditPost({ viewer: ANONYMOUS, post: LIVE }).canEdit).toBe(false);
  });

  it("the author may not edit a post they already removed", () => {
    expect(canEditPost({ viewer: AUTHOR, post: { ...LIVE, removed: true } })).toEqual({
      canEdit: false,
      refusal: "removed",
    });
  });

  it("the author may not edit inside a locked thread", () => {
    expect(canEditPost({ viewer: AUTHOR, post: { ...LIVE, topicLocked: true } })).toEqual({
      canEdit: false,
      refusal: "topic_locked",
    });
  });

  it("the author may not edit inside a removed thread", () => {
    expect(canEditPost({ viewer: AUTHOR, post: { ...LIVE, topicRemoved: true } })).toEqual({
      canEdit: false,
      refusal: "topic_removed",
    });
  });

  it("a non-author is refused with the SAME reason whatever state the post is in", () => {
    // THE ANTI-PROBING PROPERTY. `not_author` is checked before every state
    // check, so a student iterating post ids cannot learn from the refusal
    // whether a post is removed, or whether its thread is locked. If any of
    // these returned a state-specific refusal, the id would be an oracle.
    const states: PostSubject[] = [
      LIVE,
      { ...LIVE, removed: true },
      { ...LIVE, topicLocked: true },
      { ...LIVE, topicRemoved: true },
      { ...LIVE, removed: true, topicLocked: true, topicRemoved: true },
    ];
    for (const post of states) {
      expect(canEditPost({ viewer: OTHER_STUDENT, post })).toEqual({
        canEdit: false,
        refusal: "not_author",
      });
    }
  });
});

// ===========================================================================
describe("removal — the author retracts, a moderator moderates, nobody else acts", () => {
  it("the author may remove their own post, and it is NOT recorded as moderation", () => {
    expect(canRemovePost({ viewer: AUTHOR, post: LIVE })).toEqual({
      canRemove: true,
      asModerator: false,
    });
  });

  it("AN INSTRUCTOR may remove a student's post — the roadmap's moderation requirement", () => {
    expect(canRemovePost({ viewer: INSTRUCTOR, post: LIVE })).toEqual({
      canRemove: true,
      asModerator: true,
    });
  });

  it("AN ADMIN may remove a student's post", () => {
    // Not a separate rule: ROLES_SATISFYING.instructor is ["instructor","admin"],
    // so this passes because the contract table says so, not because "admin" was
    // remembered somewhere. That is the property being asserted.
    expect(canRemovePost({ viewer: ADMIN, post: LIVE })).toEqual({
      canRemove: true,
      asModerator: true,
    });
  });

  it("ANOTHER STUDENT may not remove it", () => {
    expect(canRemovePost({ viewer: OTHER_STUDENT, post: LIVE })).toEqual({
      canRemove: false,
      refusal: "not_permitted",
    });
  });

  it("an anonymous viewer may not remove it", () => {
    expect(canRemovePost({ viewer: ANONYMOUS, post: LIVE }).canRemove).toBe(false);
  });

  it("a moderator removing their OWN post is an author retraction, not a moderation act", () => {
    // `asModerator` is what decides the notice a reader sees ("removed by a
    // moderator" vs "removed by its author"). Labelling an instructor's own
    // retraction as moderation would misreport who acted on whose words.
    expect(
      canRemovePost({ viewer: INSTRUCTOR, post: { ...LIVE, authorId: INSTRUCTOR.id } }),
    ).toEqual({ canRemove: true, asModerator: false });
  });

  it("a LOCKED thread does not stop a moderator removing an abusive post", () => {
    // Locking closes discussion; it must not freeze content in place beyond
    // moderation's reach.
    expect(
      canRemovePost({ viewer: INSTRUCTOR, post: { ...LIVE, topicLocked: true } }),
    ).toEqual({ canRemove: true, asModerator: true });
  });

  it("a REMOVED thread does stop it — there is no decision left to record", () => {
    expect(
      canRemovePost({ viewer: INSTRUCTOR, post: { ...LIVE, topicRemoved: true } }),
    ).toEqual({ canRemove: false, refusal: "topic_removed" });
  });

  it("a second removal is refused rather than overwriting the first one's audit trail", () => {
    expect(canRemovePost({ viewer: INSTRUCTOR, post: { ...LIVE, removed: true } })).toEqual({
      canRemove: false,
      refusal: "already_removed",
    });
  });

  it("removing a whole THREAD is moderators only, never the author", () => {
    // Asymmetric with post removal on purpose: an opening post carries every
    // reply other students wrote underneath it. See policy.ts#canRemoveTopic.
    expect(canRemoveTopic(INSTRUCTOR.role)).toBe(true);
    expect(canRemoveTopic(ADMIN.role)).toBe(true);
    expect(canRemoveTopic(AUTHOR.role)).toBe(false);
  });
});

// ===========================================================================
describe("replying", () => {
  it("is allowed in an open thread", () => {
    expect(canReply({ viewer: AUTHOR, topicLocked: false, topicRemoved: false })).toEqual({
      canReply: true,
    });
  });

  it("is refused in a locked thread", () => {
    expect(canReply({ viewer: AUTHOR, topicLocked: true, topicRemoved: false })).toEqual({
      canReply: false,
      refusal: "topic_locked",
    });
  });

  it("is refused in a removed thread", () => {
    expect(canReply({ viewer: AUTHOR, topicLocked: false, topicRemoved: true })).toEqual({
      canReply: false,
      refusal: "topic_removed",
    });
  });

  it("is refused in a locked thread FOR STAFF TOO — closure is not asymmetric", () => {
    // "Closed for you, open for me" is what makes a lock read as censorship.
    // See policy.ts#canReply.
    expect(canReply({ viewer: INSTRUCTOR, topicLocked: true, topicRemoved: false }).canReply)
      .toBe(false);
    expect(canReply({ viewer: ADMIN, topicLocked: true, topicRemoved: false }).canReply)
      .toBe(false);
  });
});

// ===========================================================================
describe("staff-only thread controls", () => {
  it.each([
    ["canModerate", canModerate],
    ["canMarkSolution", canMarkSolution],
    ["canAdministerTopic", canAdministerTopic],
    ["canRemoveTopic", canRemoveTopic],
  ])("%s: instructor and admin yes, student no, anonymous no", (_name, fn) => {
    expect(fn("instructor")).toBe(true);
    expect(fn("admin")).toBe(true);
    expect(fn("student")).toBe(false);
    expect(fn(null)).toBe(false);
    expect(fn(undefined)).toBe(false);
    // An unrecognised role must not fall through to the permissive branch. This
    // is the shape of a stale JWT after a role is renamed.
    expect(fn("moderator")).toBe(false);
    expect(fn("")).toBe(false);
  });

  it("a student never gains moderation by having a truthy-looking role string", () => {
    // Guards against a `roleSatisfies` regression that tested truthiness rather
    // than membership of ROLES_SATISFYING.instructor.
    for (const role of ["Instructor", "INSTRUCTOR", "student ", "admin\n"]) {
      expect(canModerate(role)).toBe(false);
    }
  });
});

// ===========================================================================
describe("input normalisation happens server-side, not in the form", () => {
  it("a title is trimmed and its internal whitespace collapsed", () => {
    expect(normaliseTitle("  Why does   flexbox\n wrap?  ")).toBe("Why does flexbox wrap?");
  });

  it("a whitespace-only title is null, so the caller refuses instead of storing a blank", () => {
    expect(normaliseTitle("   \n\t ")).toBeNull();
    expect(normaliseTitle("")).toBeNull();
  });

  it("a non-string title is null — a form field can be a File or an array", () => {
    expect(normaliseTitle(undefined)).toBeNull();
    expect(normaliseTitle(null)).toBeNull();
    expect(normaliseTitle(42)).toBeNull();
    expect(normaliseTitle(["a", "b"])).toBeNull();
  });

  it("an over-long title is TRUNCATED to the column length, not rejected", () => {
    const long = "a".repeat(TOPIC_TITLE_MAX + 500);
    expect(normaliseTitle(long)).toHaveLength(TOPIC_TITLE_MAX);
  });

  it("the policy caps match the column widths they are the backstop for", () => {
    // Two constants in two files that MUST agree: a policy cap larger than the
    // column turns an over-long post into a driver error inside a request, and a
    // smaller one silently shortens posts for no stated reason.
    expect(TOPIC_TITLE_MAX).toBe(TOPIC_TITLE_CHARS);
    expect(POST_CONTENT_MAX).toBe(POST_CONTENT_CHARS);
  });

  it("a body keeps its internal newlines — markdown paragraphs and code blocks depend on them", () => {
    const markdown = "First paragraph.\n\n```js\nconst a = 1;\n```";
    expect(normaliseBody(`\n\n${markdown}\n  `)).toBe(markdown);
  });

  it("a body is NOT escaped or stripped on the way in", () => {
    // The single most important normalisation assertion. Escaping at write time
    // corrupts the source for every future reader and for the author's own next
    // edit; the renderer is what makes the payload inert. If this ever starts
    // returning "&lt;script&gt;", sanitise-on-write has crept in and the stored
    // text no longer round-trips.
    const hostile = '<script>alert(1)</script> and 5 < 6 & 7 > 6';
    expect(normaliseBody(hostile)).toBe(hostile);
  });

  it("an over-long body is truncated to the documented cap", () => {
    expect(normaliseBody("x".repeat(POST_CONTENT_MAX + 1))).toHaveLength(POST_CONTENT_MAX);
  });

  it("a removal reason is optional and collapses to null when blank", () => {
    expect(normaliseRemovalReason("  ")).toBeNull();
    expect(normaliseRemovalReason("Off  topic\nand rude")).toBe("Off topic and rude");
  });

  it("validId refuses everything that is not a positive integer id", () => {
    expect(validId("7")).toBe(7);
    expect(validId(7)).toBe(7);
    // `Number("1e3")` is 1000 and `Number("")` is 0 — the two reasons a bare
    // Number() cast on a form value is not a validation.
    expect(validId("")).toBeNull();
    expect(validId("0")).toBeNull();
    expect(validId("-3")).toBeNull();
    expect(validId("1.5")).toBeNull();
    expect(validId("abc")).toBeNull();
    expect(validId(null)).toBeNull();
    expect(validId(undefined)).toBeNull();
    expect(validId(Number.NaN)).toBeNull();
    expect(validId(Number.POSITIVE_INFINITY)).toBeNull();
    // "1e3" IS an integer after coercion, so it is accepted as 1000 — which is a
    // real id or nothing, and the query filters on it. Asserted so the behaviour
    // is chosen rather than discovered.
    expect(validId("1e3")).toBe(1000);
  });
});

// ===========================================================================
describe("refusal copy never turns a guessed id into an oracle", () => {
  it("the two 'someone else's row' refusals say the same thing", () => {
    // A message distinguishing "not yours" from "does not exist" would let a
    // student enumerate which post ids exist. Both must read as ownership.
    expect(EDIT_REFUSAL_MESSAGE.not_author).toMatch(/only edit your own/i);
    expect(REMOVE_REFUSAL_MESSAGE.not_permitted).toMatch(/only remove your own/i);
  });

  it("every refusal variant has copy — an undefined message renders as blank", () => {
    for (const message of [
      ...Object.values(EDIT_REFUSAL_MESSAGE),
      ...Object.values(REMOVE_REFUSAL_MESSAGE),
    ]) {
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(10);
    }
  });
});
