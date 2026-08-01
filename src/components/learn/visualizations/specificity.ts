// =============================================================================
// CSS SPECIFICITY — the calculation, as a pure function
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// WHY THIS IS A SEPARATE MODULE FROM THE COMPONENT
// Specificity is the one part of this visualizer that can be WRONG rather than
// merely ugly, and a wrong teaching tool is worse than no teaching tool. Kept
// as a pure function it can be table-tested against the spec's own examples
// without rendering anything, which is the only way to have confidence in it.
//
// SCOPE, STATED HONESTLY
// This implements CSS Selectors Level 4 specificity for the selector syntax a
// student on this course will meet: type, class, id, attribute, pseudo-class,
// pseudo-element, the universal selector, combinators, `:not()`, `:is()`,
// `:has()` and `:where()`. It does NOT implement nesting, `@scope`, or the full
// grammar, and it does not validate the selector. Anything it cannot classify
// is reported rather than silently counted as zero — see `unparsed`.
// =============================================================================

/** The specificity triple, in the conventional (a, b, c) order. */
export interface Specificity {
  /** a — id selectors. */
  ids: number;
  /** b — class, attribute and pseudo-class selectors. */
  classes: number;
  /** c — type and pseudo-element selectors. */
  types: number;
}

export interface SpecificityResult extends Specificity {
  /** The selector as given, trimmed. */
  selector: string;
  /**
   * `!important` was written on the declaration. Not part of the triple — it
   * is a separate, higher cascade origin — but students conflate the two, so
   * it is tracked and reported as its own row rather than folded into `ids`.
   */
  important: boolean;
  /** Fragments the parser did not recognise. Empty for well-formed input. */
  unparsed: string[];
}

const ZERO: Specificity = { ids: 0, classes: 0, types: 0 };

function add(a: Specificity, b: Specificity): Specificity {
  return { ids: a.ids + b.ids, classes: a.classes + b.classes, types: a.types + b.types };
}

/** Compare two triples: positive when `a` wins, 0 when they tie. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  if (a.ids !== b.ids) return a.ids - b.ids;
  if (a.classes !== b.classes) return a.classes - b.classes;
  return a.types - b.types;
}

export function formatSpecificity(s: Specificity): string {
  return `${s.ids},${s.classes},${s.types}`;
}

/**
 * Split on a delimiter at bracket/paren depth zero.
 *
 * A naive `split(",")` breaks `:is(a, b)` into two selectors and produces a
 * confidently wrong answer, which is exactly the failure this tool exists to
 * prevent.
 */
function splitTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = "";
  for (const char of input) {
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === delimiter && depth === 0) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  parts.push(buffer);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

// Functional pseudo-classes whose argument contributes the specificity of its
// MOST SPECIFIC argument (Selectors 4). `:where()` is the deliberate exception:
// it always contributes zero, which is the whole reason it exists.
const MAX_OF_ARGS = new Set(["not", "is", "has", "matches", "-webkit-any", "-moz-any"]);
const ZERO_CONTRIBUTION = new Set(["where"]);
// Legacy one-colon spellings of pseudo-ELEMENTS. Written `:before` they look
// like pseudo-classes and would be counted in the wrong column.
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/** Matches one simple-selector token from the front of the input. */
const TOKEN = new RegExp(
  [
    "^\\s+", // whitespace (descendant combinator)
    "^[>+~]", // other combinators
    "^\\*", // universal
    "^#[-\\w\\u00a0-\\uffff]+", // id
    "^\\.[-\\w\\u00a0-\\uffff]+", // class
    "^\\[[^\\]]*\\]", // attribute
    "^::[-\\w]+(?:\\([^)]*\\))?", // pseudo-element
    "^:[-\\w]+", // pseudo-class (argument consumed separately)
    "^[-\\w\\u00a0-\\uffff]+", // type
  ].join("|"),
);

