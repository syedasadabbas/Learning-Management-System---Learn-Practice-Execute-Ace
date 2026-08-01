// =============================================================================
// THE WORDS OF THE "you have peer reviews to write" MESSAGE. PURE.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// WHY THE TEXT LIVES HERE AND THE PRODUCER LIVES IN src/lib/notifications/.
//
// The producer belongs in that stream's `producers.ts`, because its header states
// the rule this repository runs on: producers are "kept in one file rather than
// scattered next to their callers so that 'what can enqueue work' is answerable by
// reading one screen". So `notifyPeerReviewAssigned` is there, in the same shape as
// `notifyQuizSubmitted` and `notifyPenaltyIssued`.
//
// The WORDING is this stream's, and it is a pure function with no imports beyond
// ./config, for two reasons: it is testable without a database or a mail transport,
// and it keeps the peer-review vocabulary ("reviews to write", "anonymous", "an
// instructor releases the feedback") in the stream that owns those concepts rather
// than in a file whose owner would have to guess at them.
//
// PLAIN TEXT ONLY. `recordAndEnqueue` takes a `body` that is documented as "the
// PLAIN-TEXT part. The HTML part is re-rendered at send time"
// (src/lib/notifications/record.ts), so a template module in src/lib/mail is not
// needed and is not added — that directory is owned by the account stream and every
// renderer in it exists because its message predates the generic notification path.
//
// NO NAMES OF OTHER STUDENTS APPEAR IN THIS MESSAGE, and that is not incidental.
// The email tells a reviewer HOW MANY reviews they owe and WHEN, never whose work
// they are. The reviewer learns the artefacts only by opening the app, where the
// blinding rules in ./visibility.ts apply. An email naming the author would defeat
// them permanently, because mail cannot be un-sent.
// =============================================================================

/** A rendered plain-text message. Mirrors the `subject`/`text` half of RenderedMail. */
export interface PeerReviewAssignedText {
  subject: string;
  text: string;
}

/**
 * "You have N peer reviews to write for <assignment>, due <date>."
 *
 * @param count reviews newly assigned to this reviewer. Always >= 1 — the producer
 *   does not send a message about zero reviews.
 * @param dueAt the round's `review_due_at`.
 * @param url absolute link to the reviewer's task list.
 */
export function renderPeerReviewAssignedText(input: {
  name: string | null;
  assignmentTitle: string;
  weekNumber: number;
  count: number;
  dueAt: Date;
  url: string;
  appName: string;
}): PeerReviewAssignedText {
  const plural = input.count === 1 ? "review" : "reviews";
  const greeting = input.name?.trim() ? `Hi ${input.name.trim()},` : "Hi,";

  // ISO-8601 UTC, deliberately, and the same choice the rest of this repository
  // makes for a machine-written timestamp: a locale-formatted date rendered on a
  // server whose timezone is not the student's is worse than an unambiguous one,
  // and "5 August 2026" written by a UTC server can be the wrong day in Karachi.
  const due = input.dueAt.toISOString().slice(0, 16).replace("T", " ");

  const subject = `${input.appName}: ${input.count} peer ${plural} to write — ${input.assignmentTitle}`;

  const text = [
    greeting,
    "",
    `You have been asked to write ${input.count} peer ${plural} for week ${input.weekNumber}, ` +
      `"${input.assignmentTitle}".`,
    "",
    `Deadline for reviews: ${due} UTC.`,
    "",
    "Your review is anonymous — the person whose work you review is never told who",
    "reviewed it. Reviews are not visible to them at all until an instructor",
    "releases the round, and a review cannot be changed once you submit it.",
    "",
    `Write your ${plural}: ${input.url}`,
    "",
    `— ${input.appName}`,
  ].join("\n");

  return { subject, text };
}
