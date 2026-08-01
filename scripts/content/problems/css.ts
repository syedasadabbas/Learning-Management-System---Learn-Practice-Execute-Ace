// =============================================================================
// CSS TRACK — seed data. Owner: coding-problems stream.
// ORIGINAL PROSE ONLY. See index.ts for the rule and the reasoning.
// -----------------------------------------------------------------------------
// REWRITTEN 2026-07-31, alongside html.ts. Read that file's header first: the
// reasoning is the same and is not repeated here. In short — every problem in this
// track now opens in the Sandpack editor with a live preview, and the three whose
// requirement is a declaration rather than a judgement are also graded, by
// structural assertion (src/lib/problems/markup.ts).
//
// WHICH THREE:
//   converted   css-centre-a-block          three named properties for three named
//                                            jobs; the statement itself lists them
//   converted   css-flex-nav-bar            display:flex, gap, and margin-left:auto
//                                            on the pushed item — the statement rules
//                                            out every alternative by name
//   converted   css-responsive-card-grid    grid-template-columns with auto-fit and
//                                            minmax, which is the whole answer
//
//   NOT converted, e.g. css-specificity-order ("state each rule's specificity") and
//   css-fluid-type-scale — the deliverable there is an explanation or a judgement
//   call, and the grader can see neither.
//
// THE STARTER IS A BUNDLE, NOT A STYLESHEET. A CSS problem needs a page to style or
// the live preview is a blank white frame, which would be a worse experience than
// the reference-only page this replaces. `coding_problems.starter_code` is one text
// column, so a converted problem's starter carries both files separated by the
// `/* file: /path */` delimiter that src/lib/problems/markup.ts defines and
// splits on. The delimiters never reach the student's tabs.
//
// The scaffold HTML is deliberately plain and is NOT what is graded — only the
// stylesheet requirements are asserted, so a student who also edits the markup is
// neither helped nor punished for it.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

/** Reference-only problems: an editor and a worked answer, no Submit. */
const base = {
  track: "css",
  language: "css",
  execution: "none",
  tests: [],
} as const satisfies Partial<SeedProblem>;

/** Graded problems. See the header on why "browser" is the honest label. */
const graded = {
  track: "css",
  language: "css",
  execution: "browser",
} as const satisfies Partial<SeedProblem>;

