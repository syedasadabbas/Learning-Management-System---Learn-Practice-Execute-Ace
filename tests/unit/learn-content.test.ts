// =============================================================================
// LEARN CONTENT VALIDATION — the starter set must be seedable and usable.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// This file is in tests/unit/ rather than colocated because vitest.config.ts only
// collects `src/**/*.test.ts` and `tests/unit/**`, and the content lives under
// scripts/. A colocated test next to the content would never run. Flagged in this
// stream's report as the one file it wrote outside its stated allowlist.
//
// Every assertion below corresponds to a way content can be broken such that a
// STUDENT sees the damage: a duplicate slug aborts the seed halfway, a check with
// no correct answer cannot be answered, a lab in an unrunnable language shows a Run
// button that always fails, and a lab whose language has no browser runner breaks
// this stream's core promise that a concept lab needs no server.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  learnContentStats,
  learnModules,
  validateLearnContent,
} from "../../scripts/content/learn/index";
import type { SeedLabStep } from "../../scripts/content/learn/types";
import { LEARN_LEVELS, LEARN_STEP_KINDS } from "../../src/lib/learn/types";
import {
  parseCheck,
  parseExplain,
  parseLab,
} from "../../src/lib/learn/expectation";

describe("learn content validation", () => {
  it("passes its own validator with no issues", () => {
    const issues = validateLearnContent();
    // Printed rather than just counted: a failure should say what to fix.
    expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
  });

  it("has globally unique module slugs", () => {
    const slugs = learnModules.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("prefixes every slug with its track's convention from the curriculum plan", () => {
    const prefixes: Record<string, string> = {
      oop: "oop-",
      dbms: "dbms-",
      cryptography: "crypto-",
      cybersecurity: "sec-",
    };
    for (const mod of learnModules) {
      const prefix = prefixes[mod.track];
      expect(prefix, `no prefix registered for track ${mod.track}`).toBeDefined();
      expect(mod.slug.startsWith(prefix)).toBe(true);
    }
  });

  it("uses only the declared step kinds and levels", () => {
    for (const mod of learnModules) {
      expect(LEARN_LEVELS).toContain(mod.level);
      for (const step of mod.steps) {
        expect(LEARN_STEP_KINDS).toContain(step.kind);
      }
    }
  });

  it("gives every module at least one lab, so no track is prose only", () => {
    for (const mod of learnModules) {
      const labs = mod.steps.filter((s) => s.kind === "lab");
      expect(labs.length, `${mod.slug} has no lab`).toBeGreaterThan(0);
    }
  });

  it("runs every lab in the browser — no lab needs Piston", () => {
    for (const mod of learnModules) {
      for (const step of mod.steps) {
        if (step.kind !== "lab") continue;
        expect(["javascript", "python", "sql"]).toContain(step.language);
      }
    }
  });

  it("gives every SQL lab a setup script, since SQLite has no stdin", () => {
    for (const mod of learnModules) {
      for (const step of mod.steps) {
        if (step.kind !== "lab" || step.language !== "sql") continue;
        expect(step.setup, `${mod.slug} SQL lab has no fixture`).toBeTruthy();
        expect(step.setup).toMatch(/CREATE TABLE/i);
      }
    }
  });
});

describe("content survives the read-side parsers", () => {
  // The seed writes jsonb and the pages parse it back. If authored content does not
  // round-trip through the parsers, a student sees a step with no diagram, no editor
  // or no question — silently, because the parsers degrade rather than throw.
  it("parses every authored expectation back into a usable shape", () => {
    for (const mod of learnModules) {
      mod.steps.forEach((step, i) => {
        const at = `${mod.slug} step ${i + 1}`;
        if (step.kind === "explain" && step.diagram) {
          const parsed = parseExplain({
            kind: "explain",
            diagramTitle: step.diagram.title,
            frames: step.diagram.frames,
          });
          expect(parsed, `${at}: diagram did not parse`).not.toBeNull();
          expect(parsed!.frames.length).toBe(step.diagram.frames.length);
        }
        if (step.kind === "lab") {
          const parsed = parseLab({
            kind: "lab",
            goal: step.goal,
            hint: step.hint,
            setup: step.setup,
            notProductionReady: step.notProductionReady,
          });
          expect(parsed, `${at}: lab did not parse`).not.toBeNull();
          expect(parsed!.goal).toBe(step.goal);
        }
        if (step.kind === "check") {
          const parsed = parseCheck({
            kind: "check",
            prompt: step.prompt,
            options: step.options,
            explanation: step.explanation,
          });
          // parseCheck refuses zero or two correct options, so this doubles as the
          // exactly-one-correct-answer assertion.
          expect(parsed, `${at}: check did not parse (answer key wrong?)`).not.toBeNull();
        }
      });
    }
  });
});

describe("cryptography and cybersecurity content rules", () => {
  const crypto = learnModules.filter((m) => m.track === "cryptography");
  const security = learnModules.filter((m) => m.track === "cybersecurity");

  it("authored both constrained tracks", () => {
    expect(crypto.length).toBeGreaterThan(0);
    expect(security.length).toBeGreaterThan(0);
  });

  it("uses SubtleCrypto in every cryptography JavaScript lab", () => {
    // The track's rule: browser SubtleCrypto only. No third-party crypto, and no
    // hand-rolled primitive presented as usable.
    for (const mod of crypto) {
      // A type PREDICATE, not a plain boolean callback: the `&&` narrows `s`
      // inside the callback, but filter() still returns SeedStep[], so
      // `lab.starterCode` below would not typecheck without this.
      const jsLabs = mod.steps.filter(
        (s): s is SeedLabStep => s.kind === "lab" && s.language === "javascript",
      );
      expect(jsLabs.length, `${mod.slug} has no JavaScript lab`).toBeGreaterThan(0);
      for (const lab of jsLabs) {
        expect(lab.starterCode, `${mod.slug}: lab does not call crypto.subtle`).toMatch(
          /crypto\.(subtle|getRandomValues)/,
        );
      }
    }
  });

  it("marks any teaching-only construction as not production ready", () => {
    // The ECB-patterning lab builds a deliberately broken scheme. A student who
    // copies it out must not have to infer that it is a demonstration.
    const teachingLabs = crypto
      .flatMap((m) => m.steps.map((s) => ({ slug: m.slug, step: s })))
      .filter((x) => x.step.kind === "lab" && /TEACHING CODE|BROKEN/i.test(x.step.starterCode));
    expect(teachingLabs.length).toBeGreaterThan(0);
    for (const { slug, step } of teachingLabs) {
      if (step.kind !== "lab") continue;
      expect(step.notProductionReady, `${slug}: teaching lab is not flagged`).toBe(true);
    }
  });

  it("keeps the cybersecurity track defensive — no operational attack tooling", () => {
    // A crude guard, deliberately. It cannot prove intent, but it catches the
    // obvious drift: a lab that reaches for a network, a real host, or a tool.
    const forbidden = [
      /\bnmap\b/i,
      /\bsqlmap\b/i,
      /\bmetasploit\b/i,
      /\bhydra\b/i,
      /\bhashcat\b/i,
      /\bjohn the ripper\b/i,
      /\bburp\b/i,
      /https?:\/\/(?!developer\.mozilla\.org|cheatsheetseries\.owasp\.org|www\.w3schools\.com|www\.postgresql\.org|docs\.python\.org|refactoring\.guru)/i,
    ];
    for (const mod of security) {
      for (const step of mod.steps) {
        const text = [step.title, step.body, step.kind === "lab" ? step.starterCode : ""].join(
          "\n",
        );
        for (const pattern of forbidden) {
          expect(pattern.test(text), `${mod.slug}: matched ${pattern}`).toBe(false);
        }
      }
    }
  });

  it("sandboxes the injection demonstration in a fixture the lab itself creates", () => {
    const sqlLabs = security
      .flatMap((m) => m.steps.map((s) => ({ slug: m.slug, step: s })))
      .filter((x) => x.step.kind === "lab" && x.step.language === "sql");
    expect(sqlLabs.length).toBeGreaterThan(0);
    for (const { slug, step } of sqlLabs) {
      if (step.kind !== "lab") continue;
      // The fixture is created in the lab's own setup script, so nothing outside
      // the worker's in-memory database is involved.
      expect(step.setup, `${slug}: SQL lab has no self-created fixture`).toMatch(/CREATE TABLE/i);
      expect(step.starterCode).toMatch(/SANDBOX/);
    }
  });
});

describe("content stats", () => {
  it("reports counts that match the modules", () => {
    const stats = learnContentStats();
    expect(stats.moduleCount).toBe(learnModules.length);
    expect(stats.stepCount).toBe(
      learnModules.reduce((sum, m) => sum + m.steps.length, 0),
    );
    expect(stats.explains + stats.labs + stats.checks).toBe(stats.stepCount);
  });

  it("covers four tracks in the starter set", () => {
    const tracks = learnContentStats().tracks.map((t) => t.track).sort();
    expect(tracks).toEqual(["cryptography", "cybersecurity", "dbms", "oop"]);
  });
});
