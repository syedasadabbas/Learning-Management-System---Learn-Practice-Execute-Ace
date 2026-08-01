// =============================================================================
// BADGE AWARDS — schema module for the badges/gamification stream.
// Owner: badges stream. Feature 3 of IMPLEMENTATION_ROADMAP.md "PHASE 1".
// -----------------------------------------------------------------------------
// WHY THIS IS A SEPARATE FILE AND NOT AN APPEND TO src/db/schema.ts
//
// The same reason src/db/schema.access.ts:6-18 and src/db/schema.queue.ts:4-13
// give, and the reason drizzle.config.ts:9-14 states in its own comment:
// `schema.ts` is the frozen Wave 0 seam and is edited concurrently, so a stream
// that needs a table of its own adds a sibling module plus ONE entry to the
// config's `schema` array. drizzle-kit unions every listed path into a single
// snapshot, so a generated migration is byte-identical to what an inline
// declaration would have produced.
//
// This module imports `users` from ./schema (one direction only — schema.ts does
// not import this file, so there is no cycle), following schema.access.ts:55
// rather than schema.queue.ts, which imports nothing because a mail ledger has no
// foreign key to a user. An award without a student is meaningless, so the FK is
// worth the import.
//
// COST OF THE SEPARATE MODULE, stated because schema.access.ts:15-18 states it:
// `db.query.badgeAwards` is unavailable, because src/db/index.ts passes only
// `./schema` to `drizzle()`. Nothing here needs the relational query API — every
// read in src/lib/badges/** uses the select builder, which takes the table object
// directly.
//
// =============================================================================
// ONE TABLE, NOT TWO. This deviates from the roadmap and here is the argument.
// -----------------------------------------------------------------------------
// IMPLEMENTATION_ROADMAP.md:235-257 specifies TWO tables: `badges` (definitions:
// name, description, iconUrl, `criteria` jsonb, points, rarity) and `user_badges`
// (awards). Only the second one is built. Three reasons, in order of weight:
//
//  1. `criteria: jsonb` IS A RULES ENGINE WITH NO INTERPRETER. The roadmap's own
//     example is `{ type: 'quiz_score', value: 95 }`, which only means anything
//     if application code knows how to evaluate the string "quiz_score". So the
//     real decision procedure lives in code either way, and a definitions table
//     just gives it a second, editable half that can disagree with it. This
//     codebase already made the opposite choice, deliberately and with a reason
//     recorded: src/lib/contracts/scoring.ts:6-10 keeps the scoring rules in one
//     TypeScript module precisely because "divergent copies are the classic
//     source of leaderboard/grade mismatches". The badge catalogue is scoring
//     rules. It lives in src/lib/badges/catalogue.ts for the same reason.
//
//  2. `iconUrl` NOT NULL HAS NOTHING TO PUT IN IT. There is no asset pipeline and
//     no blob store wired up in this repo, and every other visual affordance in
//     the app is a text glyph chosen in code (see the `glyph` field on every row
//     of src/components/nav/nav-links.ts). The catalogue carries a glyph.
//
//  3. `points` WOULD CORRUPT THE FROZEN SCORING CONTRACT. The roadmap annotates
//     it "// Leaderboard points". Adding badge points to a leaderboard component
//     column would push `total_score` above `courseMaxScore()`
//     (src/lib/contracts/scoring.ts:136) and therefore change every student's
//     `letterGrade()` — a syllabus change smuggled in as a gamification feature.
//     src/lib/leaderboard/rebuild.ts:200-206 clamps to that ceiling anyway, so
//     the points would be silently swallowed at the cap instead. Badges are
//     recognition, not marks, and this table is deliberately not readable by the
//     leaderboard.
//
// The one thing a definitions table would genuinely buy — the roadmap's "Admin
// badge management" — is therefore not shipped. See src/lib/badges/catalogue.ts
// for the TODO that names what an admin surface would need first.
//
// =============================================================================
// THE IDEMPOTENCY GUARANTEE LIVES ON `badge_awards_student_type_idx`.
// -----------------------------------------------------------------------------
// A badge is awarded to a student AT MOST ONCE, EVER, and the decision is made by
// Postgres, not by application code.
//
// The application-code version of this is `if (!await hasBadge(s, t)) award(s,t)`
// and it is WRONG under READ COMMITTED: two concurrent evaluations — an
// instructor grading an assignment while a cron drain re-applies the same scoring
// event, or simply an instructor double-clicking Save into two serverless
// instances — both see no row and both insert. The roadmap's own risk table says
// as much (IMPLEMENTATION_ROADMAP.md:755, "Badges | Duplicate awards | Unique
// constraint in DB") without saying where the constraint goes; it goes here.
//
// src/lib/badges/award.ts does `INSERT ... ON CONFLICT (student_id, type) DO
// NOTHING ... RETURNING id`, the identical shape src/lib/queue/store.ts:169-204
// uses for `jobs.idempotency_key`, and derives "did I award it?" from whether the
// INSERT returned a row — which is Postgres reporting the winner rather than this
// code guessing.
//
// PROVEN, NOT ASSERTED: src/lib/badges/award.integration.test.ts fires eight
// simultaneous awards of one (student, badge) on eight separate connections
// against the real database and counts rows, reads `pg_indexes` to confirm the
// index is UNIQUE rather than plain, and — because a test that cannot fail proves
// nothing — runs the same eight-way race against a scratch table WITHOUT the
// index and shows it yields eight rows.
//
// All timestamps are `timestamptz` written by the DATABASE's clock and all
// durations are milliseconds (house rules: one clock, metric units).
// =============================================================================

