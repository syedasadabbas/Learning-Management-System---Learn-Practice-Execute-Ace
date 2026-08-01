# Security review — add-on wave

Scope: the code that landed in the add-on wave (learning enhancements, live
classes, presentations) — 37 route files under `src/app/api/**`, the feature
flag layer, `services/realtime`, and the presentation export path.

Method: every claim below was checked by reading the code at the cited line.
Where something was **not** verified it says so; nothing here is inferred from a
doc comment alone. Line numbers are as of the commit that carries this file.

Reviewed on: 2026-08-01. Reviewer: automated review pass (SUBAGENT 7).

---

## Summary

| # | Severity | Finding | File |
|---|---|---|---|
| 1 | Medium | `GET /api/classes/upcoming` has no cohort scoping | `src/app/api/classes/upcoming/route.ts:117` |
| 2 | Medium | Presentation grading is not owner-scoped | `src/app/api/presentations/submissions/[submissionId]/grade/route.ts:98` |
| 3 | Low | Reference solutions readable by any signed-in user, no attempt gate | `src/app/api/practice-problems/[problemId]/solution/route.ts:57` |
| 4 | Low | Export re-renders stored slide JSON without re-applying the hex/URL validators | `src/lib/presentations/export/html.ts:92,150` |
| 5 | Info | Nothing mints a realtime handshake token — the socket path is unreachable | `src/lib/live-classes/use-realtime.ts:22` |
| 6 | Info | Realtime CORS allowlist is correct but **untested** | `services/realtime/src/server.ts:101` |
| 7 | Info | Three environment variables are read by code and undocumented | see §C |

**Checked and found clean** (details in the sections below): answer-key
projections, feature-gate ordering, SQL injection, the handshake token's
cryptography, committed secrets.

---

## 1. Answer-key exposure — CLEAN, with one product caveat (Finding 3)

Grepped `solution_code`, `solution_explanation`, `solutionCode`,
`solutionExplanation`, `sample_answer`, `sampleAnswer`, `answer_key`,
`correctAnswer` and `explanation` across `src/app/api/`. Every hit was read.

**Routes that could have leaked an answer key and do not:**

| Route | What it selects instead |
|---|---|
| `GET /api/lectures/:id/practice-problems` | `solutionAvailable: sql\`${practiceProblems.solutionCode} is not null\`` — a boolean, `practice-problems/route.ts:115` |
| `GET /api/practice-problems/:id` | same boolean projection, `route.ts:68` |
| `GET /api/interview-questions` | `hasSampleAnswer` boolean, `route.ts:124` |
| `POST /api/practice-problems/:id/attempt` | never names the solution columns |
| `GET /api/weeks/:id/quiz` | no `options.isCorrect`, no `questions.explanation` |
| `GET /api/exams/:id` | no `options.isCorrect`, no `explanation`, no `tests` |
| `GET /api/quizzes/:id/attempts` | aggregate only, no per-question detail |

The remaining hits are **write** paths (`POST`/`PUT`) behind
`apiGuard("instructor")`, which is correct — an instructor authors the answer.

The projections are centralised in `src/lib/learning/projection.ts`
(`practiceProblemSolutionColumns` is the only exported column list that names
the solution columns) so the safe default is structural rather than per-route.
That is the right shape.

### Finding 3 — Low: reference solutions have no attempt gate

`src/app/api/practice-problems/[problemId]/solution/route.ts:57`

```
const gate = await apiGuard("student");
```

Any signed-in user may `GET` the full `solutionCode` / `solutionExplanation` /
`solutionScreenshotUrl` for **any** practice problem at any time. There is no
"you must attempt it first" condition.

- **What an attacker achieves:** nothing an honest student cannot also do. A
  student reads the model answer without attempting the exercise.
