// =============================================================================
// JAVASCRIPT TRACK — seed data. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// ORIGINAL PROSE ONLY (docs/DECISIONS.md). The PATTERNS below — two-pointer,
// sliding window, hash-map counting, stack matching, topological sort, memoised
// dynamic programming — are common knowledge and not ownable. Every statement,
// hint, example and test in this file was written for this repository. No text was
// copied from LeetCode, HackerRank, W3Schools or anywhere else.
//
// I/O CONVENTION, uniform across the whole catalogue: a problem is a PROGRAM that
// reads stdin and prints to stdout. That is the only contract both the browser
// worker and Piston satisfy (see prelude.ts), and it means a student's mental model
// does not change between Run and Submit.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

import { JS_LINES, JS_NUMS, JS_STDIN } from "./prelude";

const base = {
  track: "javascript",
  language: "javascript",
  execution: "browser",
  timeLimitMs: 5000,
} as const satisfies Partial<SeedProblem>;

export const javascriptProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...base,
    slug: "js-sum-of-a-line",
    title: "Sum of a line of numbers",
    level: "beginner",
    isInterview: false,
    statement: [
      "One line of input holds whole numbers separated by spaces. Print their total.",
      "",
      "Numbers may be negative. There is always at least one number.",
      "",
      "```",
      "input:  3 4 5",
      "output: 12",
      "```",
    ].join("\n"),
    hints: [
      "`stdin.trim().split(/\\s+/)` gives you the pieces as strings; `Number(piece)` turns one into a number.",
      "`reduce` accumulates a running total, but a plain `for` loop is just as good here.",
    ],
    tags: ["parsing", "loops"],
    starterCode: `${JS_NUMS}

// TODO: print the total of nums
`,
    referenceSolution: `${JS_NUMS}

let total = 0;
for (const n of nums) total += n;
console.log(total);
`,
    tests: [
      { name: "example from the statement", input: "3 4 5", expectedOutput: "12", hidden: false },
      { name: "negatives cancel out", input: "-2 2", expectedOutput: "0", hidden: false },
      { name: "a single number", input: "7", expectedOutput: "7", hidden: true },
      { name: "ten numbers", input: "1 2 3 4 5 6 7 8 9 10", expectedOutput: "55", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-count-vowels",
    title: "Count the vowels",
    level: "beginner",
    isInterview: false,
    statement: [
      "One line of text is given. Print how many of its characters are vowels.",
      "",
      "Count `a`, `e`, `i`, `o` and `u` in either case. `y` is not a vowel here.",
      "",
      "```",
      "input:  Hello World",
      "output: 3",
      "```",
    ].join("\n"),
    hints: [
      "Lower-case the whole line first, then you only have five characters to check.",
      "`\"aeiou\".includes(ch)` is a shorter test than five comparisons joined by `||`.",
    ],
    tags: ["strings", "counting"],
    starterCode: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "");

// TODO: print how many characters of text are vowels
`,
    referenceSolution: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "");

let count = 0;
for (const ch of text.toLowerCase()) {
  if ("aeiou".includes(ch)) count += 1;
}
console.log(count);
`,
    tests: [
      { name: "example from the statement", input: "Hello World", expectedOutput: "3", hidden: false },
      { name: "all five, upper case", input: "AEIOU", expectedOutput: "5", hidden: false },
      { name: "a word with none", input: "rhythm", expectedOutput: "0", hidden: true },
      { name: "repeats and a space", input: "Queens Hub", expectedOutput: "4", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-divisible-report",
    title: "Divisibility report",
    level: "beginner",
    isInterview: false,
    statement: [
      "A single whole number `n` is given. Print one line for each value from 1 to `n`:",
      "",
      "- `both` when the value divides by 3 and by 5;",
      "- `three` when it divides by 3 only;",
      "- `five` when it divides by 5 only;",
      "- otherwise the value itself.",
      "",
      "```",
      "input:  5",
      "output: 1",
      "        2",
      "        three",
      "        4",
      "        five",
      "```",
    ].join("\n"),
    hints: [
      "Test the `both` case FIRST. If you check divisibility by 3 first, 15 never reaches the combined branch.",
      "`i % 3 === 0` asks whether i divides exactly by 3.",
    ],
    tags: ["loops", "conditionals"],
    starterCode: `${JS_NUMS}
const n = nums[0];

// TODO: print one line per value from 1 to n
`,
    referenceSolution: `${JS_NUMS}
const n = nums[0];

const out = [];
for (let i = 1; i <= n; i += 1) {
  if (i % 15 === 0) out.push("both");
  else if (i % 3 === 0) out.push("three");
  else if (i % 5 === 0) out.push("five");
  else out.push(String(i));
}
console.log(out.join("\\n"));
`,
    tests: [
      { name: "example from the statement", input: "5", expectedOutput: "1\n2\nthree\n4\nfive", hidden: false },
      { name: "stops at three", input: "3", expectedOutput: "1\n2\nthree", hidden: false },
      { name: "reaches the combined case", input: "15", expectedOutput: "1\n2\nthree\n4\nfive\nthree\n7\n8\nthree\nfive\n11\nthree\n13\n14\nboth", hidden: true },
      { name: "smallest input", input: "1", expectedOutput: "1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-largest-gap",
    title: "Largest gap between neighbours",
    level: "beginner",
    isInterview: true,
    statement: [
      "One line holds whole numbers in any order. Sort them ascending and print the",
      "largest difference between two values that end up next to each other.",
      "",
      "Print `0` when fewer than two numbers are given.",
      "",
      "```",
      "input:  1 5 3 19 18",
      "output: 13",
      "```",
      "",
      "The sorted order is 1, 3, 5, 18, 19, so the gaps are 2, 2, 13 and 1.",
    ].join("\n"),
    hints: [
      "`sort()` compares as TEXT by default, so `[10, 9]` sorts to `[10, 9]`. Pass `(a, b) => a - b`.",
      "One pass after sorting is enough — you never need to compare non-neighbours.",
    ],
    tags: ["sorting", "arrays"],
    starterCode: `${JS_NUMS}

// TODO: sort ascending, then print the largest gap between neighbours
`,
    referenceSolution: `${JS_NUMS}

const sorted = [...nums].sort((a, b) => a - b);
let best = 0;
for (let i = 1; i < sorted.length; i += 1) {
  const gap = sorted[i] - sorted[i - 1];
  if (gap > best) best = gap;
}
console.log(best);
`,
    tests: [
      { name: "example from the statement", input: "1 5 3 19 18", expectedOutput: "13", hidden: false },
      { name: "a single value has no gap", input: "4", expectedOutput: "0", hidden: false },
      { name: "negatives sort before positives", input: "-5 -1 7", expectedOutput: "8", hidden: true },
      { name: "all equal", input: "2 2 2", expectedOutput: "0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-first-unique-character",
    title: "First character that appears once",
    level: "beginner",
    isInterview: true,
    statement: [
      "One line of text is given. Print the zero-based position of the first character",
      "that appears exactly once in the whole line. Print `-1` when every character",
      "repeats.",
      "",
      "```",
      "input:  swiss",
      "output: 1",
      "```",
      "",
      "`s` appears three times, so the answer is `w` at position 1.",
    ].join("\n"),
    hints: [
      "Two passes beat one: count every character first, then walk the line again looking for a count of 1.",
      "A `Map` keyed by character is the counting structure; `map.get(ch) ?? 0` handles the first sighting.",
    ],
    tags: ["hash-map", "strings"],
    starterCode: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "");

// TODO: print the index of the first character that appears exactly once, or -1
`,
    referenceSolution: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "");

const counts = new Map();
for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);

let answer = -1;
for (let i = 0; i < text.length; i += 1) {
  if (counts.get(text[i]) === 1) {
    answer = i;
    break;
  }
}
console.log(answer);
`,
    tests: [
      { name: "example from the statement", input: "swiss", expectedOutput: "1", hidden: false },
      { name: "everything repeats", input: "aabb", expectedOutput: "-1", hidden: false },
      { name: "the answer is in the middle", input: "abcabd", expectedOutput: "2", hidden: true },
      { name: "one character", input: "z", expectedOutput: "0", hidden: true },
    ],
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...base,
    slug: "js-window-max-sum",
    title: "Best window of k values",
    level: "intermediate",
    isInterview: false,
    statement: [
      "The first line holds `k`. The second line holds whole numbers.",
      "",
      "Print the largest total you can get from `k` values that sit next to each other.",
      "Print `0` when there are fewer than `k` numbers.",
      "",
      "```",
      "input:  2",
      "        1 2 3 4",
      "output: 7",
      "```",
    ].join("\n"),
    hints: [
      "Recomputing each window costs k additions per position. Slide instead: add the value entering, subtract the one leaving.",
      "Start `best` from the FIRST window's total, not from 0 — every window can be negative.",
    ],
    tags: ["sliding-window", "arrays"],
    starterCode: `${JS_LINES}
const k = Number(lines[0]);
const nums = (lines[1] ?? "").trim().split(/\\s+/).filter(Boolean).map(Number);

// TODO: print the largest sum of k neighbouring values
`,
    referenceSolution: `${JS_LINES}
const k = Number(lines[0]);
const nums = (lines[1] ?? "").trim().split(/\\s+/).filter(Boolean).map(Number);

if (nums.length < k) {
  console.log(0);
} else {
  let window = 0;
  for (let i = 0; i < k; i += 1) window += nums[i];
  let best = window;
  for (let i = k; i < nums.length; i += 1) {
    window += nums[i] - nums[i - k];
    if (window > best) best = window;
  }
  console.log(best);
}
`,
    tests: [
      { name: "example from the statement", input: "2\n1 2 3 4", expectedOutput: "7", hidden: false },
      { name: "a dip in the middle", input: "3\n5 -1 5 -1 5", expectedOutput: "9", hidden: false },
      { name: "every value is negative", input: "1\n-4 -9", expectedOutput: "-4", hidden: true },
      { name: "k is larger than the input", input: "5\n1 2", expectedOutput: "0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-group-by-length",
    title: "Group words by length",
    level: "intermediate",
    isInterview: false,
    statement: [
      "One line holds words separated by spaces. Group them by length and print one",
      "line per length, shortest first, in the form `length: word,word`.",
      "",
      "Within a group keep the order the words appeared in.",
      "",
      "```",
      "input:  hi you are ok",
      "output: 2: hi,ok",
      "        3: you,are",
      "```",
    ].join("\n"),
    hints: [
      "A `Map` from length to an array of words builds the groups in one pass.",
      "`Map` keeps insertion order, not numeric order — sort the keys before printing.",
    ],
    tags: ["hash-map", "strings"],
    starterCode: `${JS_STDIN}
const words = stdin.trim().split(/\\s+/).filter(Boolean);

// TODO: print one line per distinct length, shortest first
`,
    referenceSolution: `${JS_STDIN}
const words = stdin.trim().split(/\\s+/).filter(Boolean);

const groups = new Map();
for (const word of words) {
  const list = groups.get(word.length);
  if (list) list.push(word);
  else groups.set(word.length, [word]);
}

const lengths = [...groups.keys()].sort((a, b) => a - b);
console.log(lengths.map((len) => len + ": " + groups.get(len).join(",")).join("\\n"));
`,
    tests: [
      { name: "example from the statement", input: "hi you are ok", expectedOutput: "2: hi,ok\n3: you,are", hidden: false },
      { name: "two groups of one", input: "a bb", expectedOutput: "1: a\n2: bb", hidden: false },
      { name: "one group of three", input: "same size here", expectedOutput: "4: same,size,here", hidden: true },
      { name: "a single word", input: "x", expectedOutput: "1: x", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-balanced-brackets",
    title: "Find the unbalanced bracket",
    level: "intermediate",
    isInterview: false,
    statement: [
      "One line contains only the characters `(`, `)`, `[`, `]`, `{` and `}`.",
      "",
      "Print `balanced` when every bracket is closed by its own kind in the right order.",
      "Otherwise print the zero-based position of the first bracket that breaks the",
      "rule — a closer that does not match the most recent opener, or the earliest",
      "opener still left unclosed at the end of the line.",
      "",
      "```",
      "input:  ([)]",
      "output: 2",
      "```",
    ].join("\n"),
    hints: [
      "Push the POSITION of each opener, not the character. You need it to report an unclosed one.",
      "At the end of the line the stack holds every unclosed opener; the earliest is at the bottom.",
    ],
    tags: ["stack", "strings"],
    starterCode: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "").trim();

// TODO: print "balanced", or the index of the first offending bracket
`,
    referenceSolution: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "").trim();

const pairs = { ")": "(", "]": "[", "}": "{" };
const stack = [];
let bad = -1;

for (let i = 0; i < text.length && bad === -1; i += 1) {
  const ch = text[i];
  if (ch === "(" || ch === "[" || ch === "{") {
    stack.push({ ch, i });
  } else if (pairs[ch]) {
    const top = stack.pop();
    if (!top || top.ch !== pairs[ch]) bad = i;
  }
}

if (bad === -1 && stack.length > 0) bad = stack[0].i;
console.log(bad === -1 ? "balanced" : String(bad));
`,
    tests: [
      { name: "nested and balanced", input: "([]{})", expectedOutput: "balanced", hidden: false },
      { name: "example from the statement", input: "([)]", expectedOutput: "2", hidden: false },
      { name: "an opener left unclosed", input: "(", expectedOutput: "0", hidden: true },
      { name: "a closer with nothing open", input: "]", expectedOutput: "0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-two-pointer-pair",
    title: "Pair that reaches the target",
    level: "intermediate",
    isInterview: true,
    statement: [
      "The first line holds a target. The second line holds whole numbers already",
      "sorted ascending.",
      "",
      "Print the two values that add up to the target, smaller one first, separated by",
      "a space. When several pairs work, print the one whose smaller value is smallest.",
      "Print `none` when no pair adds up to the target.",
      "",
      "```",
      "input:  9",
      "        1 2 4 5 7",
      "output: 2 7",
      "```",
    ].join("\n"),
    hints: [
      "The input is already sorted, so you do not need a hash map. Start one index at each end.",
      "If the current total is too small, move the LEFT index right; if it is too large, move the right index left.",
    ],
    tags: ["two-pointer", "arrays"],
    starterCode: `${JS_LINES}
const target = Number(lines[0]);
const nums = (lines[1] ?? "").trim().split(/\\s+/).filter(Boolean).map(Number);

// TODO: print the pair summing to target, or "none"
`,
    referenceSolution: `${JS_LINES}
const target = Number(lines[0]);
const nums = (lines[1] ?? "").trim().split(/\\s+/).filter(Boolean).map(Number);

let left = 0;
let right = nums.length - 1;
let answer = "none";

while (left < right) {
  const total = nums[left] + nums[right];
  if (total === target) {
    answer = nums[left] + " " + nums[right];
    break;
  }
  if (total < target) left += 1;
  else right -= 1;
}

console.log(answer);
`,
    tests: [
      { name: "example from the statement", input: "9\n1 2 4 5 7", expectedOutput: "2 7", hidden: false },
      { name: "no pair works", input: "100\n1 2", expectedOutput: "none", hidden: false },
      { name: "negatives either side of zero", input: "0\n-3 -1 1 3", expectedOutput: "-3 3", hidden: true },
      { name: "repeated values", input: "2\n1 1 1", expectedOutput: "1 1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-merge-intervals",
    title: "Merge overlapping ranges",
    level: "intermediate",
    isInterview: true,
    statement: [
      "Each line holds a range as two whole numbers, `start end`, with `start <= end`.",
      "",
      "Merge every pair of ranges that overlap and print the result, one range per",
      "line, ordered by start. Ranges that only touch at a boundary — `1 2` and `3 4` —",
      "do NOT overlap.",
      "",
      "```",
      "input:  20 24",
      "        2 5",
      "        4 9",
      "output: 2 9",
      "        20 24",
      "```",
    ].join("\n"),
    hints: [
      "Sort by start first. After that you only ever compare a range with the one you are currently building.",
      "Extend the open range when the next start is at most the current end; otherwise close it and open a new one.",
    ],
    tags: ["sorting", "intervals"],
    starterCode: `${JS_LINES}
const ranges = lines
  .filter((line) => line.trim() !== "")
  .map((line) => line.trim().split(/\\s+/).map(Number));

// TODO: print the merged ranges, one per line
`,
    referenceSolution: `${JS_LINES}
const ranges = lines
  .filter((line) => line.trim() !== "")
  .map((line) => line.trim().split(/\\s+/).map(Number));

ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const merged = [];
for (const [start, end] of ranges) {
  const last = merged[merged.length - 1];
  if (last && start <= last[1]) {
    if (end > last[1]) last[1] = end;
  } else {
    merged.push([start, end]);
  }
}

console.log(merged.map(([s, e]) => s + " " + e).join("\\n"));
`,
    tests: [
      { name: "example from the statement", input: "20 24\n2 5\n4 9", expectedOutput: "2 9\n20 24", hidden: false },
      { name: "a single point", input: "5 5", expectedOutput: "5 5", hidden: false },
      { name: "touching but not overlapping, out of order", input: "3 4\n1 2", expectedOutput: "1 2\n3 4", hidden: true },
      { name: "one range swallows another", input: "1 4\n2 3", expectedOutput: "1 4", hidden: true },
    ],
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "js-lru-hit-rate",
    title: "Cache hits under a least-recently-used policy",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds the cache capacity. The second line holds the keys that",
      "are requested, in order, separated by spaces.",
      "",
      "A request for a key already held is a hit and makes that key the most recently",
      "used. A request for a key not held is a miss: the key is added, and if the cache",
      "is full the least recently used key is dropped first.",
      "",
      "Print `hits misses`.",
      "",
      "```",
      "input:  2",
      "        a b a c b",
      "output: 1 4",
      "```",
    ].join("\n"),
    hints: [
      "A JavaScript `Map` iterates in insertion order, so `map.keys().next().value` is the oldest entry.",
      "On a hit, delete the key and set it again — that moves it to the end of the insertion order.",
    ],
    tags: ["cache", "hash-map", "simulation"],
    starterCode: `${JS_LINES}
const capacity = Number(lines[0]);
const keys = (lines[1] ?? "").trim().split(/\\s+/).filter(Boolean);

// TODO: simulate the cache and print "hits misses"
`,
    referenceSolution: `${JS_LINES}
const capacity = Number(lines[0]);
const keys = (lines[1] ?? "").trim().split(/\\s+/).filter(Boolean);

const cache = new Map();
let hits = 0;
let misses = 0;

for (const key of keys) {
  if (cache.has(key)) {
    hits += 1;
    cache.delete(key);
    cache.set(key, true);
  } else {
    misses += 1;
    if (cache.size >= capacity) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, true);
  }
}

console.log(hits + " " + misses);
`,
    tests: [
      { name: "example from the statement", input: "2\na b a c b", expectedOutput: "1 4", hidden: false },
      { name: "capacity of one", input: "1\nx x x", expectedOutput: "2 1", hidden: false },
      { name: "everything fits, second pass all hits", input: "3\n1 2 3 1 2 3", expectedOutput: "3 3", hidden: true },
      { name: "one request", input: "2\nq", expectedOutput: "0 1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-topological-order",
    title: "Order tasks by their prerequisites",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds `n`: the tasks are numbered 1 to `n`. Each remaining line",
      "holds `a b`, meaning task `a` must run before task `b`.",
      "",
      "Print an order that satisfies every constraint, space-separated. When several",
      "orders work, always take the smallest-numbered task that is currently ready.",
      "Print `cycle` when no order exists.",
      "",
      "```",
      "input:  3",
      "        1 2",
      "        2 3",
      "output: 1 2 3",
      "```",
    ].join("\n"),
    hints: [
      "Count how many prerequisites each task still has. A task is ready when that count reaches zero.",
      "Keeping the ready set sorted is what makes the output deterministic — and if you finish with tasks left over, those tasks are in a cycle.",
    ],
    tags: ["graphs", "topological-sort"],
    starterCode: `${JS_LINES}
const n = Number(lines[0]);
const edges = lines
  .slice(1)
  .filter((line) => line.trim() !== "")
  .map((line) => line.trim().split(/\\s+/).map(Number));

// TODO: print a valid order, or "cycle"
`,
    referenceSolution: `${JS_LINES}
const n = Number(lines[0]);
const edges = lines
  .slice(1)
  .filter((line) => line.trim() !== "")
  .map((line) => line.trim().split(/\\s+/).map(Number));

const after = new Map();
const remaining = new Map();
for (let i = 1; i <= n; i += 1) {
  after.set(i, []);
  remaining.set(i, 0);
}
for (const [a, b] of edges) {
  after.get(a).push(b);
  remaining.set(b, remaining.get(b) + 1);
}

const ready = [];
for (let i = 1; i <= n; i += 1) if (remaining.get(i) === 0) ready.push(i);

const order = [];
while (ready.length > 0) {
  ready.sort((a, b) => a - b);
  const task = ready.shift();
  order.push(task);
  for (const next of after.get(task)) {
    remaining.set(next, remaining.get(next) - 1);
    if (remaining.get(next) === 0) ready.push(next);
  }
}

console.log(order.length === n ? order.join(" ") : "cycle");
`,
    tests: [
      { name: "example from the statement", input: "3\n1 2\n2 3", expectedOutput: "1 2 3", hidden: false },
      { name: "the constraint reverses the numbering", input: "2\n2 1", expectedOutput: "2 1", hidden: false },
      { name: "two tasks waiting on each other", input: "2\n1 2\n2 1", expectedOutput: "cycle", hidden: true },
      { name: "unconstrained tasks come out in order", input: "4\n3 4", expectedOutput: "1 2 3 4", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-grid-paths-memo",
    title: "Count paths across a blocked grid",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds `rows cols`. Each of the next `rows` lines is a string of",
      "`0` and `1` characters, where `1` marks a blocked cell.",
      "",
      "Starting at the top-left cell and moving only right or down, print how many",
      "distinct paths reach the bottom-right cell. Print `0` when none do.",
      "",
      "```",
      "input:  3 4",
      "        0000",
      "        0010",
      "        0000",
      "output: 4",
      "```",
    ].join("\n"),
    hints: [
      "The number of paths to a cell is the paths to the cell above plus the paths to the cell on its left.",
      "A blocked cell has zero paths through it, and so does a grid whose start or finish is blocked.",
    ],
    tags: ["dynamic-programming", "memoisation", "grids"],
    starterCode: `${JS_LINES}
const [rows, cols] = lines[0].trim().split(/\\s+/).map(Number);
const grid = lines.slice(1, 1 + rows).map((line) => line.trim());

// TODO: print the number of right/down paths from the top-left to the bottom-right
`,
    referenceSolution: `${JS_LINES}
const [rows, cols] = lines[0].trim().split(/\\s+/).map(Number);
const grid = lines.slice(1, 1 + rows).map((line) => line.trim());

const memo = new Map();

function paths(r, c) {
  if (r < 0 || c < 0) return 0;
  if (grid[r][c] === "1") return 0;
  if (r === 0 && c === 0) return 1;
  const key = r + "," + c;
  if (memo.has(key)) return memo.get(key);
  const total = paths(r - 1, c) + paths(r, c - 1);
  memo.set(key, total);
  return total;
}

console.log(paths(rows - 1, cols - 1));
`,
    tests: [
      { name: "example from the statement", input: "3 4\n0000\n0010\n0000", expectedOutput: "4", hidden: false },
      { name: "an open two-by-two grid", input: "2 2\n00\n00", expectedOutput: "2", hidden: false },
      { name: "a single open cell", input: "1 1\n0", expectedOutput: "1", hidden: true },
      { name: "both routes blocked", input: "2 2\n01\n10", expectedOutput: "0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-longest-distinct-run",
    title: "Longest run with no repeats",
    level: "advanced",
    isInterview: true,
    statement: [
      "One line of text is given. Print the length of the longest stretch of",
      "neighbouring characters in which no character appears twice.",
      "",
      "```",
      "input:  greenhouse",
      "output: 6",
      "```",
    ].join("\n"),
    hints: [
      "Keep a window and the position each character was last seen at. When you meet a repeat, the window's left edge jumps past that position.",
      "The left edge must never move BACKWARDS — take the maximum of its current value and the position after the repeat.",
    ],
    tags: ["sliding-window", "hash-map", "strings"],
    starterCode: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "");

// TODO: print the length of the longest repeat-free stretch
`,
    referenceSolution: `${JS_STDIN}
const text = stdin.replace(/\\n$/, "");

const lastSeen = new Map();
let left = 0;
let best = 0;

for (let right = 0; right < text.length; right += 1) {
  const ch = text[right];
  const seen = lastSeen.get(ch);
  if (seen !== undefined && seen >= left) left = seen + 1;
  lastSeen.set(ch, right);
  const width = right - left + 1;
  if (width > best) best = width;
}

console.log(best);
`,
    tests: [
      { name: "example from the statement", input: "greenhouse", expectedOutput: "6", hidden: false },
      { name: "one character repeated", input: "bbbb", expectedOutput: "1", hidden: false },
      { name: "the best window is not at the start", input: "ppthinker", expectedOutput: "8", hidden: true },
      { name: "no repeats at all", input: "abcdef", expectedOutput: "6", hidden: true },
    ],
  },
  {
    ...base,
    slug: "js-shortest-covering-window",
    title: "Shortest window covering a requirement",
    level: "advanced",
    isInterview: true,
    statement: [
      "The first line is the text. The second line lists the characters that must be",
      "covered, including repeats: `aab` means two `a`s and one `b`.",
      "",
      "Print the shortest stretch of neighbouring characters in the text that contains",
      "every required character at least as many times as required. When two answers",
      "have the same length print the one that starts earlier. Print `none` when no",
      "such stretch exists.",
      "",
      "```",
      "input:  saltwaterlagoon",
      "        goal",
      "output: lago",
      "```",
    ].join("\n"),
    hints: [
      "Track how many required characters are still MISSING as one number. The window is valid the moment that number reaches zero.",
      "Grow the window on the right until it is valid, then shrink from the left while it stays valid. Each index moves at most once in each direction.",
    ],
    tags: ["sliding-window", "hash-map", "strings"],
    starterCode: `${JS_LINES}
const text = lines[0] ?? "";
const required = lines[1] ?? "";

// TODO: print the shortest covering stretch, or "none"
`,
    referenceSolution: `${JS_LINES}
const text = lines[0] ?? "";
const required = lines[1] ?? "";

const need = new Map();
for (const ch of required) need.set(ch, (need.get(ch) ?? 0) + 1);
let missing = required.length;

const have = new Map();
let bestStart = -1;
let bestLength = Infinity;
let left = 0;

for (let right = 0; right < text.length; right += 1) {
  const ch = text[right];
  if (need.has(ch)) {
    const seen = (have.get(ch) ?? 0) + 1;
    have.set(ch, seen);
    if (seen <= need.get(ch)) missing -= 1;
  }

  while (missing === 0) {
    if (right - left + 1 < bestLength) {
      bestLength = right - left + 1;
      bestStart = left;
    }
    const out = text[left];
    if (need.has(out)) {
      const seen = have.get(out) - 1;
      have.set(out, seen);
      if (seen < need.get(out)) missing += 1;
    }
    left += 1;
  }
}

console.log(bestStart === -1 ? "none" : text.slice(bestStart, bestStart + bestLength));
`,
    tests: [
      { name: "example from the statement", input: "saltwaterlagoon\ngoal", expectedOutput: "lago", hidden: false },
      { name: "the whole text is the answer", input: "aa\naa", expectedOutput: "aa", hidden: false },
      { name: "not enough copies to cover", input: "a\naa", expectedOutput: "none", hidden: true },
      { name: "order of the requirement does not matter", input: "abc\ncba", expectedOutput: "abc", hidden: true },
    ],
  },
];
