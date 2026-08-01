// =============================================================================
// PER-STUDENT NOTIFICATION PREFERENCES — read, resolve, save.
// Owner: the email-notifications stream. Import from "@/lib/notifications".
// -----------------------------------------------------------------------------
// THE ABSENT ROW IS THE COMMON CASE, not an edge case, and the whole shape of this
// module follows from that. Nothing creates a `notification_preferences` row when
// a student registers (src/lib/register.ts writes `users` only), so on a fresh
// cohort EVERY student's preferences are "no row at all". A design that read the
// row and required it would either 500 on every notification or need a
// create-on-registration migration path for existing accounts.
//
// So: `resolvePreferences` returns DEFAULTS when the row is missing, and
// `savePreferences` is an UPSERT. The defaults live here AND as column defaults in
// src/db/schema.notifications.ts, which is a deliberate duplication argued in that
// file: the code default serves the students with no row, the column default
// serves an INSERT that names only some columns.
//
// WHY THE FAILURE DIRECTION IS "SEND" AND NOT "STAY SILENT" — the one genuinely
// contestable decision in this file, so it is argued rather than stated.
// `isEnabled` treats an UNREADABLE preferences row as opted IN (see
// `resolvePreferencesOrDefault`). Both directions are wrong in some way:
//
//   * fail-closed (treat a database error as opted out) means one Neon hiccup
//     silently drops a notification that the student wanted, and NOTHING records
//     that it happened — the row is never written, so it is not in the history and
//     not on the dead-letter list. It is indistinguishable from working correctly.
//   * fail-open (this choice) means a student who opted OUT may receive one
//     message they asked not to get, during a database failure, and can see it
//     and complain.
//
// The second is visible and the first is not, and visibility is the tie-breaker
// this codebase already uses for the queue's `dead` state. It is NOT a licence to
// ignore preferences generally: the preference read is on the producer's happy
// path and is exercised by every notification, so a persistent failure here is a
// broken database, not a quiet opt-out policy.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  notificationPreferences,
  type NotificationPreferenceRow,
} from "@/db/schema.notifications";

import { PREFERENCE_COLUMN_FOR_TYPE, type NotificationType } from "./types";

/** Drizzle client or transaction. Mirrors src/lib/queue/store.ts#Db. */
type Client = typeof db;

/**
 * What a student gets when they have never touched the settings page.
 *
 * Every event category ON. The feature is credited with a 15-25% increase in
 * on-time submissions (LMS_ENHANCEMENT_INDEX.md:33) and that number is only
 * available if the mail reaches people; an opt-IN default would deliver it to the
 * students who go looking for a settings page, which is not the population that
 * needs a nudge. Digest defaults follow the roadmap's own sketch (daily off,
 * weekly on) — and neither is honoured by any code yet, which the settings UI says
 * out loud rather than implying with a live-looking switch. See the TODO on those
 * columns in src/db/schema.notifications.ts.
 */
export const PREFERENCE_DEFAULTS = {
  quizSubmitted: true,
  examCompleted: true,
  assignmentFeedback: true,
  penaltyIssued: true,
  forumReply: true,
  badgeEarned: true,
  gradePosted: true,
  courseMessage: true,
  digestDaily: false,
  digestWeekly: true,
} as const;

/** The editable surface: exactly the boolean columns, and nothing else. */
export type NotificationPreferences = { -readonly [K in keyof typeof PREFERENCE_DEFAULTS]: boolean };

/** The switch keys, in the order the settings UI renders them. */
export const PREFERENCE_KEYS = Object.keys(PREFERENCE_DEFAULTS) as Array<
  keyof NotificationPreferences
>;

/** The two keys that are stored but not yet acted on. Rendered with a caveat. */
export const UNIMPLEMENTED_PREFERENCE_KEYS: ReadonlyArray<keyof NotificationPreferences> = [
  "digestDaily",
  "digestWeekly",
];

function fromRow(row: NotificationPreferenceRow): NotificationPreferences {
  // Named field by field rather than spread-and-strip, so a column added to the
  // table cannot leak into a value the settings form round-trips back into an
  // UPDATE. `id`, `userId` and the timestamps must never be writable from a form.
  return {
    quizSubmitted: row.quizSubmitted,
    examCompleted: row.examCompleted,
    assignmentFeedback: row.assignmentFeedback,
    penaltyIssued: row.penaltyIssued,
    forumReply: row.forumReply,
    badgeEarned: row.badgeEarned,
    gradePosted: row.gradePosted,
    courseMessage: row.courseMessage,
    digestDaily: row.digestDaily,
    digestWeekly: row.digestWeekly,
  };
}

