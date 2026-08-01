// =============================================================================
// LIVE-CLASS MAIL — the three messages the live-classes feature owes students.
// Owner: the real-time stream.
// -----------------------------------------------------------------------------
// !!! NOT YET WIRED. THESE RENDERERS HAVE NO CALLERS IN src/ TODAY, AND THE
// !!! PRODUCER BELOW CANNOT ENQUEUE UNTIL THREE ONE-LINE CHANGES ARE MADE IN
// !!! FILES THIS STREAM DOES NOT OWN. They are named exactly, at the bottom of
// !!! this header, and handed to the coordinator rather than performed —
// !!! src/lib/notifications/producers.ts sets the precedent and states the
// !!! reason: several agents are working this tree in parallel and a stranger's
// !!! edit inside another stream's file is how a merge loses somebody's work.
//
// WHAT WAS ASKED FOR AND WHAT WAS BUILT — the Bull question, answered.
// The brief says "use nodemailer or SendGrid" and "queue with Bull or similar".
//   * NOT SendGrid. src/lib/mail/ already exists, already chooses between an SMTP
//     transport and a dev transport, already never throws, and already carries
//     the deduplication ledger (src/lib/mail/dispatch.ts). A second mail path
//     would mean two places that can send, one of which nobody deduplicates.
//   * NOT Bull. Bull is Redis-backed and THERE IS NO REDIS IN THIS STACK
//     (FREE_STACK.md). Adding one for three emails a week would be the single
//     largest piece of infrastructure in the project. src/lib/queue/ already
//     exists, is Postgres-backed, is idempotent through a unique index on
//     `jobs.idempotency_key`, retries with bounded backoff and dead-letters —
//     which is the whole of what Bull would have been imported for.
//
// THE "15 MINUTES BEFORE" TRIGGER — stated honestly rather than assumed.
// A reminder job is enqueued with `run_after = startsAt - 15 min`. NOTHING FIRES
// IT BY ITSELF: this queue is drained by a request-time `after()` hook and by
// .github/workflows/drain-jobs.yml, which runs on a 5-minute GitHub Actions cron.
// That workflow ALREADY EXISTS, so no new infrastructure is needed — but two
// consequences must be written down rather than discovered:
//   1. GitHub's scheduled workflows are BEST EFFORT and are routinely late under
//      load; a "15 minutes before" reminder will in practice arrive between 15
//      and about 10 minutes before, and occasionally later.
//   2. If the workflow is disabled (GitHub disables schedules on repositories
//      with 60 days of no activity) the reminder does not send at all. That is a
//      DEPLOYMENT PREREQUISITE and it is listed as one in
//      DEPLOYMENT_LIVE_CLASSES.md, not glossed as "the queue handles it".
// Vercel's three cron slots are spent (vercel.json) and are hourly or daily
// anyway, so they cannot serve a 15-minute reminder even if a slot were free.
//
// ESCAPING follows src/lib/mail/templates.ts exactly: `escapeHtml` for markup,
// CR/LF stripped before anything reaches a subject header, because a class title
// is staff free text and an embedded newline in a header is header injection.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import type { RenderedMail } from "@/lib/mail";

/** Local copies of the two helpers in src/lib/mail/templates.ts, which are private there. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** How far ahead of a class the reminder is scheduled. */
export const CLASS_REMINDER_LEAD_MS = 900_000;

/**
 * Format a class start time for a human.
 *
 * THE TIME ZONE IS NAMED IN THE STRING, always. A cohort spread across time
 * zones reading "starts at 18:00" has no way to know whose 18:00, and the
 * failure mode is a student joining an hour late with no idea why. `timeZone` is
 * a required input rather than defaulting to the server's, because a Vercel
 * function's local zone is UTC and would silently be presented as the cohort's.
 */
export function formatClassTime(startsAt: Date, timeZone: string): string {
  // Explicit components rather than `dateStyle`/`timeStyle`: Intl THROWS
  // ("Invalid option") when either shortcut is combined with `timeZoneName`, and
  // the zone name is the whole point of this function.
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).format(startsAt);
}

