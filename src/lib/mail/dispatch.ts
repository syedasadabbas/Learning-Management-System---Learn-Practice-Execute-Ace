// =============================================================================
// DEDUPLICATED SEND — the fix for the queue's one genuinely non-idempotent step.
// Owner: the async-queues stream. Import from "@/lib/mail".
// -----------------------------------------------------------------------------
// THE BUG THIS EXISTS TO FIX, as a sequence rather than as an adjective.
//
//   1. a drain claims job J (src/lib/queue/store.ts#claimJobs), which burns an
//      attempt and takes a 120_000 ms lease;
//   2. the handler runs and the relay ACCEPTS the message;
//   3. `completeJob` — the UPDATE that would record `succeeded` — FAILS. One
//      network round trip on a free pooled Neon endpoint, on a platform that
//      kills functions at a wall-clock limit. It is not exotic;
//   4. the lease expires and the next drain reclaims J. Correctly: from the
//      database's side J is a `running` row whose worker vanished, which is the
//      case leases exist to recover;
//   5. the handler runs again and the student gets the email TWICE.
//
// The previous version of this stream logged step 5 at error level and left it
// (src/lib/queue/drain.ts, the `complete` catch block). A loud log is not a fix.
//
// -----------------------------------------------------------------------------
// THE MECHANISM: DECIDE BEFORE THE SIDE EFFECT, IN THE DATABASE.
//
// `mail_dispatches` (src/db/schema.queue.ts) carries a UNIQUE INDEX on
// `dedupe_key`, and `dedupeKey` is the SAME string as the producing job's
// `jobs.idempotency_key`. Sending goes:
//
//      INSERT ... ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
//         |                                    |
//     row returned                        no row returned
//     = I own this send                    = someone already owns it; read the
//         |                                  row and act on what it says
//      call the transport
//         |
//      UPDATE sent_at = now()   (or failed_at = now() on a definite failure)
//
// WHY THAT IS BETTER AND NOT JUST DIFFERENT — the asymmetry is the whole point:
//
//   * a PRE-send write that fails means NOTHING WAS SENT. Refusing to send and
//     letting the queue retry is completely safe;
//   * a POST-send write that fails leaves an unknown, but the window shrinks from
//     "handler + policy + completeJob + the network under all of it" to one UPDATE
//     issued immediately after the transport returned.
//
// -----------------------------------------------------------------------------
// WHAT IS AND IS NOT GUARANTEED. THIS IS AT-LEAST-ONCE PLUS DEDUPLICATION. It is
// NOT exactly-once, and this file will not claim to be. Exactly-once across a
// process boundary and an SMTP relay is not purchasable: the relay cannot enlist
// in a Postgres transaction, so there is no single acknowledgement that is durable
// on both sides at once.
//
// THE RESIDUAL RISK, precisely. A row with `sent_at IS NULL AND failed_at IS NULL`
// means a sender claimed the key and never came back. Whether the message left is
// UNKNOWN. `INDETERMINATE_RESEND_LIMIT` below decides what to do about it, and
// argues the choice. There is no third option available at this layer; what this
// file buys is that the unknown is a NAMED, QUERYABLE, BOUNDED state instead of a
// silent second email on every lease expiry.
//
// All durations are milliseconds and every timestamp is written by the DATABASE's
// clock (house rules: metric units, one clock — see src/lib/queue/store.ts).
// =============================================================================

import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { mailDispatches } from "@/db/schema.queue";

// Imported from ./index (which owns transport selection and the configured
// origin) and DELIBERATELY NOT re-exported by ./index in return — that would be
// an import cycle. Callers import "@/lib/mail/dispatch" directly; the one caller
// today is src/lib/queue/handlers/submission-graded-email.ts.
import { getMailer, appOrigin } from "./index";
import type { MailMessage, MailResult, Mailer } from "./types";

/** Drizzle client or transaction. Mirrors src/lib/queue/store.ts#Db. */
type Client = typeof db;

