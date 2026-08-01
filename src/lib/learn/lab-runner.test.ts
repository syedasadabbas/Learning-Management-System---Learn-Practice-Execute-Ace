// =============================================================================
// LAB RUNNER DEGRADATION — what a lab does when there is no browser runtime.
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES *NOT* TEST, AND WHY.
//
// jsdom provides no `Worker` and no `URL.createObjectURL`, which is exactly what
// worker-host.ts needs to run a snippet. So the actual behaviour of a lab — does
// this JavaScript print 12, does this SQL return three rows — is NOT unit-testable
// here, and pretending otherwise would mean mocking the runtime until the test only
// exercised the mock. That behaviour belongs in Playwright, in a real browser, and
// tests/e2e/interactive-learning/learn.spec.ts is where it is asserted.
//
// AMENDED 2026-07-31: that reasoning holds for the WORKER, but it was applied too
// widely. The worker's script is a string this repository generates, and the last
// group of tests in this file evaluates it directly — so "does this JavaScript
// print 42" IS answerable here after all. What still needs a real browser is the
// isolation and the plumbing around it, not the program logic. See that group's
// own comment for the exact split.
//
// What IS worth pinning here is the contract a lab step depends on: `runInBrowser`
// returns a FAILURE VALUE and never rejects. A lab that throws inside a click
// handler has no error boundary above it, and the student loses the page. So these
// tests assert "a value came back", not "the code ran".
// =============================================================================

import { describe, expect, it } from "vitest";

import { runInBrowser, BROWSER_RUNNABLE } from "@/lib/execution/browser";
import { buildJsWorkerScript } from "@/lib/execution/browser/js-worker";

import { LAB_LANGUAGES } from "./types";

describe("lab languages", () => {
  it("declares exactly the languages that have an in-browser runner", () => {
    // The premise of this stream is that a concept lab needs no server. If these
    // two lists ever diverge, some lab is silently relying on Piston.
    expect([...LAB_LANGUAGES].sort()).toEqual([...BROWSER_RUNNABLE].sort());
  });
});

describe("runInBrowser never throws at a lab step", () => {
  it("returns a failure value for a language it cannot run", async () => {
    const result = await runInBrowser({ language: "cobol", source: "DISPLAY 1." });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_language");
  });

  it("returns a value rather than rejecting for each lab language in an environment with no Worker", async () => {
    // jsdom has no Worker and no createObjectURL, so every one of these takes the
    // degraded path. The assertion is deliberately weak — that a RunResult came
    // back at all — because that is the whole guarantee a lab UI relies on.
    for (const language of LAB_LANGUAGES) {
      const result = await runInBrowser({ language, source: "" });
      expect(result).toBeTypeOf("object");
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("stdout");
      expect(result).toHaveProperty("stderr");
      expect(result).toHaveProperty("runtimeMs");
    }
  });

  it("returns a value for a nonsense language identifier", async () => {
    const result = await runInBrowser({ language: "", source: "x" });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The JavaScript worker's PROGRAM LOGIC, without a Worker
// ---------------------------------------------------------------------------
// Added 2026-07-31. The header above says the behaviour of a lab is not unit
// testable, and that is still true of the WORKER — but it conflated two things,
// and the conflation cost a day: `buildJsWorkerScript()` returns a plain string,
// and a string can be evaluated against a stand-in `self` right here. Nothing
// executed it, so the CHANGELOG's "a lab actually running is unverified
// anywhere" was accurate, and the e2e spec that was supposed to cover it
// (tests/e2e/interactive-learning/learn.spec.ts, "a JavaScript lab executes with
// no server round trip") had been red since 2026-07-30.
//
// WHAT THIS PROVES: the console shim captures output, arguments are joined with a
// single space, the async wrapper lets a snippet `await` at top level, and a
// SyntaxError is reported as the student's own non-zero result rather than as a
// crash. In particular it proves the exact program that e2e spec runs produces
// the exact text it waits for.
//
// WHAT IT DOES NOT PROVE, and what still needs a real browser: `new Worker(blob)`,
// `URL.createObjectURL`, the structured-clone boundary, and the host's
// terminate-on-timeout. Evaluated here, the snippet shares this realm — so this
// is a test of the script's LOGIC, never of its isolation.
interface WorkerDone {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Evaluate the worker script against a fake `self` and resolve on its done message. */
function runJsWorkerScript(source: string, stdin = ""): Promise<WorkerDone> {
  const script = buildJsWorkerScript();
  return new Promise<WorkerDone>((resolve, reject) => {
    const fakeSelf: {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage: (message: { kind: string } & Partial<WorkerDone>) => void;
    } = {
      onmessage: null,
      postMessage: (message) => {
        // "partial" messages are progress; only "done" ends a run.
        if (message.kind !== "done") return;
        resolve({
          stdout: message.stdout ?? "",
          stderr: message.stderr ?? "",
          exitCode: message.exitCode ?? null,
        });
      },
    };
    // `new Function` on OUR OWN generated script, not on student input — the
    // snippet still arrives as postMessage data exactly as it does in a real
    // worker (no eslint-disable needed: the rule does not fire on this shape).
    new Function("self", script)(fakeSelf);
    if (!fakeSelf.onmessage) {
      reject(new Error("The worker script registered no onmessage handler."));
      return;
    }
    fakeSelf.onmessage({ data: { source, stdin } });
  });
}

describe("the JavaScript lab runner's program logic", () => {
  it("runs the exact program the e2e lab spec runs, and prints exactly what it waits for", async () => {
    // Keep in step with tests/e2e/interactive-learning/learn.spec.ts. `6 * 7` is
    // computed, so this output cannot come from anywhere but an engine.
    const done = await runJsWorkerScript("console.log('lab-ran', 6 * 7);");
    expect(done.stdout).toBe("lab-ran 42\n");
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
  });

  it("runs a lab in the shape the seeded content uses: an object with methods", async () => {
    const done = await runJsWorkerScript(
      [
        "const account = { balance: 100, deposit(n) { this.balance += n; } };",
        "account.deposit(50);",
        "console.log(account.balance);",
      ].join("\n"),
    );
    expect(done.stdout).toBe("150\n");
    expect(done.exitCode).toBe(0);
  });

  it("allows `await` at what a student thinks is top level", async () => {
    const done = await runJsWorkerScript(
      "const value = await Promise.resolve(7);\nconsole.log(value * 6);",
    );
    expect(done.stdout).toBe("42\n");
    expect(done.exitCode).toBe(0);
  });

  it("reports a syntax error as the student's result, not as a crash", async () => {
    const done = await runJsWorkerScript("console.log('unclosed");
    expect(done.exitCode).toBe(1);
    expect(done.stderr).toMatch(/SyntaxError/);
    expect(done.stdout).toBe("");
  });

  it("sends console.error to stderr and keeps stdout separate", async () => {
    const done = await runJsWorkerScript("console.log('out');console.error('bad');");
    expect(done.stdout).toBe("out\n");
    expect(done.stderr).toBe("bad\n");
  });

  it("reads stdin a line at a time, the way the Piston backend does", async () => {
    const done = await runJsWorkerScript("console.log(readLine());console.log(readLine());", "a\nb");
    expect(done.stdout).toBe("a\nb\n");
  });
});
