// =============================================================================
// READING THE AUDIT TRAIL. Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// "It must be readable by the people who need it." Every query in this file is
// shaped to hit one of the four indexes declared in src/db/schema.activity.ts, and
// each function says which. On the largest table in the database a read that
// sequentially scans is not slow, it is an outage.
//
// KEYSET PAGINATION, NOT OFFSET. `OFFSET 10000` makes Postgres walk and discard ten
// thousand rows on every page, so paging deeper through an investigation gets
// progressively slower exactly when someone is deep in an investigation. `id <
// cursor` is a range scan of constant cost. It is also correct under concurrent
// inserts: with OFFSET, a row written while the reader pages would shift the whole
// window and silently skip an entry — in an audit context, a skipped entry is the
// worst possible defect.
//
// `id DESC` rather than `occurred_at DESC` as the sort key: `id` is a bigserial, so
// it is unique and monotonic, which gives a total order with no tie-breaking and a
// cursor that cannot be ambiguous. Two rows can share a timestamp to the
// microsecond; they cannot share an id.
//
// THE ACTOR JOIN IS THE PRIVACY SEAM. `activity_logs` stores no name and no email
// (see src/db/schema.activity.ts and redact.ts). The admin's view needs them, so
// they are joined from `users` at READ time, by a caller that has already passed
// `requireRole("admin")` / `apiGuard("admin")`. That is the whole trade: identity is
// resolved for an authorised reader at the moment of reading, instead of being
// copied into a 90-day table that also has a CSV button on it.
// =============================================================================

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { activityLogs } from "@/db/schema.activity";

import type { ActivityActionName } from "./actions";
import type { ActivityFilter } from "./filter";
import type { ExportRow } from "./csv";
import type { ActivityDb } from "./record";

/** One row as the admin table renders it, with the actor resolved. */
export interface ActivityRow {
  id: number;
  occurredAt: Date;
  action: ActivityActionName;
  status: "success" | "failure";
  actorId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  /** The role AT THE TIME, from the log row — not the actor's current role. */
  actorRole: string | null;
  /** The actor's CURRENT role, for the "was an admin, now a student" case. */
  actorRoleNow: string | null;
  entityType: string | null;
  entityId: number | null;
  ipPrefix: string | null;
  clientFamily: string | null;
  errorCode: string | null;
  correlationId: string | null;
  details: Record<string, unknown> | null;
}

/**
 * Translate a filter into WHERE clauses.
 *
 * WHICH INDEX EACH CLAUSE USES:
 *   actorId + the id ordering        -> activity_logs_actor_time_idx
 *   actions + the id ordering        -> activity_logs_action_time_idx
 *   entityType (+ entityId)          -> activity_logs_entity_idx
 *   from / to with no other filter   -> activity_logs_occurred_at_brin_idx
 *   status                           -> no index, by choice: it is two values, so
 *                                       an index on it is never selective enough to
 *                                       beat a filter applied to rows another index
 *                                       already narrowed.
 */
