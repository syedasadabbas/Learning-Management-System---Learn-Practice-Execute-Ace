import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MOTION_CLASS,
  MOTION_CSS_VAR,
  MOTION_MS,
  motionDurationMs,
  prefersReducedMotion,
} from "./tokens";

// The mirror between MOTION_MS and globals.css is the same kind of hand-kept
// seam as branding.colors -> @theme, and it fails the same way: silently, with
// a component animating at a duration nobody chose. So the test reads the real
// stylesheet off disk rather than trusting a copy.
const CSS_PATH = path.resolve(__dirname, "../../app/globals.css");
const css = readFileSync(CSS_PATH, "utf8");

describe("MOTION_MS", () => {
  it("is a strictly increasing scale of whole milliseconds", () => {
    const values = [
      MOTION_MS.fast,
      MOTION_MS.base,
      MOTION_MS.slow,
      MOTION_MS.ambient,
    ];
    for (const v of values) {
      expect(Number.isInteger(v), `${v} must be a whole number of ms`).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("keeps interactive feedback under the 200 ms responsiveness ceiling", () => {
    // Above roughly 200 ms a hover/press response stops reading as feedback and
    // starts reading as lag. This is the one value in the scale with a hard
    // upper bound rather than a taste bound.
    expect(MOTION_MS.fast).toBeLessThanOrEqual(200);
  });
});

describe("globals.css mirror", () => {
  it.each(Object.keys(MOTION_MS) as Array<keyof typeof MOTION_MS>)(
    "declares %s with the same value as MOTION_MS",
    (speed) => {
      const declaration = new RegExp(
        `${MOTION_CSS_VAR[speed]}:\\s*(\\d+)ms\\s*;`,
      ).exec(css);
      expect(
        declaration,
        `${MOTION_CSS_VAR[speed]} must be declared in globals.css in ms`,
      ).not.toBeNull();
      expect(Number(declaration![1])).toBe(MOTION_MS[speed]);
    },
  );

  it.each(Object.values(MOTION_CLASS))(
    "defines a rule for the .%s class the primitives reference",
    (cls) => {
      expect(css).toContain(`.${cls}`);
    },
  );

  it("switches every animated class off under prefers-reduced-motion", () => {
    // Not a style opinion — this is the accessibility contract from
    // src/lib/exercises/reduced-motion.ts applied to the shell. The e2e spec
    // proves the computed result in a real browser; this proves the rule exists
    // at all, which is the part a careless edit removes.
    const reduceBlock = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}/.exec(
      css,
    );
    expect(reduceBlock, "globals.css must have a reduce block").not.toBeNull();
    const body = reduceBlock![1];
    for (const cls of Object.values(MOTION_CLASS)) {
      expect(body, `.${cls} must be handled in the reduce block`).toContain(
        `.${cls}`,
      );
    }
  });
});

describe("motionDurationMs", () => {
  it("returns the scale value when motion is allowed", () => {
    expect(motionDurationMs("fast", false)).toBe(MOTION_MS.fast);
    expect(motionDurationMs("ambient", false)).toBe(MOTION_MS.ambient);
  });

  it("collapses to 0 ms — not a token value — under reduced motion", () => {
    for (const speed of Object.keys(MOTION_MS) as Array<keyof typeof MOTION_MS>) {
      expect(motionDurationMs(speed, true)).toBe(0);
    }
  });
});

describe("re-export of the house reduced-motion predicate", () => {
  it("is the implementation from src/lib/exercises, not a second copy", async () => {
    const houseModule = await import("../exercises/reduced-motion");
    expect(prefersReducedMotion).toBe(houseModule.prefersReducedMotion);
  });

  it("defaults to false where matchMedia is absent", () => {
    // jsdom provides no matchMedia; the server render hits the same branch.
    expect(prefersReducedMotion({})).toBe(false);
  });
});
