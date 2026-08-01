// =============================================================================
// PRODUCERS — the three call sites that would put a notification on the queue.
// Owner: the email-notifications stream. Import from "@/lib/notifications".
// -----------------------------------------------------------------------------
// Shaped after src/lib/queue/producers.ts on purpose, down to the contract: kept
// in ONE file so "what can produce a notification" is answerable by reading one
// screen, forced through ./keys.ts so no key is assembled inline, and
// NON-THROWING BY CONTRACT because every one of them is called AFTER the business
// write has committed. A notification failure must never be able to fail — or
// appear to fail — an operation that already succeeded. Same argument, same shape,
// as src/lib/leaderboard/on-scoring-event.ts.
//
// -----------------------------------------------------------------------------
// !!! NOT YET WIRED: THESE THREE FUNCTIONS HAVE NO CALLERS IN src/ TODAY. !!!
//
// Stated at the top rather than buried, because a reader must not assume a feature
// is live. Every call site belongs to another stream's file, and this stream was
// given explicit instructions not to edit files it does not own — eight agents are
// working the same tree in parallel and a stranger's edit inside
// src/lib/quizzes/service.ts is how a merge loses somebody else's work. The three
// one-line additions were researched precisely and are handed to the coordinator
// rather than performed:
//
//   1. PRACTICE QUIZ SUBMITTED
//      src/lib/quizzes/service.ts, inside the existing post-commit
//      `if (outcome.ok) { … }` block (~line 547-555, beside the `notifyLeaderboard`
//      call that is already there and already swallows its own failures):
//        await notifyQuizSubmitted({ studentId, ...outcome.data });
//      Everything the input needs is already in `outcome.data` (`attemptId`,
//      `attemptNumber`, `attemptsAllowed`, `quizId`, `weekId`, `score`,
//      `totalPossible`, `percentage`, `passed`, `passingScore`). No extra read, no
//      change to the transaction, no change to the returned shape.
//
//   2. WEEKLY EXAM COMPLETED
//      src/lib/grand-quiz/service.ts, in the `finalized.outcome === "finalized"`
//      branch only (~line 544-557):
//        await notifyExamCompleted({ … from finalized.attempt and context.quiz … });
//      MUST be that branch and not the function's other two exits: the early replay
//      return (~line 458) and `already_terminal` (~line 526) both mean the attempt
//      was ALREADY closed, and notifying there would email a student a second time
//      every time the cron sweeper (/api/cron/finalize-exams) walked past their
//      finished exam. The dedupe key would catch it — that is what it is for — but
//      relying on the key to absorb a call that should not have happened wastes a
//      queue slot per sweep and hides the mistake.
//      All three finalize triggers (the student's submit, the lazy finalize on read
//      in `buildView`, and the cron sweeper) converge on that one branch, so one
//      call covers all three exactly once.
//
//   3. PENALTY ISSUED
//      src/lib/penalties/service.ts#issuePenalties, after the INSERT's
//      `.returning()` (~line 69), over the returned rows:
//        for (const row of inserted) await notifyPenaltyIssued({ … });
//      HONEST LIMITATION, because this one is not complete: `issuePenalties` is
//      only the MANUAL instructor path. "A penalty is issued" has five write sites
//      in this codebase — the other four insert into `penalties` inside their own
//      transactions (src/lib/quizzes/service.ts ~line 503,
//      src/lib/submissions/grade.ts ~line 504,
//      src/lib/submissions/deadline-penalties.ts ~line 123,
//      src/lib/instructor/admin.ts ~line 536) and three of them do not even
//      `.returning()` the ids, so there is nothing to key a notification on
//      without widening their statements. Wiring `issuePenalties` alone gives
//      notifications for instructor-issued penalties and SILENCE for
//      automatically-issued ones. That is a partial feature and is reported as
//      one; the fix is either a `.returning()` on each of the four, or an
//      `AFTER INSERT` sweep over `penalties` rows with no matching
//      `notifications.dedupe_key` — which is a scheduled job, and this stream was
//      told not to add a second scheduler.
//
// WHY THE PRODUCERS EXIST ANYWAY, rather than waiting for the wiring: they are the
// unit under test (./producers.test.ts asserts the preference gate, the recipient
// resolution and the rendered subject), and the coordinator's three edits are then
// one line each with nothing to design. Nothing here half-works — an unwired
// producer sends nothing at all, which is a state the reader can see.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { quizzes, users, weeks } from "@/db/schema";
import { MAIL_APP_NAME, appOrigin } from "@/lib/mail";
import {
  renderExamCompletedMail,
  renderPenaltyIssuedMail,
  renderQuizSubmittedMail,
} from "@/lib/mail/templates";

