// =============================================================================
// MAILER SELECTION — owned by the `account` stream. Import from "@/lib/mail".
// -----------------------------------------------------------------------------
// One decision, in one place: SMTP when the organisation's own SMTP_* variables
// are present, the dev transport otherwise.
//
// THE SMTP PATH FALLS BACK TO THE DEV TRANSPORT ON FAILURE, deliberately.
// If SMTP_HOST is set but the relay refuses the message (bad app password, MX
// down, `nodemailer` not installed), the reset link would otherwise be lost
// entirely: the token row exists, nobody can read the link, and the student is
// stuck with no diagnostic. Falling through to the log means an operator can
// always recover the link from the server output.
//
// TRADE-OFF, stated plainly rather than silently chosen: this writes a valid
// reset link into the server log whenever SMTP is broken. The log is already a
// privileged artefact (it carries connection strings and stack traces) and the
// link expires in 30 minutes, so the exposure is bounded — but an operator who
// considers logs less trusted than the database should set
// `MAIL_LOG_FALLBACK=false`, which turns the failure into a reported failure and
// no log line.
// =============================================================================

import { appConfig } from "@/lib/config/app.config";

import { createDevMailer } from "./dev";
import { createSmtpMailer, smtpConfigFromEnv } from "./smtp";
import type { Mailer, MailMessage, MailResult } from "./types";

export type { Mailer, MailMessage, MailResult, MailTransportName } from "./types";
export { readDevOutbox, clearDevOutbox, DEV_OUTBOX_CAPACITY } from "./dev";
export type { DevMailRecord } from "./dev";
export { smtpConfigFromEnv, SMTP_TIMEOUT_MS } from "./smtp";
export type { SmtpConfig } from "./smtp";
export { renderPasswordResetMail } from "./templates";
export type { RenderedMail, ResetMailInput } from "./templates";
// Added by the async-queues stream: rendered by the queue's
// `submission_graded_email` handler, never sent inline from a request.
export {
  FEEDBACK_PREVIEW_CHARS,
  previewFeedback,
  renderSubmissionGradedMail,
} from "./templates";
export type { GradedMailInput } from "./templates";

/** Product name used in mail subjects. Single source of truth is app.config. */
export const MAIL_APP_NAME = appConfig.branding.appName;

function logFallbackEnabled(env: Record<string, string | undefined>): boolean {
  const raw = env.MAIL_LOG_FALLBACK?.trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0");
}

/**
 * The mailer for this process, chosen from the environment.
 *
 * Not cached: `process.env` is read per call so a test can flip SMTP_HOST
 * without module-registry surgery, and the cost is a handful of string reads.
 */
export function getMailer(
  env: Record<string, string | undefined> = process.env,
): Mailer {
  const smtp = smtpConfigFromEnv(env);
  if (!smtp) return createDevMailer();

  const primary = createSmtpMailer(smtp);
  if (!logFallbackEnabled(env)) return primary;

  const fallback = createDevMailer();

  return {
    name: "smtp",
    async send(message: MailMessage): Promise<MailResult> {
      const result = await primary.send(message);
      if (result.ok) return result;

      console.error(
        `[mail] SMTP send failed (${result.reason}): ${result.detail ?? "no detail"}. ` +
          "Falling back to the dev transport so the link is not lost. " +
          "Set MAIL_LOG_FALLBACK=false to disable this.",
      );
      return fallback.send(message);
    },
  };
}

/**
 * Absolute origin for links in outbound mail, without a trailing slash.
 *
 * A reset link must be absolute — a relative path in an email is not clickable —
 * and it must NOT be derived from the incoming request's Host header. Trusting
 * Host would let an attacker who can set it send a victim a reset link pointing
 * at a host they control, handing over the token. So the origin comes from
 * configuration only.
 */
export function appOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured =
    env.NEXTAUTH_URL?.trim() ||
    env.AUTH_URL?.trim() ||
    (env.VERCEL_URL?.trim() ? `https://${env.VERCEL_URL.trim()}` : "") ||
    "http://localhost:3000";
  return configured.replace(/\/+$/, "");
}
