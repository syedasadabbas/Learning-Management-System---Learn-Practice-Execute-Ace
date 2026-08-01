// =============================================================================
// WEEK 1 GRAND EXAM — "HTML5 Foundations". Blueprint: CURRICULUM_PLAN.md A.1.
// -----------------------------------------------------------------------------
// Draws on the week's three EXISTING lectures, unmodified:
//   L1 "How the Web Works & Your First HTML Document"
//   L2 "Semantic Structure, Text & Media"
//   L3 "Links, Lists, Tables & Accessible Forms"
//
// 30 mcq (2) + 14 code_fix (3) + 6 code_write (8) = 50 questions / 150 points.
// Ordered easy -> hard: recall, then applied reasoning, then traps, then code.
//
// ALL PROSE IS ORIGINAL. Nothing is copied from W3Schools, MDN or any other
// source; the week's own lecture text is the reference for scope only.
//
// `code_write` items are `html`. See the STRUCTURAL PROBE note in ./index.ts:
// markup is not executable, so those six tests are assertions over the submitted
// source, not stdin/stdout pairs.
// =============================================================================

import type { SeedExam } from "./types";

export const week1Exam: SeedExam = {
  weekNumber: 1,
  title: "Week 1 Grand Exam — HTML5 Foundations",
  questions: [
    // =======================================================================
    // mcq 1-12 — foundational recall
    // =======================================================================
    {
      type: "mcq",
      questionText:
        "You type an address into the browser and press Enter. What does the server send back first?",
      explanation:
        "The first response is the HTML document. Everything else the page needs — stylesheets, scripts, images, fonts — is requested afterwards because the browser found a reference to it while parsing that document.",
      options: [
        { text: "An HTTP response whose body is the HTML document", correct: true },
        { text: "A bundle containing the HTML, CSS, JavaScript and images together" },
        { text: "A rendered image of the finished page" },
        { text: "The stylesheet, so the browser knows how to draw the page before reading it" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does a browser produce when it parses an HTML document?",
      explanation:
        "Parsing builds the DOM: a tree of nodes the browser then lays out and paints, and the same tree JavaScript later reads and changes. The HTML text itself is not what gets displayed.",
      options: [
        { text: "The DOM — a tree of nodes representing the document", correct: true },
        { text: "A compiled binary the rendering engine executes" },
        { text: "A stylesheet derived from the tag names used" },
        { text: "A copy of the file in the browser cache, and nothing more" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the purpose of <!DOCTYPE html> at the top of a document?",
      explanation:
        "It is not an element and has no content. It tells the browser to use standards mode. Without it the browser falls back to quirks mode, where old layout behaviour applies and CSS results stop matching the specification.",
      options: [
        { text: "It puts the browser into standards mode rather than quirks mode", correct: true },
        { text: "It declares which HTML version the validator should use, and nothing else" },
        { text: "It is an element that wraps the whole document" },
        { text: "It selects the character encoding for the file" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which element pair is required for a document to be structurally complete?",
      explanation:
        "<head> carries metadata about the document and <body> carries what the reader sees. Both live inside <html>. <main> and <section> are meaningful but optional; <style> and <script> are not required at all.",
      options: [
        { text: "<head> and <body>, both inside <html>", correct: true },
        { text: "<main> and <section>, both inside <body>" },
        { text: "<style> and <script>, both inside <head>" },
        { text: "<header> and <footer>, both inside <html>" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does <meta charset=\"utf-8\" /> do?",
      explanation:
        "It declares the byte-to-character mapping the browser should use. Get it wrong and non-ASCII characters — accents, currency symbols, emoji — render as replacement characters even though the file itself is fine.",
      options: [
        { text: "Declares the character encoding used to interpret the file's bytes", correct: true },
        { text: "Translates the page into the reader's language" },
        { text: "Restricts the page to characters in the ASCII range" },
        { text: "Sets the font the browser will use for text" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "What does <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /> change?",
      explanation:
        "It tells a mobile browser to treat the layout viewport as the real device width instead of pretending to be a ~980 px desktop and shrinking the result. Without it a mobile visitor sees a zoomed-out desktop page and no width-based media query behaves as intended.",
      options: [
        {
          text: "It makes the layout viewport match the device width instead of a simulated desktop width",
          correct: true,
        },
        { text: "It disables pinch-to-zoom on touch devices" },
        { text: "It applies a mobile stylesheet automatically" },
        { text: "It sets the maximum width the page content may occupy" },
      ],
    },
    {
      type: "mcq",
      questionText: "Where does the text in <title> appear?",
      explanation:
        "The title names the document: it labels the browser tab and window, it is the default name for a bookmark, and it is usually the clickable line in search results. It is not rendered inside the page.",
      options: [
        { text: "In the browser tab, in bookmarks, and in search results", correct: true },
        { text: "As the first heading at the top of the page body" },
        { text: "Only in the page source, never anywhere visible" },
        { text: "In the browser's address bar, replacing the URL" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A page links one stylesheet, one script and shows two images. How many HTTP requests has the browser made in total?",
      explanation:
        "Five: one for the document plus one for each referenced resource. The first document is only a set of instructions about what else to fetch, which is why an unnecessary reference costs a real round trip.",
      options: [
        { text: "Five — the document plus four referenced resources", correct: true },
        { text: "One — the server sends the page and its assets together" },
        { text: "Four — images are embedded in the document, not requested" },
        { text: "Two — one for the document and one for all assets combined" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A page at /guides/intro.html contains <img src=\"photo.jpg\" />. Which file does the browser request?",
      explanation:
        "A reference with no leading slash resolves against the directory of the current document, so it becomes /guides/photo.jpg. This is why the same markup can work locally and break once the page moves into a subdirectory.",
      options: [
        { text: "/guides/photo.jpg", correct: true },
        { text: "/photo.jpg" },
        { text: "/guides/intro.html/photo.jpg" },
        { text: "Whichever photo.jpg the browser finds first in its cache" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does a leading slash in href=\"/styles.css\" mean?",
      explanation:
        "A leading slash means \"from the root of this origin\", regardless of where the current page lives. That breaks the moment the site is served from a subdirectory, which is exactly what a project page on static hosting is.",
      options: [
        { text: "Resolve from the root of the site, ignoring the current page's directory", correct: true },
        { text: "Resolve from the directory containing the current page" },
        { text: "Resolve from the user's filesystem root" },
        { text: "Nothing — a leading slash is ignored by browsers" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which of these is a void element — one that has no closing tag and no content?",
      explanation:
        "<img> takes its content from the src attribute and therefore has nothing to wrap; it is void. <a>, <p> and <button> all wrap content and require closing tags.",
      options: [
        { text: "<img>", correct: true },
        { text: "<a>" },
        { text: "<p>" },
        { text: "<button>" },
      ],
    },

    // =======================================================================
    // mcq 13-24 — applied reasoning
    // =======================================================================
    {
      type: "mcq",
      questionText:
        "You wrap a page's primary content in <div class=\"main\">. What does a screen-reader user lose compared with <main>?",
      explanation:
        "Landmark navigation. <main> is announced as a landmark and can be jumped to directly; a div with a class name is announced as nothing at all, because a class is a styling hook and carries no meaning to assistive technology.",
      options: [
        { text: "The ability to jump straight to the main content as a landmark", correct: true },
        { text: "Nothing — screen readers read class names as region names" },
        { text: "The page's heading outline, which depends on <main>" },
        { text: "Keyboard focus, which only landmarks can receive" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which element should hold a site's primary navigation links?",
      explanation:
        "<nav> marks a block of navigation links as a landmark, so it can be skipped or jumped to. <aside> means tangentially related content, <section> is a generic grouping, and <menu> is for a list of commands.",
      options: [
        { text: "<nav>", correct: true },
        { text: "<aside>" },
        { text: "<section>" },
        { text: "<menu>" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "You have a self-contained blog post that would still make sense if it were syndicated on its own. Which element fits best?",
      explanation:
        "<article> is precisely for a composition that stands on its own, which is the test the syndication question describes. <section> is a generic thematic grouping and <aside> means related-but-separate.",
      options: [
        { text: "<article>", correct: true },
        { text: "<section>" },
        { text: "<aside>" },
        { text: "<div>" },
      ],
    },
    {
      type: "mcq",
      questionText: "How many <main> elements may a page have?",
      explanation:
        "One. \"The main content of this document\" is singular by definition, and two main landmarks give assistive technology no way to choose. Multiple <section> or <article> elements are perfectly normal.",
      options: [
        { text: "Exactly one", correct: true },
        { text: "One per <section>" },
        { text: "As many as the layout needs" },
        { text: "None — <main> was removed from HTML5" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why should a page use exactly one <h1>?",
      explanation:
        "The headings form the document's outline, and the h1 is its single title. Two h1 elements describe a document with two titles, which makes the outline ambiguous for anyone navigating by heading.",
      options: [
        { text: "The h1 is the document's single title in the heading outline", correct: true },
        { text: "Browsers only apply styling to the first h1 they find" },
        { text: "Search engines refuse to index pages with several h1 elements" },
        { text: "A second h1 is a parse error and stops rendering" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A section under an <h2> needs a smaller heading, so the author writes <h4>. What is the consequence?",
      explanation:
        "A skipped level reads as a missing level of content: someone navigating by heading hears a gap where a subsection should be. Size is CSS's job — write <h3> and style it however small you like.",
      options: [
        { text: "The outline now implies a missing h3 level of content", correct: true },
        { text: "Nothing — heading levels are only font sizes" },
        { text: "The h4 is promoted to an h3 automatically by the browser" },
        { text: "The document fails HTML validation" },
      ],
    },
    {
      type: "mcq",
      questionText: "A photograph carries information that appears nowhere in the surrounding text. Which principle should decide what its alt attribute says?",
      explanation:
        "Alt text substitutes for the image, so it has to carry the same information a sighted reader takes from it, and no more. The filename is an implementation detail, the medium is already announced by assistive technology, and an empty value is reserved for images that carry no information at all.",
      options: [
        { text: "State the information the image conveys, as briefly as it can be said", correct: true },
        { text: "Name the image file so its source can be traced later" },
        { text: "Open with \"image of\" so the reader knows it is a picture" },
        { text: "Leave the value empty and let a caption carry the meaning" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the correct markup for a purely decorative divider image?",
      explanation:
        "alt=\"\" — present but empty — tells assistive technology the image carries no information, so it is skipped silently. Omitting alt entirely leaves the screen reader guessing, and it commonly reads the filename aloud.",
      options: [
        { text: "alt=\"\" — present with an empty value", correct: true },
        { text: "No alt attribute on the img at all" },
        { text: "alt=\"decorative\" — naming its role" },
        { text: "alt=\" \" — a single space character" },
      ],
    },
    {
      type: "mcq",
      questionText: "An informative chart image is published with no alt attribute. What does a screen-reader user hear?",
      explanation:
        "With no alt, there is nothing to substitute for the image, so screen readers typically fall back to announcing the filename. The information in the chart is simply unavailable.",
      options: [
        { text: "Usually the filename, and none of the chart's information", correct: true },
        { text: "Nothing at all — the image is skipped silently" },
        { text: "A description generated by the browser from the image contents" },
        { text: "The surrounding paragraph text, read a second time" },
      ],
    },
    {
      type: "mcq",
      questionText: "How is a <label> correctly associated with its input?",
      explanation:
        "The label's for attribute must equal the input's id. That association is what makes clicking the label focus the field and what makes a screen reader announce the field's name. Wrapping the input in the label also works, but nesting the label inside the input is not possible.",
      options: [
        { text: "The label's for attribute matches the input's id", correct: true },
        { text: "The label's name attribute matches the input's name" },
        { text: "The label appears immediately before the input in source order" },
        { text: "The label's id matches the input's id" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why is a placeholder not an acceptable substitute for a label?",
      explanation:
        "A placeholder disappears the moment the user types, so it cannot be re-read while filling the field; its contrast is typically low; and it is inconsistently exposed as the field's name. A label is permanent and always announced.",
      options: [
        {
          text: "It disappears on input, so the field's purpose is lost exactly when it is needed",
          correct: true,
        },
        { text: "Placeholders are not supported in current browsers" },
        { text: "A placeholder prevents the field from being submitted" },
        { text: "Placeholders can only hold numbers" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "Which input type should collect an email address, and what does choosing it buy you over type=\"text\"?",
      explanation:
        "type=\"email\" gets the browser's own format check and, on a phone, a keyboard with @ available. type=\"text\" works but throws away both. Neither is a substitute for server-side validation.",
      options: [
        { text: "type=\"email\" — a built-in format check and a suitable mobile keyboard", correct: true },
        { text: "type=\"text\" with pattern=\"@\" — the only reliable approach" },
        { text: "type=\"address\" — the element designed for contact details" },
        { text: "type=\"mail\" — shorter and equivalent to type=\"email\"" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does the required attribute on an input actually guarantee?",
      explanation:
        "It only guarantees that this browser blocks this form's submission while the field is empty. Anyone can send the request directly, so the server must validate independently. It is a usability feature, not a security control.",
      options: [
        {
          text: "Only that the browser blocks submission while empty — the server must still validate",
          correct: true,
        },
        { text: "That the value can never reach the server empty, by any route" },
        { text: "That the field is checked against a database before submission" },
        { text: "That the field is focused automatically when the page loads" },
      ],
    },

    // =======================================================================
    // mcq 25-30 — edge cases and traps
    // =======================================================================
    {
      type: "mcq",
      questionText: "What does scope=\"col\" on a <th> tell assistive technology?",
      explanation:
        "It says this header labels the cells below it in its column, so a screen reader can announce the right header with each data cell. Without scope, a table with headers on two axes becomes ambiguous and cells are read without their context.",
      options: [
        { text: "That the header applies to the cells in its column", correct: true },
        { text: "That the column should be styled as a header visually" },
        { text: "That the column may be sorted by the user" },
        { text: "That the header spans every column in the row" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is a <caption> for, and where must it go?",
      explanation:
        "A caption is the table's accessible name and must be the first child of <table>. A paragraph above the table looks similar but is not connected to it, so a screen-reader user landing on the table hears no name for it.",
      options: [
        { text: "It names the table, and must be the first child of <table>", correct: true },
        { text: "It labels the last row, and goes just before </table>" },
        { text: "It is a tooltip, and can go anywhere inside the table" },
        { text: "It is an alternative to <thead> and replaces it" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why is using a <table> to lay out a page's columns a problem?",
      explanation:
        "A table announces rows and columns of data. Used for layout, it makes a screen reader read a navigational structure as a data grid, and it resists responsive reflow. CSS Grid and Flexbox express layout without claiming the content is tabular.",
      options: [
        {
          text: "It tells assistive technology the content is tabular data when it is not, and resists reflow",
          correct: true,
        },
        { text: "Tables are deprecated in HTML5 and no longer render" },
        { text: "Tables cannot contain images or links" },
        { text: "It is only a problem in print stylesheets" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "Why add rel=\"noopener noreferrer\" to a link that opens in a new tab with target=\"_blank\"?",
      explanation:
        "Without noopener the opened page receives a reference to the window that opened it and can navigate it elsewhere — the reverse-tabnabbing pattern. noreferrer additionally withholds the referring URL. Modern browsers imply noopener for _blank, but stating it is still correct and covers older ones.",
      options: [
        {
          text: "It stops the opened page from being able to navigate the page that opened it",
          correct: true,
        },
        { text: "It makes the new tab load faster by skipping the referrer lookup" },
        { text: "It prevents the link from being followed by search engines" },
        { text: "It is required for the link to open in a new tab at all" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which nesting is invalid HTML?",
      explanation:
        "A <p> may only contain phrasing content, so a <div> inside it is invalid — and the browser recovers by closing the paragraph early, which silently changes the tree your CSS and JavaScript then operate on. The other three are all legal.",
      options: [
        { text: "<p><div>Text</div></p>", correct: true },
        { text: "<div><p>Text</p></div>" },
        { text: "<ul><li><a href=\"#x\">Text</a></li></ul>" },
        { text: "<button><span>Text</span></button>" },
      ],
    },
    {
      type: "mcq",
      questionText: "A page has several validation errors but looks correct in your browser. Why still fix them?",
      explanation:
        "Error recovery is a per-browser guess, not a specified result. Invalid markup gives a DOM that may differ between browsers and over time, and it is where mismatched-tag layout bugs and inconsistent scripting behaviour come from. Rendering today is not evidence of correctness.",
      options: [
        {
          text: "Browsers recover from errors differently, so the resulting DOM is not guaranteed to be the one you saw",
          correct: true,
        },
        { text: "Validation errors are stored in the file and slow down downloads" },
        { text: "Invalid pages cannot be deployed to static hosting" },
        { text: "There is no reason — if it renders, it is correct" },
      ],
    },

    // =======================================================================
    // code_fix 31-38 — applied
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "This page renders, but the CSS behaves inconsistently and the validator complains before the first element. What is the correct fix?",
      explanation:
        "Without a doctype the browser uses quirks mode. Adding <!DOCTYPE html> as the very first line restores standards mode. A meta tag cannot do it (there is no such switch), the charset declaration is unrelated, and an XML declaration is not HTML5 and does not trigger standards mode reliably.",
      language: "html",
      starterCode: `<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Pricing</title>
  </head>
  <body>
    <h1>Pricing</h1>
  </body>
</html>`,
      options: [
        { text: "Insert <!DOCTYPE html> as the first line, before <html>", correct: true },
        { text: "Add <meta name=\"mode\" content=\"standards\" /> inside <head>" },
        { text: "Move <meta charset=\"utf-8\" /> above <html>" },
        { text: "Add <?xml version=\"1.0\"?> as the first line" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The page shows question marks and black diamonds where accented characters should be. What is the correct fix?",
      explanation:
        "The document declares no encoding, so the browser guesses and mis-decodes the bytes. Adding <meta charset=\"utf-8\" /> as the first thing in <head> declares it. The lang attribute describes human language, not bytes; a content-language meta does not set encoding; and replacing the characters with entities hides the bug instead of fixing it.",
      language: "html",
      starterCode: `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Cafe menu</title>
  </head>
  <body>
    <h1>Cafe creme and gateau</h1>
  </body>
</html>`,
      options: [
        { text: "Add <meta charset=\"utf-8\" /> as the first element inside <head>", correct: true },
        { text: "Change lang=\"en\" to lang=\"fr\"" },
        { text: "Add <meta http-equiv=\"content-language\" content=\"utf-8\" />" },
        { text: "Replace every accented character with a numeric HTML entity" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "On a phone this page appears as a shrunken desktop layout and none of the width-based CSS applies. What is the correct fix?",
      explanation:
        "There is no viewport meta, so a mobile browser lays out at a simulated desktop width and scales down. Adding the viewport meta with width=device-width fixes it. A fixed body width makes the overflow worse, a max-width does not affect the layout viewport, and user-scalable=no removes zoom without changing the viewport width.",
      language: "html",
      starterCode: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>News</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>Today</h1>
  </body>
</html>`,
      options: [
        {
          text: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /> to <head>",
          correct: true,
        },
        { text: "Add a CSS rule setting body { width: 980px; }" },
        { text: "Add a CSS rule setting body { max-width: 400px; }" },
        { text: "Add <meta name=\"viewport\" content=\"user-scalable=no\" /> to <head>" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The browser tab shows the URL instead of the page name, and the word \"Contact\" appears at the very top of the page above the heading. What is the correct fix?",
      explanation:
        "The <title> was written inside <body>, so it is not document metadata and its text is treated as body content. Moving it into <head> fixes both symptoms at once. An h1 is a page heading, not a tab label; a meta name=\"title\" is not what browsers read; and hiding it with CSS leaves the tab unnamed.",
      language: "html",
      starterCode: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <title>Contact</title>
    <h1>Get in touch</h1>
  </body>
</html>`,
      options: [
        { text: "Move <title>Contact</title> inside <head>", correct: true },
        { text: "Replace <title>Contact</title> with <h1>Contact</h1>" },
        { text: "Replace it with <meta name=\"title\" content=\"Contact\" /> in <head>" },
        { text: "Keep it in <body> and hide it with display: none" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "A script that selects the second paragraph finds nothing, and the footer renders inside the article. What is the correct fix?",
      explanation:
        "The first <p> is never closed, so the browser's recovery nests the following content inside it and the tree no longer matches the source. Closing the paragraph is the fix. Removing the second paragraph's tags, wrapping in a div, or adding a self-closing slash to a non-void element all leave the same unbalanced tree.",
      language: "html",
      starterCode: `<article>
  <h2>Release notes</h2>
  <p>We shipped the new dashboard.
  <p>It loads twice as fast.</p>
  <footer>Posted Tuesday</footer>
</article>`,
      options: [
        { text: "Close the first paragraph: <p>We shipped the new dashboard.</p>", correct: true },
        { text: "Remove the tags around the second paragraph so there is only one <p>" },
        { text: "Wrap both paragraphs in a <div>" },
        { text: "Write the first paragraph as <p />" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "A screen-reader user reports that this page offers no landmarks to jump between. What is the correct fix?",
      explanation:
        "Class names carry no meaning to assistive technology. Replacing the three divs with <header>, <main> and <footer> creates the landmarks. ARIA roles on divs would also work but are the long way round when the elements exist; ids change nothing; and a heading is not a landmark.",
      language: "html",
      starterCode: `<body>
  <div class="header"><h1>Field Guide</h1></div>
  <div class="content"><p>Start here.</p></div>
  <div class="footer"><p>Copyright 2026</p></div>
</body>`,
      options: [
        { text: "Replace the three divs with <header>, <main> and <footer>", correct: true },
        { text: "Add id attributes so each div can be linked to directly" },
        { text: "Add a class of landmark to each div" },
        { text: "Add an <h2> at the top of each div" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Navigating this section by heading, a screen-reader user hears a level of content that is not there. What is the correct fix?",
      explanation:
        "The outline jumps from h2 to h4, implying a missing h3. Changing the h4 to h3 restores it; size is a CSS concern and can be set afterwards. Promoting the h2, wrapping in a section, or restyling the h4 all leave the same gap in the outline.",
      language: "html",
      starterCode: `<section>
  <h2>Installation</h2>
  <p>Follow these steps.</p>
  <h4>Requirements</h4>
  <p>Node 20 or newer.</p>
</section>`,
      options: [
        { text: "Change <h4>Requirements</h4> to <h3>Requirements</h3>", correct: true },
        { text: "Change <h2>Installation</h2> to <h3>Installation</h3>" },
        { text: "Wrap the h4 and its paragraph in their own <section>" },
        { text: "Keep the h4 and give it a CSS font-size matching an h3" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This divider is purely decorative, but every screen-reader user has to listen to a sentence about it. What is the correct fix?",
      explanation:
        "A decorative image should be announced as nothing, which means alt=\"\" — present and empty. Deleting the attribute is worse: the filename tends to be read instead. Shortening the text still announces something, and aria-hidden on an img with alt text is a contradictory pair of signals.",
      language: "html",
      starterCode: `<img src="wave-divider.svg"
     alt="A decorative wavy line divider used to separate the two sections of this page" />`,
      options: [
        { text: "Change the attribute to alt=\"\"", correct: true },
        { text: "Remove the alt attribute entirely" },
        { text: "Shorten it to alt=\"divider\"" },
        { text: "Keep the alt text and add aria-hidden=\"true\"" },
      ],
    },

    // =======================================================================
    // code_fix 39-44 — subtle defect
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "This chart is the only place the quarterly figures appear, yet screen-reader users hear nothing about it. What is the correct fix?",
      explanation:
        "alt=\"\" declares the image decorative, so it is skipped — but this image carries information available nowhere else. Replacing the empty alt with a description of the finding is the fix. A title attribute is unreliably announced, a filename is not a description, and a caption element does not belong to an img.",
      language: "html",
      starterCode: `<figure>
  <img src="q3-revenue.png" alt="" />
  <figcaption>Figure 4</figcaption>
</figure>`,
      options: [
        {
          text: "Replace alt=\"\" with a description such as alt=\"Revenue rose from 40 to 65 thousand euro between Q1 and Q3\"",
          correct: true,
        },
        { text: "Add title=\"Q3 revenue chart\" to the img and leave alt empty" },
        { text: "Set alt=\"q3-revenue.png\"" },
        { text: "Add a <caption> element inside the <figure>" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The author wants \"critical\" to be announced with emphasis by a screen reader, not merely drawn in bold. What is the correct fix?",
      explanation:
        "<b> draws attention stylistically without conveying importance; <strong> means the content is important and is exposed as such. Swapping the element is the fix. CSS font-weight is purely visual, uppercase changes the text, and a class name means nothing to assistive technology.",
      language: "html",
      starterCode: `<p>This step is <b>critical</b> — do not skip it.</p>`,
      options: [
        { text: "Replace <b> with <strong>", correct: true },
        { text: "Add a CSS rule for b { font-weight: 900; }" },
        { text: "Write the word in capitals: <b>CRITICAL</b>" },
        { text: "Add class=\"important\" to the <b> element" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Clicking the words \"Email address\" does not focus the field, and the screen reader announces the input with no name. What is the correct fix?",
      explanation:
        "The label's for value must match the input's id exactly, and here it does not. Aligning them fixes both symptoms. name is for submission, not association; a placeholder is not a label; and CSS proximity does nothing for the accessibility tree.",
      language: "html",
      starterCode: `<label for="email">Email address</label>
<input type="email" id="user-email" name="email" />`,
      options: [
        { text: "Change the input's id to \"email\" so it matches the label's for", correct: true },
        { text: "Change the label to <label for=\"email\" name=\"email\">" },
        { text: "Remove the label and add placeholder=\"Email address\" to the input" },
        { text: "Move the label immediately after the input and style them adjacent" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Every field in this form is announced without a name, and users who clear a field forget what it was for. What is the correct fix?",
      explanation:
        "Placeholders are the only labelling here, and they vanish on input. Adding a real <label for> per field, keeping or dropping the placeholder as a hint, is the fix. An aria-label on the form labels the form, not the fields; a legend names a fieldset; and a title attribute is inconsistently announced.",
      language: "html",
      starterCode: `<form>
  <input type="text" id="first" name="first" placeholder="First name" />
  <input type="text" id="last" name="last" placeholder="Last name" />
  <button type="submit">Join</button>
</form>`,
      options: [
        {
          text: "Add <label for=\"first\">First name</label> and <label for=\"last\">Last name</label>",
          correct: true,
        },
        { text: "Add aria-label=\"First and last name\" to the <form>" },
        { text: "Wrap the inputs in a <fieldset> with a <legend>Names</legend>" },
        { text: "Add title=\"First name\" and title=\"Last name\" to the inputs" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "A screen-reader user reading this table cell by cell cannot tell which column each number belongs to. What is the correct fix?",
      explanation:
        "The header cells exist but do not say what they head, so cells are announced without their column name. Adding scope=\"col\" to each <th> is the fix. <thead> groups rows but does not declare direction, bold styling is visual only, and scope=\"row\" would claim these head their rows.",
      language: "html",
      starterCode: `<table>
  <caption>Weekly scores</caption>
  <tr><th>Student</th><th>Quiz</th><th>Assignment</th></tr>
  <tr><td>Amara</td><td>18</td><td>27</td></tr>
</table>`,
      options: [
        { text: "Add scope=\"col\" to each <th> in the header row", correct: true },
        { text: "Wrap the header row in <thead> and change nothing else" },
        { text: "Style the header cells bold with CSS" },
        { text: "Add scope=\"row\" to each <th> in the header row" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Pressing this button does nothing: the form is never submitted. What is the correct fix?",
      explanation:
        "The button sits outside the form, so it has no form to submit. Moving it inside is the fix. type=\"button\" removes submission behaviour entirely; onclick with a page navigation loses the field values; and an id does not associate a control with a form on its own.",
      language: "html",
      starterCode: `<form action="/signup" method="post">
  <label for="email">Email</label>
  <input type="email" id="email" name="email" required />
</form>
<button type="submit">Sign up</button>`,
      options: [
        { text: "Move the button inside the <form>, before </form>", correct: true },
        { text: "Change it to <button type=\"button\">Sign up</button>" },
        { text: "Add onclick=\"location.href='/signup'\" to the button" },
        { text: "Give the form and the button the same id" },
      ],
    },

    // =======================================================================
    // code_write 45-47 — applied
    // =======================================================================
    {
      type: "code_write",
      questionText:
        "Write a complete, minimal, valid HTML5 document for a page titled \"Field Notes\", in English, encoded as UTF-8, with a single visible heading reading Field Notes. Add nothing else — no stylesheet, no script, no extra elements.",
      explanation:
        "The graded properties are the ones the lecture called non-negotiable: a doctype first so the browser is in standards mode, a non-empty lang so assistive technology picks the right voice, a charset declaration so bytes decode, and exactly one title with the required text.",
      language: "html",
      starterCode: `<!-- Write the whole document. Replace this comment. -->`,
      tests: [
        {
          name: "doctype is present and is the first thing in the document",
          input: "probe:doctypeIsFirst",
          expected: "true",
        },
        { name: "html element has a non-empty lang attribute", input: "probe:htmlLangNonEmpty", expected: "true" },
        { name: "a charset meta declaration is present in head", input: "probe:headCharsetPresent", expected: "true" },
        { name: "exactly one title element, reading \"Field Notes\"", input: "probe:titleText", expected: "Field Notes" },
        {
          name: "edge case: no second title and no stray element outside html",
          input: "probe:titleCount,probe:nodesOutsideHtml",
          expected: "1,0",
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "A site is hosted from a subdirectory, so root-relative references break. Write the <head> and <body> of a page that references styles.css and app.js from the same directory as the page, with the script placed so it does not block first paint. Use no leading slashes.",
      explanation:
        "Two lessons combined: a leading slash resolves from the origin root and breaks under a subdirectory, and a synchronous script in <head> blocks parsing before anything is painted. Either a script at the end of <body> or a defer attribute satisfies the second.",
      language: "html",
      starterCode: `<head>
  <meta charset="utf-8" />
  <title>Notes</title>
  <!-- TODO: reference styles.css -->
</head>
<body>
  <h1>Notes</h1>
  <!-- TODO: reference app.js without blocking first paint -->
</body>`,
      tests: [
        { name: "stylesheet reference to styles.css is present", input: "probe:linksTo(styles.css)", expected: "true" },
        { name: "script reference to app.js is present", input: "probe:scriptSrc(app.js)", expected: "true" },
        {
          name: "script does not block first paint (deferred or at end of body)",
          input: "probe:scriptNonBlocking",
          expected: "true",
        },
        {
          name: "edge case: no reference begins with a leading slash",
          input: "probe:countReferencesStartingWithSlash",
          expected: "0",
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Mark up this outline with correct landmarks and heading levels: a site header containing the site name; the main content with the title \"Coastal Birds\", a subsection \"Waders\" containing a photo of a curlew, and a subsection \"Seabirds\"; then a site footer. Use one h1 and skip no levels.",
      explanation:
        "This is the whole of lecture 2 in one item: landmarks describe regions, the headings form an outline with a single title and no gaps, main appears exactly once, and every image carries an alt attribute whether or not it has content.",
      language: "html",
      starterCode: `<body>
  <!-- TODO: site header with the site name -->
  <!-- TODO: main content, one h1, two subsections at the same level -->
  <!-- TODO: site footer -->
</body>`,
      tests: [
        { name: "exactly one h1 element", input: "probe:h1Count", expected: "1" },
        { name: "exactly one main element", input: "probe:mainCount", expected: "1" },
        { name: "header and footer landmarks both present", input: "probe:hasHeaderAndFooter", expected: "true" },
        { name: "heading outline skips no level", input: "probe:maxHeadingLevelJump", expected: "1" },
        {
          name: "edge case: every img has an alt attribute, even if empty",
          input: "probe:countImagesMissingAlt",
          expected: "0",
        },
      ],
    },

    // =======================================================================
    // code_write 48-50 — synthesis
    // =======================================================================
    {
      type: "code_write",
      questionText:
        "Write a media block containing exactly two images: a photograph of a lighthouse at dusk, which carries information, and a decorative flourish that carries none. Give each the alt treatment its role requires.",
      explanation:
        "The three-way distinction from lecture 2, made concrete: a descriptive alt for the informative image, a present-but-empty alt for the decorative one, and never a missing alt on either. The count check is what stops a student passing by omitting one image.",
      language: "html",
      starterCode: `<section>
  <!-- TODO: informative image -->
  <!-- TODO: decorative image -->
</section>`,
      tests: [
        { name: "exactly two img elements", input: "probe:imgCount", expected: "2" },
        {
          name: "exactly one img has a non-empty alt describing the subject",
          input: "probe:countImagesWithNonEmptyAlt",
          expected: "1",
        },
        {
          name: "exactly one img has alt present and empty",
          input: "probe:countImagesWithEmptyAlt",
          expected: "1",
        },
        { name: "edge case: no img is missing the alt attribute", input: "probe:countImagesMissingAlt", expected: "0" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Build an accessible sign-up form collecting a full name (text), an email address, and an age in years (number), plus a submit control reading \"Create account\". Every field must be labelled, and every field is required.",
      explanation:
        "Labels associated by for/id are what give each field an accessible name; correct input types get the right keyboard and the browser's own format check; and the submit control must be inside the form or it submits nothing. Placeholders are not accepted as labels here.",
      language: "html",
      starterCode: `<form action="/signup" method="post">
  <!-- TODO: three labelled, required fields and a submit control -->
</form>`,
      tests: [
        { name: "three inputs, each with an id", input: "probe:inputCount,probe:countInputsMissingId", expected: "3,0" },
        {
          name: "every input has a label whose for matches its id",
          input: "probe:countInputsWithoutMatchingLabel",
          expected: "0",
        },
        {
          name: "input types are text, email and number",
          input: "probe:sortedInputTypes",
          expected: "email,number,text",
        },
        { name: "the submit control is inside the form", input: "probe:submitInsideForm", expected: "true" },
        {
          name: "edge case: no field relies on a placeholder as its only label",
          input: "probe:countInputsLabelledOnlyByPlaceholder",
          expected: "0",
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Build a data table for these results, named so a screen-reader user knows what it is: columns Student, Quiz, Assignment; rows Amara 18 27, Bilal 15 24, Chen 20 30. Header cells must declare what they head.",
      explanation:
        "A table is only accessible when it is named and its headers declare their direction. The caption supplies the name, scope on every th supplies the direction, and the row and column counts prove the data was transcribed rather than approximated. The final check rejects layout nesting inside cells.",
      language: "html",
      starterCode: `<table>
  <!-- TODO: caption, header row with scope, three data rows -->
</table>`,
      tests: [
        { name: "a caption is present as the table's first child", input: "probe:captionIsFirstChild", expected: "true" },
        { name: "every th declares a scope", input: "probe:countThMissingScope", expected: "0" },
        { name: "three columns and three data rows", input: "probe:columnCount,probe:dataRowCount", expected: "3,3" },
        {
          name: "the transcribed values match the supplied data",
          input: "probe:dataCellsJoined",
          expected: "Amara,18,27,Bilal,15,24,Chen,20,30",
        },
        {
          name: "edge case: no nested table or layout div inside any cell",
          input: "probe:countLayoutOnlyNestingInCells",
          expected: "0",
        },
      ],
    },
  ],
};
