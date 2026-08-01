// =============================================================================
// NOTIFICATION SERVER ACTIONS — preferences save, and "mark all read".
// Owner: the email-notifications stream.
// -----------------------------------------------------------------------------
// A SERVER ACTION IS A PUBLIC POST TARGET. Next.js exposes it at a generated
// endpoint that anybody can call with a hand-built body; being reachable only from
// a page that called `requireUser()` proves nothing about the caller. So each
// action re-guards itself and takes the user id FROM THE SESSION. Neither action
// accepts a user id in its arguments, which is the reason neither can be pointed at
// another student's preferences or another student's notifications — the same
// argument, and the same shape, as src/app/(app)/settings/actions.ts.
//
// WHY THESE LIVE UNDER src/lib AND NOT NEXT TO THE PAGE. src/app/**/actions.ts is
// the convention for the account stream, but this stream owns
// src/lib/notifications/** and does not own the routing tree; keeping the actions
// here means the page file is a thin render and the coordinator can move or wrap
// the route without touching logic. src/lib/penalties/actions.ts and
// src/lib/attendance/actions.ts already do exactly this.
//
// Both actions end by revalidating the page rather than redirecting, because there
// is nothing to redirect TO: the student stays on /notifications and expects to see
// the change. `revalidatePath` is required — the page is `force-dynamic`, but the
// client router caches the RSC payload for a moment and without this the checkbox
// state can visibly bounce back to its previous value.
// =============================================================================

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/guard";

import { markAllRead } from "./history";
import { preferencesFromFormData, savePreferences } from "./preferences";

// NOT exported, and it cannot be: a "use server" module may only export async
// functions, because every export becomes a callable server-action endpoint and a
// string has no call signature. `next build` rejects it — "Only async functions are
// allowed to be exported in a 'use server' file" — and `tsc` does NOT, which is why
// this survived a clean typecheck and only surfaced at the production build.
//
// Nothing outside this file referenced it, so dropping the keyword is the whole
// fix. If another module ever needs the path, it belongs in a plain module rather
// than being re-exported from here.
const NOTIFICATIONS_PATH = "/notifications";

/**
 * Save every switch on the preferences form.
 *
 * The form submits ALL checkboxes, and `preferencesFromFormData` reads an absent
 * field as false — which is what an unchecked HTML checkbox is (it sends nothing at
 * all). The consequence is stated on that helper: a hand-built POST omitting a
 * field turns that switch off, and since the id comes from the session, the only
 * account a forged body can affect is the caller's own.
 *
 * NOTHING IS RETURNED. A `useActionState`-style result would need a client
 * component; the page instead reads the saved row back on the revalidated render,
 * so what the student sees after a save is the DATABASE's answer rather than the
 * form's optimistic guess.
 */
export async function saveNotificationPreferencesAction(formData: FormData): Promise<void> {
  const user = await requireUser(NOTIFICATIONS_PATH);
  await savePreferences(user.id, preferencesFromFormData(formData));
  revalidatePath(NOTIFICATIONS_PATH);
  // `?saved=1` is the confirmation, and it is a REDIRECT rather than returned state
  // so the page stays a server component (see this file's header). `redirect()`
  // signals by THROWING — it must never be wrapped in a try/catch, the same warning
  // src/app/(app)/settings/actions.ts carries. No free text travels in the URL; a
  // closed flag only.
  redirect(`${NOTIFICATIONS_PATH}?saved=1`);
}

/** Mark every unread notification of the SIGNED-IN student as read. */
export async function markNotificationsReadAction(): Promise<void> {
  const user = await requireUser(NOTIFICATIONS_PATH);
  await markAllRead(user.id);
  revalidatePath(NOTIFICATIONS_PATH);
}