function parseCompound(input: string, unparsed: string[]): Specificity {
  let rest = input;
  let total = ZERO;

  while (rest.length > 0) {
    const match = TOKEN.exec(rest);
    if (!match) {
      // Consume one character so a malformed selector cannot spin forever, and
      // record it so the UI can say "I did not understand this" honestly.
      unparsed.push(rest[0]);
      rest = rest.slice(1);
      continue;
    }

    const token = match[0];
    rest = rest.slice(token.length);
    const head = token[0];

    if (/^\s|^[>+~]$/.test(token)) continue; // combinators add nothing
    if (token === "*") continue; // universal adds nothing

    if (head === "#") {
      total = add(total, { ids: 1, classes: 0, types: 0 });
      continue;
    }
    if (head === "." || head === "[") {
      total = add(total, { ids: 0, classes: 1, types: 0 });
      continue;
    }
    if (token.startsWith("::")) {
      total = add(total, { ids: 0, classes: 0, types: 1 });
      continue;
    }
    if (head === ":") {
      const name = token.slice(1).toLowerCase();

      // A functional pseudo-class: pull its parenthesised argument off `rest`
      // by hand, because a regex cannot balance nested parentheses.
      let argument: string | null = null;
      if (rest.startsWith("(")) {
        let depth = 0;
        let end = -1;
        for (let i = 0; i < rest.length; i += 1) {
          if (rest[i] === "(") depth += 1;
          else if (rest[i] === ")") {
            depth -= 1;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end === -1) {
          unparsed.push(rest);
          rest = "";
        } else {
          argument = rest.slice(1, end);
          rest = rest.slice(end + 1);
        }
      }

      if (ZERO_CONTRIBUTION.has(name)) continue;

      if (MAX_OF_ARGS.has(name) && argument !== null) {
        const best = splitTopLevel(argument, ",")
          .map((part) => parseCompound(part, unparsed))
          .reduce<Specificity>(
            (winner, candidate) =>
              compareSpecificity(candidate, winner) > 0 ? candidate : winner,
            ZERO,
          );
        total = add(total, best);
        continue;
      }

      if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
        total = add(total, { ids: 0, classes: 0, types: 1 });
        continue;
      }

      // Everything else — :hover, :nth-child(2n), :focus-visible — is a plain
      // pseudo-class and counts in the class column.
      total = add(total, { ids: 0, classes: 1, types: 0 });
      continue;
    }

    // A bare word is a type selector.
    total = add(total, { ids: 0, classes: 0, types: 1 });
  }

  return total;
}

/**
 * Specificity of one selector.
 *
 * Given a selector LIST (`h1, .title`), returns the most specific member,
 * because that is the one that decides whether the rule wins for an element
 * matched by both.
 */
export function calculateSpecificity(input: string): SpecificityResult {
  const raw = (input ?? "").trim();
  const importantMatch = /!\s*important\b/i.test(raw);
  const selector = raw.replace(/!\s*important\b/i, "").trim();

  if (selector.length === 0) {
    return { selector: raw, ids: 0, classes: 0, types: 0, important: importantMatch, unparsed: [] };
  }

  const unparsed: string[] = [];
  const best = splitTopLevel(selector, ",")
    .map((part) => parseCompound(part, unparsed))
    .reduce<Specificity>(
      (winner, candidate) => (compareSpecificity(candidate, winner) > 0 ? candidate : winner),
      ZERO,
    );

  return { selector, ...best, important: importantMatch, unparsed };
}

/**
 * Index of the winning entry, or -1 when the field is empty.
 *
 * Ties go to the LAST entry: in a stylesheet, equal specificity is broken by
 * source order, and later wins. That rule is the second half of the concept and
 * is the one students get backwards, so it is modelled rather than avoided.
 */
export function findWinner(results: readonly SpecificityResult[]): number {
  if (results.length === 0) return -1;
  let winner = 0;
  for (let i = 1; i < results.length; i += 1) {
    const a = results[i];
    const b = results[winner];
    // `!important` outranks any triple; it is a different cascade origin.
    if (a.important !== b.important) {
      if (a.important) winner = i;
      continue;
    }
    if (compareSpecificity(a, b) >= 0) winner = i;
  }
  return winner;
}
