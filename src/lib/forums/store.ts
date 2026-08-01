// =============================================================================
// FORUM PERSISTENCE — the only file in this stream that talks to the database.
// -----------------------------------------------------------------------------
// Owner: forums stream. Server-only (imports the Drizzle client).
//
// =============================================================================
// PART 1 — THE N+1 PROBLEM, AND THE QUERY BUDGET FOR EVERY PAGE
// =============================================================================
//
// A thread list with per-thread reply counts is THE classic N+1, and on this
// deployment it is not a style problem, it is a five-second page. Commit 25fe2d2
// and docs/SUBJECT_SECTIONS.md's appendix measured the Neon instance in us-east-2:
//
//   | Operation                                   | Cost      |
//   |---------------------------------------------|-----------|
//   | opening a new pooled connection             | ~1700 ms  |
//   | ANY query on an existing connection         | ~245 ms   |
//   | a 4-row aggregate, one statement            | ~245 ms   |
//
// The conclusion recorded there is the one this file is built around: "Query
// complexity is irrelevant... the number is the network round trip. So the metric
// that matters is a page's SEQUENTIAL DEPTH." A 20-thread list that issues
// `SELECT count(*) FROM forum_posts WHERE topic_id = $1` per thread costs
// 1 + 20 = 21 round trips ≈ 5.1 SECONDS, and it would look completely fine in
// review — one small query in a `.map()`.
//
// So every list read below aggregates in SQL. THE MEASURED BUDGET, per page:
//
//   | Page                          | Statements | Sequential depth | ~Latency |
//   |-------------------------------|------------|------------------|----------|
//   | /forums                       | 3          | 1                | ~245 ms  |
//   | /forums/:weekId (N topics)    | 3          | 1                | ~245 ms  |
//   | /forums/:weekId/:topicId      | 4          | 1                | ~245 ms  |
//   | any mutation (action)         | 2          | 2                | ~490 ms  |
//
// Read those columns carefully, because the second one is the one that matters:
//
//   * /forums issues `getWeekList` (itself 2 statements run concurrently — see
//     src/components/course/data.ts:290) and `countTopicsByWeek` below. Neither
//     depends on the other's result, so all three go on the wire together:
//     THREE statements, depth ONE. Topic counts for ALL FOUR weeks come back in
//     one statement, not one per week.
//
//   * /forums/:weekId issues `getWeekList` (2) and `listTopics` (1) concurrently.
//     `listTopics` needs only the weekId, which is a ROUTE PARAMETER — it is not
//     derived from the gate — so there is no data dependency to serialise on.
//     Reply count, last-activity time and solved-flag for every topic are
//     aggregates inside that ONE statement. **The count is O(1) statements in the
//     number of topics.** 20 topics: 3 statements. 200 topics: 3 statements.
//
//   * /forums/:weekId/:topicId issues `getWeekList` (2), `getTopic` (1) and
//     `listPosts` (1), all four concurrently. Depth one.
//
//   * A mutation is depth TWO and cannot be less: it must READ the row's
//     authorization facts (`loadPostForWrite`) before it may WRITE, and the write
//     depends on the read's answer. That is a real dependency, not an oversight.
//
// ISSUING THE CONTENT READ CONCURRENTLY WITH THE GATE DOES NOT WEAKEN THE GATE.
// This is the same argument `gateLecture` makes at src/components/course/data.ts:395
// and it is worth restating because it looks like a shortcut: the query goes on
// the wire early, but the RESULT IS DISCARDED UNREAD unless the gate allowed it.
// The refusal still happens before any thread content is returned to the browser,
// and it is still driven by the same `getWeekList` result. The only thing that
// changed is when the bytes were requested.
//
// =============================================================================
// PART 2 — THE PRIVACY / AUTHORIZATION PROPERTIES THIS FILE GUARANTEES
// =============================================================================
//
//  (a) NO READ HERE CAN RETURN A REMOVED POST'S BODY. `listPosts` selects
//      `CASE WHEN removed_at IS NULL THEN content ELSE NULL END`, so a tombstoned
//      body never leaves Postgres. That is stronger than filtering in the caller:
//      a caller that forgets to filter is a bug that compiles, whereas here there
//      is no code path — not a component mistake, not a future JSON endpoint —
//      that can surface the text. The row keeps its content for audit; the wire
//      never sees it. See src/db/schema.forums.ts's `removedAt` block.
//
//  (b) EVERY WRITE THAT DEPENDS ON AUTHORSHIP CARRIES `author_id` IN ITS `WHERE`
//      CLAUSE. `updatePostContent` is a compare-and-set on (id, author_id), so
//      even if `canEditPost` were bypassed entirely the UPDATE would match zero
//      rows and report failure. Defence in depth: the policy function is the
//      control, the WHERE clause is the backstop, and neither is trusted alone.
//
//  (c) NO READ TAKES A `studentId` FOR FILTERING, BECAUSE FORUM CONTENT IS
//      COHORT-VISIBLE BY DESIGN — that is what a forum is. The access decision is
//      therefore entirely at the WEEK level and is made by `gateWeek` before any
//      function here is called (see src/lib/forums/access.ts). This is a
//      deliberate difference from src/lib/courses/store.ts:6-13, whose reads are
//      all student-scoped, and it is called out so the difference reads as a
//      decision rather than a missing filter.
//
//  (d) `getTopic` TAKES BOTH A TOPIC ID AND ITS EXPECTED WEEK ID. A topic id from
//      a DIFFERENT week reached through an ALLOWED week's URL
//      (/forums/1/<topic-in-week-4>) returns not-found rather than content. This
//      is the same defect `gateLecture`'s `weekIdHint` exists to close
//      (src/components/course/data.ts:376) — without it, week 1's open gate would
//      serve week 4's withheld discussion.
// =============================================================================

