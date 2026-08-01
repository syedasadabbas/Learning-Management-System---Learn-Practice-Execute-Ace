// =============================================================================
// LIST PAGINATION — one parser, used by EVERY list endpoint in the three
// add-on features (learning enhancements, live classes, presentations).
// Owner: the API stream.
// -----------------------------------------------------------------------------
// WHY THIS LIVES UNDER src/lib/learning/ RATHER THAN A NEUTRAL src/lib/api/.
// The add-on wave is being built by concurrent streams with explicitly divided
// file ownership; this stream owns src/lib/learning/ and src/lib/live-classes/
// and does NOT own src/lib/presentations/ (the Reveal.js stream does). Creating
// a fourth top-level directory would put a shared file outside every declared
// boundary, which is how two streams end up editing the same file on the same
// afternoon. The directory name is therefore a deployment fact, not a claim
// that pagination is a learning concern.
//
// WHY LIMIT/OFFSET AND NOT A CURSOR. Every list in this wave is either small
// and bounded (samples of one assignment, slides of one deck) or is ordered by
// a column that is not unique (`scheduled_at`, `upvotes`), and a keyset cursor
// over a non-unique sort key needs a tiebreaker baked into the cursor to avoid
// skipping rows. Offset paging is correct for these sizes and is one concept
// instead of two. The one place where a cursor would genuinely pay — the chat
// transcript, which can be long and IS ordered by a unique-enough (class_id,
// created_at, id) — is handled by the `before` parameter in
// src/lib/live-classes/chat.ts, which is a keyset on top of this same limit.
//
// THE MAXIMUM IS THE POINT OF THE MODULE. An unbounded `limit` on class_chat is
// a denial-of-service against our own database that any signed-in student can
// fire from a URL bar. The cap is applied by CLAMPING rather than by rejecting,
// because a client asking for 5000 rows wants "as many as you will give me" and
// a 422 there just makes a working UI fail on a large class.
// =============================================================================

/**
 * Rows returned when the caller does not ask.
 *
 * 20 fits a screen without a scroll on the smallest supported viewport, which
 * is the number that decides whether the second page is ever requested.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * The documented ceiling on any single page, for every list endpoint in this
 * wave. Requests above it are clamped down to it, never rejected.
 *
 * 100 rather than 1000: at 50-80 students per cohort, 100 covers "the whole
 * roster in one request" — the largest legitimate single-page need there is —
 * and every list here carries wide TEXT columns (a chat message, a problem
 * statement, a slide body) where a thousand rows is megabytes of JSON.
 */
export const MAX_PAGE_SIZE = 100;

/** A validated page window. `limit` is always within [1, MAX_PAGE_SIZE]. */
export interface Page {
  limit: number;
  offset: number;
}

/** Why a page window was rejected. Mapped to a 422 by the route handlers. */
export interface PageError {
  error: string;
  code: "invalid_limit" | "invalid_offset";
}

export type PageResult = { ok: true; page: Page } | { ok: false } & PageError;

/**
 * The largest `offset` accepted.
 *
 * Postgres evaluates and discards every row before an OFFSET, so a request for
 * `offset=100000000` is a full scan the caller then throws away. Nothing in
 * this app has a hundred thousand rows of anything, so an offset past this is a
 * malformed client or a probe, and either is better answered with a 422 than
 * with a thirty-second query.
 */
export const MAX_OFFSET = 100_000;

/**
 * Parse `limit` and `offset` from a query string.
 *
 * Absent parameters take the defaults. Present-but-malformed parameters are an
 * ERROR rather than a silent fall-back to the default: a client that sent
 * `limit=abc` has a bug, and answering it with 20 rows hides that bug behind
 * a page that looks like it worked.
 *
 * @param params the request's `URLSearchParams`
 * @returns `{ ok: true, page }`, or `{ ok: false, error, code }` for a 422
 */
export function parsePage(params: URLSearchParams): PageResult {
  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");

  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== null) {
    // Digits only. `Number(" 5 ")` is 5 and `parseInt("5x")` is 5; both accept a
    // URL the caller did not mean to send.
    if (!/^\d+$/.test(rawLimit)) {
      return { ok: false, error: "limit must be a non-negative integer.", code: "invalid_limit" };
    }
    const asked = Number(rawLimit);
    if (asked < 1) {
      return { ok: false, error: "limit must be at least 1.", code: "invalid_limit" };
    }
    // Clamp, do not reject — see the module header.
    limit = Math.min(asked, MAX_PAGE_SIZE);
  }

  let offset = 0;
  if (rawOffset !== null) {
    if (!/^\d+$/.test(rawOffset)) {
      return { ok: false, error: "offset must be a non-negative integer.", code: "invalid_offset" };
    }
    offset = Number(rawOffset);
    if (offset > MAX_OFFSET) {
      return {
        ok: false,
        error: `offset must not exceed ${MAX_OFFSET}.`,
        code: "invalid_offset",
      };
    }
  }

  return { ok: true, page: { limit, offset } };
}

/** The envelope every paginated list endpoint returns inside `apiOk`. */
export interface Paginated<T> {
  items: T[];
  /** Echo of the window actually applied, which may be a clamped `limit`. */
  limit: number;
  offset: number;
  /**
   * Total matching rows, ignoring the window.
   *
   * Present because "page 3 of 7" cannot be rendered without it, and a client
   * that has to discover the end by requesting an empty page issues one extra
   * round trip per list. The cost is a second COUNT statement per request,
   * which for these table sizes is an index-only scan.
   */
  total: number;
}

/** Build the paginated envelope. Exists so no handler assembles it by hand. */
export function paginated<T>(items: T[], page: Page, total: number): Paginated<T> {
  return { items, limit: page.limit, offset: page.offset, total };
}
