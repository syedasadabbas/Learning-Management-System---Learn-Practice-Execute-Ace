// @vitest-environment node
// =============================================================================
// EVERY FLAGGED ROUTE ACTUALLY CALLS ITS FEATURE GATE, AND CALLS IT FIRST.
// -----------------------------------------------------------------------------
// WHY A STATIC SCAN AND NOT A REQUEST.
//
// The behavioural test — "with the flag off, this endpoint 404s" — cannot be
// written as an integration test in this repository without a SECOND running
// server, because `src/lib/features.ts` reads `process.env` at module load and
// Next.js inlines the `NEXT_PUBLIC_` twins at build time. Standing up a second
// Next.js server only to prove a negative would also share the one `.next`
// directory with the first, which is a documented way to corrupt both (see the
// hazard note in playwright.config.ts).
//
// More importantly, a request-based test proves the gate for the ONE route it
// calls. The property worth guaranteeing is universal: *every* route under a
// flagged feature is gated, including the one added next week by someone who
// copied a handler that happened to be from an unflagged feature. That is a
// property of the source, so the source is what is checked.
//
// THE ORDER IS PART OF THE PROPERTY, not a stylistic preference.
// src/lib/feature-guard.ts argues it: `apiGuard` answers 401/403, which tells an
// unauthenticated caller that the endpoint exists. If auth ran first, probing a
// disabled feature while signed out would still reveal the whole route map. Flag
// first means a disabled feature is a uniform 404 to everyone and is therefore
// indistinguishable from a feature that was never built. So this file asserts on
// the byte offset of one call relative to the other.
//
// WHAT THIS FILE DOES NOT PROVE: that `featureGate` itself returns a 404. That
// is asserted directly, below, against a stubbed environment.
// =============================================================================

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const API_ROOT = path.join(REPO_ROOT, "src", "app", "api");

/**
 * Which flag each family of routes must be gated on.
 *
 * Keyed by the path prefix under `src/app/api/`. Adding a route to one of these
 * directories opts it into this test automatically, which is the point: the
 * check must not depend on anyone remembering to extend a list.
 */
const FLAGGED_ROUTES: ReadonlyArray<{ prefix: string; flag: string }> = [
  { prefix: "classes/", flag: "liveClasses" },
  { prefix: "presentations/", flag: "presentations" },
  { prefix: "practice-problems/", flag: "learningEnhancements" },
  { prefix: "interview-questions/", flag: "learningEnhancements" },
  { prefix: "visualizations/", flag: "learningEnhancements" },
  // The lecture- and assignment-scoped children only. Their PARENT directories
  // hold unflagged routes that predate this wave, so the match is on the
  // segment, not on the directory root.
  { prefix: "lectures/", flag: "learningEnhancements" },
  { prefix: "assignments/", flag: "learningEnhancements" },
];

/** Segments that identify a wave route nested under a pre-existing parent. */
const NESTED_WAVE_SEGMENTS = ["practice-problems", "visualizations", "samples"];

/** The HTTP verbs Next.js will route to. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

interface RouteFile {
  /** Path relative to src/app/api, with forward slashes. */
  rel: string;
  flag: string;
  source: string;
}

/** Every `route.ts` under src/app/api, as a POSIX-style relative path. */
function allRouteFiles(dir = API_ROOT, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...allRouteFiles(path.join(dir, entry.name), rel));
    else if (entry.name === "route.ts") out.push(rel);
  }
  return out;
}

