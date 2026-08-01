// =============================================================================
// NOTIFICATION HISTORY LIST — owned by the email-notifications stream.
// -----------------------------------------------------------------------------
// Renders what was SENT, not a re-derivation of the underlying events. The subject
// and body come from the `notifications` row, which is the same text the transport
// was handed (src/lib/queue/handlers/notification-email.ts sends
// `row.subject`/`row.body` verbatim), so the page and the student's inbox cannot
// disagree. A list that re-queried scores would drift the moment anything was
// regraded, and the student would have no way to know which version they were
// emailed.
//
// THE BODY IS RENDERED AS TEXT, in a `<p>` with `whitespace-pre-line`. Never
// `dangerouslySetInnerHTML`: the stored body is plain text by design (the HTML part
// is not persisted — argued on the column in src/db/schema.notifications.ts) and it
// contains instructor-authored strings. `whitespace-pre-line` preserves the
// template's line breaks without interpreting anything.
//
// STATUS IS SHOWN, and shown honestly. "Sent" means the transport accepted the
// message; on an install with no SMTP configured that is the dev logger and nothing
// left the building (src/lib/mail/dev.ts, the project's default state per
// FREE_STACK.md). The label therefore says "Emailed" rather than "Delivered", which
// would be a claim this system cannot make — there is no bounce or open tracking
// anywhere in this codebase.
// =============================================================================

import Link from "next/link";

import { Badge, Card, type BadgeTone } from "@/components/ui";
import { NOTIFICATION_TYPE_LABELS, type HistoryEntry } from "@/lib/notifications";

/** Status -> (student-facing label, Badge tone). Never the raw enum value. */
const STATUS_PRESENTATION: Record<string, { label: string; tone: BadgeTone }> = {
  sent: { label: "Emailed", tone: "success" },
  pending: { label: "Queued", tone: "neutral" },
  failed: { label: "Could not be emailed", tone: "danger" },
  suppressed: { label: "Not emailed (your choice)", tone: "warning" },
  bounced: { label: "Bounced", tone: "danger" },
};

function formatWhen(value: Date): string {
  // A fixed ISO-derived form rather than `toLocaleString()`: this renders on the
  // SERVER, whose locale and timezone are not the student's, so a "friendly" local
  // format would silently be the server's idea of local time. Date plus HH:MM in
  // UTC is unambiguous and stable for the e2e specs to assert against.
  return `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)} UTC`;
}

export function NotificationHistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <Card title="History">
        <p data-testid="notifications-empty" className="text-sm text-ink-muted">
          Nothing yet. When a quiz is graded, an exam is completed or a record is added to
          your account, the email you receive will also be listed here.
        </p>
      </Card>
    );
  }

  return (
    <Card title="History" subtitle={`The last ${entries.length} message${entries.length === 1 ? "" : "s"} this course sent you.`}>
      <ul className="flex flex-col divide-y divide-line" data-testid="notification-history">
        {entries.map((entry) => {
          const status = STATUS_PRESENTATION[entry.status] ?? {
            label: entry.status,
            tone: "neutral" as const,
          };
          return (
            <li
              key={entry.id}
              data-testid="notification-item"
              data-notification-type={entry.type}
              data-notification-status={entry.status}
              data-unread={entry.readAt ? undefined : "true"}
              className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{entry.subject}</span>
                <Badge tone={status.tone}>{status.label}</Badge>
                {!entry.readAt && <Badge tone="brand">New</Badge>}
              </div>
              <p className="text-xs text-ink-muted">
                {NOTIFICATION_TYPE_LABELS[entry.type as keyof typeof NOTIFICATION_TYPE_LABELS] ??
                  entry.type}{" "}
                · {formatWhen(entry.createdAt)}
              </p>
              <p className="whitespace-pre-line text-sm text-ink-muted">{entry.body}</p>
              {entry.url && (
                <Link href={entry.url} className="text-sm text-brand underline">
                  Open in the app
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
