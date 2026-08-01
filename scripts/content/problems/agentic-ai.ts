// =============================================================================
// AGENTIC-AI TRACK — seed data. Owner: coding-problems stream.
// ORIGINAL PROSE ONLY. See index.ts for the rule and the reasoning.
// -----------------------------------------------------------------------------
// The track is about the MECHANICS an agent or an LLM application is made of —
// token budgets, context windows, tool-call payloads, retry backoff, embedding
// similarity, retrieval ranking, chunking, prefix-cache reuse and cost estimation.
// Every one of them is a deterministic function of its input, which is exactly what
// makes them gradeable; "write a good prompt" is not.
//
// The language is Python because that is what the ecosystem is written in, and
// because Pyodide runs it in the browser at no cost. NOTHING here calls a model, an
// API or the network: an exercise that needed a key would violate FREE_STACK.md and
// would be ungradeable anyway.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

import { PY_LINES, PY_NUMS, PY_STDIN } from "./prelude";

const base = {
  track: "agentic-ai",
  language: "python",
  execution: "browser",
  timeLimitMs: 6000,
} as const satisfies Partial<SeedProblem>;

export const agenticAiProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...base,
    slug: "ai-token-budget-trim",
    title: "How much history fits in the budget",
    level: "beginner",
    isInterview: false,
    statement: [
      "The first line holds a token budget. The second line holds the token counts of a",
      "conversation's messages, oldest first.",
      "",
      "Keeping the NEWEST messages and working backwards, print how many messages fit",
      "without the total exceeding the budget.",
      "",
      "```",
      "input:  10",
      "        4 4 4",
      "output: 2",
      "```",
    ].join("\n"),
    hints: [
      "Walk the list backwards. Stop at the first message that would take you over — you cannot skip it and keep an older one, because dropping a message from the middle breaks the conversation.",
      "A message larger than the whole budget means the answer is 0, not 1.",
    ],
    tags: ["context-window", "greedy"],
    starterCode: `${PY_LINES}

budget = int(lines[0])
sizes = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

# TODO: print how many of the newest messages fit inside budget
`,
    referenceSolution: `${PY_LINES}

budget = int(lines[0])
sizes = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

used = 0
kept = 0
for size in reversed(sizes):
    if used + size > budget:
        break
    used += size
    kept += 1

print(kept)
`,
    tests: [
      { name: "example from the statement", input: "10\n4 4 4", expectedOutput: "2", hidden: false },
      { name: "the newest message alone is too large", input: "3\n5", expectedOutput: "0", hidden: false },
      { name: "everything fits", input: "12\n4 4 4", expectedOutput: "3", hidden: true },
      { name: "a budget of zero keeps nothing", input: "0\n1", expectedOutput: "0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-prompt-template-fill",
    title: "Fill a prompt template",
    level: "beginner",
    isInterview: false,
    statement: [
      "The first line is a prompt template containing placeholders written as `{key}`.",
      "Each remaining line holds `key=value`.",
      "",
      "Print the template with every placeholder you have a value for replaced. Leave a",
      "placeholder you have no value for exactly as it is — silently dropping it hides",
      "the bug, and a prompt with a literal `{name}` in it is at least visible.",
      "",
      "```",
      "input:  Hello {name}, welcome to {place}.",
      "        name=Ada",
      "        place=the Hub",
      "output: Hello Ada, welcome to the Hub.",
      "```",
    ].join("\n"),
    hints: [
      "`line.split(\"=\", 1)` splits on the FIRST equals sign only, so a value containing one survives.",
      "`str.replace` is enough here; do not reach for `str.format`, which raises on a placeholder you have no value for.",
    ],
    tags: ["prompting", "strings"],
    starterCode: `${PY_LINES}

template = lines[0] if lines else ""
pairs = [line.split("=", 1) for line in lines[1:] if "=" in line]

# TODO: print the template with every known placeholder replaced
`,
    referenceSolution: `${PY_LINES}

template = lines[0] if lines else ""
pairs = [line.split("=", 1) for line in lines[1:] if "=" in line]

for key, value in pairs:
    template = template.replace("{" + key + "}", value)

print(template)
`,
    tests: [
      {
        name: "example from the statement",
        input: "Hello {name}, welcome to {place}.\nname=Ada\nplace=the Hub",
        expectedOutput: "Hello Ada, welcome to the Hub.",
        hidden: false,
      },
      { name: "an unfilled placeholder stays visible", input: "Dear {name}.", expectedOutput: "Dear {name}.", hidden: false },
      { name: "two placeholders side by side", input: "{a}{b}\nb=2\na=1", expectedOutput: "12", hidden: true },
      { name: "a value nobody asked for is ignored", input: "No placeholders.\nname=X", expectedOutput: "No placeholders.", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-stop-sequence-trim",
    title: "Cut a completion at its stop sequence",
    level: "beginner",
    isInterview: false,
    statement: [
      "The first line is a stop sequence. The second line is a model's raw output.",
      "",
      "Print the output up to but NOT including the first occurrence of the stop",
      "sequence. Print the whole output when the stop sequence never appears.",
      "",
      "```",
      "input:  END",
      "        helloENDworld",
      "output: hello",
      "```",
    ].join("\n"),
    hints: [
      "`text.find(stop)` returns -1 when there is no match, which is the case you must handle separately from a match at position 0.",
      "`text.split(stop, 1)[0]` does both cases in one expression — worth knowing, but make sure you can explain why.",
    ],
    tags: ["decoding", "strings"],
    starterCode: `${PY_LINES}

stop = lines[0] if lines else ""
text = lines[1] if len(lines) > 1 else ""

# TODO: print text up to the first occurrence of stop
`,
    referenceSolution: `${PY_LINES}

stop = lines[0] if lines else ""
text = lines[1] if len(lines) > 1 else ""

print(text.split(stop, 1)[0])
`,
    tests: [
      { name: "example from the statement", input: "END\nhelloENDworld", expectedOutput: "hello", hidden: false },
      { name: "the stop sequence never appears", input: "STOP\nno stop here", expectedOutput: "no stop here", hidden: false },
      { name: "the output starts with the stop sequence", input: "X\nXabc", expectedOutput: "", hidden: true },
      { name: "only the FIRST occurrence matters", input: "##\na##b##c", expectedOutput: "a", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-tool-call-parse",
    title: "Read a tool call",
    level: "beginner",
    isInterview: true,
    statement: [
      "One line holds a JSON object describing a tool call: a `tool` name and an `args`",
      "object.",
      "",
      "Print the tool name, then one line per argument as `key=value`, with the keys in",
      "alphabetical order. Print nothing after the name when there are no arguments.",
      "",
      "```",
      'input:  {"tool": "search", "args": {"query": "cats", "limit": 3}}',
      "output: search",
      "        limit=3",
      "        query=cats",
      "```",
    ].join("\n"),
    hints: [
      "`json.loads` turns the line into a dict. Never parse a tool call with string slicing — a value containing a brace will defeat you.",
      "`sorted(args)` iterates the keys in order; sorting makes the output stable, which is what makes it testable.",
    ],
    tags: ["tool-use", "json"],
    starterCode: `${PY_STDIN}
import json

call = json.loads(stdin)

# TODO: print the tool name, then each argument as key=value in key order
`,
    referenceSolution: `${PY_STDIN}
import json

call = json.loads(stdin)
print(call["tool"])
args = call.get("args", {})
for key in sorted(args):
    print(f"{key}={args[key]}")
`,
    tests: [
      {
        name: "example from the statement",
        input: '{"tool": "search", "args": {"query": "cats", "limit": 3}}',
        expectedOutput: "search\nlimit=3\nquery=cats",
        hidden: false,
      },
      { name: "a tool that takes nothing", input: '{"tool": "now", "args": {}}', expectedOutput: "now", hidden: false },
      {
        name: "keys come out sorted, not as written",
        input: '{"tool": "fetch", "args": {"url": "https://example.test", "retries": 0}}',
        expectedOutput: "fetch\nretries=0\nurl=https://example.test",
        hidden: true,
      },
      { name: "numeric arguments", input: '{"tool": "x", "args": {"b": 2, "a": 1}}', expectedOutput: "x\na=1\nb=2", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-retry-backoff-total",
    title: "Total wait under exponential backoff",
    level: "beginner",
    isInterview: true,
    statement: [
      "The first line holds a base delay in milliseconds. The second line holds the",
      "outcome of each attempt in order: `f` for a failure, `s` for a success.",
      "",
      "Attempts stop at the first success. Before each RETRY the client waits the base",
      "delay doubled once per previous failure. Print the total time spent waiting, in",
      "milliseconds.",
      "",
      "```",
      "input:  100",
      "        f f s",
      "output: 300",
      "```",
      "",
      "The first retry waits 100 ms and the second waits 200 ms. Nothing is waited after",
      "the final attempt, whatever its outcome.",
    ].join("\n"),
    hints: [
      "A wait happens BETWEEN attempts, so a run of n attempts has at most n - 1 waits.",
      "The wait before retry number i (counting from 1) is `base * 2 ** (i - 1)`.",
    ],
    tags: ["reliability", "backoff"],
    starterCode: `${PY_LINES}

base = int(lines[0])
outcomes = lines[1].split() if len(lines) > 1 else []

# TODO: print the total milliseconds spent waiting
`,
    referenceSolution: `${PY_LINES}

base = int(lines[0])
outcomes = lines[1].split() if len(lines) > 1 else []

total = 0
for index, outcome in enumerate(outcomes):
    if outcome == "s":
        break
    if index + 1 < len(outcomes):
        total += base * (2 ** index)

print(total)
`,
    tests: [
      { name: "example from the statement", input: "100\nf f s", expectedOutput: "300", hidden: false },
      { name: "first attempt succeeds, no wait", input: "100\ns", expectedOutput: "0", hidden: false },
      { name: "the last failure is not followed by a wait", input: "50\nf f f", expectedOutput: "150", hidden: true },
      { name: "one retry", input: "1000\nf s", expectedOutput: "1000", hidden: true },
    ],
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...base,
    slug: "ai-cosine-similarity",
    title: "Cosine similarity of two embeddings",
    level: "intermediate",
    isInterview: false,
    statement: [
      "Two lines each hold numbers separated by spaces — two vectors of equal length.",
      "",
      "Print their cosine similarity to four decimal places. Print `0.0000` when either",
      "vector has zero length.",
      "",
      "```",
      "input:  1 2 3",
      "        2 4 6",
      "output: 1.0000",
      "```",
      "",
      "Two vectors pointing the same way score 1 however long they are, which is exactly",
      "why cosine is the measure retrieval uses.",
    ].join("\n"),
    hints: [
      "Cosine is the dot product divided by the product of the two magnitudes.",
      "Guard the division: a zero vector has no direction, so there is no meaningful angle to report.",
    ],
    tags: ["embeddings", "vectors"],
    starterCode: `${PY_LINES}
import math

a = [float(part) for part in lines[0].split()] if lines else []
b = [float(part) for part in lines[1].split()] if len(lines) > 1 else []

# TODO: print the cosine similarity to four decimal places
`,
    referenceSolution: `${PY_LINES}
import math

a = [float(part) for part in lines[0].split()] if lines else []
b = [float(part) for part in lines[1].split()] if len(lines) > 1 else []

dot = sum(x * y for x, y in zip(a, b))
size_a = math.sqrt(sum(x * x for x in a))
size_b = math.sqrt(sum(y * y for y in b))

if size_a == 0 or size_b == 0:
    print("0.0000")
else:
    print(f"{dot / (size_a * size_b):.4f}")
`,
    tests: [
      { name: "example from the statement", input: "1 2 3\n2 4 6", expectedOutput: "1.0000", hidden: false },
      { name: "at right angles", input: "1 0\n0 1", expectedOutput: "0.0000", hidden: false },
      { name: "a forty-five degree angle", input: "1 1\n1 0", expectedOutput: "0.7071", hidden: true },
      { name: "a zero vector has no direction", input: "0 0\n1 1", expectedOutput: "0.0000", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-top-k-retrieval",
    title: "Retrieve the k nearest documents",
    level: "intermediate",
    isInterview: false,
    statement: [
      "The first line holds `k`. The second line is the query vector. Each remaining line",
      "holds a document id then its vector, all separated by spaces.",
      "",
      "Print the ids of the `k` documents most similar to the query by cosine, most",
      "similar first, one per line. Break ties by id alphabetically. Print fewer lines",
      "when there are fewer than `k` documents.",
      "",
      "```",
      "input:  2",
      "        1 0",
      "        docA 1 0",
      "        docB 0 1",
      "        docC 0.9 0.1",
      "output: docA",
      "        docC",
      "```",
    ].join("\n"),
    hints: [
      "Sort by a tuple: `(-similarity, doc_id)`. Negating the score gives you descending order while the id stays ascending.",
      "Slicing past the end of a list is safe in Python, so `ranked[:k]` already handles having fewer documents than k.",
    ],
    tags: ["retrieval", "embeddings", "sorting"],
    starterCode: `${PY_LINES}
import math

k = int(lines[0])
query = [float(part) for part in lines[1].split()]
docs = [line.split() for line in lines[2:] if line.strip()]

# TODO: print the k most similar document ids, most similar first
`,
    referenceSolution: `${PY_LINES}
import math

k = int(lines[0])
query = [float(part) for part in lines[1].split()]
docs = [line.split() for line in lines[2:] if line.strip()]

def cosine(vector):
    dot = sum(x * y for x, y in zip(query, vector))
    size = math.sqrt(sum(x * x for x in query)) * math.sqrt(sum(y * y for y in vector))
    return dot / size if size else 0.0

scored = [(cosine([float(part) for part in doc[1:]]), doc[0]) for doc in docs]
scored.sort(key=lambda pair: (-pair[0], pair[1]))

for _, doc_id in scored[:k]:
    print(doc_id)
`,
    tests: [
      {
        name: "example from the statement",
        input: "2\n1 0\ndocA 1 0\ndocB 0 1\ndocC 0.9 0.1",
        expectedOutput: "docA\ndocC",
        hidden: false,
      },
      { name: "k of one", input: "1\n1 1\nx 1 1\ny 1 0", expectedOutput: "x", hidden: false },
      { name: "fewer documents than k, tie broken by id", input: "3\n1 0\nb 1 0\na 1 0", expectedOutput: "a\nb", hidden: true },
      { name: "the query points the other way", input: "1\n0 1\np 1 0\nq 0 1", expectedOutput: "q", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-chunk-with-overlap",
    title: "Chunk a document with overlap",
    level: "intermediate",
    isInterview: false,
    statement: [
      "The first line holds `size overlap`. The second line holds the document's words.",
      "",
      "Print the chunks, one per line, each of at most `size` words. Each chunk starts",
      "`size - overlap` words after the previous one, so consecutive chunks share",
      "`overlap` words. The final chunk may be shorter.",
      "",
      "```",
      "input:  3 1",
      "        a b c d e",
      "output: a b c",
      "        c d e",
      "        e",
      "```",
      "",
      "The overlap exists so a sentence split across a boundary still appears whole in",
      "one chunk.",
    ].join("\n"),
    hints: [
      "The step is `size - overlap`. If that were zero the loop would never advance, which is why overlap must be smaller than size.",
      "`words[start:start + size]` is safe past the end of the list, so the short final chunk needs no special case.",
    ],
    tags: ["chunking", "retrieval", "strings"],
    starterCode: `${PY_LINES}

size, overlap = (int(part) for part in lines[0].split())
words = lines[1].split() if len(lines) > 1 else []

# TODO: print each chunk on its own line
`,
    referenceSolution: `${PY_LINES}

size, overlap = (int(part) for part in lines[0].split())
words = lines[1].split() if len(lines) > 1 else []

step = max(1, size - overlap)
start = 0
while start < len(words):
    print(" ".join(words[start:start + size]))
    start += step
`,
    tests: [
      { name: "example from the statement", input: "3 1\na b c d e", expectedOutput: "a b c\nc d e\ne", hidden: false },
      { name: "no overlap", input: "2 0\na b c", expectedOutput: "a b\nc", hidden: false },
      { name: "one word, one chunk", input: "3 0\na", expectedOutput: "a", hidden: true },
      { name: "an overlap of one on pairs", input: "2 1\na b c", expectedOutput: "a b\nb c\nc", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-dedupe-citations",
    title: "Deduplicate the citations",
    level: "intermediate",
    isInterview: true,
    statement: [
      "Each line holds a document id that a model cited, in the order it cited them.",
      "",
      "Print the distinct ids on one line, comma-separated, in the order they were FIRST",
      "cited. First-cited order matters: it is the order the answer refers to them in.",
      "",
      "```",
      "input:  d1",
      "        d2",
      "        d1",
      "        d3",
      "output: d1,d2,d3",
      "```",
    ].join("\n"),
    hints: [
      "A `set` answers 'have I seen this' quickly but forgets the order. Use it alongside a list, not instead of one.",
      "`dict.fromkeys(ids)` does both at once in modern Python — worth knowing why that works.",
    ],
    tags: ["citations", "hash-set", "ordering"],
    starterCode: `${PY_LINES}

ids = [line.strip() for line in lines if line.strip()]

# TODO: print the distinct ids in first-seen order, comma-separated
`,
    referenceSolution: `${PY_LINES}

ids = [line.strip() for line in lines if line.strip()]

seen = set()
ordered = []
for doc_id in ids:
    if doc_id not in seen:
        seen.add(doc_id)
        ordered.append(doc_id)

print(",".join(ordered))
`,
    tests: [
      { name: "example from the statement", input: "d1\nd2\nd1\nd3", expectedOutput: "d1,d2,d3", hidden: false },
      { name: "a single citation", input: "x", expectedOutput: "x", hidden: false },
      { name: "the same id three times", input: "a\na\na", expectedOutput: "a", hidden: true },
      { name: "first-seen order is not alphabetical", input: "b\na\nb\nc\na", expectedOutput: "b,a,c", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-required-arguments",
    title: "Check a tool call has what it needs",
    level: "intermediate",
    isInterview: true,
    statement: [
      "The first line lists the argument names a tool requires, separated by spaces. The",
      "second line is a JSON object of the arguments the model actually supplied.",
      "",
      "Print `ok` when every required name is present. Otherwise print the missing names,",
      "sorted alphabetically and comma-separated.",
      "",
      "A name present with a null value counts as present — the model answered the",
      "question, and 'omitted' and 'explicitly empty' are different failures.",
      "",
      "```",
      "input:  name age",
      '        {"name": "Ada"}',
      "output: age",
      "```",
    ].join("\n"),
    hints: [
      "`key in obj` tests presence. `obj.get(key)` returns None both for a missing key and for a key whose value is null — a different question.",
      "Sort the missing names so the message is stable; an unstable error message is one nobody can write a test for.",
    ],
    tags: ["tool-use", "validation", "json"],
    starterCode: `${PY_LINES}
import json

required = lines[0].split() if lines else []
supplied = json.loads(lines[1]) if len(lines) > 1 else {}

# TODO: print "ok", or the missing names sorted and comma-separated
`,
    referenceSolution: `${PY_LINES}
import json

required = lines[0].split() if lines else []
supplied = json.loads(lines[1]) if len(lines) > 1 else {}

missing = sorted(name for name in required if name not in supplied)
print(",".join(missing) if missing else "ok")
`,
    tests: [
      { name: "example from the statement", input: 'name age\n{"name": "Ada"}', expectedOutput: "age", hidden: false },
      { name: "everything supplied", input: 'name age\n{"name": "Ada", "age": 36}', expectedOutput: "ok", hidden: false },
      { name: "nothing supplied", input: "a b c\n{}", expectedOutput: "a,b,c", hidden: true },
      { name: "a null value still counts as present", input: 'z\n{"z": null}', expectedOutput: "ok", hidden: true },
    ],
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "ai-conversation-window",
    title: "Assemble a context window",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds a token budget. Each remaining line holds a message as",
      "`role tokens`, oldest first.",
      "",
      "Every `system` message is kept regardless of the budget — dropping the",
      "instructions changes what the model IS. The remaining budget is then spent on the",
      "newest other messages, working backwards.",
      "",
      "Print the line numbers of the kept messages — 1 for the first message after the",
      "budget line — in ascending order, space-separated. Print `none` when nothing is",
      "kept.",
      "",
      "```",
      "input:  10",
      "        system 4",
      "        user 3",
      "        assistant 3",
      "        user 3",
      "output: 1 3 4",
      "```",
    ].join("\n"),
    hints: [
      "Two passes: reserve the system messages first, then fill what is left from the newest end.",
      "The system messages can exhaust or exceed the budget on their own. That is allowed here, and it means no other message is kept.",
    ],
    tags: ["context-window", "greedy", "prioritisation"],
    starterCode: `${PY_LINES}

budget = int(lines[0])
messages = [line.split() for line in lines[1:] if line.strip()]

# TODO: print the kept line numbers in ascending order, or "none"
`,
    referenceSolution: `${PY_LINES}

budget = int(lines[0])
messages = [line.split() for line in lines[1:] if line.strip()]

kept = set()
used = 0
for index, (role, tokens) in enumerate(messages, start=1):
    if role == "system":
        kept.add(index)
        used += int(tokens)

for index in range(len(messages), 0, -1):
    role, tokens = messages[index - 1]
    if role == "system":
        continue
    if used + int(tokens) > budget:
        break
    used += int(tokens)
    kept.add(index)

print(" ".join(str(index) for index in sorted(kept)) if kept else "none")
`,
    tests: [
      {
        name: "example from the statement",
        input: "10\nsystem 4\nuser 3\nassistant 3\nuser 3",
        expectedOutput: "1 3 4",
        hidden: false,
      },
      { name: "the system message uses the whole budget", input: "3\nsystem 3\nuser 1", expectedOutput: "1", hidden: false },
      { name: "a budget of zero with no system message", input: "0\nuser 1", expectedOutput: "none", hidden: true },
      { name: "two system messages are both kept", input: "5\nsystem 2\nsystem 3\nuser 1", expectedOutput: "1 2", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-rate-limiter-window",
    title: "How many requests the limiter refuses",
    level: "advanced",
    isInterview: false,
    statement: [
      "The first line holds `limit windowMs`. The second line holds request timestamps in",
      "milliseconds, ascending.",
      "",
      "A request is refused when `limit` requests have ALREADY BEEN ACCEPTED strictly",
      "inside the preceding window — that is, at a timestamp `t` where",
      "`now - t < windowMs`. A refused request does not count towards the limit.",
      "",
      "Print how many requests are refused.",
      "",
      "```",
      "input:  2 1000",
      "        0 100 200 1100",
      "output: 1",
      "```",
    ].join("\n"),
    hints: [
      "Only ACCEPTED timestamps belong in the window. Counting refused ones too makes a burst permanently self-blocking.",
      "The boundary is strict: a request exactly `windowMs` after an accepted one is outside the window and is allowed.",
    ],
    tags: ["rate-limiting", "sliding-window", "simulation"],
    starterCode: `${PY_LINES}
from collections import deque

limit, window = (int(part) for part in lines[0].split())
times = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

# TODO: print how many requests are refused
`,
    referenceSolution: `${PY_LINES}
from collections import deque

limit, window = (int(part) for part in lines[0].split())
times = [int(part) for part in lines[1].split()] if len(lines) > 1 else []

accepted = deque()
refused = 0
for now in times:
    while accepted and now - accepted[0] >= window:
        accepted.popleft()
    if len(accepted) >= limit:
        refused += 1
    else:
        accepted.append(now)

print(refused)
`,
    tests: [
      { name: "example from the statement", input: "2 1000\n0 100 200 1100", expectedOutput: "1", hidden: false },
      { name: "a limit of one", input: "1 500\n0 100", expectedOutput: "1", hidden: false },
      { name: "everything fits under the limit", input: "3 1000\n0 1 2", expectedOutput: "0", hidden: true },
      { name: "exactly on the boundary is allowed", input: "1 100\n0 100 200", expectedOutput: "0", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-normalise-embedding",
    title: "Normalise an embedding",
    level: "advanced",
    isInterview: false,
    statement: [
      "One line holds a vector's components separated by spaces.",
      "",
      "Print the same vector scaled to length 1, each component to four decimal places,",
      "space-separated. Print `zero` when the vector has zero length.",
      "",
      "```",
      "input:  3 4",
      "output: 0.6000 0.8000",
      "```",
      "",
      "Normalising up front is what lets a retrieval index compare vectors with a plain",
      "dot product instead of recomputing magnitudes on every query.",
    ].join("\n"),
    hints: [
      "Divide every component by the vector's magnitude, `sqrt(sum of squares)`.",
      "The zero vector has no direction, so there is nothing to normalise — say so rather than dividing by zero.",
    ],
    tags: ["embeddings", "vectors", "formatting"],
    starterCode: `${PY_NUMS.replace("int(part)", "float(part)")}
import math

# TODO: print the unit vector to four decimal places, or "zero"
`,
    referenceSolution: `${PY_NUMS.replace("int(part)", "float(part)")}
import math

size = math.sqrt(sum(value * value for value in nums))
if size == 0:
    print("zero")
else:
    print(" ".join(f"{value / size:.4f}" for value in nums))
`,
    tests: [
      { name: "example from the statement", input: "3 4", expectedOutput: "0.6000 0.8000", hidden: false },
      { name: "already a unit vector", input: "1 0 0", expectedOutput: "1.0000 0.0000 0.0000", hidden: false },
      { name: "the zero vector", input: "0 0", expectedOutput: "zero", hidden: true },
      { name: "a negative component keeps its sign", input: "-3 4", expectedOutput: "-0.6000 0.8000", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-prefix-cache-reuse",
    title: "Longest reusable stretch of tokens",
    level: "advanced",
    isInterview: true,
    statement: [
      "Two lines each hold token ids separated by spaces.",
      "",
      "Print the length of the longest run of tokens that appears, unbroken and in the",
      "same order, in both lines.",
      "",
      "```",
      "input:  1 2 3 4",
      "        9 2 3 5",
      "output: 2",
      "```",
      "",
      "This is the quantity a prompt cache actually charges on: not how many tokens two",
      "prompts share, but how long a CONTIGUOUS stretch they share.",
    ].join("\n"),
    hints: [
      "Build a table where cell (i, j) is the length of the common run ENDING at those two positions. It is 0 when the tokens differ.",
      "When the tokens match, the cell is one more than the cell diagonally before it. The answer is the largest cell anywhere in the table.",
    ],
    tags: ["dynamic-programming", "caching", "arrays"],
    starterCode: `${PY_LINES}

first = lines[0].split() if lines else []
second = lines[1].split() if len(lines) > 1 else []

# TODO: print the length of the longest shared contiguous run
`,
    referenceSolution: `${PY_LINES}

first = lines[0].split() if lines else []
second = lines[1].split() if len(lines) > 1 else []

previous = [0] * (len(second) + 1)
best = 0
for i in range(1, len(first) + 1):
    current = [0] * (len(second) + 1)
    for j in range(1, len(second) + 1):
        if first[i - 1] == second[j - 1]:
            current[j] = previous[j - 1] + 1
            if current[j] > best:
                best = current[j]
    previous = current

print(best)
`,
    tests: [
      { name: "example from the statement", input: "1 2 3 4\n9 2 3 5", expectedOutput: "2", hidden: false },
      { name: "nothing shared", input: "1 2\n3 4", expectedOutput: "0", hidden: false },
      { name: "a repeated token does not extend the run beyond the shorter line", input: "1 1 1\n1 1", expectedOutput: "2", hidden: true },
      { name: "one token each", input: "5\n5", expectedOutput: "1", hidden: true },
    ],
  },
  {
    ...base,
    slug: "ai-cost-estimate",
    title: "Estimate what a run cost",
    level: "advanced",
    isInterview: true,
    statement: [
      "The first line holds two whole numbers: the price in cents per 1000 prompt tokens",
      "and per 1000 completion tokens. Each remaining line holds one request's",
      "`promptTokens completionTokens`.",
      "",
      "Print the total cost in cents to two decimal places.",
      "",
      "```",
      "input:  300 1500",
      "        1000 500",
      "output: 1050.00",
      "```",
      "",
      "Completion tokens are usually priced several times higher than prompt tokens,",
      "which is why a verbose system prompt is often cheaper than a verbose answer.",
    ].join("\n"),
    hints: [
      "Sum the two token totals first, then price them once. Pricing each request separately and rounding as you go accumulates error.",
      "Divide by 1000 at the end, and format with `f\"{total:.2f}\"` so the output is stable.",
    ],
    tags: ["cost", "arithmetic", "formatting"],
    starterCode: `${PY_LINES}

prompt_rate, completion_rate = (int(part) for part in lines[0].split())
requests = [line.split() for line in lines[1:] if line.strip()]

# TODO: print the total cost in cents to two decimal places
`,
    referenceSolution: `${PY_LINES}

prompt_rate, completion_rate = (int(part) for part in lines[0].split())
requests = [line.split() for line in lines[1:] if line.strip()]

prompt_tokens = sum(int(row[0]) for row in requests)
completion_tokens = sum(int(row[1]) for row in requests)
total = (prompt_tokens * prompt_rate + completion_tokens * completion_rate) / 1000

print(f"{total:.2f}")
`,
    tests: [
      { name: "example from the statement", input: "300 1500\n1000 500", expectedOutput: "1050.00", hidden: false },
      { name: "no tokens, no cost", input: "100 100\n0 0", expectedOutput: "0.00", hidden: false },
      { name: "several requests add up", input: "300 1500\n500 100\n500 100", expectedOutput: "600.00", hidden: true },
      { name: "a cost below one cent still prints two places", input: "1 1\n1 1", expectedOutput: "0.00", hidden: true },
    ],
  },
];
