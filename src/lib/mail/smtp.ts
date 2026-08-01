// =============================================================================
// SMTP MAIL TRANSPORT (Nodemailer) — owned by the `account` stream.
// -----------------------------------------------------------------------------
// FREE_STACK.md: password-reset mail goes over the ORGANISATION'S OWN SMTP
// mailbox (e.g. a Gmail app password), never a paid email API. Resend is dropped.
//
// WHY NODEMAILER IS LOADED THROUGH A DYNAMIC IMPORT WITH A NON-LITERAL SPECIFIER.
//
// `nodemailer` is NOT in package.json — package.json is outside this stream's
// ownership allowlist, so the dependency cannot be added here (flagged in the
// stream report). Treating it as an OPTIONAL dependency is also the correct end
// state regardless: the overwhelmingly common configuration for this project is
// no SMTP at all, and a module that is never used should not have to be present.
//
// A literal `import("nodemailer")` would make the module a hard, build-time
// resolved dependency and fail type-checking while it is absent. A specifier
// held in a variable is resolved at runtime, inside a try/catch, so a missing
// package becomes `transport_unavailable` — a value — rather than a crash.
//
// TRADE-OFF, stated plainly: the runtime import forfeits type-checking of the
// nodemailer API surface, so the minimal shape this file depends on is declared
// locally below. If `nodemailer` is added to package.json, this file can be
// simplified to a static import and the local shape deleted.
// =============================================================================

import type { Mailer, MailMessage, MailResult } from "./types";

/** Resolved SMTP settings. Ports are TCP port numbers; no other units appear. */
export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (SMTPS). True for 465; STARTTLS on 587 uses false. */
  secure: boolean;
  user?: string;
  pass?: string;
  /** RFC 5322 From header. */
  from: string;
}

/** Socket/greeting timeout in milliseconds. A hung MX must not hang a request. */
export const SMTP_TIMEOUT_MS = 10_000;

/**
 * Read SMTP settings from the environment, or return null when SMTP is not
 * configured — which is the default and is not an error.
 *
 * `SMTP_HOST` is the single switch: without a host there is nothing to connect
 * to, so no combination of the other variables can produce a usable transport.
 * User and password are optional because an internal relay may not require
 * authentication.
 */
export function smtpConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;

  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;

  const user = env.SMTP_USER?.trim() || undefined;
  const pass = env.SMTP_PASSWORD ?? undefined;

  // Explicit override wins; otherwise 465 is implicit TLS and everything else
  // is assumed to upgrade with STARTTLS, which is what 587 does.
  const secureRaw = env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureRaw ? secureRaw === "true" || secureRaw === "1" : port === 465;

  // A From header is mandatory for most relays; fall back to the login mailbox.
  const from = env.SMTP_FROM?.trim() || user;
  if (!from) return null;

  return { host, port, secure, user, pass, from };
}

// ---------------------------------------------------------------------------
// The minimal nodemailer surface this file uses. See the header for why it is
// declared rather than imported.
// ---------------------------------------------------------------------------
interface NodemailerTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    /**
     * Nodemailer stamps this as the RFC 5322 Message-ID verbatim instead of
     * generating one. See MailMessage#messageId in ./types.ts for why a caller
     * would want a DERIVED, repeatable value here.
     */
    messageId?: string;
  }): Promise<{ messageId?: string }>;
}

interface NodemailerModule {
  createTransport(options: unknown): NodemailerTransport;
}

/**
 * Sentinel: behave as if the `nodemailer` package is not installed.
 *
 * Needed because the "package missing" branch was originally tested by passing
 * `undefined` and relying on the real import to fail — i.e. on nodemailer being
 * absent from package.json. Installing the dependency then broke that test,
 * which had pinned a temporary state of the environment as if it were behaviour.
 * With this sentinel the branch is asserted explicitly and the test says the same
 * thing whether or not the package is installed.
 */
export const NODEMAILER_ABSENT = Symbol("nodemailer-absent");

type ModuleOverride = NodemailerModule | typeof NODEMAILER_ABSENT | undefined;

/** Set by the tests to bypass the runtime import. Undefined in normal operation. */
let moduleOverride: ModuleOverride;

/**
 * Test seam. Pass a fake module to intercept sending, `NODEMAILER_ABSENT` to
 * simulate the package being missing, or `undefined` to restore the real import.
 */
export function __setNodemailerModuleForTests(mod: ModuleOverride): void {
  moduleOverride = mod;
}

async function loadNodemailer(): Promise<NodemailerModule | null> {
  if (moduleOverride === NODEMAILER_ABSENT) return null;
  if (moduleOverride) return moduleOverride;
  try {
    // Non-literal on purpose — see the file header.
    const specifier = "nodemailer";
    const imported: unknown = await import(/* webpackIgnore: true */ specifier);
    const candidate = (imported as { default?: unknown })?.default ?? imported;
    if (
      candidate &&
      typeof (candidate as NodemailerModule).createTransport === "function"
    ) {
      return candidate as NodemailerModule;
    }
    return null;
  } catch {
    // Package absent. Not an error condition — see the header.
    return null;
  }
}

/**
 * A Mailer over the organisation's own SMTP. Returns failure values; never throws.
 *
 * The transport is created per send rather than cached. Reset mail is rare (a
 * handful per cohort per week), so pooling buys nothing, whereas a cached
 * connection object surviving across serverless invocations is a source of
 * "socket closed" failures that only appear in production.
 */
export function createSmtpMailer(config: SmtpConfig): Mailer {
  return {
    name: "smtp",
    async send(message: MailMessage): Promise<MailResult> {
      const nodemailer = await loadNodemailer();
      if (!nodemailer) {
        return {
          ok: false,
          transport: "smtp",
          reason: "transport_unavailable",
          detail:
            "SMTP_HOST is set but the `nodemailer` package is not installed. " +
            "Run: npm install nodemailer",
        };
      }

      try {
        const transport = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: config.user ? { user: config.user, pass: config.pass } : undefined,
          // Milliseconds throughout (metric units per house rules).
          connectionTimeout: SMTP_TIMEOUT_MS,
          greetingTimeout: SMTP_TIMEOUT_MS,
          socketTimeout: SMTP_TIMEOUT_MS,
        });

        const info = await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          // Passed through only when the caller supplied one. Sending
          // `messageId: undefined` explicitly is the same thing to nodemailer,
          // but omitting the key keeps "we did not ask for a specific id" out of
          // the options object entirely.
          ...(message.messageId ? { messageId: message.messageId } : {}),
        });

        // Prefer the id we ASKED for over the one the library reports, so a
        // caller that supplied a dedupe-derived Message-ID gets that value back
        // and can store it. Nodemailer normally echoes it, but "normally" is not
        // a property worth depending on for the value a ledger row records.
        return {
          ok: true,
          transport: "smtp",
          messageId: message.messageId ?? info?.messageId,
        };
      } catch (err) {
        return {
          ok: false,
          transport: "smtp",
          reason: "send_failed",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
