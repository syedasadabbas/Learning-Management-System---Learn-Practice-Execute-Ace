// =============================================================================
// WEEK 3 GRAND EXAM — "JavaScript Fundamentals". Blueprint: CURRICULUM_PLAN A.3.
// -----------------------------------------------------------------------------
// Draws on the week's three EXISTING lectures, unmodified:
//   L1 "Values, Types & Functions"
//   L2 "Arrays, Objects & the DOM"
//   L3 "Events & Asynchronous JavaScript"
//
// 30 mcq (2) + 14 code_fix (3) + 6 code_write (8) = 50 questions / 150 points.
//
// ALL PROSE IS ORIGINAL.
//
// THIS IS THE ONE WEEK WHOSE `code_write` TESTS ARE LITERALLY EXECUTABLE.
// Every `tests` entry is a real (stdin -> trimmed stdout) pair for a complete
// JavaScript program, so the grader runs the student's source unchanged and
// compares output. The stdin bridge in each starter matches the convention in
// scripts/content/problems/prelude.ts, so the same source runs in the browser
// worker and on Piston without the student knowing which one graded them.
//
// Two items in this week are about the DOM and about the network, neither of
// which exists in a server-side JavaScript sandbox. They are therefore posed
// against a STUB supplied in the starter (a node object with a textContent
// property; an injected fetch). That is a deliberate substitution, stated in
// each item's explanation: it tests the same decision the lecture taught
// (textContent over innerHTML; check the status before trusting the body)
// without pretending the sandbox has a browser in it.
// =============================================================================

import type { SeedExam } from "./types";

/** Reads all of stdin on both runtimes. Mirrors JS_STDIN in ../problems/prelude.ts. */
const STDIN =
  'const stdin = typeof readAll === "function" ? readAll() : require("fs").readFileSync(0, "utf8");';