function collectRoutes(): RouteFile[] {
  const found: RouteFile[] = [];
  for (const rel of allRouteFiles()) {
    const entry = FLAGGED_ROUTES.find((candidate) => rel.startsWith(candidate.prefix));
    if (!entry) continue;

    // `lectures/` and `assignments/` also contain routes that predate this
    // wave and are correctly ungated. Only their wave-added children count.
    const nestedParent = entry.prefix === "lectures/" || entry.prefix === "assignments/";
    if (nestedParent && !NESTED_WAVE_SEGMENTS.some((seg) => rel.split("/").includes(seg))) {
      continue;
    }

    found.push({ rel, flag: entry.flag, source: readFileSync(path.join(API_ROOT, rel), "utf8") });
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

const routes = collectRoutes();

describe("feature-gate coverage across the flagged API surface", () => {
  it("found the route files it is supposed to be checking", () => {
    // A glob that silently matches nothing turns this whole file into a
    // no-op that reports as passing — the exact failure mode the suite exists
    // to prevent elsewhere. 30 is a floor, not the count, so adding routes does
    // not break the test.
    expect(routes.length, "the globs matched no route files — has src/app/api moved?").toBeGreaterThan(
      30,
    );
  });

  for (const route of routes) {
    describe(route.rel, () => {
      it(`calls featureGate("${route.flag}")`, () => {
        expect(
          route.source,
          `${route.rel} exports a handler but never calls featureGate. With the flag off, this ` +
            `endpoint stays reachable — which makes the flag cosmetic rather than a release switch.`,
        ).toContain(`featureGate("${route.flag}")`);
      });

      it("calls the feature gate BEFORE the auth guard", () => {
        const gateAt = route.source.indexOf("featureGate(");
        const authAt = route.source.indexOf("apiGuard(");
        if (authAt === -1) return; // no auth guard in this file; nothing to order

        expect(gateAt).toBeGreaterThan(-1);
        expect(
          gateAt,
          `${route.rel} calls apiGuard before featureGate. A disabled feature would then answer ` +
            `401/403 to an anonymous prober, confirming the endpoint exists — see the ordering ` +
            `argument in src/lib/feature-guard.ts.`,
        ).toBeLessThan(authAt);
      });

      it("gates every exported HTTP method", () => {
        // One `featureGate` call in a file that exports GET, POST and DELETE
        // gates one of them. Count the exported verbs and require at least as
        // many gate calls.
        const exported = HTTP_METHODS.filter((verb) =>
          new RegExp(`export\\s+async\\s+function\\s+${verb}\\b`).test(route.source),
        );
        const gateCalls = route.source.match(/featureGate\(/g)?.length ?? 0;
        expect(
          gateCalls,
          `${route.rel} exports ${exported.join(", ")} (${exported.length} handlers) but calls ` +
            `featureGate ${gateCalls} time(s). At least one handler is ungated.`,
        ).toBeGreaterThanOrEqual(exported.length);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// The gate's own behaviour
// ---------------------------------------------------------------------------

describe("featureGate returns a 404 that reveals nothing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Load a fresh copy of the guard with the environment as stubbed. */
  async function loadGuard(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return import("@/lib/feature-guard");
  }

  it("answers 404 — not 403 — when the flag is unset", async () => {
    // 403 advertises that the endpoint exists and invites probing. This is the
    // single most important character of the whole flag mechanism.
    const { featureGate } = await loadGuard({ LIVE_CLASSES_ENABLED: undefined });
    const response = featureGate("liveClasses");
    expect(response).not.toBeNull();
    expect(response?.status).toBe(404);
  });

  it("marks the 404 uncacheable so flipping the flag on takes effect immediately", async () => {
    // A CDN that pinned this 404 would keep the feature dark for the whole TTL
    // after an operator switched it on — from the dashboard, during an incident.
    const { featureGate } = await loadGuard({ PRESENTATIONS_ENABLED: undefined });
    expect(featureGate("presentations")?.headers.get("cache-control")).toBe("no-store");
  });

  it("leaks no hint that a flag was involved", async () => {
    const { featureGate } = await loadGuard({ LEARNING_ENHANCEMENTS_ENABLED: undefined });
    const body = await featureGate("learningEnhancements")!.text();
    expect(body.toLowerCase()).not.toContain("flag");
    expect(body.toLowerCase()).not.toContain("disabled");
    expect(body.toLowerCase()).not.toContain("feature");
    expect(JSON.parse(body)).toEqual({ error: "Not Found" });
  });

  it("returns null — proceed — only for the exact string \"true\"", async () => {
    const { featureGate } = await loadGuard({ LIVE_CLASSES_ENABLED: "true" });
    expect(featureGate("liveClasses")).toBeNull();
  });

  it.each(["1", "TRUE", "True", "yes", "on", "", " false "])(
    "still gates when the value is %j — a permissive parser is how a feature switches itself on",
    async (value) => {
      const { featureGate } = await loadGuard({ LIVE_CLASSES_ENABLED: value });
      expect(featureGate("liveClasses")?.status).toBe(404);
    },
  );

  it("tolerates whitespace around a genuine \"true\"", async () => {
    // Dashboard text inputs and .env files both collect trailing whitespace, and
    // that is not the operator's mistake to pay for.
    const { featureGate } = await loadGuard({ PRESENTATIONS_ENABLED: "  true  " });
    expect(featureGate("presentations")).toBeNull();
  });

  it("gates each feature independently", async () => {
    // Presentations carry no external-service dependency and must be able to
    // ship while live classes stay dark.
    const { featureGate } = await loadGuard({
      PRESENTATIONS_ENABLED: "true",
      LIVE_CLASSES_ENABLED: undefined,
      LEARNING_ENHANCEMENTS_ENABLED: undefined,
    });
    expect(featureGate("presentations")).toBeNull();
    expect(featureGate("liveClasses")?.status).toBe(404);
    expect(featureGate("learningEnhancements")?.status).toBe(404);
  });
});
