// =============================================================================
// MAIL TEMPLATES — owned by the `account` stream.
// -----------------------------------------------------------------------------
// Plain functions, no template engine: two messages do not justify a dependency,
// and a pure function is directly unit-testable.
//
// The reset message deliberately states the validity window and says that an
// unrequested mail can be ignored — a reset mail an attacker triggered for
// somebody else's address must not read as an alarm the recipient has to act on.
//
// HTML ESCAPING: only the app name and the URL are interpolated, and the URL is
// built from `appOrigin()` plus a hex token, so no user-supplied string reaches
// the markup. The escape helper is applied anyway, because that invariant is one
// careless edit away from being false.
// =============================================================================

// tokens.ts is deliberately pure (no database import), so pulling the TTL from
// it here does not drag the query layer into a template render.
import { PASSWORD_RESET_TTL_MS } from "@/lib/account/tokens";

/** Minimal HTML-attribute/body escaping for interpolated values. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ResetMailInput {
  /** The recipient's display name, or null when unknown. */
  name: string | null;
  /** Absolute reset URL, token included. */
  url: string;
  /** Product name shown in the subject and body. */
  appName: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function renderPasswordResetMail(input: ResetMailInput): RenderedMail {
  const minutes = Math.round(PASSWORD_RESET_TTL_MS / 60_000);
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";

  const subject = `Reset your ${input.appName} password`;

  const text = [
    greeting,
    "",
    `Someone asked to reset the password for your ${input.appName} account.`,
    "Open the link below to choose a new one:",
    "",
    input.url,
    "",
    `The link is valid for ${minutes} minutes and can be used once.`,
    "If you did not ask for this, no action is needed — your password has not changed.",
    "",
    `— ${input.appName}`,
  ].join("\n");

  const safeUrl = escapeHtml(input.url);
  const safeApp = escapeHtml(input.appName);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Someone asked to reset the password for your ${safeApp} account.</p>`,
    `<p><a href="${safeUrl}">Choose a new password</a></p>`,
    `<p style="word-break:break-all">${safeUrl}</p>`,
    `<p>The link is valid for ${minutes} minutes and can be used once. ` +
      `If you did not ask for this, no action is needed — your password has not changed.</p>`,
    `<p>— ${safeApp}</p>`,
  ].join("\n");

  return { subject, text, html };
}

// =============================================================================
// GRADED-SUBMISSION NOTIFICATION — added by the async-queues stream.
// -----------------------------------------------------------------------------
// Rendered by the queue's `submission_graded_email` handler
// (src/lib/queue/handlers/submission-graded-email.ts), never sent inline from a
// request: an SMTP send is bounded by three 10-second timeouts (SMTP_TIMEOUT_MS
// above in ./smtp.ts) and an instructor pressing Save must not wait on a mail
// relay for a side effect they are not watching.
//
// WHY THE FEEDBACK TEXT IS ESCAPED AND THE PLAIN-TEXT PART IS NOT TRUSTED EITHER.
// Unlike the reset mail — whose only interpolated values are a config string and
// a hex token — this template renders TWO instructor-authored strings: the
// written feedback (up to 4000 characters per `gradeSubmissionSchema`) and the
// assignment title. Those are the first genuinely untrusted values to reach mail
// markup in this app. `escapeHtml` is therefore load bearing here rather than
// defensive, and the feedback is additionally length-capped: a 4000-character
// body is legitimate in the app's UI and is spam-filter bait in an email.
// =============================================================================

/**
 * How much instructor feedback is quoted in the email before it is elided.
 *
 * The email is a NOTIFICATION, not a delivery mechanism for the grade record —
 * the link is. Quoting the opening of the feedback tells the student whether it
 * is worth opening now; quoting all 4 kB of it makes the message long, makes it
 * look machine-generated to a spam filter, and duplicates a source of truth that
 * can still be edited by the instructor afterwards.
 */
export const FEEDBACK_PREVIEW_CHARS = 400;

export interface GradedMailInput {
  /** The student's display name, or null when unknown. */
  name: string | null;
  /** Assignment title. INSTRUCTOR-AUTHORED — escaped before it reaches HTML. */
  assignmentTitle: string;
  /** Star rating actually recorded, 1..5. */
  stars: number;
  /** Points recorded on the submission. */
  score: number;
  /** Maximum points the assignment is out of, so the score is readable alone. */
  maxScore: number;
  /** Instructor's written feedback, or null. INSTRUCTOR-AUTHORED. */
  feedback: string | null;
  /** Absolute URL to the student's view of this week's assignment. */
  url: string;
  appName: string;
}

/** Truncate on a character budget, appending an ellipsis when anything was cut. */
export function previewFeedback(
  feedback: string | null,
  limit = FEEDBACK_PREVIEW_CHARS,
): string | null {
  if (!feedback) return null;
  const trimmed = feedback.trim();
  if (!trimmed) return null;
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1)}…`;
}

