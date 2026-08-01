// =============================================================================
// HTML TRACK — seed data. Owner: coding-problems stream.
// ORIGINAL PROSE ONLY. See index.ts for the rule and the reasoning.
// -----------------------------------------------------------------------------
// REWRITTEN 2026-07-31. The previous version of this header said `execution: "none"`
// for every problem and defended it: "there is no runtime that turns markup into a
// pass or a fail". That is still true and is still the reason most of these problems
// are ungraded. What was NOT true is the conclusion the platform drew from it —
// that a markup problem therefore needs no editor either. The product owner's words:
// "they get a worked answer and no editor at all."
//
// TWO CHANGES, and they are separate:
//
//   1. EVERY problem here now opens in a real editor with a live preview. That is
//      the interactive-exercises Sandpack editor (src/components/exercises/
//      LiveEditor.tsx) composed by src/components/problems/MarkupWorkbench.tsx —
//      reused, not rebuilt, so there is one Sandpack configuration in the codebase
//      and not two. It costs nothing in grading terms and it is most of what was
//      missing.
//
//   2. THREE of the thirteen problems are also GRADED, by structural assertion
//      rather than by execution: each test's `expectedOutput` is a requirement list
//      in the small grammar documented in src/lib/problems/markup.ts, and Submit
//      checks the submitted markup against it on the server. Read that file's
//      header before adding another — it states what this grading can see and, more
//      importantly, what it cannot.
//
// WHICH THREE, AND WHY NOT THE OTHER TEN. A problem was converted only if its
// requirement can be stated as a structure that is present or absent, with no
// judgement in between:
//
//   converted   html-valid-document-skeleton  "declare a doctype, a lang, a charset,
//                                              a viewport" — four facts, each either
//                                              there or not
//   converted   html-accessible-form          labels bound by `for`/`id`, correct
//                                              input types, autocomplete, describedby
//   converted   html-heading-hierarchy        the required heading levels, and the
//                                              absence of the wrong ones
//
//   NOT converted, e.g. html-image-alternatives ("give each image the RIGHT text
//   alternative") and html-semantic-landmarks (the choice of landmark is contextual).
//   A checker could assert that an `alt` exists; it cannot assert that the sentence
//   inside it describes the photograph. Grading those would mark thoughtful answers
//   wrong and reward the pattern-matching the problems exist to discourage. They keep
//   `execution: "none"` and their worked answer — and now also get the editor.
//
// SIDE EFFECT WORTH KNOWING: one gradeable problem at beginner level means the HTML
// level ladder now gates intermediate on solving it (src/lib/problems/progression.ts
// caps the requirement at the gradeable count). That is the same behaviour the
// JavaScript track has always had.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

/** Reference-only problems: an editor and a worked answer, no Submit. */
const base = {
  track: "html",
  language: "html",
  execution: "none",
  tests: [],
} as const satisfies Partial<SeedProblem>;

/**
 * Graded problems: the same editor, plus a Submit that checks the requirement lists
 * on the tests below. `execution: "browser"` is the honest label — the practice loop
 * (edit, preview) genuinely runs in the student's browser, and Submit goes to the
 * server like every other Submit, where the hidden requirements live.
 */
const graded = {
  track: "html",
  language: "html",
  execution: "browser",
} as const satisfies Partial<SeedProblem>;

