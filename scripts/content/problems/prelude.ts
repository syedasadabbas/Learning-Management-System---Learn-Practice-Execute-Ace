// =============================================================================
// PORTABLE STDIN PRELUDES — seed data. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// A problem is RUN in the browser (free, unlimited, advisory) and GRADED on the
// server via Piston (the only place the hidden tests exist). The same program text
// therefore has to read stdin on both, and the two runtimes do not agree:
//
//   * The browser JavaScript worker injects `readAll()` and `readLine()` as
//     FUNCTION PARAMETERS of the wrapper it compiles the snippet into. There is no
//     `process`, no `require`, and no `globalThis.readAll` — see
//     src/lib/execution/browser/js-worker.ts.
//   * Piston's Node has `require("fs")` and no `readAll`.
//
// `typeof readAll` is the bridge: it resolves to "function" against the injected
// parameter in the browser, and — because `typeof` on an UNDECLARED identifier is
// legal and yields "undefined" rather than a ReferenceError — falls through to the
// Node path on Piston. Any other test (`readAll !== undefined`, a try/catch around
// a bare reference) either throws or needs a wrapper the student would have to
// understand before starting.
//
// Python needs no bridge: Pyodide's `setStdin` and CPython both satisfy
// `sys.stdin.read()`, and the Pyodide worker returns "" at end of input, which is
// exactly EOF (src/lib/execution/browser/pyodide-worker.ts).
//
// These constants are pasted into starter code AND reference solutions so the two
// cannot drift, and so a student reading the starter sees the same first line the
// worked answer uses.
// =============================================================================

/** First line of every JavaScript problem. Reads all of stdin on both runtimes. */
export const JS_STDIN =
  'const stdin = typeof readAll === "function" ? readAll() : require("fs").readFileSync(0, "utf8");';

/** First lines of every Python problem. */
export const PY_STDIN = "import sys\n\nstdin = sys.stdin.read()";

/** Whitespace-separated integers from stdin, JavaScript. */
export const JS_NUMS = `${JS_STDIN}
const nums = stdin.trim().split(/\\s+/).filter(Boolean).map(Number);`;

/** Whitespace-separated integers from stdin, Python. */
export const PY_NUMS = `${PY_STDIN}

nums = [int(part) for part in stdin.split()]`;

/** Non-empty lines from stdin, JavaScript. */
export const JS_LINES = `${JS_STDIN}
const lines = stdin.replace(/\\r/g, "").split("\\n");`;

/** Lines from stdin, Python. */
export const PY_LINES = `${PY_STDIN}

lines = stdin.replace("\\r", "").split("\\n")`;

/**
 * C preamble. Piston only — there is no in-browser C toolchain either.
 *
 * Three headers and no more, chosen so a beginner reading the starter can say what
 * each one is FOR: stdio for scanf/printf, stdlib for malloc/free, string for
 * strlen. A blanket set of includes would teach the opposite lesson, which is the
 * one C beginners most need not to learn — that headers are boilerplate you paste.
 *
 * Note what is NOT shared with CPP_HEAD: no `using namespace std`, obviously, but
 * also no iostream. Piston compiles main.c with gcc as C (src/lib/execution/
 * languages.ts pins the filename for exactly this reason), so a C++ header here
 * would be a compile error rather than a slow include.
 */
export const C_HEAD = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
`;

/** C++ preamble. Piston only — there is no in-browser C++ toolchain. */
export const CPP_HEAD = `#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;
`;