export const cssProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...base,
    slug: "css-predictable-box-sizing",
    title: "Make widths mean what they say",
    level: "beginner",
    isInterview: false,
    statement: [
      "A card is given `width: 300px`, `padding: 20px` and a `2px` border, and overflows",
      "its 300-pixel column.",
      "",
      "Write the rule that makes the declared width include the padding and the border,",
      "and say in a comment what the element's total width is before and after.",
    ].join("\n"),
    hints: [
      "`box-sizing: content-box` is the default, and it adds padding and border OUTSIDE the declared width.",
      "Apply the fix once, universally, rather than per component — otherwise the next component reintroduces the bug.",
    ],
    tags: ["box-model", "layout"],
    starterCode: `.card {
  width: 300px;
  padding: 20px;
  border: 2px solid #ccc;
}
`,
    referenceSolution: `/* Before: 300 + 20 + 20 + 2 + 2 = 344px, so it overflows a 300px column.
   After:  exactly 300px, with the padding and border taken from the inside. */
*,
*::before,
*::after {
  box-sizing: border-box;
}

.card {
  width: 300px;
  padding: 20px;
  border: 2px solid #ccc;
}
`,
  },
  {
    ...graded,
    slug: "css-centre-a-block",
    title: "Three ways to centre",
    level: "beginner",
    isInterview: false,
    statement: [
      "Centre a fixed-width card horizontally, then centre its text, then centre a child",
      "both horizontally and vertically inside it.",
      "",
      "Three different problems that people reach for the same property for. Use the right",
      "one for each and name it in a comment.",
    ].join("\n"),
    hints: [
      "`text-align` centres INLINE content inside a box. It does nothing to the box itself.",
      "`margin-inline: auto` centres a block that has a width. Without a width there is no free space to distribute.",
    ],
    tags: ["layout", "flexbox", "centering"],
    starterCode: `<!-- file: /index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div class="card">
      <h2 class="card__title">Week 1</h2>
      <div class="card__inner">Centre me on both axes</div>
    </div>
  </body>
</html>
/* file: /styles.css */
.card {
  width: 320px;
}
.card__inner {
  height: 120px;
}
`,
    referenceSolution: `/* 1. Centre the BOX: auto margins split the leftover horizontal space.
      Needs a width, and margin-inline respects writing direction. */
.card {
  width: 320px;
  margin-inline: auto;
}

/* 2. Centre the TEXT: text-align works on inline content, not on the box. */
.card__title {
  text-align: center;
}

/* 3. Centre a CHILD on both axes: one flex container, two properties. */
.card__inner {
  height: 120px;
  display: flex;
  justify-content: center; /* along the main axis, here horizontal */
  align-items: center;     /* along the cross axis, here vertical */
}
`,
    tests: [
      {
        name: "the box is centred, not its text",
        input: null,
        expectedOutput: [
          "# margin-inline: auto needs a width to have free space to distribute.",
          "declares .card | margin-inline: auto",
          "declares .card | width",
        ].join("\n"),
        hidden: false,
      },
      {
        name: "the text is centred with the property that centres text",
        input: null,
        expectedOutput: "declares .card__title | text-align: center",
        hidden: false,
      },
      {
        name: "the child is centred on both axes",
        input: null,
        expectedOutput: [
          "declares .card__inner | display: flex",
          "declares .card__inner | justify-content: center",
          "declares .card__inner | align-items: center",
        ].join("\n"),
        hidden: true,
      },
      {
        // The commonest wrong answer to "centre the box" is text-align on the
        // container, which centres the contents and leaves the box where it was.
        name: "the box is not centred with the text property",
        input: null,
        expectedOutput: "declares .card | margin-inline",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "css-specificity-order",
    title: "Work out which rule wins",
    level: "beginner",
    isInterview: false,
    statement: [
      "Four rules all target the same button and set `color`. In a comment, state each",
      "rule's specificity and which colour actually applies — then rewrite the stylesheet",
      "so the intended colour wins WITHOUT using `!important`.",
    ].join("\n"),
    hints: [
      "Specificity counts three things: id selectors, then class/attribute/pseudo-class selectors, then element selectors. A higher count in an earlier group beats any number in a later one.",
      "Source order only decides between selectors of EQUAL specificity — which is why moving a rule to the bottom often changes nothing.",
    ],
    tags: ["specificity", "cascade"],
    starterCode: `button { color: black; }
.btn { color: blue; }
#save { color: red; }
.panel .btn { color: green; }
`,
    referenceSolution: `/* Specificity as (ids, classes, elements):
     button          -> (0,0,1)  black
     .btn            -> (0,1,0)  blue
     #save           -> (1,0,0)  red     <- wins, whatever the source order
     .panel .btn     -> (0,2,0)  green

   #save applies. Moving .panel .btn to the bottom would change nothing, because
   source order only breaks ties between EQUAL specificities.

   The fix is to stop competing: drop the id selector and express the variation as
   a modifier class at the same specificity as the base, so the cascade is decided
   by source order — which is readable — rather than by arithmetic. */
.btn {
  color: blue;
}

.btn--save {
  color: red;
}

/* Contextual override, one class deeper, used only where context really matters. */
.panel .btn {
  color: green;
}
`,
  },
  {
    ...graded,
    slug: "css-flex-nav-bar",
    title: "A navigation bar with a pushed-right group",
    level: "beginner",
    isInterview: true,
    statement: [
      "Lay out a navigation bar: a logo on the left, links next to it, and a sign-out",
      "button pushed to the far right. It must stay on one line and the gaps must be even.",
      "",
      "Do it without floats, without absolute positioning, and without a spacer element.",
    ].join("\n"),
    hints: [
      "`margin-left: auto` on the last item absorbs all the free space, which pushes it right — no spacer needed.",
      "`gap` spaces flex children without giving the first or last one an outer margin, which margins on children cannot do cleanly.",
    ],
    tags: ["flexbox", "layout", "navigation"],
    starterCode: `<!-- file: /index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <nav class="nav" aria-label="Primary">
      <span class="nav__logo">Code Queens Hub</span>
      <a href="/weeks">Weeks</a>
      <a href="/problems">Practice</a>
      <button class="nav__signout" type="button">Sign out</button>
    </nav>
  </body>
</html>
/* file: /styles.css */
.nav {
}
.nav__signout {
}
`,
    referenceSolution: `.nav {
  display: flex;
  align-items: center;
  gap: 1rem; /* even spacing with no stray outer margin */
}

/* Absorbs every remaining pixel of free space on the main axis, so this item —
   and only this item — is pushed to the far end. */
.nav__signout {
  margin-left: auto;
}
`,
    tests: [
      {
        name: "one line, evenly spaced, laid out with flex",
        input: null,
        expectedOutput: [
          "declares .nav | display: flex",
          "# gap, not margins on the children: margins leave a stray outer gap.",
          "declares .nav | gap",
        ].join("\n"),
        hidden: false,
      },
      {
        name: "the sign-out button is pushed to the far end",
        input: null,
        expectedOutput: "declares .nav__signout | margin-left: auto",
        hidden: false,
      },
      {
        name: "the items are aligned on the cross axis",
        input: null,
        expectedOutput: "declares .nav | align-items: center",
        hidden: true,
      },
      {
        // HONEST SCOPE. The statement forbids floats, absolute positioning and a
        // spacer element. The assertion grammar can require a construct's presence
        // and an ELEMENT's absence, but it has no way to say "no rule anywhere sets
        // float" — so the ban is enforced indirectly: the flex answer is required,
        // and the original nav and its button must still be there, which rules out
        // the rewrite-the-markup escape route. A student who satisfies all of this
        // AND also sets a stray float has still written the required solution.
        name: "the original controls are still there",
        input: null,
        expectedOutput: ["tag nav", "tag button", "declares .nav | display: flex"].join("\n"),
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "css-relative-units",
    title: "Sizes that respect the user's settings",
    level: "beginner",
    isInterview: true,
    statement: [
      "A stylesheet sets every size in pixels, so a visitor who has increased their",
      "browser's default font size sees no change.",
      "",
      "Rewrite it with relative units, and say in a comment which unit you chose for each",
      "value and why `rem` and `em` are not interchangeable.",
    ].join("\n"),
    hints: [
      "`rem` is relative to the ROOT font size, so it scales with the user's setting and is not affected by nesting.",
      "`em` is relative to the ELEMENT's own font size, which compounds when boxes nest — useful for padding that should track its own text, hazardous for layout.",
    ],
    tags: ["units", "accessibility", "typography"],
    starterCode: `body { font-size: 16px; }
.card { padding: 24px; max-width: 640px; }
.card__title { font-size: 24px; margin-bottom: 8px; }
`,
    referenceSolution: `/* No font-size on body at all: the browser's default IS the user's preference,
   and 16px overrides it. Setting 100% would be equivalent and equally pointless. */

.card {
  /* em: padding should grow with this component's own text. */
  padding: 1.5em;
  /* rem: a layout limit should track the root, not whatever the parent's text is. */
  max-width: 40rem;
}

.card__title {
  /* rem, not em: with em, a title inside an already-enlarged box compounds. */
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

/* rem vs em, stated once: rem is measured from the root and does not compound;
   em is measured from the element's own font size and does. Nested components are
   where the difference stops being academic. */
`,
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...graded,
    slug: "css-responsive-card-grid",
    title: "A card grid that reflows without media queries",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Lay out a list of cards so it shows as many columns as fit, each at least 16rem",
      "wide, with even gaps — and so it needs no media query at any width.",
      "",
      "Say in a comment which part of the declaration removes the need for breakpoints.",
    ].join("\n"),
    hints: [
      "`repeat(auto-fill, minmax(16rem, 1fr))` lets the grid decide the column count from the available width.",
      "`auto-fill` keeps empty tracks; `auto-fit` collapses them so the remaining cards stretch. Choose deliberately — the difference is visible with two cards on a wide screen.",
    ],
    tags: ["grid", "responsive", "layout"],
    starterCode: `<!-- file: /index.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <ul class="cards">
      <li>Week 1</li>
      <li>Week 2</li>
      <li>Week 3</li>
      <li>Week 4</li>
    </ul>
  </body>
</html>
/* file: /styles.css */
.cards {
  display: flex;
  flex-wrap: wrap;
}
.cards > * {
  width: 300px;
}
`,
    referenceSolution: `.cards {
  display: grid;
  /* auto-fit + minmax is the part that replaces the breakpoints: the grid works
     out how many 16rem columns fit and divides the leftover space between them,
     so the column count is a function of the container, not of the viewport. */
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
}

/* auto-fit collapses empty tracks, so two cards on a wide screen stretch to fill
   the row. auto-fill would keep the empty columns and leave them narrow. */
`,
    tests: [
      {
        name: "it is a grid, spaced with gap",
        input: null,
        expectedOutput: ["declares .cards | display: grid", "declares .cards | gap"].join("\n"),
        hidden: false,
      },
      {
        name: "the columns are computed, not enumerated",
        input: null,
        expectedOutput: [
          "# The exact declaration, because it IS the answer: repeat(auto-fit, minmax(16rem, 1fr)).",
          "declares .cards | grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr))",
        ].join("\n"),
        hidden: false,
      },
      {
        // A student who leaves the flex fallback in place has two competing layout
        // models on one element and the grid one wins silently, which is worth
        // catching even though the page happens to look right.
        name: "the flex fallback was replaced, not left behind",
        input: null,
        expectedOutput: "declares .cards | display: grid",
        hidden: true,
      },
      {
        name: "the fixed child width is gone",
        input: null,
        // `1fr` inside the minmax is what sizes the children now, so a leftover
        // `width: 300px` on them would fight it. Asserting the grid declaration
        // again is not a duplicate: this test also requires the cards to exist,
        // which catches an answer that deleted them.
        expectedOutput: [
          "tag li >= 4",
          "declares .cards | grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr))",
        ].join("\n"),
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "css-mobile-first-breakpoints",
    title: "Write the breakpoints the other way round",
    level: "intermediate",
    isInterview: false,
    statement: [
      "The starter styles the desktop layout first and then undoes it for small screens.",
      "Rewrite it mobile-first: the base rules describe the narrow layout and each media",
      "query only ADDS.",
      "",
      "Say in a comment which properties you no longer have to reset.",
    ].join("\n"),
    hints: [
      "`min-width` queries build upwards. Every declaration inside one is an addition, never an undo.",
      "Breakpoints belong where the LAYOUT breaks, not at device widths — there is no useful list of phone sizes to target.",
    ],
    tags: ["media-queries", "responsive", "mobile-first"],
    starterCode: `.layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 2rem;
}

@media (max-width: 700px) {
  .layout {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
`,
    referenceSolution: `/* Base = the narrow layout. A single column needs no grid-template-columns at
   all, and no gap reset, because there is nothing yet to undo. */
.layout {
  display: grid;
  gap: 1rem;
}

/* The query ADDS the second column at the width where one column starts wasting
   space. Chosen from the content, not from a device. */
@media (min-width: 44rem) {
  .layout {
    grid-template-columns: 240px 1fr;
    gap: 2rem;
  }
}

/* No longer reset: grid-template-columns and gap. In the max-width version both
   had to be overridden for small screens — and every future property added to the
   desktop rule would have needed the same treatment, which is how the reset list
   grows without anyone deciding to grow it. */
`,
  },
  {
    ...base,
    slug: "css-custom-properties-theme",
    title: "One theme, two colour schemes",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Define a small set of custom properties for surface, text and accent colours, use",
      "them in two components, and provide a dark scheme that changes only the property",
      "values.",
      "",
      "No component rule may name a colour directly.",
    ].join("\n"),
    hints: [
      "Custom properties are inherited, so declaring them on `:root` makes them available everywhere and overridable on any subtree.",
      "`prefers-color-scheme` is the user's stated preference; a manual toggle is a separate override and needs a higher-specificity selector to win.",
    ],
    tags: ["custom-properties", "theming", "dark-mode"],
    starterCode: `.card { background: #ffffff; color: #111111; }
.button { background: #2563eb; color: #ffffff; }
`,
    referenceSolution: `:root {
  --surface: #ffffff;
  --ink: #111111;
  --accent: #2563eb;
  --accent-ink: #ffffff;
}

/* The user's system preference. */
@media (prefers-color-scheme: dark) {
  :root {
    --surface: #101418;
    --ink: #f2f4f6;
    --accent: #7aa2f7;
    --accent-ink: #101418;
  }
}

/* An explicit choice must beat the system preference, so it is an attribute
   selector on the root rather than another media query. */
:root[data-theme="dark"] {
  --surface: #101418;
  --ink: #f2f4f6;
  --accent: #7aa2f7;
  --accent-ink: #101418;
}
:root[data-theme="light"] {
  --surface: #ffffff;
  --ink: #111111;
  --accent: #2563eb;
  --accent-ink: #ffffff;
}

/* Components name roles, never colours. Adding a third scheme touches no
   component rule. */
.card {
  background: var(--surface);
  color: var(--ink);
}

.button {
  background: var(--accent);
  color: var(--accent-ink);
}
`,
  },
  {
    ...base,
    slug: "css-visible-focus-styles",
    title: "A focus ring that survives a design review",
    level: "intermediate",
    isInterview: true,
    statement: [
      "The starter removes the default focus outline because a designer disliked it on",
      "mouse click.",
      "",
      "Replace it with a focus style that is clearly visible, appears for keyboard users,",
      "and does not appear on a mouse click. Explain in a comment why `outline: none` on",
      "its own is a defect.",
    ].join("\n"),
    hints: [
      "`:focus-visible` is the browser's own judgement about whether the focus came from a keyboard. That is the hook the designer actually wanted.",
      "`outline-offset` gives the ring breathing room without changing layout, which `border` would.",
    ],
    tags: ["accessibility", "focus", "pseudo-classes"],
    starterCode: `button:focus {
  outline: none;
}
`,
    referenceSolution: `/* outline: none with no replacement leaves a keyboard user with NO indication of
   where they are on the page. It is not a style choice — it removes the only
   feedback that makes the page operable without a pointer. */

button:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  /* Offset rather than a border: no layout shift when focus arrives. */
  outline-offset: 2px;
  border-radius: 4px;
}

/* Only suppress the ring for the pointer case, and only because :focus-visible
   above has already provided the keyboard case. */
button:focus:not(:focus-visible) {
  outline: none;
}
`,
  },
  {
    ...base,
    slug: "css-truncate-and-wrap",
    title: "Long text that does not break the layout",
    level: "intermediate",
    isInterview: true,
    statement: [
      "Three text problems in one component: a single-line title that must end in an",
      "ellipsis, a description limited to three lines, and a pasted URL that must not push",
      "the card wider than its column.",
      "",
      "Solve each and note in a comment which one loses information.",
    ].join("\n"),
    hints: [
      "Single-line truncation needs three declarations together: `overflow: hidden`, `white-space: nowrap` and `text-overflow: ellipsis`. Any one alone does nothing visible.",
      "`overflow-wrap: anywhere` breaks an unbreakable string only when it would otherwise overflow, unlike `word-break: break-all`, which breaks every word.",
    ],
    tags: ["typography", "overflow", "layout"],
    starterCode: `.card__title { }
.card__description { }
.card__url { }
`,
    referenceSolution: `/* Single line, ellipsis. All three declarations are required together. */
.card__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Three lines, then an ellipsis. */
.card__description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

/* Breaks a long URL only where it would otherwise overflow. word-break:
   break-all would also break ordinary words mid-syllable. */
.card__url {
  overflow-wrap: anywhere;
}

/* Which one loses information: the first two. Truncated text is text the reader
   cannot get to, so both need the full string reachable another way — a title
   attribute, an expand control, or a link to the full record. The third loses
   nothing: it only changes where the line breaks. */
`,
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "css-grid-template-areas",
    title: "A page shell described as a picture",
    level: "advanced",
    isInterview: false,
    statement: [
      "Build a page shell — header, sidebar, main, footer — with named grid areas, so the",
      "stylesheet shows the layout as a diagram. Stack it into one column on narrow",
      "screens by changing only the area map.",
      "",
      "The children must not need to know their coordinates.",
    ].join("\n"),
    hints: [
      "`grid-template-areas` takes one quoted string per row. Repeat a name across cells to make an area span them.",
      "The children each declare `grid-area: <name>`; reordering the layout then touches only the container.",
    ],
    tags: ["grid", "layout", "responsive"],
    starterCode: `.shell {
  display: grid;
}
.shell > header { }
.shell > nav { }
.shell > main { }
.shell > footer { }
`,
    referenceSolution: `.shell {
  display: grid;
  min-height: 100vh;
  gap: 1rem;
  /* Narrow first: one column, four stacked rows. The quoted strings ARE the
     diagram — the layout is readable without opening the browser. */
  grid-template-columns: 1fr;
  grid-template-areas:
    "masthead"
    "menu"
    "content"
    "baseline";
  grid-template-rows: auto auto 1fr auto;
}

@media (min-width: 48rem) {
  .shell {
    grid-template-columns: 15rem 1fr;
    grid-template-areas:
      "masthead masthead"
      "menu     content"
      "baseline baseline";
    grid-template-rows: auto 1fr auto;
  }
}

/* Children name their area and nothing else, so neither breakpoint touches them. */
.shell > header { grid-area: masthead; }
.shell > nav    { grid-area: menu; }
.shell > main   { grid-area: content; }
.shell > footer { grid-area: baseline; }
`,
  },
  {
    ...base,
    slug: "css-fluid-type-scale",
    title: "Type that scales between two limits",
    level: "advanced",
    isInterview: false,
    statement: [
      "Make a heading grow with the viewport between a floor of 1.5rem and a ceiling of",
      "3rem, with no media queries — and make sure a user who zooms can still enlarge it.",
      "",
      "Explain in a comment why a bare `font-size: 5vw` fails the zoom requirement.",
    ].join("\n"),
    hints: [
      "`clamp(min, preferred, max)` takes the floor, the fluid value and the ceiling in that order.",
      "Include a `rem` term in the preferred value. A pure viewport unit does not respond to the user's text-size setting at all, which is a WCAG failure.",
    ],
    tags: ["typography", "clamp", "accessibility", "responsive"],
    starterCode: `h1 {
  font-size: 5vw;
}
`,
    referenceSolution: `h1 {
  /* Floor 1.5rem, ceiling 3rem, and a preferred value that mixes a rem term with
     a viewport term. */
  font-size: clamp(1.5rem, 1rem + 2.5vw, 3rem);
  line-height: 1.15;
  text-wrap: balance;
}

/* Why bare 5vw fails: a viewport unit is a fraction of the WINDOW, and the
   window does not change when the user raises their default text size or zooms
   text only. The heading is then frozen at one size regardless of the setting,
   which is a WCAG 1.4.4 failure. The rem term is what keeps the user's
   preference in the calculation; clamp's floor and ceiling stop the fluid part
   running away at either extreme. */
`,
  },
  {
    ...base,
    slug: "css-stacking-contexts",
    title: "Work out why the z-index is ignored",
    level: "advanced",
    isInterview: false,
    statement: [
      "A dropdown with `z-index: 9999` still renders behind a neighbouring panel with",
      "`z-index: 1`.",
      "",
      "Explain in a comment why, then fix it without raising any z-index. State which",
      "properties create a stacking context besides `position` and `z-index`.",
    ].join("\n"),
    hints: [
      "A z-index only competes with siblings inside the SAME stacking context. A child can never escape its parent's position in the stack, however large its value.",
      "`transform`, `filter`, `opacity` below 1, `will-change`, `contain: paint` and `isolation: isolate` all create one — which is why adding a transform can break a stack that worked yesterday.",
    ],
    tags: ["stacking-context", "z-index", "positioning"],
    starterCode: `.toolbar {
  transform: translateY(0);
}
.toolbar__dropdown {
  position: absolute;
  z-index: 9999;
}
.panel {
  position: relative;
  z-index: 1;
}
`,
    referenceSolution: `/* Why it fails: .toolbar has a transform, and a transform other than none
   creates a STACKING CONTEXT. .toolbar__dropdown's 9999 therefore competes only
   with its siblings INSIDE .toolbar; the whole .toolbar box is then placed
   against .panel using .toolbar's own stack position, which is below z-index 1.
   A child cannot outrank its parent's position in the stack, whatever number it
   carries — which is why raising 9999 to 99999 changes nothing.

   Besides position + z-index, a stacking context is created by: transform,
   filter, backdrop-filter, perspective, opacity below 1, mix-blend-mode other
   than normal, will-change naming any of those, contain: paint or layout,
   isolation: isolate, and being a fixed or sticky positioned element. */

.toolbar {
  /* The transform was doing nothing. Removing it removes the context. */
  position: relative;
}

.toolbar__dropdown {
  position: absolute;
  /* Now a sibling of .panel's context, so a small honest number is enough. */
  z-index: 2;
}

.panel {
  position: relative;
  z-index: 1;
}
`,
  },
  {
    ...base,
    slug: "css-reduced-motion-transition",
    title: "Animate, but not for everyone",
    level: "advanced",
    isInterview: true,
    statement: [
      "Add a slide-and-fade transition to a panel, then make it degrade correctly for a",
      "visitor who has asked for reduced motion: the panel must still appear and",
      "disappear, with no movement.",
      "",
      "Reducing motion must not remove information. Say in a comment what the difference",
      "is between removing the animation and removing the feedback.",
    ].join("\n"),
    hints: [
      "Put the motion in the base rule and the removal in a `prefers-reduced-motion: reduce` query, so the accessible variant is the override rather than the afterthought.",
      "Keep a fast opacity change rather than dropping to zero duration — the state change still needs to be noticeable, just not animated across the screen.",
    ],
    tags: ["motion", "accessibility", "transitions"],
    starterCode: `.panel {
  transform: translateY(12px);
  opacity: 0;
  transition: transform 300ms ease, opacity 300ms ease;
}
.panel.is-open {
  transform: translateY(0);
  opacity: 1;
}
`,
    referenceSolution: `.panel {
  transform: translateY(12px);
  opacity: 0;
  transition: transform 300ms ease, opacity 300ms ease;
}

.panel.is-open {
  transform: translateY(0);
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .panel,
  .panel.is-open {
    /* No movement at all — the transform is the part that causes discomfort. */
    transform: none;
    /* But the state change is still VISIBLE, and still perceptible as a change,
       because a panel that snaps in with no cue is a panel the user has to hunt
       for. */
    transition: opacity 80ms linear;
  }
}

/* Removing the ANIMATION removes decoration. Removing the FEEDBACK removes
   information: the user no longer knows the panel opened. Reduced motion asks
   for the first, never the second — which is why this query keeps a short opacity
   change instead of setting transition: none. */
`,
  },
  {
    ...base,
    slug: "css-scoped-overrides",
    title: "Override a third-party component without !important",
    level: "advanced",
    isInterview: true,
    statement: [
      "A vendor stylesheet you cannot edit sets `.widget .title { color: red; }`. Your own",
      "rule for the same element is ignored.",
      "",
      "Show two ways to win the cascade without `!important` and without inflating your",
      "selector, and say in a comment what each one costs.",
    ].join("\n"),
    hints: [
      "`@layer` orders whole stylesheets: any rule in a later layer beats any rule in an earlier one, whatever the specificities.",
      "`:where(...)` contributes ZERO specificity, so wrapping the vendor part of a selector lowers what you have to beat.",
    ],
    tags: ["cascade", "layers", "specificity"],
    starterCode: `/* vendor.css, not editable */
.widget .title { color: red; }

/* yours */
.title { color: navy; }
`,
    referenceSolution: `/* Option 1 — cascade layers. Declare the order once; the vendor rule is then
   outranked regardless of specificity, and your selectors stay simple.
   Cost: the layer order is global state. Every stylesheet in the project has to
   be assigned a layer, or an unlayered rule beats all of them — unlayered styles
   win over layered ones. */
@layer vendor, app;

@layer vendor {
  .widget .title { color: red; }
}

@layer app {
  .title { color: navy; }
}

/* Option 2 — match the vendor's structure but neutralise its specificity with
   :where(), which contributes nothing. This selector is (0,1,0), the same as a
   bare .title, and beats the vendor's (0,2,0) only because... it does not. So
   use :where() the other way round: keep YOUR selector cheap and readable while
   still scoping it, and raise it by exactly one class where you must.
   Cost: you are now coupled to the vendor's DOM structure, so their next release
   can break your override silently. */
:where(.widget) .title.title--themed {
  color: navy;
}

/* Why not !important: it wins today and leaves you nothing for tomorrow. The next
   override needs !important too, and then the two of them are decided by
   specificity again — with the escape hatch already spent. */
`,
  },
];
