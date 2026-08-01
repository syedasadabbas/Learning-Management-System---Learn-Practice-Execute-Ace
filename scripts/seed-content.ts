// =============================================================================
// CURRICULUM CONTENT — the data the seed script inserts.
// -----------------------------------------------------------------------------
// Separated from seed.ts so the insert logic stays readable and so the
// instructor-admin stream can reuse these shapes for its create/edit forms.
//
// TODO(content): this curriculum was authored to match
// appConfig.course.description ("HTML5, CSS3, JavaScript, Git & deployment —
// beginner to job-ready in four weeks"). It has NOT been reconciled against the
// original Code Queens Hub syllabus document, which was not available when this
// was written. Review question wording and week ordering against that syllabus
// before a real cohort starts.
//
// TODO(content): every `youtubeUrl` is null. Real video IDs must be supplied by
// the course owner — inventing IDs produces embeds that 404, which is worse than
// an honest "video coming soon" placeholder. The course-content stream renders
// the placeholder when this field is null.
// =============================================================================

/** A single multiple-choice question. Exactly one option has isCorrect: true. */
export type SeedQuestion = {
  questionText: string;
  explanation: string;
  options: { text: string; correct?: boolean }[];
};

export type SeedResource =
  | { title: string; type: "link"; url: string }
  | { title: string; type: "sandpack"; starterCode: Record<string, string> };

export type SeedLecture = {
  lectureNumber: number;
  title: string;
  content: string;
  youtubeUrl: string | null;
  /**
   * Stable curriculum topic identifier, written to `lectures.topic_key`.
   *
   * This is the join key between a lecture and the reviewed videos in
   * `topic_videos` (see scripts/content/curated-videos.json). It is NOT the
   * lecture id — serial ids are reassigned by every reseed, so a video mapping
   * keyed on them would silently attach the wrong video afterwards — and it is
   * NOT the title, because titles get copy-edited.
   *
   * Null is legal and means "no curated videos for this lecture yet"; the page
   * then falls back to `youtubeUrl` and, failing that, to the honest
   * "Video coming soon" placeholder. Nothing breaks while it is null.
   */
  topicKey: string | null;
  resources: SeedResource[];
};

export type SeedWeek = {
  weekNumber: number;
  title: string;
  description: string;
  lectures: SeedLecture[];
  quiz: { title: string; questions: SeedQuestion[] };
  assignment: {
    title: string;
    description: string;
    requirements: string[];
  };
};