// peer-review stream (roadmap feature 6): the wording of its one message. A pure
// leaf module with no database and no mail imports — see its header for why the text
// lives in that stream and the producer lives here.
import { renderPeerReviewAssignedText } from "@/lib/peer-review/notify-text";

import {
  examCompletedKey,
  peerReviewAssignedKey,
  penaltyIssuedKey,
  quizSubmittedKey,
} from "./keys";
import { recordAndEnqueue } from "./record";
import { isEnabled, resolvePreferencesOrDefault } from "./preferences";
import type { NotificationType, NotifyResult } from "./types";

/** Drizzle client. A parameter so every test below runs without a database. */
type Client = typeof db;

/**
 * Human labels for `penalties.type`.
 *
 * Duplicated from nothing — the enum in src/db/schema.ts carries no labels and
 * src/lib/penalties/** renders its own in JSX. A map here rather than a
 * `snake_case → Title Case` helper so an added enum member shows up as a missing
 * key (the record is not `Partial`), not as the word "low_score" in a student's
 * inbox.
 */
const PENALTY_LABELS: Record<string, string> = {
  late_submission: "Late submission",
  quiz_failure: "Quiz failure",
  missed_deadline: "Missed deadline",
  low_score: "Low score",
};

/**
 * The student's name and address, plus whether they want this category.
 *
 * ONE ROUND TRIP FOR BOTH FACTS. src/db/index.ts measures a primary-key lookup on
 * this Neon instance at roughly 245 ms of network round trip, so two sequential
 * reads on a path that runs inside a student's submit request is ~490 ms of
 * latency for a side effect they are not waiting on. The preferences table is
 * LEFT joined — the row is absent for any student who has never opened the
 * settings page, which is nearly all of them, and an inner join would silently
 * notify nobody.
 *
 * Returns null when the user row is gone (a deleted account mid-request) or has no
 * address, which the callers turn into `no_recipient`.
 */
async function resolveRecipient(
  userId: number,
  type: NotificationType,
  client: Client,
): Promise<{ name: string | null; email: string; wanted: boolean } | null> {
  const [row] = await client
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  const email = row.email?.trim();
  if (!email) return null;

  // Read as a second statement rather than a join, because `resolvePreferencesOrDefault`
  // owns the "no row means defaults" decision AND the fail-open logging, and
  // re-implementing either inside a join is how the two answers drift apart. The
  // cost is one extra round trip on a path nobody is waiting on; the alternative is
  // two places that decide what an absent preferences row means.
  const preferences = await resolvePreferencesOrDefault(userId, client);

  return { name: row.name ?? null, email, wanted: isEnabled(preferences, type) };
}

// ---------------------------------------------------------------------------
// 1. Practice quiz submitted and auto-graded
// ---------------------------------------------------------------------------

export interface QuizSubmittedEvent {
  studentId: number;
  /** `quiz_attempts.id` — the whole idempotency scope. See ./keys.ts. */
  attemptId: number;
  quizId: number;
  weekId: number;
  attemptNumber: number;
  attemptsAllowed: number;
  score: number;
  totalPossible: number;
  /** Whole percent as the grader computed it. */
  percentage: number;
  passed: boolean;
  passingScore: number;
}

export async function notifyQuizSubmitted(
  event: QuizSubmittedEvent,
  client: Client = db,
): Promise<NotifyResult> {
  try {
    const recipient = await resolveRecipient(event.studentId, "quiz_submitted", client);
    if (!recipient) return { ok: false, reason: "no_recipient" };
    if (!recipient.wanted) return { ok: false, reason: "suppressed_by_preference" };

    const [quiz] = await client
      .select({ title: quizzes.title })
      .from(quizzes)
      .where(eq(quizzes.id, event.quizId))
      .limit(1);

    const rendered = renderQuizSubmittedMail({
      name: recipient.name,
      // A quiz deleted between the attempt and this call is not a reason to lose
      // the notification; the score and the link are still true.
      quizTitle: quiz?.title ?? "your quiz",
      attemptNumber: event.attemptNumber,
      attemptsAllowed: event.attemptsAllowed,
      score: event.score,
      totalPossible: event.totalPossible,
      percentage: event.percentage,
      passed: event.passed,
      passingScore: event.passingScore,
      // /quizzes/[weekId] is the student's quiz route (there is no /quizzes/[quizId]
      // page — verified against src/app/(app)/quizzes/[weekId]/page.tsx). A link to
      // a 404 in an email is worse than no link.
      url: `${appOrigin()}/quizzes/${event.weekId}`,
      appName: MAIL_APP_NAME,
    });

    return recordAndEnqueue(
      {
        userId: event.studentId,
        type: "quiz_submitted",
        dedupeKey: quizSubmittedKey(event.attemptId),
        recipientEmail: recipient.email,
        subject: rendered.subject,
        body: rendered.text,
        metadata: {
          quizId: event.quizId,
          attemptId: event.attemptId,
          weekId: event.weekId,
          url: `/quizzes/${event.weekId}`,
        },
        preferenceAlreadyChecked: true,
      },
      client,
    );
  } catch (error) {
    return swallow("quiz_submitted", event.studentId, error);
  }
}