- **Why this is Low and not Medium:** practice problems are **ungraded** and no
  score anywhere in the LMS derives from them — verified: `practice_problems`
  has no attempts ledger, in contrast to `coding_problems`/`coding_attempts` in
  `src/db/schema.learning.ts`. There is no integrity boundary to cross.
- **Fix, if the course owner wants a gate:** add a `practice_problem_attempts`
  table and an `EXISTS` subquery in the `WHERE` of this handler. A gate keyed on
  a client-supplied "I attempted it" flag would be forgeable in one line and is
  not worth building.

`GET /api/interview-questions/:id` returning `sampleAnswer` to a student is the
**intended** behaviour — these are study material, and the list endpoint is the
one that withholds it. Not a finding.

---

## 2. Authorization

### Method

For each of the 37 route files, checked whether ownership is expressed as a
`WHERE` clause on the statement (correct — the row is never fetched) or as a
post-fetch `if` (incorrect — the row is in memory and one refactor away from
being returned).

### Result: WHERE clauses, consistently

Ownership is centralised in two helpers and both return a Drizzle `SQL`
predicate, not a boolean:

- `src/lib/live-classes/access.ts:57` — `ownershipFilter(user)` returns
  `eq(liveClasses.instructorId, user.id)` for an instructor and `undefined` for
  an admin, which is Drizzle's "no additional constraint" value, so handlers
  spread it into `and(...)` without branching. Imported by `start`, `end`,
  `attendance`, `attendance/[studentId]`, `qa/[questionId]`,
  `qa/[questionId]/answer`, `recording` and `classes/[classId]`.
- `src/app/api/presentations/_access.ts:73,92` — `readableFilter` /
  the writable filter, same shape, keyed on `presentations.creatorId`.

Spot-checked and correct:

- `classes/[classId]/chat/[messageId]/route.ts:135,171` — edit is author-only, a
  moderator gets `undefined` (no restriction) for delete. Expressed as `scope`
  and ANDed into the `UPDATE`.
- `classes/[classId]/qa/[questionId]/upvote/route.ts:125` —
  `ne(classQa.studentId, gate.user.id)` in the `WHERE`, so self-upvote is
  refused by the statement rather than by a check.
- `presentations/submissions/route.ts:83` — a non-staff caller gets
  `eq(presentationSubmissions.studentId, gate.user.id)` pushed into the filter.
- `presentations/[presentationId]/feedback/route.ts:95` — scoped to
  `fromUserId` or `toUserId` being the caller.

Note on role semantics: `apiGuard("student")` is a **minimum** role, so
instructors and admins also pass it. That is the house idiom
(`ROLES_SATISFYING`), not a bug, but it means a route guarded `"student"` is
guarded "any authenticated user".

### Finding 1 — Medium: `GET /api/classes/upcoming` has no cohort scoping

`src/app/api/classes/upcoming/route.ts:117-121`

```
const isStaff = gate.user.role === "instructor" || gate.user.role === "admin";
if (isStaff) {
  filters.push(eq(liveClasses.instructorId, gate.user.id));
}
```

Staff are scoped to their own classes. **Students are not scoped at all** — the
only student-side filter is `isArchived = false` plus the time window.

- **What an attacker achieves:** an authenticated student enumerates every
  non-archived class scheduled in the next 1–90 days across every cohort —
  title, scheduled time, status, week and lecture ids, and the instructor's
  name (the sibling detail route joins `users`). It is a confidentiality leak of
  scheduling metadata, not of class content: joining a class still goes through
  `POST /api/classes/:id/join` and `canJoin`.
- **Why it exists:** verified structural, not an oversight —
  `live_classes.week_id` points at `weeks`, and `weeks` carries no cohort
  column, so there is no column to filter on. The handler documents this
  honestly at lines 65-72.
- **Blast radius today:** `DECISIONS.md` records `concurrentCohorts: false`.
  With one cohort running, every student is entitled to every class and the gap
  has no practical effect. It becomes a real leak the day a second cohort runs.