export const week3Exam: SeedExam = {
  weekNumber: 3,
  title: "Week 3 Grand Exam — JavaScript Fundamentals",
  questions: [
    // =======================================================================
    // mcq 1-12 — foundational recall
    // =======================================================================
    {
      type: "mcq",
      questionText: "What is the difference in scope between let and var?",
      explanation:
        "let is scoped to the enclosing block — any pair of braces. var is scoped to the enclosing function and leaks out of blocks, which is why a var declared inside an if or a for is still visible after it.",
      options: [
        { text: "let is scoped to the enclosing block; var is scoped to the enclosing function", correct: true },
        { text: "let is scoped to the file; var is scoped to the block" },
        { text: "They have identical scope; only reassignment differs" },
        { text: "let is function-scoped and var is global in every case" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does const actually prevent?",
      explanation:
        "const prevents rebinding the name. The value it points at can still change: the properties of a const object can be added, changed and deleted. Only the binding is fixed, not the contents.",
      options: [
        { text: "Reassigning the binding — the object it points at can still be mutated", correct: true },
        { text: "Any change to the value, including object properties" },
        { text: "Redeclaring the name, but reassignment is allowed" },
        { text: "Nothing at runtime; it is a hint for the reader only" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the result of \"5\" == 5?",
      explanation:
        "true. The loose operator coerces the string to a number before comparing, so different types can still compare equal. The strict operator compares type first and returns false without any conversion.",
      options: [
        { text: "true — the string is coerced to a number first", correct: true },
        { text: "false — the types differ" },
        { text: "A TypeError, because the operands are different types" },
        { text: "NaN" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why prefer === over == ?",
      explanation:
        "=== compares type and value with no conversion, so the result depends only on what you wrote. == applies coercion rules that produce surprising equalities and make a comparison's outcome depend on knowing those rules by heart.",
      options: [
        { text: "It compares type and value with no coercion, so the result is predictable", correct: true },
        { text: "It is faster, because it skips the conversion step" },
        { text: "== is deprecated and will be removed from the language" },
        { text: "=== also compares object contents, which == does not" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which expression produces NaN?",
      explanation:
        "Number(\"abc\") is a numeric conversion with no numeric meaning, so it yields NaN. Adding a number to a string concatenates and gives \"12\"; 0/0 is also NaN but 10/0 is Infinity; and parseInt(\"12px\") stops at the first non-digit and returns 12.",
      options: [
        { text: "Number(\"abc\")", correct: true },
        { text: "\"1\" + 2" },
        { text: "10 / 0" },
        { text: "parseInt(\"12px\")" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does typeof null return, and why does it matter?",
      explanation:
        "\"object\" — a long-standing quirk of the language. It matters because a typeof check is not enough to distinguish null from a real object; a separate value === null test is required, and forgetting it is a common source of property-access errors.",
      options: [
        { text: "\"object\", so a typeof check alone cannot rule out null", correct: true },
        { text: "\"null\", which makes null safe to test with typeof" },
        { text: "\"undefined\", because null has no value" },
        { text: "It throws a ReferenceError" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the difference between a function declaration and a function expression?",
      explanation:
        "A declaration is hoisted with its body, so it can be called before the line it appears on. An expression is only a value assigned to a binding, and a const or let binding cannot be read before its initialiser runs.",
      options: [
        { text: "A declaration is hoisted with its body; an expression is not usable before its assignment", correct: true },
        { text: "An expression is hoisted; a declaration is not" },
        { text: "Only declarations may take parameters" },
        { text: "There is no difference beyond syntax" },
      ],
    },
    {
      type: "mcq",
      questionText: "How does an arrow function treat this?",
      explanation:
        "An arrow function has no this of its own: it uses the this of the scope where it was written. That is exactly why it works well as a callback and badly as an object method that needs the receiving object.",
      options: [
        { text: "It inherits this from the surrounding scope and cannot be rebound", correct: true },
        { text: "It always sets this to the global object" },
        { text: "It sets this to the object it is called on, like a normal function" },
        { text: "It sets this to undefined in every case" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does array.map(fn) return?",
      explanation:
        "A new array of the same length holding each return value of fn. The original array is untouched. This is the distinction from forEach, which returns undefined and exists only for its side effects.",
      options: [
        { text: "A new array of the same length, leaving the original unchanged", correct: true },
        { text: "The original array, modified in place" },
        { text: "undefined — map exists for its side effects" },
        { text: "A new array containing only the items for which fn returned true" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does array.filter(fn) return?",
      explanation:
        "A new array containing the items for which fn returned a truthy value; it may be shorter than the original and may be empty. It never removes items from the array you passed in.",
      options: [
        { text: "A new array of the items for which fn returned a truthy value", correct: true },
        { text: "The first item for which fn returned true" },
        { text: "true or false, depending on whether any item matched" },
        { text: "The original array with the non-matching items deleted" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the difference between document.querySelector and document.getElementById?",
      explanation:
        "querySelector takes any CSS selector and returns the first match or null. getElementById takes a bare id string — no # — and returns that element or null. Passing \"#id\" to getElementById silently finds nothing.",
      options: [
        {
          text: "querySelector takes any CSS selector; getElementById takes a bare id with no # prefix",
          correct: true,
        },
        { text: "querySelector returns every match; getElementById returns the first" },
        { text: "getElementById accepts any CSS selector; querySelector accepts only classes" },
        { text: "They are aliases with identical behaviour" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the difference between textContent and innerHTML when writing to an element?",
      explanation:
        "textContent sets text, and any markup characters in the string are shown literally. innerHTML parses the string as HTML, so a string containing a tag becomes real markup — which is how untrusted text turns into script injection.",
      options: [
        {
          text: "textContent writes the string as text; innerHTML parses it as markup",
          correct: true,
        },
        { text: "textContent parses markup; innerHTML escapes it" },
        { text: "They behave identically; innerHTML is just older" },
        { text: "textContent only reads and cannot write" },
      ],
    },

    // =======================================================================
    // mcq 13-24 — applied reasoning
    // =======================================================================
    {
      type: "mcq",
      questionText: "What does [1, 2, 3].reduce((acc, n) => acc + n, 0) evaluate to?",
      explanation:
        "6. reduce folds the array into a single value, starting from the initial value 0 and adding each item. The initial value is also what makes the call safe on an empty array.",
      options: [
        { text: "6", correct: true },
        { text: "[1, 3, 6]" },
        { text: "0" },
        { text: "undefined" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which of these methods mutates the array it is called on?",
      explanation:
        "push adds to the array in place. map, filter and slice all return new arrays and leave the original alone — which is why a discarded map result means the work was thrown away.",
      options: [
        { text: "push", correct: true },
        { text: "map" },
        { text: "filter" },
        { text: "slice" },
      ],
    },
    {
      type: "mcq",
      questionText: "How do you copy an array so that changes to the copy do not affect the original?",
      explanation:
        "A spread into a new array literal, or slice(), makes a shallow copy — a new array with the same items. Assigning the variable copies the reference, so both names point at one array.",
      options: [
        { text: "const copy = [...original]", correct: true },
        { text: "const copy = original" },
        { text: "const copy = original.length" },
        { text: "const copy = original.forEach((x) => x)" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "querySelectorAll returns a static NodeList; getElementsByClassName returns a live HTMLCollection. What does that difference mean in practice?",
      explanation:
        "A static list is a snapshot taken when you asked. A live collection keeps tracking the document, so it grows and shrinks as elements are added or removed — which makes an index-based loop over a live collection while removing items skip elements.",
      options: [
        {
          text: "The live collection changes as the document changes; the static list is a snapshot",
          correct: true,
        },
        { text: "The static list cannot be iterated" },
        { text: "The live collection is always faster to read" },
        { text: "The static list contains text nodes and the live one does not" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A comment field's value is written into a page with element.innerHTML = value. What is the consequence?",
      explanation:
        "The submitted string is parsed as markup, so anything script-shaped in it executes with the page's privileges. Writing the same value with textContent renders it as visible text and removes the injection entirely.",
      options: [
        { text: "Markup in the submitted value is parsed and can execute as script", correct: true },
        { text: "Nothing — the browser escapes user input automatically" },
        { text: "The value is truncated at the first angle bracket" },
        { text: "Only styling can be injected, never behaviour" },
      ],
    },
    {
      type: "mcq",
      questionText: "In what order does an event reach a nested element by default?",
      explanation:
        "The event travels from the document down to the target (capture), fires on the target, then travels back up (bubble). addEventListener attaches to the bubble phase unless you opt into capture, which is what makes delegation on an ancestor work.",
      options: [
        { text: "Capture down from the document, then the target, then bubbling back up", correct: true },
        { text: "Bubbling up first, then capturing back down" },
        { text: "Only on the target — events do not travel" },
        { text: "In the order the listeners were registered, regardless of the tree" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does event.preventDefault() do on a form's submit event?",
      explanation:
        "It cancels the browser's default action for that event — here, navigating to submit the form — while leaving the handler running. It does not stop the event travelling; that is stopPropagation, a different thing.",
      options: [
        { text: "Cancels the browser's default action, so the page does not navigate", correct: true },
        { text: "Stops the event from reaching other listeners" },
        { text: "Cancels the handler and returns immediately" },
        { text: "Clears every field in the form" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A list gains items after page load, and clicking a new item does nothing. Which approach fixes it once and for all?",
      explanation:
        "Delegation: attach one listener to the container that persists, and identify the clicked item from event.target. Listeners attached to elements that existed at load time cannot cover elements created later, and re-attaching after every change is the version of this that gets forgotten.",
      options: [
        {
          text: "Attach one listener to the container and identify the item from event.target",
          correct: true,
        },
        { text: "Attach a listener to every item again after each change" },
        { text: "Use an inline onclick attribute on each item" },
        { text: "Attach the listener with capture: true on the document" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does await do inside an async function?",
      explanation:
        "It suspends that function until the promise settles, then resumes with the resolved value — or throws if it rejected. The rest of the program keeps running in the meantime; only the awaiting function is paused.",
      options: [
        {
          text: "Suspends that function until the promise settles, then resumes with its value",
          correct: true,
        },
        { text: "Blocks the whole page until the promise settles" },
        { text: "Converts the promise into a synchronous value with no waiting" },
        { text: "Retries the promise until it resolves" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the value of a promise returned by an async function that returns 5?",
      explanation:
        "An async function always returns a promise. Returning 5 gives a promise that resolves to 5, which is why the caller still needs an await or a .then to see it.",
      options: [
        { text: "A promise that resolves to 5", correct: true },
        { text: "The number 5, unwrapped" },
        { text: "undefined, because async functions cannot return values" },
        { text: "A promise that resolves to undefined" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why check response.ok after a fetch?",
      explanation:
        "fetch resolves for any completed HTTP exchange, including 404 and 500 — the request succeeded even though the answer was an error. Without an ok or status check the code goes on to parse an error page as if it were the data it asked for.",
      options: [
        { text: "fetch resolves for error statuses too, so 404 and 500 must be detected explicitly", correct: true },
        { text: "fetch rejects on any status other than 200, so ok is only a convenience" },
        { text: "ok reports whether the JSON body parsed successfully" },
        { text: "ok reports whether the network connection is still open" },
      ],
    },
    {
      type: "mcq",
      questionText: "When does a fetch promise actually reject?",
      explanation:
        "Only when the exchange could not complete — no network, DNS failure, a blocked request, an aborted call. Any HTTP response, however unwelcome its status, is a fulfilled promise.",
      options: [
        { text: "When the request could not complete at all, such as a network failure", correct: true },
        { text: "Whenever the status is 400 or above" },
        { text: "Whenever the response body is not valid JSON" },
        { text: "Never — fetch always resolves" },
      ],
    },

    // =======================================================================
    // mcq 25-30 — edge cases and traps
    // =======================================================================
    {
      type: "mcq",
      questionText:
        "for (var i = 0; i < 3; i++) setTimeout(() => console.log(i), 0) logs what?",
      explanation:
        "3, 3, 3. There is one function-scoped i, all three callbacks close over that same binding, and by the time they run the loop has finished. Declaring the counter with let creates a fresh binding per iteration and logs 0, 1, 2.",
      options: [
        { text: "3, 3, 3", correct: true },
        { text: "0, 1, 2" },
        { text: "0, 0, 0" },
        { text: "2, 2, 2" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does [10, 9, 100].sort() produce, and why?",
      explanation:
        "[10, 100, 9]. The default sort converts items to strings and compares them, so \"100\" sorts before \"9\". A numeric sort needs an explicit comparator such as (a, b) => a - b.",
      options: [
        { text: "[10, 100, 9] — the default sort compares string forms", correct: true },
        { text: "[9, 10, 100] — sort is numeric by default" },
        { text: "[100, 10, 9] — sort is descending by default" },
        { text: "A TypeError, because no comparator was supplied" },
      ],
    },
    {
      type: "mcq",
      questionText: "One promise passed to Promise.all rejects. What happens to the others?",
      explanation:
        "Promise.all rejects immediately with that reason. The other promises are not cancelled — they carry on and their results are simply discarded. Promise.allSettled is the call to use when you want every outcome.",
      options: [
        {
          text: "The combined promise rejects at once; the others keep running but their results are discarded",
          correct: true,
        },
        { text: "The other promises are cancelled immediately" },
        { text: "The combined promise resolves with the successful results and omits the failure" },
        { text: "The combined promise waits for all of them and then rejects" },
      ],
    },
    {
      type: "mcq",
      questionText: "What happens if you use await at the top of a non-async function?",
      explanation:
        "It is a syntax error: await is only valid inside an async function or at the top level of a module. The fix is to mark the enclosing function async, not to remove the await and hope the value arrives in time.",
      options: [
        { text: "A syntax error — await requires an async function or module top level", correct: true },
        { text: "It works, but returns a pending promise instead of the value" },
        { text: "It works and blocks until the promise settles" },
        { text: "It silently returns undefined" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A function is written as: function f() { return\\n  { ok: true }; }  — with a newline after return. What does it return?",
      explanation:
        "undefined. Automatic semicolon insertion terminates the statement at the end of the return line, so the object literal is unreachable code. Keeping the value on the same line as return, or opening the parenthesis there, avoids it.",
      options: [
        { text: "undefined — a semicolon is inserted after return", correct: true },
        { text: "{ ok: true }" },
        { text: "A syntax error at the object literal" },
        { text: "true" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why does an unhandled promise rejection matter even when the page keeps working?",
      explanation:
        "Because the failure went nowhere: no error state was shown, nothing was retried and nothing was logged where the team will see it. The page looks fine and quietly shows stale or missing data, which is harder to notice than a crash.",
      options: [
        {
          text: "The failure is silent — no error state, no retry, and stale or missing data on screen",
          correct: true,
        },
        { text: "It stops all later promises in the page from resolving" },
        { text: "It leaks memory in proportion to the response size" },
        { text: "It does not matter; the browser retries automatically" },
      ],
    },

    // =======================================================================
    // code_fix 31-38 — applied
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "Every button logs 3 instead of its own index. What is the smallest correct fix?",
      explanation:
        "var gives one function-scoped binding that all three callbacks share, and it holds 3 by the time they run. let creates a fresh binding per iteration, which is exactly what the callbacks need to capture. A delay does not help — the loop finishes first either way — and reading a captured copy inside the same var scope changes nothing.",
      language: "javascript",
      starterCode: `for (var i = 0; i < 3; i++) {
  buttons[i].addEventListener("click", () => console.log(i));
}`,
      options: [
        { text: "Change var i to let i", correct: true },
        { text: "Change the delay so the callbacks run before the loop ends" },
        { text: "Add const copy = i inside the loop and keep logging i" },
        { text: "Change the arrow function to a normal function expression" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This guard is meant to reject an empty name, but an empty string gets through as if it were absent — and a name of \"0\" is rejected. What is the correct fix?",
      explanation:
        "Loose equality against 0 coerces, so \"\" and \"0\" both take part in comparisons they should not. Comparing the trimmed length is explicit about the actual requirement. A strict comparison against 0 is still the wrong question, and a bare truthiness check also rejects \"0\".",
      language: "javascript",
      starterCode: `function isBlank(name) {
  return name == 0;
}`,
      options: [
        { text: "Return name.trim().length === 0", correct: true },
        { text: "Return name === 0" },
        { text: "Return !name" },
        { text: "Return name == \"\"" },
      ],
    },
    {
      type: "code_fix",
      questionText: "This function always returns undefined. What is the correct fix?",
      explanation:
        "Automatic semicolon insertion ends the statement at the newline after return, so the object literal is never reached. Moving the opening brace onto the return line is the fix. Adding a semicolon makes it worse, wrapping in a function returns a function, and an arrow body with a bare brace is parsed as a block.",
      language: "javascript",
      starterCode: `function makeResult(value) {
  return
  {
    ok: true,
    value: value
  };
}`,
      options: [
        { text: "Move the opening brace onto the return line: return {", correct: true },
        { text: "Add a semicolon immediately after return" },
        { text: "Wrap the object literal in a function and return that" },
        { text: "Rewrite it as an arrow function: const makeResult = (value) => { ok: true, value: value }" },
      ],
    },
    {
      type: "code_fix",
      questionText: "This throws \"Assignment to constant variable\". What is the correct fix?",
      explanation:
        "const forbids rebinding the name, and total = total + n rebinds it. Declaring it with let expresses the intent to accumulate. Pushing to a const array would work for a different design, var reintroduces function scoping for no benefit, and mutating a const object here is a workaround for a problem that does not need one.",
      language: "javascript",
      starterCode: `function sum(numbers) {
  const total = 0;
  for (const n of numbers) {
    total = total + n;
  }
  return total;
}`,
      options: [
        { text: "Declare it with let total = 0", correct: true },
        { text: "Declare it with var total = 0" },
        { text: "Change it to const total = [] and push each n" },
        { text: "Change it to const total = { value: 0 } and assign total.value" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The author wanted a list of doubled values but doubled is undefined. What is the correct fix?",
      explanation:
        "forEach returns undefined; it runs the callback for its side effects only. map is the call that collects each return value into a new array. Returning from inside forEach, or awaiting it, does not change what forEach itself returns.",
      language: "javascript",
      starterCode: `const doubled = numbers.forEach((n) => n * 2);
console.log(doubled);`,
      options: [
        { text: "Use numbers.map((n) => n * 2)", correct: true },
        { text: "Add return before the callback body inside forEach" },
        { text: "Await the forEach call" },
        { text: "Use numbers.filter((n) => n * 2)" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This works on a populated array and throws \"Reduce of empty array with no initial value\" on an empty one. What is the correct fix?",
      explanation:
        "With no initial value, reduce takes the first item as the accumulator — and an empty array has none. Supplying 0 makes the empty case return 0 naturally. Guarding with a length check works but adds a branch reduce already handles, and the other options change the result or the type.",
      language: "javascript",
      starterCode: `function total(prices) {
  return prices.reduce((acc, p) => acc + p);
}`,
      options: [
        { text: "Supply an initial value: prices.reduce((acc, p) => acc + p, 0)", correct: true },
        { text: "Return prices.length === 0 ? undefined : prices.reduce((acc, p) => acc + p)" },
        { text: "Use prices.reduce((acc, p) => acc + p, prices[0])" },
        { text: "Use prices.map((p) => p).join(\"+\")" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "After calling this, the caller's original array is sorted too, which the caller did not expect. What is the correct fix?",
      explanation:
        "sort mutates in place and returns the same array, so the caller's array is reordered. Copying first with a spread leaves the input untouched. toString-based comparison is a separate bug, reverse mutates as well, and a comparator alone does not stop the mutation.",
      language: "javascript",
      starterCode: `function sortedDesc(scores) {
  return scores.sort((a, b) => b - a);
}`,
      options: [
        { text: "Copy first: return [...scores].sort((a, b) => b - a)", correct: true },
        { text: "Return scores.reverse()" },
        { text: "Return scores.sort()" },
        { text: "Return scores.sort((a, b) => a - b).reverse()" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "A comment containing markup renders as real markup on the page. What is the correct fix?",
      explanation:
        "innerHTML parses the string as HTML, so a submitted tag becomes a real element. textContent writes the same string as visible text and removes the injection. Stripping angle brackets by hand is a denylist that will be incomplete, and escaping only quotes leaves tags intact.",
      language: "javascript",
      starterCode: `function render(commentText) {
  box.innerHTML = commentText;
}`,
      options: [
        { text: "Assign to box.textContent instead", correct: true },
        { text: "Remove < and > from commentText before assigning to innerHTML" },
        { text: "Replace double quotes with &quot; before assigning to innerHTML" },
        { text: "Assign to box.outerHTML instead" },
      ],
    },

    // =======================================================================
    // code_fix 39-44 — subtle defect
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "This loop misses the last item in the array. What is the correct fix?",
      explanation:
        "The condition stops one iteration early, so the final index is never visited. Using < with length visits every index exactly once. Starting at 1 skips the first item instead, <= with length reads one past the end, and decrementing the length inside the loop mutates nothing useful.",
      language: "javascript",
      starterCode: `for (let i = 0; i < items.length - 1; i++) {
  render(items[i]);
}`,
      options: [
        { text: "Change the condition to i < items.length", correct: true },
        { text: "Change the initialiser to let i = 1" },
        { text: "Change the condition to i <= items.length" },
        { text: "Change the condition to i < items.length && items[i] !== undefined" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Submitting this form reloads the page and the handler's work is lost. What is the correct fix?",
      explanation:
        "Without preventDefault the browser performs its default submit navigation, discarding everything the handler did. Calling it first is the fix. stopPropagation only stops the event travelling, return false does nothing for a listener added with addEventListener, and type=\"button\" removes submission behaviour rather than intercepting it.",
      language: "javascript",
      starterCode: `form.addEventListener("submit", (event) => {
  const value = form.elements.email.value;
  save(value);
});`,
      options: [
        { text: "Call event.preventDefault() as the first line of the handler", correct: true },
        { text: "Call event.stopPropagation() as the first line of the handler" },
        { text: "Add return false at the end of the handler" },
        { text: "Change the submit button to type=\"button\"" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "When the API returns 404, this renders the error page's body as if it were data. What is the correct fix?",
      explanation:
        "fetch resolves for a 404, so the code proceeds to parse whatever came back. Checking response.ok before reading the body is the fix. try/catch does not help because nothing threw, a status check after parsing is too late, and retrying does not make a 404 into data.",
      language: "javascript",
      starterCode: `async function load(url) {
  const response = await fetch(url);
  const data = await response.json();
  render(data);
}`,
      options: [
        { text: "Check response.ok before reading the body and handle the failure separately", correct: true },
        { text: "Wrap the fetch call in try/catch and render inside the try block" },
        { text: "Check response.status after parsing the body" },
        { text: "Retry the fetch once before parsing" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "When the network is unavailable this logs an unhandled rejection and the page shows a stale spinner. What is the correct fix?",
      explanation:
        "The rejection has nowhere to go, so nothing tells the interface the request failed. A catch that shows an error state and clears the spinner is the fix. Suppressing the rejection with an empty catch leaves the spinner forever, a global handler is not a substitute for handling it here, and setting a flag before the call does not observe the outcome.",
      language: "javascript",
      starterCode: `function start() {
  showSpinner();
  fetchData().then((data) => {
    hideSpinner();
    render(data);
  });
}`,
      options: [
        {
          text: "Add .catch((error) => { hideSpinner(); showError(error); }) to the chain",
          correct: true,
        },
        { text: "Add .catch(() => {}) to silence the rejection" },
        { text: "Rely on a window.onunhandledrejection handler to log it" },
        { text: "Call hideSpinner() immediately after fetchData() instead of inside then" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This script throws \"Cannot read properties of null\" because it runs before the element exists. Which fix is correct without moving the script?",
      explanation:
        "The script runs during head parsing, so the element is not in the DOM yet. defer makes it run after parsing completes, which fixes the ordering without restructuring the page. async does not guarantee the document is ready, a timeout is a race dressed up as a fix, and optional chaining silently does nothing at all.",
      language: "javascript",
      starterCode: `<!-- in <head> -->
<script src="app.js"></script>
<!-- app.js -->
document.querySelector("#list").addEventListener("click", onClick);`,
      options: [
        { text: "Add the defer attribute to the script tag", correct: true },
        { text: "Add the async attribute to the script tag" },
        { text: "Wrap the code in setTimeout(..., 100)" },
        { text: "Use optional chaining: document.querySelector(\"#list\")?.addEventListener(...)" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Items added after load do not respond to clicks, and each rebuild of the list doubles the number of handlers that fire. What is the correct fix?",
      explanation:
        "Attaching per item covers only the items present at the time, and re-running the attach on rebuild stacks duplicate listeners on the survivors. One delegated listener on the container solves both: it survives rebuilds and is attached once. The other options either keep re-attaching or attach to elements that will be replaced.",
      language: "javascript",
      starterCode: `function attach() {
  document.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("click", onItemClick);
  });
}
// attach() is called again after every rebuild`,
      options: [
        {
          text: "Attach one listener to the list container and use event.target.closest(\".item\") inside it",
          correct: true,
        },
        { text: "Call removeEventListener on every item before calling attach() again" },
        { text: "Add { once: true } to each item's listener" },
        { text: "Move the attach() call into a setInterval so new items are covered" },
      ],
    },

    // =======================================================================
    // code_write 45-47 — applied
    // =======================================================================
    {
      type: "code_write",
      questionText:
        "Read one line of whitespace-separated integers from standard input and print their arithmetic mean, rounded to exactly two decimal places. Print 0.00 when the input holds no numbers. Do not print anything else.",
      explanation:
        "A derived value from primitives, with the two cases that break naive implementations: an empty input, where dividing by a zero count yields NaN unless it is handled, and negative values, which must not be filtered out by a truthiness check. The fixed two-decimal format is what makes the output comparable.",
      language: "javascript",
      starterCode: `${STDIN}
const nums = stdin.trim().split(/\\s+/).filter(Boolean).map(Number);

// TODO: print the mean of nums to exactly two decimal places, or 0.00 if empty.
`,
      tests: [
        { name: "happy path: three positive integers", input: "10 20 30", expected: "20.00" },
        { name: "rounds to two decimals", input: "1 2", expected: "1.50" },
        { name: "negative values are included, not skipped", input: "-10 0 10 -20", expected: "-5.00" },
        { name: "edge case: empty input prints 0.00 rather than NaN", input: "", expected: "0.00" },
        { name: "edge case: a single zero", input: "0", expected: "0.00" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Each input line holds two JSON values separated by a single tab. For each line print true if the two are the same value with no coercion, otherwise false. Treat NaN as equal to itself, and treat null and undefined as different. Print one word per line.",
      explanation:
        "A strict comparison written out by hand, which forces the two facts loose equality hides: different types are never equal without coercion, and NaN is the one value not equal to itself under ===. Object.is expresses both, but a === comparison plus an explicit NaN branch is equally acceptable.",
      language: "javascript",
      starterCode: `${STDIN}
const lines = stdin.replace(/\\r/g, "").split("\\n").filter((line) => line.length > 0);

// Each line: two JSON values separated by a tab. The string "undefined" is not
// valid JSON, so it arrives as the literal text undefined — handle it yourself.
// TODO: print true or false for each line.
`,
      tests: [
        { name: "same type and same value", input: "1\t1", expected: "true" },
        { name: "same digits, different types", input: '"1"\t1', expected: "false" },
        { name: "NaN compared with itself is true here", input: "NaN\tNaN", expected: "true" },
        { name: "edge case: null and undefined are different", input: "null\tundefined", expected: "false" },
        {
          name: "several lines are each answered in order",
          input: '2\t2\n"a"\t"b"\ntrue\t1',
          expected: "true\nfalse\nfalse",
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Standard input holds a JSON array of records, each { \"name\": string, \"score\": number, \"active\": boolean }. Print a one-line JSON summary with exactly these keys in this order: count, activeCount, totalScore, topName. topName is the name of the highest-scoring ACTIVE record, or null if there are none. Leave the input array unmodified.",
      explanation:
        "A transformation rather than a loop with a mutable accumulator: filter selects the active records, reduce folds them into a total, and the top name is a comparison over the same filtered list. The empty-array case is what catches an implementation that assumes at least one record exists.",
      language: "javascript",
      starterCode: `${STDIN}
const records = JSON.parse(stdin);

// TODO: print JSON.stringify({ count, activeCount, totalScore, topName })
// without mutating records.
`,
      tests: [
        {
          name: "mixed active and inactive records",
          input:
            '[{"name":"Amara","score":18,"active":true},{"name":"Bilal","score":25,"active":false},{"name":"Chen","score":20,"active":true}]',
          expected: '{"count":3,"activeCount":2,"totalScore":63,"topName":"Chen"}',
        },
        {
          name: "edge case: empty array gives a null topName, not a crash",
          input: "[]",
          expected: '{"count":0,"activeCount":0,"totalScore":0,"topName":null}',
        },
        {
          name: "edge case: every record inactive",
          input: '[{"name":"Dara","score":9,"active":false}]',
          expected: '{"count":1,"activeCount":0,"totalScore":9,"topName":null}',
        },
        {
          name: "negative scores are summed, not discarded",
          input: '[{"name":"Eve","score":-5,"active":true},{"name":"Fay","score":5,"active":true}]',
          expected: '{"count":2,"activeCount":2,"totalScore":0,"topName":"Fay"}',
        },
      ],
    },

    // =======================================================================
    // code_write 48-50 — synthesis
    // =======================================================================
    {
      type: "code_write",
      questionText:
        "The starter supplies a `node` object standing in for a DOM element, with a textContent property and an innerHTML property that throws if used. Read a line of whitespace-separated commands — inc, dec or reset — apply them in order to a counter starting at 0, render the counter into the node after every command, and finally print node.textContent. Ignore unknown commands.",
      explanation:
        "The lesson is the safe write: rendering through textContent rather than innerHTML, which is why the stub throws on innerHTML. The grading sandbox has no DOM, so the node is a stub — this tests the same decision the lecture taught without pretending there is a browser here. Repeated commands prove the render is idempotent per call rather than appending.",
      language: "javascript",
      starterCode: `${STDIN}
const commands = stdin.trim().split(/\\s+/).filter(Boolean);

// A stand-in for a DOM element. innerHTML is deliberately unusable.
const node = {
  textContent: "",
  set innerHTML(_v) {
    throw new Error("innerHTML is not permitted in this exercise");
  },
};

// TODO: apply the commands, render through node.textContent after each one,
// then print node.textContent.
`,
      tests: [
        { name: "three increments render 3", input: "inc inc inc", expected: "3" },
        { name: "mixed commands, reset returns to zero", input: "inc inc reset inc", expected: "1" },
        { name: "decrements go negative", input: "dec dec", expected: "-2" },
        { name: "unknown commands are ignored", input: "inc spin inc", expected: "2" },
        { name: "edge case: no commands leaves the counter at 0", input: "", expected: "0" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "The starter supplies an injected `fetchLike(url)` whose behaviour is driven by the input line. Write an async wrapper that returns a discriminated result and print it as JSON with keys in this order: ok, then either data or reason. A completed request with a status below 400 is a success; a status of 400 or above is a failure with reason \"http-404\" (the status appended); a rejected request is a failure with reason \"network\".",
      explanation:
        "Every trap from lecture 3 in one item: fetch resolves for a 404, so an ok check is the only thing that separates data from an error page; a rejection is a different failure and must stay distinguishable from it; and neither may be allowed to throw out of the wrapper. The injected fetch exists because the sandbox has no network — the decision being graded is unchanged.",
      language: "javascript",
      starterCode: `${STDIN}
const line = stdin.trim();

// Injected stand-in for fetch. "network" makes the request fail to complete;
// anything else is a status code that COMPLETED successfully as an exchange.
function fetchLike(_url) {
  if (line === "network") return Promise.reject(new Error("offline"));
  const status = Number(line);
  return Promise.resolve({
    ok: status < 400,
    status: status,
    json: () => Promise.resolve({ status: status }),
  });
}

// TODO: async function load(url) returning { ok: true, data } or
// { ok: false, reason }. Print JSON.stringify of the result. Never throw.
`,
      tests: [
        { name: "success path returns the parsed body", input: "200", expected: '{"ok":true,"data":{"status":200}}' },
        { name: "a 404 is a failure result, not a throw", input: "404", expected: '{"ok":false,"reason":"http-404"}' },
        { name: "a 500 is distinguishable from a 404", input: "500", expected: '{"ok":false,"reason":"http-500"}' },
        {
          name: "edge case: a rejected request is reason network, not an unhandled rejection",
          input: "network",
          expected: '{"ok":false,"reason":"network"}',
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Standard input holds a JSON object of form values: { \"email\": string, \"age\": string }. The starter supplies an `event` stub recording whether preventDefault was called. Write a submit handler that prevents the default action, rejects an email without an @ and an age that is not a positive integer, and prints a one-line JSON result with keys in this order: prevented, ok, message. On success message is \"saved\"; on failure it names the first invalid field as \"invalid-email\" or \"invalid-age\", checking email first.",
      explanation:
        "The whole submit lesson: cancel the default navigation before anything else so the handler's work is not discarded, validate before saving, and report a specific reason rather than a generic failure. The event is a stub because the sandbox has no DOM events; the ordering requirement — prevent first, then validate — is what the prevented flag proves even on the failure paths.",
      language: "javascript",
      starterCode: `${STDIN}
const values = JSON.parse(stdin);

// A stand-in for a submit event. Records whether the default was cancelled.
const event = {
  prevented: false,
  preventDefault() {
    this.prevented = true;
  },
};

// TODO: handle the submit, then print
// JSON.stringify({ prevented: event.prevented, ok, message }).
`,
      tests: [
        {
          name: "valid input is saved and the default is prevented",
          input: '{"email":"amara@example.test","age":"24"}',
          expected: '{"prevented":true,"ok":true,"message":"saved"}',
        },
        {
          name: "an email with no @ is rejected but the default is still prevented",
          input: '{"email":"amara","age":"24"}',
          expected: '{"prevented":true,"ok":false,"message":"invalid-email"}',
        },
        {
          name: "a non-numeric age is rejected",
          input: '{"email":"amara@example.test","age":"twenty"}',
          expected: '{"prevented":true,"ok":false,"message":"invalid-age"}',
        },
        {
          name: "edge case: an empty email is reported before the age, and zero is not positive",
          input: '{"email":"","age":"0"}',
          expected: '{"prevented":true,"ok":false,"message":"invalid-email"}',
        },
      ],
    },
  ],
};
