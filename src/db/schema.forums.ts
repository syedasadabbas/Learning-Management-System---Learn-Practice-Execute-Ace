// =============================================================================
// DISCUSSION FORUMS — schema module for the forums stream.
// -----------------------------------------------------------------------------
// Owner: forums stream (IMPLEMENTATION_ROADMAP.md, Phase 2, feature 5).
//
// WHY THIS IS A SEPARATE FILE AND NOT AN APPEND TO src/db/schema.ts
//
// The same reason src/db/schema.access.ts:6 and src/db/schema.queue.ts:2 give,
// and the reason drizzle.config.ts:9-14 states in its own comment: `schema.ts` is
// the frozen Wave 0 seam and is edited concurrently by several streams, so a
// stream that needs tables of its own adds a sibling module and ONE entry to the
// config's `schema` array. drizzle-kit unions every listed path into one
// snapshot, so a generated migration is identical to an inline declaration.
//
// This module imports FROM schema.ts and schema.ts does not import it, so there
// is no cycle. The one cost, identical to schema.access.ts:16-18:
// `db.query.forumTopics` is unavailable because src/db/index.ts passes only
// `./schema` to `drizzle()`. Nothing here needs it — every read in
// src/lib/forums/store.ts uses the select builder or raw SQL.
//
// -----------------------------------------------------------------------------
// FOUR DELIBERATE DEPARTURES FROM THE ROADMAP SNIPPET (IMPLEMENTATION_ROADMAP.md
// lines 389-415). Each is "prefer what exists" or a stated correction, not drift.
//
//  1. `serial` INTEGER KEYS, NOT `uuid`. The snippet writes
//     `id: uuid('id').primaryKey().defaultRandom()` and
//     `weekId: uuid('week_id').references(() => weeks.id)`. That does not
//     compile against this database: `weeks.id` is `serial` (src/db/schema.ts:137)
//     and every other table in the repo — including both existing sibling schema
//     modules — keys on `serial`. A uuid foreign key to a serial primary key is a
//     type error, and mixed key types would make every join in store.ts cast.
//
//  2. NO `postCount` COLUMN, AND NO `lastPostAt` COLUMN. The snippet denormalises
//     both onto `forum_topics`. They are dropped and DERIVED in SQL instead —
//     `count(p.id)` and `max(p.created_at)` in the same GROUP BY statement that
//     lists the topics. This is the N+1 requirement's answer, and dropping the
//     counters is what makes it safe rather than what makes it slow:
//
//       * A stored counter has to be maintained by every writer. There are five
//         (create post, remove post by author, remove post by moderator, cascade
//         delete of a user, cascade delete of a topic) and the two cascades are
//         performed by POSTGRES, which will not run application code to fix the
//         counter. So `post_count` would be wrong the first time an account is
//         deleted, and wrong silently — a topic reading "12 replies" that shows 9.
//       * The aggregate costs NOTHING here. docs/SUBJECT_SECTIONS.md's appendix
//         measures a Neon round trip at ~245 ms and a four-row aggregate at the
//         same ~245 ms: "query complexity is irrelevant... the number is the
//         network round trip". A LEFT JOIN + GROUP BY inside the statement that
//         was already being issued adds no trip at all.
//       * What it DOES cost, stated: `ORDER BY max(p.created_at)` cannot use an
//         index, so this is a sort over the topic rows of ONE week. The seeded
//         course has 4 weeks; a week with enough topics for that sort to matter
//         (tens of thousands) would need the counter back, and at that point it
//         should be a trigger-maintained column, not five application writers.
//
//  3. NO `upvotes` COLUMN. The snippet has `upvotes: integer().default(0)` and
//     the roadmap describes no voting UI, no vote table and no per-user vote
//     uniqueness. An integer with no writer is a column that reads as a feature;
//     worse, an `upvotes` counter with no `forum_post_votes` table cannot stop
//     one student voting a thousand times. Left out until voting is specified.
//
//  4. TOMBSTONE COLUMNS ADDED (`removed_at`, `removed_by`, `removal_reason`).
//     The roadmap specifies moderation nowhere in the schema — INTEGRATION_SUMMARY.md:324
//     names "moderation queue, flagging system" only as a risk mitigation. See
//     the block above `removedAt` for why removal is a tombstone and not a DELETE.
//
// All timestamps are `timestamptz` written by the DATABASE's clock, and every
// duration/measurement in this stream is metric (house rules).
// =============================================================================

import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { users, weeks } from "./schema";

/**
 * Maximum characters in a topic title. Mirrored by `TOPIC_TITLE_MAX` in
 * src/lib/forums/policy.ts, which is what actually truncates — the column length
 * is the backstop, not the validator. A `varchar` overflow surfaces as a driver
 * error inside a request; the policy function surfaces as a shortened title.
 */
export const TOPIC_TITLE_CHARS = 200;