- **Fix:** add a cohort column to `weeks` (or a `cohort_id` on `live_classes`),
  then `innerJoin` the caller's enrolment and AND it into `filters`. Until then,
  **do not enable live classes for two concurrent cohorts.**

### Finding 2 — Medium: presentation grading is not owner-scoped

`src/app/api/presentations/submissions/[submissionId]/grade/route.ts:98-110`

```
.update(presentationSubmissions)
.set({ score, feedback, rubricScores, gradedBy: gate.user.id, gradedAt, status: "graded" })
.where(eq(presentationSubmissions.id, submissionId))
```

The only predicate is the submission id. `apiGuard("instructor")` admits **every**
instructor equally.

- **What an attacker achieves:** any account with the instructor role can set or
  overwrite the score, feedback and rubric on any presentation submission in the
  system, including one already graded by a colleague. There is no audit of the
  previous value — `gradedBy` is overwritten with the new grader, so the
  original grade is gone. That is a grade-integrity issue, and grades feed the
  leaderboard.
- **Why it exists:** verified structural in the same way as Finding 1 —
  `presentation_submissions` hangs off an assignment, and assignments have no
  owning instructor column, so there is nothing to scope by. Contrast the class
  routes, which do have `live_classes.instructor_id` and do use it.
- **Trust model:** this is an *insider* issue. It requires an instructor
  account. Whether that matters depends on how many instructor accounts exist
  and how much they are trusted — with a single instructor it is theoretical.
- **Fix:** give `assignments` an owning instructor (or add a
  `presentation_assignments.instructor_id`), then AND
  `ownershipFilter`-equivalent into the `UPDATE`, exactly as
  `classes/[classId]/end/route.ts` does. Interim mitigation: keep the instructor
  role scarce, and note that `gradedBy`/`gradedAt` at least record *who* graded
  last.

---

## 3. Feature-flag gate — CLEAN, 37 / 37

`featureGate` (`src/lib/feature-guard.ts:47`) returns a 404 `Response` with
`cache-control: no-store` and a body identical to an unrouted path — no hint
that a flag was involved.

**Counted:** 37 of the 37 add-on route files import and call `featureGate`.
Zero routes are missing the gate.

**Ordering:** in every one of the 37 files, and in every HTTP method within
those files, `featureGate(...)` appears *before* `apiGuard(...)`. Verified
mechanically by extracting the first four guard-related lines of each file; the
`featureGate` line number is lower than the `apiGuard` line number in all 37
(e.g. `presentations/route.ts:51` gate → `:54` auth; `classes/upcoming/route.ts:73`
gate → `:76` auth).

This is the correct order. Inverted, an unauthenticated probe would get 401
instead of 404 and thereby learn that the endpoint exists — leaking the route
map of a disabled feature.

**Flag parsing** (`src/lib/features.ts:38`) is strict: `raw?.trim() === "true"`.
Not `"1"`, not `"TRUE"`. Unset means off. All three flags default off. The
`NEXT_PUBLIC_*` variants are written as full static member expressions so Next.js
inlines them at build time — verified, and worth preserving, because
`process.env[name]` is not inlined and would silently read `false` in the
browser.

---

## 4. Injection — CLEAN

**Drizzle paths.** No string-concatenated SQL found in any of the 37 route
files. Dynamic filters are built as arrays of `SQL` predicates and combined with
`and(...)`/`or(...)`. The three `sql\`...\`` template uses in the add-on routes
(`practice-problems/route.ts:115`, `practice-problems/[problemId]/route.ts:68`,
`interview-questions/route.ts:124`) interpolate **Drizzle column references**,
not values, which Drizzle renders as identifiers.

