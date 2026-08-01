// =============================================================================
// PASSWORD-RESET FLOW — owned by the `account` stream.
// -----------------------------------------------------------------------------
// THE NO-ENUMERATION PROPERTY IS THIS FILE'S REASON TO EXIST.
//
// `requestPasswordReset` returns the SAME outcome whether or not the email
// belongs to an account. Anything that differs — the response body, the status
// code, a redirect target, a validation message, or the time taken — turns this
// endpoint into a free membership oracle: submit a list of addresses, keep the
// ones that answer differently, and you have the cohort's roster. It is the single
// easiest place in an LMS to leak the entire user list, and it needs no session.
//
// Three mechanisms, because one is not enough:
//   1. ONE RETURN VALUE. The "accepted" outcome carries no user-derived field.
//      The caller cannot accidentally render a difference it was never given.
//   2. A TIMING FLOOR. The known-email path does a token insert and a mail send;
//      the unknown-email path does neither and would answer visibly sooner. Both
//      paths are padded to `RESET_RESPONSE_FLOOR_MS`, plus a small random jitter
//      so a single measurement is not decisive.
//   3. FAILURES ARE SWALLOWED. A mail-transport failure must not become a 500,
//      because a 500 on one address and a 200 on another is the same leak wearing
//      a different hat. `getMailer()` already returns values rather than throwing;
//      the try/catch here covers the database side.
//
// RESIDUAL WEAKNESS, stated as fact rather than glossed over: the floor bounds the
// FAST path but cannot bound a SLOW one. With the dev transport (the default —
// SMTP unset) both paths finish well inside the floor and are indistinguishable.
// With a slow external SMTP relay, the known-email path can exceed the floor and a
// patient attacker averaging many samples could recover a signal.
//   Options: (a) accept it — the exposure is a coarse membership signal against an
//   internal cohort roster; (b) raise `RESET_RESPONSE_FLOOR_MS` above the relay's
//   typical latency, at the cost of a slower form for everyone; (c) move the send
//   off the request path onto a queue, which needs infrastructure outside
//   FREE_STACK.md. (a) is what ships; (b) is a one-line change.
//
// Rate limiting is keyed on the SUBMITTED email, not on a found user, so a
// refusal is likewise existence-independent.
// =============================================================================

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { BCRYPT_ROUNDS, normaliseEmail } from "@/lib/auth";
import {
  appOrigin,
  getMailer,
  MAIL_APP_NAME,
  renderPasswordResetMail,
  type MailMessage,
  type MailResult,
} from "@/lib/mail";

import {
  RESET_EMAIL_RULE,
  RESET_IP_RULE,
  resetRequestLimiter,
  type RateLimiter,
} from "./rate-limit";
import { consumePasswordResetToken, issuePasswordResetToken } from "./token-store";
import { resetUrl } from "./tokens";

/**
 * Minimum wall-clock duration of a reset request, in milliseconds.
 *
 * 400 ms comfortably exceeds a Neon round trip plus an insert plus the dev
 * transport, so the two paths converge on it. See the residual-weakness note.
 */
export const RESET_RESPONSE_FLOOR_MS = 400;

/** Upper bound of the random padding added to both paths, in milliseconds. */
export const RESET_RESPONSE_JITTER_MS = 80;

/**
 * The single user-facing message. Says what WILL happen, not what DID: "if an
 * account exists" is the sentence that keeps the page honest without confirming
 * anything.
 */
export const RESET_REQUEST_ACKNOWLEDGEMENT =
  "If an account exists for that address, a reset link is on its way. " +
  "The link is valid for 30 minutes.";

export type ResetRequestOutcome =
  /** Indistinguishable between "mail sent" and "no such account". By design. */
  | { status: "accepted" }
  /** Existence-independent: the limiter is keyed on the submitted email and the IP. */
  | { status: "rate_limited"; retryAfterMs: number };

interface ResetUser {
  id: number;
  email: string;
  name: string;
}

export interface ResetRequestDeps {
  findUserByEmail(email: string): Promise<ResetUser | null>;
  issueToken(userId: number, nowMs: number): Promise<{ rawToken: string; expiresAt: Date }>;
  sendMail(message: MailMessage): Promise<MailResult>;
  /** Absolute origin for the link. Never taken from a request header. */
  origin(): string;
  limiter(): RateLimiter;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  floorMs: number;
  /** Random padding in ms. Overridden to 0 in tests for determinism. */
  jitterMs(): number;
}

