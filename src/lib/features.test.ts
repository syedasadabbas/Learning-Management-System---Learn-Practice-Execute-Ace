// =============================================================================
// FEATURE FLAG TESTS.
// -----------------------------------------------------------------------------
// The property under test is FAIL-CLOSED. Every assertion here exists because
// the corresponding misconfiguration is one somebody will actually produce: an
// unset var on a fresh preview deployment, `"1"` typed by someone used to
// twelve-factor booleans, `"True"` from a YAML file, a trailing space from a
// dashboard paste. Each must leave the feature OFF.
//
// The flags are module-level `const`s read from `process.env` at import time,
// which is what makes them tree-shakeable and what makes NEXT_PUBLIC_ inlining
// work. The cost is that a test cannot mutate `process.env` and re-read them —
// it has to reset the module registry and re-import. `loadFeatures` below does
// exactly that, and every test goes through it.
// =============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";

const FLAG_VARS = [
  "LIVE_CLASSES_ENABLED",
  "PRESENTATIONS_ENABLED",
  "LEARNING_ENHANCEMENTS_ENABLED",
  "NEXT_PUBLIC_LIVE_CLASSES_ENABLED",
  "NEXT_PUBLIC_PRESENTATIONS_ENABLED",
  "NEXT_PUBLIC_LEARNING_ENHANCEMENTS_ENABLED",
  "NEXT_PUBLIC_JITSI_DOMAIN",
  "NEXT_PUBLIC_REALTIME_URL",
] as const;

/**
 * Import a fresh copy of the flags module under a given environment.
 *
 * Clears every flag var first rather than only setting the ones a test names,
 * so a var leaking in from the developer's real `.env` cannot make a test pass
 * that should fail.
 */
async function loadFeatures(env: Partial<Record<(typeof FLAG_VARS)[number], string>>) {
  vi.resetModules();
  for (const key of FLAG_VARS) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./features");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("server feature flags", () => {
  it("are all off when nothing is configured", async () => {
    const { features } = await loadFeatures({});

    expect(features.liveClasses).toBe(false);
    expect(features.presentations).toBe(false);
    expect(features.learningEnhancements).toBe(false);
  });

  it('turn on for exactly the string "true"', async () => {
    const { features } = await loadFeatures({ LIVE_CLASSES_ENABLED: "true" });

    expect(features.liveClasses).toBe(true);
  });

  it("tolerate surrounding whitespace from dashboard pastes", async () => {
    const { features } = await loadFeatures({ LIVE_CLASSES_ENABLED: "  true \n" });

    expect(features.liveClasses).toBe(true);
  });

  // Each of these is a plausible value someone types meaning "on". None of them
  // may be honoured: a permissive parser is how a feature turns itself on in
  // production without anyone deciding that it should.
  it.each(["1", "TRUE", "True", "yes", "on", "enabled", "false", " "])(
    "stays off for the ambiguous value %o",
    async (raw) => {
      const { features } = await loadFeatures({ LIVE_CLASSES_ENABLED: raw });

      expect(features.liveClasses).toBe(false);
    },
  );

  it("are independent of one another", async () => {
    // Presentations carry no external-service dependency, so they must be able
    // to ship while live classes stay dark. This asserts the two flags are not
    // secretly coupled.
    const { features } = await loadFeatures({ PRESENTATIONS_ENABLED: "true" });

    expect(features.presentations).toBe(true);
    expect(features.liveClasses).toBe(false);
    expect(features.learningEnhancements).toBe(false);
  });

  it("does not leak the server flag into the public one", async () => {
    // Setting only the unprefixed var must NOT enable the client-side flag.
    // If it did, a client component would read a value Next.js never inlined
    // and the two halves of the app would disagree about whether the feature
    // exists.
    const { publicFeatures } = await loadFeatures({ LIVE_CLASSES_ENABLED: "true" });

    expect(publicFeatures.liveClasses).toBe(false);
  });
});

describe("live-classes runtime configuration", () => {
  it("defaults the Jitsi domain to the free public deployment", async () => {
    const { liveClassesConfig } = await loadFeatures({});

    expect(liveClassesConfig.jitsiDomain).toBe("meet.jit.si");
  });

  it("lets an operator point at a self-hosted or JaaS deployment", async () => {
    const { liveClassesConfig } = await loadFeatures({
      NEXT_PUBLIC_JITSI_DOMAIN: "meet.codequeenshub.io",
    });

    expect(liveClassesConfig.jitsiDomain).toBe("meet.codequeenshub.io");
  });

  it("treats an empty Jitsi domain as unset rather than as an empty host", async () => {
    const { liveClassesConfig } = await loadFeatures({ NEXT_PUBLIC_JITSI_DOMAIN: "   " });

    expect(liveClassesConfig.jitsiDomain).toBe("meet.jit.si");
  });

  it("reports the realtime URL as undefined when no service is provisioned", async () => {
    const { liveClassesConfig } = await loadFeatures({
      NEXT_PUBLIC_LIVE_CLASSES_ENABLED: "true",
    });

    expect(liveClassesConfig.realtimeUrl).toBeUndefined();
  });
});

describe("isRealtimeAvailable", () => {
  it("is false when the feature is on but no service is configured", async () => {
    // The degraded path: video and attendance still work, the text layer goes
    // read-only. A client that connected here would retry against `undefined`.
    const { isRealtimeAvailable } = await loadFeatures({
      NEXT_PUBLIC_LIVE_CLASSES_ENABLED: "true",
    });

    expect(isRealtimeAvailable()).toBe(false);
  });

  it("is false when a service is configured but the feature is off", async () => {
    const { isRealtimeAvailable } = await loadFeatures({
      NEXT_PUBLIC_REALTIME_URL: "https://realtime.example.com",
    });

    expect(isRealtimeAvailable()).toBe(false);
  });

  it("is true only when both the feature and the service are present", async () => {
    const { isRealtimeAvailable } = await loadFeatures({
      NEXT_PUBLIC_LIVE_CLASSES_ENABLED: "true",
      NEXT_PUBLIC_REALTIME_URL: "https://realtime.example.com",
    });

    expect(isRealtimeAvailable()).toBe(true);
  });
});
