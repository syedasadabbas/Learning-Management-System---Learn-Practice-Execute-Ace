// =============================================================================
// BADGE AWARDING — the only module that writes to `badge_awards`.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// THIS FILE IS THE FEATURE. Everything else is presentation.
//
// A badge must be awarded EXACTLY ONCE. The naive implementation is
//
//     if (!(await hasBadge(studentId, type))) await insert(studentId, type);
//
// and it is WRONG, for a reason that has nothing to do with how carefully it is
// written. Under READ COMMITTED — Postgres's default, and what this app runs at —
// two concurrent evaluations of the same student both execute the SELECT before
// either executes the INSERT, both see no row, and both insert. The student ends
// up with the badge twice, the /badges page renders two identical cards, and the
// count in the header is wrong.
//
// That race is not theoretical here. Badge evaluation is triggered by a scoring
// event (./on-scoring-event.ts), and the app produces those in bursts:
//   * src/lib/instructor/grading.ts#applyGrade re-runs the whole grade path every
//     time an instructor corrects a star rating — the same reason the queue stream
//     lists "an instructor correcting a star rating" as the double-send it had to
//     design against (src/lib/queue/types.ts:43-47);
//   * a double-clicked Save on Vercel lands as two requests on two serverless
//     instances, which share no in-process lock of any kind;
//   * src/lib/submissions/grade.ts and src/lib/quizzes/service.ts both fire scoring
//     events, so one student can be evaluated twice within milliseconds by two
//     different code paths.
//
// SO THE UNIQUENESS DECISION IS THE DATABASE'S. `badge_awards_student_type_idx` is
// a UNIQUE index on (student_id, type) (src/db/schema.badges.ts:170-181), and this
// module does
//
//     INSERT ... ON CONFLICT (student_id, type) DO NOTHING RETURNING id
//
// which is precisely the shape src/lib/queue/store.ts:163-204 uses for
// `jobs.idempotency_key`, and for precisely the reason stated in its header:
// "NOT `if (!await exists(key)) insert(...)`. Under READ COMMITTED two concurrent
// invocations both see no row and both insert; only a unique index can decide."
//
// `created` in the result is derived from WHETHER THE INSERT RETURNED A ROW. That
// is Postgres reporting who won, not this code guessing — the distinction
// store.ts:20-23 draws, and the reason a losing caller can safely be told "already
// held" instead of "error".
//
// PROVEN AGAINST POSTGRES, NOT MODELLED: ./award.integration.test.ts fires eight
// simultaneous awards of one (student, badge) and counts rows; reads `pg_indexes`
// to assert the index is UNIQUE rather than plain; and — because a test that cannot
// fail proves nothing — runs the identical eight-way race against a scratch table
// WITHOUT the index and shows it yields eight rows. That last part is this file's
// answer to the standard set by src/lib/queue/store.integration.test.ts:8-13.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { badgeAwards } from "@/db/schema.badges";

import { isBadgeType, type BadgeType } from "./catalogue";
import type { EarnedBadge } from "./evaluate";

/** Drizzle's transaction handle, derived from `db` so it cannot drift. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Either the pooled client or an open transaction. */
export type Db = typeof db | Tx;

export interface AwardResult {
  type: BadgeType;
  /**
   * True only when THIS call inserted the row.
   *
   * False means the student already had the badge — which is the normal, correct
   * outcome of almost every evaluation, not an error. Callers must not log it as a
   * warning: after a student earns `first_submission`, every subsequent grading
   * event for the rest of the course produces `created: false` for it. The same
   * caution src/lib/queue/store.ts:131-138 attaches to its own `created` flag.
   */
  created: boolean;
  /** Null only in the pathological case where the conflicting row vanished between statements. */
  awardId: number | null;
  /** When the badge was earned — the EXISTING row's timestamp when `created` is false. */
  awardedAt: Date | null;
}