export const curriculum: SeedWeek[] = [
  // ==========================================================================
  // WEEK 1 — HTML5 foundations
  // ==========================================================================
  {
    weekNumber: 1,
    title: "HTML5 Foundations",
    description:
      "Document structure, semantic elements, text and media, links, lists, tables, and accessible forms.",
    lectures: [
      {
        lectureNumber: 1,
        title: "How the Web Works & Your First HTML Document",
        content: [
          "## What you'll build",
          "A valid HTML5 page you can open in a browser and share as a link.",
          "",
          "## The request/response cycle",
          "A browser sends an HTTP **request** to a server; the server returns a",
          "**response** containing HTML. The browser parses that HTML into the DOM",
          "and paints it. Everything else — CSS, JavaScript, images — is fetched as",
          "additional requests triggered by that first document.",
          "",
          "## The minimum valid document",
          "```html",
          "<!DOCTYPE html>",
          '<html lang="en">',
          "  <head>",
          '    <meta charset="utf-8" />',
          '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
          "    <title>My first page</title>",
          "  </head>",
          "  <body>",
          "    <h1>Hello, world</h1>",
          "  </body>",
          "</html>",
          "```",
          "",
          "`<!DOCTYPE html>` is not a tag — it tells the browser to use standards",
          "mode. Omit it and you get quirks mode, where layout rules from the 1990s",
          "apply and your CSS will behave unpredictably.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "web-basics-first-html-document",
        resources: [
          { title: "W3Schools — HTML Introduction", type: "link", url: "https://www.w3schools.com/html/html_intro.asp" },
          { title: "W3Schools — HTML Basic Examples", type: "link", url: "https://www.w3schools.com/html/html_basic.asp" },
          {
            title: "Practice: build a valid page skeleton",
            type: "sandpack",
            starterCode: {
              "/index.html": [
                "<!DOCTYPE html>",
                '<html lang="en">',
                "  <head>",
                '    <meta charset="utf-8" />',
                "    <title>TODO: give this page a title</title>",
                "  </head>",
                "  <body>",
                "    <!-- TODO: add an h1 and a paragraph introducing yourself -->",
                "  </body>",
                "</html>",
              ].join("\n"),
            },
          },
        ],
      },
      {
        lectureNumber: 2,
        title: "Semantic Structure, Text & Media",
        content: [
          "## Semantics carry meaning, not appearance",
          "`<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, and",
          "`<footer>` describe *what a region is*. Screen readers use them to offer",
          "landmark navigation, and search engines use them to understand structure.",
          "A `<div>` says nothing at all.",
          "",
          "## Headings are an outline, not font sizes",
          "Use exactly one `<h1>` per page and never skip levels to get a smaller",
          "font — that is CSS's job. A screen-reader user navigating by heading",
          "hears your outline; skipped levels read as missing content.",
          "",
          "## Images need alt text",
          "```html",
          '<img src="team.jpg" alt="Six interns presenting their final projects" />',
          "```",
          "Decorative images take `alt=\"\"` (empty, but present) so assistive",
          "technology skips them. Omitting `alt` entirely makes the screen reader",
          "read the filename aloud.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "html-semantic-structure",
        resources: [
          { title: "W3Schools — Semantic Elements", type: "link", url: "https://www.w3schools.com/html/html5_semantic_elements.asp" },
          { title: "W3Schools — HTML Images", type: "link", url: "https://www.w3schools.com/html/html_images.asp" },
        ],
      },
      {
        lectureNumber: 3,
        title: "Links, Lists, Tables & Accessible Forms",
        content: [
          "## Forms: every input needs a label",
          "```html",
          '<label for="email">Email address</label>',
          '<input id="email" name="email" type="email" required />',
          "```",
          "The `for` attribute must match the input's `id`. That pairing is what",
          "lets a screen reader announce the field and what makes clicking the",
          "label focus the input. Placeholder text is **not** a label — it vanishes",
          "as soon as the user types.",
          "",
          "## Tables are for data, not layout",
          "Use `<th scope=\"col\">` for header cells and `<caption>` to describe the",
          "table. Using tables to position page elements is the single most common",
          "beginner mistake inherited from pre-CSS web design.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "html-forms-tables-accessibility",
        resources: [
          { title: "W3Schools — HTML Forms", type: "link", url: "https://www.w3schools.com/html/html_forms.asp" },
          { title: "W3Schools — HTML Tables", type: "link", url: "https://www.w3schools.com/html/html_tables.asp" },
          {
            title: "Practice: an accessible sign-up form",
            type: "sandpack",
            starterCode: {
              "/index.html": [
                "<!DOCTYPE html>",
                '<html lang="en">',
                '  <head><meta charset="utf-8" /><title>Sign up</title></head>',
                "  <body>",
                "    <h1>Sign up</h1>",
                "    <form>",
                "      <!-- TODO: add labelled inputs for name, email and password -->",
                "      <!-- Each <input> needs an id, and each <label> a matching for= -->",
                "      <button type=\"submit\">Create account</button>",
                "    </form>",
                "  </body>",
                "</html>",
              ].join("\n"),
            },
          },
        ],
      },
    ],
    quiz: {
      title: "Week 1 Quiz — HTML5 Foundations",
      questions: [
        {
          questionText: "What is the purpose of the <!DOCTYPE html> declaration?",
          explanation:
            "It instructs the browser to render the page in standards mode. Without it the browser falls back to quirks mode, which emulates legacy layout behaviour.",
          options: [
            { text: "It tells the browser to render the page in standards mode", correct: true },
            { text: "It imports the HTML5 JavaScript library" },
            { text: "It is an HTML comment describing the document version" },
            { text: "It sets the character encoding for the document" },
          ],
        },
        {
          questionText: "Which element should contain the dominant content of a page, appearing once per document?",
          explanation:
            "<main> holds the primary content and must appear only once. Screen readers expose it as the 'main' landmark so users can skip navigation.",
          options: [
            { text: "<main>", correct: true },
            { text: "<section>" },
            { text: "<div class=\"main\">" },
            { text: "<article>" },
          ],
        },
        {
          questionText: "What does the alt attribute on an <img> provide?",
          explanation:
            "alt supplies a text alternative used by screen readers and shown when the image fails to load. Decorative images use alt=\"\" so assistive tech skips them.",
          options: [
            { text: "A text alternative for assistive technology and failed loads", correct: true },
            { text: "A tooltip that appears when hovering the image" },
            { text: "The image's caption, rendered below it" },
            { text: "An alternative image URL used if the first one 404s" },
          ],
        },
        {
          questionText: "Which attribute pairing correctly associates a <label> with its <input>?",
          explanation:
            "The label's for attribute must equal the input's id. This is what makes clicking the label focus the field and lets screen readers announce it.",
          options: [
            { text: "The label's for attribute matches the input's id", correct: true },
            { text: "The label's name attribute matches the input's name" },
            { text: "The label's id matches the input's for attribute" },
            { text: "The label's htmlFor attribute matches the input's class" },
          ],
        },
        {
          questionText: "Why should you avoid skipping heading levels, for example jumping from <h2> to <h4>?",
          explanation:
            "Headings form the document outline that screen-reader users navigate by. A skipped level reads as missing content. Font size is a CSS concern, not a reason to change heading level.",
          options: [
            { text: "Headings form a navigable outline, and gaps read as missing content", correct: true },
            { text: "Browsers refuse to render headings that skip a level" },
            { text: "Search engines ignore every heading after the first gap" },
            { text: "It causes the page to fall back into quirks mode" },
          ],
        },
        {
          questionText: "What is the correct use of the <table> element in modern HTML?",
          explanation:
            "Tables represent tabular data with rows and columns. Using them to position unrelated page regions is a pre-CSS practice that breaks accessibility and responsiveness.",
          options: [
            { text: "Presenting tabular data, with <th> header cells and a <caption>", correct: true },
            { text: "Laying out page regions such as sidebars and headers" },
            { text: "Creating a responsive grid of cards" },
            { text: "Aligning form inputs into neat columns" },
          ],
        },
        {
          questionText: "Which <meta> tag is required for a page to scale correctly on mobile devices?",
          explanation:
            "Without the viewport meta tag, mobile browsers render at a virtual desktop width (typically 980px) and zoom out, so CSS media queries never match as intended.",
          options: [
            { text: '<meta name="viewport" content="width=device-width, initial-scale=1" />', correct: true },
            { text: '<meta name="mobile" content="responsive" />' },
            { text: '<meta charset="utf-8" />' },
            { text: '<meta name="screen-size" content="auto" />' },
          ],
        },
        {
          questionText: "What is the difference between an ordered and an unordered list?",
          explanation:
            "<ol> conveys that sequence is meaningful (steps, rankings); <ul> conveys that it is not. The visual marker is incidental and restyleable with CSS.",
          options: [
            { text: "<ol> means the sequence carries meaning; <ul> means it does not", correct: true },
            { text: "<ol> renders numbers and <ul> renders bullets, with no other difference" },
            { text: "<ol> may only contain text while <ul> may contain any element" },
            { text: "<ul> is deprecated in HTML5 in favour of <ol>" },
          ],
        },
        {
          questionText: "In <a href=\"page.html\" target=\"_blank\">, what does target=\"_blank\" do?",
          explanation:
            "It opens the link in a new tab or window. Pair it with rel=\"noopener\" to stop the new page from accessing window.opener, which is a security concern.",
          options: [
            { text: "Opens the linked document in a new browser tab or window", correct: true },
            { text: "Blanks the current page before navigating" },
            { text: "Prevents the browser from adding the link to history" },
            { text: "Loads the page without its stylesheets" },
          ],
        },
        {
          questionText: "Which element group correctly identifies HTML5 semantic sectioning elements?",
          explanation:
            "header, nav, main, article, section, aside and footer describe the role of a region. <div> and <span> are generic containers with no semantic meaning.",
          options: [
            { text: "<header>, <nav>, <article>, <aside>, <footer>", correct: true },
            { text: "<div>, <span>, <b>, <i>, <center>" },
            { text: "<table>, <tr>, <td>, <th>, <caption>" },
            { text: "<form>, <input>, <label>, <select>, <option>" },
          ],
        },
      ],
    },
    assignment: {
      title: "Week 1 Assignment — Personal Profile Page",
      description:
        "Build a single-page personal profile in semantic HTML5. No CSS yet — the goal is correct structure and accessibility, which you will style in Week 2.",
      requirements: [
        "A valid HTML5 document: doctype, lang attribute, charset and viewport meta tags",
        "Semantic layout using header, nav, main and footer",
        "Exactly one h1, with no skipped heading levels below it",
        "At least one image with meaningful alt text",
        "An unordered list of at least three skills you want to learn",
        "A contact form with correctly labelled name, email and message fields",
        "Passes the W3C validator with zero errors — include a screenshot of the result",
        "Pushed to a public GitHub repository, with the repository URL in your submission",
      ],
    },
  },

  // ==========================================================================
  // WEEK 2 — CSS3 and responsive design
  // ==========================================================================
  {
    weekNumber: 2,
    title: "CSS3 & Responsive Design",
    description:
      "Selectors, specificity, the box model, Flexbox, Grid, media queries, and a mobile-first workflow.",
    lectures: [
      {
        lectureNumber: 1,
        title: "Selectors, the Cascade & Specificity",
        content: [
          "## Why your rule 'isn't working'",
          "Nine times out of ten it is being overridden. When two rules target the",
          "same element, the browser resolves the conflict in this order:",
          "",
          "1. **Origin and importance** — `!important` beats normal declarations.",
          "2. **Specificity** — id (1,0,0) beats class (0,1,0) beats element (0,0,1).",
          "3. **Source order** — the last matching rule of equal specificity wins.",
          "",
          "## The box model",
          "```css",
          "* { box-sizing: border-box; }",
          "```",
          "By default `width` sets the *content* width, so padding and border are",
          "added on top and a `width: 100%` element with padding overflows its",
          "parent. `border-box` makes `width` include padding and border, which is",
          "what almost everyone actually wants. Set it once, globally.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "css-selectors-cascade-specificity",
        resources: [
          { title: "W3Schools — CSS Selectors", type: "link", url: "https://www.w3schools.com/css/css_selectors.asp" },
          { title: "W3Schools — CSS Specificity", type: "link", url: "https://www.w3schools.com/css/css_specificity.asp" },
          { title: "W3Schools — CSS Box Model", type: "link", url: "https://www.w3schools.com/css/css_boxmodel.asp" },
        ],
      },
      {
        lectureNumber: 2,
        title: "Flexbox & CSS Grid",
        content: [
          "## Flexbox: one dimension at a time",
          "```css",
          ".row { display: flex; justify-content: space-between; align-items: center; }",
          "```",
          "`justify-content` works along the **main** axis, `align-items` along the",
          "**cross** axis. Switch `flex-direction` to `column` and the two swap",
          "meaning — this is the detail that trips people up.",
          "",
          "## Grid: two dimensions at once",
          "```css",
          ".cards {",
          "  display: grid;",
          "  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));",
          "  gap: 1rem;",
          "}",
          "```",
          "That one declaration produces a responsive card grid with no media",
          "queries: tracks are at least 240px, share leftover space equally, and",
          "the column count adapts to the container.",
          "",
          "Reach for Flexbox for a row or a column of items; reach for Grid when you",
          "are placing items into rows *and* columns.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "css-flexbox-and-grid",
        resources: [
          { title: "W3Schools — CSS Flexbox", type: "link", url: "https://www.w3schools.com/css/css3_flexbox.asp" },
          { title: "W3Schools — CSS Grid Layout", type: "link", url: "https://www.w3schools.com/css/css_grid.asp" },
          {
            title: "Practice: centre a card with Flexbox",
            type: "sandpack",
            starterCode: {
              "/index.html": [
                "<!DOCTYPE html>",
                '<html lang="en">',
                '  <head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>',
                "  <body>",
                '    <div class="stage"><div class="card">Centre me</div></div>',
                "  </body>",
                "</html>",
              ].join("\n"),
              "/styles.css": [
                "* { box-sizing: border-box; }",
                ".stage {",
                "  min-height: 100vh;",
                "  /* TODO: use Flexbox to centre .card both horizontally and vertically */",
                "}",
                ".card { padding: 2rem; background: #4f5bd5; color: white; border-radius: 8px; }",
              ].join("\n"),
            },
          },
        ],
      },
      {
        lectureNumber: 3,
        title: "Mobile-First Responsive Design",
        content: [
          "## Write the small screen first",
          "```css",
          "/* base: mobile */",
          ".layout { display: grid; gap: 1rem; }",
          "",
          "/* enhance upward */",
          "@media (min-width: 48rem) {",
          "  .layout { grid-template-columns: 2fr 1fr; }",
          "}",
          "```",
          "Mobile-first means your base styles need no media query at all, and each",
          "`min-width` query adds capability. The reverse (`max-width`, desktop",
          "first) forces you to undo styles, and undoing is where bugs live.",
          "",
          "## Use relative units for breakpoints",
          "`48rem` respects a user who has increased their default font size;",
          "`768px` ignores them. Accessibility is not a separate task you add later.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "css-mobile-first-responsive",
        resources: [
          { title: "W3Schools — CSS Media Queries", type: "link", url: "https://www.w3schools.com/css/css3_mediaqueries.asp" },
          { title: "W3Schools — Responsive Web Design Intro", type: "link", url: "https://www.w3schools.com/css/css_rwd_intro.asp" },
        ],
      },
    ],
    quiz: {
      title: "Week 2 Quiz — CSS3 & Responsive Design",
      questions: [
        {
          questionText: "What does box-sizing: border-box change about how width is calculated?",
          explanation:
            "With border-box, the width property includes padding and border. With the default content-box, padding and border are added outside the declared width, causing overflow.",
          options: [
            { text: "width includes the element's padding and border", correct: true },
            { text: "width includes the element's margin as well as padding" },
            { text: "width is measured from the parent's border instead of its content" },
            { text: "width becomes a minimum rather than a fixed size" },
          ],
        },
        {
          questionText: "Given equal source order, which selector has the highest specificity?",
          explanation:
            "Specificity is counted as (id, class/attribute/pseudo-class, element). #nav is (1,0,0), which outranks any number of classes or elements.",
          options: [
            { text: "#nav", correct: true },
            { text: ".nav.primary" },
            { text: "nav ul li a" },
            { text: "ul.nav li" },
          ],
        },
        {
          questionText: "In a Flexbox container with the default flex-direction: row, what does justify-content control?",
          explanation:
            "justify-content distributes space along the main axis, which is horizontal for row. align-items handles the cross axis. Changing flex-direction to column swaps which is which.",
          options: [
            { text: "Distribution of items along the horizontal main axis", correct: true },
            { text: "Vertical alignment of items within the container" },
            { text: "The order in which flex items are painted" },
            { text: "How much each item grows to fill free space" },
          ],
        },
        {
          questionText: "What does grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) achieve?",
          explanation:
            "It creates as many columns as fit, each at least 240px and sharing leftover space equally — a responsive grid that needs no media queries.",
          options: [
            { text: "A responsive number of columns, each at least 240px wide", correct: true },
            { text: "Exactly 240 columns of 1fr each" },
            { text: "A single column that is never narrower than 240px" },
            { text: "Columns that are always exactly 240px, overflowing if needed" },
          ],
        },
        {
          questionText: "Why is mobile-first CSS generally preferred over desktop-first?",
          explanation:
            "Mobile-first uses min-width queries that progressively add capability, so base styles need no query and nothing has to be undone. Desktop-first requires overriding styles downward, which is where specificity bugs accumulate.",
          options: [
            { text: "Base styles need no media query and enhancements only add, never undo", correct: true },
            { text: "max-width media queries are deprecated in modern CSS" },
            { text: "Mobile browsers cannot parse max-width queries" },
            { text: "It produces a smaller stylesheet in every case" },
          ],
        },
        {
          questionText: "What is the difference between the CSS units rem and em?",
          explanation:
            "rem is always relative to the root element's font size; em is relative to the font size of the element itself, so nested ems compound.",
          options: [
            { text: "rem is relative to the root font size; em is relative to the element's own font size", correct: true },
            { text: "rem is relative to the parent; em is relative to the root" },
            { text: "rem is an absolute pixel unit; em is relative" },
            { text: "They are identical aliases kept for backwards compatibility" },
          ],
        },
        {
          questionText: "What does position: absolute position an element relative to?",
          explanation:
            "An absolutely positioned element is placed relative to its nearest ancestor with a position other than static. If none exists, it positions against the initial containing block.",
          options: [
            { text: "Its nearest ancestor whose position is not static", correct: true },
            { text: "Always the browser viewport, regardless of ancestors" },
            { text: "Its immediate parent element in every case" },
            { text: "The element's own original position in the flow" },
          ],
        },
        {
          questionText: "Which declaration makes a flex item shrink and grow to share available space equally with its siblings?",
          explanation:
            "flex: 1 is shorthand for flex-grow: 1, flex-shrink: 1, flex-basis: 0% — the item takes an equal share of free space.",
          options: [
            { text: "flex: 1", correct: true },
            { text: "flex-wrap: wrap" },
            { text: "align-self: stretch" },
            { text: "width: auto" },
          ],
        },
        {
          questionText: "What is the effect of using !important on a declaration?",
          explanation:
            "It raises the declaration above normal cascade resolution, so it beats higher-specificity selectors. It is a maintenance hazard because the only way to override it is another !important.",
          options: [
            { text: "It overrides normal declarations regardless of specificity", correct: true },
            { text: "It increases the selector's specificity by one id" },
            { text: "It applies the rule before all other stylesheets load" },
            { text: "It marks the rule as required, erroring if the selector matches nothing" },
          ],
        },
        {
          questionText: "Why should breakpoints preferably be written in rem rather than px?",
          explanation:
            "rem-based breakpoints scale with the user's chosen default font size, so someone who enlarges text still gets an appropriate layout. Pixel breakpoints ignore that preference.",
          options: [
            { text: "rem breakpoints respect a user's increased default font size", correct: true },
            { text: "px is not a valid unit inside a media query" },
            { text: "rem breakpoints are evaluated faster by the browser" },
            { text: "px breakpoints only work in portrait orientation" },
          ],
        },
      ],
    },
    assignment: {
      title: "Week 2 Assignment — Style & Make It Responsive",
      description:
        "Take your Week 1 profile page and style it with CSS3. It must work from a 320px phone up to a wide desktop without horizontal scrolling.",
      requirements: [
        "An external stylesheet — no inline style attributes and no <style> blocks",
        "A global box-sizing: border-box reset",
        "Flexbox used for at least one component, and CSS Grid for at least one layout region",
        "Mobile-first: base styles unqueried, with at least two min-width breakpoints",
        "No horizontal scrolling at 320px width",
        "A consistent colour palette and type scale defined with CSS custom properties",
        "Screenshots at mobile, tablet and desktop widths included in your submission",
        "Deployed live (GitHub Pages, Netlify or Vercel) with the URL in your submission",
      ],
    },
  },

  // ==========================================================================
  // WEEK 3 — JavaScript fundamentals
  // ==========================================================================
  {
    weekNumber: 3,
    title: "JavaScript Fundamentals",
    description:
      "Variables, types, functions, arrays and objects, DOM manipulation, events, and asynchronous data fetching.",
    lectures: [
      {
        lectureNumber: 1,
        title: "Values, Types & Functions",
        content: [
          "## let and const, never var",
          "`var` is function-scoped and hoisted, which produces surprising bugs in",
          "loops and blocks. `let` and `const` are block-scoped. Default to",
          "`const`; reach for `let` only when you genuinely reassign.",
          "",
          "## The equality trap",
          "```js",
          '0 == "";      // true  — == coerces types',
          '0 === "";     // false — === compares type and value',
          "```",
          "Use `===` and `!==` exclusively. The coercion rules behind `==` are a",
          "well-known source of defects and are not worth memorising.",
          "",
          "## Arrow functions",
          "```js",
          "const double = (n) => n * 2;",
          "```",
          "Arrow functions do not bind their own `this` — they inherit it from the",
          "enclosing scope, which is usually what you want inside callbacks.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "js-values-types-functions",
        resources: [
          { title: "W3Schools — JavaScript Variables", type: "link", url: "https://www.w3schools.com/js/js_variables.asp" },
          { title: "W3Schools — JavaScript Functions", type: "link", url: "https://www.w3schools.com/js/js_functions.asp" },
          { title: "W3Schools — JavaScript Comparisons", type: "link", url: "https://www.w3schools.com/js/js_comparisons.asp" },
        ],
      },
      {
        lectureNumber: 2,
        title: "Arrays, Objects & the DOM",
        content: [
          "## Transform, don't mutate",
          "```js",
          "const names = users.map((u) => u.name);",
          "const adults = users.filter((u) => u.age >= 18);",
          "const total = prices.reduce((sum, p) => sum + p, 0);",
          "```",
          "`map`, `filter` and `reduce` return new arrays rather than modifying the",
          "original. Code built from them is far easier to reason about than code",
          "built from index-mutating loops.",
          "",
          "## Selecting and updating elements",
          "```js",
          'const btn = document.querySelector("#save");',
          'btn.textContent = "Saved";',
          'btn.classList.add("is-active");',
          "```",
          "Prefer `textContent` over `innerHTML` when inserting user-supplied text —",
          "`innerHTML` parses markup, which is how cross-site scripting gets in.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "js-arrays-objects-dom",
        resources: [
          { title: "W3Schools — JavaScript Array Methods", type: "link", url: "https://www.w3schools.com/js/js_array_methods.asp" },
          { title: "W3Schools — JavaScript DOM Elements", type: "link", url: "https://www.w3schools.com/js/js_htmldom_elements.asp" },
          {
            title: "Practice: a working counter",
            type: "sandpack",
            starterCode: {
              "/index.html": [
                "<!DOCTYPE html>",
                '<html lang="en">',
                '  <head><meta charset="utf-8" /></head>',
                "  <body>",
                '    <p>Count: <span id="count">0</span></p>',
                '    <button id="inc">Increment</button>',
                '    <script src="app.js"></script>',
                "  </body>",
                "</html>",
              ].join("\n"),
              "/app.js": [
                "// TODO: select #inc and #count, then increment the displayed",
                "// number each time the button is clicked.",
              ].join("\n"),
            },
          },
        ],
      },
      {
        lectureNumber: 3,
        title: "Events & Asynchronous JavaScript",
        content: [
          "## Events",
          "```js",
          'form.addEventListener("submit", (event) => {',
          "  event.preventDefault(); // stop the default page reload",
          "  // ... validate and send",
          "});",
          "```",
          "",
          "## async/await over promise chains",
          "```js",
          "async function loadUsers() {",
          "  try {",
          '    const res = await fetch("/api/users");',
          "    if (!res.ok) throw new Error(`HTTP ${res.status}`);",
          "    return await res.json();",
          "  } catch (err) {",
          '    console.error("Failed to load users", err);',
          "    return [];",
          "  }",
          "}",
          "```",
          "Note the `res.ok` check: `fetch` only rejects on a *network* failure. A",
          "404 or 500 resolves successfully, so a missing status check silently",
          "treats an error page as valid data. This is the most common `fetch` bug.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "js-events-and-async",
        resources: [
          { title: "W3Schools — JavaScript Events", type: "link", url: "https://www.w3schools.com/js/js_events.asp" },
          { title: "W3Schools — JavaScript Async/Await", type: "link", url: "https://www.w3schools.com/js/js_async.asp" },
        ],
      },
    ],
    quiz: {
      title: "Week 3 Quiz — JavaScript Fundamentals",
      questions: [
        {
          questionText: "What is the key scoping difference between var and let?",
          explanation:
            "var is function-scoped and hoisted; let is block-scoped, so it is confined to the nearest enclosing braces. This is why let behaves predictably inside loops.",
          options: [
            { text: "var is function-scoped while let is block-scoped", correct: true },
            { text: "var is block-scoped while let is function-scoped" },
            { text: "let variables cannot be reassigned but var variables can" },
            { text: "There is no difference; let is only newer syntax" },
          ],
        },
        {
          questionText: "What does === compare that == does not?",
          explanation:
            "=== compares both type and value with no coercion. == coerces operands to a common type first, which makes results like 0 == \"\" evaluate to true.",
          options: [
            { text: "Type as well as value, performing no coercion", correct: true },
            { text: "Object identity rather than contents" },
            { text: "Only the value, ignoring type" },
            { text: "Whether both operands are truthy" },
          ],
        },
        {
          questionText: "What does Array.prototype.map return?",
          explanation:
            "map returns a new array of the same length containing the callback's return value for each element. The original array is untouched.",
          options: [
            { text: "A new array of the same length holding each callback result", correct: true },
            { text: "The original array, modified in place" },
            { text: "A single accumulated value" },
            { text: "A new array containing only the elements that passed a test" },
          ],
        },
        {
          questionText: "Why is textContent usually safer than innerHTML for inserting user-supplied text?",
          explanation:
            "innerHTML parses the string as markup, so a hostile value can inject executable elements — a cross-site scripting vector. textContent inserts the value as literal text.",
          options: [
            { text: "innerHTML parses markup, allowing script injection; textContent does not", correct: true },
            { text: "textContent is faster because it skips the DOM entirely" },
            { text: "innerHTML has been removed from modern browsers" },
            { text: "textContent automatically escapes SQL as well as HTML" },
          ],
        },
        {
          questionText: "What does event.preventDefault() do in a form submit handler?",
          explanation:
            "It cancels the browser's default action — for a submit event, the full page reload and navigation — leaving your JavaScript to handle the submission.",
          options: [
            { text: "Cancels the browser's default behaviour, such as reloading the page", correct: true },
            { text: "Stops the event from reaching other listeners on ancestor elements" },
            { text: "Prevents the form from validating its required fields" },
            { text: "Removes the event listener after it runs once" },
          ],
        },
        {
          questionText: "Does fetch() reject its promise when the server returns HTTP 404?",
          explanation:
            "No. fetch only rejects on network failure. A 404 or 500 resolves normally with response.ok set to false, so you must check res.ok yourself.",
          options: [
            { text: "No — it resolves with response.ok set to false", correct: true },
            { text: "Yes — any status outside 200-299 rejects the promise" },
            { text: "Yes, but only for 5xx status codes" },
            { text: "No — it retries the request three times automatically" },
          ],
        },
        {
          questionText: "What value does an arrow function bind for this?",
          explanation:
            "Arrow functions do not create their own this binding; they inherit it lexically from the enclosing scope. This is why they work well as callbacks.",
          options: [
            { text: "It inherits this lexically from the enclosing scope", correct: true },
            { text: "It always binds this to the global object" },
            { text: "It binds this to the object that invoked it" },
            { text: "It binds this to undefined in every case" },
          ],
        },
        {
          questionText: "What does Array.prototype.reduce produce?",
          explanation:
            "reduce folds an array into a single accumulated value, carrying the accumulator through each iteration from an optional initial value.",
          options: [
            { text: "A single accumulated value built across all elements", correct: true },
            { text: "A new array with falsy values removed" },
            { text: "The array sorted in ascending order" },
            { text: "A shortened copy of the array" },
          ],
        },
        {
          questionText: "In async function f() { const x = await g(); }, what does await do?",
          explanation:
            "await pauses execution of the async function until the awaited promise settles, then evaluates to its resolved value. A rejection throws, so it can be caught with try/catch.",
          options: [
            { text: "Pauses the async function until the promise settles, yielding its value", correct: true },
            { text: "Blocks the entire JavaScript thread until the promise settles" },
            { text: "Converts a callback-based function into a promise" },
            { text: "Retries the promise until it resolves successfully" },
          ],
        },
        {
          questionText: "What does document.querySelector('.card') return when several elements match?",
          explanation:
            "querySelector returns only the first matching element, or null if nothing matches. querySelectorAll returns a NodeList of every match.",
          options: [
            { text: "The first matching element only", correct: true },
            { text: "A NodeList containing every match" },
            { text: "An array of every match" },
            { text: "null, because the selector is ambiguous" },
          ],
        },
      ],
    },
    assignment: {
      title: "Week 3 Assignment — Interactive Web App",
      description:
        "Build a small interactive application that fetches data from a public API and lets the user filter or search it. Vanilla JavaScript only — no frameworks.",
      requirements: [
        "Data loaded from a public API using fetch with async/await",
        "An explicit response.ok check, with a visible error message on failure",
        "A visible loading state while the request is in flight",
        "At least one user interaction that filters, sorts or searches the results",
        "DOM updates via textContent or createElement — no innerHTML with API data",
        "const and let only; no var anywhere in your code",
        "An empty state shown when a filter matches nothing",
        "Deployed live, with both the URL and the GitHub repository in your submission",
      ],
    },
  },

  // ==========================================================================
  // WEEK 4 — Git, deployment, final project
  // ==========================================================================
  {
    weekNumber: 4,
    title: "Git, Deployment & Final Project",
    description:
      "Version control with Git and GitHub, branching and pull requests, deployment pipelines, and the capstone project.",
    lectures: [
      {
        lectureNumber: 1,
        title: "Git Fundamentals & the Three Areas",
        content: [
          "## Working directory, staging area, repository",
          "```bash",
          "git status                 # what changed",
          "git add index.html         # working dir -> staging area",
          'git commit -m "Add hero"   # staging area -> repository',
          "git log --oneline          # history",
          "```",
          "The staging area is what lets you commit *some* of your changes. Learning",
          "to stage deliberately is what separates a readable history from a series",
          "of 'fixed stuff' commits.",
          "",
          "## Writing a useful commit message",
          "Use the imperative mood and say **why**, not what: the diff already shows",
          "what changed. `Fix nav overlap on iOS Safari` is useful;",
          "`update css` is not.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "git-fundamentals",
        resources: [
          { title: "W3Schools — Git Tutorial", type: "link", url: "https://www.w3schools.com/git/" },
          { title: "W3Schools — Git Commit", type: "link", url: "https://www.w3schools.com/git/git_commit.asp" },
        ],
      },
      {
        lectureNumber: 2,
        title: "Branching, Pull Requests & Collaboration",
        content: [
          "## Never commit straight to main",
          "```bash",
          "git checkout -b feature/contact-form",
          "# ... work, commit ...",
          "git push -u origin feature/contact-form",
          "# then open a pull request on GitHub",
          "```",
          "A branch isolates work in progress; a pull request is where it gets",
          "reviewed. This is exactly the workflow this LMS itself is built with:",
          "`main` for production, `develop` for staging, `feature/*` for work.",
          "",
          "## Resolving a merge conflict",
          "Git marks conflicts inline with `<<<<<<<`, `=======` and `>>>>>>>`. Edit",
          "the file to the state you actually want, delete all three markers, then",
          "`git add` the file and continue. Leaving a marker in a committed file is",
          "a common and very visible mistake.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "git-branching-pull-requests",
        resources: [
          { title: "W3Schools — Git Branch", type: "link", url: "https://www.w3schools.com/git/git_branch.asp" },
          { title: "W3Schools — Git Pull Requests", type: "link", url: "https://www.w3schools.com/git/git_remote_send_pull_request.asp" },
        ],
      },
      {
        lectureNumber: 3,
        title: "Deployment & Going Live",
        content: [
          "## Static hosting",
          "GitHub Pages, Netlify and Vercel all deploy a static site straight from a",
          "Git branch. Push to the tracked branch and the site rebuilds — this is",
          "continuous deployment, and you get it essentially for free.",
          "",
          "## Before you call it done",
          "- Every link and image resolves (check the browser console for 404s)",
          "- Works at 320px width with no horizontal scroll",
          "- Lighthouse accessibility score of 90 or above",
          "- No secrets or API keys committed to the repository",
          "- A README explaining what the project is and how to run it",
          "",
          "## Relative paths matter",
          "`/styles.css` resolves from the domain root and breaks on GitHub Pages",
          "project sites served from a subdirectory. `./styles.css` or",
          "`styles.css` resolves relative to the page and works in both places.",
        ].join("\n"),
        youtubeUrl: null,
        topicKey: "deployment-going-live",
        resources: [
          { title: "W3Schools — How To Publish a Website", type: "link", url: "https://www.w3schools.com/howto/howto_website_publish.asp" },
          { title: "W3Schools — HTML Responsive Design", type: "link", url: "https://www.w3schools.com/html/html_responsive.asp" },
        ],
      },
    ],
    quiz: {
      title: "Week 4 Quiz — Git, Deployment & Delivery",
      questions: [
        {
          questionText: "What does git add do?",
          explanation:
            "git add moves changes from the working directory into the staging area, selecting what the next commit will contain. It does not create a commit.",
          options: [
            { text: "Moves changes into the staging area, ready to be committed", correct: true },
            { text: "Creates a commit containing the changes" },
            { text: "Uploads the changes to the remote repository" },
            { text: "Adds a new file to the working directory" },
          ],
        },
        {
          questionText: "What is the difference between git fetch and git pull?",
          explanation:
            "fetch downloads remote commits without changing your working branch. pull is fetch followed by a merge (or rebase) into the current branch.",
          options: [
            { text: "fetch only downloads; pull downloads and merges into your branch", correct: true },
            { text: "pull only downloads; fetch downloads and merges" },
            { text: "fetch works on tags while pull works on branches" },
            { text: "They are aliases for the same operation" },
          ],
        },
        {
          questionText: "Why work on a feature branch rather than committing directly to main?",
          explanation:
            "A branch isolates unfinished work so main stays deployable, and it gives the change a place to be reviewed through a pull request before it merges.",
          options: [
            { text: "It keeps main deployable and gives the work a place to be reviewed", correct: true },
            { text: "Git refuses more than one commit per day on main" },
            { text: "Branches compress the repository and save disk space" },
            { text: "Only branches can be deployed by hosting providers" },
          ],
        },
        {
          questionText: "You see <<<<<<< HEAD in a file after a merge. What has happened?",
          explanation:
            "Git found a conflict it cannot resolve and marked both versions inline. You must edit the file to the intended state, remove all conflict markers, then git add it.",
          options: [
            { text: "A merge conflict was marked inline and needs manual resolution", correct: true },
            { text: "The file is corrupted and must be restored from the remote" },
            { text: "Git is showing a read-only preview of the incoming change" },
            { text: "The commit succeeded and the markers are harmless comments" },
          ],
        },
        {
          questionText: "What belongs in a .gitignore file?",
          explanation:
            "Paths that must never be committed: dependency directories like node_modules, build output, and files holding secrets such as .env. Committed secrets remain in history even after deletion.",
          options: [
            { text: "node_modules, build output, and secret files such as .env", correct: true },
            { text: "Every file you have not finished editing yet" },
            { text: "The README and licence files" },
            { text: "Large images, which Git cannot store" },
          ],
        },
        {
          questionText: "Why can a stylesheet linked as /styles.css break on a GitHub Pages project site?",
          explanation:
            "A leading slash resolves from the domain root, but a project site is served from /repo-name/. A relative path such as styles.css resolves against the page and works in both cases.",
          options: [
            { text: "A leading slash resolves from the domain root, not the project subdirectory", correct: true },
            { text: "GitHub Pages does not serve CSS files" },
            { text: "GitHub Pages requires all assets to be inlined" },
            { text: "The slash makes the browser request the file over HTTP instead of HTTPS" },
          ],
        },
        {
          questionText: "What is continuous deployment, as offered by Netlify and Vercel?",
          explanation:
            "Pushing to the tracked branch automatically triggers a build and publishes the result, so the live site follows the repository without a manual upload step.",
          options: [
            { text: "Pushing to the tracked branch automatically rebuilds and publishes the site", correct: true },
            { text: "The site is rebuilt on a fixed hourly schedule" },
            { text: "Visitors always receive the most recent commit without a build step" },
            { text: "Deployment happens only after a manual approval in the dashboard" },
          ],
        },
        {
          questionText: "What makes a good commit message?",
          explanation:
            "Imperative mood and an explanation of why the change was made. The diff already records what changed; the reasoning is the part that is otherwise lost.",
          options: [
            { text: "Imperative mood, explaining why the change was made", correct: true },
            { text: "A list of every file that was touched" },
            { text: "The current date and the author's name" },
            { text: "As short as possible, ideally a single word" },
          ],
        },
        {
          questionText: "What does git clone do that git init does not?",
          explanation:
            "clone copies an existing remote repository including its full history and sets up the origin remote. init creates a new empty repository with no history and no remote.",
          options: [
            { text: "Copies an existing repository with its history and configures origin", correct: true },
            { text: "Creates an empty repository in the current directory" },
            { text: "Duplicates the current branch under a new name" },
            { text: "Downloads only the latest files, without any history" },
          ],
        },
        {
          questionText: "Before calling a project done, why check the browser console?",
          explanation:
            "The console surfaces failed asset requests and JavaScript errors that are invisible on a cached local machine but break the site for a first-time visitor.",
          options: [
            { text: "It reveals 404s and script errors that a cached local view hides", correct: true },
            { text: "It is the only place the Lighthouse score is reported" },
            { text: "It confirms the deployment finished successfully" },
            { text: "It validates the HTML against the W3C specification" },
          ],
        },
      ],
    },
    assignment: {
      title: "Final Project — Multi-Page Responsive Website",
      description:
        "Your capstone. Build and deploy a complete multi-page responsive website that demonstrates everything from the four weeks: semantic HTML, responsive CSS, interactive JavaScript, and a clean Git history.",
      requirements: [
        "At least three linked pages with consistent, accessible navigation",
        "Fully responsive from 320px to wide desktop, with no horizontal scrolling",
        "At least one interactive JavaScript feature (form validation, filter, or API data)",
        "Semantic HTML throughout; zero W3C validator errors",
        "Lighthouse accessibility score of 90 or above — include the report screenshot",
        "A Git history of at least 15 meaningful commits made on feature branches",
        "At least one merged pull request in the repository",
        "A README covering what the project is, how to run it, and what you learned",
        "Deployed live, with the URL and repository link in your submission",
        "No secrets or API keys committed anywhere in the history",
      ],
    },
  },
];

// Sanity constraints the seed script asserts before touching the database.
export const EXPECTED_WEEKS = 4;
export const EXPECTED_QUESTIONS_PER_QUIZ = 10;
export const EXPECTED_TOTAL_QUESTIONS = EXPECTED_WEEKS * EXPECTED_QUESTIONS_PER_QUIZ; // 40
