// =============================================================================
// The allow-list is the security boundary between a request body and a runtime,
// so these tests are about what must NOT resolve as much as what must.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  EXECUTION_LANGUAGES,
  LANGUAGE_SPECS,
  hasBrowserBackend,
  resolveLanguage,
  resolveLanguageSpec,
} from "./languages";

describe("resolveLanguage", () => {
  it("resolves every canonical id to itself", () => {
    for (const id of EXECUTION_LANGUAGES) {
      expect(resolveLanguage(id)).toBe(id);
    }
  });

  it("accepts the spellings students and seeded content actually use", () => {
    expect(resolveLanguage("js")).toBe("javascript");
    expect(resolveLanguage("Node.JS")).toBe("javascript");
    expect(resolveLanguage("  PY  ")).toBe("python");
    expect(resolveLanguage("C++")).toBe("cpp");
    expect(resolveLanguage("sqlite3")).toBe("sql");
  });

  it("refuses anything not on the list, including shells", () => {
    // These are real Piston runtimes. Resolving any of them would mean a request
    // body could pick a shell on the execution host.
    for (const hostile of ["bash", "sh", "powershell", "deno", "php", "ruby"]) {
      expect(resolveLanguage(hostile)).toBeNull();
    }
  });

  it("does not fuzzy-match near misses", () => {
    // A typo must surface as unsupported_language, not grade against a runtime
    // the question's author never chose.
    expect(resolveLanguage("pythonn")).toBeNull();
    expect(resolveLanguage("javascript ")).toBe("javascript"); // trimmed, still exact
    expect(resolveLanguage("java script")).toBeNull();
  });

  it("treats empty, whitespace and non-strings as unresolved rather than throwing", () => {
    expect(resolveLanguage("")).toBeNull();
    expect(resolveLanguage("   ")).toBeNull();
    expect(resolveLanguage(null)).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
    // Defensive: the route validates with Zod, but grand-quiz reads `language`
    // from seeded content, which is not schema-checked at the call site.
    expect(resolveLanguage(42 as unknown as string)).toBeNull();
  });
});

describe("LANGUAGE_SPECS", () => {
  it("never carries a caller-supplied string into pistonLanguage", () => {
    for (const id of EXECUTION_LANGUAGES) {
      const spec = LANGUAGE_SPECS[id];
      expect(spec.pistonLanguage).toMatch(/^[a-z0-9+.]+$/);
      expect(spec.pistonVersion).toBe("*");
    }
  });

  it("names Java's file after its public class, which its compiler requires", () => {
    expect(LANGUAGE_SPECS.java.filename).toBe("Main.java");
  });

  it("gives every language a filename whose extension drives Piston's compile step", () => {
    expect(LANGUAGE_SPECS.cpp.filename.endsWith(".cpp")).toBe(true);
    expect(LANGUAGE_SPECS.python.filename.endsWith(".py")).toBe(true);
    expect(LANGUAGE_SPECS.sql.filename.endsWith(".sql")).toBe(true);
  });
});

describe("hasBrowserBackend", () => {
  it("is true only for the three languages with an in-browser runtime", () => {
    expect(hasBrowserBackend("javascript")).toBe(true);
    expect(hasBrowserBackend("python")).toBe(true);
    expect(hasBrowserBackend("sql")).toBe(true);
    // Compiled / needs a toolchain: these must go server-side.
    expect(hasBrowserBackend("cpp")).toBe(false);
    expect(hasBrowserBackend("java")).toBe(false);
    expect(hasBrowserBackend("typescript")).toBe(false);
    expect(hasBrowserBackend("bash")).toBe(false);
  });

  it("agrees with the spec table", () => {
    for (const id of EXECUTION_LANGUAGES) {
      expect(hasBrowserBackend(id)).toBe(resolveLanguageSpec(id)?.browserBackend != null);
    }
  });
});