**Raw `pg` in `services/realtime/src/store/pg.ts`** — hand-audited. Every
`pool.query` / `client.query` uses `$1`-style placeholders with a separate
values array. The only template interpolations in the whole file are at lines
238, 249, 281 and 413, and all four interpolate `CHAT_COLUMNS` / `QA_COLUMNS`,
which are **module-level `const` string literals** (lines 154 and 174) with no
input path. Confirmed by grepping every `${` in the file — there are exactly
four and those are they.

The `reactions` update at lines 375-394 builds one of two fixed SQL strings by a
boolean branch (`input.add ? ... : ...`) and passes the user-controlled values
as parameters. No interpolation of user data.

No `LIMIT`/`OFFSET`/`ORDER BY` is built from unparameterised input in this file.

---

## 5. Realtime handshake — CLEAN

`src/lib/live-classes/realtime-token.ts`

Verified properties:

- **The client cannot assert its own identity.** The token is minted
  server-side from a session the Next app already holds; `userId`, `role` and
  `classId` are claims inside the MAC'd payload. A client editing any of them
  invalidates the signature. The service reads identity from the verified
  claims, never from the socket payload — `services/realtime/src/auth/middleware.ts`
  takes the token from `handshake.auth.token`.
- **No insecure default for the secret.** `mintRealtimeToken` (line 179)
  **throws** on an empty or whitespace secret rather than producing a token
  anyone could forge. `verifyRealtimeToken` (line 223) returns
  `bad_signature` when the secret is empty rather than accepting. There is no
  `|| "secret"` fallback anywhere — grepped.
  `services/realtime/src/config.ts` refuses to boot without it.
- **Verification order is shape → signature → expiry** (line 223 onward). Expiry
  is read only after the MAC verifies, so the timestamp compared against is one
  the server itself signed.
- **`timingSafeEqual` is used correctly** (line 133): the length mismatch that
  makes `timingSafeEqual` *throw* is short-circuited first. Since base64url
  SHA-256 is a fixed 43 characters, a length mismatch already means "not our
  signature" and reveals nothing the attacker did not supply.
- **Token parsing is strict.** Length ceiling of 1024 chars checked before any
  parsing (line 88); exactly one `.` separator required, so a JWT-shaped value
  is rejected rather than partially parsed.
- **Role widening is guarded.** `roleFromDb` returns `null` for an unrecognised
  role rather than defaulting to `"student"` — correct, because defaulting an
  unreviewed role to the least-privileged one still admits it.
- **TTL 120 s**, replay within that window is possible by design and the module
  says so. Acceptable for a single WebSocket upgrade.

### Finding 5 — Info: nothing mints a token

Grepped `mintRealtimeToken` across `src/`: the only non-test references are the
definition itself and a comment. **No API route calls it.** Combined with
`socket.io-client` not being in `package.json`, the browser has no way to obtain
the credential and no way to open a socket.

This is a **functionality gap, not a vulnerability** — it fails closed, and the
degraded REST-history path is the documented supported state. Recorded here
because a reader of this review would otherwise conclude the handshake is a live
attack surface. It is not currently reachable from a browser at all.

---

## 6. XSS in the HTML export — CLEAN, with a defence-in-depth note

`src/lib/presentations/export/html.ts`

`escapeHtml` (line 34) escapes `&` first, then `<`, `>`, `"`, `'` — the correct
order; escaping `&` last would double-escape the entities just introduced.

Every interpolation into the output document was checked. All of them pass
through `escapeHtml`: bullets (46), column heading and body (54, 55), titles and
subtitles (65, 68, 73, 80, 91, 103), code content and its `data-language`
attribute (81-83), image `src` and `alt` (92), captions (86, 97), quote and
attribution (111, 114), speaker notes (143), the `data-type` attribute (152), the
document `<title>` (173), and the deck title and description (225, 229). No
`innerHTML`, no `dangerouslySetInnerHTML`, no markdown renderer, no unescaped
path found.

**Write-time validation** in `src/lib/presentations/types.ts` is real:
`hexColorSchema` (line 50) is `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` and
`externalUrlSchema` (line 65) is `/^https?:\/\//i`, applied at
`backgroundColor` (129) and `src` (171).

