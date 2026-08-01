// =============================================================================
// EXERCISE / CONCEPT REGISTRY — syllabus topic -> explainer + starter snippet
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream. Pure data + pure matching; unit-tested in
// registry.test.ts.
//
// Two jobs:
//
//   1. Pick the animated explainers that belong on a given lecture. Matching is
//      done on the lecture title and content, not on lecture ids, because
//      lecture ids are serial values assigned by the seed — they change whenever
//      the database is reseeded, and hardcoding them would silently attach the
//      box-model diagram to a Git lecture.
//
//   2. Offer a starter snippet per concept, so /practice can still hand a student
//      something to type into when a lecture happens to carry no `sandpack`
//      resource. These are OUR snippets, not seeded content — they are clearly
//      labelled as such in the UI so nobody mistakes them for graded work.
// =============================================================================

import type { SandpackExercise } from "./types";
import { normaliseStarterCode } from "./parse";

/** The explainers this stream ships. Add a diagram component per id. */
export type ConceptId = "box-model" | "flex-axes" | "http-cycle";

export const CONCEPT_IDS: readonly ConceptId[] = ["box-model", "flex-axes", "http-cycle"];

export interface ConceptMeta {
  id: ConceptId;
  title: string;
  /** One sentence stating what the diagram teaches. */
  summary: string;
  /**
   * Lowercase substrings matched against lecture title + content. Chosen to be
   * specific: "box" alone would match "box-shadow" and "checkbox".
   */
  keywords: readonly string[];
  /** Starter files for the matching practice snippet (raw, pre-normalisation). */
  starterCode: Record<string, string>;
}

export const CONCEPTS: readonly ConceptMeta[] = [
  {
    id: "box-model",
    title: "The CSS box model",
    summary:
      "Every element is content, then padding, then border, then margin — and box-sizing decides which of those the width includes.",
    keywords: ["box model", "box-sizing", "border-box", "padding", "margin", "specificity", "cascade"],
    starterCode: {
      "/index.html": [
        "<!DOCTYPE html>",
        '<html lang="en">',
        '  <head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>',
        "  <body>",
        '    <div class="box">200 px wide — but how wide on screen?</div>',
        "  </body>",
        "</html>",
      ].join("\n"),
      "/styles.css": [
        ".box {",
        "  width: 200px;",
        "  padding: 20px;",
        "  border: 10px solid #4f5bd5;",
        "  margin: 20px;",
        "  /* TODO: add box-sizing: border-box and watch the on-screen width change */",
        "}",
      ].join("\n"),
    },
  },
  {
    id: "flex-axes",
    title: "Flexbox: main axis vs cross axis",
    summary:
      "justify-content moves items along the main axis; align-items moves them across it — and flex-direction swaps which is which.",
    keywords: ["flexbox", "flex-direction", "justify-content", "align-items", "grid", "layout"],
    starterCode: {
      "/index.html": [
        "<!DOCTYPE html>",
        '<html lang="en">',
        '  <head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>',
        "  <body>",
        '    <div class="row"><span>1</span><span>2</span><span>3</span></div>',
        "  </body>",
        "</html>",
      ].join("\n"),
      "/styles.css": [
        ".row {",
        "  display: flex;",
        "  min-height: 200px;",
        "  border: 2px dashed #55555f;",
        "  /* TODO: try justify-content / align-items, then add flex-direction: column */",
        "}",
        ".row span { padding: 1rem; background: #4f5bd5; color: white; }",
      ].join("\n"),
    },
  },
  {
    id: "http-cycle",
    title: "The HTTP request/response cycle",
    summary:
      "A URL becomes a DNS lookup, a request, a response with a status code, and then a render — deployment problems live at one of those five points.",
    keywords: [
      "how the web works",
      "http",
      "https",
      "dns",
      "request",
      "response",
      "status code",
      "deploy",
      "hosting",
      "server",
    ],
    starterCode: {
      "/index.html": [
        "<!DOCTYPE html>",
        '<html lang="en">',
        '  <head><meta charset="utf-8" /><title>Fetch a response</title></head>',
        "  <body>",
        '    <button id="go">Send a request</button>',
        '    <pre id="out">(nothing yet)</pre>',
        '    <script src="app.js"></script>',
        "  </body>",
        "</html>",
      ].join("\n"),
      "/app.js": [
        "// TODO: fetch() any URL and print response.status plus response.ok into #out.",
        "// Note which line runs before the response arrives — that is asynchrony.",
      ].join("\n"),
    },
  },
];

const BY_ID = new Map<ConceptId, ConceptMeta>(CONCEPTS.map((c) => [c.id, c]));

export function conceptById(id: string): ConceptMeta | null {
  return BY_ID.get(id as ConceptId) ?? null;
}

/**
 * Explainers relevant to a lecture, in registry order. Returns an empty array
 * when nothing matches — a lecture with no relevant diagram shows no diagram
 * rather than an arbitrary one.
 */
export function conceptsForLecture(
  lecture: { title?: string | null; content?: string | null } | null | undefined,
): ConceptMeta[] {
  if (!lecture) return [];
  const haystack = `${lecture.title ?? ""}\n${lecture.content ?? ""}`.toLowerCase();
  if (haystack.trim().length === 0) return [];
  return CONCEPTS.filter((concept) =>
    concept.keywords.some((keyword) => haystack.includes(keyword)),
  );
}

/**
 * A concept's snippet as a ready-to-mount exercise. `lectureId` is only used to
 * build the id; pass 0 for a standalone concept page.
 *
 * Returns null if a snippet in this file is itself malformed — which would be our
 * bug, not the student's, and is caught by registry.test.ts.
 */
export function conceptExercise(id: ConceptId, lectureId = 0): SandpackExercise | null {
  const concept = BY_ID.get(id);
  if (!concept) return null;
  const starter = normaliseStarterCode(concept.starterCode);
  if (!starter.ok) return null;
  return {
    id: `concept-${id}`,
    title: `Try it: ${concept.title}`,
    lectureId,
    files: starter.value.files,
    visibleFiles: starter.value.visibleFiles,
    activeFile: starter.value.activeFile,
    warnings: starter.value.warnings,
  };
}
