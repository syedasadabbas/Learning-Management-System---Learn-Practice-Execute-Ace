// =============================================================================
// MAIL INTERFACE — owned by the `account` stream.
// -----------------------------------------------------------------------------
// WHY AN INTERFACE AND NOT A DIRECT nodemailer CALL.
//
// SMTP being unset is the DEFAULT state of this project (see FREE_STACK.md: the
// only mail credential is the organisation's own free mailbox, and there is no
// paid email API). A password-reset request must therefore work — and must not
// 500 — on a machine with no mail configuration at all. Two transports satisfy
// one interface, the caller picks neither, and `getMailer()` decides.
//
// NOTHING HERE THROWS. Every failure is a value. A rejected promise inside the
// reset-request path would turn "mail is misconfigured" into a 500 whose
// presence/absence differs per email address — which is precisely the account
// enumeration oracle the reset endpoint exists to avoid. See
// `src/lib/account/reset.ts`.
// =============================================================================

/** Which transport actually handled (or would have handled) a message. */
export type MailTransportName = "smtp" | "dev";

/**
 * One outbound message. Plain text is mandatory and HTML optional: a reset link
 * has to survive a text-only client, and text-first also keeps the message out
 * of spam filters that distrust HTML-only mail.
 */
export interface MailMessage {
  /** Single recipient. Reset mail is never sent to more than one address. */
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * RFC 5322 Message-ID to stamp on the message, angle brackets included, e.g.
   * `<lms-a1b2…@example.org>`. Added by the async-queues stream.
   *
   * WHAT IT IS FOR. It is an IDEMPOTENCY KEY HANDED TO THE TRANSPORT. When a
   * message is derived from a durable dedupe key (src/lib/mail/dispatch.ts), the
   * Message-ID is derived from that same key, so the second copy of a message
   * carries a header byte-identical to the first. Receiving MTAs and clients are
   * permitted to suppress a duplicate Message-ID and several — Gmail among them —
   * do.
   *
   * IT IS A "MAY", NOT A GUARANTEE, and nothing in this codebase treats it as
   * one. It is the SECOND layer under the ledger, valuable because it is free,
   * and it is the reason the ledger stores the value: an operator who suspects a
   * duplicate can grep the relay's log for one string.
   *
   * Omitted for ordinary mail (password resets), where each message is genuinely
   * distinct and letting the relay generate the id is correct.
   */
  messageId?: string;
}

/** Why a send did not happen. Discriminated so callers can branch without strings. */
export type MailFailureReason =
  /** The transport's dependency or configuration is missing (e.g. nodemailer not installed). */
  | "transport_unavailable"
  /** The transport was available but the server rejected or dropped the message. */
  | "send_failed";

export type MailResult =
  | { ok: true; transport: MailTransportName; messageId?: string }
  | {
      ok: false;
      transport: MailTransportName;
      reason: MailFailureReason;
      /** Server-side diagnostic only. Never rendered to a visitor. */
      detail?: string;
    };

export interface Mailer {
  readonly name: MailTransportName;
  /** Resolves with a result; never rejects. */
  send(message: MailMessage): Promise<MailResult>;
}
