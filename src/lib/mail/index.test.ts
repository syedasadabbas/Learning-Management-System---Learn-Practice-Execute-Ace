// =============================================================================
// MAILER SELECTION TESTS — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The property that matters most: SMTP UNSET MUST NEVER FAIL. That is the default
// state of this project, so a throw here would mean every password-reset request
// on a fresh install returns a 500 — which is also an enumeration oracle if it
// happens for some addresses and not others.
//
// The environment is passed in rather than mutated on `process.env`, so no test
// leaks configuration into another.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

import { appOrigin, getMailer } from "./index";
import { clearDevOutbox, createDevMailer, readDevOutbox, DEV_OUTBOX_CAPACITY } from "./dev";
import { renderPasswordResetMail } from "./templates";
import {
  createSmtpMailer,
  smtpConfigFromEnv,
  __setNodemailerModuleForTests,
  NODEMAILER_ABSENT,
} from "./smtp";

const MESSAGE = { to: "student@codequeenshub.test", subject: "s", text: "body" };

describe("smtpConfigFromEnv", () => {
  it("returns null when SMTP_HOST is absent — the default, and not an error", () => {
    expect(smtpConfigFromEnv({})).toBeNull();
  });

  it("returns null for a blank host", () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: "   " })).toBeNull();
  });

  it("returns null when there is no From and no user to fall back on", () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: "smtp.example" })).toBeNull();
  });

  it("defaults the port to 587 with STARTTLS (secure=false)", () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: "smtp.example",
      SMTP_USER: "lms@example.test",
    });
    expect(config).toMatchObject({ port: 587, secure: false, from: "lms@example.test" });
  });

  it("treats port 465 as implicit TLS", () => {
    expect(
      smtpConfigFromEnv({
        SMTP_HOST: "smtp.example",
        SMTP_PORT: "465",
        SMTP_FROM: "a@b.test",
      })?.secure,
    ).toBe(true);
  });

  it("lets SMTP_SECURE override the port heuristic", () => {
    expect(
      smtpConfigFromEnv({
        SMTP_HOST: "smtp.example",
        SMTP_PORT: "465",
        SMTP_SECURE: "false",
        SMTP_FROM: "a@b.test",
      })?.secure,
    ).toBe(false);
  });

  it("rejects a nonsensical port rather than connecting somewhere odd", () => {
    expect(
      smtpConfigFromEnv({
        SMTP_HOST: "smtp.example",
        SMTP_PORT: "not-a-port",
        SMTP_FROM: "a@b.test",
      }),
    ).toBeNull();
    expect(
      smtpConfigFromEnv({
        SMTP_HOST: "smtp.example",
        SMTP_PORT: "70000",
        SMTP_FROM: "a@b.test",
      }),
    ).toBeNull();
  });
});

describe("getMailer", () => {
  it("uses the dev transport when SMTP is unset, and succeeds", async () => {
    const mailer = getMailer({});
    expect(mailer.name).toBe("dev");
    await expect(mailer.send(MESSAGE)).resolves.toMatchObject({ ok: true, transport: "dev" });
  });

  it("uses the SMTP transport when SMTP_HOST is set", () => {
    expect(getMailer({ SMTP_HOST: "smtp.example", SMTP_FROM: "a@b.test" }).name).toBe("smtp");
  });

  /**
   * A nodemailer stand-in whose send always rejects.
   *
   * Both tests below originally passed `undefined` and pointed at the
   * unresolvable host "smtp.invalid", relying on the real import failing because
   * nodemailer was absent from package.json. Installing nodemailer turned that
   * into a genuine DNS lookup and connection attempt inside a unit test: one case
   * took 5.03 s and blew Vitest's 5 s limit, and both became dependent on the
   * machine's network. Injecting the failure keeps the assertion identical, makes
   * it instant and deterministic, and tests the branch we actually care about —
   * "the transport rejected" — rather than "DNS did not resolve".
   */
  const failingNodemailer = {
    createTransport: () => ({
      sendMail: async () => {
        throw new Error("connection refused (injected)");
      },
    }),
  };

  it("falls back to the dev transport when SMTP fails, so the link is not lost", async () => {
    __setNodemailerModuleForTests(failingNodemailer);
    clearDevOutbox();
    const mailer = getMailer({ SMTP_HOST: "smtp.invalid", SMTP_FROM: "a@b.test" });
    const result = await mailer.send(MESSAGE);
    expect(result.ok).toBe(true);
    expect(readDevOutbox()).toHaveLength(1);
    clearDevOutbox();
    __setNodemailerModuleForTests(undefined);
  });

  it("reports the failure instead when MAIL_LOG_FALLBACK is false", async () => {
    __setNodemailerModuleForTests(failingNodemailer);
    clearDevOutbox();
    const mailer = getMailer({
      SMTP_HOST: "smtp.invalid",
      SMTP_FROM: "a@b.test",
      MAIL_LOG_FALLBACK: "false",
    });
    const result = await mailer.send(MESSAGE);
    expect(result.ok).toBe(false);
    // Nothing was written to the log-backed outbox.
    expect(readDevOutbox()).toHaveLength(0);
    __setNodemailerModuleForTests(undefined);
  });
});

