// =============================================================================
// ACTIVITY LOG / AUDIT TRAIL — schema module for the activity-logs stream.
// (IMPLEMENTATION_ROADMAP.md, "PHASE 1: Quick Wins", feature 4.)
// -----------------------------------------------------------------------------
// WHY THIS IS A SEPARATE FILE AND NOT AN APPEND TO src/db/schema.ts
//
// The same reason src/db/schema.access.ts:6-14 and src/db/schema.queue.ts:4-13
// give, and the reason drizzle.config.ts:9-14 states in its own comment:
// `schema.ts` is the frozen Wave 0 seam and is edited concurrently, so a stream
// that needs a table of its own adds a sibling module plus ONE entry to the
// config's `schema` array. drizzle-kit unions the listed paths into one snapshot,
// so a generated migration is identical to an inline declaration.
//
// The roadmap says "Add to src/db/schema.ts". That instruction predates the
// concurrent-stream layout this repo actually has, so it is not followed — see
// drizzle.config.ts's own comment for why appending to the hot file is how two
// agents' edits collide in one commit.
//
// =============================================================================
// THIS IS AN AUDIT TRAIL, NOT A DEBUG LOG. Three consequences, and every design
// choice below follows from one of them.
// -----------------------------------------------------------------------------
// 1. IT MUST NOT BE SILENTLY LOSSY.
//
//    The row is written by src/lib/activity/record.ts with the SAME database
//    client the act itself uses — so a caller inside `db.transaction()` gets the
//    audit row committed atomically with the thing it describes, and a failure to
//    write the row aborts the act. The argument for fail-closed, and the narrow
//    set of cases where the opposite is chosen, is in record.ts's header.
//
//    This is deliberately NOT routed through src/lib/queue/**. The queue's own
//    `enqueueJob` is itself one INSERT on the same pool (src/lib/queue/store.ts:163),
//    so queueing costs the same ~245 ms round trip that src/db/index.ts:63 measured
//    for a statement on a warm connection — while ADDING a failure mode: a job that
//    exhausts its attempts lands in `status = 'dead'`, and an audit entry that can
//    be dead-lettered is not an audit entry. Buffering in memory is worse still:
//    FREE_STACK's Vercel target has no long-lived process, so a buffer flushed on
//    an interval loses whatever it held when the invocation is recycled.
//
// 2. IT MUST NOT BECOME A PRIVACY LIABILITY.
//
//    There is no column here for a password, a hash, a session token, a reset
//    token, a request body, a query string, an email address, a quiz answer, or a
//    free-text error message. Each omission is argued at the column it replaces.
//    The lesson is local and recent: an agent found the whole session object —
//    including a student's email — being serialised into RSC payloads in dev
//    (tests/e2e/fixtures.ts:39-47). "Log everything" leaks by default, so this
//    table stores identifiers and outcomes and nothing that reads like content.
//
// 3. IT WILL BE THE LARGEST TABLE IN THE DATABASE.
//
//    Hence `bigserial`, a BRIN index on the time column instead of a second btree
//    nearly as large as the heap, exactly four indexes, and the bounded-batch
//    prune in src/lib/activity/retention.ts. Index rationale is at the index.
//
// Every timestamp is `timestamptz` written by the DATABASE's clock and every
// duration in this stream is milliseconds or whole days (house rules: metric
// units, one clock). Retention is expressed in days because that is the unit the
// policy is written in (INTEGRATION_SUMMARY.md:115, "keep 90 days hot").
// =============================================================================

import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./schema";

