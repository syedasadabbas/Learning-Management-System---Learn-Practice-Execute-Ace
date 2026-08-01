// =============================================================================
// SQL BROWSER RUNNER (sql.js) — worker script text. Owner: code-execution.
// -----------------------------------------------------------------------------
// sql.js is SQLite compiled to WebAssembly (~1.5 MB). Same CDN reasoning as
// pyodide-worker.ts: fetched on first use, never in a page's initial bundle, and
// no npm dependency because package.json is outside this stream's allowlist.
//
// WHY IT IS ALSO IN A WORKER despite being small.
// A recursive CTE with no termination condition hangs SQLite exactly as an
// infinite loop hangs JavaScript, and SQLite's own interrupt API is not exposed
// through sql.js. `terminate()` is the only stop button, and it needs a worker.
//
// STDIN MEANS "SETUP SQL" HERE.
// SQLite has no stdin. A SQL exercise instead needs a schema and fixture rows
// before the student's query runs, and `stdin` is the field already on
// `RunRequest`, so it carries that setup script. Its output is discarded — only
// the student's own statements produce visible results — so a fixture's INSERTs
// do not pad the answer.
//
// The database lives in memory and is discarded with the worker: no file system
// access, nothing persisted between runs.
// =============================================================================

import { PARTIAL_INTERVAL_MS } from "./worker-host";
import { MAX_STREAM_CHARS } from "../truncate";

/** Pinned, for the same reason as Pyodide: loader and .wasm must match. */
export const SQLJS_VERSION = "1.11.0";
export const SQLJS_CDN_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`;

export function buildSqlJsWorkerScript(): string {
  return `
"use strict";
var CAP = ${MAX_STREAM_CHARS};
var PARTIAL_MS = ${PARTIAL_INTERVAL_MS};
var BASE = ${JSON.stringify(SQLJS_CDN_BASE)};

var loadError = null;
try {
  importScripts(BASE + "sql-wasm.js");
} catch (error) {
  loadError = error && error.message ? error.message : String(error);
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
  function fatal(message) { self.postMessage({ kind: "fatal", message: message }); }

  if (loadError) {
    fatal("SQLite could not be loaded in this browser (" + loadError + "). " +
          "The runtime is fetched on first use and needs network access.");
    return;
  }

  // Fixed-width text tables: a student comparing their result to an expected one
  // needs aligned columns, and this output is also what a lab check compares.
  function renderTable(result) {
    var columns = result.columns || [];
    var rows = result.values || [];
    var widths = columns.map(function (c) { return String(c).length; });
    rows.forEach(function (row) {
      row.forEach(function (cell, i) {
        var len = cell === null ? 4 : String(cell).length; // "NULL"
        if (len > widths[i]) widths[i] = len;
      });
    });
    function pad(text, width) {
      var s = String(text);
      while (s.length < width) s += " ";
      return s;
    }
    var lines = [];
    lines.push(columns.map(function (c, i) { return pad(c, widths[i]); }).join(" | "));
    lines.push(widths.map(function (w) { return new Array(w + 1).join("-"); }).join("-+-"));
    rows.forEach(function (row) {
      lines.push(row.map(function (cell, i) {
        return pad(cell === null ? "NULL" : cell, widths[i]);
      }).join(" | "));
    });
    lines.push("(" + rows.length + (rows.length === 1 ? " row)" : " rows)"));
    return lines.join("\\n");
  }

  initSqlJs({ locateFile: function (file) { return BASE + file; } }).then(function (SQL) {
    var db = new SQL.Database();
    try {
      var setup = String(data.stdin == null ? "" : data.stdin).trim();
      if (setup !== "") {
        // run(), not exec(): the setup script's own result sets are discarded.
        db.run(setup);
      }
    } catch (setupError) {
      // A broken fixture is OUR bug, not the student's — say so explicitly rather
      // than presenting it as a failed query.
      write("err", "Exercise setup SQL failed: " + (setupError && setupError.message ? setupError.message : String(setupError)));
      finish(1);
      db.close();
      return;
    }

    try {
      var results = db.exec(String(data.source == null ? "" : data.source));
      if (!results || results.length === 0) {
        // DDL/DML return no result set. Reporting the row count is the only
        // feedback an UPDATE gives, so it is worth printing.
        write("out", "Statement executed. Rows changed: " + db.getRowsModified() + ".");
      } else {
        results.forEach(function (result, index) {
          if (index > 0) write("out", "");
          write("out", renderTable(result));
        });
      }
      finish(0);
    } catch (queryError) {
      write("err", queryError && queryError.message ? queryError.message : String(queryError));
      finish(1);
    } finally {
      db.close();
    }
  }).catch(function (error) {
    fatal("The SQLite runtime failed to start: " + (error && error.message ? error.message : String(error)));
  });
};
`;
}