// ---------------------------------------------------------------------------
// 2. Weekly exam finalized
// ---------------------------------------------------------------------------

export interface ExamCompletedEvent {
  studentId: number;
  /** The exam attempt id. Insert-once terminal row — see ./keys.ts. */
  attemptId: number;
  quizId: number;
  weekId: number;
  score: number;
  totalPossible: number;
  percentage: number;
  passed: boolean;
  passingScore: number;
  /** True when the deadline closed the attempt rather than the student. */
  autoSubmitted: boolean;
}

export async function notifyExamCompleted(
  event: ExamCompletedEvent,
  client: Client = db,
): Promise<NotifyResult> {
  try {
    const recipient = await resolveRecipient(event.studentId, "exam_completed", client);
    if (!recipient) return { ok: false, reason: "no_recipient" };
    if (!recipient.wanted) return { ok: false, reason: "suppressed_by_preference" };

    const [row] = await client
      .select({ title: quizzes.title, weekNumber: weeks.weekNumber })
      .from(quizzes)
      .leftJoin(weeks, eq(quizzes.weekId, weeks.id))
      .where(eq(quizzes.id, event.quizId))
      .limit(1);

    const rendered = renderExamCompletedMail({
      name: recipient.name,
      examTitle: row?.title ?? "your weekly exam",
      weekNumber: row?.weekNumber ?? null,
      score: event.score,
      totalPossible: event.totalPossible,
      percentage: event.percentage,
      passed: event.passed,
      passingScore: event.passingScore,
      autoSubmitted: event.autoSubmitted,
      url: `${appOrigin()}/exams/${event.weekId}`,
      appName: MAIL_APP_NAME,
    });

    return recordAndEnqueue(
      {
        userId: event.studentId,
        type: "exam_completed",
        dedupeKey: examCompletedKey(event.attemptId),
        recipientEmail: recipient.email,
        subject: rendered.subject,
        body: rendered.text,
        metadata: {
          quizId: event.quizId,
          attemptId: event.attemptId,
          weekId: event.weekId,
          url: `/exams/${event.weekId}`,
        },
        preferenceAlreadyChecked: true,
      },
      client,
    );
  } catch (error) {
    return swallow("exam_completed", event.studentId, error);
  }
}

// ---------------------------------------------------------------------------
// 3. Penalty issued
// ---------------------------------------------------------------------------

export interface PenaltyIssuedEvent {
  studentId: number;
  /** `penalties.id`. Insert-once — see ./keys.ts. */
  penaltyId: number;
  type: string;
  severity: string;
  description: string | null;
  penaltyPoints: number;
}

export async function notifyPenaltyIssued(
  event: PenaltyIssuedEvent,
  client: Client = db,
): Promise<NotifyResult> {
  try {
    const recipient = await resolveRecipient(event.studentId, "penalty_issued", client);
    if (!recipient) return { ok: false, reason: "no_recipient" };
    if (!recipient.wanted) return { ok: false, reason: "suppressed_by_preference" };

    const rendered = renderPenaltyIssuedMail({
      name: recipient.name,
      penaltyLabel: PENALTY_LABELS[event.type] ?? "penalty",
      severity: event.severity,
      description: event.description,
      penaltyPoints: event.penaltyPoints,
      // THE LINK GOES TO /dashboard, NOT to the path the penalties stream
      // revalidates. src/lib/penalties/actions.ts calls
      // `revalidatePath("/me/notices")`, and that page does not exist anywhere
      // under src/app — an existing defect in another stream's file, not something
      // to reproduce in an email. The dashboard is the page that actually renders a
      // student's standing.
      url: `${appOrigin()}/dashboard`,
      appName: MAIL_APP_NAME,
    });

    return recordAndEnqueue(
      {
        userId: event.studentId,
        type: "penalty_issued",
        dedupeKey: penaltyIssuedKey(event.penaltyId),
        recipientEmail: recipient.email,
        subject: rendered.subject,
        body: rendered.text,
        metadata: { penaltyId: event.penaltyId, url: "/dashboard" },
        preferenceAlreadyChecked: true,
      },
      client,
    );
  } catch (error) {
    return swallow("penalty_issued", event.studentId, error);
  }
}

