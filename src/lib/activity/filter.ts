// =============================================================================
// FILTER PARSING — pure, so it can be tested without a database.
// Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// "An admin surface that can filter by actor, action and time range is part of the
// feature; a table nobody can query is not compliance." This file is the half of
// that which is decidable without I/O: turning a URL's query string into a
// validated filter, or refusing it.
//
// TWO RULES IT ENFORCES, both learned from src/app/api/admin/jobs/route.ts:37-50:
//
//   1. AN UNRECOGNISED FILTER IS AN ERROR, NEVER AN IGNORED ONE. `?action=logn`
//      must not quietly return the whole unfiltered table — an admin who searched
//      for an event and got "everything" back will conclude the event did not
//      happen. Silently dropping a filter turns a typo into a false negative in an
//      investigation.
//   2. NO UNBOUNDED READ. Every query has a page size with a hard ceiling, because
//      this is the largest table in the database and `SELECT *` against it is a
//      way to take the app down from the admin console.
//
// Time is parsed as inclusive-from / exclusive-to, and both bounds are ISO-8601
// instants. The unit of a range is a millisecond because that is what the column
// stores; the UI offers day-granularity shortcuts on top.
// =============================================================================

import {
  actionsInCategory,
  isActivityAction,
  isActivityCategory,
  type ActivityActionName,
} from "./actions";

/** Default page size for the admin table: fills a screen without a heavy read. */
export const DEFAULT_PAGE_SIZE = 50;
/**
 * Hard ceiling for one page. 200 matches `listJobs`' cap in the queue's store, so
 * an operator learns one number for the whole admin console.
 */
export const MAX_PAGE_SIZE = 200;
/**
 * Ceiling for a CSV export, which is a different act with a different budget: a
 * compliance export is expected to be large, but it still runs inside one
 * serverless invocation with a wall-clock limit, and 20_000 rows of this shape is
 * roughly 3 MB — streamable in one response without buffering the table.
 */
export const MAX_EXPORT_ROWS = 20_000;

export interface ActivityFilter {
  /** users.id of the actor. Null means "any actor", including cron's null actor. */
  actorId: number | null;
  actions: ActivityActionName[] | null;
  status: "success" | "failure" | null;
  entityType: string | null;
  entityId: number | null;
  /** Inclusive lower bound. */
  from: Date | null;
  /** EXCLUSIVE upper bound — see parseActivityFilter for why. */
  to: Date | null;
  limit: number;
  /** Keyset cursor: return rows strictly older than this id. See query.ts. */
  beforeId: number | null;
}

export type FilterParseResult =
  | { ok: true; filter: ActivityFilter }
  | { ok: false; error: string; code: string };

export const EMPTY_FILTER: ActivityFilter = {
  actorId: null,
  actions: null,
  status: null,
  entityType: null,
  entityId: null,
  from: null,
  to: null,
  limit: DEFAULT_PAGE_SIZE,
  beforeId: null,
};

interface ParseOptions {
  /** Ceiling for `limit`. Defaults to MAX_PAGE_SIZE; the export route raises it. */
  maxLimit?: number;
  defaultLimit?: number;
}

/**
 * Validate a query string into a filter, or explain what is wrong with it.
 *
 * Accepts `URLSearchParams` so the same function serves the API route (from
 * `new URL(request.url)`) and the admin page (from Next's `searchParams`), with no
 * second, subtly different implementation for the page — which is how a filter
 * that works in the UI stops working in the export.
 *
 * Recognised parameters:
 *   actor=<int>        users.id
 *   action=a,b,c       one or more action names; ALL must be valid
 *   category=<name>    expands to every action in that category
 *   status=success|failure
 *   entityType=<slug>  with optional entityId=<int>
 *   from=<ISO>         inclusive
 *   to=<ISO>           EXCLUSIVE
 *   days=<int>         shorthand for from = now - N days (ignored if `from` given)
 *   limit=<int>        capped at maxLimit
 *   before=<int>       keyset cursor
 */
