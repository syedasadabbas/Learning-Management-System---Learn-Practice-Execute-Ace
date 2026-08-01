// =============================================================================
// NOTIFICATION PREFERENCES FORM — owned by the email-notifications stream.
// -----------------------------------------------------------------------------
// A SERVER COMPONENT with a plain `<form action={…}>` and uncontrolled checkboxes,
// matching src/components/account/ProfileForm.tsx. No client component and no
// `useState`: there is nothing to validate as the student types, no field depends
// on another, and a controlled checkbox without an onChange would render read-only.
// The saved state comes back from the database on the revalidated render, so what
// is on screen after a save is what is stored — not an optimistic guess that can
// disagree with it.
//
// THE TWO DIGEST SWITCHES ARE LABELLED AS NOT YET ACTIVE, in the UI, in words. They
// are stored (the columns exist so the shared migration does not have to be
// regenerated later — see src/db/schema.notifications.ts) but no code reads them
// yet, because a digest needs a scheduled sweep and this app has exactly one
// scheduler for queue work. A switch that looks live and does nothing is worse than
// an honest one: the student turns off the daily digest, keeps receiving nothing,
// and learns that the settings page is decorative.
// =============================================================================

import { Button, Card } from "@/components/ui";
import {
  PREFERENCE_KEYS,
  UNIMPLEMENTED_PREFERENCE_KEYS,
  type NotificationPreferences,
} from "@/lib/notifications";

/**
 * Labels and the "why would I want this?" line for each switch.
 *
 * Written out rather than derived from `NOTIFICATION_TYPE_LABELS`, because these
 * are second-person sentences about email ("Email me when …") and those are
 * third-person nouns for a history list ("Quiz submitted"). One map serving both
 * would end up with a settings page reading "Quiz submitted" as an instruction.
 */
const SWITCHES: Record<keyof NotificationPreferences, { label: string; hint: string }> = {
  quizSubmitted: {
    label: "Quiz results",
    hint: "When one of your quiz attempts has been graded, with the score and how many attempts are left.",
  },
  examCompleted: {
    label: "Weekly exam results",
    hint: "When a weekly exam is completed — including when the deadline closed it for you.",
  },
  assignmentFeedback: {
    label: "Assignment feedback",
    hint: "When an instructor grades one of your submissions and leaves written feedback.",
  },
  penaltyIssued: {
    label: "Penalties and warnings",
    hint: "When a record is added to your account, so it is never a surprise at the end of the week.",
  },
  forumReply: {
    label: "Replies to my posts",
    hint: "When somebody replies to a discussion you started or joined.",
  },
  badgeEarned: {
    label: "Badges",
    hint: "When you earn a badge.",
  },
  gradePosted: {
    label: "Grades posted",
    hint: "When a grade is published to your record.",
  },
  courseMessage: {
    label: "Messages from instructors",
    hint: "Announcements sent to your cohort.",
  },
  digestDaily: {
    label: "Daily digest",
    hint: "One summary email a day instead of individual messages.",
  },
  digestWeekly: {
    label: "Weekly digest",
    hint: "One summary email a week.",
  },
};

export function NotificationPreferencesForm({
  preferences,
  action,
  saved,
}: {
  preferences: NotificationPreferences;
  action: (formData: FormData) => Promise<void>;
  /** True immediately after a save, so the page can confirm it happened. */
  saved?: boolean;
}) {
  return (
    <Card
      title="Email preferences"
      subtitle="Choose what this course emails you about. Changes apply to messages that have not gone out yet."
    >
      <form action={action} className="flex flex-col gap-4" data-testid="notification-preferences">
        {saved && (
          <p
            role="status"
            data-testid="preferences-saved"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            Your preferences have been saved.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {PREFERENCE_KEYS.map((key) => {
            const meta = SWITCHES[key];
            const inactive = UNIMPLEMENTED_PREFERENCE_KEYS.includes(key);
            return (
              <li key={key} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id={key}
                  name={key}
                  defaultChecked={preferences[key]}
                  data-testid={`preference-${key}`}
                  className="mt-1 h-4 w-4 rounded border-line accent-brand"
                />
                <label htmlFor={key} className="text-sm">
                  <span className="font-medium text-ink">{meta.label}</span>
                  {inactive && (
                    <span className="ml-2 text-xs text-ink-muted">
                      (stored, not sent yet — digests are not implemented)
                    </span>
                  )}
                  <span className="block text-ink-muted">{meta.hint}</span>
                </label>
              </li>
            );
          })}
        </ul>

        <div>
          <Button type="submit" data-testid="save-preferences">
            Save preferences
          </Button>
        </div>
      </form>
    </Card>
  );
}
