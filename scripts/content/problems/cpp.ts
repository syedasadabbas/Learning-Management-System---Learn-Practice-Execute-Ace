// =============================================================================
// C++ TRACK — seed data. Owner: coding-problems stream.
// ORIGINAL PROSE ONLY. See index.ts for the rule and the reasoning.
// -----------------------------------------------------------------------------
// `execution: "piston"` for every problem here, and there is no alternative:
// src/lib/execution/languages.ts records that C++ has NO in-browser backend —
// "no free in-browser toolchain small enough to ship". So Run and Submit both go
// server-side, and when Piston is unreachable the page degrades to the reference
// solution with no Run button rather than offering one that can only fail. That
// degradation is the documented behaviour in docs/ADDON_STREAMS.md, not a
// workaround.
//
// TODO(verify): every reference solution in this file was reviewed by hand but NOT
// COMPILED. The authoring machine has no C++ toolchain (`g++` and `cl` are both
// absent), and this stream is not permitted to reach the network, so Piston could
// not be called either. The JavaScript, Python and SQL reference solutions in the
// sibling files WERE executed against their own tests locally. Before a cohort uses
// this track, run one submit per problem against a live Piston instance and fix any
// compile error found; a wrong reference solution here means a problem no student
// can pass, and the failure will look like their bug.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

import { CPP_HEAD } from "./prelude";

const base = {
  track: "cpp",
  language: "cpp",
  execution: "piston",
  // Compiled languages pay for the compile step out of the same budget.
  timeLimitMs: 10000,
} as const satisfies Partial<SeedProblem>;

