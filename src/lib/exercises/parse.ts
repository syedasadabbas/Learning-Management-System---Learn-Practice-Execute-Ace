// =============================================================================
// RESOURCES PARSER — jsonb -> renderable exercises
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream. Pure functions only: no React, no DB, no
// Sandpack. Everything here is unit-tested in parse.test.ts.
//
// DESIGN RULE: this module never throws. `lectures.resources` is jsonb written
// by a seed script and (later) by the admin console, so at runtime it can be
// null, an object instead of an array, an array of nulls, or a `sandpack` entry
// whose `starterCode` is missing, empty, or full of non-strings. Every one of
// those cases must degrade to a message on screen, not a 500 on the lecture
// page. Callers therefore get a discriminated result, never an exception.
// =============================================================================

import type {
  Diagnostic,
  ExerciseEntry,
  ExerciseLanguage,
  SandpackExercise,
} from "./types";

// ---------------------------------------------------------------------------
// Small guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// File paths and languages
// ---------------------------------------------------------------------------

/** Extension -> editor language. Anything unlisted falls back to "text". */
const LANGUAGE_BY_EXTENSION: Record<string, ExerciseLanguage> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  json: "json",
  md: "markdown",
  txt: "text",
};

/** Extensions the static preview can actually execute or style with. */
const RUNNABLE_EXTENSIONS = new Set(["html", "htm", "css", "js", "mjs"]);

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function languageForPath(path: string): ExerciseLanguage {
  return LANGUAGE_BY_EXTENSION[extensionOf(path)] ?? "text";
}

export function isRunnablePath(path: string): boolean {
  return RUNNABLE_EXTENSIONS.has(extensionOf(path));
}

/**
 * Normalise a starterCode key into a Sandpack path.
 *
 * Sandpack requires absolute paths ("/index.html"); the seed happens to write
 * them that way, but an admin-authored exercise may not, and Windows-authored
 * JSON can arrive with backslashes. Returns null for a key that cannot be a
 * file path at all (empty, or an attempt to escape the sandbox root).
 */
export function normaliseFilePath(rawPath: string): string | null {
  if (typeof rawPath !== "string") return null;
  let path = rawPath.trim().replace(/\\/g, "/");
  if (path.length === 0) return null;
  // Collapse "./" prefixes and duplicate slashes.
  path = path.replace(/^\.\//, "").replace(/\/{2,}/g, "/");
  if (path.includes("..")) return null; // no directory traversal in a sandbox
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === "/" || path.endsWith("/")) return null; // a directory, not a file
  return path;
}

/**
 * Tab order: the entry document first, then stylesheets, then scripts, then the
 * rest alphabetically. A student opening "centre a card with Flexbox" should land
 * on the HTML, not on whichever key the JSON happened to list first.
 */
const ORDER_BY_LANGUAGE: Record<ExerciseLanguage, number> = {
  html: 0,
  css: 1,
  javascript: 2,
  json: 3,
  markdown: 4,
  text: 5,
};

export function orderFilePaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const rank =
      ORDER_BY_LANGUAGE[languageForPath(a)] - ORDER_BY_LANGUAGE[languageForPath(b)];
    if (rank !== 0) return rank;
    return a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// starterCode normalisation
// ---------------------------------------------------------------------------

export const ENTRY_FILE = "/index.html";

export interface NormalisedStarterCode {
  files: Record<string, string>;
  visibleFiles: string[];
  activeFile: string;
  warnings: string[];
}

export type StarterCodeResult =
  | { ok: true; value: NormalisedStarterCode }
  | { ok: false; reason: string };

/**
 * Build the `<link>`/`<script>` tags an entry document needs so that a
 * CSS-only or JS-only exercise still previews something. Used only when the
 * author supplied no HTML file at all.
 */
function synthesiseEntryHtml(paths: string[]): string {
  const styles = paths
    .filter((p) => languageForPath(p) === "css")
    .map((p) => `    <link rel="stylesheet" href="${p.slice(1)}" />`);
  const scripts = paths
    .filter((p) => languageForPath(p) === "javascript")
    .map((p) => `    <script src="${p.slice(1)}"></script>`);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    "    <title>Practice</title>",
    ...styles,
    "  </head>",
    "  <body>",
    "    <!-- This page was generated because the exercise supplied no HTML file. -->",
    ...scripts,
    "  </body>",
    "</html>",
  ].join("\n");
}

/**
 * Turn an unknown `starterCode` blob into files Sandpack can mount.
 *
 * Accepted, with a warning:
 *   - keys without a leading slash, or with backslashes;
 *   - files with an extension we do not recognise (kept, edited as plain text);
 *   - a file set with no HTML entry document (one is synthesised).
 *
 * Rejected, with a student-readable reason:
 *   - missing / null / non-object / array `starterCode`;
 *   - an object with no usable file at all.
 */