export interface ClassMailInput {
  /** Recipient's display name, or null when unknown. */
  name: string | null;
  /** STAFF-AUTHORED. Escaped for HTML, newline-stripped for the subject. */
  classTitle: string;
  startsAt: Date;
  /** IANA zone, e.g. "Asia/Karachi". Required — see formatClassTime. */
  timeZone: string;
  /** Absolute URL to the class room. Built from appOrigin(), never from a Host header. */
  url: string;
  appName: string;
}

/**
 * "A live class has been scheduled."
 *
 * States the time FIRST and the joining link second. A student reading this on a
 * phone notification preview should get the one fact they need to act on — when —
 * without opening it.
 */
export function renderClassScheduledMail(input: ClassMailInput): RenderedMail {
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const title = headerSafe(input.classTitle);
  const when = formatClassTime(input.startsAt, input.timeZone);

  const subject = `Live class scheduled: ${title}`;

  const text = [
    greeting,
    "",
    `A live class has been scheduled: "${title}".`,
    "",
    `When: ${when}`,
    "",
    "Join here when it starts:",
    input.url,
    "",
    "You will get a reminder shortly before it begins.",
    "",
    `— ${input.appName}`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>A live class has been scheduled: <strong>${escapeHtml(input.classTitle)}</strong>.</p>`,
    `<p>When: <strong>${escapeHtml(when)}</strong></p>`,
    `<p><a href="${escapeHtml(input.url)}">Join the class</a></p>`,
    `<p style="word-break:break-all">${escapeHtml(input.url)}</p>`,
    `<p>You will get a reminder shortly before it begins.</p>`,
    `<p>— ${escapeHtml(input.appName)}</p>`,
  ].join("\n");

  return { subject, text, html };
}

/**
 * "Your class starts in about 15 minutes."
 *
 * "ABOUT" IS DELIBERATE AND IS NOT HEDGING FOR ITS OWN SAKE. The drain that
 * sends this is a 5-minute GitHub Actions cron that is best-effort (see the file
 * header), so the message genuinely may arrive 10 or 12 minutes ahead. Writing
 * "in 15 minutes" would make the mail state something false and would train
 * students to distrust the timing. The exact start time is given underneath, and
 * that one IS exact.
 */
export function renderClassStartingSoonMail(input: ClassMailInput): RenderedMail {
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const title = headerSafe(input.classTitle);
  const when = formatClassTime(input.startsAt, input.timeZone);

  const subject = `Starting soon: ${title}`;

  const text = [
    greeting,
    "",
    `"${title}" starts in about 15 minutes.`,
    "",
    `Start time: ${when}`,
    "",
    "Join here:",
    input.url,
    "",
    `— ${input.appName}`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p><strong>${escapeHtml(input.classTitle)}</strong> starts in about 15 minutes.</p>`,
    `<p>Start time: ${escapeHtml(when)}</p>`,
    `<p><a href="${escapeHtml(input.url)}">Join the class</a></p>`,
    `<p style="word-break:break-all">${escapeHtml(input.url)}</p>`,
    `<p>— ${escapeHtml(input.appName)}</p>`,
  ].join("\n");

  return { subject, text, html };
}

export interface RecordingMailInput {
  name: string | null;
  classTitle: string;
  /** Absolute URL to the recording. */
  url: string;
  appName: string;
  /**
   * When the recording stops being available, if it does.
   *
   * Stated in the mail when known, because the recording lives on whatever host
   * the instructor uploaded it to and several of the free options in
   * FREE_STACK.md expire. A student who assumes permanence and finds a dead link
   * in week nine has been misled by omission.
   */
  availableUntil?: Date | null;
}