/**
 * How many times a send may be STARTED for one dedupe key.
 *
 * 2, i.e. the original plus exactly one resend after an indeterminate outcome.
 * The reasoning, because this constant IS the residual-risk policy:
 *
 *   * a row stuck at (sent_at NULL, failed_at NULL) means the sender disappeared
 *     between claiming the key and recording an outcome. The overwhelming
 *     majority of that wall clock is the SMTP call itself (up to ~30_000 ms
 *     against three 10_000 ms timeouts in ./smtp.ts) rather than the one UPDATE
 *     that follows it, so "the send did not complete" is the more likely reading
 *     of a disappearance than "it completed and the UPDATE was lost";
 *   * the two errors are not symmetric for THIS message. A student who never
 *     hears that their assignment was graded has to notice the absence of
 *     something; a student who hears twice can see both copies and ignore one.
 *     And the duplicate carries an identical derived Message-ID, so a client that
 *     deduplicates on it may well suppress the copy anyway;
 *   * so: resend once. Do NOT resend forever. An unbounded resend on an unknown
 *     state is how one flapping relay turns into eight copies of one email, which
 *     is the failure the queue's bounded `maxAttempts` exists to refuse.
 *
 * On the second indeterminate encounter the caller is told to STOP, which surfaces
 * the row on the dead-letter list where a human decides. That is the honest end of
 * the ladder: the machine has run out of information.
 */
export const INDETERMINATE_RESEND_LIMIT = 2;

/** Characters of `last_error` kept on a ledger row. Same spirit as MAX_ERROR_CHARS. */
export const DISPATCH_ERROR_CHARS = 500;

/**
 * What happened, from the CALLER'S point of view — the queue handler that has to
 * turn this into a JobOutcome.
 *
 * A discriminated value rather than a boolean-plus-flags for the reason
 * `MailResult` is one: "sent", "somebody else already sent it" and "we do not
 * know whether it was sent" are three different facts and a caller must be able
 * to branch on them without parsing a string.
 */
export type DispatchOutcome =
  /** The transport accepted the message on this call. */
  | { status: "sent"; transport: string; messageId: string; attempts: number }
  /**
   * A previous send already succeeded on this key. Nothing was sent now, and the
   * caller should report success — the work is DONE, which is the whole point.
   */
  | { status: "already_sent"; messageId: string | null; sentAtMs: number | null }
  /**
   * The transport reported a definite failure. Safe to try again later: the
   * ledger row records the failure, so the next attempt is an ordinary retry
   * rather than an indeterminate one.
   */
  | { status: "failed"; transport: string; reason: string; detail?: string; attempts: number }
  /**
   * A previous send's outcome was never recorded and this call sent again anyway,
   * within INDETERMINATE_RESEND_LIMIT. The caller should report success AND say
   * loudly that a duplicate is possible.
   */
  | { status: "resent_after_unknown"; transport: string; messageId: string; attempts: number }
  /**
   * A previous send's outcome was never recorded and the resend budget is spent.
   * NOTHING was sent. The caller must NOT retry this blindly — it should surface
   * the row for a human.
   */
  | { status: "unknown_exhausted"; attempts: number; claimedAtMs: number | null }
  /**
   * The LEDGER itself could not be reached, so no send was attempted. Nothing has
   * happened and an ordinary retry is completely safe. This is the branch that
   * makes the whole design work: a failure BEFORE the side effect is harmless.
   */
  | { status: "ledger_unavailable"; error: string };

/**
 * A stable RFC 5322 Message-ID for a dedupe key.
 *
 * SHA-256 of the key rather than the key itself, for two reasons: the key contains
 * internal identifiers (`submission_graded_email:8:1785484244341`) which have no
 * business in a header that travels to the recipient and through every relay in
 * between, and a hash is guaranteed to be header-safe whatever a future key
 * contains. 32 hex characters is 128 bits — collision-free at any volume this
 * project will ever see, and short enough to read in a log.
 *
 * The domain comes from `appOrigin()` (configuration), never from a request Host
 * header, for the same reason `appOrigin` itself argues.
 */
export function dispatchMessageId(
  dedupeKey: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const digest = createHash("sha256").update(dedupeKey).digest("hex").slice(0, 32);
  let host = "localhost";
  try {
    host = new URL(appOrigin(env)).hostname || "localhost";
  } catch {
    // A misconfigured NEXTAUTH_URL must not stop mail going out. A Message-ID with
    // a placeholder domain is legal and still deduplicates, which is what it is
    // for here.
  }
  return `<lms-${digest}@${host}>`;
}