### Finding 4 — Low: the export path does not re-apply those two validators

The export handler (`src/app/api/presentations/[presentationId]/export/route.ts:222`)
reads `presentations.slidesJson` from the database and runs it through
`parseSlideDeck`. **Not verified:** whether `parseSlideDeck` re-runs the full zod
schema including `hexColorSchema` and `externalUrlSchema`, or only checks the
deck's structural shape. I did not read `parseSlideDeck`'s implementation.

Either way the exposure is bounded by escaping:

- `backgroundColor` lands in `style="background:${escapeHtml(...)}"` (line 150).
  `escapeHtml` escapes `"`, so an attribute breakout is impossible. A CSS
  injection *within* the `style` attribute would remain possible if the hex
  validator were bypassed — modern browsers do not execute `expression()`, so
  the realistic ceiling is visual defacement of the exporter's own file.
- `src` lands in `<img src="${escapeHtml(...)}">` (line 92). A `javascript:` URL
  in an `<img src>` does not execute in any current browser.

- **Severity Low** on that basis, and it is defence-in-depth rather than a live
  bug: to reach it, a row would have to enter the database bypassing the write
  routes.
- **Fix:** have `parseSlideDeck` validate against the same zod schema the write
  path uses, so "what leaves is what validates" holds on the read side too. The
  JSON branch of the export already claims that property (line 249 comment).

The filename derivation (line 238) is correct — `replace(/[^A-Za-z0-9._-]+/g, "-")`
reduces rather than escapes, so a traversal sequence cannot survive.

---

## 7. CORS on the realtime service — correct, and untested

`services/realtime/src/server.ts:101-105` sets
`cors: { origin: config.allowedOrigins, credentials: true, methods: ["GET","POST"] }`.
`config.allowedOrigins` is an exact-match array parsed from `ALLOWED_ORIGINS`
(`config.ts:114`), and `config.ts:117` **refuses to boot** when the list is empty
or when it is set to `"*"`.

### Finding 6 — Info: no test exercises it

The integration suite connects with a Node Socket.io client, which sends **no
`Origin` header**, so the CORS layer is never exercised by the 135 passing
tests. The allowlist is correct by reading; it is **not verified by execution**.
Verifying it requires a real browser (Playwright) pointed at a deployed service,
or a raw HTTP request with a forged `Origin` header against the polling
transport. Neither has been done.

---

## 8. Secrets — CLEAN

- `.gitignore` lines 3-4 cover `.env` and `.env*.local`.
- `git ls-files | grep -i '\.env'` returns exactly two paths: `.env.example` and
  `services/realtime/.env.example`. The developer's real `.env` exists on disk
  and is **not** tracked.
- Both `.env.example` files were read end to end. Every value is a placeholder
  (`replace-with-32-plus-char-random-string`, `postgresql://USER:PASSWORD@...`,
  `http://localhost:3000`) or an empty assignment. No real credential, no real
  hostname, no API key.
- `REALTIME_SHARED_SECRET=` in the root example is empty, and the code treats
  empty as "refuse", not as "use a default". Correct.

---

## Non-findings — checked, deliberately not reported as issues

Listed so a later reviewer does not re-do the work:

- **404-vs-403 on disabled features** — intentional and correct.
- **Admins bypass class ownership** (`access.ts:45`) — a deliberate documented
  product decision (an admin covering for an absent instructor), not a gap.
- **`apiGuard("student")` on instructor-reachable routes** — house idiom for
  "minimum role", not a mis-guard.
- **Hint metering** (`practice-problems/:id/hints`) is explicitly *not* a
  security boundary and the code says so. `upTo=10` returns the whole ladder to
  anyone. Teaching material; not a finding.
- **The 120 s token replay window** — accepted, documented, proportionate.
