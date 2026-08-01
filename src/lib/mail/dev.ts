// =============================================================================
// DEV MAIL TRANSPORT — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The default transport, because SMTP unset is the default state. It logs the
// message (including the reset link) to the server console and keeps the last
// few messages in an in-memory outbox.
//
// WHY AN IN-MEMORY OUTBOX AND NOT ONLY A LOG LINE.
// The end-to-end test has to complete a real reset, which means it has to read
// the link. Scraping the dev server's stdout from Playwright is brittle (the
// server may be one that was already running, with its output going somewhere
// the test cannot see). A bounded in-memory ring buffer, readable through a
// route that 404s outside development, makes the flow testable without ever
// creating a production-reachable way to fetch somebody else's reset link.
//
// The buffer lives on `globalThis` so Next's dev-mode module reloading does not
// silently give the reader a different array from the writer.
//
// CAPACITY is deliberately tiny (8 messages, a few kB). This is a debugging aid,
// not a mail store; an unbounded array in a long-lived server process is a leak.
// =============================================================================

import type { Mailer, MailMessage, MailResult } from "./types";

/** A message the dev transport "sent", with the moment it happened. */
export interface DevMailRecord extends MailMessage {
  /** Unix epoch milliseconds (metric units per house rules). */
  sentAtMs: number;
}

/** Maximum retained messages. Oldest is dropped first. */
export const DEV_OUTBOX_CAPACITY = 8;

const globalForOutbox = globalThis as unknown as { __lmsDevOutbox?: DevMailRecord[] };

function outbox(): DevMailRecord[] {
  globalForOutbox.__lmsDevOutbox ??= [];
  return globalForOutbox.__lmsDevOutbox;
}

/** Newest first. A copy, so a caller cannot mutate the buffer. */
export function readDevOutbox(): DevMailRecord[] {
  return [...outbox()].reverse();
}

/** Empties the buffer. Used by tests and by the dev outbox route's DELETE. */
export function clearDevOutbox(): void {
  outbox().length = 0;
}

/**
 * Logs and records. Returns `ok` because, from the caller's point of view, the
 * message reached its transport — the operator can read it. Reporting failure
 * here would make an unconfigured install look broken to a student.
 */
export function createDevMailer(nowMs: () => number = Date.now): Mailer {
  return {
    name: "dev",
    async send(message: MailMessage): Promise<MailResult> {
      const record: DevMailRecord = { ...message, sentAtMs: nowMs() };

      const buffer = outbox();
      buffer.push(record);
      while (buffer.length > DEV_OUTBOX_CAPACITY) buffer.shift();

      // One block, easy to spot in `next dev` output. The body carries the link.
      console.info(
        [
          "",
          "──────── [mail:dev] no SMTP_* configured, message NOT sent ────────",
          `to:      ${message.to}`,
          `subject: ${message.subject}`,
          message.text,
          "───────────────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );

      // Echo the caller's Message-ID when there is one, so the dispatch ledger
      // records the same value on an unconfigured install as it would with SMTP.
      // Without this, `mail_dispatches.message_id` would be null for every row in
      // the project's DEFAULT configuration and the column would look unused.
      return { ok: true, transport: "dev", messageId: message.messageId };
    },
  };
}