/**
 * Award one badge to one student, at most once, ever.
 *
 * The uniqueness decision belongs to `badge_awards_student_type_idx`; this
 * function only reports it.
 *
 * `onConflictDoNothing` NAMES THE TARGET COLUMNS explicitly rather than being
 * bare. A bare `onConflictDoNothing()` also absorbs a conflict on the primary key,
 * which would report a genuine `id` collision as a successful de-duplication — the
 * reasoning at src/lib/queue/store.ts:184-186.
 *
 * When the INSERT conflicts, the existing row is read in a second statement so the
 * caller can show the student when they earned it. That read is best-effort: its
 * failure never turns a successful de-duplication into an error, because nothing
 * about the guarantee depends on it.
 *
 * TRANSACTIONS. Callers award OUTSIDE the transaction that wrote the thing being
 * recognised, and `client` exists for the caller that wants otherwise. The
 * trade-off is the same one src/lib/queue/store.ts:153-162 states for `enqueueJob`
 * and src/lib/leaderboard/on-scoring-event.ts:40-48 states for the leaderboard:
 * inside the transaction, a badge write failing would roll back the instructor's
 * grade. Outside, the failure mode is a grade saved with no badge awarded — which
 * self-heals, because the criteria are re-evaluated from live data on the next
 * scoring event for that student and the badge is still there to be earned.
 * Nothing is lost by missing one evaluation, which is exactly what makes the
 * outside-the-transaction choice cheap here.
 */
export async function awardBadge(
  input: { studentId: number; type: BadgeType; evidence?: Record<string, unknown> | null },
  client: Db = db,
): Promise<AwardResult> {
  const studentId = Math.trunc(input.studentId);

  // The column is a varchar, not a pgEnum (src/db/schema.badges.ts:126-152), so
  // this function is the boundary that keeps an unknown key out of the table. The
  // TypeScript union already refuses a typo at compile time; this catches a value
  // that arrived through an `as` cast or from JSON.
  if (!isBadgeType(input.type)) {
    throw new Error(`[badges] refusing to award unknown badge type: ${String(input.type)}`);
  }

  const inserted = await client
    .insert(badgeAwards)
    .values({
      studentId,
      type: input.type,
      evidence: input.evidence ?? null,
      // `awardedAt` is deliberately NOT set here. The column defaults to
      // `defaultNow()`, so the value comes from the DATABASE's clock rather than
      // this process's — the house rule whose live bug is written up in
      // src/lib/queue/store.ts:29-56.
    })
    // Names the unique index's columns. See the doc comment for why not bare.
    .onConflictDoNothing({ target: [badgeAwards.studentId, badgeAwards.type] })
    .returning({ id: badgeAwards.id, awardedAt: badgeAwards.awardedAt });

  if (inserted.length > 0) {
    return {
      type: input.type,
      created: true,
      awardId: inserted[0].id,
      awardedAt: inserted[0].awardedAt,
    };
  }

  // Lost the race, or held it already — indistinguishable and equally fine.
  const [existing] = await client
    .select({ id: badgeAwards.id, awardedAt: badgeAwards.awardedAt })
    .from(badgeAwards)
    .where(and(eq(badgeAwards.studentId, studentId), eq(badgeAwards.type, input.type)))
    .limit(1);

  return {
    type: input.type,
    created: false,
    awardId: existing?.id ?? null,
    awardedAt: existing?.awardedAt ?? null,
  };
}

/**
 * Award every badge in `earned` in ONE statement.
 *
 * WHY ONE STATEMENT AND NOT A LOOP OVER `awardBadge`. This function runs on the
 * grading path, and the first implementation did loop. Measured against this Neon
 * instance, that cost 488-730 ms per evaluation for a student holding ONE badge,
 * because every badge is a round trip and every CONFLICTING badge is two (the
 * insert, then the read for `awardedAt`). For a student who has earned all five
 * that is up to eleven round trips at ~245 ms each — the figure src/db/index.ts
 * records — on every single grading event, forever, to discover that nothing has
 * changed. That is the steady state, not the exception: once a badge is earned it
 * conflicts on every subsequent evaluation for the rest of the course.
 *
 * A multi-row `INSERT ... ON CONFLICT (student_id, type) DO NOTHING RETURNING type`
 * is one round trip regardless of how many badges the catalogue grows to, and it
 * gives up nothing that matters:
 *   - the uniqueness decision is still POSTGRES'S, made by the same unique index;
 *   - `created` is still derived from which rows the INSERT returned, so it is still
 *     the database naming the winners rather than this code guessing;
 *   - the only thing lost is `awardedAt` for the badges that conflicted, and no
 *     caller on this path wants it (./service.ts reports `newlyAwarded`; the page
 *     reads timestamps separately via `listStudentBadges`). Reported as null rather
 *     than fetched, so nothing silently pays for a second query.
 *
 * There are no intra-statement duplicates to worry about because `evaluateBadges`
 * iterates BADGE_TYPES and so cannot yield a type twice; the dedupe below makes
 * that a property of this function rather than an assumption about its caller.
 *
 * Never throws. A badge that cannot be written is logged and skipped: the failure
 * mode on this path must stay "no badge", never "no grade".
 */
