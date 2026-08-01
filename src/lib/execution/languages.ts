// =============================================================================
// LANGUAGE ALLOW-LIST — the only bridge from a student's string to a runtime.
// Owner: code-execution stream. Pure; unit-tested in languages.test.ts.
// -----------------------------------------------------------------------------
// WHY AN ALLOW-LIST AND NOT A PASS-THROUGH.
// `language` arrives from a request body or from seeded question content, i.e.
// it is attacker-influenced. Forwarding it to Piston verbatim would let a caller
// select any runtime the instance happens to have installed, including shells
// (`bash`, `powershell`) and package-fetching runtimes. Piston sandboxes its
// containers, but "whatever is installed" is not a decision this app should
// delegate to a request body. Seven languages are enough for the curriculum
// (C was added 2026-07-31 for the new `c` problem track).
//
// WHY version "*" AND NOT A PINNED VERSION.
// Piston requires a version and accepts "*" for "latest installed". The public
// instance and a self-hosted Docker instance (FREE_STACK.md's answer to a
// grand-quiz burst) ship different version sets, so a pinned "3.10.0" would make
// the app work against one and 400 against the other. "*" costs us
// reproducibility across instances and buys us portability; the trade-off is
// stated in the stream report rather than silently taken.
//
// WHY FILENAMES MATTER.
// Piston keys its compile step off the file extension, and Java additionally
// requires the file to be named after the public class. `Main.java` is therefore
// not cosmetic — a mismatch is a compile error the student cannot explain.
// =============================================================================

import type { ExecutionLanguage, RunBackend } from "./types";

/** How one allow-listed language is executed. */
export interface LanguageSpec {
  id: ExecutionLanguage;
  /** Human label for UI. */
  label: string;
  /** The runtime name Piston knows. NOT the caller's string. */
  pistonLanguage: string;
  /** See the header: "*" = latest installed on whichever instance we talk to. */
  pistonVersion: string;
  /** Source filename handed to Piston; extension drives its compile step. */
  filename: string;
  /**
   * The in-browser backend for this language, or null when there is none and a
   * run must go server-side. Keeps the "can this run offline" question answerable
   * in one place instead of in every lab component.
   */
  browserBackend: Extract<RunBackend, "worker" | "pyodide" | "sqljs"> | null;
}

export const LANGUAGE_SPECS: Record<ExecutionLanguage, LanguageSpec> = {
  javascript: {
    id: "javascript",
    label: "JavaScript",
    pistonLanguage: "javascript",
    pistonVersion: "*",
    filename: "main.js",
    browserBackend: "worker",
  },
  typescript: {
    id: "typescript",
    label: "TypeScript",
    pistonLanguage: "typescript",
    pistonVersion: "*",
    filename: "main.ts",
    // No browser backend: type-stripping in the browser would mean shipping the
    // TypeScript compiler (~7 MB) to do what Piston already does server-side.
    browserBackend: null,
  },
  python: {
    id: "python",
    label: "Python",
    pistonLanguage: "python",
    pistonVersion: "*",
    filename: "main.py",
    browserBackend: "pyodide",
  },
  c: {
    id: "c",
    label: "C",
    // VERIFIED against the public instance's /runtimes on 2026-07-31: the entry is
    // { language: "c", version: "10.2.0", aliases: ["gcc"], runtime: "gcc" }. The
    // runtime id is "c" and NOT "gcc" — "gcc" is only an alias there, and the C++
    // entry is a separate { language: "c++", aliases: ["cpp","g++"] } record backed
    // by the same compiler. Sending "gcc" would resolve, but naming the alias
    // rather than the language would leave a reader guessing which of the two
    // gcc-backed runtimes this row selects.
    pistonLanguage: "c",
    pistonVersion: "*",
    // Extension drives Piston's compile step: main.c compiles as C, main.cpp as
    // C++. A C program in a .cpp file is not the same program — implicit
    // conversions from void* stop compiling, for one — so this is load-bearing.
    filename: "main.c",
    // Compiled language, same as C++: no free in-browser toolchain small enough to
    // ship. `requiresServerRuntime` in src/lib/problems/grading.ts is what turns
    // this null into "no Run button while Piston is down".
    browserBackend: null,
  },
  cpp: {
    id: "cpp",
    label: "C++",
    pistonLanguage: "c++",
    pistonVersion: "*",
    filename: "main.cpp",
    // Compiled language: no free in-browser toolchain small enough to ship.
    // coding-problems falls back to "reference solution, no execution" when the
    // server backend is unavailable — see docs/ADDON_STREAMS.md.
    browserBackend: null,
  },
  java: {
    id: "java",
    label: "Java",
    pistonLanguage: "java",
    pistonVersion: "*",
    // Piston's Java runner compiles the file it is given; the public class must
    // match the filename, so this is fixed and the UI states it.
    filename: "Main.java",
    browserBackend: null,
  },
  sql: {
    id: "sql",
    label: "SQL (SQLite)",
    pistonLanguage: "sqlite3",
    pistonVersion: "*",
    filename: "main.sql",
    browserBackend: "sqljs",
  },
};

/**
 * Accepted spellings, lowercased. Students type "py" and "node"; seeded content
 * says "c++". Normalising here means neither the UI nor the seed has to agree on
 * one spelling, and nothing unlisted resolves.
 */
const ALIASES: Record<string, ExecutionLanguage> = {
  javascript: "javascript",
  js: "javascript",
  node: "javascript",
  nodejs: "javascript",
  "node.js": "javascript",

  typescript: "typescript",
  ts: "typescript",

  python: "python",
  python3: "python",
  py: "python",
  py3: "python",

  // C BEFORE C++, and the two kept strictly apart. Note what is NOT here: "gcc"
  // and "g++". Piston lists "gcc" as an alias of C and "g++" as an alias of C++,
  // but both name the same compiler binary, and a seed row saying "gcc" reads as
  // "some C-family thing" rather than as a choice. Refusing them means such a row
  // fails validation at seed time instead of silently compiling C++ source as C.
  c: "c",
  "c-lang": "c",

  cpp: "cpp",
  "c++": "cpp",
  cplusplus: "cpp",
  cxx: "cpp",

  java: "java",

  sql: "sql",
  sqlite: "sql",
  sqlite3: "sql",
};

/** Every allow-listed language, in a stable order for UI pickers. */
export const EXECUTION_LANGUAGES: readonly ExecutionLanguage[] = [
  "javascript",
  "typescript",
  "python",
  "c",
  "cpp",
  "java",
  "sql",
];

/**
 * Resolve an untrusted language string to an allow-listed id, or null.
 *
 * Trims and lowercases only. No fuzzy matching: "pythonn" must fail loudly as
 * `unsupported_language` rather than quietly grade against a runtime the
 * question's author did not choose.
 */
export function resolveLanguage(raw: string | null | undefined): ExecutionLanguage | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (key === "") return null;
  return ALIASES[key] ?? null;
}

/** The spec for an untrusted string, or null when it is not allow-listed. */
export function resolveLanguageSpec(raw: string | null | undefined): LanguageSpec | null {
  const id = resolveLanguage(raw);
  return id ? LANGUAGE_SPECS[id] : null;
}

/** Can this language run entirely in the student's browser (no server, no Piston)? */
export function hasBrowserBackend(raw: string | null | undefined): boolean {
  return resolveLanguageSpec(raw)?.browserBackend != null;
}