// ---------------------------------------------------------------------------
// 4. Peer reviews assigned  (peer-review stream, roadmap feature 6)
// ---------------------------------------------------------------------------

export interface PeerReviewAssignedEvent {
  /** The REVIEWER. They are the one being told they have work to do. */
  reviewerId: number;
  /**
   * The lowest of the allocation ids this reconcile created for this reviewer.
   * `peer_review_allocations` rows are insert-once, so it identifies the event
   * forever — see ./keys.ts#peerReviewAssignedKey for why the round id will not do.
   */
  allocationId: number;
  /** How many reviews were newly assigned. Never 0: the caller does not notify then. */
  count: number;
  assignmentTitle: string;
  weekNumber: number;
  /** The round's `review_due_at`. */
  dueAt: Date;
}

/**
 * Tell a reviewer they have peer reviews to write.
 *
 * Same shape as the three producers above: resolve the recipient and their
 * preference in one place, render, then `recordAndEnqueue` with a key from ./keys.ts.
 * Non-throwing by contract, like every producer in this file — allocation is already
 * committed by the time this is called, and a mail problem must not roll it back.
 *
 * NO OTHER STUDENT IS NAMED in the message. See the header of
 * src/lib/peer-review/notify-text.ts: an email that named the author would defeat
 * the blinding permanently, because mail cannot be un-sent.
 */
export async function notifyPeerReviewAssigned(
  event: PeerReviewAssignedEvent,
  client: Client = db,
): Promise<NotifyResult> {
  try {
    if (!Number.isInteger(event.count) || event.count <= 0) {
      // Nothing was assigned, so there is nothing to say. Reported as a skip rather
      // than sending "you have 0 reviews".
      return { ok: false, reason: "duplicate" };
    }

    const recipient = await resolveRecipient(event.reviewerId, "course_message", client);
    if (!recipient) return { ok: false, reason: "no_recipient" };
    if (!recipient.wanted) return { ok: false, reason: "suppressed_by_preference" };

    const rendered = renderPeerReviewAssignedText({
      name: recipient.name,
      assignmentTitle: event.assignmentTitle,
      weekNumber: event.weekNumber,
      count: event.count,
      dueAt: event.dueAt,
      // /peer-review is the reviewer's task list (src/app/(app)/peer-review/(index)).
      // Verified against the router rather than assumed, for the reason the
      // quiz producer above records: a link to a 404 in an email is worse than none.
      url: `${appOrigin()}/peer-review`,
      appName: MAIL_APP_NAME,
    });

    return recordAndEnqueue(
      {
        userId: event.reviewerId,
        type: "course_message",
        dedupeKey: peerReviewAssignedKey(event.allocationId),
        recipientEmail: recipient.email,
        subject: rendered.subject,
        body: rendered.text,
        // `NotificationMetadata` has no peer-review id field and is not widened for
        // one: every field in it is optional and the history page renders only `url`.
        metadata: { url: "/peer-review" },
        preferenceAlreadyChecked: true,
      },
      client,
    );
  } catch (error) {
    return swallow("course_message", event.reviewerId, error);
  }
}

/**
 * The non-throwing contract, in one place.
 *
 * Swallowed ON PURPOSE — see the file header. The quiz attempt, the exam result or
 * the penalty is already committed and the student has already been shown it; a
 * notification failure here means one missing email, which is recoverable, and must
 * not become a 500 on a request whose work is done.
 */
function swallow(type: NotificationType, studentId: number, error: unknown): NotifyResult {
  console.error(
    `[notifications] failed to produce a ${type} notification for student ${studentId}. ` +
      `The underlying event IS saved; the student will not be emailed about it.`,
    error,
  );
  return { ok: false, reason: "record_failed" };
}