export function normaliseStarterCode(raw: unknown): StarterCodeResult {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: "This exercise has no starter code attached." };
  }
  if (!isRecord(raw)) {
    return {
      ok: false,
      reason:
        "This exercise's starter code is not a set of files, so it cannot be opened in the editor.",
    };
  }

  const entries = Object.entries(raw);
  if (entries.length === 0) {
    return { ok: false, reason: "This exercise's starter code is empty." };
  }

  const files: Record<string, string> = {};
  const warnings: string[] = [];

  for (const [key, value] of entries) {
    const path = normaliseFilePath(key);
    if (path === null) {
      warnings.push(`Skipped a starter file with an unusable name (${JSON.stringify(key)}).`);
      continue;
    }
    if (typeof value !== "string") {
      warnings.push(`Skipped ${path}: its contents are not text.`);
      continue;
    }
    if (path !== key) {
      warnings.push(`Renamed "${key}" to ${path} so the preview can find it.`);
    }
    if (!isRunnablePath(path)) {
      warnings.push(
        `${path} has an extension the preview cannot run; you can still edit it as plain text.`,
      );
    }
    files[path] = value;
  }

  const paths = Object.keys(files);
  if (paths.length === 0) {
    return {
      ok: false,
      reason: "This exercise's starter code contains no usable files.",
    };
  }

  const hasHtml = paths.some((p) => languageForPath(p) === "html");
  if (!hasHtml) {
    files[ENTRY_FILE] = synthesiseEntryHtml(paths);
    warnings.push(
      `No HTML file was supplied, so ${ENTRY_FILE} was generated to host your CSS and JavaScript.`,
    );
  }

  const visibleFiles = orderFilePaths(Object.keys(files));
  // Prefer the seeded entry document when present; otherwise the first tab.
  const activeFile = visibleFiles.includes(ENTRY_FILE) ? ENTRY_FILE : visibleFiles[0];

  return { ok: true, value: { files, visibleFiles, activeFile, warnings } };
}

// ---------------------------------------------------------------------------
// Resource-array parsing
// ---------------------------------------------------------------------------

/** Is this raw jsonb entry a `sandpack` resource (ours) rather than a `link`? */
export function isSandpackResource(raw: unknown): boolean {
  return isRecord(raw) && raw.type === "sandpack";
}

/** Is this raw jsonb entry a `link` resource (course-content's)? */
export function isLinkResource(raw: unknown): boolean {
  return isRecord(raw) && raw.type === "link";
}

/**
 * Every `sandpack` resource on a lecture, parsed. Order is preserved so the ids
 * stay stable across renders (they are `${lectureId}-${index}` over the ORIGINAL
 * resources array, deliberately: filtering first would renumber the exercises
 * whenever course-content adds or removes a link).
 */
export function parseSandpackResources(
  lectureId: number,
  resources: unknown,
): ExerciseEntry[] {
  if (!Array.isArray(resources)) return [];

  const out: ExerciseEntry[] = [];

  resources.forEach((raw, index) => {
    if (!isSandpackResource(raw)) return;
    const record = raw as Record<string, unknown>;
    const id = `${lectureId}-${index}`;
    const title = isNonEmptyString(record.title) ? record.title.trim() : "Practice exercise";

    const starter = normaliseStarterCode(record.starterCode);
    if (!starter.ok) {
      out.push({ ok: false, problem: { id, title, reason: starter.reason } });
      return;
    }

    const exercise: SandpackExercise = {
      id,
      title,
      lectureId,
      files: starter.value.files,
      visibleFiles: starter.value.visibleFiles,
      activeFile: starter.value.activeFile,
      warnings: starter.value.warnings,
    };
    out.push({ ok: true, exercise });
  });

  return out;
}

/** Just the exercises that can be rendered. */
export function usableExercises(entries: ExerciseEntry[]): SandpackExercise[] {
  return entries.flatMap((e) => (e.ok ? [e.exercise] : []));
}

/** Does this lecture offer any in-app practice at all? */
export function hasSandpackResources(resources: unknown): boolean {
  return Array.isArray(resources) && resources.some(isSandpackResource);
}

/** Count of `sandpack` entries, malformed ones included (they still render a card). */
export function countSandpackResources(resources: unknown): number {
  if (!Array.isArray(resources)) return 0;
  return resources.filter(isSandpackResource).length;
}

/**
 * Parse a `[lectureId]` route segment. Lives here rather than in the route file
 * so it can be unit-tested without importing the database client.
 *
 * Returns null for anything that is not a positive integer, so a hand-edited URL
 * yields a 404 rather than `NaN` reaching Drizzle.
 */
export function parseLectureIdParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Warnings from normalisation, presented as diagnostics alongside syntax ones. */
export function warningsAsDiagnostics(exercise: SandpackExercise): Diagnostic[] {
  return exercise.warnings.map((message) => ({
    file: null,
    severity: "warning" as const,
    message,
  }));
}