function truncate(value: string): string {
  return value.length <= DISPATCH_ERROR_CHARS
    ? value
    : `${value.slice(0, DISPATCH_ERROR_CHARS - 1)}…`;
}

export interface SendDeduplicatedInput {
  /**
   * The durable identity of this MESSAGE. Pass the producing job's
   * `jobs.idempotency_key` — one string for both guarantees, so they cannot drift.
   */
  dedupeKey: string;
  /** Everything but the Message-ID, which is derived from `dedupeKey`. */
  message: Omit<MailMessage, "messageId">;
  /** "email" today. Stored for a future channel; not behaviour. */
  channel?: string;
}

/**
 * Send `message` at most once per `dedupeKey`, and tell the caller exactly which
 * of the six things happened.
 *
 * NEVER THROWS. Every failure — including the ledger being unreachable — comes
 * back as a `DispatchOutcome`, because the caller is a queue handler whose job is
 * to classify failures, and an exception erases the classification (the same
 * argument ../queue/types.ts makes for JobOutcome being a value).
 *
 * `mailer` and `client` are parameters so ./dispatch.test.ts can assert every
 * branch — including "the transport succeeded and the post-send UPDATE failed",
 * which is the exact sequence this module exists for and cannot be provoked with
 * real collaborators.
 */
export async function sendDeduplicated(
  input: SendDeduplicatedInput,
  deps: { mailer?: Mailer; client?: Client } = {},
): Promise<DispatchOutcome> {
  const client = deps.client ?? db;
  const channel = input.channel ?? "email";
  const messageId = dispatchMessageId(input.dedupeKey);

  // -------------------------------------------------------------------------
  // PHASE 1 — claim the right to send, in the database, before any I/O.
  // -------------------------------------------------------------------------
  let claim: { own: boolean; attempts: number };
  try {
    claim = await claimDispatch(client, {
      dedupeKey: input.dedupeKey,
      channel,
      recipient: input.message.to,
      messageId,
    });
  } catch (error) {
    // Nothing has been sent. This is the SAFE failure and the reason the write
    // goes first: the queue retries and the student gets exactly one email.
    return {
      status: "ledger_unavailable",
      error: truncate(error instanceof Error ? error.message : String(error)),
    };
  }

  if (!claim.own) {
    // Somebody else owns (or owned) this key. Read what became of it.
    let existing: Awaited<ReturnType<typeof readDispatch>>;
    try {
      existing = await readDispatch(client, input.dedupeKey);
    } catch (error) {
      return {
        status: "ledger_unavailable",
        error: truncate(error instanceof Error ? error.message : String(error)),
      };
    }

    if (!existing) {
      // The conflicting row vanished between the INSERT and the SELECT — only
      // reachable if an operator deleted it. Treated as unknown-and-exhausted
      // rather than "send again", because "the ledger disagrees with itself" is
      // not a state to resolve by emitting mail.
      return { status: "unknown_exhausted", attempts: claim.attempts, claimedAtMs: null };
    }

    if (existing.sentAt) {
      return {
        status: "already_sent",
        messageId: existing.messageId,
        sentAtMs: existing.sentAt.getTime(),
      };
    }

    if (!existing.failedAt) {
      // INDETERMINATE. See INDETERMINATE_RESEND_LIMIT for the whole argument.
      if (existing.attempts >= INDETERMINATE_RESEND_LIMIT) {
        return {
          status: "unknown_exhausted",
          attempts: existing.attempts,
          claimedAtMs: existing.claimedAt?.getTime() ?? null,
        };
      }
      const reclaimed = await bumpAttempt(client, input.dedupeKey, existing.attempts).catch(
        () => null,
      );
      if (reclaimed == null) {
        // Either the ledger is unreachable or another worker bumped the row
        // first — in both cases this worker has no mandate to send.
        return {
          status: "unknown_exhausted",
          attempts: existing.attempts,
          claimedAtMs: existing.claimedAt?.getTime() ?? null,
        };
      }
      return dispatchAndRecord(client, deps.mailer, input, messageId, reclaimed, true);
    }

    // (null, set) — a DEFINITE previous failure. An ordinary retry: claim another
    // attempt and send. Guarded on `attempts` so two workers cannot both take it.
    const reclaimed = await bumpAttempt(client, input.dedupeKey, existing.attempts).catch(
      () => null,
    );
    if (reclaimed == null) {
      return {
        status: "ledger_unavailable",
        error: "another worker is already retrying this dispatch",
      };
    }
    return dispatchAndRecord(client, deps.mailer, input, messageId, reclaimed, false);
  }

  return dispatchAndRecord(client, deps.mailer, input, messageId, claim.attempts, false);
}

