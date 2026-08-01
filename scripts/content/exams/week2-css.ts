// =============================================================================
// WEEK 2 GRAND EXAM — "CSS3 & Responsive Design". Blueprint: CURRICULUM_PLAN A.2.
// -----------------------------------------------------------------------------
// Draws on the week's three EXISTING lectures, unmodified:
//   L1 "Selectors, the Cascade & Specificity"
//   L2 "Flexbox & CSS Grid"
//   L3 "Mobile-First Responsive Design"
//
// 30 mcq (2) + 14 code_fix (3) + 6 code_write (8) = 50 questions / 150 points.
//
// ALL PROSE IS ORIGINAL.
//
// `code_write` items are `css`. As with week 1, a stylesheet is not executable,
// so the six tests are STRUCTURAL PROBES over the submitted declaration set —
// which is deterministic and requires no layout engine, but is NOT Piston. See
// the note in ./index.ts.
// =============================================================================

import type { SeedExam } from "./types";

export const week2Exam: SeedExam = {
  weekNumber: 2,
  title: "Week 2 Grand Exam — CSS3 & Responsive Design",
  questions: [
    // =======================================================================
    // mcq 1-12 — foundational recall
    // =======================================================================
    {
      type: "mcq",
      questionText: "What does the selector .card p match?",
      explanation:
        "A space is the descendant combinator: every <p> anywhere inside an element with class card, at any depth. It does not require the paragraph to be a direct child — that would be .card > p.",
      options: [
        { text: "Every <p> at any depth inside an element with class card", correct: true },
        { text: "Only a <p> that is a direct child of an element with class card" },
        { text: "Every element with class card that is inside a <p>" },
        { text: "Every <p> that also has class card" },
      ],
    },
    {
      type: "mcq",
      questionText: "Two rules of identical specificity set the same property on the same element. Which wins?",
      explanation:
        "At equal specificity the cascade falls back to source order, so the rule declared later wins. This is why the order of your stylesheet links matters, and why a later override needs no extra specificity.",
      options: [
        { text: "The one declared later in the source", correct: true },
        { text: "The one declared earlier in the source" },
        { text: "The one with the shorter selector" },
        { text: "Neither — the property is left at its initial value" },
      ],
    },
    {
      type: "mcq",
      questionText: "Rank these by specificity, lowest first: an element selector, a class selector, an id selector.",
      explanation:
        "Specificity is compared component by component: ids beat classes, and classes beat element names, no matter how many of the weaker kind you stack up. A hundred element selectors still lose to one class.",
      options: [
        { text: "element, class, id", correct: true },
        { text: "class, element, id" },
        { text: "id, class, element" },
        { text: "element, id, class" },
      ],
    },
    {
      type: "mcq",
      questionText: "Where does !important sit in the cascade?",
      explanation:
        "An important declaration is considered in an earlier cascade layer than normal declarations, so it wins regardless of selector specificity. That is exactly why it is a maintenance problem: the only way to beat it is another important declaration.",
      options: [
        { text: "It wins over any normal declaration, whatever its specificity", correct: true },
        { text: "It adds the equivalent of one id to the selector's specificity" },
        { text: "It only applies within the same stylesheet file" },
        { text: "It is ignored unless the selector also contains an id" },
      ],
    },
    {
      type: "mcq",
      questionText: "Under the default box model, what does width: 300px describe?",
      explanation:
        "The default is box-sizing: content-box, so width sizes the content box only. Padding and border are added outside it, which is why a 300 px box with 20 px of padding on each side occupies 340 px.",
      options: [
        { text: "The content box only; padding and border are added on top", correct: true },
        { text: "The content plus padding, with border added on top" },
        { text: "The content, padding and border together" },
        { text: "The content, padding, border and margin together" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does box-sizing: border-box change?",
      explanation:
        "It makes width and height include padding and border, so a declared width is the space the box actually occupies. Setting it globally is common precisely because it removes a class of arithmetic bug from every later layout.",
      options: [
        { text: "width and height now include padding and border", correct: true },
        { text: "width and height now include the margin as well" },
        { text: "Borders are drawn inside the padding instead of outside it" },
        { text: "Padding is removed from every element" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "An element has width: 100% and padding: 20px inside a 400 px parent, under the default box model. How wide is it?",
      explanation:
        "440 px: the width resolves to 400 px of content, then 20 px of padding is added on each side. This is the overflow that border-box exists to prevent.",
      options: [
        { text: "440 px, so it overflows its parent", correct: true },
        { text: "400 px, exactly filling its parent" },
        { text: "360 px, with the padding taken from the inside" },
        { text: "420 px, since padding applies once" },
      ],
    },
    {
      type: "mcq",
      questionText: "In a flex container with the default flex-direction, which axis is the main axis?",
      explanation:
        "The default is row, so the main axis is horizontal and the cross axis is vertical. Every alignment property is defined against those axes rather than against left/right, which is what makes the direction switch confusing.",
      options: [
        { text: "Horizontal, and the cross axis is vertical", correct: true },
        { text: "Vertical, and the cross axis is horizontal" },
        { text: "Whichever axis is longer on screen" },
        { text: "Both — a flex container has no single main axis" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does justify-content control?",
      explanation:
        "justify-content distributes items along the main axis. align-items positions them on the cross axis. Neither has a fixed relationship to horizontal or vertical — that depends on flex-direction.",
      options: [
        { text: "Distribution of items along the main axis", correct: true },
        { text: "Distribution of items along the cross axis" },
        { text: "Horizontal alignment only, in every flex-direction" },
        { text: "The alignment of text inside each item" },
      ],
    },
    {
      type: "mcq",
      questionText: "In CSS Grid, what does the 1fr unit mean?",
      explanation:
        "fr is a fraction of the leftover free space in the grid container after fixed sizes and gaps are taken out. Two 1fr columns share the remainder equally; it is not the same as 50% because percentages ignore the gap.",
      options: [
        { text: "One share of the free space remaining in the container", correct: true },
        { text: "One percent of the container's width" },
        { text: "One times the root font size" },
        { text: "The width of the widest item in the track" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does the gap property do in a grid or flex container?",
      explanation:
        "gap sets spacing between tracks or items, declared once on the container. It adds no space at the outer edges, which is what makes it different from margins on the children — and margins on children also collapse and double up.",
      options: [
        { text: "Spaces items apart, with no extra space at the container's edges", correct: true },
        { text: "Adds equal padding inside every item" },
        { text: "Adds space between items and around the outside of the container" },
        { text: "Sets the margin on the container itself" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does mobile-first mean in practice when writing CSS?",
      explanation:
        "The rules outside any media query describe the smallest layout, and min-width queries add to them as the viewport grows. Nothing has to be undone, which is what makes the stylesheet shorter and easier to reason about.",
      options: [
        {
          text: "Base rules describe the small layout; min-width queries add to it as space allows",
          correct: true,
        },
        { text: "Base rules describe the desktop layout; max-width queries strip it back" },
        { text: "A separate stylesheet is served to mobile devices" },
        { text: "The mobile layout is written last, after the desktop layout is finished" },
      ],
    },

    // =======================================================================
    // mcq 13-24 — applied reasoning
    // =======================================================================
    {
      type: "mcq",
      questionText:
        "#panel .title sets colour to red and .card .title sets it to blue, later in the file. What colour is a .title inside both?",
      explanation:
        "Red. The first selector contains an id, and an id outweighs any number of classes, so source order never gets consulted. Being later in the file only decides ties.",
      options: [
        { text: "Red, because the id in the first selector outweighs the second class", correct: true },
        { text: "Blue, because it is declared later" },
        { text: "Blue, because two classes outweigh one id and one class" },
        { text: "Undefined — the conflict makes the declaration invalid" },
      ],
    },
    {
      type: "mcq",
      questionText: "A rule is being overridden and you cannot see why. Which is the correct first step?",
      explanation:
        "The computed-styles panel names the winning rule and its origin, so the cascade question is answered by observation rather than guesswork. Reaching for !important resolves the symptom while making the next conflict worse.",
      options: [
        {
          text: "Inspect the element's computed styles to see which rule is winning and why",
          correct: true,
        },
        { text: "Add !important to the rule that should win" },
        { text: "Add an id to the element so the selector becomes stronger" },
        { text: "Move the rule to the top of the stylesheet" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which properties are inherited by descendants unless overridden?",
      explanation:
        "Typographic properties such as color and font-family inherit, which is why setting them once on a root element works. Box properties — padding, border, margin, background — do not inherit; each element starts from its own initial value.",
      options: [
        { text: "color and font-family", correct: true },
        { text: "padding and border" },
        { text: "background-color and margin" },
        { text: "display and position" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A flex container has flex-direction: column. Which property now centres its items horizontally?",
      explanation:
        "In a column container the main axis is vertical, so align-items works across it — horizontally. justify-content now positions items vertically. This axis swap is the single most common source of Flexbox confusion.",
      options: [
        { text: "align-items", correct: true },
        { text: "justify-content" },
        { text: "text-align" },
        { text: "vertical-align" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "You need a card centred both horizontally and vertically inside a flex container. Which pair of declarations does it?",
      explanation:
        "justify-content centres along the main axis and align-items across the cross axis; together they centre on both, whichever direction the container runs. text-align only affects inline content, and margin: auto on the child is a different technique that does not need the container's help.",
      options: [
        { text: "justify-content: center and align-items: center", correct: true },
        { text: "text-align: center and vertical-align: middle" },
        { text: "align-content: center and text-align: center" },
        { text: "justify-items: center and align-self: center on the container" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) produce?",
      explanation:
        "As many columns as fit, each at least 220 px and sharing the leftover space equally, reflowing as the container resizes — a responsive grid with no media query at all. The count is not fixed anywhere in the declaration.",
      options: [
        {
          text: "As many columns as fit at 220 px or wider, sharing leftover space and reflowing automatically",
          correct: true,
        },
        { text: "Exactly one column of 220 px, repeated for every item" },
        { text: "A fixed number of columns computed once when the page loads" },
        { text: "Columns of exactly 220 px, overflowing the container when there are too many" },
      ],
    },
    {
      type: "mcq",
      questionText: "When is Grid a better fit than Flexbox?",
      explanation:
        "Grid places items in two dimensions against a defined set of rows and columns, so an aligned page or card layout is its case. Flexbox distributes items along one axis, which is the right tool for a toolbar or a row of buttons.",
      options: [
        { text: "When the layout is two-dimensional and items must align across both rows and columns", correct: true },
        { text: "Whenever there are more than three items" },
        { text: "Whenever the layout must be responsive at all" },
        { text: "Only for full-page layouts; Grid cannot be used on a component" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why do min-width media queries add to the base styles rather than undo them?",
      explanation:
        "A min-width query only takes effect above its threshold, so it layers extra declarations on top of the small-screen base as space becomes available. A max-width chain works the other way: the base is the largest layout and each query has to unpick part of it.",
      options: [
        { text: "They apply only above their threshold, so they extend the base rather than reverse it", correct: true },
        { text: "They replace the base rules entirely while active" },
        { text: "They have higher specificity than rules outside a query" },
        { text: "They are evaluated before the base rules, so the base overrides them" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why express a breakpoint in rem rather than px?",
      explanation:
        "A rem breakpoint is relative to the root font size, so a reader who has increased their browser's default text size reaches the wider layout at a proportionally smaller viewport — the layout follows their text. A px breakpoint ignores that setting completely.",
      options: [
        { text: "It scales with the reader's font-size setting, so the layout follows their text size", correct: true },
        { text: "px is not permitted inside a media query" },
        { text: "rem breakpoints are evaluated faster by the browser" },
        { text: "rem is relative to the viewport width, unlike px" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is 1rem equal to?",
      explanation:
        "1rem is the root element's font size — the html element, which is 16 px by default but changes with the user's browser preference. em, by contrast, is relative to the current element's font size and therefore compounds when nested.",
      options: [
        { text: "The root element's font size, 16 px by default", correct: true },
        { text: "Always exactly 16 px, regardless of settings" },
        { text: "The current element's font size" },
        { text: "One percent of the viewport width" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "Every media query in a stylesheet appears to be ignored on a phone, while the same queries work when the desktop window is resized. What is the likely cause?",
      explanation:
        "A missing viewport meta tag. The mobile browser lays out at a simulated desktop width, so a width-based query never sees the real device width. The CSS is fine; the HTML is not.",
      options: [
        { text: "The document has no viewport meta tag", correct: true },
        { text: "Mobile browsers require a max-width query rather than min-width" },
        { text: "Media queries need !important to apply on touch devices" },
        { text: "The stylesheet is being served with the wrong MIME type" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the most common cause of horizontal overflow at a 320 px viewport width?",
      explanation:
        "Something declares a width larger than the viewport — a fixed-width container, an uncapped image, or an unbreakable long string. All three are fixed by letting content shrink: relative widths, max-width: 100% on media, and a wrapping rule for long text.",
      options: [
        { text: "A fixed-width element, or an unbreakable long string", correct: true },
        { text: "Using percentage widths instead of pixel widths" },
        { text: "Declaring more than one media query breakpoint" },
        { text: "Setting box-sizing: border-box on every element" },
      ],
    },

    // =======================================================================
    // mcq 25-30 — edge cases and traps
    // =======================================================================
    {
      type: "mcq",
      questionText: "Why does @media (min-width: 900px) and (max-width: 600px) never match?",
      explanation:
        "The conditions are combined with and, so both must hold at once — and no viewport is simultaneously at least 900 px and at most 600 px. The author almost certainly meant a range with the bounds the other way round.",
      options: [
        { text: "The two conditions are contradictory and cannot both be true", correct: true },
        { text: "and is not a valid operator in a media query" },
        { text: "min-width and max-width cannot appear in the same query" },
        { text: "It matches only in landscape orientation" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the difference between inheritance and the cascade?",
      explanation:
        "Inheritance passes a computed value from parent to child for properties that inherit, and only when nothing targets the child. The cascade decides which of several declarations targeting the same element wins. A cascade winner on the child always beats an inherited value.",
      options: [
        {
          text: "Inheritance passes values down the tree; the cascade chooses between declarations targeting one element",
          correct: true,
        },
        { text: "They are two names for the same mechanism" },
        { text: "Inheritance chooses between conflicting rules; the cascade copies values to children" },
        { text: "Inheritance applies only inside media queries" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the specificity of the selector nav ul li a.active?",
      explanation:
        "One class and four element names: no ids at all. It looks long and authoritative but any single id selector beats it, which is why selector length is a poor proxy for strength.",
      options: [
        { text: "One class and four elements — no ids, so any id selector beats it", correct: true },
        { text: "Five classes, since each part counts as a class" },
        { text: "Equivalent to one id, because it is five levels deep" },
        { text: "Zero, because it contains no id and no attribute selector" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A rule sets background: #fff after an earlier rule set background-image. The image disappears. Why?",
      explanation:
        "background is a shorthand and resets every longhand it covers, including background-image, to its initial value when not mentioned. Writing background-color instead sets only the colour and leaves the image alone.",
      options: [
        { text: "The shorthand reset background-image to its initial value", correct: true },
        { text: "Colours always take precedence over images in CSS" },
        { text: "background-image is not inherited, so it was dropped" },
        { text: "The image URL became invalid when the colour was set" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why does .cta { text-align: center } fail to centre a flex item inside .cta?",
      explanation:
        "text-align centres inline content inside a box; it says nothing about where the box itself sits. Positioning a flex child within its container is justify-content and align-items on the container, or margin: auto on the child.",
      options: [
        {
          text: "text-align positions inline content inside a box, not the box within its flex container",
          correct: true,
        },
        { text: "text-align is not a valid property on a flex container" },
        { text: "Flex items ignore all inherited properties" },
        { text: "It works, but only after display: block is set on the item" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A typo makes a selector .crd instead of .card, so the rule matches nothing. How does the browser report this?",
      explanation:
        "It does not. A selector that matches nothing is valid CSS and produces no warning, no console entry and no visible failure — the rule is simply never applied. The only signal is that the styling is missing, which is why a selector typo can take a long time to find.",
      options: [
        { text: "It does not report it at all — a selector matching nothing is valid CSS", correct: true },
        { text: "A parse error appears in the console" },
        { text: "The whole stylesheet after the typo is discarded" },
        { text: "The browser falls back to the nearest matching class name" },
      ],
    },

    // =======================================================================
    // code_fix 31-38 — applied
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "The author expects buttons in the toolbar to be teal, but they render navy. Without using !important, what is the correct fix?",
      explanation:
        "The first selector contains an id, so it wins on specificity and source order is never consulted. Raising the second selector's specificity to include the same id makes it win by source order. Reordering does not help against a stronger selector, and !important trades this bug for a worse one later.",
      language: "css",
      starterCode: `#toolbar .btn {
  color: navy;
}

.btn {
  color: teal;
}`,
      options: [
        { text: "Change the second selector to #toolbar .btn so it matches the first's specificity and wins on source order", correct: true },
        { text: "Move the .btn rule above the #toolbar .btn rule" },
        { text: "Add !important to color: teal" },
        { text: "Change the second selector to .btn.btn to double its class weight" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The author expects the class to win over the id and cannot see why it does not. Which fix expresses the intent without !important?",
      explanation:
        "No number of classes beats an id, so the class rule cannot win as written. Lowering the id rule to a class puts both rules in the same specificity band, where source order decides — and that is the intent. Stacking classes, adding an attribute selector or adding !important all leave the id undefeated or start a specificity war.",
      language: "css",
      starterCode: `#hero {
  background: black;
}

.theme-light {
  background: white;
}`,
      options: [
        { text: "Change #hero to a class such as .hero, so source order decides between them", correct: true },
        { text: "Write the second selector as .theme-light.theme-light.theme-light" },
        { text: "Write the second selector as [class~=\"theme-light\"]" },
        { text: "Add !important to background: white" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Every card in this layout is 40 px wider than declared and the row overflows. What is the correct fix?",
      explanation:
        "Under the default content-box model, padding and border are added outside the declared width. A global border-box rule makes width mean the occupied width, which fixes every box at once. Subtracting the padding by hand works only until a value changes, removing the padding changes the design, and overflow: hidden hides the symptom.",
      language: "css",
      starterCode: `.card {
  width: 300px;
  padding: 16px;
  border: 4px solid #ddd;
}`,
      options: [
        { text: "Add a global rule: *, *::before, *::after { box-sizing: border-box; }", correct: true },
        { text: "Change the width to 260px to account for the padding and border" },
        { text: "Remove the padding and use margin on the card's children instead" },
        { text: "Add overflow: hidden to the row containing the cards" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "None of these declarations reach the intended element, and the console shows no error. What is the correct fix?",
      explanation:
        "The selector is a typo, and a selector matching nothing is valid CSS that fails silently. Correcting the name is the only fix. Adding !important, an id or a descendant part cannot help a selector that matches no element at all.",
      language: "css",
      starterCode: `<!-- markup: <article class="card">...</article> -->
.crd {
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}`,
      options: [
        { text: "Correct the selector to .card", correct: true },
        { text: "Add !important to both declarations" },
        { text: "Change the selector to #crd" },
        { text: "Change the selector to article .crd" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The heading's background image vanishes as soon as the second rule is added. What is the correct fix?",
      explanation:
        "background is a shorthand and resets background-image when it does not mention it. Using the background-color longhand sets only the colour. Reordering just moves which one disappears, an !important on the image starts a war, and re-declaring the image in the shorthand duplicates the value in two places.",
      language: "css",
      starterCode: `.masthead {
  background-image: url("hero.jpg");
  background-size: cover;
}

.masthead {
  background: #123;
}`,
      options: [
        { text: "Change the second rule to background-color: #123", correct: true },
        { text: "Move the second rule above the first" },
        { text: "Add !important to background-image" },
        { text: "Repeat the image inside the shorthand: background: #123 url(\"hero.jpg\")" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The badge is meant to sit in the middle of the banner, horizontally and vertically, but it stays at the top-left. What is the correct fix?",
      explanation:
        "text-align centres inline content inside a box and says nothing about where a flex child sits. justify-content plus align-items centre the child on both axes. vertical-align applies to inline and table-cell content, float removes the item from flex participation, and absolute positioning replaces the layout rather than fixing it.",
      language: "css",
      starterCode: `.banner {
  display: flex;
  height: 240px;
  text-align: center;
}`,
      options: [
        { text: "Replace text-align: center with justify-content: center and align-items: center", correct: true },
        { text: "Add vertical-align: middle to .banner" },
        { text: "Add float: none and margin: 0 auto to the badge" },
        { text: "Give the badge position: absolute with top: 50% and left: 50%" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The author wanted the row's items pushed apart along the row but instead they are stretched top to bottom. What is the correct fix?",
      explanation:
        "In a row container align-items works on the cross axis — vertically — so space-between there does nothing useful, while distribution along the row is justify-content. The other options either change the direction, alter the item sizes, or address the wrong axis again.",
      language: "css",
      starterCode: `.row {
  display: flex;
  align-items: space-between;
}`,
      options: [
        { text: "Replace align-items: space-between with justify-content: space-between", correct: true },
        { text: "Add flex-direction: column to .row" },
        { text: "Replace it with align-content: space-between" },
        { text: "Give each item flex: 1 and keep align-items as it is" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This column of items should be centred horizontally on the page but is centred vertically instead. What is the correct fix?",
      explanation:
        "flex-direction: column makes the main axis vertical, so justify-content now positions items vertically and align-items positions them horizontally. Swapping to align-items: center is the fix. Adding text-align only affects inline content, and changing the direction back defeats the layout's purpose.",
      language: "css",
      starterCode: `.stack {
  display: flex;
  flex-direction: column;
  justify-content: center;
}`,
      options: [
        { text: "Use align-items: center for horizontal centring in a column container", correct: true },
        { text: "Add text-align: center to .stack" },
        { text: "Remove flex-direction: column so justify-content centres horizontally" },
        { text: "Add margin: 0 auto to .stack itself" },
      ],
    },

    // =======================================================================
    // code_fix 39-44 — subtle defect
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "This card grid looks correct on a laptop but forces horizontal scrolling on a phone. What is the correct fix, with no media query?",
      explanation:
        "Four fixed columns cannot narrow below their content, so the grid overflows. repeat(auto-fit, minmax(...)) lets the column count fall as the container narrows, which is the responsive form of the same layout. overflow-x hides the symptom, a media query is unnecessary here, and switching to flex-wrap loses the column alignment.",
      language: "css",
      starterCode: `.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}`,
      options: [
        {
          text: "Replace the fixed count with grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))",
          correct: true,
        },
        { text: "Add overflow-x: hidden to .grid" },
        { text: "Wrap the existing declaration in @media (min-width: 60rem)" },
        { text: "Replace the grid with display: flex and flex-wrap: wrap" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The author wants 16 px between grid cells but is getting uneven spacing and an indent at the container's edges. What is the correct fix?",
      explanation:
        "Margins on children add space at the outer edges too and double up between adjacent items. gap on the container spaces items apart and adds nothing at the edges. Negative margins on the container are a workaround for the same problem, padding does not separate items, and :not(:last-child) still leaves uneven spacing across a wrapped row.",
      language: "css",
      starterCode: `.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.grid > * {
  margin: 8px;
}`,
      options: [
        { text: "Remove the child margin and declare gap: 16px on .grid", correct: true },
        { text: "Keep the child margin and add margin: -8px to .grid" },
        { text: "Replace the child margin with padding: 8px" },
        { text: "Apply the margin only with .grid > *:not(:last-child)" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This desktop-first chain has to undo itself at every step. Rewrite it mobile-first — which option does that correctly?",
      explanation:
        "Mobile-first means the base rules describe the smallest layout and a min-width query adds the wider one, so nothing is undone. Reversing the operators without moving the base layout leaves the same undo pattern, and dropping a query changes the design rather than restructuring it.",
      language: "css",
      starterCode: `.layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

@media (max-width: 48rem) {
  .layout {
    grid-template-columns: 1fr;
  }
}`,
      options: [
        {
          text: "Make the single column the base rule and add @media (min-width: 48rem) { .layout { grid-template-columns: 1fr 1fr; } }",
          correct: true,
        },
        { text: "Change max-width: 48rem to min-width: 48rem and leave the base rule as it is" },
        { text: "Delete the media query and rely on auto-fit in the base rule's column list" },
        { text: "Add !important to the single-column declaration inside the query" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "A reader who has set their browser's default text size to 20 px reports that the wide layout arrives too late. What is the correct fix?",
      explanation:
        "A px breakpoint ignores the root font size, so a reader with larger text keeps the narrow layout well past the point their text needs the space. Expressing the breakpoint in rem ties it to their setting. Raising or lowering the px value only moves the same problem, and em inside a media query resolves against the initial font size rather than the root, which is a subtler trap.",
      language: "css",
      starterCode: `@media (min-width: 768px) {
  .layout {
    grid-template-columns: 1fr 1fr;
  }
}`,
      options: [
        { text: "Express the breakpoint in rem: @media (min-width: 48rem)", correct: true },
        { text: "Lower the breakpoint to @media (min-width: 600px)" },
        { text: "Raise the breakpoint to @media (min-width: 900px)" },
        { text: "Add a second query at @media (min-width: 768px) and (min-resolution: 2dppx)" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "At a 320 px viewport this page scrolls sideways. The images are 1600 px wide originals. What is the correct fix?",
      explanation:
        "An uncapped image renders at its intrinsic width and pushes the page wider than the viewport. Capping it with max-width: 100% and height: auto lets it shrink while keeping its proportions. A fixed width still overflows on narrower screens, overflow-x: hidden hides content instead of fitting it, and a fixed height distorts the image.",
      language: "css",
      starterCode: `.article img {
  /* nothing constrains these 1600px originals */
}`,
      options: [
        { text: "Add max-width: 100% and height: auto", correct: true },
        { text: "Add width: 320px" },
        { text: "Add overflow-x: hidden to body" },
        { text: "Add height: 200px and width: auto" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "A long unbroken identifier in a table cell pushes the layout wider than the phone screen. What is the correct fix?",
      explanation:
        "An unbreakable string has no wrap opportunity, so it sets a minimum width nothing else can beat. overflow-wrap: anywhere lets the browser break inside the word. white-space: nowrap forbids wrapping entirely, text-overflow needs an overflow and a width to act on, and a fixed pixel width just relocates the overflow.",
      language: "css",
      starterCode: `.cell {
  /* contains e.g. ORDER-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0001 */
}`,
      options: [
        { text: "Add overflow-wrap: anywhere so the browser may break inside the string", correct: true },
        { text: "Add white-space: nowrap" },
        { text: "Add text-overflow: ellipsis on its own" },
        { text: "Add width: 320px" },
      ],
    },

    // =======================================================================
    // code_write 45-47 — applied
    // =======================================================================
    {
      type: "code_write",
      questionText:
        "Write a stylesheet that gives every element the border-box model and styles .card with 16 px of padding, an 8 px corner radius and a 1 px solid #dddddd border. Use the lowest specificity that works: no id selectors and no !important.",
      explanation:
        "The lesson is that correct styling rarely needs strong selectors. A universal border-box rule plus a single class selector is enough, and keeping it that way is what makes the next override possible without escalation.",
      language: "css",
      starterCode: `/* TODO: global border-box rule */

.card {
  /* TODO: padding, radius, border */
}`,
      tests: [
        { name: "box-sizing: border-box is applied globally", input: "probe:globalBorderBox", expected: "true" },
        {
          name: "the required card declarations are present",
          input: "probe:declarations(.card)",
          expected: "border:1px solid #dddddd;border-radius:8px;padding:16px",
        },
        { name: "no id selector is used", input: "probe:idSelectorCount", expected: "0" },
        { name: "edge case: no !important anywhere in the submission", input: "probe:importantCount", expected: "0" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Three existing rules set .btn colour: nav .btn to navy, .btn.primary to teal, and .btn to grey. Add ONE new rule, placed last, that makes a .btn.primary inside a nav render white — without !important and without using an id.",
      explanation:
        "The item tests specificity arithmetic as a tool rather than as trivia: the new selector must at least match the strongest existing competitor, and once it does, being last in the file wins the tie. Escalating with !important or an id would also change the colour but teaches the wrong reflex, so both are rejected by the tests.",
      language: "css",
      starterCode: `nav .btn { color: navy; }
.btn.primary { color: teal; }
.btn { color: grey; }

/* TODO: add exactly one rule below */`,
      tests: [
        { name: "the new rule wins for a .btn.primary inside a nav", input: "probe:computedColor(nav>.btn.primary)", expected: "white" },
        { name: "exactly one rule was added", input: "probe:addedRuleCount", expected: "1" },
        { name: "no id selector is used", input: "probe:idSelectorCount", expected: "0" },
        { name: "edge case: no !important is used", input: "probe:importantCount", expected: "0" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Centre a .card both horizontally and vertically inside .stage, which is 400 px tall, using Flexbox. Use no absolute positioning and no fixed pixel offsets.",
      explanation:
        "Flexbox centring is two declarations on the container, and it stays correct when the card's size changes. Absolute positioning with hand-computed offsets produces the same picture once and breaks the moment the content does.",
      language: "css",
      starterCode: `.stage {
  height: 400px;
  /* TODO: centre .card on both axes */
}`,
      tests: [
        { name: "the stage is a flex container", input: "probe:declaration(.stage,display)", expected: "flex" },
        {
          name: "both axes are centred",
          input: "probe:declaration(.stage,justify-content),probe:declaration(.stage,align-items)",
          expected: "center,center",
        },
        { name: "no absolute positioning is used", input: "probe:countDeclarations(position,absolute)", expected: "0" },
        {
          name: "edge case: no hand-computed pixel offsets (top/left/margin-left)",
          input: "probe:countPixelOffsets",
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
        "Build a responsive card grid on .grid that reflows from one column to as many as fit, with 16 px between cells and a minimum cell width of 220 px. Use no media query and no fixed column count.",
      explanation:
        "This is the item that shows a media query is a tool and not a requirement: auto-fit with minmax expresses the whole responsive behaviour in one declaration, and gap spaces the cells without the edge artefacts that child margins produce.",
      language: "css",
      starterCode: `.grid {
  /* TODO: a grid that reflows with no media query */
}`,
      tests: [
        { name: "the grid is a grid container", input: "probe:declaration(.grid,display)", expected: "grid" },
        {
          name: "columns use auto-fit with a minmax minimum of 220px",
          input: "probe:declaration(.grid,grid-template-columns)",
          expected: "repeat(auto-fit, minmax(220px, 1fr))",
        },
        { name: "a 16px gap is declared", input: "probe:declaration(.grid,gap)", expected: "16px" },
        { name: "no media query is present", input: "probe:mediaQueryCount", expected: "0" },
        {
          name: "edge case: no fixed column count such as repeat(4, 1fr)",
          input: "probe:fixedColumnCountCount",
          expected: "0",
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Write mobile-first styles for .layout: one column by default, two equal columns from a 48 rem viewport upward. Exactly one media query, expressed in rem, and no max-width query anywhere.",
      explanation:
        "Mobile-first is a structural property, not a style: the base rule must be the small layout so the query adds rather than undoes. Requiring rem ties the breakpoint to the reader's font-size setting, and forbidding max-width rules out the desktop-first shape that produces the same picture for the wrong reason.",
      language: "css",
      starterCode: `.layout {
  /* TODO: base (small) layout — no media query here */
}

/* TODO: exactly one min-width query, in rem */`,
      tests: [
        { name: "the base rule declares a single column", input: "probe:declaration(.layout,grid-template-columns)", expected: "1fr" },
        { name: "no media query wraps the base rules", input: "probe:baseRulesInsideMediaQuery", expected: "false" },
        { name: "exactly one min-width query, at 48rem", input: "probe:minWidthQueries", expected: "48rem" },
        { name: "the query declares two equal columns", input: "probe:declarationInQuery(.layout,grid-template-columns)", expected: "1fr 1fr" },
        { name: "edge case: no max-width query anywhere", input: "probe:maxWidthQueryCount", expected: "0" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "A page overflows horizontally at 320 px: .banner is 480 px wide, its images are uncapped 1600 px originals, and .cell holds unbreakable order codes. Write the CSS that removes the overflow without hiding content.",
      explanation:
        "Three separate causes of the same symptom, each with its own fix: a fixed width wider than the viewport, media with no cap, and a string with no wrap opportunity. overflow-x: hidden would make the scrollbar disappear while leaving the content unreachable, so it is rejected.",
      language: "css",
      starterCode: `.banner {
  width: 480px; /* TODO: must not exceed a 320px viewport */
}

.banner img {
  /* TODO */
}

.cell {
  /* TODO: unbreakable order codes */
}`,
      tests: [
        { name: "no declared width exceeds 320px", input: "probe:maxFixedPixelWidth", expected: "0" },
        { name: "images are capped and keep their proportions", input: "probe:declaration(.banner img,max-width)", expected: "100%" },
        { name: "long strings are given a wrap opportunity", input: "probe:hasWrapOpportunity(.cell)", expected: "true" },
        {
          name: "edge case: overflow is not hidden away instead of fixed",
          input: "probe:countDeclarations(overflow-x,hidden)",
          expected: "0",
        },
      ],
    },
  ],
};