export function parseActivityFilter(
  params: URLSearchParams,
  options: ParseOptions = {},
): FilterParseResult {
  const maxLimit = options.maxLimit ?? MAX_PAGE_SIZE;
  const filter: ActivityFilter = { ...EMPTY_FILTER, limit: options.defaultLimit ?? DEFAULT_PAGE_SIZE };

  // --- actor --------------------------------------------------------------
  const actorRaw = params.get("actor");
  if (actorRaw !== null && actorRaw !== "" && actorRaw !== "all") {
    const actorId = Number(actorRaw);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      return fail("actor must be a positive integer user id.", "invalid_actor");
    }
    filter.actorId = actorId;
  }

  // --- action / category --------------------------------------------------
  const actionRaw = params.get("action");
  if (actionRaw !== null && actionRaw !== "" && actionRaw !== "all") {
    const wanted = actionRaw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const valid = wanted.filter(isActivityAction);
    if (valid.length !== wanted.length || valid.length === 0) {
      // Rule 1. Naming the offending values is safe — they are action names from a
      // closed vocabulary, not user data.
      const bad = wanted.filter((w) => !isActivityAction(w));
      return fail(
        `Unknown action name(s): ${bad.join(", ") || "(none supplied)"}.`,
        "invalid_action",
      );
    }
    filter.actions = valid;
  }

  const categoryRaw = params.get("category");
  if (categoryRaw !== null && categoryRaw !== "" && categoryRaw !== "all") {
    const expanded = isActivityCategory(categoryRaw) ? actionsInCategory(categoryRaw) : null;
    if (!expanded) {
      return fail(`Unknown category: ${categoryRaw}.`, "invalid_category");
    }
    // Intersect rather than replace, so ?category=identity&action=login is the
    // conjunction a reader would expect instead of one silently winning.
    filter.actions = filter.actions
      ? filter.actions.filter((a) => expanded.includes(a))
      : expanded;
    if (filter.actions.length === 0) {
      return fail(
        "The action and category filters do not overlap, so nothing could ever match.",
        "contradictory_filter",
      );
    }
  }

  // --- status -------------------------------------------------------------
  const statusRaw = params.get("status");
  if (statusRaw !== null && statusRaw !== "" && statusRaw !== "all") {
    if (statusRaw !== "success" && statusRaw !== "failure") {
      return fail('status must be "success" or "failure".', "invalid_status");
    }
    filter.status = statusRaw;
  }

  // --- entity -------------------------------------------------------------
  const entityType = params.get("entityType");
  if (entityType) {
    if (!/^[a-z0-9_]{1,50}$/.test(entityType)) {
      return fail(
        "entityType must be a short lower-case slug (a-z, 0-9, underscore).",
        "invalid_entity_type",
      );
    }
    filter.entityType = entityType;
  }
  const entityIdRaw = params.get("entityId");
  if (entityIdRaw !== null && entityIdRaw !== "") {
    const entityId = Number(entityIdRaw);
    if (!Number.isInteger(entityId) || entityId <= 0) {
      return fail("entityId must be a positive integer.", "invalid_entity_id");
    }
    if (!filter.entityType) {
      // An id without a type matches rows across unrelated tables that happen to
      // share a serial value — "submission 441" and "user 441" are different
      // things, and returning both would be a wrong answer, not a broad one.
      return fail("entityId requires entityType.", "entity_id_without_type");
    }
    filter.entityId = entityId;
  }

  // --- time ---------------------------------------------------------------
  const fromRaw = params.get("from");
  if (fromRaw) {
    const from = parseInstant(fromRaw);
    if (!from) return fail("from must be an ISO-8601 date or date-time.", "invalid_from");
    filter.from = from;
  }

  const toRaw = params.get("to");
  if (toRaw) {
    const to = parseInstant(toRaw);
    if (!to) return fail("to must be an ISO-8601 date or date-time.", "invalid_to");
    // EXCLUSIVE upper bound. `to=2026-07-31` parses to midnight, and an inclusive
    // bound would then silently exclude everything that happened during the 31st —
    // the classic off-by-a-day that makes an auditor's range look empty. Callers
    // wanting "through the 31st" pass to=2026-08-01, and the UI's day shortcuts do.
    filter.to = to;
  }

  if (filter.from && filter.to && filter.from.getTime() >= filter.to.getTime()) {
    return fail("from must be earlier than to.", "empty_range");
  }

  const daysRaw = params.get("days");
  if (daysRaw && !filter.from) {
    const days = Number(daysRaw);
    if (!Number.isInteger(days) || days <= 0 || days > 3_650) {
      return fail("days must be an integer between 1 and 3650.", "invalid_days");
    }
    filter.from = new Date(Date.now() - days * 86_400_000);
  }

  // --- paging -------------------------------------------------------------
  const limitRaw = params.get("limit");
  if (limitRaw !== null && limitRaw !== "") {
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit <= 0) {
      return fail("limit must be a positive integer.", "invalid_limit");
    }
    // Clamped, not rejected: asking for too much is a reasonable thing for a
    // client to do, and the ceiling is the protection. Rule 2.
    filter.limit = Math.min(limit, maxLimit);
  }

  const beforeRaw = params.get("before");
  if (beforeRaw !== null && beforeRaw !== "") {
    const before = Number(beforeRaw);
    if (!Number.isInteger(before) || before <= 0) {
      return fail("before must be a positive integer row id.", "invalid_cursor");
    }
    filter.beforeId = before;
  }

  return { ok: true, filter };
}

function fail(error: string, code: string): FilterParseResult {
  return { ok: false, error, code };
}

/**
 * ISO-8601 only — deliberately NOT `new Date(anything)`.
 *
 * `new Date("31/07/2026")` is `Invalid Date` in one engine and a real date in
 * another, and `new Date("2026")` silently means January. An audit range that means
 * a different span depending on the runtime is worse than a rejected one.
 */
function parseInstant(raw: string): Date | null {
  const trimmed = raw.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const dateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/.test(
    trimmed,
  );
  if (!dateOnly && !dateTime) return null;
  // A bare date is midnight UTC. Stated rather than left to the engine: the column
  // is timestamptz, so a floating local interpretation would shift the range by the
  // server's offset and make the same URL mean different things in two regions.
  const value = dateOnly ? `${trimmed}T00:00:00Z` : trimmed.replace(" ", "T");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Render a filter back into a query string, for pagination links and for the
 * "export exactly what I am looking at" button.
 *
 * Round-tripping matters: an export that silently applies a different filter than
 * the table on screen is a compliance artefact that does not match what was
 * reviewed. `limit` and `before` are omitted because they are per-request paging,
 * not part of what the filter selects.
 */
export function filterToQuery(filter: ActivityFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.actorId !== null) params.set("actor", String(filter.actorId));
  if (filter.actions) params.set("action", filter.actions.join(","));
  if (filter.status) params.set("status", filter.status);
  if (filter.entityType) params.set("entityType", filter.entityType);
  if (filter.entityId !== null) params.set("entityId", String(filter.entityId));
  if (filter.from) params.set("from", filter.from.toISOString());
  if (filter.to) params.set("to", filter.to.toISOString());
  return params;
}

/** True when any selective clause is set — changes the empty-state wording. */
export function isFiltered(filter: ActivityFilter): boolean {
  return (
    filter.actorId !== null ||
    filter.actions !== null ||
    filter.status !== null ||
    filter.entityType !== null ||
    filter.from !== null ||
    filter.to !== null
  );
}
