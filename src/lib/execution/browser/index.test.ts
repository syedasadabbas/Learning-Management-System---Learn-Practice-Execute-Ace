// =============================================================================
// Browser-backend tests. jsdom provides no `Worker` and no
// `URL.createObjectURL`, which is useful rather than limiting: it exercises the
// "this browser cannot run code locally" path, and it proves the module degrades
// to a VALUE instead of throwing when the runtime is missing.
//
// The runners themselves (a real Web Worker, a real Pyodide download) need a real
// browser and are covered by tests/e2e/code-execution/*.spec.ts.
// =============================================================================

import { describe, expect, it } from "vitest";

import { runInBrowser, BROWSER_RUNNABLE } from "./index";
import { buildJsWorkerScript } from "./js-worker";
import { buildPyodideWorkerScript, PYODIDE_CDN_BASE } from "./pyodide-worker";
import { buildSqlJsWorkerScript, SQLJS_CDN_BASE } from "./sqljs-worker";
import { shouldDeferToInstructor } from "../types";

describe("runInBrowser", () => {
  it("refuses a language with no in-browser runtime, without pretending to run it", async () => {
    const result = await runInBrowser({ language: "c++", source: "int main(){}" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_language");
    expect(result.message).toContain("server runner");
    // A missing browser runtime is not an infrastructure outage, so it does not
    // send the item to an instructor.
    expect(shouldDeferToInstructor(result)).toBe(false);
  });

  it("refuses an unlisted language too", async () => {
    const result = await runInBrowser({ language: "bash", source: "ls" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_language");
    expect(result.language).toBeNull();
  });

  it("returns backend_unavailable — never a throw — where Workers do not exist", async () => {
    const result = await runInBrowser({ language: "javascript", source: "console.log(1)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("backend_unavailable");
    expect(shouldDeferToInstructor(result)).toBe(true);
  });

  it("refuses an oversized program before building a worker", async () => {
    const result = await runInBrowser({
      language: "javascript",
      source: "//".repeat(200_000),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unsupported_language");
  });

  it("lists exactly the three languages with a browser runtime", () => {
    expect([...BROWSER_RUNNABLE]).toEqual(["javascript", "python", "sql"]);
  });
});

describe("worker scripts", () => {
  it("never interpolate program text — the source arrives as postMessage data", () => {
    // Each builder takes NO arguments. If a builder ever accepted the snippet,
    // a student's code would become part of the script and escape the wrapper.
    expect(buildJsWorkerScript.length).toBe(0);
    expect(buildPyodideWorkerScript.length).toBe(0);
    expect(buildSqlJsWorkerScript.length).toBe(0);
  });

  it("read the program from event.data and post a done message", () => {
    for (const script of [
      buildJsWorkerScript(),
      buildPyodideWorkerScript(),
      buildSqlJsWorkerScript(),
    ]) {
      expect(script).toContain("self.onmessage");
      expect(script).toContain('kind: "done"');
      expect(script).toContain('kind: "partial"');
    }
  });

  it("fetch the heavy runtimes from a pinned CDN release, so nothing is bundled", () => {
    // Pinned, not "latest": the loader and the .wasm assets must come from one
    // release, and an unpinned URL would change a student's Python mid-course.
    expect(PYODIDE_CDN_BASE).toMatch(/pyodide\/v\d+\.\d+\.\d+\/full\/$/);
    expect(SQLJS_CDN_BASE).toMatch(/sql\.js@\d+\.\d+\.\d+\/dist\/$/);
    expect(buildPyodideWorkerScript()).toContain("importScripts");
    expect(buildSqlJsWorkerScript()).toContain("importScripts");
  });

  it("guards a runtime that fails to load as `fatal`, which becomes backend_unavailable", () => {
    for (const script of [buildPyodideWorkerScript(), buildSqlJsWorkerScript()]) {
      expect(script).toContain('kind: "fatal"');
    }
  });
});