export function renderRecordingAvailableMail(input: RecordingMailInput): RenderedMail {
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const title = headerSafe(input.classTitle);

  const subject = `Recording available: ${title}`;

  const expiry = input.availableUntil
    ? `This recording is available until ${input.availableUntil.toISOString().slice(0, 10)}.`
    : null;

  const text = [
    greeting,
    "",
    `The recording of "${title}" is now available.`,
    "",
    "Watch it here:",
    input.url,
    ...(expiry ? ["", expiry] : []),
    "",
    `— ${input.appName}`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>The recording of <strong>${escapeHtml(input.classTitle)}</strong> is now available.</p>`,
    `<p><a href="${escapeHtml(input.url)}">Watch the recording</a></p>`,
    `<p style="word-break:break-all">${escapeHtml(input.url)}</p>`,
    ...(expiry ? [`<p>${escapeHtml(expiry)}</p>`] : []),
    `<p>— ${escapeHtml(input.appName)}</p>`,
  ].join("\n");

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// The queue contract — what the coordinator must add for any of this to send.
// ---------------------------------------------------------------------------

/** The three live-class messages. One string per message, used to build the key. */
export const LIVE_CLASS_MAIL_KINDS = ["scheduled", "starting_soon", "recording"] as const;
export type LiveClassMailKind = (typeof LIVE_CLASS_MAIL_KINDS)[number];

/**
 * Payload for the proposed `live_class_email` job kind.
 *
 * A POINTER, not a rendered body — the same argument
 * src/lib/queue/handlers/notification-email.ts makes: a 2 kB body in `jobs.payload`
 * makes the queue table the largest in the database, and a stored copy of the text
 * can disagree with what was sent. The handler re-reads the class and renders at
 * send time, which also means a class rescheduled after the reminder was enqueued
 * sends the CORRECTED time.
 */
export interface LiveClassEmailPayload {
  kind: LiveClassMailKind;
  classId: number;
  recipientId: number;
}

/**
 * The idempotency key for one live-class message to one student.
 *
 * SCOPED TO (kind, class, recipient) AND NOT TO THE ENQUEUE TIME. An instructor
 * who edits a class three times must not send three "class scheduled" emails to
 * every student; the second and third enqueues collide with the unique index on
 * `jobs.idempotency_key` and produce nothing, which is the correct outcome.
 *
 * THE DELIBERATE CONSEQUENCE: rescheduling a class does NOT re-notify. That is
 * the right default (a reschedule is usually a five-minute correction, not a new
 * class) and it is the wrong behaviour for a class moved to a different day. The
 * fix, when somebody wants it, is to add the start timestamp to the key for the
 * `scheduled` kind only — exactly as `gradedNotificationKey` includes `graded_at`
 * so a genuine regrade notifies again. Not done here because it needs a product
 * decision about what counts as a reschedule.
 */
export function liveClassMailKey(input: LiveClassEmailPayload): string {
  return `live_class_email:${input.kind}:${input.classId}:${input.recipientId}`;
}

/**
 * When the reminder job becomes eligible to run.
 *
 * Clamped to "not in the past": a class scheduled ten minutes from now would
 * otherwise get a `run_after` in the past, which is harmless (the drain picks it
 * up at once) but reads in the jobs table as a backlog rather than as intent.
 */
export function reminderRunAfter(startsAt: Date, now: Date = new Date()): Date {
  const target = startsAt.getTime() - CLASS_REMINDER_LEAD_MS;
  return new Date(Math.max(target, now.getTime()));
}

/**
 * THE THREE CHANGES REQUIRED, in files this stream does not own. Researched
 * precisely so they can be applied without re-deriving them:
 *
 *   1. src/lib/queue/types.ts — add `"live_class_email"` to `JOB_KINDS`.
 *      One array member. `Record<JobKind, JobHandler>` then forces step 2 at
 *      compile time, which is the property that registry deliberately has.
 *
 *   2. src/lib/queue/registry.ts — add
 *        live_class_email: handleLiveClassEmail,
 *      importing a handler that: reads the class and the recipient, re-checks the
 *      recipient's notification preference (the window between enqueue and drain
 *      is real — up to a whole cron interval), picks the renderer above by
 *      `payload.kind`, and sends through `sendDeduplicated` from
 *      src/lib/mail/dispatch.ts keyed on the job's own idempotency key. That is
 *      the same shape as handleNotificationEmail and should be written by
 *      whoever owns src/lib/queue/**.
 *
 *   3. The live-classes API stream — call a producer after the create/update
 *      transaction commits, enqueuing one `scheduled` job and one
 *      `starting_soon` job (with `runAfter` from `reminderRunAfter`) per enrolled
 *      student, and one `recording` job when a recording URL is attached.
 *      Non-throwing, after the commit, exactly like `enqueueGradedNotification`.
 *
 * Until all three land, nothing here sends anything, and DEPLOYMENT_LIVE_CLASSES.md
 * says so rather than promising mail that cannot leave.
 */
export const LIVE_CLASS_MAIL_WIRING_TODO =
  "live_class_email is not registered in src/lib/queue. See the block comment above this constant.";