export const htmlProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...graded,
    slug: "html-valid-document-skeleton",
    title: "A document that validates",
    level: "beginner",
    isInterview: false,
    statement: [
      "Write the smallest complete HTML5 document that declares its language, its",
      "character encoding and a viewport, and shows one heading and one paragraph.",
      "",
      "Every one of those four declarations prevents a specific bug. Name each one in a",
      "comment next to it.",
    ].join("\n"),
    hints: [
      "Without `<!DOCTYPE html>` the browser uses quirks mode, where layout follows rules from the 1990s.",
      "Without the viewport meta a phone renders the page at desktop width and then shrinks it, so your responsive CSS never takes effect.",
    ],
    tags: ["document-structure", "accessibility", "meta"],
    starterCode: `<!-- TODO: complete this document -->
<html>
  <head>
  </head>
  <body>
  </body>
</html>
`,
    referenceSolution: `<!DOCTYPE html>
<!-- lang lets a screen reader choose the right pronunciation rules -->
<html lang="en">
  <head>
    <!-- utf-8 stops non-ASCII characters rendering as mojibake -->
    <meta charset="utf-8" />
    <!-- without this, a phone renders at desktop width and scales down -->
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- the title is the tab name, the bookmark name and the search result heading -->
    <title>Cohort notes</title>
  </head>
  <body>
    <h1>Cohort notes</h1>
    <p>Everything I learned this week, written down before I forget it.</p>
  </body>
</html>
`,
    tests: [
      // VISIBLE: these restate the four declarations the statement asks for, so
      // showing them gives nothing away — a student who reads the problem already
      // knows them. What the visible list does do is remove the guesswork about what
      // "declares its language" is going to be checked as.
      {
        name: "the four declarations",
        input: null,
        expectedOutput: [
          "# One requirement per line. See the problem statement for why each matters.",
          "attr html lang",
          "attr meta charset=utf-8",
          "attr meta name=viewport",
          "tag title",
        ].join("\n"),
        hidden: false,
      },
      {
        name: "one heading and one paragraph",
        input: null,
        expectedOutput: ["tag h1", "tag p"].join("\n"),
        hidden: false,
      },
      // HIDDEN: the parts a student can get wrong while satisfying the visible list.
      // `content` is checked here rather than above because a viewport meta with the
      // wrong content is the commonest way this is half-done.
      {
        name: "the viewport is actually configured",
        input: null,
        expectedOutput: "attr meta content=width=device-width, initial-scale=1",
        hidden: true,
      },
      {
        name: "the document has a head and a body",
        input: null,
        expectedOutput: ["tag head", "tag body", "tag html"].join("\n"),
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "html-semantic-landmarks",
    title: "Replace the div soup with landmarks",
    level: "beginner",
    isInterview: false,
    statement: [
      "The starter page uses a `div` for every region. Rewrite it using the elements that",
      "say what each region IS, so that assistive technology can offer a list of",
      "landmarks and a keyboard user can jump between them.",
      "",
      "Keep the visible text unchanged.",
    ].join("\n"),
    hints: [
      "There are five landmark regions in this page: banner, navigation, main content, a self-contained article, and a footer.",
      "A page should have exactly one `<main>`. It is what a 'skip to content' link points at.",
    ],
    tags: ["semantics", "accessibility", "landmarks"],
    starterCode: `<div class="header">
  <div class="nav">
    <a href="/">Home</a>
    <a href="/weeks">Weeks</a>
  </div>
</div>
<div class="content">
  <div class="post">
    <div class="post-title">Week 1</div>
    <p>What we covered.</p>
  </div>
</div>
<div class="footer">Code Queens Hub</div>
`,
    referenceSolution: `<header>
  <nav aria-label="Primary">
    <a href="/">Home</a>
    <a href="/weeks">Weeks</a>
  </nav>
</header>
<main>
  <article>
    <h1>Week 1</h1>
    <p>What we covered.</p>
  </article>
</main>
<footer>Code Queens Hub</footer>
`,
  },
  {
    ...base,
    slug: "html-image-alternatives",
    title: "Three images, three different alt values",
    level: "beginner",
    isInterview: false,
    statement: [
      "Mark up three images and give each the right text alternative:",
      "",
      "1. a photograph of a student presenting their project;",
      "2. a decorative divider that carries no information;",
      "3. a bar chart whose numbers appear nowhere else on the page.",
      "",
      "The three cases need three different answers, and one of them is not an `alt`",
      "attribute at all. Explain each choice in a comment.",
    ].join("\n"),
    hints: [
      "A decorative image needs `alt=\"\"` — EMPTY, not missing. A missing `alt` makes a screen reader read the file name instead.",
      "A chart's alternative cannot fit in an attribute. Put the figures in the page, as a table or a caption, and let the image be decorative.",
    ],
    tags: ["images", "accessibility", "alt-text"],
    starterCode: `<img src="presenting.jpg" />
<img src="divider.svg" />
<img src="scores.png" />
`,
    referenceSolution: `<!-- 1. Informative: describe what matters about it, not that it is a photo. -->
<img src="presenting.jpg" alt="A student presenting her portfolio site to the cohort" />

<!-- 2. Decorative: an EMPTY alt removes it from the accessibility tree. Omitting
     the attribute instead would make a screen reader announce "divider.svg". -->
<img src="divider.svg" alt="" />

<!-- 3. Complex: the data cannot fit in an attribute, so it goes in the page and
     the image becomes decorative. -->
<figure>
  <img src="scores.png" alt="" />
  <figcaption>Average score by week</figcaption>
  <table>
    <caption>Average score by week</caption>
    <thead>
      <tr><th scope="col">Week</th><th scope="col">Average</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">1</th><td>74</td></tr>
      <tr><th scope="row">2</th><td>81</td></tr>
    </tbody>
  </table>
</figure>
`,
  },
  {
    ...graded,
    slug: "html-heading-hierarchy",
    title: "Fix a heading order that lies",
    level: "beginner",
    isInterview: true,
    statement: [
      "The starter page picks heading levels by how big the text should look. Rewrite the",
      "headings so the levels describe the document's STRUCTURE, with no skipped levels,",
      "and say in a comment which CSS property you would use to get the sizes back.",
      "",
      "A screen-reader user navigates by heading level. A page whose levels jump from",
      "`h1` to `h4` reads as though two sections are missing.",
    ].join("\n"),
    hints: [
      "One `h1` per page, then descend one level at a time. A section nested inside another section is one level deeper, never two.",
      "Appearance is `font-size`'s job. Choosing `h4` because it looks right is choosing the wrong tool.",
    ],
    tags: ["semantics", "accessibility", "headings"],
    starterCode: `<h1>Course</h1>
<h4>Week 1</h4>
<h2>Lecture 1</h2>
<h4>Week 2</h4>
<h5>Lecture 1</h5>
`,
    referenceSolution: `<h1>Course</h1>

<h2>Week 1</h2>
<h3>Lecture 1</h3>

<h2>Week 2</h2>
<h3>Lecture 1</h3>

<!-- Sizes are a presentation decision: set font-size in CSS. Choosing a heading
     level for its default size makes the outline disagree with the page. -->
`,
    tests: [
      {
        name: "no level is chosen for its size",
        input: null,
        expectedOutput: [
          "# The starter's h4 and h5 were picked to look right, not to describe structure.",
          "tag h1",
          "no-tag h4",
          "no-tag h5",
        ].join("\n"),
        hidden: false,
      },
      {
        name: "the two weeks are siblings one level below the page title",
        input: null,
        expectedOutput: "tag h2 >= 2",
        hidden: false,
      },
      {
        name: "the lectures sit one level below their week",
        input: null,
        expectedOutput: ["tag h3 >= 2", "no-tag h6"].join("\n"),
        hidden: true,
      },
      {
        // Guards against the shortest wrong answer: deleting the headings that were
        // at the wrong level instead of correcting them.
        name: "no content was dropped on the way",
        input: null,
        expectedOutput: ["text Course", "text Week 1", "text Week 2", "text Lecture 1"].join("\n"),
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "html-link-versus-button",
    title: "Link or button",
    level: "beginner",
    isInterview: true,
    statement: [
      "Three controls are described below. Mark each one up with the correct element and",
      "justify it in a comment:",
      "",
      "1. goes to the leaderboard page;",
      "2. submits the quiz form;",
      "3. reveals more text already present in the page.",
      "",
      "Also fix the fourth control in the starter, which is a `div` with a click handler.",
    ].join("\n"),
    hints: [
      "A link NAVIGATES and belongs in the browser's history; a button performs an action on the current page. That is the whole distinction.",
      "A `div` with a click handler is not focusable, is not reachable by keyboard, and is announced as nothing. `<button>` gives you all three for free.",
    ],
    tags: ["semantics", "accessibility", "controls"],
    starterCode: `<div onclick="openMenu()">Menu</div>
<!-- TODO: 1. navigate to /leaderboard -->
<!-- TODO: 2. submit the quiz -->
<!-- TODO: 3. reveal more text -->
`,
    referenceSolution: `<!-- Focusable, keyboard-operable and announced as a button, none of which a
     div with a click handler is. -->
<button type="button" onclick="openMenu()">Menu</button>

<!-- 1. Navigation: it has a destination, so it is a link. -->
<a href="/leaderboard">Leaderboard</a>

<!-- 2. An action inside a form. type="submit" is the default, but stating it
     stops a later refactor turning it into a navigation. -->
<button type="submit">Submit quiz</button>

<!-- 3. An action on this page, so a button — and aria-expanded tells a screen
     reader which state it is in. -->
<button type="button" aria-expanded="false" aria-controls="more">Show more</button>
<div id="more" hidden>The rest of the explanation.</div>
`,
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...graded,
    slug: "html-accessible-form",
    title: "A sign-up form anyone can complete",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Mark up a sign-up form with a name, an email address, a password and a submit",
      "button.",
      "",
      "Every field must have a real label, the right input type, the right autocomplete",
      "hint, and a help message that is programmatically connected to its field rather",
      "than merely sitting next to it.",
    ].join("\n"),
    hints: [
      "A `<label for>` whose value matches the input's `id` is the only connection that works everywhere. Placeholder text is not a label — it disappears the moment the user types.",
      "`aria-describedby` points at the help text's `id`, which is what makes a screen reader read the rule as well as the field name.",
    ],
    tags: ["forms", "accessibility", "labels"],
    starterCode: `<form>
  <input placeholder="Name" />
  <input placeholder="Email" />
  <input placeholder="Password" />
  <div>At least 12 characters.</div>
  <div onclick="submit()">Sign up</div>
</form>
`,
    referenceSolution: `<form method="post" action="/api/auth/register">
  <div>
    <label for="name">Full name</label>
    <input id="name" name="name" type="text" autocomplete="name" required />
  </div>

  <div>
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" required />
  </div>

  <div>
    <label for="password">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="new-password"
      aria-describedby="password-help"
      required
      minlength="12"
    />
    <!-- Connected by id, so it is announced with the field rather than
         being read as unrelated text somewhere on the page. -->
    <p id="password-help">At least 12 characters.</p>
  </div>

  <button type="submit">Sign up</button>
</form>
`,
    tests: [
      {
        name: "three real labels and a real submit button",
        input: null,
        expectedOutput: [
          "# A placeholder is not a label: it disappears the moment the user types.",
          "tag form",
          "tag label >= 3",
          "attr label for",
          "attr button type=submit",
        ].join("\n"),
        hidden: false,
      },
      {
        name: "the right input type for each field",
        input: null,
        expectedOutput: [
          "attr input type=text",
          "attr input type=email",
          "attr input type=password",
        ].join("\n"),
        hidden: false,
      },
      {
        name: "autocomplete hints the browser can act on",
        input: null,
        expectedOutput: [
          "attr input autocomplete=name",
          "attr input autocomplete=email",
          "# new-password, not password: it tells the manager to OFFER one rather than fill one.",
          "attr input autocomplete=new-password",
        ].join("\n"),
        hidden: true,
      },
      {
        // The requirement the statement singles out — "programmatically connected
        // rather than merely sitting next to it" — and the one most often skipped.
        // NOTE the limit: this checks that the attribute names the id, not that the
        // id exists on the element the author intended. See markup.ts on nesting and
        // relationships.
        name: "the help text is connected to its field",
        input: null,
        expectedOutput: [
          "attr input aria-describedby=password-help",
          "attr p id=password-help",
        ].join("\n"),
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "html-data-table-headers",
    title: "A table a screen reader can read",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Turn the starter's grid of `td` cells into a proper data table: a caption, a header",
      "row, a row header for each student, and a footer row holding the averages.",
      "",
      "The point of the markup is that a screen reader can announce 'Grace, CSS, 88' when",
      "the user lands on a cell — which requires the browser to know which cells are",
      "headers.",
    ].join("\n"),
    hints: [
      "`scope=\"col\"` on the top row and `scope=\"row\"` on the first cell of each body row is what associates a data cell with both its headers.",
      "`<caption>` is the table's accessible name and belongs inside `<table>`, before anything else. A heading above the table is not the same thing.",
    ],
    tags: ["tables", "accessibility", "semantics"],
    starterCode: `<table>
  <tr><td>Student</td><td>CSS</td><td>HTML</td></tr>
  <tr><td>Ada</td><td>91</td><td>72</td></tr>
  <tr><td>Grace</td><td>88</td><td>95</td></tr>
</table>
`,
    referenceSolution: `<table>
  <caption>Scores by course</caption>
  <thead>
    <tr>
      <th scope="col">Student</th>
      <th scope="col">CSS</th>
      <th scope="col">HTML</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Ada</th>
      <td>91</td>
      <td>72</td>
    </tr>
    <tr>
      <th scope="row">Grace</th>
      <td>88</td>
      <td>95</td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <th scope="row">Average</th>
      <td>89.5</td>
      <td>83.5</td>
    </tr>
  </tfoot>
</table>
`,
  },
  {
    ...base,
    slug: "html-responsive-images",
    title: "Serve the right image for the screen",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Mark up a hero image so a phone downloads a small file and a wide screen downloads",
      "a large one, and so a modern browser can take a smaller modern format while an old",
      "one still gets a JPEG.",
      "",
      "Two different mechanisms are needed. Say in a comment which mechanism solves which",
      "problem.",
    ].join("\n"),
    hints: [
      "`srcset` plus `sizes` lets the BROWSER choose by width — it knows the viewport and the pixel density, and you do not.",
      "`<picture>` with `<source type>` lets YOU choose by format, because format support is a fact about the browser rather than about the layout.",
    ],
    tags: ["images", "performance", "responsive"],
    starterCode: `<img src="hero-1600.jpg" alt="The cohort at the final showcase" />
`,
    referenceSolution: `<!-- <picture> chooses the FORMAT: the browser takes the first source it
     understands, so AVIF and WebP are offered before the JPEG fallback.
     srcset + sizes choose the WIDTH: the browser knows the viewport and the
     device pixel ratio, so it picks the file, not the author. -->
<picture>
  <source
    type="image/avif"
    srcset="hero-480.avif 480w, hero-960.avif 960w, hero-1600.avif 1600w"
    sizes="(max-width: 600px) 100vw, 60vw"
  />
  <source
    type="image/webp"
    srcset="hero-480.webp 480w, hero-960.webp 960w, hero-1600.webp 1600w"
    sizes="(max-width: 600px) 100vw, 60vw"
  />
  <img
    src="hero-960.jpg"
    srcset="hero-480.jpg 480w, hero-960.jpg 960w, hero-1600.jpg 1600w"
    sizes="(max-width: 600px) 100vw, 60vw"
    alt="The cohort at the final showcase"
    width="1600"
    height="900"
    loading="lazy"
    decoding="async"
  />
</picture>
`,
  },
  {
    ...base,
    slug: "html-video-with-fallbacks",
    title: "Embed a video that still works when it does not play",
    level: "intermediate",
    isInterview: true,
    statement: [
      "Embed a lecture recording so that: a browser missing the codec gets a second",
      "source, captions are available, the video does not autoplay, and a visitor whose",
      "browser plays nothing still gets a link to the file.",
      "",
      "State in a comment why autoplay with sound is a defect rather than a feature.",
    ].join("\n"),
    hints: [
      "`<track kind=\"captions\">` is not optional content — it is the only way a deaf student uses the video, and it is also what makes it searchable.",
      "Anything between the `<video>` tags is shown ONLY by a browser that cannot play video, which is where the download link belongs.",
    ],
    tags: ["media", "accessibility", "progressive-enhancement"],
    starterCode: `<video src="lecture.mp4" autoplay></video>
`,
    referenceSolution: `<!-- No autoplay: sound starting unbidden is disorienting for everyone and
     actively hostile to a screen-reader user, whose speech it talks over.
     controls gives keyboard operation for free; preload="metadata" fetches the
     duration without downloading the whole file. -->
<video controls preload="metadata" poster="lecture-poster.jpg" width="640" height="360">
  <source src="lecture.webm" type="video/webm" />
  <source src="lecture.mp4" type="video/mp4" />
  <track kind="captions" src="lecture-en.vtt" srclang="en" label="English" default />
  <!-- Shown only when the browser cannot play video at all. -->
  <p>
    Your browser cannot play this video.
    <a href="lecture.mp4">Download the recording</a>.
  </p>
</video>
`,
  },
  {
    ...base,
    slug: "html-form-validation-attributes",
    title: "Validate in the markup, then again on the server",
    level: "intermediate",
    isInterview: true,
    statement: [
      "Add native validation to a submission form: a required URL field that must be a",
      "GitHub address, a required score between 0 and 100, and a comment of at most 500",
      "characters.",
      "",
      "Then write a comment explaining why every one of these rules must ALSO exist on the",
      "server.",
    ].join("\n"),
    hints: [
      "`pattern`, `min`, `max` and `maxlength` are enforced by the browser before submission, which makes the form faster to use.",
      "`title` on a patterned field is what the browser shows when the pattern fails — without it the message says only 'please match the requested format'.",
    ],
    tags: ["forms", "validation", "security"],
    starterCode: `<form>
  <label for="repo">Repository URL</label>
  <input id="repo" name="repo" />

  <label for="score">Self-assessed score</label>
  <input id="score" name="score" />

  <label for="notes">Notes</label>
  <textarea id="notes" name="notes"></textarea>

  <button type="submit">Submit</button>
</form>
`,
    referenceSolution: `<form method="post" action="/api/me/submissions">
  <label for="repo">Repository URL</label>
  <input
    id="repo"
    name="repo"
    type="url"
    required
    pattern="https://github\\.com/.+"
    title="A full https://github.com/... URL"
  />

  <label for="score">Self-assessed score</label>
  <input id="score" name="score" type="number" required min="0" max="100" step="1" />

  <label for="notes">Notes</label>
  <textarea id="notes" name="notes" maxlength="500"></textarea>

  <button type="submit">Submit</button>
</form>

<!-- Every rule above is a CONVENIENCE, not a control. The browser is under the
     user's control: developer tools can delete an attribute, and a request can be
     sent with curl and never touch this page at all. Client-side validation makes
     the form pleasant; the server's validation is what makes the data true. Both,
     always — and the server's version is the one that must not be skipped. -->
`,
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "html-disclosure-widget",
    title: "A disclosure widget that announces its state",
    level: "advanced",
    isInterview: false,
    statement: [
      "Build a show/hide section twice: once with the native element that needs no",
      "JavaScript, and once with a button plus ARIA for the case where you need control",
      "over the animation.",
      "",
      "In the second version, list in a comment every attribute that has to change when",
      "the state changes.",
    ].join("\n"),
    hints: [
      "`<details>` and `<summary>` give you a keyboard-operable, correctly announced disclosure with no script at all. Reach for ARIA only when you need something it cannot do.",
      "`aria-expanded` must be UPDATED, not just set once. An ARIA attribute that never changes is worse than none, because it now states something false.",
    ],
    tags: ["aria", "accessibility", "progressive-enhancement"],
    starterCode: `<div class="accordion">
  <div class="accordion-title" onclick="toggle()">Marking scheme</div>
  <div class="accordion-body">Quizzes 40%, assignments 60%.</div>
</div>
`,
    referenceSolution: `<!-- Version 1: no JavaScript. Keyboard operable and correctly announced by
     every current browser. Prefer this unless you need to animate the reveal. -->
<details>
  <summary>Marking scheme</summary>
  <p>Quizzes 40%, assignments 60%.</p>
</details>

<!-- Version 2: scripted, for when you control the transition.
     On toggle, exactly two things change:
       1. the button's aria-expanded, true or false;
       2. the panel's hidden attribute, present or absent.
     The button must stay a <button> so Enter, Space and focus keep working, and
     aria-controls points at the panel it governs. -->
<h3>
  <button type="button" aria-expanded="false" aria-controls="scheme-panel" id="scheme-button">
    Marking scheme
  </button>
</h3>
<div id="scheme-panel" role="region" aria-labelledby="scheme-button" hidden>
  <p>Quizzes 40%, assignments 60%.</p>
</div>
`,
  },
  {
    ...base,
    slug: "html-skip-link-and-focus-order",
    title: "Make the page navigable without a mouse",
    level: "advanced",
    isInterview: false,
    statement: [
      "Add a skip link to the top of the page and fix the starter's two focus problems:",
      "an element removed from the tab order that should be in it, and an element given a",
      "positive `tabindex` that should not have one.",
      "",
      "Explain in a comment why a positive `tabindex` is almost always a bug.",
    ].join("\n"),
    hints: [
      "The skip link must be the FIRST focusable thing in the document, and must be visible when focused — a permanently hidden skip link helps nobody.",
      "`tabindex=\"0\"` puts an element in the natural order; a positive value jumps it ahead of everything, so one such value reorders the whole page.",
    ],
    tags: ["accessibility", "keyboard", "focus"],
    starterCode: `<header>
  <a href="/" tabindex="3">Home</a>
  <button tabindex="-1">Open menu</button>
</header>
<main>
  <h1>Week 1</h1>
</main>
`,
    referenceSolution: `<!-- First focusable element in the document, and visible once focused. -->
<a class="skip-link" href="#main-content">Skip to content</a>

<header>
  <!-- tabindex removed. A POSITIVE tabindex takes an element out of document
       order and puts it ahead of every element that has none, so a single
       positive value silently reorders the entire page — and the next person to
       add a control has to know about it. Fix the DOM order instead. -->
  <a href="/">Home</a>

  <!-- tabindex="-1" removed: this button is an operable control, and -1 takes it
       out of the tab order entirely, making it mouse-only. -->
  <button type="button">Open menu</button>
</header>

<main id="main-content">
  <h1>Week 1</h1>
</main>

<style>
  /* Off-screen but still focusable, and brought back on focus. display:none
     would remove it from the tab order and defeat the point. */
  .skip-link {
    position: absolute;
    left: -9999px;
  }
  .skip-link:focus {
    left: 0;
    top: 0;
  }
</style>
`,
  },
  {
    ...base,
    slug: "html-metadata-and-sharing",
    title: "Head metadata that survives being shared",
    level: "advanced",
    isInterview: false,
    statement: [
      "Write the `<head>` for a public lecture page: a title, a description, a canonical",
      "URL, social sharing metadata, and a favicon.",
      "",
      "Explain in a comment what breaks without the canonical URL.",
    ].join("\n"),
    hints: [
      "The description is what a search result and a chat preview show. There is no default worth having, so an absent one is a wasted line of pitch.",
      "Open Graph tags need ABSOLUTE URLs — a relative `og:image` resolves against the scraper, not against your site.",
    ],
    tags: ["meta", "seo", "sharing"],
    starterCode: `<head>
  <title>Page</title>
</head>
`,
    referenceSolution: `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>Flexbox in one hour — Code Queens Hub</title>
  <meta
    name="description"
    content="A one-hour walkthrough of the flex container, the main and cross axes, and the four properties that do most of the work."
  />

  <!-- Without this, ?utm_source=... and a trailing slash look like three
       different pages to a search engine, splitting the page's ranking across
       all of them and letting the wrong one win. -->
  <link rel="canonical" href="https://example.test/weeks/2/lectures/1" />

  <!-- Absolute URLs: a scraper resolves relative ones against itself. -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="Flexbox in one hour" />
  <meta property="og:description" content="The flex container, the two axes, and the four properties that matter." />
  <meta property="og:url" content="https://example.test/weeks/2/lectures/1" />
  <meta property="og:image" content="https://example.test/og/flexbox.png" />
  <meta name="twitter:card" content="summary_large_image" />

  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</head>
`,
  },
  {
    ...base,
    slug: "html-modal-dialog-markup",
    title: "A dialog that traps focus honestly",
    level: "advanced",
    isInterview: true,
    statement: [
      "Mark up a confirmation dialog using the native `<dialog>` element, with an",
      "accessible name, a description, and a default action.",
      "",
      "Then list in a comment the four behaviours a hand-rolled `div` modal has to",
      "reimplement, and which of them the native element gives you.",
    ].join("\n"),
    hints: [
      "`dialog.showModal()` gives focus trapping, the Escape key, the backdrop and inertness of the rest of the page. A `div` gives you none of them.",
      "`aria-labelledby` and `aria-describedby` are what make the dialog announce its purpose instead of just 'dialog'.",
    ],
    tags: ["dialog", "aria", "accessibility", "focus"],
    starterCode: `<div class="modal">
  <p>Delete this submission?</p>
  <button>Yes</button>
  <button>No</button>
</div>
`,
    referenceSolution: `<dialog id="confirm-delete" aria-labelledby="confirm-title" aria-describedby="confirm-body">
  <h2 id="confirm-title">Delete this submission?</h2>
  <p id="confirm-body">
    The file and its feedback are removed. This cannot be undone.
  </p>
  <form method="dialog">
    <!-- The first button is the default action for Enter. -->
    <button value="cancel" autofocus>Keep it</button>
    <button value="confirm">Delete</button>
  </form>
</dialog>

<!--
  A hand-rolled div modal must reimplement all four of these, and usually gets
  the last two wrong:
    1. focus moves INTO the dialog on open and back to the trigger on close;
    2. Tab and Shift+Tab stay inside it;
    3. Escape closes it;
    4. everything behind it is inert — not merely covered, but unreachable by
       keyboard and invisible to a screen reader.
  showModal() provides all four, plus ::backdrop. That is the entire argument
  for using the native element.
-->
`,
  },
  {
    ...base,
    slug: "html-live-region-updates",
    title: "Announce a result that appears without a page load",
    level: "advanced",
    isInterview: true,
    statement: [
      "A quiz result appears in the page after an asynchronous submit. Mark up the region",
      "so a screen-reader user hears the score, and mark up a separate area for a",
      "validation error that must interrupt.",
      "",
      "Explain in a comment why the container has to exist in the DOM before the text",
      "arrives.",
    ].join("\n"),
    hints: [
      "`aria-live=\"polite\"` waits for a pause; `assertive` interrupts. Use assertive only for something the user must act on now, because interrupting is expensive.",
      "`role=\"status\"` and `role=\"alert\"` are shorthands for the two common cases and carry the right implicit politeness.",
    ],
    tags: ["aria", "live-region", "accessibility"],
    starterCode: `<button type="button" onclick="submitQuiz()">Submit</button>
<!-- TODO: where does the result go, and how is it announced? -->
`,
    referenceSolution: `<button type="button" onclick="submitQuiz()">Submit</button>

<!-- Announced when the page is quiet. EMPTY BUT PRESENT: a live region is only
     watched from the moment it is in the DOM, so a container inserted together
     with its text is frequently announced not at all. Render it empty up front
     and fill it later. -->
<p id="quiz-result" role="status" aria-live="polite"></p>

<!-- Interrupts, because the user cannot proceed until they fix it. Reserve this
     politeness for exactly that case. -->
<p id="quiz-error" role="alert"></p>

<!-- aria-busy while the request is in flight stops a partially rendered result
     being read out mid-update. -->
<div id="quiz-panel" aria-busy="false"></div>
`,
  },
];