function whereFor(filter: ActivityFilter): SQL | undefined {
  const clauses: SQL[] = [];

  if (filter.actorId !== null) clauses.push(eq(activityLogs.actorId, filter.actorId));
  if (filter.actions && filter.actions.length > 0) {
    clauses.push(inArray(activityLogs.action, filter.actions));
  }
  if (filter.status !== null) clauses.push(eq(activityLogs.status, filter.status));
  if (filter.entityType !== null) clauses.push(eq(activityLogs.entityType, filter.entityType));
  if (filter.entityId !== null) clauses.push(eq(activityLogs.entityId, filter.entityId));
  if (filter.from) clauses.push(gte(activityLogs.occurredAt, filter.from));
  // Exclusive upper bound; the off-by-a-day argument is in filter.ts.
  if (filter.to) clauses.push(lt(activityLogs.occurredAt, filter.to));
  if (filter.beforeId !== null) clauses.push(lt(activityLogs.id, filter.beforeId));

  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

const ROW_SELECTION = {
  id: activityLogs.id,
  occurredAt: activityLogs.occurredAt,
  action: activityLogs.action,
  status: activityLogs.status,
  actorId: activityLogs.actorId,
  actorRole: activityLogs.actorRole,
  entityType: activityLogs.entityType,
  entityId: activityLogs.entityId,
  ipPrefix: activityLogs.ipPrefix,
  clientFamily: activityLogs.clientFamily,
  errorCode: activityLogs.errorCode,
  correlationId: activityLogs.correlationId,
  details: activityLogs.details,
  actorName: users.name,
  actorEmail: users.email,
  actorRoleNow: users.role,
} as const;

export interface ListResult {
  rows: ActivityRow[];
  /** Cursor for the next page, or null when this is the last one. */
  nextCursor: number | null;
}

/**
 * One page of the trail, newest first.
 *
 * LEFT join, not inner: an entry whose actor was deleted has `actor_id = null` (see
 * the `on delete set null` argument in the schema), and a failed login never had an
 * actor at all. An inner join would silently hide exactly those rows — the
 * anonymous and the erased — which are the ones an investigation is most likely to
 * be looking for.
 *
 * Asks for `limit + 1` rows to decide whether a next page exists, rather than
 * issuing a second COUNT: on this table a count of the filtered set is the
 * expensive query, and "is there more?" is all a pager needs.
 */
export async function listActivity(
  filter: ActivityFilter,
  client: ActivityDb = db,
): Promise<ListResult> {
  const where = whereFor(filter);
  const query = client
    .select(ROW_SELECTION)
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.actorId))
    .orderBy(desc(activityLogs.id))
    .limit(filter.limit + 1);

  const raw = where ? await query.where(where) : await query;

  const hasMore = raw.length > filter.limit;
  const page = hasMore ? raw.slice(0, filter.limit) : raw;

  return {
    rows: page.map(toRow),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

function toRow(r: {
  id: number;
  occurredAt: Date;
  action: string;
  status: string;
  actorId: number | null;
  actorRole: string | null;
  entityType: string | null;
  entityId: number | null;
  ipPrefix: string | null;
  clientFamily: string | null;
  errorCode: string | null;
  correlationId: string | null;
  details: unknown;
  actorName: string | null;
  actorEmail: string | null;
  actorRoleNow: string | null;
}): ActivityRow {
  return {
    id: r.id,
    occurredAt: r.occurredAt,
    action: r.action as ActivityActionName,
    status: r.status as "success" | "failure",
    actorId: r.actorId,
    actorName: r.actorName,
    actorEmail: r.actorEmail,
    actorRole: r.actorRole,
    actorRoleNow: r.actorRoleNow,
    entityType: r.entityType,
    entityId: r.entityId,
    ipPrefix: r.ipPrefix,
    clientFamily: r.clientFamily,
    errorCode: r.errorCode,
    correlationId: r.correlationId,
    details:
      r.details && typeof r.details === "object" && !Array.isArray(r.details)
        ? (r.details as Record<string, unknown>)
        : null,
  };
}

/**
 * Rows for a CSV export, oldest FIRST.
 *
 * Chronological because that is how a compliance reviewer reads a sequence of
 * events, and because it makes two exports of overlapping windows concatenate
 * sensibly. Ordered by `id` for the same total-order reason as the list query.
 *
 * Bounded by `filter.limit`, which the export route sets from MAX_EXPORT_ROWS. This
 * function will not stream the whole table however it is called.
 */
export async function exportActivity(
  filter: ActivityFilter,
  client: ActivityDb = db,
): Promise<ExportRow[]> {
  const where = whereFor(filter);
  const query = client
    .select(ROW_SELECTION)
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.actorId))
    .orderBy(asc(activityLogs.id))
    .limit(filter.limit);

  const raw = where ? await query.where(where) : await query;
  return raw.map((r) => ({
    occurredAt: r.occurredAt,
    action: r.action,
    status: r.status,
    actorId: r.actorId,
    actorName: r.actorName,
    actorEmail: r.actorEmail,
    actorRole: r.actorRole,
    entityType: r.entityType,
    entityId: r.entityId,
    ipPrefix: r.ipPrefix,
    clientFamily: r.clientFamily,
    errorCode: r.errorCode,
    correlationId: r.correlationId,
    details: r.details,
  }));
}

