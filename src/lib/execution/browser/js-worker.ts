// =============================================================================
// JAVASCRIPT BROWSER RUNNER — the worker script text. Owner: code-execution.
// -----------------------------------------------------------------------------
// This module exports a STRING, not a component. worker-host.ts turns it into a
// Blob worker, so nothing here executes in the page and nothing is bundled as a
// separate worker chunk.
//
// ON `new Function` INSIDE THE WORKER.
// The stream's prohibition is "never eval untrusted code in the Node process" —
// there, an escape reaches the database credentials. Inside a dedicated worker
// there is no DOM, no cookies, no session, and `terminate()` can stop it, so
// compiling the snippet is the mechanism rather than a violation. The only thing
// a snippet can damage is its own worker.
//
// WHY THE SNIPPET IS WRAPPED IN AN ASYNC IIFE.
// First-course exercises use `await` at what they think is top level. Without the
// wrapper that is a syntax error the student cannot diagnose; with it, both sync
// and async snippets behave. `"use strict"` so an undeclared assignment is the
// error it would be in a module, not a silent global.
//
// The `console` shim is passed as a PARAMETER rather than assigned to the worker
// global, so a snippet reassigning `console` cannot break our capture.
// =============================================================================

import { PARTIAL_INTERVAL_MS } from "./worker-host";
import { MAX_STREAM_CHARS } from "../truncate";

/**
 * Build the worker script.
 *
 * Only numeric constants are interpolated — the program text arrives later as
 * postMessage data, so there is no path by which student code becomes part of
 * this script and escapes the wrapper.
 */
export function buildJsWorkerScript(): string {
  return `
"use strict";
// Caps mirrored from src/lib/execution/truncate.ts. Enforced here as well as in
// the host so a print loop cannot grow an unbounded string inside the worker.
var CAP = ${MAX_STREAM_CHARS};
var PARTIAL_MS = ${PARTIAL_INTERVAL_MS};

function fmt(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || (value.name + ": " + value.message);
  // replacer() is a FACTORY — a fresh WeakSet per call, or the second console.log
  // of the same object would report "[Circular]".
  try { return JSON.stringify(value, replacer(), 2); } catch (_e) { return String(value); }
}
// Cyclic structures are common in exercises about objects; JSON.stringify throws
// on them, and a thrown formatter would look to the student like their bug.
function replacer() {
  var seen = new WeakSet();
  return function (key, value) {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    if (typeof value === "bigint") return value.toString() + "n";
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (value === undefined) return "undefined";
    return value;
  };
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
    if (stream === "out") { if (out.length < CAP) out += text; }
    else { if (err.length < CAP) err += text; }
    maybePost();
  }
  function join(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(fmt(args[i]));
    return parts.join(" ") + "\\n";
  }

  var shim = {
    log: function () { write("out", join(arguments)); },
    info: function () { write("out", join(arguments)); },
    debug: function () { write("out", join(arguments)); },
    table: function () { write("out", join(arguments)); },
    warn: function () { write("err", join(arguments)); },
    error: function () { write("err", join(arguments)); },
  };

  // stdin as lines, so exercises that "read input" work the same way they do on
  // the Piston backend.
  var lines = String(data.stdin == null ? "" : data.stdin).split("\\n");
  var cursor = 0;
  function readLine() { return cursor < lines.length ? lines[cursor++] : ""; }
  function readAll() { return String(data.stdin == null ? "" : data.stdin); }

  function finish(code) {
    self.postMessage({ kind: "done", stdout: out, stderr: err, exitCode: code });
  }

  var run;
  try {
    run = new Function(
      "console", "readLine", "readAll",
      '"use strict"; return (async function () {\\n' + String(data.source == null ? "" : data.source) + "\\n})();"
    );
  } catch (syntaxError) {
    // A SyntaxError never reaches the catch below because it happens at compile
    // time. Reported as a normal non-zero exit: it IS the student's result.
    write("err", fmt(syntaxError));
    finish(1);
    return;
  }

  try {
    Promise.resolve(run(shim, readLine, readAll)).then(
      function () { finish(0); },
      function (rejection) { write("err", fmt(rejection)); finish(1); }
    );
  } catch (thrown) {
    write("err", fmt(thrown));
    finish(1);
  }
};
`;
}