export const cppProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...base,
    slug: "cpp-sum-of-a-line",
    title: "Total of every number on the input",
    level: "beginner",
    isInterview: false,
    statement: [
      "Whole numbers are given separated by whitespace. Print their total.",
      "",
      "```",
      "input:  3 4 5",
      "output: 12",
      "```",
    ].join("\n"),
    hints: [
      "`while (cin >> value)` keeps reading until the stream runs out, which is how you read an unknown count.",
      "`cin >>` skips whitespace for you, so newlines and spaces need no special handling.",
    ],
    tags: ["streams", "loops"],
    starterCode: `${CPP_HEAD}
int main() {
  long long value = 0;
  // TODO: read every number and print the total
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  long long value = 0;
  long long total = 0;
  while (cin >> value) total += value;
  cout << total << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "3 4 5", expectedOutput: "12", hidden: false },
      { name: "spread over lines", input: "1\n2\n3", expectedOutput: "6", hidden: false },
      { name: "negatives cancel", input: "-4 4", expectedOutput: "0", hidden: true },
      { name: "one number", input: "42", expectedOutput: "42", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-largest-of-three",
    title: "Largest of three numbers",
    level: "beginner",
    isInterview: false,
    statement: [
      "Three whole numbers are given. Print the largest.",
      "",
      "```",
      "input:  4 9 2",
      "output: 9",
      "```",
    ].join("\n"),
    hints: [
      "`max` from `<algorithm>` takes two arguments; nesting two calls handles three values.",
      "Reading into three named variables is clearer here than a loop over a container.",
    ],
    tags: ["conditionals", "algorithm"],
    starterCode: `${CPP_HEAD}
int main() {
  long long a = 0, b = 0, c = 0;
  cin >> a >> b >> c;
  // TODO: print the largest
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  long long a = 0, b = 0, c = 0;
  cin >> a >> b >> c;
  cout << max(a, max(b, c)) << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "4 9 2", expectedOutput: "9", hidden: false },
      { name: "the first is largest", input: "10 1 2", expectedOutput: "10", hidden: false },
      { name: "all equal", input: "5 5 5", expectedOutput: "5", hidden: true },
      { name: "all negative", input: "-9 -2 -7", expectedOutput: "-2", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-reverse-a-vector",
    title: "Print the numbers backwards",
    level: "beginner",
    isInterview: false,
    statement: [
      "Whole numbers are given separated by whitespace. Print them in the opposite",
      "order on one line, separated by single spaces and with no trailing space.",
      "",
      "```",
      "input:  1 2 3",
      "output: 3 2 1",
      "```",
    ].join("\n"),
    hints: [
      "`vector<long long>` with `push_back` collects an unknown number of values.",
      "Print the separator BEFORE each value except the first — that is how you avoid a trailing space.",
    ],
    tags: ["vectors", "iteration"],
    starterCode: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);
  // TODO: print the values in reverse, space-separated
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);

  for (size_t i = values.size(); i > 0; --i) {
    if (i != values.size()) cout << " ";
    cout << values[i - 1];
  }
  cout << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "1 2 3", expectedOutput: "3 2 1", hidden: false },
      { name: "two values", input: "7 8", expectedOutput: "8 7", hidden: false },
      { name: "one value", input: "5", expectedOutput: "5", hidden: true },
      { name: "negatives keep their sign", input: "-1 -2", expectedOutput: "-2 -1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-swap-by-reference",
    title: "Swap through a reference",
    level: "beginner",
    isInterview: true,
    statement: [
      "Two whole numbers are given. Print them swapped, separated by a space.",
      "",
      "Write the swap as a function taking two REFERENCES, so the change is visible to",
      "the caller. A function taking two copies would swap its own locals and leave the",
      "caller's values untouched — that is the point of this problem.",
      "",
      "```",
      "input:  3 8",
      "output: 8 3",
      "```",
    ].join("\n"),
    hints: [
      "`void exchange(long long &a, long long &b)` — the `&` makes each parameter another name for the caller's variable.",
      "Without the `&` the function still compiles and still appears to work inside itself, which is exactly why this bug survives review.",
    ],
    tags: ["references", "functions"],
    starterCode: `${CPP_HEAD}
// TODO: take the parameters by reference so the caller sees the swap
void exchange(long long a, long long b) {
  long long temp = a;
  a = b;
  b = temp;
}

int main() {
  long long x = 0, y = 0;
  cin >> x >> y;
  exchange(x, y);
  cout << x << " " << y << "\\n";
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
void exchange(long long &a, long long &b) {
  long long temp = a;
  a = b;
  b = temp;
}

int main() {
  long long x = 0, y = 0;
  cin >> x >> y;
  exchange(x, y);
  cout << x << " " << y << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "3 8", expectedOutput: "8 3", hidden: false },
      { name: "equal values look unchanged", input: "5 5", expectedOutput: "5 5", hidden: false },
      { name: "negatives", input: "-1 2", expectedOutput: "2 -1", hidden: true },
      { name: "zero on one side", input: "0 9", expectedOutput: "9 0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-count-above-average",
    title: "How many beat the average",
    level: "beginner",
    isInterview: true,
    statement: [
      "Whole numbers are given separated by whitespace. Print how many of them are",
      "strictly greater than the average of all of them.",
      "",
      "```",
      "input:  1 2 3 4",
      "output: 2",
      "```",
    ].join("\n"),
    hints: [
      "You cannot answer in one pass: the average is not known until every value has been read.",
      "Compare with `value * count > total` instead of dividing, and integer division cannot round the comparison the wrong way.",
    ],
    tags: ["vectors", "arithmetic"],
    starterCode: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);
  // TODO: print how many values exceed the average
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);

  long long total = 0;
  for (long long v : values) total += v;

  long long count = 0;
  const long long n = static_cast<long long>(values.size());
  for (long long v : values) {
    if (v * n > total) count += 1;
  }

  cout << count << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "1 2 3 4", expectedOutput: "2", hidden: false },
      { name: "every value is the average", input: "5 5 5", expectedOutput: "0", hidden: false },
      { name: "one outlier", input: "1 1 1 100", expectedOutput: "1", hidden: true },
      { name: "a single value cannot beat its own average", input: "7", expectedOutput: "0", hidden: true },
    ],
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...base,
    slug: "cpp-sort-and-deduplicate",
    title: "Sorted, with duplicates removed",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Whole numbers are given separated by whitespace. Print them sorted ascending",
      "with each distinct value appearing once, space-separated on one line.",
      "",
      "```",
      "input:  3 1 3 2 1",
      "output: 1 2 3",
      "```",
    ].join("\n"),
    hints: [
      "`sort` then `unique` is the standard pair. `unique` only collapses ADJACENT duplicates, which is why it must come second.",
      "`unique` returns the new logical end; `erase` from there to the real end actually shrinks the vector.",
    ],
    tags: ["algorithm", "vectors", "sorting"],
    starterCode: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);
  // TODO: sort, remove duplicates, print
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);

  sort(values.begin(), values.end());
  values.erase(unique(values.begin(), values.end()), values.end());

  for (size_t i = 0; i < values.size(); ++i) {
    if (i) cout << " ";
    cout << values[i];
  }
  cout << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "3 1 3 2 1", expectedOutput: "1 2 3", hidden: false },
      { name: "already sorted and distinct", input: "1 2 3", expectedOutput: "1 2 3", hidden: false },
      { name: "every value the same", input: "4 4 4", expectedOutput: "4", hidden: true },
      { name: "negatives sort first", input: "0 -3 -3 2", expectedOutput: "-3 0 2", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-split-a-line",
    title: "One word per line",
    level: "intermediate",
    isInterview: false,
    statement: [
      "One line of text is given, with words separated by one or more spaces. Print each",
      "word on its own line.",
      "",
      "```",
      "input:  hello  brave world",
      "output: hello",
      "        brave",
      "        world",
      "```",
    ].join("\n"),
    hints: [
      "`getline(cin, line)` reads the whole line including its spaces, unlike `cin >> word` which stops at the first one.",
      "An `istringstream` over the line lets you then use `>>`, which skips runs of whitespace for free.",
    ],
    tags: ["strings", "streams"],
    starterCode: `${CPP_HEAD}#include <sstream>

int main() {
  string line;
  getline(cin, line);
  // TODO: print each word on its own line
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}#include <sstream>

int main() {
  string line;
  getline(cin, line);

  istringstream stream(line);
  string word;
  while (stream >> word) cout << word << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "hello  brave world", expectedOutput: "hello\nbrave\nworld", hidden: false },
      { name: "a single word", input: "alone", expectedOutput: "alone", hidden: false },
      { name: "leading and trailing spaces are ignored", input: "  padded  ", expectedOutput: "padded", hidden: true },
      { name: "punctuation stays attached", input: "hi, there!", expectedOutput: "hi,\nthere!", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-word-counts-sorted",
    title: "Count each word",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Words are given separated by whitespace. Print one line per distinct word in",
      "alphabetical order, as `word count`.",
      "",
      "```",
      "input:  b a b",
      "output: a 1",
      "        b 2",
      "```",
    ].join("\n"),
    hints: [
      "`map<string, int>` keeps its keys in sorted order, so iterating it gives you the alphabetical output with no extra sort.",
      "`counts[word] += 1` inserts a zero first when the key is new, so no `find` is needed.",
    ],
    tags: ["map", "counting", "strings"],
    starterCode: `${CPP_HEAD}#include <map>

int main() {
  map<string, int> counts;
  string word;
  while (cin >> word) {
    // TODO: count this word
  }
  // TODO: print each word and its count
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}#include <map>

int main() {
  map<string, int> counts;
  string word;
  while (cin >> word) counts[word] += 1;

  for (const auto &entry : counts) {
    cout << entry.first << " " << entry.second << "\\n";
  }
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "b a b", expectedOutput: "a 1\nb 2", hidden: false },
      { name: "one word repeated", input: "x x x", expectedOutput: "x 3", hidden: false },
      { name: "case matters", input: "Ada ada", expectedOutput: "Ada 1\nada 1", hidden: true },
      { name: "words spread over lines", input: "one\ntwo\none", expectedOutput: "one 2\ntwo 1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-binary-search-position",
    title: "Find a value in a sorted list",
    level: "intermediate",
    isInterview: true,
    statement: [
      "The first line holds the value to find. The second line holds whole numbers",
      "sorted ascending.",
      "",
      "Print the zero-based position of the value, or `-1` when it is not present. When",
      "the value appears more than once, print the position of its first occurrence.",
      "",
      "```",
      "input:  5",
      "        1 3 5 7",
      "output: 2",
      "```",
    ].join("\n"),
    hints: [
      "`lower_bound` returns an iterator to the FIRST element not less than the target, which is exactly the first-occurrence rule.",
      "It returns `end()` when everything is smaller, and the element it points at may be larger than the target — check both before reporting a position.",
    ],
    tags: ["binary-search", "algorithm"],
    starterCode: `${CPP_HEAD}
int main() {
  long long target = 0;
  cin >> target;
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);
  // TODO: print the first position of target, or -1
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  long long target = 0;
  cin >> target;
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);

  auto found = lower_bound(values.begin(), values.end(), target);
  if (found == values.end() || *found != target) {
    cout << -1 << "\\n";
  } else {
    cout << (found - values.begin()) << "\\n";
  }
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "5\n1 3 5 7", expectedOutput: "2", hidden: false },
      { name: "not present", input: "4\n1 3 5 7", expectedOutput: "-1", hidden: false },
      { name: "the first of several copies", input: "3\n1 3 3 3", expectedOutput: "1", hidden: true },
      { name: "larger than everything", input: "99\n1 2", expectedOutput: "-1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-longest-rising-run",
    title: "Longest rising run",
    level: "intermediate",
    isInterview: true,
    statement: [
      "Whole numbers are given separated by whitespace. Print the length of the longest",
      "stretch of neighbouring values that strictly increases.",
      "",
      "```",
      "input:  1 2 1 2 3 4",
      "output: 4",
      "```",
    ].join("\n"),
    hints: [
      "One pass is enough: keep the current run's length and reset it to 1 whenever the sequence stops rising.",
      "A single value is a run of length 1, so the answer is never 0 for a non-empty input.",
    ],
    tags: ["arrays", "iteration"],
    starterCode: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);
  // TODO: print the longest strictly increasing run length
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);

  if (values.empty()) {
    cout << 0 << "\\n";
    return 0;
  }

  long long best = 1;
  long long run = 1;
  for (size_t i = 1; i < values.size(); ++i) {
    run = values[i] > values[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }

  cout << best << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "1 2 1 2 3 4", expectedOutput: "4", hidden: false },
      { name: "never rises", input: "5 4 3", expectedOutput: "1", hidden: false },
      { name: "equal values break the run", input: "1 1 2", expectedOutput: "2", hidden: true },
      { name: "one value", input: "9", expectedOutput: "1", hidden: true },
    ],
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "cpp-matrix-product",
    title: "Multiply two matrices",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds three numbers `n m p`. The next `n` lines hold `m` values",
      "each — the first matrix. The next `m` lines hold `p` values each — the second.",
      "",
      "Print the product: `n` lines of `p` values, space-separated with no trailing",
      "space.",
      "",
      "```",
      "input:  2 2 2",
      "        1 2",
      "        3 4",
      "        1 0",
      "        0 1",
      "output: 1 2",
      "        3 4",
      "```",
    ].join("\n"),
    hints: [
      "Cell (i, j) of the product is the sum over k of `a[i][k] * b[k][j]` — the shared dimension is the one you sum over.",
      "Use `long long` for the accumulator: the products grow much faster than the inputs do.",
    ],
    tags: ["matrices", "nested-loops"],
    starterCode: `${CPP_HEAD}
int main() {
  int n = 0, m = 0, p = 0;
  cin >> n >> m >> p;
  vector<vector<long long>> a(n, vector<long long>(m));
  vector<vector<long long>> b(m, vector<long long>(p));
  for (auto &row : a) for (auto &cell : row) cin >> cell;
  for (auto &row : b) for (auto &cell : row) cin >> cell;
  // TODO: print the product
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  int n = 0, m = 0, p = 0;
  cin >> n >> m >> p;
  vector<vector<long long>> a(n, vector<long long>(m));
  vector<vector<long long>> b(m, vector<long long>(p));
  for (auto &row : a) for (auto &cell : row) cin >> cell;
  for (auto &row : b) for (auto &cell : row) cin >> cell;

  for (int i = 0; i < n; ++i) {
    for (int j = 0; j < p; ++j) {
      long long total = 0;
      for (int k = 0; k < m; ++k) total += a[i][k] * b[k][j];
      if (j) cout << " ";
      cout << total;
    }
    cout << "\\n";
  }
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "2 2 2\n1 2\n3 4\n1 0\n0 1", expectedOutput: "1 2\n3 4", hidden: false },
      { name: "a row times a column", input: "1 2 1\n2 3\n4\n5", expectedOutput: "23", hidden: false },
      { name: "a zero matrix", input: "2 2 2\n0 0\n0 0\n1 2\n3 4", expectedOutput: "0 0\n0 0", hidden: true },
      { name: "non-square shapes", input: "2 3 1\n1 1 1\n2 2 2\n1\n2\n3", expectedOutput: "6\n12", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-kth-largest",
    title: "The k-th largest value",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds `k`. The second line holds whole numbers.",
      "",
      "Print the `k`-th largest value, counting duplicates separately: in `5 5 3` the",
      "second largest is `5`. Print `-1` when there are fewer than `k` values.",
      "",
      "```",
      "input:  2",
      "        3 1 4 1 5",
      "output: 4",
      "```",
    ].join("\n"),
    hints: [
      "`nth_element` rearranges just enough of the container to put the right value in the right place — cheaper than a full sort.",
      "It is easier to reason about with the comparator reversed: the k-th largest is the element at index `k - 1` of a descending order.",
    ],
    tags: ["algorithm", "selection"],
    starterCode: `${CPP_HEAD}
int main() {
  long long k = 0;
  cin >> k;
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);
  // TODO: print the k-th largest value, or -1
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  long long k = 0;
  cin >> k;
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);

  if (k < 1 || static_cast<long long>(values.size()) < k) {
    cout << -1 << "\\n";
    return 0;
  }

  nth_element(values.begin(), values.begin() + (k - 1), values.end(), greater<long long>());
  cout << values[k - 1] << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "2\n3 1 4 1 5", expectedOutput: "4", hidden: false },
      { name: "duplicates count separately", input: "2\n5 5 3", expectedOutput: "5", hidden: false },
      { name: "not enough values", input: "4\n1 2", expectedOutput: "-1", hidden: true },
      { name: "the largest of one", input: "1\n7", expectedOutput: "7", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-sort-records-two-keys",
    title: "Sort records on two keys",
    level: "advanced",
    isInterview: false,
    statement: [
      "Each line holds a name and a whole-number score, separated by a space.",
      "",
      "Print the records ordered by score highest first, and by name alphabetically",
      "where scores are equal. Keep the `name score` format.",
      "",
      "```",
      "input:  ada 80",
      "        alan 90",
      "        grace 80",
      "output: alan 90",
      "        ada 80",
      "        grace 80",
      "```",
    ].join("\n"),
    hints: [
      "A comparator must be a STRICT weak ordering: it returns false for two equal records, and `>=` would break that and can crash `sort`.",
      "Compare the second key only when the first is equal — `if (a.score != b.score) return a.score > b.score; return a.name < b.name;`",
    ],
    tags: ["sorting", "comparators", "structs"],
    starterCode: `${CPP_HEAD}
struct Record {
  string name;
  long long score;
};

int main() {
  vector<Record> records;
  string name;
  long long score = 0;
  while (cin >> name >> score) records.push_back({name, score});
  // TODO: sort by score descending, then name ascending, and print
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
struct Record {
  string name;
  long long score;
};

int main() {
  vector<Record> records;
  string name;
  long long score = 0;
  while (cin >> name >> score) records.push_back({name, score});

  sort(records.begin(), records.end(), [](const Record &a, const Record &b) {
    if (a.score != b.score) return a.score > b.score;
    return a.name < b.name;
  });

  for (const Record &record : records) {
    cout << record.name << " " << record.score << "\\n";
  }
  return 0;
}
`,
    tests: [
      {
        name: "example from the statement",
        input: "ada 80\nalan 90\ngrace 80",
        expectedOutput: "alan 90\nada 80\ngrace 80",
        hidden: false,
      },
      { name: "one record", input: "solo 1", expectedOutput: "solo 1", hidden: false },
      { name: "every score equal", input: "c 5\na 5\nb 5", expectedOutput: "a 5\nb 5\nc 5", hidden: true },
      { name: "negative scores sort last", input: "a -1\nb 0", expectedOutput: "b 0\na -1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-pair-indices-hash",
    title: "Positions of the pair that hits the target",
    level: "advanced",
    isInterview: true,
    statement: [
      "The first line holds a target. The second line holds whole numbers in no",
      "particular order.",
      "",
      "Print the two zero-based positions of a pair that adds up to the target, smaller",
      "position first, separated by a space. When several pairs work, print the one whose",
      "SECOND position is earliest. Print `-1` when no pair works.",
      "",
      "```",
      "input:  12",
      "        5 3 9 4 8",
      "output: 1 2",
      "```",
    ].join("\n"),
    hints: [
      "The list is not sorted, so the two-pointer trick does not apply. Store each value's position as you go.",
      "Look for `target - value` BEFORE inserting the current value; otherwise a target of twice one value matches that value with itself.",
    ],
    tags: ["hash-map", "arrays"],
    starterCode: `${CPP_HEAD}#include <unordered_map>

int main() {
  long long target = 0;
  cin >> target;
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);
  // TODO: print the two positions, or -1
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}#include <unordered_map>

int main() {
  long long target = 0;
  cin >> target;
  vector<long long> values;
  long long value = 0;
  while (cin >> value) values.push_back(value);

  unordered_map<long long, size_t> seen;
  for (size_t i = 0; i < values.size(); ++i) {
    auto found = seen.find(target - values[i]);
    if (found != seen.end()) {
      cout << found->second << " " << i << "\\n";
      return 0;
    }
    if (seen.find(values[i]) == seen.end()) seen[values[i]] = i;
  }

  cout << -1 << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "12\n5 3 9 4 8", expectedOutput: "1 2", hidden: false },
      { name: "no pair works", input: "100\n1 2 3", expectedOutput: "-1", hidden: false },
      { name: "the same value twice", input: "6\n3 1 3", expectedOutput: "0 2", hidden: true },
      { name: "the earliest second position wins", input: "5\n1 4 2 3", expectedOutput: "0 1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "cpp-nesting-depth",
    title: "Deepest nesting",
    level: "advanced",
    isInterview: true,
    statement: [
      "One line contains only `(` and `)`. Print the deepest nesting reached, or `-1`",
      "when the line is not balanced — a `)` with nothing open, or an `(` never closed.",
      "",
      "```",
      "input:  (()(()))",
      "output: 3",
      "```",
    ].join("\n"),
    hints: [
      "You do not need a stack. A single counter that rises on `(` and falls on `)` is enough, because there is only one kind of bracket.",
      "The counter dropping below zero means an unmatched closer; ending above zero means an unmatched opener. Both are `-1`.",
    ],
    tags: ["strings", "counting"],
    starterCode: `${CPP_HEAD}
int main() {
  string line;
  getline(cin, line);
  // TODO: print the deepest nesting, or -1 when unbalanced
  return 0;
}
`,
    referenceSolution: `${CPP_HEAD}
int main() {
  string line;
  getline(cin, line);

  long long depth = 0;
  long long best = 0;
  for (char ch : line) {
    if (ch == '(') {
      depth += 1;
      if (depth > best) best = depth;
    } else if (ch == ')') {
      depth -= 1;
      if (depth < 0) {
        cout << -1 << "\\n";
        return 0;
      }
    }
  }

  cout << (depth == 0 ? best : -1) << "\\n";
  return 0;
}
`,
    tests: [
      { name: "example from the statement", input: "(()(()))", expectedOutput: "3", hidden: false },
      { name: "flat and balanced", input: "()()", expectedOutput: "1", hidden: false },
      { name: "an unmatched closer", input: "())", expectedOutput: "-1", hidden: true },
      { name: "an unmatched opener", input: "(()", expectedOutput: "-1", hidden: true },
    ],
  },
];
