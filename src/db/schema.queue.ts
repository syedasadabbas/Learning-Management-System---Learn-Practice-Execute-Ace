// =============================================================================
// MAIL DISPATCH LEDGER — schema module for the async-queues stream.
// -----------------------------------------------------------------------------
// WHY THIS IS A SEPARATE FILE AND NOT AN APPEND TO src/db/schema.ts
//
// The same reason src/db/schema.access.ts gives, and the reason drizzle.config.ts
// states in its own comment: `schema.ts` is the frozen Wave 0 seam and is edited
// concurrently, so a stream that needs a table of its own adds a sibling module
// and one entry to the config's `schema` array. drizzle-kit unions the paths into
// one snapshot, so a generated migration is identical to an inline declaration.
// This module imports nothing from schema.ts, so there is no cycle and no
// coupling in either direction.
//
// -----------------------------------------------------------------------------
// WHAT THIS TABLE IS FOR — the hole it closes, stated as a sequence of events.
//
// The queue's idempotency guarantee lives on `jobs.idempotency_key` and stops the
// same logical job being ENQUEUED twice. It says nothing about the same job being
// RUN twice, and there is one sequence where that happens:
//
//   1. a drain claims job J, burning an attempt and taking a 120_000 ms lease;
//   2. its handler runs and the SMTP relay accepts the message;
//   3. the `completeJob` UPDATE that would record `succeeded` FAILS — the pool
//      connection dropped, the serverless invocation was killed, Neon restarted;
//   4. the lease expires; the next drain legitimately reclaims J, because from
//      the database's point of view J is a `running` row whose worker vanished
//      and that is exactly the recovery path leases exist for;
//   5. the handler runs AGAIN and the student receives the email twice.
//
// Step 3 is not rare enough to wave at: it is one network round trip on a free
// pooled Neon endpoint, on a platform that terminates functions at a wall-clock
// limit. The previous version of this stream logged step 5 loudly and left it,
// which made the double-send documented rather than fixed.
//
// A LEDGER FIXES IT BY MOVING THE DECISION IN FRONT OF THE SIDE EFFECT. A row is
// inserted here BEFORE the transport is called, keyed on the same string as
// `jobs.idempotency_key`, with `INSERT ... ON CONFLICT DO NOTHING`. Whoever's
// INSERT returns a row has won the right to send; everyone else reads the row and
// learns what happened to the send that already started. The asymmetry that makes
// this an improvement rather than a shuffle:
//
//   * if the PRE-send write fails, nothing has been sent, so refusing to send and
//     retrying is completely safe;
//   * if the POST-send write fails, the outcome is unknown — but the window for
//     that is now one UPDATE issued immediately after the transport's
//     acknowledgement, instead of the whole handler-plus-policy-plus-completeJob
//     tail.
//
// WHAT IS STILL NOT GUARANTEED. This is at-least-once delivery plus
// deduplication, NOT exactly-once. Exactly-once across a process boundary and an
// SMTP relay is not available: the relay cannot enlist in a Postgres transaction,
// and there is no acknowledgement that is simultaneously durable on both sides.
// The residual case is enumerated on `sentAt` below.
//
// All durations are milliseconds and every timestamp is `timestamptz` written by
// the DATABASE's clock (house rules: metric units, one clock).
// =============================================================================

import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * One outbound message that the system has committed to sending, at most once.
 *
 * NOT a mail archive. It stores no subject and no body — only what is needed to
 * decide "has this already gone out?" and to let an operator correlate a row with
 * a message in the relay's own logs. A body column here would turn an operations
 * table into a copy of every student's feedback.
 */
export const mailDispatches = pgTable(
  "mail_dispatches",
  {
    id: serial("id").primaryKey(),

    /**
     * THE DEDUPLICATION KEY, and the whole point of the table.
     *
     * Carries the SAME value as `jobs.idempotency_key` for the job that produced
     * the message, so the queue's "one job per logical event" guarantee and the
     * mailer's "one send per logical event" guarantee are keyed on one string
     * rather than two that can drift. Length matches `jobs.idempotency_key`
     * (varchar 200 = KEY_MAX_CHARS in src/lib/queue/keys.ts) for the same reason.
     */
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),

    /** "email" today. A column rather than an enum so a second channel is code, not a migration. */
    channel: varchar("channel", { length: 32 }).notNull().default("email"),

    /** Recipient, for operator correlation. 320 = the RFC 5321 maximum address length. */
    recipient: varchar("recipient", { length: 320 }).notNull(),

    /**
     * The RFC 5322 Message-ID handed to the transport — DERIVED from `dedupeKey`,
     * so a resend after an indeterminate outcome carries the identical header and
     * a receiving MTA or client that deduplicates on Message-ID can suppress the
     * copy. That is the second layer of defence, and it is a MAY, not a MUST: it
     * is stored so an operator can grep the relay's log, not relied upon.
     */
    messageId: varchar("message_id", { length: 200 }),

    /**
     * How many times a send has been STARTED for this key. 1 in the normal case.
     * 2 means the first attempt's outcome was never recorded and the retry policy
     * in src/lib/mail/dispatch.ts chose to try once more.
     */
    attempts: integer("attempts").notNull().default(1),

    /** When the right to send was first claimed. Never null: the INSERT sets it. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * Set when the transport ACKNOWLEDGED the message.
     *
     * The three states of (`sentAt`, `failedAt`) are the entire protocol:
     *   (null, null)     IN FLIGHT OR INDETERMINATE. A sender claimed this key
     *                    and never came back. It is NOT known whether the message
     *                    left. This is the residual risk the header refers to;
     *                    src/lib/mail/dispatch.ts decides what to do about it and
     *                    argues the choice there.
     *   (set,  *)        SENT. Never send again on this key.
     *   (null, set)      DEFINITELY FAILED. Safe to send again — the transport
     *                    told us it did not deliver.
     */
    sentAt: timestamp("sent_at", { withTimezone: true }),

    /** Set when the transport reported a definite failure. See `sentAt`. */
    failedAt: timestamp("failed_at", { withTimezone: true }),

    /** Truncated by the caller. Diagnostic for the row's most recent failure. */
    lastError: text("last_error"),
  },
  (t) => ({
    /**
     * THE GUARANTEE. A UNIQUE INDEX, because the decision "am I the sender?" is a
     * race between two drains and only the database can settle it — the same
     * argument `jobs_idempotency_key_idx` exists for, and asserted against the
     * real Postgres in src/lib/queue/store.integration.test.ts rather than
     * modelled by a fake.
     */
    dedupeIdx: uniqueIndex("mail_dispatches_dedupe_key_idx").on(t.dedupeKey),
    /** Serves the operator query "which sends are stuck in flight?" */
    inFlightIdx: index("mail_dispatches_sent_at_idx").on(t.sentAt, t.claimedAt),
  }),
);

export type MailDispatch = typeof mailDispatches.$inferSelect;
export type NewMailDispatch = typeof mailDispatches.$inferInsert;