/**
 * This student's preferences, or the defaults when they have no row.
 *
 * THROWS on a database failure, deliberately: the callers that must not fail —
 * the producers — go through `resolvePreferencesOrDefault` below, which makes the
 * fail-open decision explicitly and logs it. A page that renders the settings form
 * SHOULD fail loudly rather than show a student defaults that are not what is
 * stored, because they would then save those defaults over their real choices.
 */
export async function resolvePreferences(
  userId: number,
  client: Client = db,
): Promise<NotificationPreferences> {
  const [row] = await client
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  return row ? fromRow(row) : { ...PREFERENCE_DEFAULTS };
}

/**
 * As above, but a read failure yields the defaults and one error line.
 *
 * The fail-open argument is in the file header. The log is not decoration: it is
 * the only trace that a student's stored opt-out was not consulted.
 */
export async function resolvePreferencesOrDefault(
  userId: number,
  client: Client = db,
): Promise<NotificationPreferences> {
  try {
    return await resolvePreferences(userId, client);
  } catch (error) {
    console.error(
      `[notifications] could not read notification preferences for user ${userId}; ` +
        `treating every category as ENABLED for this send. A stored opt-out may be ` +
        `ignored once. See src/lib/notifications/preferences.ts for why the failure ` +
        `direction is 'send' rather than 'stay silent'.`,
      error,
    );
    return { ...PREFERENCE_DEFAULTS };
  }
}

/**
 * Does this student want to be emailed about `type`?
 *
 * The type -> column mapping is the exhaustive `Record<NotificationType, …>` in
 * ./types.ts, so a new enum label cannot reach this function without a decision
 * having been made about which switch governs it.
 */
export function isEnabled(
  preferences: NotificationPreferences,
  type: NotificationType,
): boolean {
  return preferences[PREFERENCE_COLUMN_FOR_TYPE[type]];
}

/** Convenience for producers: one read, one answer. */
export async function isEnabledFor(
  userId: number,
  type: NotificationType,
  client: Client = db,
): Promise<boolean> {
  return isEnabled(await resolvePreferencesOrDefault(userId, client), type);
}

/**
 * Write this student's preferences.
 *
 * ONE STATEMENT: `INSERT ... ON CONFLICT (user_id) DO UPDATE`, not
 * "select, then insert or update". Two tabs of the same student saving at the same
 * instant both find no row under READ COMMITTED and both INSERT; only
 * `notification_preferences_user_idx` can decide which one wins, and DO UPDATE
 * turns the loser into an update instead of a 23505 the caller has to interpret.
 * Exactly the argument src/lib/queue/keys.ts makes for the jobs index, applied to
 * a much less exciting table.
 *
 * The caller passes the FULL set of switches — the settings form submits every
 * checkbox — so there is no partial-update path and therefore no way for a
 * concurrent save to interleave two halves of two different intents.
 */
export async function savePreferences(
  userId: number,
  values: NotificationPreferences,
  client: Client = db,
): Promise<NotificationPreferences> {
  const [row] = await client
    .insert(notificationPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  // `returning()` on an upsert always yields the row; the fallback exists so a
  // caller never has to handle `undefined` for a case that cannot happen.
  return row ? fromRow(row) : { ...values };
}

/**
 * Read a settings form submission into a full preference set.
 *
 * AN UNCHECKED HTML CHECKBOX SENDS NOTHING AT ALL — it is absent from the
 * FormData, not present-and-false. So "absent means false" is the correct reading
 * here and it is the reason this helper exists instead of a per-field
 * `formData.get(...) === "on"` at the call site: a form that grew a field and
 * forgot to read it would silently reset that switch to false on every save. The
 * key list is derived from `PREFERENCE_DEFAULTS`, so the form and the parser
 * cannot disagree about which switches exist.
 *
 * This does mean a HAND-BUILT POST that omits a field turns that switch off. That
 * is acceptable and is the standard behaviour of a checkbox form; the action that
 * calls this takes the user id from the session (never from the body), so the
 * worst a forged body can do is change the caller's own preferences.
 */
export function preferencesFromFormData(form: {
  get(name: string): unknown;
}): NotificationPreferences {
  const out = {} as NotificationPreferences;
  for (const key of PREFERENCE_KEYS) {
    const raw = form.get(key);
    out[key] = raw === "on" || raw === "true" || raw === "1";
  }
  return out;
}
