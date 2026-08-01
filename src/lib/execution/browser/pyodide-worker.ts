// =============================================================================
// PYTHON BROWSER RUNNER (Pyodide) — worker script text. Owner: code-execution.
// -----------------------------------------------------------------------------
// WHY THE RUNTIME IS FETCHED FROM A CDN AND NOT BUNDLED.
// Pyodide is CPython compiled to WebAssembly: ~10 MB with its stdlib. The stream
// brief is explicit that it must never enter a page's initial bundle, and the
// lecture page's 377 kB → 116 kB win is the precedent. Two ways to honour that:
//
//   (a) `npm i pyodide` + `next/dynamic`, self-hosting the .wasm from /public;
//   (b) `importScripts` from a CDN inside the worker, with no npm dependency.
//
// This is (b), for one hard reason: package.json is outside this stream's write
// allowlist this wave, so (a) cannot be done here without reaching across. It is
// also the smaller footprint — the bytes are never in our build or our bandwidth.
// The cost is real and is stated in the stream report: labs need network access
// on first use and will not work fully offline, and we depend on jsDelivr's
// availability. A CDN failure surfaces as `backend_unavailable`, which is a value
// the caller already handles — never a throw.
//
// WHY A WORKER RATHER THAN THE MAIN THREAD.
// Pyodide runs Python synchronously on whichever thread hosts it. `while True:
// pass` on the main thread freezes the tab with no way back; in a worker,
// `terminate()` ends it and the host returns a `timeout` value. See worker-host.ts.
// =============================================================================

import { PARTIAL_INTERVAL_MS } from "./worker-host";
import { MAX_STREAM_CHARS } from "../truncate";

/**
 * Pinned Pyodide release. Pinned, not "latest": the loader and the wasm/stdlib
 * assets must come from the same release, and an unpinned URL would silently
 * change the Python version under a student mid-course.
 */
export const PYODIDE_VERSION = "0.26.4";
export const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export function buildPyodideWorkerScript(): string {
  return `
"use strict";
var CAP = ${MAX_STREAM_CHARS};
var PARTIAL_MS = ${PARTIAL_INTERVAL_MS};
var BASE = ${JSON.stringify(PYODIDE_CDN_BASE)};

var loadError = null;
try {
  importScripts(BASE + "pyodide.js");
} catch (error) {
  // Captured rather than thrown so the first postMessage gets a specific reason
  // ("the CDN is unreachable") instead of a bare worker error event.
  loadError = error && error.message ? error.message : String(error);
}

// One interpreter per worker, reused across runs in the same worker. The worker
// itself is short-lived (one run), so this mainly guards a future batched host.
var runtimePromise = null;
function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = loadPyodide({ indexURL: BASE });
  }
  return runtimePromise;
}

self.onmessage = function (event) {
  var data = event.data || {};
  var out = "";
  var err = "";
  var lastPost = 0;

  function maybePost() {
    var now = Date.now();
    if (now - lastPost < PARTIAL_MS) return;
    lastPost = now;
    self.postMessage({ kind: "partial", stdout: out, stderr: err });
  }
  function write(stream, text) {
    if (stream === "out") { if (out.length < CAP) out += text + "\\n"; }
    else { if (err.length < CAP) err += text + "\\n"; }
    maybePost();
  }
  function finish(code) {
    self.postMessage({ kind: "done", stdout: out, stderr: err, exitCode: code });
  }
  function fatal(message) {
    self.postMessage({ kind: "fatal", message: message });
  }

  if (loadError) {
    fatal("Python could not be loaded in this browser (" + loadError + "). " +
          "The runtime is fetched on first use and needs network access.");
    return;
  }

  getRuntime().then(function (py) {
    // batched: Pyodide hands us whole lines, so we are not called per character.
    py.setStdout({ batched: function (line) { write("out", line); } });
    py.setStderr({ batched: function (line) { write("err", line); } });

    var lines = String(data.stdin == null ? "" : data.stdin).split("\\n");
    var cursor = 0;
    // input() reads one line per call, and returns "" past the end rather than
    // raising EOFError — an exercise whose fixture stdin is short should not look
    // to the student like a crash in their loop.
    py.setStdin({ stdin: function () { return cursor < lines.length ? lines[cursor++] : ""; } });

    // runPythonAsync so a snippet may use await / asyncio.
    return py.runPythonAsync(String(data.source == null ? "" : data.source)).then(
      function () { finish(0); },
      function (error) {
        // Pyodide puts the full Python traceback in the message; that traceback
        // is the single most useful thing a beginner can be shown.
        write("err", error && error.message ? error.message : String(error));
        finish(1);
      }
    );
  }).catch(function (error) {
    fatal("The Python runtime failed to start: " + (error && error.message ? error.message : String(error)));
  });
};
`;
}