export function renderSubmissionGradedMail(input: GradedMailInput): RenderedMail {
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const preview = previewFeedback(input.feedback);

  // The title is in the SUBJECT, where HTML escaping does not apply — a subject
  // header is not markup. Newlines are stripped instead, because an embedded
  // CR/LF in a header value is a header-injection vector and an instructor can
  // paste one into an assignment title.
  const safeSubjectTitle = input.assignmentTitle.replace(/[\r\n]+/g, " ").trim();
  const subject = `Your ${safeSubjectTitle} submission has been graded`;

  const text = [
    greeting,
    "",
    `Your submission for "${safeSubjectTitle}" has been graded.`,
    "",
    `Score:  ${input.score} / ${input.maxScore}`,
    `Rating: ${"★".repeat(input.stars)}${"☆".repeat(Math.max(0, 5 - input.stars))} (${input.stars}/5)`,
    ...(preview ? ["", "Instructor feedback:", preview] : []),
    "",
    "See the full feedback here:",
    input.url,
    "",
    `— ${input.appName}`,
  ].join("\n");

  const safeTitle = escapeHtml(input.assignmentTitle);
  const safeUrl = escapeHtml(input.url);
  const safeApp = escapeHtml(input.appName);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your submission for <strong>${safeTitle}</strong> has been graded.</p>`,
    `<p>Score: <strong>${input.score} / ${input.maxScore}</strong><br>` +
      `Rating: ${input.stars}/5</p>`,
    ...(preview
      ? [`<blockquote style="margin:0 0 1em;padding-left:1em;border-left:3px solid #ccc">${escapeHtml(preview)}</blockquote>`]
      : []),
    `<p><a href="${safeUrl}">See the full feedback</a></p>`,
    `<p style="word-break:break-all">${safeUrl}</p>`,
    `<p>— ${safeApp}</p>`,
  ].join("\n");

  return { subject, text, html };
}

// =============================================================================
// EVENT NOTIFICATIONS — added by the email-notifications stream (roadmap PHASE 1
// feature 1). Rendered at RECORD time by src/lib/notifications/producers.ts and
// sent by the queue's `notification_email` handler; never inline in a request.
// -----------------------------------------------------------------------------
// WHY THESE THREE ARE RENDERED BY THE PRODUCER WHEN THE GRADED-SUBMISSION MAIL
// ABOVE IS RENDERED BY THE CONSUMER. Not an inconsistency — a difference in what
// the message is about. A grade is MUTABLE between enqueue and drain, so that
// handler carries a pointer and renders at send time. These three describe events
// that cannot be restated (an inserted quiz attempt, a finalized exam attempt, an
// issued penalty), so the text is rendered once, stored on the `notifications` row
// as the student-facing history, and sent from there. The argument in full is in
// src/lib/notifications/types.ts.
//
// ESCAPING. Two genuinely untrusted values reach this markup: the quiz/exam TITLE
// (staff-authored, `quizzes.title`) and the penalty DESCRIPTION, which is
// instructor free text from the issue-penalty action. Both go through `escapeHtml`
// for HTML and have CR/LF stripped before they touch a subject header, because an
// embedded newline in a header value is header injection and an instructor can
// paste one in. Scores and percentages are numbers, clamped by the producers.
//
// NO LINK IS DERIVED FROM INPUT: every `url` is built by the producer from
// `appOrigin()` (configuration) plus a numeric id, never from a request Host — the
// reason `appOrigin` itself argues in src/lib/mail/index.ts.
// =============================================================================

/** Strip CR/LF so a value can be interpolated into a subject header safely. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** "Score: 7 / 10 (70%)" — shared by the quiz and exam templates. */
function scoreLine(score: number, totalPossible: number, percentage: number): string {
  return `Score: ${score} / ${totalPossible} (${percentage}%)`;
}

export interface QuizSubmittedMailInput {
  name: string | null;
  /** STAFF-AUTHORED. Escaped for HTML, newline-stripped for the subject. */
  quizTitle: string;
  /** 1-based attempt number, as recorded on `quiz_attempts.attempt_number`. */
  attemptNumber: number;
  /** `quizzes.attempts_allowed`, so the student can see what is left. */
  attemptsAllowed: number;
  score: number;
  totalPossible: number;
  /** Whole percent, already rounded by the grader. */
  percentage: number;
  passed: boolean;
  /** `quizzes.passing_score`, so a fail states the bar it missed. */
  passingScore: number;
  /** Absolute URL to the student's view of this quiz. */
  url: string;
  appName: string;
}

/**
 * "Your quiz attempt has been graded."
 *
 * The message states the ATTEMPT NUMBER and how many remain, because that is the
 * one fact the student cannot re-derive from the score and it is the fact that
 * drives what they do next (attempts default to 3 and the BEST attempt counts —
 * src/lib/quizzes/grading.ts). A pass/fail line without it is a dead end.
 */
export function renderQuizSubmittedMail(input: QuizSubmittedMailInput): RenderedMail {
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const title = headerSafe(input.quizTitle);
  const verdict = input.passed ? "Passed" : "Not passed";
  const remaining = Math.max(0, input.attemptsAllowed - input.attemptNumber);

  const subject = input.passed
    ? `You passed "${title}" (${input.percentage}%)`
    : `Your "${title}" attempt scored ${input.percentage}%`;

  const nextStep = input.passed
    ? "The next week unlocks as soon as everything gating it is done."
    : remaining > 0
      ? `You have ${remaining} attempt${remaining === 1 ? "" : "s"} left, and your BEST attempt is the one that counts.`
      : `You have used all ${input.attemptsAllowed} attempts. Your best attempt is the one that counts — talk to your instructor about the next step.`;

  const text = [
    greeting,
    "",
    `Your attempt ${input.attemptNumber} of ${input.attemptsAllowed} at "${title}" has been graded.`,
    "",
    scoreLine(input.score, input.totalPossible, input.percentage),
    `Result: ${verdict} (pass mark ${input.passingScore}%)`,
    "",
    nextStep,
    "",
    "See the question-by-question breakdown here:",
    input.url,
    "",
    `— ${input.appName}`,
  ].join("\n");

  const safeTitle = escapeHtml(input.quizTitle);
  const safeUrl = escapeHtml(input.url);
  const safeApp = escapeHtml(input.appName);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your attempt ${input.attemptNumber} of ${input.attemptsAllowed} at <strong>${safeTitle}</strong> has been graded.</p>`,
    `<p>Score: <strong>${input.score} / ${input.totalPossible} (${input.percentage}%)</strong><br>` +
      `Result: <strong>${escapeHtml(verdict)}</strong> (pass mark ${input.passingScore}%)</p>`,
    `<p>${escapeHtml(nextStep)}</p>`,
    `<p><a href="${safeUrl}">See the breakdown</a></p>`,
    `<p style="word-break:break-all">${safeUrl}</p>`,
    `<p>— ${safeApp}</p>`,
  ].join("\n");

  return { subject, text, html };
}