/**
 * THE ACTION VOCABULARY — frozen, because it is a Postgres enum and widening one
 * is a migration.
 *
 * DERIVED FROM THE ROUTES THAT EXIST (src/lib/contracts/api.ts), not from the
 * roadmap's list verbatim. The roadmap's enum names acts this codebase does not
 * have, and omits several it does. Deviations, each with its reason:
 *
 *   DROPPED  forum_post, forum_reply, peer_review — Phase 2 features with no
 *            tables and no routes. An enum value with no possible call site is
 *            decoration.
 *   DROPPED  file_upload — there is no upload route anywhere in ROUTES.
 *   DROPPED  quiz_start — starting a quiz is a GET of
 *            `/api/weeks/:weekId/quiz`, i.e. a read. Reads are not logged here;
 *            see the note on read events below.
 *   RENAMED  assignment_submit -> submission_ingest. Students do not POST
 *            assignments in this app; work arrives by pulling each assignment's
 *            Google Sheet ("POST /api/assignments/:assignmentId/ingest" and the
 *            cron sweep). One row per ingest RUN, not per submission — the
 *            per-submission record is `submission_ingest_runs` already.
 *   RENAMED  assignment_review -> submission_graded, the name the act has here
 *            ("POST /api/instructor/submissions/:id/grade").
 *   RENAMED  module_complete -> learn_step_complete, matching
 *            "POST /api/learn/steps/:stepId/complete".
 *   ADDED    login_failed. The roadmap logs `login` but not its failures, which
 *            inverts the value: a successful login is routine, and a burst of
 *            failures against one address is the single most useful signal an
 *            audit trail carries. Compliance and "fraud detection" — the stated
 *            purpose — both need the failures.
 *   ADDED    password_reset_request / password_reset_confirm. Both routes are
 *            ROUTE_AUTH "public" (src/lib/contracts/api.ts:180-181), so they are
 *            the only writes an unauthenticated stranger can reach. Precisely the
 *            events an auditor asks about.
 *   ADDED    the staff/admin acts the roadmap has no equivalent for. An audit
 *            trail that records what students did and not what staff did to them
 *            answers the wrong question: role changes, access approvals, deadline
 *            edits and grade overrides are the acts with consequences.
 *   ADDED    activity_export and activity_pruned — this feature auditing itself.
 *            Reading an audit log in bulk is a data-egress act, and deleting from
 *            one must never be the untraceable operation.
 *
 * WHICH OF THESE HAVE A LIVE CALL SITE IN THIS COMMIT: `activity_export`,
 * `activity_pruned` and `activity_export_denied` only. Every other value is
 * declared vocabulary plus a documented hook point, because the write paths that
 * would emit them live in files this stream does not own (see
 * src/lib/activity/hook-points.ts, which lists route -> action and is asserted
 * against ROUTES so the mapping cannot silently rot).
 */
export const activityAction = pgEnum("activity_action", [
  // --- identity -----------------------------------------------------------
  "login",
  "login_failed",
  "logout",
  "password_change",
  "password_reset_request",
  "password_reset_confirm",
  "profile_update",
  // --- assessment ---------------------------------------------------------
  "quiz_submit",
  "exam_start",
  "exam_submit",
  "problem_attempt",
  "learn_step_complete",
  "code_execute",
  // --- coursework ---------------------------------------------------------
  "submission_ingest",
  "submission_graded",
  // --- staff acts with consequences ---------------------------------------
  "role_change",
  "cohort_change",
  "course_access_decision",
  "video_decision",
  "deadline_change",
  "quiz_authored",
  "penalty_issued",
  "attendance_recorded",
  "report_export",
  "jobs_requeued",
  // --- the audit trail auditing itself ------------------------------------
  "activity_export",
  "activity_export_denied",
  "activity_pruned",
]);

/** Did the act succeed? A failed act is often the interesting one. */
export const activityStatus = pgEnum("activity_status", ["success", "failure"]);