const sleepMs = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export const defaultResetRequestDeps: ResetRequestDeps = {
  async findUserByEmail(email) {
    const [row] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row ?? null;
  },
  issueToken: issuePasswordResetToken,
  sendMail: (message) => getMailer().send(message),
  origin: () => appOrigin(),
  limiter: resetRequestLimiter,
  nowMs: () => Date.now(),
  sleep: sleepMs,
  floorMs: RESET_RESPONSE_FLOOR_MS,
  jitterMs: () => Math.floor(Math.random() * RESET_RESPONSE_JITTER_MS),
};

/**
 * Request a reset link for `rawEmail`.
 *
 * @param rawEmail the address as submitted; normalised here, because the stored
 *                 form is lowercased (see normaliseEmail in src/lib/auth.ts) and
 *                 a case-sensitive lookup would silently never find anyone.
 * @param ip       client address for the per-IP rule, or null to skip it.
 */
export async function requestPasswordReset(
  rawEmail: string,
  ip: string | null,
  deps: ResetRequestDeps = defaultResetRequestDeps,
): Promise<ResetRequestOutcome> {
  const startedAtMs = deps.nowMs();
  const email = normaliseEmail(rawEmail);
  const limiter = deps.limiter();

  // Both rules are consulted before any lookup, so a refusal costs no query and,
  // more importantly, cannot depend on whether the account exists.
  const byEmail = limiter.check(`reset:email:${email}`, RESET_EMAIL_RULE, startedAtMs);
  const byIp = ip
    ? limiter.check(`reset:ip:${ip}`, RESET_IP_RULE, startedAtMs)
    : { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAtMs: startedAtMs };

  if (!byEmail.allowed || !byIp.allowed) {
    const resetAtMs = !byEmail.allowed ? byEmail.resetAtMs : byIp.resetAtMs;
    // Padded as well: an unpadded fast refusal would time-distinguish itself from
    // an accepted request, which is a weaker leak but still a difference.
    await padToFloor(deps, startedAtMs);
    return { status: "rate_limited", retryAfterMs: Math.max(0, resetAtMs - startedAtMs) };
  }

  try {
    const user = await deps.findUserByEmail(email);
    if (user) {
      const { rawToken } = await deps.issueToken(user.id, startedAtMs);
      const rendered = renderPasswordResetMail({
        name: user.name || null,
        url: resetUrl(deps.origin(), rawToken),
        appName: MAIL_APP_NAME,
      });
      const sent = await deps.sendMail({
        to: user.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      if (!sent.ok) {
        // Logged, never surfaced. See mechanism 3 in the header.
        console.error(
          `[account] reset mail not delivered via ${sent.transport} (${sent.reason}): ` +
            `${sent.detail ?? "no detail"}`,
        );
      }
    }
  } catch (err) {
    // A database or template failure must still produce the acknowledgement.
    console.error("[account] password reset request failed internally", err);
  }

  await padToFloor(deps, startedAtMs);
  return { status: "accepted" };
}

async function padToFloor(deps: ResetRequestDeps, startedAtMs: number): Promise<void> {
  const elapsedMs = deps.nowMs() - startedAtMs;
  const targetMs = deps.floorMs + deps.jitterMs();
  await deps.sleep(targetMs - elapsedMs);
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export type ResetCompletionOutcome =
  | { ok: true; userId: number }
  /**
   * One reason code, four causes. The PAGE renders a single generic message: a
   * holder of a link does not need to know whether it was spent or aged out, and
   * a probe should learn nothing about which token hashes exist.
   */
  | { ok: false; reason: "malformed" | "unknown" | "expired" | "used" };

/** The single user-facing message for any unusable link. */
export const RESET_LINK_UNUSABLE_MESSAGE =
  "That reset link is no longer valid. Request a new one.";

export interface ResetCompletionDeps {
  consume(
    rawToken: string,
    newPasswordHash: string,
    nowMs: number,
  ): Promise<ResetCompletionOutcome | { ok: true; userId: number; invalidatedSiblings: number }>;
  hash(plain: string): Promise<string>;
  nowMs(): number;
}

export const defaultResetCompletionDeps: ResetCompletionDeps = {
  consume: consumePasswordResetToken,
  hash: (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS),
  nowMs: () => Date.now(),
};

/**
 * Redeem a reset link and set the new password.
 *
 * The password is hashed BEFORE the consuming transaction opens, so bcrypt's
 * ~100 ms of deliberate work does not hold a row lock on the token for the whole
 * duration. Correctness is unaffected: the token is only marked used if the
 * conditional UPDATE claims it (see token-store.ts), and a hash computed for a
 * token that turns out to be unusable is simply discarded.
 */
export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  deps: ResetCompletionDeps = defaultResetCompletionDeps,
): Promise<ResetCompletionOutcome> {
  const nextHash = await deps.hash(newPassword);
  const outcome = await deps.consume(rawToken, nextHash, deps.nowMs());
  return outcome.ok ? { ok: true, userId: outcome.userId } : outcome;
}