export interface ExamCompletedMailInput {
  name: string | null;
  /** STAFF-AUTHORED exam title. */
  examTitle: string;
  weekNumber: number | null;
  score: number;
  totalPossible: number;
  percentage: number;
  passed: boolean;
  passingScore: number;
  /**
   * True when the attempt was closed by the deadline rather than by the student.
   *
   * Said out loud in the message, because it is the difference between "you
   * finished" and "time ran out and we scored what you had", and a student who
   * closed the tab has no other way to find out which happened.
   */
  autoSubmitted: boolean;
  url: string;
  appName: string;
}

/** "Your weekly exam is complete." One per finalized attempt, ever. */
export function renderExamCompletedMail(input: ExamCompletedMailInput): RenderedMail {
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const title = headerSafe(input.examTitle);
  const week = input.weekNumber == null ? "" : ` (week ${input.weekNumber})`;
  const verdict = input.passed ? "Passed" : "Not passed";

  const subject = `Your "${title}" exam is complete — ${input.percentage}%`;

  const closing = input.autoSubmitted
    ? "This attempt was submitted automatically when the time limit ran out, and the answers recorded up to that moment were graded."
    : "This attempt was submitted by you.";

  const text = [
    greeting,
    "",
    `Your exam "${title}"${week} has been completed and graded.`,
    "",
    scoreLine(input.score, input.totalPossible, input.percentage),
    `Result: ${verdict} (pass mark ${input.passingScore}%)`,
    "",
    closing,
    "The weekly exam allows ONE attempt, so this result is final.",
    "",
    "See your answers here:",
    input.url,
    "",
    `— ${input.appName}`,
  ].join("\n");

  const safeTitle = escapeHtml(input.examTitle);
  const safeUrl = escapeHtml(input.url);
  const safeApp = escapeHtml(input.appName);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your exam <strong>${safeTitle}</strong>${escapeHtml(week)} has been completed and graded.</p>`,
    `<p>Score: <strong>${input.score} / ${input.totalPossible} (${input.percentage}%)</strong><br>` +
      `Result: <strong>${escapeHtml(verdict)}</strong> (pass mark ${input.passingScore}%)</p>`,
    `<p>${escapeHtml(closing)} The weekly exam allows ONE attempt, so this result is final.</p>`,
    `<p><a href="${safeUrl}">See your answers</a></p>`,
    `<p style="word-break:break-all">${safeUrl}</p>`,
    `<p>— ${safeApp}</p>`,
  ].join("\n");

  return { subject, text, html };
}

/**
 * How much of a penalty description is quoted before it is elided.
 *
 * Shorter than FEEDBACK_PREVIEW_CHARS above: a penalty description is one sentence
 * written by a rule (src/lib/penalties/rules.ts) or by an instructor, and a long
 * one is a sign of pasted context that belongs in the app rather than in mail.
 */
export const PENALTY_DESCRIPTION_CHARS = 240;

export interface PenaltyIssuedMailInput {
  name: string | null;
  /** Human label for `penalties.type`, resolved by the caller from the enum. */
  penaltyLabel: string;
  /** `penalties.severity`: warning | notice | serious. */
  severity: string;
  /** INSTRUCTOR- OR RULE-AUTHORED free text. Escaped and length-capped. */
  description: string | null;
  /** `penalties.penalty_points` as stored — a magnitude, deducted from the total. */
  penaltyPoints: number;
  url: string;
  appName: string;
}

/**
 * "A record was added to your account."
 *
 * TONE IS A DESIGN DECISION HERE, not styling. This is the one message in the set
 * that carries bad news, and a penalty mail that reads as an accusation makes a
 * student less likely to open the next one. So it states the fact and the points,
 * links to the page holding the whole record, says records can be resolved, and
 * keeps the SEVERITY WORD OUT OF THE SUBJECT — a subject line reading "SERIOUS" is
 * something a student may see on a lock screen in front of other people.
 */
export function renderPenaltyIssuedMail(input: PenaltyIssuedMailInput): RenderedMail {
  const greeting = input.name ? `Hello ${input.name},` : "Hello,";
  const label = headerSafe(input.penaltyLabel);
  const detail = previewFeedback(input.description, PENALTY_DESCRIPTION_CHARS);
  const points = Math.abs(Math.trunc(input.penaltyPoints));
  const pointsLine =
    points === 0
      ? "No points were deducted for this one — it is a record, not a deduction."
      : `Points deducted: ${points}`;

  const subject = `A ${label.toLowerCase()} record was added to your ${input.appName} account`;

  const text = [
    greeting,
    "",
    `A ${label.toLowerCase()} (${headerSafe(input.severity)}) was recorded on your account.`,
    "",
    pointsLine,
    ...(detail ? ["", "Details:", detail] : []),
    "",
    "You can see every record on your account, and what it affects, here:",
    input.url,
    "",
    "If you think this is wrong, speak to your instructor — records can be resolved.",
    "",
    `— ${input.appName}`,
  ].join("\n");

  const safeUrl = escapeHtml(input.url);
  const safeApp = escapeHtml(input.appName);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>A <strong>${escapeHtml(label.toLowerCase())}</strong> ` +
      `(${escapeHtml(input.severity)}) was recorded on your account.</p>`,
    `<p>${escapeHtml(pointsLine)}</p>`,
    ...(detail
      ? [
          `<blockquote style="margin:0 0 1em;padding-left:1em;border-left:3px solid #ccc">${escapeHtml(detail)}</blockquote>`,
        ]
      : []),
    `<p><a href="${safeUrl}">See your records</a></p>`,
    `<p style="word-break:break-all">${safeUrl}</p>`,
    `<p>If you think this is wrong, speak to your instructor — records can be resolved.</p>`,
    `<p>— ${safeApp}</p>`,
  ].join("\n");

  return { subject, text, html };
}