// ---------------------------------------------------------------------------
// PHASE 2 — the side effect, then the record of it.
// ---------------------------------------------------------------------------

async function dispatchAndRecord(
  client: Client,
  mailer: Mailer | undefined,
  input: SendDeduplicatedInput,
  messageId: string,
  attempts: number,
  afterUnknown: boolean,
): Promise<DispatchOutcome> {
  const transport = mailer ?? getMailer();

  let result: MailResult;
  try {
    result = await transport.send({ ...input.message, messageId });
  } catch (error) {
    // `Mailer` promises never to reject, but a handler must not depend on another
    // module keeping a promise. An exception is a DEFINITE failure from this
    // module's point of view — we never got an acknowledgement — so it is
    // recorded as one, which keeps the next attempt an ordinary retry.
    const detail = truncate(error instanceof Error ? error.message : String(error));
    await markFailed(client, input.dedupeKey, `transport threw: ${detail}`).catch(() => {});
    return { status: "failed", transport: "unknown", reason: "send_failed", detail, attempts };
  }

  if (!result.ok) {
    await markFailed(
      client,
      input.dedupeKey,
      `${result.transport}/${result.reason}: ${result.detail ?? "no detail"}`,
    ).catch(() => {
      // The row stays at (null, null) and the NEXT attempt reads it as
      // indeterminate rather than as a definite failure. That is a strictly
      // conservative misreading — it costs at most one resend and cannot lose a
      // message — so it is not worth failing the caller over.
    });
    return {
      status: "failed",
      transport: result.transport,
      reason: result.reason,
      detail: result.detail,
      attempts,
    };
  }

  const recorded = await markSent(client, input.dedupeKey, result.messageId ?? messageId)
    .then(() => true)
    .catch(() => false);

  if (!recorded) {
    // THE WINDOW, now one statement wide. The message went out; the ledger does
    // not know it. Logged at error level with the exact key, because this is the
    // row that will read as indeterminate on the next attempt and the operator
    // reading a duplicate report needs to be able to find this line.
    console.error(
      `[mail] SENT but could not record it in mail_dispatches (dedupe_key=${input.dedupeKey}, ` +
        `message_id=${messageId}). The row will read as INDETERMINATE and may be resent once. ` +
        `See src/lib/mail/dispatch.ts.`,
    );
  }

  return afterUnknown
    ? {
        status: "resent_after_unknown",
        transport: result.transport,
        messageId: result.messageId ?? messageId,
        attempts,
      }
    : {
        status: "sent",
        transport: result.transport,
        messageId: result.messageId ?? messageId,
        attempts,
      };
}

// ---------------------------------------------------------------------------
// Ledger statements. Every timestamp is `now()` — the DATABASE's clock.
// ---------------------------------------------------------------------------

/**
 * Try to become the owner of `dedupeKey`.
 *
 * `ON CONFLICT DO NOTHING` naming the index explicitly, exactly as
 * src/lib/queue/store.ts#enqueueJob does and for the same reason: an untargeted
 * conflict clause would also absorb a primary-key collision and report it as a
 * successful de-duplication.
 */