describe("createSmtpMailer", () => {
  it("returns transport_unavailable rather than throwing when nodemailer is missing", async () => {
    // Simulate the package being absent EXPLICITLY. This originally passed
    // `undefined` and relied on the real import failing because nodemailer was
    // not in package.json — so installing the dependency (which this stream asked
    // for) turned a passing test red without any behaviour changing. The sentinel
    // makes the assertion mean the same thing either way.
    __setNodemailerModuleForTests(NODEMAILER_ABSENT);
    const result = await createSmtpMailer({
      host: "smtp.invalid",
      port: 587,
      secure: false,
      from: "a@b.test",
    }).send(MESSAGE);
    expect(result).toMatchObject({ ok: false, reason: "transport_unavailable" });
  });

  it("sends through nodemailer when it is present", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<abc@example>" }));
    __setNodemailerModuleForTests({ createTransport: () => ({ sendMail }) });

    const result = await createSmtpMailer({
      host: "smtp.example",
      port: 587,
      secure: false,
      user: "lms@example.test",
      pass: "secret",
      from: "LMS <lms@example.test>",
    }).send(MESSAGE);

    expect(result).toEqual({ ok: true, transport: "smtp", messageId: "<abc@example>" });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: MESSAGE.to, from: "LMS <lms@example.test>" }),
    );
    __setNodemailerModuleForTests(undefined);
  });

  it("turns a relay rejection into send_failed, never a throw", async () => {
    __setNodemailerModuleForTests({
      createTransport: () => ({
        sendMail: async () => {
          throw new Error("535 authentication failed");
        },
      }),
    });
    const result = await createSmtpMailer({
      host: "smtp.example",
      port: 587,
      secure: false,
      from: "a@b.test",
    }).send(MESSAGE);
    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    __setNodemailerModuleForTests(undefined);
  });
});

describe("dev transport outbox", () => {
  it("keeps the newest messages first and drops the oldest past capacity", async () => {
    clearDevOutbox();
    const mailer = createDevMailer(() => 1_700_000_000_000);
    for (let i = 0; i < DEV_OUTBOX_CAPACITY + 3; i += 1) {
      await mailer.send({ ...MESSAGE, subject: `s${i}` });
    }
    const messages = readDevOutbox();
    expect(messages).toHaveLength(DEV_OUTBOX_CAPACITY);
    expect(messages[0].subject).toBe(`s${DEV_OUTBOX_CAPACITY + 2}`);
    clearDevOutbox();
  });

  it("hands back a copy, so a reader cannot mutate the buffer", async () => {
    clearDevOutbox();
    await createDevMailer().send(MESSAGE);
    readDevOutbox().length = 0;
    expect(readDevOutbox()).toHaveLength(1);
    clearDevOutbox();
  });
});

describe("appOrigin", () => {
  it("never derives the origin from a request host — configuration only", () => {
    expect(appOrigin({ NEXTAUTH_URL: "https://lms.example/" })).toBe("https://lms.example");
    expect(appOrigin({ VERCEL_URL: "preview.vercel.app" })).toBe(
      "https://preview.vercel.app",
    );
    expect(appOrigin({})).toBe("http://localhost:3000");
  });
});

describe("renderPasswordResetMail", () => {
  const rendered = renderPasswordResetMail({
    name: "Demo Student",
    url: "https://lms.example/reset-password?token=abc",
    appName: "Code Queens LMS",
  });

  it("states the validity window in minutes", () => {
    expect(rendered.text).toContain("30 minutes");
  });

  it("carries the link in both the text and HTML parts", () => {
    expect(rendered.text).toContain("https://lms.example/reset-password?token=abc");
    expect(rendered.html).toContain("token=abc");
  });

  it("tells an unexpecting recipient that no action is needed", () => {
    expect(rendered.text.toLowerCase()).toContain("did not ask");
  });

  it("escapes interpolated values in the HTML part", () => {
    const evil = renderPasswordResetMail({
      name: null,
      url: 'https://lms.example/reset-password?token=x"><script>alert(1)</script>',
      appName: "LMS",
    });
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("&lt;script&gt;");
  });
});
