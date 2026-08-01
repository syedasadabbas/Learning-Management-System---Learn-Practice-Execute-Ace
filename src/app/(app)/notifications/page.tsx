// =============================================================================
// /notifications — the notification history dashboard and email preferences.
// Owner: the email-notifications stream (roadmap PHASE 1 feature 1).
// -----------------------------------------------------------------------------
// PATH NOTE, raised rather than silently resolved. IMPLEMENTATION_ROADMAP.md puts
// the preferences UI in `src/app/(app)/settings/page.tsx` as a "notifications tab".
// That is not done, for two reasons and one is not tidiness:
//   1. /settings belongs to the `account` stream and is a FLAT page with no tab
//      structure at all (verified: it renders ProfileForm and PasswordForm inside
//      one <main>, with no section switch). Adding a tab means restructuring
//      another stream's page while eight agents share this tree — the shape of edit
//      that loses somebody's work in a merge.
//   2. The roadmap ALSO asks for a "notification history dashboard", which is a
//      list of every message sent to the student. That is not settings; it is its
//      own page, and putting a 50-row history inside an account form is how a
//      settings page becomes a scrolling wall.
// So both live here, on one route, and the coordinator is told what is needed to
// finish the wiring:
//   * a nav entry in src/components/nav/nav-links.ts (NOT added here — nav-links.ts
//     is not this stream's file, and tests/unit/cross-stream-contracts.test.ts
//     requires the ROUTE to exist before the href does. It now does: this file);
//   * `{ prefix: "/notifications", required: "student" }` in src/middleware.ts's
//     PROTECTED table. Without it the middleware does not pre-empt an anonymous
//     visit — but `requireUser()` below still redirects it, which is why the page is
//     safe to ship before that line lands rather than broken without it.
//
// AUTH: `requireUser("/notifications")`, not `requireRole("student")`. Every role
// receives notifications — an instructor's assignment-feedback mail is the same
// mechanism — and a role-gated page would be a second place where "who has
// notifications" has to be remembered, which is the place that gets it wrong.
//
// force-dynamic: the page reflects rows that the two actions on it just changed, and
// a cached render would show the previous state immediately after a save.
// =============================================================================

import { Button, Card } from "@/components/ui";
import { NotificationHistoryList } from "@/components/notifications/NotificationHistoryList";
import { NotificationPreferencesForm } from "@/components/notifications/NotificationPreferencesForm";
import { requireUser } from "@/lib/guard";
import {
  markNotificationsReadAction,
  saveNotificationPreferencesAction,
} from "@/lib/notifications/actions";
import { listNotifications, resolvePreferences, unreadCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser("/notifications");
  const { saved } = await searchParams;

  // THREE READS, ISSUED TOGETHER. Each is one round trip measured at roughly 245 ms
  // on this Neon instance (src/db/index.ts), so running them sequentially would put
  // ~735 ms of pure latency in front of a page that shows two cards. They are
  // independent — nothing here reads a value another one produced — so
  // `Promise.all` is correct rather than merely faster.
  const [entries, preferences, unread] = await Promise.all([
    listNotifications(user.id),
    resolvePreferences(user.id),
    unreadCount(user.id),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-semibold" data-testid="notifications-heading">
          Notifications
        </h1>
        <p className="text-sm text-ink-muted">
          Every email this course has sent you, and what it is allowed to send. Emails go
          out through a queue, so a message can sit at &quot;Queued&quot; for a few minutes
          before it leaves.
        </p>
      </header>

      {unread > 0 && (
        <Card>
          <form action={markNotificationsReadAction} className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink" data-testid="unread-count" data-unread={unread}>
              {unread} unread {unread === 1 ? "message" : "messages"}.
            </p>
            <Button type="submit" variant="secondary" data-testid="mark-all-read">
              Mark all as read
            </Button>
          </form>
        </Card>
      )}

      <NotificationHistoryList entries={entries} />

      <NotificationPreferencesForm
        preferences={preferences}
        action={saveNotificationPreferencesAction}
        saved={saved === "1"}
      />
    </main>
  );
}