export async function awardBadges(
  studentId: number,
  earned: readonly EarnedBadge[],
  client: Db = db,
): Promise<AwardResult[]> {
  const id = Math.trunc(studentId);

  // Unknown types are dropped here rather than throwing, unlike `awardBadge`: this
  // is the bulk path and one bad entry must not cost the student the others. The
  // dedupe keeps the statement free of intra-statement conflicts.
  const seen = new Set<BadgeType>();
  const rows: Array<{ studentId: number; type: BadgeType; evidence: EarnedBadge["evidence"] }> = [];
  for (const badge of earned) {
    if (!isBadgeType(badge.type) || seen.has(badge.type)) continue;
    seen.add(badge.type);
    rows.push({ studentId: id, type: badge.type, evidence: badge.evidence });
  }

  if (rows.length === 0) return [];

  try {
    const inserted = await client
      .insert(badgeAwards)
      .values(rows)
      .onConflictDoNothing({ target: [badgeAwards.studentId, badgeAwards.type] })
      .returning({ type: badgeAwards.type, id: badgeAwards.id, awardedAt: badgeAwards.awardedAt });

    const createdByType = new Map(inserted.map((r) => [r.type, r]));

    return rows.map(({ type }) => {
      const win = createdByType.get(type);
      return {
        type,
        created: win !== undefined,
        awardId: win?.id ?? null,
        // Null for a badge that already existed. Deliberately not fetched — see the
        // doc comment. Callers wanting timestamps use `listStudentBadges`.
        awardedAt: win?.awardedAt ?? null,
      };
    });
  } catch (error) {
    console.error("[badges] bulk award failed; no badge was written", {
      studentId: id,
      types: rows.map((r) => r.type),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AwardRow {
  type: BadgeType;
  awardedAt: Date;
  evidence: Record<string, unknown> | null;
}

/**
 * One student's badges, newest first.
 *
 * Rows whose `type` is not in this build's catalogue are DROPPED, not rendered as
 * an unnamed card and not thrown over. The column is a varchar, so a row from a
 * newer deploy (or a hand-inserted typo) is possible, and a stale row is not a
 * reason to fail a page load. `isBadgeType` is that boundary.
 *
 * Served by `badge_awards_student_awarded_idx` (student_id, awarded_at).
 */
export async function listStudentBadges(
  studentId: number,
  client: Db = db,
): Promise<AwardRow[]> {
  const rows = await client
    .select({
      type: badgeAwards.type,
      awardedAt: badgeAwards.awardedAt,
      evidence: badgeAwards.evidence,
    })
    .from(badgeAwards)
    .where(eq(badgeAwards.studentId, Math.trunc(studentId)))
    .orderBy(desc(badgeAwards.awardedAt), desc(badgeAwards.id));

  return rows.flatMap((r) =>
    isBadgeType(r.type)
      ? [
          {
            type: r.type,
            awardedAt: r.awardedAt,
            evidence: (r.evidence as Record<string, unknown> | null) ?? null,
          },
        ]
      : [],
  );
}

/**
 * Badge counts for several students in ONE query, for a roster or a board.
 *
 * Exists so that a list of 80 students does not become 80 queries. Returns a Map
 * keyed by studentId; a student with no badges is absent from it rather than
 * present with 0, which the caller resolves with `?? 0` — an absent key and a zero
 * are the same fact and materialising the zeros would mean a second pass over the
 * roster to invent them.
 *
 * An EMPTY input returns an empty Map WITHOUT touching the database: `inArray`
 * with an empty list generates `in ()`, which Postgres rejects as a syntax error.
 */
export async function countBadgesForStudents(
  studentIds: readonly number[],
  client: Db = db,
): Promise<Map<number, number>> {
  const ids = [...new Set(studentIds.map((n) => Math.trunc(n)))].filter((n) => n > 0);
  if (ids.length === 0) return new Map();

  const rows = await client
    .select({ studentId: badgeAwards.studentId, type: badgeAwards.type })
    .from(badgeAwards)
    .where(inArray(badgeAwards.studentId, ids));

  const counts = new Map<number, number>();
  for (const row of rows) {
    // Counted in JavaScript rather than with a SQL `group by` so the SAME
    // catalogue filter `listStudentBadges` applies is applied here. A SQL count
    // would include rows for badges this build does not know about, and the number
    // in a header would then disagree with the number of cards below it.
    if (!isBadgeType(row.type)) continue;
    counts.set(row.studentId, (counts.get(row.studentId) ?? 0) + 1);
  }
  return counts;
}
