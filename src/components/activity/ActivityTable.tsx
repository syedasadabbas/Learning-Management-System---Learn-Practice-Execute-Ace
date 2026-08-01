// =============================================================================
// ACTIVITY LOG TABLE — activity-logs stream.
// -----------------------------------------------------------------------------
// A server component. There is no client state here at all: the filters are links
// (see ActivityFilters.tsx) and paging is a keyset cursor in the URL, so nothing on
// this page needs hydrating. On the largest table in the database, shipping a
// client-side table that re-fetches and re-sorts would be the wrong trade twice
// over.
//
// WHAT THIS DELIBERATELY DOES NOT RENDER, even though an admin is authorised to see
// it: nothing is hidden here that the query returned — the redaction happened at
// WRITE time (src/lib/activity/redact.ts), which is the only place it can be
// guaranteed. A row on this screen cannot contain a password or a request body
// because no such value was ever stored. That is the difference between a privacy
// control and a display convention: a display convention is undone by the CSV
// export sitting next to it.
//
// The actor's EMAIL is rendered as a tooltip rather than a column, and only because
// this page is `requireRole("admin")`. The name identifies the row; the address is
// there for an investigator who needs to correlate with an external system.
// =============================================================================

import Link from "next/link";

import { Badge, Card, EmptyState, buttonClasses } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import {
  ACTION_META,
  actionLabel,
  type ActivityCategory,
  type ActivityRow,
} from "@/lib/activity";

const CATEGORY_TONE: Record<ActivityCategory, BadgeTone> = {
  identity: "brand",
  assessment: "neutral",
  coursework: "neutral",
  administration: "warning",
  audit: "success",
};

export interface ActivityTableProps {
  rows: readonly ActivityRow[];
  /** True when any selective clause is applied — changes the empty wording. */
  filtered: boolean;
  /** Keyset cursor for the next page, or null on the last one. */
  nextCursor: number | null;
  /** Current query string, so "next page" preserves the filter. */
  query: string;
  basePath?: string;
}

/**
 * UTC, always, and to the second.
 *
 * A locale-formatted timestamp on an audit surface is ambiguous about both the
 * offset and day/month order, and an investigator comparing this table to a
 * server log or an email header is comparing UTC. The column header says so, so a
 * reader is never guessing which zone they are looking at.
 */
function formatInstant(value: Date): string {
  return value.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

/** `details` is a flat object by construction (see sanitiseDetails). */
function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return "";
  return Object.entries(details)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("  ");
}

export function ActivityTable({
  rows,
  filtered,
  nextCursor,
  query,
  basePath = "/admin/activity",
}: ActivityTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={filtered ? "Nothing matches this filter" : "No activity has been recorded yet"}
        description={
          filtered
            ? "The filter is applied and returned no rows. That is a genuine absence of matching events, not a failed query — an unrecognised filter would have been rejected with an error rather than silently widened."
            : "The table exists and is queryable, but no act has been logged yet. In this commit only the audit trail's own events (export, prune) have live call sites; the actions listed under “Coverage” below are declared and awaiting their owning stream to call recordActivity()."
        }
      />
    );
  }

  return (
    <Card
      title={`Events (${rows.length}${nextCursor ? "+" : ""})`}
      subtitle="Newest first. Times are UTC."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="activity-table">
          <thead>
            <tr className="border-b border-line text-xs uppercase text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                When (UTC)
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Action
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Actor
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Target
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Network
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Context
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-line/60 align-top"
                data-testid={`activity-row-${row.id}`}
              >
                <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs tabular-nums">
                  {formatInstant(row.occurredAt)}
                </td>

                <td className="py-2 pr-3">
                  <Badge tone={CATEGORY_TONE[ACTION_META[row.action].category]} size="sm">
                    {actionLabel(row.action)}
                  </Badge>
                  {row.status === "failure" && (
                    <span className="ml-1">
                      <Badge tone="danger" size="sm">
                        {row.errorCode ?? "failed"}
                      </Badge>
                    </span>
                  )}
                </td>

                <td className="py-2 pr-3">
                  {row.actorId === null ? (
                    // Two very different reasons for a null actor, and conflating
                    // them would mislead an investigator: an unauthenticated act
                    // (a failed login, a cron run) versus an actor whose account
                    // has since been deleted, which `on delete set null` produces.
                    // The log row's own `actorRole` snapshot tells them apart.
                    <span className="text-ink-muted">
                      {row.actorRole ? `deleted ${row.actorRole}` : "no session"}
                    </span>
                  ) : (
                    <span title={row.actorEmail ?? undefined}>
                      {row.actorName ?? `user ${row.actorId}`}
                      <span className="ml-1 text-xs text-ink-muted">
                        {row.actorRole}
                        {/* The role CHANGED since the act. An auditor asking "was
                            this person an admin when they did that?" needs this. */}
                        {row.actorRoleNow && row.actorRoleNow !== row.actorRole
                          ? ` → now ${row.actorRoleNow}`
                          : ""}
                      </span>
                    </span>
                  )}
                </td>

                <td className="py-2 pr-3 text-xs">
                  {row.entityType ? (
                    <span className="font-mono">
                      {row.entityType}
                      {row.entityId !== null ? `#${row.entityId}` : ""}
                    </span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>

                <td className="py-2 pr-3 font-mono text-xs text-ink-muted">
                  {row.ipPrefix ?? "—"}
                  {row.clientFamily && (
                    <span className="ml-1 font-sans">{row.clientFamily}</span>
                  )}
                </td>

                <td className="py-2 pr-3 font-mono text-xs text-ink-muted">
                  {formatDetails(row.details) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nextCursor !== null && (
        <div className="mt-3">
          <Link
            href={`${basePath}?${query ? `${query}&` : ""}before=${nextCursor}`}
            data-testid="activity-next-page"
            className={buttonClasses("secondary", "sm")}
          >
            Older events →
          </Link>
          <p className="mt-1 text-xs text-ink-muted">
            Keyset paging on the row id, not OFFSET: constant cost at any depth, and
            an event written while you page cannot shift the window and hide a row.
          </p>
        </div>
      )}
    </Card>
  );
}