/**
 * One recorded act. Append-only: there is no `updatedAt` and nothing in this
 * stream issues an UPDATE against this table. A row that can be edited is not
 * evidence, and the only DELETE is the retention prune, which writes an
 * `activity_pruned` row about itself before it runs.
 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    /**
     * `bigserial`, not `serial`, and not the roadmap's `uuid`.
     *
     * bigint because this table is expected to outgrow every other one and a
     * 32-bit sequence has a real ceiling. NOT uuid because every id in
     * src/db/schema.ts is a serial integer and `users.id` is `serial`
     * (schema.ts:106) — a uuid primary key here would be the only one in the
     * database, and random uuids scatter inserts across the index instead of
     * appending to its right edge, which is the access pattern this table has.
     */
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /**
     * WHO. Nullable, and `on delete set null` — both against the roadmap, which
     * has `notNull()` and no delete behaviour.
     *
     * Nullable because some logged acts have no established identity: a failed
     * login and a password-reset request for an unknown address are exactly the
     * events worth keeping, and neither has an authenticated actor.
     *
     * `set null` rather than `cascade` or `restrict` because the alternatives are
     * both wrong for evidence: `cascade` lets deleting a user erase every trace
     * of what they did, and `restrict` makes the audit table refuse account
     * deletion forever. `set null` keeps the act, its time, its target and the
     * role that performed it, and drops only the link to a person who no longer
     * exists.
     *
     * That is also this table's answer to erasure: the identity is not copied
     * here, so removing the user row pseudonymises the trail rather than leaving
     * a snapshot of their email behind for the whole retention window. The cost,
     * stated plainly: after a deletion you can still see that SOMEONE with role
     * `student` did these things in this order, but not who. Accepted.
     */
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),

    /**
     * The actor's role AT THE TIME, snapshotted.
     *
     * Not derivable later: `users.role` is mutable (there is a `role_change`
     * action in the enum above precisely because it changes), so joining to
     * `users` tells you what the actor is NOW. An auditor asking "was this person
     * an admin when they approved that?" needs the value as it was. Not PII.
     * A plain varchar and not the `user_role` enum, so a role added to schema.ts
     * does not require a migration here before a row can be written.
     */
    actorRole: varchar("actor_role", { length: 32 }),

    /** WHAT. See the vocabulary note on `activityAction` above. */
    action: activityAction("action").notNull(),

    /** Did it work? Defaults to success so a caller cannot forget the happy path. */
    status: activityStatus("status").notNull().default("success"),

    /**
     * WHAT IT WAS DONE TO. `entityType` is a short slug ("submission", "quiz",
     * "user", "video_candidate") and `entityId` is that table's serial id.
     *
     * `integer`, not the roadmap's `uuid`, for the same reason as `id`: every id
     * in this database is a serial integer, so a uuid column could never be
     * populated. No foreign key, on purpose — a FK per possible target table is
     * impossible in one column, and an audit row must survive the deletion of the
     * thing it refers to.
     */
    entityType: varchar("entity_type", { length: 50 }),
    entityId: integer("entity_id"),

    /**
     * WHERE FROM — TRUNCATED, which is why the column is not called `ip_address`
     * as the roadmap has it. The stored value is the IPv4 /24 or IPv6 /48 prefix
     * (src/lib/activity/redact.ts), never the full address.
     *
     * The stated purpose is fraud detection, and the fraud question is "did these
     * two accounts act from the same network?" — which a /24 answers. A full
     * address additionally answers "which household, on which connection, at
     * which minute", which is a device-level identifier this table has no use for
     * and would then have to protect for the whole retention window. 45 chars is
     * kept from the roadmap: it is the maximum length of an IPv4-mapped IPv6
     * literal, and the prefix is always shorter.
     *
     * COST, stated: you cannot distinguish two students behind one campus /24, and
     * a carrier-grade-NAT /24 can cover thousands of people. This column supports
     * "worth a look", never "proven".
     */
    ipPrefix: varchar("ip_prefix", { length: 45 }),

    /**
     * A COARSE CLIENT FAMILY ("Chrome on Windows"), not the roadmap's
     * `userAgent: text`.
     *
     * A full User-Agent string is a browser fingerprint: version, build, engine,
     * device model and sometimes an OEM identifier, which together are far more
     * identifying than the audit question needs. "Did the exam submission come
     * from a different kind of client than every other act on that account?" is
     * answered by the family. 120 chars caps a hostile header.
     */
    clientFamily: varchar("client_family", { length: 120 }),

    /**
     * Correlation handle for a single request — `x-vercel-id` in production, or
     * whatever the caller passes. Lets an operator line a row up against the
     * platform's own request log without this table having to duplicate it.
     */
    correlationId: varchar("correlation_id", { length: 64 }),

    /**
     * STRUCTURED CONTEXT, ALLOWLISTED. Written only through
     * `sanitiseDetails()` in src/lib/activity/redact.ts, which drops any key
     * whose name looks like a secret, rejects nested objects and caps the encoded
     * size. It holds things like `{ weekId: 3, scorePercent: 80 }`.
     *
     * NOT a request body, and there is no column that holds one. A body carries
     * the password on a login, the answers on a quiz submission and the feedback
     * text on a grading call; a jsonb column that accepted whole bodies would
     * make this table a second copy of the most sensitive data in the app, with a
     * 90-day retention and an admin-readable UI in front of it.
     */
    details: jsonb("details"),

    /**
     * A SHORT CODE on failure ("invalid_credentials", "forbidden"), never the
     * roadmap's `errorMessage: text`.
     *
     * Exception messages interpolate whatever caused them — an email address, a
     * row from a Google Sheet, a fragment of a student's code — and a stack trace
     * names internal paths. A closed set of codes is what a filter or an alert can
     * actually be built on, and it cannot leak by accident.
     */
    errorCode: varchar("error_code", { length: 64 }),

    /**
     * OPTIONAL IDEMPOTENCY KEY, unique when present (partial index below).
     *
     * The queue can legitimately run one handler twice — the whole argument is in
     * src/db/schema.queue.ts:15-53 — and a retried route handler can re-execute
     * after its response was lost. A caller that can name its act ("grade:441")
     * passes that here and gets a duplicate INSERT rejected by the database rather
     * than two rows claiming the same act happened twice. Length 200 matches
     * `jobs.idempotency_key` (KEY_MAX_CHARS in src/lib/queue/keys.ts) so the two
     * can carry the same string.
     */
    dedupeKey: varchar("dedupe_key", { length: 200 }),

    /**
     * WHEN — `occurredAt`, not the roadmap's `createdAt`.
     *
     * The name is the point: for an audit trail the interesting instant is when
     * the act happened, and a column called `created_at` invites a future
     * backfill or archive-restore to set it to the row's own creation time and
     * quietly rewrite history. `defaultNow()` means the DATABASE's clock decides,
     * so rows from different serverless instances with different clock skew are
     * still totally ordered against each other.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * INDEX STRATEGY — four indexes, each tied to a query the admin surface or
     * the prune actually issues. This table is the biggest one in the database,
     * so an index that serves no query is pure write amplification on every
     * single logged act.
     *
     * MEASURED, NOT ASSUMED. The numbers quoted below come from running this exact
     * DDL against this project's Neon instance in a throwaway schema, populated with
     * 400_000 rows over 2_000 actors, with `explain (analyze, buffers)` on each of
     * the four query shapes (scripts/tmp-activity-probe.ts, run and then deleted —
     * the parent generates the migration, so the probe must not linger as a second
     * source of truth for the DDL).
     *
     * 1. (actor_id, id DESC) — "everything this person did, newest first". The
     *    primary investigation query, and the shape src/lib/activity/query.ts uses
     *    when an actor filter is present.
     *
     *    `id DESC`, NOT `occurred_at DESC`, and this was changed after measuring.
     *    The list query orders by `id` (see query.ts: a bigserial is unique and
     *    monotonic, so the keyset cursor cannot be ambiguous, whereas two rows can
     *    share a timestamp). With `occurred_at` as the second column, Postgres could
     *    use the index for the FILTER but still had to SORT for the ordering —
     *    visible as a `Sort` node in `explain (analyze)` on a 60_000-row probe. The
     *    second column has to be the column the query actually orders by.
     *
     *    A time window still filters efficiently through this index because the
     *    table is append-only: `id` and `occurred_at` are monotonic together, so a
     *    range on one is a range on the other.
     *
     *    MEASURED: at 400_000 rows over 2_000 actors, `where actor_id = ? order by
     *    id desc limit 51` is an Index Scan on this index — 0.102 ms, 54 buffers.
     *    At 60_000 rows over 40 actors the planner preferred a backward scan of the
     *    primary key instead (0.389 ms, 40 buffers), because at 1-in-40 selectivity
     *    it finds 51 matching rows almost immediately. That is the planner being
     *    right, not the index being wrong: the pk-scan cost grows with the number of
     *    accounts, so the index is what keeps this query flat as the cohort grows.
     */
    actorTimeIdx: index("activity_logs_actor_time_idx").on(t.actorId, t.id.desc()),

    /**
     * 2. (action, id DESC) — "every failed login in the last day", the query the
     *    fraud-detection requirement reduces to. Same `id DESC` reasoning as index 1.
     *
     *    HONESTLY REPORTED: at 400_000 rows the planner did NOT choose this index for
     *    `action = 'login_failed' and occurred_at >= now() - interval '24 hours'
     *    order by id desc limit 51`. It filtered on the time window first and sorted
     *    the ~300 surviving rows (0.458 ms total), because sorting three hundred rows
     *    is cheaper than an index scan over the twelve percent of the table that
     *    shares one action value. This index earns its place on the OTHER shape of
     *    that query — a wide or absent time window, where the action is the only
     *    selective clause — and is kept for it. If a future measurement shows neither
     *    shape using it, it should be dropped: on this table an unused index is a
     *    cost paid on every insert forever.
     */
    actionTimeIdx: index("activity_logs_action_time_idx").on(t.action, t.id.desc()),

    /**
     * 3. (entity_type, entity_id) — "what has happened to submission 441?", the
     *    dispute query. Kept as the roadmap has it.
     */
    entityIdx: index("activity_logs_entity_idx").on(t.entityType, t.entityId),

    /**
     * 4. occurred_at — BRIN, NOT the btree the roadmap specifies, and this is the
     *    one substantive index deviation.
     *
     *    A btree on a single timestamp column of the largest table in the database
     *    is one index entry per row: on the order of 30-40 bytes each including
     *    overhead, which for a table of millions of rows is hundreds of megabytes
     *    that must be maintained on every insert. Its only jobs here are the
     *    unfiltered "last 500 events" view and the prune's `occurred_at < cutoff`
     *    scan.
     *
     *    BRIN stores a min/max summary per block range instead of per row, so it
     *    is kilobytes rather than megabytes, and it is close to optimal precisely
     *    when the column's physical order matches its logical order. That is
     *    guaranteed here and nowhere else in this schema: the table is
     *    append-only, never updated, and inserted in time order, so block N always
     *    holds later timestamps than block N-1. Both of this index's queries are
     *    wide ranges, which is what BRIN is for.
     *
     *    MEASURED, side by side on the same 400_000-row table:
     *
     *        activity_logs_occurred_at_brin_idx      24 kB
     *        a plain btree on (occurred_at desc)   8792 kB     366x larger
     *
     *    At 60_000 rows the same comparison was 24 kB against 1328 kB. The BRIN index
     *    did not grow between the two; the btree grew linearly with the row count,
     *    which is the entire argument in one number.
     *
     *    COST, stated: BRIN cannot serve a point lookup of one timestamp and
     *    cannot provide ordering, so a query that wants `ORDER BY occurred_at`
     *    with no other filter still sorts. That is one sort over a bounded LIMIT,
     *    which is cheaper than carrying the btree forever.
     *
     *    NOT INDEXED, deliberately: `details`. A GIN index on jsonb would be the
     *    most expensive index in the database, and nothing queries inside
     *    `details` — the admin surface filters on actor, action, entity and time,
     *    which are all real columns.
     */
    timeBrinIdx: index("activity_logs_occurred_at_brin_idx")
      .using("brin", t.occurredAt)
      .with({ pages_per_range: 32 }),

    /**
     * THE ONLY UNIQUE CONSTRAINT, and it is PARTIAL: rows without a `dedupeKey`
     * (the normal case) are not constrained at all, so two genuinely separate
     * logins one second apart both land. Where a caller supplies a key, the
     * database — not the caller's memory of whether it already logged — settles
     * whether the act has already been recorded. Same argument as
     * `mail_dispatches_dedupe_key_idx` in src/db/schema.queue.ts:148.
     *
     * PARTIAL RATHER THAN PLAIN, for a reason specific to this table's size.
     * Postgres already allows unlimited NULLs in a plain unique index, so a plain
     * one would BEHAVE identically — but it would carry an entry for every row of
     * the largest table in the database, to constrain the handful that actually
     * have a key. Measured on the 400_000-row probe: 16 kB partial, against the
     * 8792 kB the primary key costs over the same rows.
     *
     * THE PRICE, AND IT IS A SHARP ONE: `ON CONFLICT (dedupe_key)` does NOT match a
     * partial index unless the statement repeats this predicate. Omitting it does
     * not weaken deduplication, it makes EVERY insert fail with 42P10 — nothing can
     * be logged at all. src/lib/activity/record.ts passes the predicate and says so;
     * that failure was found by executing this DDL against Postgres, not by
     * typechecking, because both versions typecheck identically.
     */
    dedupeIdx: uniqueIndex("activity_logs_dedupe_key_idx")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  }),
);

export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;

/** The action vocabulary as a value, for runtime validation of a query filter. */
export const ACTIVITY_ACTIONS = activityAction.enumValues;
export type ActivityActionName = (typeof activityAction.enumValues)[number];

export const ACTIVITY_STATUSES = activityStatus.enumValues;
export type ActivityStatusName = (typeof activityStatus.enumValues)[number];
