"use server";

// =============================================================================
// REALTIME-QUIZ SERVER ACTION — the one public POST target this stream exposes.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// The frozen `ROUTES` map has no realtime-quiz endpoint and this stream owns no
// path under src/app/api/**, so the inline component reaches the server through a
// server action instead of fetch(). A server action IS a public POST target: it
// gets its own guard here, because the fact that a server component chose to
// render the button says nothing about who is calling the action.
//
// `requireUser` — not `requireRole("student")`. Signing in is the only condition:
// staff previewing a lecture must be able to try the check too, and `"student"`
// in `ROLES_SATISFYING` already means "signed in" rather than "role === student"
// (see src/lib/guard.ts). Anonymous callers are redirected, so a scraper cannot
// walk question ids to build an answer key without an account.
//
// NOT re-exported from ./index.ts on purpose: this file is server-only, and a
// client component importing the barrel would drag it into the browser graph.
// =============================================================================

import { requireUser } from "@/lib/guard";

import { checkInlineAnswer, type CheckAnswerOutcome } from "./service";

/**
 * Reveal the outcome of one committed answer to an inline knowledge check.
 *
 * Returns a value in every case, including refusals: this runs while the student
 * is mid-lecture, and a thrown server action surfaces as an unrecoverable client
 * error over the top of the page they were reading.
 *
 * Writes nothing. No `revalidatePath` either — there is no persisted state for a
 * realtime check, so there is no cache entry that could go stale.
 */
export async function checkInlineAnswerAction(input: {
  questionId: number;
  selectedOptionId: number;
}): Promise<CheckAnswerOutcome> {
  await requireUser();

  return checkInlineAnswer({
    questionId: Number(input?.questionId),
    selectedOptionId: Number(input?.selectedOptionId),
  });
}
