// =============================================================================
// NOTIFICATION HISTORY — the student's read model.
// Owner: the email-notifications stream. Import from "@/lib/notifications".
// -----------------------------------------------------------------------------
// EVERY FUNCTION HERE TAKES A userId AND FILTERS ON IT. None of them accepts a
// notification id on its own, and that is a deliberate shape rather than a
// convenience: a `markRead(notificationId)` would be one missing ownership check
// away from letting any signed-in student mark — or, with one more function, read —
// somebody else's notifications, which carry another student's scores and penalty
// text. The ownership predicate is therefore part of the WHERE clause of every
// statement, not a guard a caller has to remember. The page that calls these
// re-guards with `requireUser()` as well; two layers, because "the page checks it"
// has never stopped a server action being POSTed directly.
//
// THE HISTORY IS CAPPED, NOT PAGINATED. `HISTORY_LIMIT` rows, newest first, served
// by `notifications_user_created_idx`. Pagination was considered and rejected for
// now: a student on a 4-week course generates on the order of 40 notifications
// (4 weeks x {quiz, exam, assignment} plus penalties), so the first page IS the
// history, and a pager would be UI nobody reaches. It becomes wrong for a
// multi-cohort account after a year; the TODO below says so rather than pretending
// the limit is a design.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { and, count, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { notifications } from "@/db/schema.notifications";

import type { NotificationMetadata } from "./types";

/** Drizzle client. Injectable for tests. */
type Client = typeof db;

/**
 * How many rows the history page renders.
 *
 * TODO(notifications): when a cohort runs long enough that a student has more than
 * this, add keyset pagination on (created_at, id) — NOT an OFFSET, which re-scans
 * the prefix on every page and shifts rows under the reader when a new
 * notification arrives mid-browse.
 */
export const HISTORY_LIMIT = 50;

export interface HistoryEntry {
  id: number;
  type: string;
  subject: string;
  body: string;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
  readAt: Date | null;
  /** Relative in-app path, or null. Built by this stream, never from a request. */
  url: string | null;
}

/**
 * The student's own notifications, newest first.
 *
 * Columns are named explicitly rather than `select()`-all: `recipient_email` and
 * `failure_reason` are deliberately NOT returned. The address is a duplicate of the
 * one on their profile, and `failure_reason` is a transport diagnostic that can
 * quote a relay's response — server-side detail that has no business on a page.
 */
export async function listNotifications(
  userId: number,
  limit = HISTORY_LIMIT,
  client: Client = db,
): Promise<HistoryEntry[]> {
  const rows = await client
    .select({
      id: notifications.id,
      type: notifications.type,
      subject: notifications.subject,
      body: notifications.body,
      status: notifications.status,
      createdAt: notifications.createdAt,
      sentAt: notifications.sentAt,
      readAt: notifications.readAt,
      metadata: notifications.metadata,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(Math.max(1, Math.min(HISTORY_LIMIT, Math.trunc(limit))));

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    readAt: row.readAt,
    url: safeInternalUrl(row.metadata),
  }));
}

/**
 * A relative in-app path from a metadata blob, or null.
 *
 * jsonb accepts anything, so the READER validates rather than trusting that every
 * writer was careful. Only a value that starts with a single "/" and does not start
 * with "//" survives: "//evil.example" is a protocol-relative URL that a browser
 * treats as another origin, which is exactly the off-site link an internal
 * breadcrumb must never become.
 */
export function safeInternalUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const url = (metadata as NotificationMetadata).url;
  if (typeof url !== "string") return null;
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  return url;
}

/** How many of this student's notifications they have not seen yet. */
export async function unreadCount(userId: number, client: Client = db): Promise<number> {
  const [row] = await client
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.value ?? 0);
}

/**
 * Mark everything this student has not read as read, and report how many changed.
 *
 * ONE STATEMENT over the whole set rather than a row-at-a-time loop from the page:
 * the page has just rendered the list, so "everything up to now" is precisely what
 * the student has seen, and a per-row endpoint would be N round trips at ~245 ms
 * each (src/db/index.ts) to answer a question nobody asked. `where read_at is null`
 * makes it idempotent — a second call changes nothing and reports 0.
 */
export async function markAllRead(userId: number, client: Client = db): Promise<number> {
  const updated = await client
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return updated.length;
}
