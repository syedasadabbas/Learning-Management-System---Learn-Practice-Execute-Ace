// =============================================================================
// ENVIRONMENT CONTRACT — tests.
// -----------------------------------------------------------------------------
// These assert the thing that actually failed twice: that an incomplete
// environment is reported AS an environment problem, naming every offender at
// once, rather than being discovered one dereference at a time.
//
// process.env is mutated per test and restored in afterEach. Vitest runs files in
// separate workers, so this cannot leak into another file's environment — but it
// would leak between tests in THIS file, which is why the restore is a full
// snapshot replace and not a delete of the keys each test happened to touch.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertEnv, inspectEnv } from "./env";

const VALID_SECRET = "0123456789abcdef0123456789abcdef0123456789=";
const VALID_URL = "postgres://user:pw@host.neon.tech/db";

let snapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  snapshot = { ...process.env };
});

afterEach(() => {
  process.env = snapshot;
  vi.restoreAllMocks();
});

/** Start from a KNOWN-EMPTY environment, not from whatever the developer has. */
function clearAll(): void {
  for (const name of ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "NEXTAUTH_URL"]) {
    delete process.env[name];
  }
}

describe("inspectEnv", () => {
  it("reports a fully configured environment as clean", () => {
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = VALID_SECRET;
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";

    expect(inspectEnv()).toEqual({ fatal: [], warnings: [] });
  });

  it("names EVERY missing required variable at once, not just the first", () => {
    // The whole point of the aggregate check. Restoring DATABASE_URL only to be
    // told about AUTH_SECRET on the next deploy is the same trap in slow motion.
    clearAll();

    const { fatal } = inspectEnv();

    expect(fatal).toHaveLength(2);
    expect(fatal.join("\n")).toContain("DATABASE_URL");
    expect(fatal.join("\n")).toContain("AUTH_SECRET");
  });

  it("explains the CONSEQUENCE of a missing AUTH_SECRET, including that the build still passes", () => {
    // A reader who sees "AUTH_SECRET is not set" may reasonably assume the deploy
    // would have caught it. It does not, and the message has to say so.
    clearAll();
    process.env.DATABASE_URL = VALID_URL;

    const [problem] = inspectEnv().fatal;

    expect(problem).toContain("NOBODY CAN SIGN IN");
    expect(problem).toContain("build and the deploy both succeed");
  });

  it("treats the .env.example placeholder as missing, not as configured", () => {
    // Copying .env.example and filling in only DATABASE_URL is precisely what
    // happened, so a placeholder must not read as a configured value.
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = "replace-with-32-plus-char-random-string";

    const { fatal } = inspectEnv();

    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toContain("still the placeholder");
  });

  it("rejects a secret that is present but too short to sign a JWT safely", () => {
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = "short";

    const { fatal } = inspectEnv();

    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toContain("5 characters");
    expect(fatal[0]).toContain("openssl rand -base64 32");
  });

  it("treats whitespace as absence", () => {
    // A trailing-quote or blank-line mistake in .env produces "" or " ", and a
    // truthiness check on the raw value would pass it straight through to Auth.js.
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = "   ";

    expect(inspectEnv().fatal).toHaveLength(1);
  });

  it("puts CRON_SECRET and NEXTAUTH_URL in warnings, never in fatal", () => {
    // Refusing to boot the whole platform to protect one scheduled job is the
    // wrong trade — an unset CRON_SECRET already fails those routes closed.
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = VALID_SECRET;

    const { fatal, warnings } = inspectEnv();

    expect(fatal).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("CRON_SECRET");
    expect(warnings.join("\n")).toContain("NEXTAUTH_URL");
  });

  it("says which routes stop when CRON_SECRET is unset", () => {
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = VALID_SECRET;
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";

    const [warning] = inspectEnv().warnings;

    expect(warning).toContain("503");
    expect(warning).toContain("ingestion");
  });
});

describe("assertEnv", () => {
  it("throws ONE error carrying every fatal problem", () => {
    clearAll();

    let message = "";
    try {
      assertEnv();
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("2 environment problem(s)");
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("AUTH_SECRET");
    // The operator-facing half: where to set these when there is no .env file.
    expect(message).toContain("platform's environment settings");
  });

  it("returns silently when the environment is complete", () => {
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = VALID_SECRET;
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";

    expect(() => assertEnv()).not.toThrow();
  });

  it("WARNS about the recommended variables without throwing", () => {
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = VALID_SECRET;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => assertEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn at all when everything is set", () => {
    clearAll();
    process.env.DATABASE_URL = VALID_URL;
    process.env.AUTH_SECRET = VALID_SECRET;
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    assertEnv();

    expect(warn).not.toHaveBeenCalled();
  });
});
