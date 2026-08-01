// =============================================================================
// PYTHON TRACK — seed data. Owner: coding-problems stream.
// ORIGINAL PROSE ONLY. See index.ts for the rule and the reasoning.
// -----------------------------------------------------------------------------
// Runs in the browser through Pyodide and is graded on the server through Piston.
// `sys.stdin.read()` satisfies both (see prelude.ts), so the same program text
// works either side of the Run/Submit boundary.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

import { PY_LINES, PY_NUMS, PY_STDIN } from "./prelude";

const base = {
  track: "python",
  language: "python",
  execution: "browser",
  timeLimitMs: 6000,
} as const satisfies Partial<SeedProblem>;

export const pythonProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...base,
    slug: "py-average-of-a-line",
    title: "Average of a line of numbers",
    level: "beginner",
    isInterview: false,
    statement: [
      "One line holds whole numbers separated by spaces. Print their average, rounded",
      "to two decimal places.",
      "",
      "```",
      "input:  1 2 3 4",
      "output: 2.50",
      "```",
    ].join("\n"),
    hints: [
      "`sum(nums) / len(nums)` gives a float even when the division is exact.",
      "`f\"{value:.2f}\"` formats to exactly two decimal places, padding with a zero when needed.",
    ],
    tags: ["parsing", "formatting"],
    starterCode: `${PY_NUMS}

# TODO: print the average of nums with two decimal places
`,
    referenceSolution: `${PY_NUMS}

average = sum(nums) / len(nums)
print(f"{average:.2f}")
`,
    tests: [
      { name: "example from the statement", input: "1 2 3 4", expectedOutput: "2.50", hidden: false },
      { name: "an exact whole number still shows two places", input: "4 4", expectedOutput: "4.00", hidden: false },
      { name: "a negative average", input: "-3 -4", expectedOutput: "-3.50", hidden: true },
      { name: "one number", input: "9", expectedOutput: "9.00", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-word-frequency",
    title: "Most frequent word",
    level: "beginner",
    isInterview: false,
    statement: [
      "One line holds words separated by spaces. Print the word that appears most",
      "often, then a space, then how many times it appeared.",
      "",
      "When two words tie, print whichever came first in the line.",
      "",
      "```",
      "input:  red blue red green red blue",
      "output: red 3",
      "```",
    ].join("\n"),
    hints: [
      "A plain `dict` counts fine: `counts[word] = counts.get(word, 0) + 1`.",
      "Walking the words in order and keeping the best-so-far handles the tie rule without any extra work.",
    ],
    tags: ["hash-map", "counting"],
    starterCode: `${PY_STDIN}

words = stdin.split()

# TODO: print the most frequent word and its count
`,
    referenceSolution: `${PY_STDIN}

words = stdin.split()

counts = {}
for word in words:
    counts[word] = counts.get(word, 0) + 1

best_word = words[0]
best_count = counts[best_word]
for word in words:
    if counts[word] > best_count:
        best_word = word
        best_count = counts[word]

print(best_word, best_count)
`,
    tests: [
      { name: "example from the statement", input: "red blue red green red blue", expectedOutput: "red 3", hidden: false },
      { name: "a tie goes to the earlier word", input: "b a a b", expectedOutput: "b 2", hidden: false },
      { name: "every word is different", input: "one two three", expectedOutput: "one 1", hidden: true },
      { name: "a single word", input: "solo", expectedOutput: "solo 1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-reverse-words",
    title: "Reverse the word order",
    level: "beginner",
    isInterview: false,
    statement: [
      "One line holds words separated by one or more spaces. Print the words in the",
      "opposite order, separated by exactly one space each.",
      "",
      "```",
      "input:  the quick brown fox",
      "output: fox brown quick the",
      "```",
    ].join("\n"),
    hints: [
      "`split()` with no argument collapses runs of whitespace for you, which is why the extra spaces do not need special handling.",
      "`\" \".join(reversed(words))` builds the answer without a loop.",
    ],
    tags: ["strings", "lists"],
    starterCode: `${PY_STDIN}

words = stdin.split()

# TODO: print the words in reverse order, single-spaced
`,
    referenceSolution: `${PY_STDIN}

words = stdin.split()
print(" ".join(reversed(words)))
`,
    tests: [
      { name: "example from the statement", input: "the quick brown fox", expectedOutput: "fox brown quick the", hidden: false },
      { name: "extra spaces collapse", input: "a   b", expectedOutput: "b a", hidden: false },
      { name: "one word is its own reverse", input: "alone", expectedOutput: "alone", hidden: true },
      { name: "punctuation travels with its word", input: "hi, there!", expectedOutput: "there! hi,", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-run-length-encode",
    title: "Compress repeated characters",
    level: "beginner",
    isInterview: true,
    statement: [
      "One line of text is given. Replace every run of the same character with that",
      "character followed by the run's length, and print the result.",
      "",
      "Runs of length one keep their `1`.",
      "",
      "```",
      "input:  aaabbc",
      "output: a3b2c1",
      "```",
    ].join("\n"),
    hints: [
      "Walk the text once, holding the current character and how many times you have seen it in a row.",
      "The last run has no following character to trigger the flush — write it out after the loop ends.",
    ],
    tags: ["strings", "two-pointer"],
    starterCode: `${PY_STDIN}

text = stdin.rstrip("\\n")

# TODO: print the run-length encoding of text
`,
    referenceSolution: `${PY_STDIN}

text = stdin.rstrip("\\n")

parts = []
index = 0
while index < len(text):
    end = index
    while end < len(text) and text[end] == text[index]:
        end += 1
    parts.append(text[index] + str(end - index))
    index = end

print("".join(parts))
`,
    tests: [
      { name: "example from the statement", input: "aaabbc", expectedOutput: "a3b2c1", hidden: false },
      { name: "no repeats", input: "abc", expectedOutput: "a1b1c1", hidden: false },
      { name: "one long run", input: "zzzzz", expectedOutput: "z5", hidden: true },
      { name: "the same character returns later", input: "aabaa", expectedOutput: "a2b1a2", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-balanced-split",
    title: "Split a line into equal halves",
    level: "beginner",
    isInterview: true,
    statement: [
      "One line holds whole numbers separated by spaces. Print the position at which",
      "you can cut the line so both sides have the same total, or `-1` when no such",
      "position exists.",
      "",
      "The position is the number of values on the LEFT of the cut. A cut of 0 leaves",
      "the left side empty, which totals zero.",
      "",
      "```",
      "input:  1 2 3 3 3",
      "output: 3",
      "```",
      "",
      "The first three values total 6, and so do the last two.",
    ].join("\n"),
    hints: [
      "Compute the whole total once, then walk the values keeping a running left-hand total. The right-hand total is the difference.",
      "Report the SMALLEST position that works, and remember 0 is a valid cut when every value is zero.",
    ],
    tags: ["prefix-sum", "arrays"],
    starterCode: `${PY_NUMS}

# TODO: print the smallest cut position with equal totals either side, or -1
`,
    referenceSolution: `${PY_NUMS}

total = sum(nums)
left = 0
answer = -1
for cut in range(len(nums) + 1):
    if cut > 0:
        left += nums[cut - 1]
    if left * 2 == total:
        answer = cut
        break

print(answer)
`,
    tests: [
      { name: "example from the statement", input: "1 2 3 3 3", expectedOutput: "3", hidden: false },
      { name: "no cut balances", input: "1 2", expectedOutput: "-1", hidden: false },
      { name: "zeros balance at the very first cut", input: "0 0", expectedOutput: "0", hidden: true },
      { name: "negatives can balance too", input: "2 -2 4 4", expectedOutput: "3", hidden: true },
    ],
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...base,
    slug: "py-anagram-groups",
    title: "Group the anagrams",
    level: "intermediate",
    isInterview: false,
    statement: [
      "One line holds words separated by spaces. Group words that are rearrangements",
      "of the same letters, and print one line per group: the words separated by",
      "commas, in the order they appeared.",
      "",
      "Order the groups by their first word's position in the input.",
      "",
      "```",
      "input:  stream spare master cider pears tamers",
      "output: stream,master,tamers",
      "        spare,pears",
      "        cider",
      "```",
    ].join("\n"),
    hints: [
      "Two words are anagrams exactly when their sorted letters match, so the sorted string is the group key.",
      "A `dict` preserves insertion order in modern Python, which is what keeps the groups in first-appearance order.",
    ],
    tags: ["hash-map", "sorting", "strings"],
    starterCode: `${PY_STDIN}

words = stdin.split()

# TODO: print one line per anagram group
`,
    referenceSolution: `${PY_STDIN}

words = stdin.split()

groups = {}
for word in words:
    key = "".join(sorted(word))
    groups.setdefault(key, []).append(word)

for members in groups.values():
    print(",".join(members))
`,
    tests: [
      {
        name: "example from the statement",
        input: "stream spare master cider pears tamers",
        expectedOutput: "stream,master,tamers\nspare,pears\ncider",
        hidden: false,
      },
      { name: "nothing groups", input: "ab cd", expectedOutput: "ab\ncd", hidden: false },
      { name: "everything groups", input: "abc bca cab", expectedOutput: "abc,bca,cab", hidden: true },
      { name: "duplicates stay in the same group", input: "aa aa", expectedOutput: "aa,aa", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-matrix-transpose",
    title: "Transpose a grid of numbers",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Each line holds a row of whole numbers separated by spaces. Every row has the",
      "same length.",
      "",
      "Print the grid with rows and columns swapped: the first output line is the first",
      "value of every input row, and so on.",
      "",
      "```",
      "input:  1 2 3",
      "        4 5 6",
      "output: 1 4",
      "        2 5",
      "        3 6",
      "```",
    ].join("\n"),
    hints: [
      "`zip(*rows)` hands you the columns one at a time. The `*` spreads the list of rows into separate arguments.",
      "Each item `zip` yields is a tuple of numbers; join their string forms with a space.",
    ],
    tags: ["lists", "iteration"],
    starterCode: `${PY_LINES}

rows = [[int(part) for part in line.split()] for line in lines if line.strip()]

# TODO: print the transposed grid
`,
    referenceSolution: `${PY_LINES}

rows = [[int(part) for part in line.split()] for line in lines if line.strip()]

for column in zip(*rows):
    print(" ".join(str(value) for value in column))
`,
    tests: [
      { name: "example from the statement", input: "1 2 3\n4 5 6", expectedOutput: "1 4\n2 5\n3 6", hidden: false },
      { name: "a single row becomes a column", input: "7 8", expectedOutput: "7\n8", hidden: false },
      { name: "a square grid", input: "1 2\n3 4", expectedOutput: "1 3\n2 4", hidden: true },
      { name: "one value", input: "5", expectedOutput: "5", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-longest-common-prefix",
    title: "Longest shared opening",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Each line holds one word. Print the longest opening sequence of characters that",
      "every word shares. Print `none` when they share nothing.",
      "",
      "```",
      "input:  flowchart",
      "        flowing",
      "        flown",
      "output: flow",
      "```",
    ].join("\n"),
    hints: [
      "The answer can never be longer than the shortest word, so that word is a safe starting candidate.",
      "Shrink the candidate until every word starts with it — `word.startswith(candidate)` is the test.",
    ],
    tags: ["strings", "iteration"],
    starterCode: `${PY_LINES}

words = [line.strip() for line in lines if line.strip()]

# TODO: print the longest shared opening, or "none"
`,
    referenceSolution: `${PY_LINES}

words = [line.strip() for line in lines if line.strip()]

candidate = min(words, key=len)
while candidate and not all(word.startswith(candidate) for word in words):
    candidate = candidate[:-1]

print(candidate if candidate else "none")
`,
    tests: [
      { name: "example from the statement", input: "flowchart\nflowing\nflown", expectedOutput: "flow", hidden: false },
      { name: "nothing in common", input: "apple\nbanana", expectedOutput: "none", hidden: false },
      { name: "one word is the whole prefix", input: "go\ngoing\ngone", expectedOutput: "go", hidden: true },
      { name: "a single word is its own prefix", input: "only", expectedOutput: "only", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-rotate-list",
    title: "Rotate a list in place",
    level: "intermediate",
    isInterview: true,
    statement: [
      "The first line holds `k`. The second line holds whole numbers.",
      "",
      "Move every value `k` places to the right, wrapping values that fall off the end",
      "back to the front, and print the result separated by spaces.",
      "",
      "`k` can be larger than the list and can be negative, which rotates left.",
      "",
      "```",
      "input:  2",
      "        1 2 3 4 5",
      "output: 4 5 1 2 3",
      "```",
    ].join("\n"),
    hints: [
      "Reduce `k` with the remainder operator first: rotating a list of 5 by 7 is the same as rotating it by 2.",
      "Python's `%` returns a non-negative result for a positive divisor, so a negative `k` is handled by the same line.",
    ],
    tags: ["arrays", "modular-arithmetic"],
    starterCode: `${PY_LINES}

k = int(lines[0])
nums = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

# TODO: print nums rotated right by k
`,
    referenceSolution: `${PY_LINES}

k = int(lines[0])
nums = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

if nums:
    shift = k % len(nums)
    nums = nums[-shift:] + nums[:-shift] if shift else nums

print(" ".join(str(value) for value in nums))
`,
    tests: [
      { name: "example from the statement", input: "2\n1 2 3 4 5", expectedOutput: "4 5 1 2 3", hidden: false },
      { name: "a full turn changes nothing", input: "3\n1 2 3", expectedOutput: "1 2 3", hidden: false },
      { name: "k is larger than the list", input: "7\n1 2 3 4 5", expectedOutput: "4 5 1 2 3", hidden: true },
      { name: "a negative k rotates left", input: "-1\n1 2 3", expectedOutput: "2 3 1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-first-missing-positive",
    title: "Smallest missing positive number",
    level: "intermediate",
    isInterview: true,
    statement: [
      "One line holds whole numbers in any order, possibly with repeats and negatives.",
      "",
      "Print the smallest positive whole number that does NOT appear.",
      "",
      "```",
      "input:  8 2 5 1 -3 2",
      "output: 3",
      "```",
    ].join("\n"),
    hints: [
      "A `set` turns 'is this number present' into a single fast check.",
      "The answer is never larger than one more than the count of numbers, so counting upward from 1 terminates quickly.",
    ],
    tags: ["hash-set", "arrays"],
    starterCode: `${PY_NUMS}

# TODO: print the smallest positive number missing from nums
`,
    referenceSolution: `${PY_NUMS}

present = set(nums)
candidate = 1
while candidate in present:
    candidate += 1

print(candidate)
`,
    tests: [
      { name: "example from the statement", input: "8 2 5 1 -3 2", expectedOutput: "3", hidden: false },
      { name: "a complete run from one", input: "1 2 3", expectedOutput: "4", hidden: false },
      { name: "nothing positive at all", input: "-5 0", expectedOutput: "1", hidden: true },
      { name: "duplicates do not create gaps", input: "1 1 2 2", expectedOutput: "3", hidden: true },
    ],
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "py-shortest-hop-count",
    title: "Fewest hops through a network",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds `n`: the nodes are numbered 1 to `n`. Each remaining line",
      "holds `a b`, meaning `a` and `b` are connected in both directions.",
      "",
      "Print the fewest hops needed to travel from node 1 to node `n`, or `-1` when",
      "there is no route.",
      "",
      "```",
      "input:  4",
      "        1 2",
      "        2 4",
      "        1 3",
      "output: 2",
      "```",
    ].join("\n"),
    hints: [
      "Breadth-first search visits nodes in order of distance, so the first time you reach the target you already have the shortest count.",
      "Mark a node as seen when you ENQUEUE it, not when you dequeue it, or a node can enter the queue several times.",
    ],
    tags: ["graphs", "bfs"],
    starterCode: `${PY_LINES}
from collections import deque

n = int(lines[0])
edges = [line.split() for line in lines[1:] if line.strip()]

# TODO: print the fewest hops from 1 to n, or -1
`,
    referenceSolution: `${PY_LINES}
from collections import deque

n = int(lines[0])
edges = [line.split() for line in lines[1:] if line.strip()]

neighbours = {node: [] for node in range(1, n + 1)}
for a, b in edges:
    neighbours[int(a)].append(int(b))
    neighbours[int(b)].append(int(a))

seen = {1}
queue = deque([(1, 0)])
answer = -1
while queue:
    node, hops = queue.popleft()
    if node == n:
        answer = hops
        break
    for neighbour in neighbours[node]:
        if neighbour not in seen:
            seen.add(neighbour)
            queue.append((neighbour, hops + 1))

print(answer)
`,
    tests: [
      { name: "example from the statement", input: "4\n1 2\n2 4\n1 3", expectedOutput: "2", hidden: false },
      { name: "no route exists", input: "3\n1 2", expectedOutput: "-1", hidden: false },
      { name: "start and finish are the same node", input: "1", expectedOutput: "0", hidden: true },
      { name: "the shorter of two routes wins", input: "4\n1 4\n1 2\n2 3\n3 4", expectedOutput: "1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-coin-combinations",
    title: "Fewest coins for an amount",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds the amount. The second line holds the coin values",
      "available, separated by spaces; each may be used any number of times.",
      "",
      "Print the fewest coins that make the amount exactly, or `-1` when it cannot be",
      "made.",
      "",
      "```",
      "input:  16",
      "        3 4 10",
      "output: 3",
      "```",
    ].join("\n"),
    hints: [
      "Taking the largest coin first is not always best: with coins 1, 3 and 4, the amount 6 needs two coins, not three.",
      "Build up from 0: the best count for an amount is one more than the best count for `amount - coin`, minimised over the coins.",
    ],
    tags: ["dynamic-programming", "arrays"],
    starterCode: `${PY_LINES}

amount = int(lines[0])
coins = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

# TODO: print the fewest coins that make amount exactly, or -1
`,
    referenceSolution: `${PY_LINES}

amount = int(lines[0])
coins = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

unreachable = amount + 1
best = [0] + [unreachable] * amount
for value in range(1, amount + 1):
    for coin in coins:
        if coin <= value and best[value - coin] + 1 < best[value]:
            best[value] = best[value - coin] + 1

print(best[amount] if best[amount] != unreachable else -1)
`,
    tests: [
      { name: "example from the statement", input: "16\n3 4 10", expectedOutput: "3", hidden: false },
      { name: "greedy would be wrong here", input: "6\n1 3 4", expectedOutput: "2", hidden: false },
      { name: "the amount cannot be made", input: "7\n5", expectedOutput: "-1", hidden: true },
      { name: "zero needs no coins", input: "0\n1 2", expectedOutput: "0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-median-of-a-stream",
    title: "Running median",
    level: "advanced",
    isInterview: false,
    statement: [
      "One line holds whole numbers separated by spaces. After reading each value,",
      "print the median of everything read so far, one line per value.",
      "",
      "With an even count the median is the average of the two middle values, printed",
      "to one decimal place. Print every median to one decimal place.",
      "",
      "```",
      "input:  8 2 20 6",
      "output: 8.0",
      "        5.0",
      "        8.0",
      "        7.0",
      "```",
    ].join("\n"),
    hints: [
      "`bisect.insort` keeps a list sorted as you insert, which is enough for a few thousand values.",
      "The two middle positions of a list of length `n` are `n // 2` and `(n - 1) // 2`; averaging them handles both parities in one line.",
    ],
    tags: ["sorting", "streaming"],
    starterCode: `${PY_NUMS}
import bisect

# TODO: print the running median, one line per value, to one decimal place
`,
    referenceSolution: `${PY_NUMS}
import bisect

seen = []
for value in nums:
    bisect.insort(seen, value)
    middle = (seen[len(seen) // 2] + seen[(len(seen) - 1) // 2]) / 2
    print(f"{middle:.1f}")
`,
    tests: [
      { name: "example from the statement", input: "8 2 20 6", expectedOutput: "8.0\n5.0\n8.0\n7.0", hidden: false },
      { name: "a single value", input: "3", expectedOutput: "3.0", hidden: false },
      { name: "already sorted input", input: "1 2 3 4", expectedOutput: "1.0\n1.5\n2.0\n2.5", hidden: true },
      { name: "repeats and negatives", input: "-2 -2 4", expectedOutput: "-2.0\n-2.0\n-2.0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-edit-distance",
    title: "Fewest edits between two words",
    level: "advanced",
    isInterview: true,
    statement: [
      "Two lines each hold one word. Print the fewest single-character edits —",
      "insert, delete or replace — that turn the first word into the second.",
      "",
      "```",
      "input:  monday",
      "        sundays",
      "output: 3",
      "```",
    ].join("\n"),
    hints: [
      "Think of a table where cell (i, j) is the answer for the first i characters against the first j.",
      "When the two characters match, the cost is whatever the diagonal cell cost; otherwise it is one more than the cheapest of the three neighbours.",
    ],
    tags: ["dynamic-programming", "strings"],
    starterCode: `${PY_LINES}

first = lines[0].strip() if lines else ""
second = lines[1].strip() if len(lines) > 1 else ""

# TODO: print the fewest edits turning first into second
`,
    referenceSolution: `${PY_LINES}

first = lines[0].strip() if lines else ""
second = lines[1].strip() if len(lines) > 1 else ""

previous = list(range(len(second) + 1))
for i in range(1, len(first) + 1):
    current = [i] + [0] * len(second)
    for j in range(1, len(second) + 1):
        if first[i - 1] == second[j - 1]:
            current[j] = previous[j - 1]
        else:
            current[j] = 1 + min(previous[j - 1], previous[j], current[j - 1])
    previous = current

print(previous[len(second)])
`,
    tests: [
      { name: "example from the statement", input: "monday\nsundays", expectedOutput: "3", hidden: false },
      { name: "identical words need no edits", input: "same\nsame", expectedOutput: "0", hidden: false },
      { name: "one word is empty", input: "abc\n", expectedOutput: "3", hidden: true },
      { name: "a pure insertion", input: "ac\nabc", expectedOutput: "1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "py-task-scheduling-order",
    title: "Schedule with a cooldown",
    level: "advanced",
    isInterview: true,
    statement: [
      "The first line holds the cooldown `k`. The second line holds task names",
      "separated by spaces.",
      "",
      "Tasks run one per time slot, in any order, but two runs of the SAME task must be",
      "at least `k` slots apart. Idle slots are allowed. Print the fewest slots needed",
      "to run every task once.",
      "",
      "```",
      "input:  2",
      "        a a a b b b",
      "output: 6",
      "```",
      "",
      "`a b a b a b` works: each `a` is two slots after the previous one, and so is",
      "each `b`, so no idle slot is needed at all.",
    ].join("\n"),
    hints: [
      "Only the most frequent task constrains the schedule. Lay it out first with `k - 1` gaps between its runs, then fill the gaps.",
      "The frame is `(most - 1) * k + tiesForMost` slots — and the answer can never be fewer than the number of tasks, so take the larger of the two.",
    ],
    tags: ["greedy", "counting", "scheduling"],
    starterCode: `${PY_LINES}
from collections import Counter

k = int(lines[0])
tasks = lines[1].split() if len(lines) > 1 else []

# TODO: print the fewest slots needed
`,
    referenceSolution: `${PY_LINES}
from collections import Counter

k = int(lines[0])
tasks = lines[1].split() if len(lines) > 1 else []

if not tasks:
    print(0)
else:
    counts = Counter(tasks)
    most = max(counts.values())
    ties = sum(1 for value in counts.values() if value == most)
    frame = (most - 1) * max(k, 1) + ties
    print(max(frame, len(tasks)))
`,
    tests: [
      { name: "example from the statement", input: "2\na a a b b b", expectedOutput: "6", hidden: false },
      { name: "no cooldown means no idling", input: "1\na a a", expectedOutput: "3", hidden: false },
      { name: "enough variety to fill every gap", input: "2\na a a b b c c", expectedOutput: "7", hidden: true },
      { name: "one task", input: "3\na", expectedOutput: "1", hidden: true },
    ],
  },
];
