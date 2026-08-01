// =============================================================================
// MARKUP GRADING — HTML and CSS as a checkable submission. Pure, no dependencies.
// Owner: coding-problems stream. Unit-tested in markup.test.ts.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL.
// Until now every HTML and CSS problem carried `execution: "none"` and rendered as
// a statement plus a worked answer (scripts/content/problems/html.ts header, and
// src/lib/problems/grading.ts:223 `isExecutable`). The product owner's complaint is
// exact: "they get a worked answer and no editor at all". The editor half is
// answered by reusing the interactive-exercises Sandpack editor
// (src/components/exercises/LiveEditor.tsx) from src/components/problems/
// MarkupWorkbench.tsx. THIS file answers the other half — what "submit" means for
// markup, given that no runtime anywhere produces a pass or a fail for a stylesheet.
//
// THE GRADING DECISION, AND ITS LIMITS. STATED, NOT ASSUMED.
// Four options were on the table. What was chosen and why the other three were not:
//
//   1. DOM/RENDER COMPARISON (screenshot or computed-style diff against the
//      reference solution). REJECTED. It needs a headless browser on the request
//      path; the free stack has none (docs/FREE_STACK.md), Vercel's hobby function
//      budget is 10 s (src/lib/execution/timeouts.ts:27), and a pixel or
//      computed-style diff marks a correct answer wrong for a one-pixel difference
//      in an unrelated property. That is the single worst failure mode for a
//      beginner: wrong, with no explicable reason.
//   2. TEXT COMPARISON against the reference solution using the existing "text"
//      comparison mode. REJECTED, and it is the tempting one because it is free.
//      There are hundreds of correct ways to write the same document — attribute
//      order, quoting, indentation, `<br/>` vs `<br />`, an extra wrapper div — and
//      exactly one of them would pass. `normaliseOutput` in grading.ts fixes line
//      endings and trailing spaces; it cannot fix "you wrote the attributes in a
//      different order".
//   3. jsdom ON THE SERVER, parsing the submission into a real DOM. REJECTED for a
//      dull but binding reason: jsdom is a DEV dependency (package.json:69) and
//      package.json is outside this stream's file ownership this wave, so promoting
//      it to a runtime dependency is not a change this agent may make. It is the
//      right upgrade later — see the TODO at the foot of this comment.
//   4. STRUCTURAL ASSERTIONS over the submitted source — CHOSEN. Each test's
//      `expected_output` holds a short list of requirements ("there is an <h1>",
//      "the .card rule sets margin-inline to auto") and the test passes when the
//      submission satisfies every one of them.
//
// WHY OPTION 4 IS DEFENSIBLE, AND WHERE IT IS NOT.
//   + It marks the thing the problem actually asked for. `html-valid-document-
//     skeleton` asks for a doctype, a lang, a charset and a viewport; those are four
//     assertions and nothing else is graded, so a student who also adds a <nav> is
//     not punished for it.
//   + It is PURE and isomorphic, so the same code answers "check my work" in the
//     browser (advisory, free, instant) and "submit" on the server (authoritative,
//     hidden assertions included) — the same argument buildRunRequest makes in
//     grading.ts for keeping Run and Submit from disagreeing about the program.
//   + A failing assertion has a sentence attached, so the feedback is "no element
//     sets `lang`", not "expected X got Y".
//   - IT DOES NOT CHECK THAT THE PAGE LOOKS RIGHT. It checks that the constructs the
//     problem asked for are present and well-formed. A student can satisfy
//     `declares .card | margin-inline: auto` and still ship an ugly page, and a
//     student who centres the card a different but equally valid way FAILS. That is
//     a real cost, and the mitigation is content-side, not code-side: only problems
//     with an objectively stateable requirement were converted to graded (six of
//     them). Every judgement-shaped problem — "is this heading structure correct" —
//     stays `execution: "none"` and keeps its worked answer. See
//     scripts/content/problems/html.ts and css.ts.
//   - THE SCANNER IS NOT A SPEC-COMPLIANT PARSER. It is a tolerant tokeniser (no
//     dependency is available, see option 3). It strips comments and honours quoted
//     attribute values, so the ordinary cases are right; it does not build a tree,
//     so it cannot answer "is this <li> inside a <ul>", and unusual constructs
//     (an unquoted attribute value containing ">", CDATA, a template literal in an
//     inline script that looks like a tag) can mis-tokenise. Nesting checks are
//     therefore NOT in the assertion vocabulary rather than being present and
//     unreliable.
//
// TODO(upgrade): when package.json is writable by a stream that owns it, move the
// HTML scan onto a real parser (jsdom, or `parse5` which is smaller) and add the
// nesting assertions this vocabulary deliberately omits. The assertion GRAMMAR and
// the seeded content would not need to change — only `indexMarkup` below.
//
// Units: none of this file measures anything, but where it does (nothing yet), ms.
// =============================================================================