import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./schema";

/**
 * One achievement, earned once, by one student.
 *
 * NOT a feed and not an audit log: there is exactly one row per (student, badge)
 * and it is never updated after insert. "When did this student earn things, in
 * order" is answerable from `awarded_at`; "how many times did we nearly award
 * this" is deliberately not, because the answer is always "we did not".
 */
export const badgeAwards = pgTable(
  "badge_awards",
  {
    id: serial("id").primaryKey(),

    studentId: integer("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * The badge's stable identifier — a key into BADGE_CATALOGUE
     * (src/lib/badges/catalogue.ts), which is the authority on what it means.
     *
     * A VARCHAR AND NOT A pgEnum, deviating from IMPLEMENTATION_ROADMAP.md:224.
     * Same trade the queue stream already made and justified for
     * `mail_dispatches.channel` (src/db/schema.queue.ts:95): "A column rather
     * than an enum so a second channel is code, not a migration."
     *
     * That matters more here than there, because the roadmap's own enum lists two
     * badges — `peer_review_master` and `forum_helper` — whose data sources are
     * PHASE 2 features that do not exist yet (forums: roadmap:383; peer review:
     * roadmap:427). With a pgEnum, landing either one later means an `ALTER TYPE
     * ... ADD VALUE` migration; with a varchar it is one entry in a TypeScript
     * object. `consecutive_days` is in the same position and worse — it needs the
     * activity log from feature 4, which is a different stream in this same wave.
     *
     * WHAT THIS GIVES UP, stated rather than glossed: the database will accept any
     * string. The compensating controls are that `awardBadge` takes the
     * `BadgeType` union (a compile error for a typo), validates membership against
     * the catalogue at runtime before touching the database, and every read joins
     * against the catalogue in code so an unrecognised row renders as nothing
     * rather than as a broken card. 48 characters is comfortably above the longest
     * catalogue key.
     */
    type: varchar("type", { length: 48 }).notNull(),

    /**
     * Set by the DATABASE's clock, like every other timestamp in this repo — see
     * the "ONE CLOCK" note in src/lib/queue/store.ts:29-56 for the bug that rule
     * exists because of. Nothing compares this column against `now()`, so the
     * stakes are lower here, but a column that sometimes carries the app clock and
     * sometimes the database's is how the next comparison becomes a bug.
     */
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * WHY this student got this badge, as the numbers that were true at the moment
     * it was awarded. For example `{ "percentage": 100, "quizId": 7 }`.
     *
     * Exists so a student can be told "you earned this for scoring 100% on the
     * Week 2 quiz" instead of just "you earned this", and so an operator staring at
     * a badge that looks wrong can see the evidence rather than re-deriving it from
     * a read model that has since moved. NOT used in any decision: the criteria are
     * re-evaluated from live data every time, so a stale `evidence` blob can
     * mislead a human but cannot mis-award anything.
     *
     * Nullable because a badge may be earned from a fact with no interesting
     * scalar attached.
     */
    evidence: jsonb("evidence"),
  },
  (t) => ({
    /**
     * THE GUARANTEE. See the "IDEMPOTENCY" section of this file's header.
     *
     * A composite UNIQUE index on (student_id, type) is the only thing standing
     * between "award once" and "award once per concurrent evaluation". It is also
     * the conflict target named explicitly by src/lib/badges/award.ts — named
     * rather than a bare `onConflictDoNothing()`, so a genuine primary-key
     * collision is never mistaken for a successful de-duplication (the reasoning
     * at src/lib/queue/store.ts:184-186).
     */
    studentTypeIdx: uniqueIndex("badge_awards_student_type_idx").on(t.studentId, t.type),

    /**
     * Serves the only hot read: "this student's badges, newest first", for
     * /badges and GET /api/me/badges. The unique index above would serve the
     * lookup but not the ordering, and an ORDER BY on a sequential scan of every
     * cohort's awards is a page load that degrades with the institution's age.
     */
    studentAwardedIdx: index("badge_awards_student_awarded_idx").on(t.studentId, t.awardedAt),
  }),
);

export type BadgeAward = typeof badgeAwards.$inferSelect;
export type NewBadgeAward = typeof badgeAwards.$inferInsert;