async function claimDispatch(
  client: Client,
  row: { dedupeKey: string; channel: string; recipient: string; messageId: string },
): Promise<{ own: boolean; attempts: number }> {
  const inserted = await client
    .insert(mailDispatches)
    .values({
      dedupeKey: row.dedupeKey,
      channel: row.channel,
      // Truncated to the column width rather than allowed to raise: an
      // over-long address is a data problem, not a reason to lose the send.
      recipient: row.recipient.slice(0, 320),
      messageId: row.messageId,
      attempts: 1,
    })
    .onConflictDoNothing({ target: mailDispatches.dedupeKey })
    .returning({ id: mailDispatches.id, attempts: mailDispatches.attempts });

  return inserted.length > 0
    ? { own: true, attempts: inserted[0].attempts }
    : { own: false, attempts: 0 };
}

async function readDispatch(client: Client, dedupeKey: string) {
  const [row] = await client
    .select({
      attempts: mailDispatches.attempts,
      messageId: mailDispatches.messageId,
      claimedAt: mailDispatches.claimedAt,
      sentAt: mailDispatches.sentAt,
      failedAt: mailDispatches.failedAt,
    })
    .from(mailDispatches)
    .where(eq(mailDispatches.dedupeKey, dedupeKey))
    .limit(1);
  return row ?? null;
}

/**
 * Take the next attempt on an existing row, GUARDED ON `attempts`.
 *
 * The guard is the same device as `completeJob`'s: two workers reading the same
 * row and both deciding to resend must not both succeed, and comparing the value
 * they read is how the database settles which one did. Returns the new attempt
 * number, or null when the guard did not match.
 *
 * `failed_at` and `last_error` are cleared, so the row returns to the
 * (null, null) in-flight state for the duration of this send. That is deliberate:
 * a row that still said "failed" while a send was in progress would let a third
 * worker read it as safe-to-resend.
 */
async function bumpAttempt(
  client: Client,
  dedupeKey: string,
  expectedAttempts: number,
): Promise<number | null> {
  const updated = await client
    .update(mailDispatches)
    .set({
      attempts: expectedAttempts + 1,
      claimedAt: sql`now()`,
      failedAt: null,
      lastError: null,
    })
    .where(
      and(
        eq(mailDispatches.dedupeKey, dedupeKey),
        eq(mailDispatches.attempts, expectedAttempts),
        isNull(mailDispatches.sentAt),
      ),
    )
    .returning({ attempts: mailDispatches.attempts });

  return updated.length > 0 ? updated[0].attempts : null;
}

/**
 * Record the acknowledgement.
 *
 * `where sent_at is null` makes this a no-op on a row already marked sent, so a
 * late worker cannot move the timestamp of a send it did not perform.
 */
async function markSent(client: Client, dedupeKey: string, messageId: string): Promise<void> {
  await client
    .update(mailDispatches)
    .set({ sentAt: sql`now()`, failedAt: null, lastError: null, messageId })
    .where(and(eq(mailDispatches.dedupeKey, dedupeKey), isNull(mailDispatches.sentAt)));
}

/** Record a DEFINITE failure, which is what makes the next attempt an ordinary retry. */
async function markFailed(client: Client, dedupeKey: string, error: string): Promise<void> {
  await client
    .update(mailDispatches)
    .set({ failedAt: sql`now()`, lastError: truncate(error) })
    .where(and(eq(mailDispatches.dedupeKey, dedupeKey), isNull(mailDispatches.sentAt)));
}

/**
 * Ledger rows whose send never reported an outcome — the operator's view of the
 * residual risk. Exported for tooling and for GET /api/admin/jobs, so the state
 * this module names is also a state somebody can look at.
 */
export async function listInFlightDispatches(
  olderThanMs = 0,
  client: Client = db,
): Promise<
  Array<{ dedupeKey: string; recipient: string; attempts: number; claimedAt: Date | null }>
> {
  const seconds = Math.max(0, Math.trunc(olderThanMs)) / 1000;
  return client
    .select({
      dedupeKey: mailDispatches.dedupeKey,
      recipient: mailDispatches.recipient,
      attempts: mailDispatches.attempts,
      claimedAt: mailDispatches.claimedAt,
    })
    .from(mailDispatches)
    .where(
      and(
        isNull(mailDispatches.sentAt),
        isNull(mailDispatches.failedAt),
        sql`${mailDispatches.claimedAt} <= now() - make_interval(secs => ${seconds})`,
      ),
    )
    .limit(50);
}