// ---------------------------------------------------------------------------
// Which languages are graded this way
// ---------------------------------------------------------------------------

/**
 * The two languages graded by structural assertion rather than by running a
 * program. Deliberately NOT added to src/lib/execution/languages.ts: that file is
 * the allow-list of RUNTIMES Piston may be asked for, and there is no `html`
 * runtime. Conflating the two would mean a markup problem could be dispatched to
 * Piston, which would answer with a compile error nobody can act on.
 */
export const MARKUP_LANGUAGES = ["html", "css"] as const;

export type MarkupLanguage = (typeof MARKUP_LANGUAGES)[number];

/** Narrow an untrusted language string (seed row, DB column) to a markup one. */
export function isMarkupLanguage(raw: unknown): raw is MarkupLanguage {
  return (
    typeof raw === "string" &&
    (MARKUP_LANGUAGES as readonly string[]).includes(raw.trim().toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// The multi-file bundle carried in one text column
// ---------------------------------------------------------------------------

/**
 * A CSS problem needs an HTML page to style, or the live preview shows a blank
 * frame and the whole point of adding an editor is lost. But `coding_problems.
 * starter_code` is ONE text column and `POST /api/problems/:slug/attempt` accepts
 * ONE `code` string — and widening either is a schema change plus an API contract
 * change, for content that is a handful of files.
 *
 * So a markup starter/submission is a BUNDLE: a plain string in which a comment
 * line of the form
 *
 *     <!-- file: /index.html -->        (HTML comment syntax)
 *     /* file: /styles.css *\/          (CSS comment syntax)
 *
 * starts a new file. A string with no such line is a single file, named from the
 * problem's language. Comment syntax was chosen over an invented sigil for one
 * reason: whichever half of the bundle a student is looking at, the delimiter is
 * legal in that language, so a student who deletes the editor's tab structure and
 * pastes the whole bundle back in still has a valid document.
 *
 * The delimiters never reach the student's editor — MarkupWorkbench splits on the
 * way in and joins on the way out — but they DO survive a copy-paste, which is why
 * `splitMarkupBundle(joinMarkupBundle(files))` is asserted to round-trip.
 */
const FILE_DELIMITER =
  /^[ \t]*(?:<!--|\/\*)[ \t]*file:[ \t]*(\S+)[ \t]*(?:-->|\*\/)[ \t]*$/;

/** Default path for a single-file bundle, by the problem's declared language. */
export const DEFAULT_MARKUP_PATH: Record<MarkupLanguage, string> = {
  html: "/index.html",
  css: "/styles.css",
};

/** Lower-cased extension of a bundle path, without the dot. "" when there is none. */
export function extensionOfPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * Normalise a delimiter's path so a hand-authored `styles.css` and a generated
 * `/styles.css` are the same file. Returns null for anything that cannot be a
 * file inside a sandbox — the same rule src/lib/exercises/parse.ts applies, and
 * for the same reason: a `..` would escape the preview root.
 */
export function normaliseBundlePath(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
  if (path === "" || path.includes("..")) return null;
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === "/" || path.endsWith("/")) return null;
  return path;
}

/**
 * Split a bundle into files.
 *
 * NEVER THROWS and never returns an empty map: a bundle whose every delimiter is
 * unusable still yields the whole text under the default path, because the student
 * must be able to see and edit whatever they submitted. A leading section before
 * the first delimiter is kept under the default path too — otherwise a student who
 * types above the first delimiter silently loses that text.
 */
export function splitMarkupBundle(
  source: string,
  language: MarkupLanguage,
): Record<string, string> {
  const fallback = DEFAULT_MARKUP_PATH[language];
  const text = typeof source === "string" ? source : "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const files: Record<string, string> = {};
  let current = fallback;
  let buffer: string[] = [];
  let sawDelimiter = false;

  const flush = () => {
    // Only keep the implicit leading section when it has content; an empty one is
    // just the newline before the first delimiter.
    const body = buffer.join("\n");
    if (!sawDelimiter && body.trim() === "" && Object.keys(files).length === 0) return;
    if (body.trim() === "" && current === fallback && sawDelimiter) return;
    files[current] = files[current] == null ? body : `${files[current]}\n${body}`;
  };

  for (const line of lines) {
    const match = FILE_DELIMITER.exec(line);
    const path = match ? normaliseBundlePath(match[1]) : null;
    if (path === null) {
      buffer.push(line);
      continue;
    }
    flush();
    sawDelimiter = true;
    current = path;
    buffer = [];
  }
  flush();

  if (Object.keys(files).length === 0) files[fallback] = text;
  return files;
}

/**
 * Join files back into one bundle, in a stable order (HTML, then CSS, then the
 * rest alphabetically) so two submissions of the same files produce the same
 * string and a diff in `coding_attempts.code` means a real change.
 *
 * A single file is emitted WITHOUT a delimiter: the common case (an HTML problem
 * with one document) then stores exactly what the student typed.
 */
export function joinMarkupBundle(files: Record<string, string>): string {
  const paths = orderBundlePaths(Object.keys(files));
  if (paths.length === 0) return "";
  if (paths.length === 1) return files[paths[0]];

  return paths
    .map((path) => {
      const delimiter =
        extensionOfPath(path) === "css" ? `/* file: ${path} */` : `<!-- file: ${path} -->`;
      return `${delimiter}\n${files[path]}`;
    })
    .join("\n");
}

const PATH_RANK: Record<string, number> = { html: 0, htm: 0, css: 1, js: 2 };

/** HTML first (it is the entry document), then CSS, then scripts, then the rest. */
export function orderBundlePaths(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => {
    const rank = (PATH_RANK[extensionOfPath(a)] ?? 9) - (PATH_RANK[extensionOfPath(b)] ?? 9);
    return rank !== 0 ? rank : a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// The assertion vocabulary
// ---------------------------------------------------------------------------

/**
 * One requirement. Six kinds, and the set is closed on purpose: every kind here is
 * answerable by the tolerant scanner below WITHOUT a document tree, so there is no
 * kind that is right in the easy cases and quietly wrong in the hard ones. See the
 * file header on why nesting is absent.
 */
export type MarkupCheck =
  /** `tag h1` / `tag li >= 3` — the element appears at least `min` times. */
  | { kind: "tag"; tag: string; min: number }
  /** `no-tag font` — the element must not appear at all. */
  | { kind: "no-tag"; tag: string }
  /** `attr html lang` / `attr img alt=""` — some element carries the attribute. */
  | { kind: "attr"; tag: string; attr: string; value: string | null }
  /** `text Cohort notes` — the page's visible text contains this, case-insensitively. */
  | { kind: "text"; needle: string }
  /** `selector .card` — a style rule targets this selector. */
  | { kind: "selector"; selector: string }
  /** `declares .card | margin-inline: auto` — that rule sets that property. */
  | { kind: "declares"; selector: string; property: string; value: string | null };

/** One line of a test's expected_output, parsed. `check` is null when unparseable. */
export interface MarkupAssertion {
  /** The original line, so an error can quote it back to the content author. */
  source: string;
  check: MarkupCheck | null;
  /** Why the line did not parse. Present exactly when `check` is null. */
  error?: string;
}

/**
 * Parse a test's `expected_output` into assertions.
 *
 * Blank lines and `#` comments are dropped, so a content author can group and
 * annotate a long requirement list. An unparseable line becomes an assertion with
 * `check: null` rather than being skipped: the seed validator (validate.ts) refuses
 * to publish a problem containing one, and a typo that silently graded nothing
 * would mark every student as correct.
 */
export function parseMarkupAssertions(expectedOutput: string | null | undefined): MarkupAssertion[] {
  if (typeof expectedOutput !== "string") return [];

  const out: MarkupAssertion[] = [];
  for (const rawLine of expectedOutput.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    out.push(parseOne(line));
  }
  return out;
}

const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ATTR_NAME = /^[a-zA-Z_:@][-a-zA-Z0-9_:.]*$/;

function parseOne(line: string): MarkupAssertion {
  const spaceAt = line.indexOf(" ");
  const keyword = (spaceAt === -1 ? line : line.slice(0, spaceAt)).toLowerCase();
  const rest = spaceAt === -1 ? "" : line.slice(spaceAt + 1).trim();
  const bad = (error: string): MarkupAssertion => ({ source: line, check: null, error });

  switch (keyword) {
    case "tag": {
      // `tag li` or `tag li >= 3`. The count form exists because "there is a list"
      // and "there are three list items" are different requirements and a content
      // author should not have to write the second one three times.
      const match = /^(\S+)(?:\s*>=\s*(\d+))?$/.exec(rest);
      if (!match || !TAG_NAME.test(match[1])) return bad("expected `tag <element> [>= <count>]`.");
      const min = match[2] == null ? 1 : Number.parseInt(match[2], 10);
      if (min < 1) return bad("a `tag ... >= n` count must be at least 1; use `no-tag` for zero.");
      return { source: line, check: { kind: "tag", tag: match[1].toLowerCase(), min } };
    }

    case "no-tag": {
      if (!TAG_NAME.test(rest)) return bad("expected `no-tag <element>`.");
      return { source: line, check: { kind: "no-tag", tag: rest.toLowerCase() } };
    }

    case "attr": {
      // `attr <element> <name>` or `attr <element> <name>=<value>`. The value may be
      // quoted, and `=""` means "present and empty" — which is a real requirement,
      // because a decorative image needs alt="" and NOT a missing alt.
      const match = /^(\S+)\s+([^=\s]+)(?:\s*=\s*(.*))?$/.exec(rest);
      if (!match) return bad("expected `attr <element> <attribute>[=<value>]`.");
      const [, tag, attr, rawValue] = match;
      if (!TAG_NAME.test(tag)) return bad(`"${tag}" is not an element name.`);
      if (!ATTR_NAME.test(attr)) return bad(`"${attr}" is not an attribute name.`);
      return {
        source: line,
        check: {
          kind: "attr",
          tag: tag.toLowerCase(),
          attr: attr.toLowerCase(),
          value: rawValue == null ? null : unquote(rawValue.trim()),
        },
      };
    }

    case "text": {
      if (rest === "") return bad("expected `text <substring>`.");
      return { source: line, check: { kind: "text", needle: unquote(rest) } };
    }

    case "selector": {
      if (rest === "") return bad("expected `selector <css selector>`.");
      return { source: line, check: { kind: "selector", selector: normaliseSelector(rest) } };
    }

    case "declares": {
      // `declares <selector> | <property>[: <value>]`. The pipe is load-bearing: a
      // descendant selector contains spaces, so splitting on whitespace would make
      // `declares .nav ul | display: flex` ambiguous.
      const pipe = rest.indexOf("|");
      if (pipe === -1) return bad("expected `declares <selector> | <property>[: <value>]`.");
      const selector = rest.slice(0, pipe).trim();
      const declaration = rest.slice(pipe + 1).trim();
      if (selector === "") return bad("no selector before the `|`.");
      const colon = declaration.indexOf(":");
      const property = (colon === -1 ? declaration : declaration.slice(0, colon)).trim();
      const value = colon === -1 ? null : declaration.slice(colon + 1).trim();
      if (property === "") return bad("no property after the `|`.");
      return {
        source: line,
        check: {
          kind: "declares",
          selector: normaliseSelector(selector),
          property: property.toLowerCase(),
          value: value == null || value === "" ? null : normaliseDeclarationValue(value),
        },
      };
    }

    default:
      return bad(
        `"${keyword}" is not a requirement keyword. Use one of: tag, no-tag, attr, text, selector, declares.`,
      );
  }
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * A sentence a student can act on. Used by the workbench to render the visible
 * requirements as a checklist — the assertions of a VISIBLE test are not a leak
 * (they restate the problem), and a hidden test's are never sent to the client.
 */
export function describeCheck(check: MarkupCheck): string {
  switch (check.kind) {
    case "tag":
      return check.min === 1
        ? `the document contains a <${check.tag}> element`
        : `the document contains at least ${check.min} <${check.tag}> elements`;
    case "no-tag":
      return `the document contains no <${check.tag}> element`;
    case "attr":
      if (check.value === null) return `a <${check.tag}> element sets the ${check.attr} attribute`;
      if (check.value === "") return `a <${check.tag}> element sets ${check.attr} to an empty value`;
      return `a <${check.tag}> element sets ${check.attr} to "${check.value}"`;
    case "text":
      return `the visible text contains "${check.needle}"`;
    case "selector":
      return `a style rule targets "${check.selector}"`;
    case "declares":
      return check.value === null
        ? `the "${check.selector}" rule sets ${check.property}`
        : `the "${check.selector}" rule sets ${check.property} to ${check.value}`;
  }
}

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

/** One element occurrence found by the scanner. No parent, by design. */
export interface ScannedElement {
  name: string;
  attributes: Record<string, string>;
}

/** One style rule: its selector list and its declarations. */
export interface ScannedRule {
  selectors: string[];
  declarations: { property: string; value: string }[];
}

/** Everything the checks need, computed once per submission. */
export interface MarkupIndex {
  elements: ScannedElement[];
  /** Visible text: comments, <script> and <style> bodies removed, spaces collapsed. */
  text: string;
  rules: ScannedRule[];
}

/**
 * Matches a start tag, tolerating quoted attribute values that contain ">".
 * `(?:"[^"]*"|'[^']*'|[^>"'])*` is what makes `<a title="a > b">` one token rather
 * than two — the naive `[^>]*` splits it and invents an element called `b"`.
 */
const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

const ATTRIBUTE =
  /([a-zA-Z_:@][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Remove HTML comments. Done first, so a commented-out tag never counts. */
export function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ");
}

/** Remove CSS block comments. Same reasoning, for stylesheets. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Every start tag in a document, with its attributes, in source order. */
export function scanElements(html: string): ScannedElement[] {
  const source = stripHtmlComments(html);
  const out: ScannedElement[] = [];

  START_TAG.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = START_TAG.exec(source)) !== null) {
    const attributes: Record<string, string> = {};
    ATTRIBUTE.lastIndex = 0;
    let attribute: RegExpExecArray | null;
    while ((attribute = ATTRIBUTE.exec(tag[2])) !== null) {
      const name = attribute[1].toLowerCase();
      // A valueless attribute (`required`, `hidden`) is stored as "" — HTML says a
      // boolean attribute's value is the empty string, and a check for its presence
      // must succeed while `attr input required=yes` must not.
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      if (!(name in attributes)) attributes[name] = value;
    }
    out.push({ name: tag[1].toLowerCase(), attributes });
  }
  return out;
}

/**
 * The text a sighted reader sees. Script and style BODIES are removed first —
 * otherwise `text flex` would pass on a page that merely mentions flex in its CSS,
 * which is the opposite of what the assertion means.
 */
export function scanVisibleText(html: string): string {
  return stripHtmlComments(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every `<style>` body in a document, concatenated. Part of the stylesheet. */
export function scanInlineStyles(html: string): string {
  const out: string[] = [];
  const style = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = style.exec(stripHtmlComments(html))) !== null) out.push(match[1]);
  return out.join("\n");
}

/**
 * Split a stylesheet into rules by brace matching.
 *
 * At-rules are handled by RECURSING into their body when it contains rules, so a
 * declaration inside `@media (min-width: 40em) { .card { ... } }` is found and
 * attributed to `.card`. The alternative — treating `@media` as a rule whose
 * selector is the query — would make `declares .card | display: grid` fail for a
 * perfectly correct responsive stylesheet.
 *
 * The media condition itself is NOT recorded. That is a deliberate limit: this
 * grader can assert that a rule exists, not that it exists only above 40em.
 */
export function scanCssRules(css: string): ScannedRule[] {
  const source = stripCssComments(css);
  const rules: ScannedRule[] = [];
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open === -1) break;

    const prelude = source.slice(index, open).trim();
    const close = matchingBrace(source, open);
    const body = source.slice(open + 1, close === -1 ? source.length : close);

    if (prelude.startsWith("@")) {
      // A block at-rule (@media, @supports, @layer) holds rules; a statement
      // at-rule (@font-face, @keyframes) holds declarations we do not grade.
      if (/^@(media|supports|layer|container|scope)\b/i.test(prelude)) {
        rules.push(...scanCssRules(body));
      }
    } else if (prelude !== "") {
      rules.push({
        selectors: prelude
          .split(",")
          .map((selector) => normaliseSelector(selector))
          .filter((selector) => selector !== ""),
        declarations: parseDeclarations(body),
      });
    }

    index = close === -1 ? source.length : close + 1;
  }

  return rules;
}

/** Index of the `}` closing the `{` at `open`, or -1 when the source is truncated. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseDeclarations(body: string): { property: string; value: string }[] {
  const out: { property: string; value: string }[] = [];
  // Nested blocks (a nested rule, or an at-rule inside the body) are dropped: the
  // recursion above already visited them, and leaving them here would produce a
  // declaration whose value is half a rule.
  const flat = body.replace(/\{[\s\S]*?\}/g, " ");
  for (const chunk of flat.split(";")) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const property = chunk.slice(0, colon).trim().toLowerCase();
    const value = normaliseDeclarationValue(chunk.slice(colon + 1));
    if (property === "" || value === "") continue;
    out.push({ property, value });
  }
  return out;
}

/**
 * Whitespace-insensitive selector form, so `.a>.b`, `.a > .b` and `.a  >  .b` are
 * one selector. Case is PRESERVED: class and id names are case-sensitive in CSS,
 * and lowercasing them would let `.Card` satisfy a requirement for `.card`.
 */
export function normaliseSelector(selector: string): string {
  return selector
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Comparable declaration value: whitespace collapsed, `!important` and any
 * trailing semicolon removed, lower-cased. Lower-casing is safe here in a way it
 * is not for selectors — CSS keywords and units are case-insensitive — and it is
 * what makes `AUTO` and `auto` the same answer.
 */
export function normaliseDeclarationValue(value: string): string {
  return value
    .replace(/!\s*important/gi, " ")
    .replace(/;+\s*$/, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Index a whole submission.
 *
 * HTML-ish files contribute elements and text; `<style>` bodies inside them
 * contribute rules, so a single-file HTML answer that styles itself is graded the
 * same as a two-file one. Files with any other extension are treated as
 * stylesheets ONLY when they are `.css`; a stray `.js` contributes nothing, which
 * is correct — this grader does not execute anything.
 */
export function indexMarkup(files: Record<string, string>): MarkupIndex {
  const elements: ScannedElement[] = [];
  const texts: string[] = [];
  const stylesheets: string[] = [];

  for (const path of orderBundlePaths(Object.keys(files))) {
    const code = files[path] ?? "";
    const extension = extensionOfPath(path);
    if (extension === "css") {
      stylesheets.push(code);
      continue;
    }
    if (extension === "html" || extension === "htm" || extension === "") {
      elements.push(...scanElements(code));
      texts.push(scanVisibleText(code));
      stylesheets.push(scanInlineStyles(code));
    }
  }

  return {
    elements,
    text: texts.join(" ").replace(/\s+/g, " ").trim(),
    rules: stylesheets.flatMap((sheet) => scanCssRules(sheet)),
  };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/** One requirement's verdict, with the sentence the student reads. */
export interface CheckResult {
  /** The requirement in words, or the raw line when it did not parse. */
  description: string;
  met: boolean;
  /** Why it is not met, when saying so adds anything. */
  detail?: string;
}

/** Is one requirement satisfied by this submission? */
export function checkOne(index: MarkupIndex, check: MarkupCheck): CheckResult {
  const description = describeCheck(check);

  switch (check.kind) {
    case "tag": {
      const count = index.elements.filter((element) => element.name === check.tag).length;
      return {
        description,
        met: count >= check.min,
        detail: count >= check.min ? undefined : `found ${count}.`,
      };
    }

    case "no-tag": {
      const count = index.elements.filter((element) => element.name === check.tag).length;
      return { description, met: count === 0, detail: count === 0 ? undefined : `found ${count}.` };
    }

    case "attr": {
      const candidates = index.elements.filter((element) => element.name === check.tag);
      if (candidates.length === 0) {
        return { description, met: false, detail: `there is no <${check.tag}> element at all.` };
      }
      const withAttribute = candidates.filter((element) => check.attr in element.attributes);
      if (withAttribute.length === 0) {
        return { description, met: false, detail: `no <${check.tag}> sets ${check.attr}.` };
      }
      if (check.value === null) return { description, met: true };

      const wanted = collapse(check.value).toLowerCase();
      const met = withAttribute.some(
        (element) => collapse(element.attributes[check.attr]).toLowerCase() === wanted,
      );
      return {
        description,
        met,
        detail: met
          ? undefined
          : `found ${withAttribute
              .map((element) => `${check.attr}="${element.attributes[check.attr]}"`)
              .slice(0, 3)
              .join(", ")}.`,
      };
    }

    case "text": {
      const met = index.text.toLowerCase().includes(collapse(check.needle).toLowerCase());
      return { description, met };
    }

    case "selector": {
      const met = index.rules.some((rule) => rule.selectors.includes(check.selector));
      return {
        description,
        met,
        detail: met ? undefined : "no rule uses that selector.",
      };
    }

    case "declares": {
      const matching = index.rules.filter((rule) => rule.selectors.includes(check.selector));
      if (matching.length === 0) {
        return { description, met: false, detail: `there is no "${check.selector}" rule.` };
      }
      const declarations = matching.flatMap((rule) =>
        rule.declarations.filter((declaration) => declaration.property === check.property),
      );
      if (declarations.length === 0) {
        return { description, met: false, detail: `that rule does not set ${check.property}.` };
      }
      if (check.value === null) return { description, met: true };

      const met = declarations.some((declaration) => declaration.value === check.value);
      return {
        description,
        met,
        detail: met
          ? undefined
          : `it is set to ${declarations.map((d) => d.value).slice(0, 3).join(", ")}.`,
      };
    }
  }
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A whole test's verdict: every requirement, and whether all of them held. */
export interface MarkupTestResult {
  passed: boolean;
  results: CheckResult[];
}

/**
 * Grade one markup test.
 *
 * A test with NO parseable assertion FAILS, and loudly. The alternative — an empty
 * requirement list vacuously satisfied — would mark every student correct on a
 * content typo, which is precisely the failure `tallyTests` refuses for an empty
 * test list in grading.ts.
 */
export function evaluateMarkupTest(
  files: Record<string, string>,
  assertions: readonly MarkupAssertion[],
): MarkupTestResult {
  const index = indexMarkup(files);

  if (assertions.length === 0) {
    return {
      passed: false,
      results: [
        {
          description: "this check has no requirements",
          met: false,
          detail: "That is a content bug, not your mistake. Please report it.",
        },
      ],
    };
  }

  const results = assertions.map((assertion) =>
    assertion.check
      ? checkOne(index, assertion.check)
      : {
          description: assertion.source,
          met: false,
          detail: `This requirement could not be read (${assertion.error ?? "unparseable"}). That is a content bug, not your mistake.`,
        },
  );

  return { passed: results.every((result) => result.met), results };
}

/**
 * Render a test's outcome as the plain text `GradedTest.actual` carries, so the
 * existing attempt/diff plumbing needs no new shape. Ticks and crosses are ASCII —
 * `coding_attempts.stderr` and the diff panes are monospace, and a student on a
 * machine without the emoji font must still be able to read this.
 */
export function summariseResults(results: readonly CheckResult[]): string {
  return results
    .map((result) => `[${result.met ? "x" : " "}] ${result.description}${result.detail ? ` — ${result.detail}` : ""}`)
    .join("\n");
}

/** The requirement list itself, as `GradedTest.expected` carries it. */
export function summariseExpectations(assertions: readonly MarkupAssertion[]): string {
  return assertions
    .map((assertion) => (assertion.check ? describeCheck(assertion.check) : assertion.source))
    .join("\n");
}
