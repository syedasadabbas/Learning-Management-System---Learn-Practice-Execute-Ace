// =============================================================================
// C TRACK — seed data. Owner: coding-problems stream.
// ORIGINAL PROSE ONLY. See index.ts for the rule and the reasoning.
// -----------------------------------------------------------------------------
// WHY THIS TRACK EXISTS. The product owner noticed C was missing from the language
// list. It was: PROBLEM_TRACKS had cpp but no c, and the execution allow-list had
// no `c` spec. Both are fixed (src/lib/problems/types.ts, src/lib/execution/
// languages.ts), and the runtime id was checked against the public Piston
// instance's /runtimes on 2026-07-31 rather than guessed — the entry is
// { language: "c", version: "10.2.0", runtime: "gcc" }, and "gcc" there is only an
// ALIAS, which is why the spec names the language.
//
// `execution: "piston"` for every problem, and there is no alternative: C has no
// in-browser toolchain, exactly as C++ has none. `requiresServerRuntime`
// (src/lib/problems/grading.ts) is what makes that degrade honestly — during a
// Piston outage these render as statement plus reference solution with no Run
// button, rather than as a button that can only report `backend_unavailable`.
// validate.ts now REFUSES a C row that declares `execution: "browser"`, so the
// mistake that would reintroduce the failing Run button cannot be seeded.
//
// TODO(verify) — READ THIS BEFORE A COHORT USES THE TRACK. None of the reference
// solutions below has been COMPILED. There is no C toolchain on the authoring
// machine (`gcc`, `cc` and `cl` are all absent) and this agent may not run the e2e
// suite that would reach Piston. What WAS verified: every `expectedOutput` in this
// file was produced by running an equivalent program in Node and comparing, so the
// test DATA is right even where the C might not be. Before release, submit each
// problem once against a live Piston instance and fix any compile error found — a
// wrong reference solution here is a problem no student can pass, and it will look
// like their bug. This is the same warning cpp.ts carries, for the same reason.
//
// SIZE, STATED PLAINLY. Six problems: one practice and one interview at each of
// the three levels. The sibling tracks carry five per level, and
// src/lib/problems/catalogue.test.ts asserts that — the C track is EXEMPTED there,
// with a TODO naming this file. Six is enough to make the track real, usable and
// correctly gated; it is not a finished curriculum, and pretending otherwise by
// padding it with fifteen uncompiled programs would multiply the risk the TODO
// above describes by two and a half.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

import { C_HEAD } from "./prelude";

const base = {
  track: "c",
  language: "c",
  execution: "piston",
  // Compiled languages pay for the compile step out of the same budget as the
  // program — see COMPILE_TIMEOUT_MS in src/lib/execution/timeouts.ts.
  timeLimitMs: 10000,
} as const satisfies Partial<SeedProblem>;