import { sql } from "drizzle-orm";

import { db } from "@/db";

// ---------------------------------------------------------------------------
// Driver-shape defence
// ---------------------------------------------------------------------------

/**
 * `db.execute` returns different shapes per driver: node-postgres yields a
 * QueryResult (`{ rows }`), neon-http yields the rows directly. Same defence as
 * src/components/course/data.ts:181 and src/lib/progress/query.ts — written once
 * here rather than at each call site, because the failure mode of getting it
 * wrong is `undefined.length` at runtime in whichever environment was not tested.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** Postgres `bigint`/`numeric` aggregates arrive as strings on some drivers. */
function int(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Timestamps cross the server/client boundary as ISO strings, never as Date. */
function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// Row shapes returned to pages
// ---------------------------------------------------------------------------

/** One week's forum activity summary, for the /forums index. */
export interface WeekForumSummary {
  weekId: number;
  /** Live (non-tombstoned) topics only. */
  topicCount: number;
  /** Most recent live topic or live reply, ISO 8601 UTC. Null when silent. */
  lastActivityAt: string | null;
}

/** One row of the thread list. */
export interface TopicListItem {
  id: number;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  authorId: number;
  authorName: string;
  createdAt: string;
  /** Live replies. AGGREGATED IN SQL — see PART 1 of the file header. */
  replyCount: number;
  /** Most recent live reply, or null when nobody has answered. */
  lastReplyAt: string | null;
  /** True when any live reply is marked as the solution. */
  hasSolution: boolean;
}

/** The thread header. */
export interface TopicDetail {
  id: number;
  weekId: number;
  title: string;
  /** Markdown. Null when the opener wrote a title only. */
  description: string | null;
  isPinned: boolean;
  isLocked: boolean;
  removed: boolean;
  /**
   * The moderator's stated reason, and NULL unless the thread is removed.
   *
   * Withheld for a live thread by the same `CASE` discipline as `description`: a
   * `removal_reason` on a row that is not removed would be leftover text from a
   * removal that was reversed, and surfacing it would tell readers a live thread
   * had been moderated.
   */
  removalReason: string | null;
  authorId: number;
  authorName: string;
  createdAt: string;
}

/** One post as a reader receives it. */
export interface PostView {
  id: number;
  authorId: number;
  authorName: string;
  /**
   * Markdown, or NULL for a removed post — the database itself withholds it
   * (property (a) in the header). A component must render `removedByModerator`
   * copy when this is null, never an empty body.
   */
  content: string | null;
  isSolution: boolean;
  removed: boolean;
  /** True when a MODERATOR removed it; false when the author retracted it. */
  removedByModerator: boolean;
  removalReason: string | null;
  edited: boolean;
  createdAt: string;
}

/**
 * The five authorization facts a write decision needs, in ONE statement.
 *
 * Shaped to feed `PostSubject` in policy.ts directly. Loading these separately
 * (post, then its topic) would be a forced serial pair — ~490 ms before the
 * decision could even be made — for facts that one JOIN returns together.
 */
export interface PostWriteSubject {
  postId: number;
  authorId: number;
  topicId: number;
  /** The week the post's thread belongs to. Fed straight into `gateWeek`. */
  weekId: number;
  removed: boolean;
  topicLocked: boolean;
  topicRemoved: boolean;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Live topic counts and last activity for EVERY week of the active course, in ONE
 * statement.
 *
 * THIS IS THE FUNCTION THAT WOULD OTHERWISE BE THE INDEX PAGE'S N+1. The obvious
 * shape is `weeks.map(w => countTopics(w.id))` — four statements today and one
 * per week forever after. It is one `GROUP BY` instead.
 *
 * `count(DISTINCT t.id)` and not `count(t.id)`: the LEFT JOIN to posts fans each
 * topic row out once per reply, so a plain count would report a topic with 9
 * replies as 9 topics. This is the specific arithmetic error that makes people
 * abandon the join and go back to the N+1 — stated here so the next reader does
 * not "fix" it.
 *
 * The active course is resolved INLINE as `ORDER BY id ASC LIMIT 1` rather than
 * passed in, matching `loadCourseAndWeeks` (src/components/course/data.ts:156-162)
 * and `getActiveCourseId` (src/lib/courses/store.ts:44) exactly. Those two already
 * carry the standing TODO(shared-contracts) for an explicit active-course marker;
 * this is a third copy of a four-word ORDER BY, and it is the smaller evil than
 * making this statement depend on a prior round trip for the id.
 */
export async function countTopicsByWeek(): Promise<Map<number, WeekForumSummary>> {
  type Row = {
    weekId: number | string;
    topicCount: number | string;
    lastActivityAt: Date | string | null;
  };

  const result = await db.execute(sql`
    SELECT
      w.id                        AS "weekId",
      count(DISTINCT t.id)        AS "topicCount",
      greatest(max(t.created_at), max(p.created_at)) AS "lastActivityAt"
    FROM weeks w
    LEFT JOIN forum_topics t
           ON t.week_id = w.id
          AND t.removed_at IS NULL
    LEFT JOIN forum_posts p
           ON p.topic_id = t.id
          AND p.removed_at IS NULL
    WHERE w.course_id = (SELECT id FROM courses ORDER BY id ASC LIMIT 1)
    GROUP BY w.id
  `);

  const summaries = new Map<number, WeekForumSummary>();
  for (const row of rowsOf<Row>(result)) {
    const weekId = int(row.weekId);
    summaries.set(weekId, {
      weekId,
      topicCount: int(row.topicCount),
      lastActivityAt: iso(row.lastActivityAt),
    });
  }
  return summaries;
}

/**
 * Every live topic of one week, with its reply count, last activity and solved
 * flag — ONE statement, whatever the number of topics.
 *
 * ORDERING: pinned first (a staff pin is an instruction about what to read
 * first), then most recent activity, then newest. `COALESCE(max(p.created_at),
 * t.created_at)` is what makes a brand-new unanswered thread sort above a stale
 * answered one instead of below every thread that has any reply at all.
 *
 * WHY THE AGGREGATE IS NOT A STORED COUNTER: argued in full at
 * src/db/schema.forums.ts, departure 2. The short version is that Postgres
 * performs the two cascade deletes itself and will not run application code to
 * fix a counter, so a `post_count` column is wrong the first time an account is
 * deleted — and wrong silently.
 *
 * TOMBSTONED ROWS ARE EXCLUDED FROM BOTH SIDES: `t.removed_at IS NULL` drops
 * removed threads entirely, and `AND p.removed_at IS NULL` in the JOIN predicate
 * — NOT in the WHERE clause — drops removed replies from the count while keeping
 * topics that have no live replies at all. Moving that condition to the WHERE
 * would silently turn the LEFT JOIN into an inner one and hide every unanswered
 * thread, which is the classic LEFT JOIN filter bug.
 */
export async function listTopics(weekId: number): Promise<TopicListItem[]> {
  if (!Number.isInteger(weekId) || weekId <= 0) return [];

  type Row = {
    id: number | string;
    title: string;
    isPinned: boolean;
    isLocked: boolean;
    authorId: number | string;
    authorName: string | null;
    createdAt: Date | string;
    replyCount: number | string;
    lastReplyAt: Date | string | null;
    hasSolution: boolean | null;
  };

  const result = await db.execute(sql`
    SELECT
      t.id                                        AS "id",
      t.title                                     AS "title",
      t.is_pinned                                 AS "isPinned",
      t.is_locked                                 AS "isLocked",
      t.created_by                                AS "authorId",
      u.name                                      AS "authorName",
      t.created_at                                AS "createdAt",
      count(p.id)                                 AS "replyCount",
      max(p.created_at)                           AS "lastReplyAt",
      coalesce(bool_or(p.is_solution), false)     AS "hasSolution"
    FROM forum_topics t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN forum_posts p
           ON p.topic_id = t.id
          AND p.removed_at IS NULL
    WHERE t.week_id = ${weekId}
      AND t.removed_at IS NULL
    GROUP BY t.id, u.name
    ORDER BY
      t.is_pinned DESC,
      coalesce(max(p.created_at), t.created_at) DESC,
      t.id DESC
  `);

  return rowsOf<Row>(result).map((row) => ({
    id: int(row.id),
    title: row.title,
    isPinned: Boolean(row.isPinned),
    isLocked: Boolean(row.isLocked),
    authorId: int(row.authorId),
    // A NULL name is possible if a display name was never set; the email is NOT
    // substituted. Showing a classmate's address is the exact leak the
    // leaderboard privacy specs exist to prevent (tests/e2e/fixtures.ts:38-47).
    authorName: row.authorName?.trim() || "A student",
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    replyCount: int(row.replyCount),
    lastReplyAt: iso(row.lastReplyAt),
    hasSolution: Boolean(row.hasSolution),
  }));
}

/**
 * One thread's header, scoped to the week it must belong to.
 *
 * `weekId` IS A SECURITY PARAMETER, not a convenience filter — see property (d)
 * in the file header. Without it, /forums/1/<topic-id-from-week-4> would render
 * week 4's discussion behind week 1's open gate.
 *
 * A tombstoned topic returns the row with `removed: true` rather than null, so the
 * page can say "this discussion was removed" instead of 404-ing a URL that was
 * valid yesterday. Its `description` is withheld the same way a removed post's
 * body is.
 */
export async function getTopic(topicId: number, weekId: number): Promise<TopicDetail | null> {
  if (!Number.isInteger(topicId) || topicId <= 0) return null;
  if (!Number.isInteger(weekId) || weekId <= 0) return null;

  type Row = {
    id: number | string;
    weekId: number | string;
    title: string;
    description: string | null;
    isPinned: boolean;
    isLocked: boolean;
    removed: boolean;
    removalReason: string | null;
    authorId: number | string;
    authorName: string | null;
    createdAt: Date | string;
  };

  const result = await db.execute(sql`
    SELECT
      t.id          AS "id",
      t.week_id     AS "weekId",
      t.title       AS "title",
      CASE WHEN t.removed_at IS NULL THEN t.description ELSE NULL END AS "description",
      t.is_pinned   AS "isPinned",
      t.is_locked   AS "isLocked",
      (t.removed_at IS NOT NULL) AS "removed",
      CASE WHEN t.removed_at IS NULL THEN NULL ELSE t.removal_reason END AS "removalReason",
      t.created_by  AS "authorId",
      u.name        AS "authorName",
      t.created_at  AS "createdAt"
    FROM forum_topics t
    JOIN users u ON u.id = t.created_by
    WHERE t.id = ${topicId}
      AND t.week_id = ${weekId}
    LIMIT 1
  `);

  const row = rowsOf<Row>(result)[0];
  if (!row) return null;

  return {
    id: int(row.id),
    weekId: int(row.weekId),
    title: row.title,
    description: row.description,
    isPinned: Boolean(row.isPinned),
    isLocked: Boolean(row.isLocked),
    removed: Boolean(row.removed),
    removalReason: row.removalReason,
    authorId: int(row.authorId),
    authorName: row.authorName?.trim() || "A student",
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Every post of one thread, oldest first.
 *
 * THE `CASE` EXPRESSION ON `content` IS THE MODERATION GUARANTEE. A removed
 * post's body is not selected, so it does not exist in the process that renders
 * the page — see property (a) in the file header. Solution-marked posts are NOT
 * hoisted to the top: the thread reads as a conversation and reordering it breaks
 * replies that refer to "the answer above". The marked post carries a badge and
 * the list carries a jump link instead.
 */
export async function listPosts(topicId: number): Promise<PostView[]> {
  if (!Number.isInteger(topicId) || topicId <= 0) return [];

  type Row = {
    id: number | string;
    authorId: number | string;
    authorName: string | null;
    content: string | null;
    isSolution: boolean;
    removed: boolean;
    removedByModerator: boolean;
    removalReason: string | null;
    edited: boolean;
    createdAt: Date | string;
  };

  const result = await db.execute(sql`
    SELECT
      p.id         AS "id",
      p.author_id  AS "authorId",
      u.name       AS "authorName",
      CASE WHEN p.removed_at IS NULL THEN p.content ELSE NULL END AS "content",
      p.is_solution AS "isSolution",
      (p.removed_at IS NOT NULL) AS "removed",
      -- "By a moderator" means the remover was somebody other than the author.
      -- A NULL removed_by (the remover's account was deleted, ON DELETE SET NULL)
      -- counts as moderation: it was not the author, because the author's id is
      -- still on the row.
      (p.removed_at IS NOT NULL AND (p.removed_by IS NULL OR p.removed_by <> p.author_id))
                   AS "removedByModerator",
      CASE WHEN p.removed_at IS NULL THEN NULL ELSE p.removal_reason END AS "removalReason",
      (p.edited_at IS NOT NULL) AS "edited",
      p.created_at AS "createdAt"
    FROM forum_posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.topic_id = ${topicId}
    ORDER BY p.created_at ASC, p.id ASC
  `);

  return rowsOf<Row>(result).map((row) => ({
    id: int(row.id),
    authorId: int(row.authorId),
    authorName: row.authorName?.trim() || "A student",
    content: row.content,
    isSolution: Boolean(row.isSolution),
    removed: Boolean(row.removed),
    removedByModerator: Boolean(row.removedByModerator),
    removalReason: row.removalReason,
    edited: Boolean(row.edited),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  }));
}

/**
 * The authorization facts for one post, in ONE statement.
 *
 * Called by every mutation before it writes, and it is the read half of the
 * depth-2 mutation budget in the file header. It returns `weekId` so the caller
 * can put the SAME `gateWeek` check in front of a write that the read path uses —
 * a student whose week access lapsed must not keep write access to its threads.
 */
export async function loadPostForWrite(postId: number): Promise<PostWriteSubject | null> {
  if (!Number.isInteger(postId) || postId <= 0) return null;

  type Row = {
    postId: number | string;
    authorId: number | string;
    topicId: number | string;
    weekId: number | string;
    removed: boolean;
    topicLocked: boolean;
    topicRemoved: boolean;
  };

  const result = await db.execute(sql`
    SELECT
      p.id        AS "postId",
      p.author_id AS "authorId",
      p.topic_id  AS "topicId",
      t.week_id   AS "weekId",
      (p.removed_at IS NOT NULL) AS "removed",
      t.is_locked                AS "topicLocked",
      (t.removed_at IS NOT NULL) AS "topicRemoved"
    FROM forum_posts p
    JOIN forum_topics t ON t.id = p.topic_id
    WHERE p.id = ${postId}
    LIMIT 1
  `);

  const row = rowsOf<Row>(result)[0];
  if (!row) return null;

  return {
    postId: int(row.postId),
    authorId: int(row.authorId),
    topicId: int(row.topicId),
    weekId: int(row.weekId),
    removed: Boolean(row.removed),
    topicLocked: Boolean(row.topicLocked),
    topicRemoved: Boolean(row.topicRemoved),
  };
}

/** The topic's own write-relevant facts, for reply/lock/pin/remove decisions. */
export interface TopicWriteSubject {
  topicId: number;
  weekId: number;
  authorId: number;
  locked: boolean;
  removed: boolean;
}

export async function loadTopicForWrite(topicId: number): Promise<TopicWriteSubject | null> {
  if (!Number.isInteger(topicId) || topicId <= 0) return null;

  type Row = {
    topicId: number | string;
    weekId: number | string;
    authorId: number | string;
    locked: boolean;
    removed: boolean;
  };

  const result = await db.execute(sql`
    SELECT
      t.id         AS "topicId",
      t.week_id    AS "weekId",
      t.created_by AS "authorId",
      t.is_locked  AS "locked",
      (t.removed_at IS NOT NULL) AS "removed"
    FROM forum_topics t
    WHERE t.id = ${topicId}
    LIMIT 1
  `);

  const row = rowsOf<Row>(result)[0];
  if (!row) return null;
  return {
    topicId: int(row.topicId),
    weekId: int(row.weekId),
    authorId: int(row.authorId),
    locked: Boolean(row.locked),
    removed: Boolean(row.removed),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Open a thread. Returns the new id so the action can redirect to it.
 *
 * `created_by` is the SESSION user, passed in by the action from `requireUser()`
 * — never from a form field. A `studentId` parameter on this function would let
 * any signed-in user post as anyone else, which is the rule
 * src/lib/courses/actions.ts:20 states for exactly the same reason.
 */
export async function insertTopic(input: {
  weekId: number;
  title: string;
  description: string | null;
  createdBy: number;
}): Promise<number | null> {
  const result = await db.execute(sql`
    INSERT INTO forum_topics (week_id, title, description, created_by)
    VALUES (${input.weekId}, ${input.title}, ${input.description}, ${input.createdBy})
    RETURNING id
  `);
  const row = rowsOf<{ id: number | string }>(result)[0];
  return row ? int(row.id) : null;
}

/**
 * Add a reply.
 *
 * THE `WHERE NOT EXISTS` GUARD IS NOT DECORATION. `INSERT ... SELECT` with a
 * predicate makes the lock check part of the WRITE rather than a check performed
 * ~245 ms earlier: without it, a moderator locking a thread in the window between
 * the action's read and its insert would have the reply land anyway. The action
 * still calls `canReply` first — that produces the message the student reads —
 * but the database is what makes the lock true. Same read-then-write race, and
 * the same compare-and-set answer, as `decideRequest` in
 * src/lib/courses/store.ts.
 *
 * Returns null when the guard matched nothing, so the caller reports the truth
 * instead of claiming a post was made that was not.
 */
export async function insertPost(input: {
  topicId: number;
  authorId: number;
  content: string;
}): Promise<number | null> {
  const result = await db.execute(sql`
    INSERT INTO forum_posts (topic_id, author_id, content)
    SELECT ${input.topicId}, ${input.authorId}, ${input.content}
    WHERE EXISTS (
      SELECT 1 FROM forum_topics t
      WHERE t.id = ${input.topicId}
        AND t.is_locked = false
        AND t.removed_at IS NULL
    )
    RETURNING id
  `);
  const row = rowsOf<{ id: number | string }>(result)[0];
  return row ? int(row.id) : null;
}

/**
 * Edit a post's body.
 *
 * `author_id = ${authorId}` IN THE WHERE CLAUSE IS THE BACKSTOP FOR THE WHOLE
 * "not someone else's words" rule — property (b) in the file header. `canEditPost`
 * is the control and this is the second lock on the same door: if the policy call
 * were ever removed from the action, this statement would still match zero rows
 * for a non-author and report failure rather than rewriting a student's post.
 *
 * `removed_at IS NULL` and the lock check are here for the same
 * read-then-write-race reason as `insertPost`.
 *
 * `edited_at` is set from the DATABASE clock, not from the app's — one clock, per
 * the house rule that src/db/schema.queue.ts's header states.
 */
export async function updatePostContent(input: {
  postId: number;
  authorId: number;
  content: string;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE forum_posts p
       SET content = ${input.content},
           edited_at = now(),
           updated_at = now()
     WHERE p.id = ${input.postId}
       AND p.author_id = ${input.authorId}
       AND p.removed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM forum_topics t
         WHERE t.id = p.topic_id
           AND t.is_locked = false
           AND t.removed_at IS NULL
       )
    RETURNING p.id
  `);
  return rowsOf<{ id: unknown }>(result).length > 0;
}

/**
 * Tombstone a post. THIS IS WHAT "REMOVE" MEANS IN THIS FEATURE — no row is
 * deleted. See src/db/schema.forums.ts's `removedAt` block for the three reasons.
 *
 * `removedBy` is the ACTING user, which is how a self-retraction
 * (`removed_by = author_id`) is told apart from a moderation action by the read
 * in `listPosts`. The caller has already decided the actor is permitted; this
 * function does not re-derive it, but `removed_at IS NULL` makes a second removal
 * a no-op so a double-clicked button cannot overwrite the first remover's identity.
 */
export async function tombstonePost(input: {
  postId: number;
  removedBy: number;
  reason: string | null;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE forum_posts
       SET removed_at = now(),
           removed_by = ${input.removedBy},
           removal_reason = ${input.reason},
           updated_at = now()
     WHERE id = ${input.postId}
       AND removed_at IS NULL
    RETURNING id
  `);
  return rowsOf<{ id: unknown }>(result).length > 0;
}

/** Tombstone a whole thread. Moderators only — enforced by the action. */
export async function tombstoneTopic(input: {
  topicId: number;
  removedBy: number;
  reason: string | null;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE forum_topics
       SET removed_at = now(),
           removed_by = ${input.removedBy},
           removal_reason = ${input.reason},
           updated_at = now()
     WHERE id = ${input.topicId}
       AND removed_at IS NULL
    RETURNING id
  `);
  return rowsOf<{ id: unknown }>(result).length > 0;
}

/**
 * Mark or unmark one reply as the solution.
 *
 * NOT exclusive: marking a second reply does not unmark the first. Argued at
 * src/db/schema.forums.ts's `isSolution` block — two replies can each solve part
 * of a question, and enforcing exclusivity in the database would make the second
 * mark fail with a constraint error rather than simply mark it. An instructor who
 * wants exactly one unmarks the other.
 */
export async function setPostSolution(input: {
  postId: number;
  isSolution: boolean;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE forum_posts
       SET is_solution = ${input.isSolution},
           updated_at = now()
     WHERE id = ${input.postId}
       AND removed_at IS NULL
    RETURNING id
  `);
  return rowsOf<{ id: unknown }>(result).length > 0;
}

/** Lock/unlock a thread. Moderators only — enforced by the action. */
export async function setTopicLocked(input: {
  topicId: number;
  locked: boolean;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE forum_topics
       SET is_locked = ${input.locked},
           updated_at = now()
     WHERE id = ${input.topicId}
       AND removed_at IS NULL
    RETURNING id
  `);
  return rowsOf<{ id: unknown }>(result).length > 0;
}

/** Pin/unpin a thread. Moderators only — enforced by the action. */
export async function setTopicPinned(input: {
  topicId: number;
  pinned: boolean;
}): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE forum_topics
       SET is_pinned = ${input.pinned},
           updated_at = now()
     WHERE id = ${input.topicId}
       AND removed_at IS NULL
    RETURNING id
  `);
  return rowsOf<{ id: unknown }>(result).length > 0;
}