export interface ActivitySummary {
  /** Rows in the whole table. Approximate — see the note below. */
  total: number;
  last24h: number;
  failuresLast24h: number;
  /** Distinct actors seen in the last 24 hours. */
  actorsLast24h: number;
  oldest: Date | null;
}

/**
 * Headline numbers for the admin page.
 *
 * `total` comes from the planner's row estimate (`pg_class.reltuples`), NOT from
 * `count(*)`. On the largest table in the database an exact count is a full scan,
 * and it would run on every page load of the admin console — the single most likely
 * way this feature becomes the performance problem it is supposed to be watching.
 * The estimate is maintained by autovacuum and is accurate to a percent or two,
 * which is the right precision for a "how big is this?" tile. Every other number
 * here is exact and bounded by a 24-hour window, so it is served by the
 * action/time indexes.
 *
 * The estimate is negative (-1) on a table that has never been analysed; that is
 * clamped to 0 rather than shown, since "-1 rows" reads as a bug.
 */
export async function activitySummary(client: ActivityDb = db): Promise<ActivitySummary> {
  const since = new Date(Date.now() - 86_400_000);

  const [estimate, recent, oldest] = await Promise.all([
    client.execute<{ n: number }>(sql`
      select greatest(reltuples, 0)::bigint::int as n
      from pg_class where oid = 'activity_logs'::regclass
    `),
    client
      .select({
        total: sql<number>`count(*)::int`,
        failures: sql<number>`count(*) filter (where ${activityLogs.status} = 'failure')::int`,
        actors: sql<number>`count(distinct ${activityLogs.actorId})::int`,
      })
      .from(activityLogs)
      .where(gte(activityLogs.occurredAt, since)),
    client
      .select({ occurredAt: activityLogs.occurredAt })
      .from(activityLogs)
      .orderBy(asc(activityLogs.id))
      .limit(1),
  ]);

  const estimateRows = (estimate as unknown as { rows?: Array<{ n: number }> }).rows ?? [];

  return {
    total: Number(estimateRows[0]?.n ?? 0),
    last24h: recent[0]?.total ?? 0,
    failuresLast24h: recent[0]?.failures ?? 0,
    actorsLast24h: recent[0]?.actors ?? 0,
    oldest: oldest[0]?.occurredAt ?? null,
  };
}

/**
 * Actors that appear in the trail, for the "filter by actor" control.
 *
 * DERIVED FROM THE LOG, not from `users`: a console listing every account would
 * offer dozens of actors with nothing to show, and — more importantly — this
 * control's purpose is "who is in this log", which is a different set. Bounded to
 * `limit`, ordered by how much they appear, and scoped to a recent window so the
 * query is served by the actor/time index rather than scanning history.
 */
export async function activityActors(
  options: { days?: number; limit?: number } = {},
  client: ActivityDb = db,
): Promise<Array<{ id: number; name: string; email: string; events: number }>> {
  const days = options.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await client
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      events: sql<number>`count(*)::int`,
    })
    .from(activityLogs)
    .innerJoin(users, eq(users.id, activityLogs.actorId))
    .where(gte(activityLogs.occurredAt, since))
    .groupBy(users.id, users.name, users.email)
    .orderBy(desc(sql`count(*)`))
    .limit(options.limit ?? 50);

  return rows;
}

/**
 * Per-action counts inside a window, for the filter chips' badges.
 *
 * One grouped query rather than one query per action: 28 enum values would
 * otherwise mean 28 round trips at ~245 ms each on a warm connection
 * (src/db/index.ts:63), which is 7 seconds of admin page load.
 */
export async function activityActionCounts(
  options: { days?: number } = {},
  client: ActivityDb = db,
): Promise<Partial<Record<ActivityActionName, number>>> {
  const days = options.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await client
    .select({ action: activityLogs.action, n: sql<number>`count(*)::int` })
    .from(activityLogs)
    .where(gte(activityLogs.occurredAt, since))
    .groupBy(activityLogs.action);

  const out: Partial<Record<ActivityActionName, number>> = {};
  for (const row of rows) out[row.action as ActivityActionName] = row.n;
  return out;
}