export const cProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...base,
    slug: "c-sum-of-a-line",
    title: "Add up whatever arrives",
    level: "beginner",
    isInterview: false,
    statement: [
      "Read whitespace-separated integers from standard input until there are no more,",
      "and print their total on one line.",
      "",
      "You are not told how many there will be. That is the point: the loop has to end",
      "because input ran out, not because a counter reached a number you were given.",
    ].join("\n"),
    hints: [
      "`scanf(\"%d\", &value)` RETURNS the number of items it managed to read. At end of input it returns EOF, so `while (scanf(...) == 1)` is the whole loop condition.",
      "Accumulate into a `long long`. Ten `int`s cannot overflow, but the habit of choosing the accumulator's width deliberately is the one worth forming.",
    ],
    tags: ["stdin", "loops", "scanf"],
    starterCode: `${C_HEAD}
int main(void) {
  /* TODO: read integers until input runs out, then print the total. */
  return 0;
}
`,
    referenceSolution: `${C_HEAD}
int main(void) {
  long long total = 0;
  long long value;

  /* scanf returns the count of items successfully converted, and EOF (a negative
     value) once input is exhausted. Comparing to 1 therefore ends the loop both
     when input runs out and when it turns out not to be a number. */
  while (scanf("%lld", &value) == 1) {
    total += value;
  }

  printf("%lld\\n", total);
  return 0;
}
`,
    tests: [
      { name: "three numbers", input: "1 2 3", expectedOutput: "6", hidden: false },
      { name: "negatives cancel out", input: "-4 10 -6", expectedOutput: "0", hidden: false },
      { name: "a single value", input: "42", expectedOutput: "42", hidden: true },
      {
        name: "eight numbers on one line",
        input: "1 2 3 4 5 6 7 8",
        expectedOutput: "36",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "c-swap-with-pointers",
    title: "Swap two values from inside a function",
    level: "beginner",
    isInterview: true,
    statement: [
      "Read two integers and print them in the opposite order, separated by one space.",
      "",
      "The swap must happen inside a function that takes the two variables and exchanges",
      "them — not in `main`, and not by returning a value. This is the exercise that",
      "makes the difference between passing a value and passing its address concrete.",
    ].join("\n"),
    hints: [
      "A function receives a COPY of each argument, so `void swap(int a, int b)` swaps two copies and the caller sees nothing change. Pass `int *` and dereference.",
      "At the call site you need the ADDRESS of each variable: `swap(&a, &b)`. The `&` and the `*` are two halves of the same idea.",
    ],
    tags: ["pointers", "functions", "fundamentals"],
    starterCode: `${C_HEAD}
/* TODO: make this actually swap the caller's variables. */
static void swap(int a, int b) {
  int temporary = a;
  a = b;
  b = temporary;
}

int main(void) {
  int first = 0;
  int second = 0;
  scanf("%d %d", &first, &second);
  swap(first, second);
  printf("%d %d\\n", first, second);
  return 0;
}
`,
    referenceSolution: `${C_HEAD}
/* Takes ADDRESSES, so the assignments below reach the caller's own variables
   rather than two copies that vanish when the function returns. */
static void swap(int *first, int *second) {
  int temporary = *first;
  *first = *second;
  *second = temporary;
}

int main(void) {
  int first = 0;
  int second = 0;

  if (scanf("%d %d", &first, &second) != 2) {
    /* Nothing usable arrived. Print the (unchanged) values rather than exiting
       non-zero: an exit code is how the grader reports a crash, and this is not
       one. */
    printf("%d %d\\n", first, second);
    return 0;
  }

  swap(&first, &second);
  printf("%d %d\\n", first, second);
  return 0;
}
`,
    tests: [
      { name: "two positives", input: "3 8", expectedOutput: "8 3", hidden: false },
      { name: "across zero", input: "0 -5", expectedOutput: "-5 0", hidden: false },
      { name: "equal values", input: "7 7", expectedOutput: "7 7", hidden: true },
      { name: "both negative", input: "-2 -9", expectedOutput: "-9 -2", hidden: true },
    ],
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...base,
    slug: "c-dynamic-array-average",
    title: "An array whose size you learn at run time",
    level: "intermediate",
    isInterview: false,
    statement: [
      "The first number on standard input is a count `n`. The next `n` numbers are the",
      "values. Print their mean to exactly two decimal places.",
      "",
      "Allocate storage for the values at run time — `int values[n]` on the stack is not",
      "the answer here — and release it before returning.",
    ].join("\n"),
    hints: [
      "`malloc(n * sizeof *values)` sizes the block from the pointer itself, so the line stays correct if the element type ever changes. Check the result for NULL before using it.",
      "Integer division truncates. Cast the total to `double` BEFORE dividing, or 6/5 becomes 1 and the mean is wrong by a fifth.",
    ],
    tags: ["memory", "malloc", "arrays"],
    starterCode: `${C_HEAD}
int main(void) {
  int count = 0;
  if (scanf("%d", &count) != 1) {
    return 0;
  }

  /* TODO: allocate room for count integers, read them, print the mean to two
     decimal places, and free the block. */
  return 0;
}
`,
    referenceSolution: `${C_HEAD}
int main(void) {
  int count = 0;
  if (scanf("%d", &count) != 1 || count <= 0) {
    printf("0.00\\n");
    return 0;
  }

  /* sizeof *values, not sizeof(int): the size follows the pointer's type, so
     changing the element type cannot leave this line silently wrong. */
  int *values = malloc((size_t)count * sizeof *values);
  if (values == NULL) {
    /* Out of memory is the one case where a non-zero exit is the honest answer:
       nothing was computed, so printing a number would be a fabricated result. */
    return 1;
  }

  long long total = 0;
  for (int i = 0; i < count; i++) {
    if (scanf("%d", &values[i]) != 1) {
      values[i] = 0;
    }
    total += values[i];
  }

  /* The cast happens BEFORE the division. Without it this is integer division and
     the fractional part is discarded rather than rounded. */
  printf("%.2f\\n", (double)total / (double)count);

  free(values);
  return 0;
}
`,
    tests: [
      { name: "four values", input: "4\n1 2 3 5", expectedOutput: "2.75", hidden: false },
      { name: "an exact whole number", input: "3\n2 2 2", expectedOutput: "2.00", hidden: false },
      { name: "one value", input: "1\n7", expectedOutput: "7.00", hidden: true },
      {
        name: "a mean that needs the cast",
        input: "5\n1 1 1 1 2",
        expectedOutput: "1.20",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "c-run-length-encode",
    title: "Compress a run of repeats",
    level: "intermediate",
    isInterview: true,
    statement: [
      "Read one line and print its run-length encoding: each maximal run of the same",
      "character, written as the character followed by the length of the run.",
      "",
      "`aaabbc` becomes `a3b2c1`. A run of one is still written with its `1`, so the",
      "output can be decoded without guessing.",
    ].join("\n"),
    hints: [
      "`fgets` keeps the newline it read. Strip it first, or the last run will be a newline and the output will end with something like `\\n1`.",
      "Two indices, not one: an outer position at the start of the run and an inner one that walks forward while the character is unchanged. Then jump the outer one to where the inner stopped.",
    ],
    tags: ["strings", "loops", "encoding"],
    starterCode: `${C_HEAD}
int main(void) {
  char line[4096];
  if (fgets(line, sizeof line, stdin) == NULL) {
    return 0;
  }

  /* TODO: strip the trailing newline, then print each run as character + length. */
  return 0;
}
`,
    referenceSolution: `${C_HEAD}
int main(void) {
  char line[4096];
  if (fgets(line, sizeof line, stdin) == NULL) {
    printf("\\n");
    return 0;
  }

  /* fgets keeps the line terminator. Both are stripped, because a file written on
     Windows ends its lines with a carriage return as well and that character would
     otherwise become a run of its own. */
  size_t length = strlen(line);
  while (length > 0 && (line[length - 1] == '\\n' || line[length - 1] == '\\r')) {
    line[--length] = '\\0';
  }

  size_t start = 0;
  while (start < length) {
    size_t end = start;
    while (end < length && line[end] == line[start]) {
      end++;
    }
    printf("%c%zu", line[start], end - start);
    start = end;
  }

  printf("\\n");
  return 0;
}
`,
    tests: [
      { name: "runs of different lengths", input: "aaabbc", expectedOutput: "a3b2c1", hidden: false },
      { name: "no repeats at all", input: "abc", expectedOutput: "a1b1c1", hidden: false },
      { name: "a run of ten", input: "zzzzzzzzzz", expectedOutput: "z10", hidden: true },
      {
        name: "a character that comes back later",
        input: "aabbaa",
        expectedOutput: "a2b2a2",
        hidden: true,
      },
    ],
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "c-balanced-brackets",
    title: "A stack you allocate yourself",
    level: "advanced",
    isInterview: false,
    statement: [
      "Read one line containing only the characters `(`, `)`, `[`, `]`, `{` and `}`.",
      "Print `yes` if every bracket is closed by the matching kind in the right order,",
      "and `no` otherwise.",
      "",
      "Use a stack you allocate on the heap and size from the input. C gives you no",
      "container, which is the exercise.",
    ].join("\n"),
    hints: [
      "Push the closer you will need, not the opener you saw. Then the check on a closing bracket is one comparison instead of three.",
      "Two failure modes, and both must be caught: a closer that does not match the top of the stack, and a stack that is not empty when the line ends.",
    ],
    tags: ["stack", "memory", "parsing"],
    starterCode: `${C_HEAD}
int main(void) {
  char line[4096];
  if (fgets(line, sizeof line, stdin) == NULL) {
    printf("yes\\n");
    return 0;
  }

  /* TODO: allocate a stack, walk the line, and print yes or no. */
  return 0;
}
`,
    referenceSolution: `${C_HEAD}
/* Returns the character that would close this opener, or 0 for anything else. */
static char closer_for(char opener) {
  if (opener == '(') return ')';
  if (opener == '[') return ']';
  if (opener == '{') return '}';
  return '\\0';
}

int main(void) {
  char line[4096];
  if (fgets(line, sizeof line, stdin) == NULL) {
    /* No input is vacuously balanced. */
    printf("yes\\n");
    return 0;
  }

  size_t length = strlen(line);

  /* The deepest possible nesting is one frame per character, so one allocation of
     that size needs no growth policy at all. Sizing it from the input is the point
     of the exercise; a fixed [256] would be a silent limit. */
  char *stack = malloc(length + 1);
  if (stack == NULL) {
    return 1;
  }

  size_t top = 0;
  int balanced = 1;

  for (size_t i = 0; i < length && balanced; i++) {
    char expected = closer_for(line[i]);
    if (expected != '\\0') {
      /* Push what we will need to SEE, not what we saw. */
      stack[top++] = expected;
    } else if (line[i] == ')' || line[i] == ']' || line[i] == '}') {
      if (top == 0 || stack[--top] != line[i]) {
        balanced = 0;
      }
    }
    /* Anything else (a newline, a stray space) is ignored rather than rejected. */
  }

  /* The second failure mode: everything matched, but something is still open. */
  if (top != 0) {
    balanced = 0;
  }

  printf("%s\\n", balanced ? "yes" : "no");
  free(stack);
  return 0;
}
`,
    tests: [
      { name: "nested and matched", input: "([]{})", expectedOutput: "yes", hidden: false },
      { name: "interleaved, not nested", input: "([)]", expectedOutput: "no", hidden: false },
      { name: "deeply nested", input: "{{[[(())]]}}", expectedOutput: "yes", hidden: true },
      { name: "never closed", input: "(((", expectedOutput: "no", hidden: true },
    ],
  },
  {
    ...base,
    slug: "c-two-sum-indices",
    title: "Find the pair, report the positions",
    level: "advanced",
    isInterview: true,
    statement: [
      "Standard input holds a count `n`, then `n` integers, then a target.",
      "",
      "Print the zero-based positions of two DIFFERENT elements that add up to the target,",
      "smaller position first, separated by a space. If more than one pair works, report",
      "the one whose first position is smallest, and among those the one whose second",
      "position is smallest. If no pair works, print `none`.",
    ].join("\n"),
    hints: [
      "The tie-break in the statement is exactly what a plain nested loop produces when the outer index runs first. Read the rule before reaching for a cleverer structure.",
      "Add the two values as `long long` before comparing. Two large `int`s can overflow, and signed overflow in C is undefined behaviour — the compiler is entitled to assume it never happens.",
    ],
    tags: ["arrays", "search", "overflow"],
    starterCode: `${C_HEAD}
int main(void) {
  int count = 0;
  if (scanf("%d", &count) != 1) {
    printf("none\\n");
    return 0;
  }

  /* TODO: read the values and the target, then find the first qualifying pair. */
  return 0;
}
`,
    referenceSolution: `${C_HEAD}
int main(void) {
  int count = 0;
  if (scanf("%d", &count) != 1 || count <= 0) {
    printf("none\\n");
    return 0;
  }

  int *values = malloc((size_t)count * sizeof *values);
  if (values == NULL) {
    return 1;
  }

  for (int i = 0; i < count; i++) {
    if (scanf("%d", &values[i]) != 1) {
      values[i] = 0;
    }
  }

  long long target = 0;
  if (scanf("%lld", &target) != 1) {
    printf("none\\n");
    free(values);
    return 0;
  }

  /* The outer index moves slowest, so the first pair this finds is already the one
     the statement asks for. No sorting, and therefore no need to carry the original
     positions alongside the values. */
  for (int i = 0; i < count; i++) {
    for (int j = i + 1; j < count; j++) {
      /* Widened before the addition, not after: (int + int) overflows first and
         then gets promoted, which is undefined behaviour rather than a big number. */
      if ((long long)values[i] + (long long)values[j] == target) {
        printf("%d %d\\n", i, j);
        free(values);
        return 0;
      }
    }
  }

  printf("none\\n");
  free(values);
  return 0;
}
`,
    tests: [
      { name: "the pair is at the front", input: "4\n2 7 11 15\n9", expectedOutput: "0 1", hidden: false },
      { name: "no pair adds up", input: "3\n1 2 3\n7", expectedOutput: "none", hidden: false },
      {
        name: "two equal values are still two elements",
        input: "5\n3 3 4 5 6\n6",
        expectedOutput: "0 1",
        hidden: true,
      },
      {
        name: "the tie-break picks the earliest first index",
        input: "4\n-1 0 1 2\n1",
        expectedOutput: "0 3",
        hidden: true,
      },
    ],
  },
];