/**
 * ONE DISCUSSION THREAD, ANCHORED TO A WEEK.
 *
 * WHY `week_id` AND NOT `course_id`. Two reasons, and the second is the load-bearing
 * one:
 *
 *   (a) The roadmap says so ("Week-based forum topics", INTEGRATION_SUMMARY.md:131)
 *       and the page path it specifies is week-scoped.
 *   (b) A week is the unit the app ALREADY knows how to authorize. `gateWeek`
 *       (src/components/course/data.ts:338) resolves the section-release switch
 *       (docs/SUBJECT_SECTIONS.md) and the quiz-progression rule together and
 *       returns one answer. Anchoring a thread to a week means forum visibility
 *       is that same answer, consumed — not a fourth gate that can disagree with
 *       the three that exist. A `course_id` anchor would have needed its own
 *       visibility rule and would have leaked a locked subject's discussion to a
 *       student the section switch is withholding it from.
 *
 * `onDelete: "cascade"` on the week: deleting a week deletes its curriculum, and
 * orphan threads pointing at a nonexistent week would be unreachable rows that
 * still count in an aggregate.
 */
export const forumTopics = pgTable(
  "forum_topics",
  {
    id: serial("id").primaryKey(),

    weekId: integer("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),

    title: varchar("title", { length: TOPIC_TITLE_CHARS }).notNull(),

    /**
     * The opening post's body, in MARKDOWN. Named `description` to match the
     * roadmap snippet rather than renamed to `body`, so the column a reader looks
     * for from the spec is the column that exists.
     *
     * NULLABLE, and that is not the same as empty. A topic whose entire content
     * is its title ("Is anyone else stuck on flexbox?") is a legitimate thread
     * opener, and storing "" for it would make "has an opening post" untestable.
     *
     * THIS IS STUDENT-AUTHORED TEXT AND IS STORED RAW. It is NOT sanitised on the
     * way in. See src/components/forums/ForumPostViewer.tsx for the full argument;
     * the summary is that escaping at write time corrupts the source ("5 < 6"
     * becomes "5 &lt; 6" for every future reader and edit), and the renderer
     * (src/components/course/MarkdownContent.tsx) does not interpret HTML at all,
     * so there is nothing for a stored payload to be interpreted BY.
     */
    description: text("description"),

    /** Who opened it. Cascade: an erased account takes its own threads with it. */
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Staff-only. Pinned threads sort first within a week. */
    isPinned: boolean("is_pinned").notNull().default(false),

    /**
     * Staff-only. A locked thread accepts no new posts and no student edits, but
     * stays READABLE. Locking is the moderator's alternative to removal for a
     * thread that has run its course or turned unproductive: deleting it would
     * destroy answers that are still useful to the next cohort.
     */
    isLocked: boolean("is_locked").notNull().default(false),

    /**
     * TOMBSTONE, not a DELETE. See the identical block on `forumPosts.removedAt`
     * for the whole argument — it applies to a topic with one addition: removing a
     * topic does NOT remove its posts, because a moderator who takes down an
     * off-topic thread has said nothing about whether each reply was abusive. The
     * read model refuses the whole thread when the topic is tombstoned, so the
     * posts become unreachable without being judged.
     */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: integer("removed_by").references(() => users.id, { onDelete: "set null" }),
    removalReason: varchar("removal_reason", { length: 200 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * THE ONLY ACCESS PATTERN THAT MATTERS: "every live topic of week N, pinned
     * first". `week_id` leads because it is the equality predicate; `is_pinned`
     * follows because it is the first sort key. The second sort key
     * (`max(post.created_at)`) is a derived aggregate and cannot be indexed —
     * see departure 2 in the file header for why that is the right trade here.
     */
    weekIdx: index("forum_topics_week_idx").on(t.weekId, t.isPinned),
    /** Serves "did this student open any threads?" on a profile or audit read. */
    authorIdx: index("forum_topics_created_by_idx").on(t.createdBy),
  }),
);

/**
 * Maximum characters in one post body. Mirrored by `POST_CONTENT_MAX` in
 * src/lib/forums/policy.ts.
 *
 * `text` has no length limit in Postgres, so unlike the title this is NOT
 * enforced by the column — the policy function is the only enforcement, which is
 * exactly why the cap is declared here next to the column it describes rather
 * than only in the validator. 10 000 characters is roughly four A4 pages: long
 * enough for a student to paste a stack trace and a code block, short enough that
 * one post cannot be a denial-of-service against the thread page's render.
 */
export const POST_CONTENT_CHARS = 10_000;

/**
 * ONE REPLY IN A THREAD.
 *
 * FLAT, NOT NESTED. The roadmap's summary says "Post replies with threading"
 * (INTEGRATION_SUMMARY.md:132) but its schema snippet has no `parent_post_id` and
 * no depth column, so "threading" there means "a thread of replies", not a tree.
 * Following the SCHEMA rather than the prose is deliberate: an adjacency-list tree
 * cannot be ordered by a single SQL ORDER BY, so rendering it needs either a
 * recursive CTE with a materialised path or an in-memory tree build, and a
 * two-level-deep reply tree is a feature nobody asked for that would change the
 * thread page's query shape. Chronological order, one level.
 */
export const forumPosts = pgTable(
  "forum_posts",
  {
    id: serial("id").primaryKey(),

    topicId: integer("topic_id")
      .notNull()
      .references(() => forumTopics.id, { onDelete: "cascade" }),

    /**
     * Named `author_id`, NOT the snippet's `user_id`.
     *
     * `user_id` in this schema means "the row is ABOUT this user" (`progress`,
     * `attendance`, `leaderboard`). Here the relationship is authorship, and the
     * distinction is the one every authorization check in this stream turns on:
     * `canEditPost` compares the viewer to the AUTHOR. A column named `user_id`
     * on a table that also has moderators acting on it invites exactly the
     * confusion that produces "a student edited another student's post".
     */
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** MARKDOWN, stored raw. See `forumTopics.description` for why. */
    content: text("content").notNull(),

    /**
     * Marked by a moderator as the answer. Staff-only, and NOT unique per topic
     * at the database level on purpose: two different replies can each solve part
     * of a question, and a unique partial index would make marking the second one
     * fail with a constraint error rather than simply mark it.
     */
    isSolution: boolean("is_solution").notNull().default(false),

    /**
     * Set when the AUTHOR edits their own post. Distinct from `updated_at`, which
     * also moves when a moderator tombstones the row or a solution flag is set.
     * The UI shows "edited" from this column alone — labelling a moderated post
     * "edited by the author" would be a false statement about a student.
     */
    editedAt: timestamp("edited_at", { withTimezone: true }),

    /**
     * REMOVAL IS A TOMBSTONE, NOT A `DELETE`. This is the moderation requirement's
     * answer and the reasoning is worth stating in full, because "just delete it"
     * is the obvious alternative:
     *
     *   1. A HARD DELETE DESTROYS THE THREAD'S MEANING. Posts are flat and
     *        chronological, and replies quote and answer each other by position
     *        ("the second point above is wrong"). Deleting post 3 of 7 silently
     *        rewrites what posts 4-7 appear to be replying to. A tombstone leaves
     *        the gap visible and labelled.
     *   2. THE ROW IS THE AUDIT RECORD. `removed_by` and `removed_at` are the only
     *        evidence that a moderator ever acted, and a student who believes a
     *        removal was unfair has nothing to appeal against once the row is
     *        gone. This is the SAME argument this repo already makes twice, in the
     *        same words: src/db/schema.access.ts:99 ("A rejected row is KEPT,
     *        never deleted... deleting the row would erase the only evidence that
     *        an admin ever looked at it") and the `topic_videos` review flow.
     *   3. `is_solution` WOULD DANGLE. A deleted post that was the marked solution
     *        leaves a thread claiming to be solved by nothing.
     *
     * WHAT "REMOVED" MEANS TO A READER, and this is the part that makes the
     * tombstone honest rather than a way to keep serving removed content: the
     * content column is NOT cleared (that is the audit copy), and the read model
     * in src/lib/forums/store.ts NEVER SELECTS IT for a removed row — it emits
     * SQL `NULL` via a CASE expression, so the body cannot reach a component even
     * by a rendering mistake. The client receives the fact of removal, its reason,
     * and nothing else.
     *
     * WHO CAN SET IT: a moderator on any post, or the AUTHOR on their own. Both
     * write the same tombstone, so `removed_by = author_id` is how a self-delete
     * is distinguished from a moderation action. A student's "delete" therefore
     * is not a way to erase evidence either — deliberately, since the alternative
     * lets an author post abuse and then remove the proof.
     */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: integer("removed_by").references(() => users.id, { onDelete: "set null" }),
    removalReason: varchar("removal_reason", { length: 200 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * The thread page reads `WHERE topic_id = $1 ORDER BY created_at ASC`, and
     * the topic list aggregates `count(*)`/`max(created_at)` GROUPED BY topic_id.
     * Both are served by this one composite index — which is also what keeps the
     * aggregate in departure 2 an index scan rather than a heap scan per topic.
     */
    topicIdx: index("forum_posts_topic_idx").on(t.topicId, t.createdAt),
    /** The roadmap's snippet asks for this; it serves "posts by this student". */
    authorIdx: index("forum_posts_author_idx").on(t.authorId),
  }),
);

export type ForumTopic = typeof forumTopics.$inferSelect;
export type NewForumTopic = typeof forumTopics.$inferInsert;
export type ForumPost = typeof forumPosts.$inferSelect;
export type NewForumPost = typeof forumPosts.$inferInsert;
