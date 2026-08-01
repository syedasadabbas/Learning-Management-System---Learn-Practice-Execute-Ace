// =============================================================================
// CODING-PROBLEM CATALOGUE — seed data only, no application code.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// A STARTER SET: roughly five problems per track per level, split between the
// syllabus practice bank (`isInterview: false`, served at /problems) and the
// interview bank (`isInterview: true`, served at /interview). It is a starting
// point for a cohort, not a finished catalogue — see the note in the stream report.
//
// ORIGINAL PROSE ONLY. `docs/DECISIONS.md` is binding: "Coding problem text |
// original statements only | do not paste proprietary LeetCode/HackerRank text".
// The classic PATTERNS these problems drill (two-pointer, sliding window, hash-map
// counting, stack matching, BFS/topological order, memoisation, normalisation,
// window functions) are common knowledge and not ownable. Every statement, hint,
// example and test name in these files was written for this repository.
//
// EXECUTION MODE PER TRACK, and why:
//   javascript, python, sql, agentic-ai  ->  "browser"
//       Run happens in the student's own browser through the Web Worker, Pyodide
//       and sql.js runners, so practice costs nothing and cannot rate-limit the
//       cohort. Submit still grades server-side, because that is the only place the
//       hidden tests exist (src/lib/problems/service.ts).
//   c, cpp                               ->  "piston"
//       There is no in-browser C or C++ toolchain small enough to ship
//       (src/lib/execution/languages.ts). If Piston is unreachable, Submit returns
//       `backend_unavailable` and the page falls back to the reference solution
//       rather than pretending to grade. Declaring "browser" for either is now a
//       SEED ERROR (src/lib/problems/validate.ts) — it would promise a free local
//       Run that resolves to Piston anyway and fails during an outage.
//   html, css                            ->  "browser" where the requirement is a
//                                            structure, "none" where it is a
//                                            judgement.
//       CHANGED 2026-07-31. Previously every markup problem was "none", so the
//       whole of both tracks was a worked answer with no editor. They now open in
//       the Sandpack editor with a live preview (src/components/problems/
//       MarkupWorkbench.tsx), and the six problems whose requirement can be stated
//       objectively also carry structural assertions and a real Submit
//       (src/lib/problems/markup.ts — read its header for what that grading can and
//       cannot see). The rest keep "none" and their worked answer, because "is this
//       heading structure correct" is a judgement and a checker that pretended
//       otherwise would mark correct answers wrong.
//
//       CONSEQUENCE, deliberate and worth naming: the HTML and CSS level ladders
//       now GATE. A track with nothing gradeable has an unlock requirement of zero
//       (src/lib/problems/progression.ts); one gradeable beginner problem makes the
//       requirement one. Intermediate CSS is therefore no longer open on day one.
//
// The seeder validates every row before its first INSERT. See seed-problems.ts.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

import { agenticAiProblems } from "./agentic-ai";
import { cProblems } from "./c";
import { cppProblems } from "./cpp";
import { cssProblems } from "./css";
import { htmlProblems } from "./html";
import { javascriptProblems } from "./javascript";
import { pythonProblems } from "./python";
import { sqlProblems } from "./sql";

export const problemCatalogue: SeedProblem[] = [
  ...javascriptProblems,
  ...pythonProblems,
  ...sqlProblems,
  ...cProblems,
  ...cppProblems,
  ...agenticAiProblems,
  ...htmlProblems,
  ...cssProblems,
];

export {
  agenticAiProblems,
  cProblems,
  cppProblems,
  cssProblems,
  htmlProblems,
  javascriptProblems,
  pythonProblems,
  sqlProblems,
};
