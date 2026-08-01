# Release notes — the add-on wave

Three features: **learning enhancements**, **live classes**, **presentations**.
All three ship behind flags that default **off**.

This document is written to be useful rather than flattering. The readiness
section says what was measured and, at greater length, what was not. Where a
number appears it was observed on 2026-08-01 on the reviewer's machine; where
something was not run, it says so.

---

## What was delivered

### Database

- Migrations `0006_narrow_deathbird.sql` and `0007_faithful_dragon_lord.sql`,
  **both already applied to the production Neon database**.
- 13 new tables plus `class_qa_votes` across three sibling schema modules
  (`schema.learning.ts`, `schema.live-classes.ts`, `schema.presentations.ts`),
  17 additive columns on `lectures` / `assignments` / `questions`, and 34 CHECK
  constraints pushed into Postgres rather than duplicated across call sites.
- Both migrations are purely additive — zero `DROP`, zero `ALTER COLUMN`.

### API

- 64 handlers across **37 route files** under `src/app/api/**`.
- Every one of the 37 calls `featureGate` **before** its auth guard, so a
  disabled feature is a uniform 404 to everyone rather than a 401 that advertises
  the route exists.

### Feature flags

`src/lib/features.ts` and `src/lib/feature-guard.ts`. Three features, six
variables (a server one and a `NEXT_PUBLIC_` one each), strict `"true"`-only
parsing, all off by default. A preview deployment nobody configured behaves
exactly as the LMS did before this wave.

### Realtime service

`services/realtime/` — a standalone Socket.io server (`@lms/realtime`) with its
own `package.json`, host-agnostic, with Dockerfile, `fly.toml` and
`railway.json`. HMAC-SHA256 handshake tokens, presence, rate limiting, an
in-memory store and a Postgres store.

### UI

- `src/components/learn/visualizations/` — six interactive concept visualizers.
- `src/components/presentations/` — the Reveal.js layer, presenter view, export.

### Documentation

`SCHEMA_ENHANCEMENT.md`, `DEPLOYMENT.md`, `DEPLOYMENT_LIVE_CLASSES.md`,
`DECISIONS.md`, `SECURITY_REVIEW_ADDON_WAVE.md`, this file.

---

## Readiness — measured

Observed by running the commands on 2026-08-01:

| Gate | Result |
|---|---|
| `npm run typecheck` | **Clean.** No output, exit 0. |
| `npm run lint` | **Clean.** No output, exit 0. |
| `npm run test` (root) | **3296 passed, 1 failed** across 177 files (176 passed). |
| `npx vitest run` in `services/realtime` | **135 passed, 1 skipped** across 10 files. |
| `npm run build` | **FAILING.** See below. |

### The one root test failure

`src/lib/problems/availability.test.ts:50` — `isServerGradingAvailable` returns
`true` where the test expects `false`. This is **pre-existing on the base
branch** and is not caused by anything in this wave. The wave's own test count
grew during the day (the earlier figure of 3141/3142 was taken mid-wave); the
failure is the same single one throughout.

### The one realtime skip — this matters

The skipped test is not a rounding error. It is the **Postgres store contract
suite** (`services/realtime/src/store/contract.test.ts`), and it is skipped
because `REALTIME_TEST_DATABASE_URL` is unset.

**That suite has never executed.** All 135 passing realtime tests exercise the
**in-memory** store. `services/realtime/src/store/pg.ts` — every query the
service will run against production Postgres — is verified by reading its SQL
against `information_schema.columns`, and by nothing else. The first live class
backed by Postgres will be the first execution of that code.

### Build status

`npm run build` **fails**, and it fails after compiling successfully:

```
✓ Compiled successfully in 47s
  Linting and checking validity of types ...
Failed to compile.

Type error: File '.../.next/types/app/%5Fui/page.ts' not found.
Next.js build worker exited with code: 1
```

The cause is a directory literally named `src/app/%5Fui/` — a URL-encoded
underscore, created in error by a concurrent stream. Next.js generates a types
entry for the encoded route and then cannot find it. This is **not** a defect in
any of the three add-on features; webpack compilation of the whole app, including
all of them, succeeds. The orchestrator is removing the directory. Until it is
removed, **the app cannot be deployed**, because Vercel runs the same build.

Re-run `npm run build` after the fix and confirm it passes before deploying —
this document records the state observed, not a prediction.

---

## Readiness — NOT measured

Everything in this section is a genuine gap, not a caveat.

### Performance and accessibility targets are unmet because they are unmeasured

The brief set targets of **>90 Lighthouse** and **>95 accessibility**.

**Neither target is met, and neither has been measured.** There has been:

- no Lighthouse run,
- no axe / automated accessibility scan,
- no screen-reader pass,
- no keyboard-only navigation pass,
- no test on a real device or a real browser at any viewport.

The components have unit tests (90 for the visualizations, 69 for the
presentations) executed in jsdom. jsdom does not lay out, does not paint, does
not compute an accessibility tree the way a browser does, and cannot produce a
performance number. Passing those tests says the component logic is correct; it
says nothing at all about Lighthouse or about a screen reader.

**Do not report these targets as achieved.** They are unknown.

### No route has been exercised over HTTP with a real session

All 64 handlers are tested at the function level with mocked sessions and a
mocked database. Not one has been called over the wire against a running server
with a real Auth.js cookie. The `curl` checklist in `DEPLOYMENT.md` §6 was
written from the handler code and has not been executed.

### Realtime latency, in context

Measured: **median 1.7 ms** round trip. That number was taken **over loopback**,
with the **in-memory store**, at **4 concurrent sockets**. It excludes network
latency entirely and excludes Postgres entirely. A real class runs over the
public internet against Neon. The 1.7 ms figure is a floor for the service's own
processing, not an estimate of what a student will experience.

### The live socket path does not work end to end

Two pieces are missing:

1. **No route mints a handshake token.** `mintRealtimeToken` exists, is tested,
   and is correctly verified by the service — but grepping `src/` finds no call
   site. The browser has no way to obtain the credential.
2. **`socket.io-client` is not a dependency.**

So with `NEXT_PUBLIC_REALTIME_URL` set, chat and Q&A still take the read-only
REST-history fallback. This is the documented supported degraded mode and the
class still runs — Jitsi carries video, attendance is written over HTTP on join
and leave — but "live chat works" is **not** a claim this release can make.

### Infrastructure realities

- **Jitsi is `meet.jit.si`** — free public shared infrastructure. **No SLA. No
  retention guarantee.** A session held on it must not be treated as private or
  as durably recorded. Self-hosting on Railway is **impossible**: the videobridge
  needs UDP/10000 ingress and Railway routes HTTP/TCP only. The alternatives are
  a VPS with a public UDP port, or managed 8x8 JaaS — either is a change to one
  environment variable.
- **Railway has no free tier.** A **$5 one-time trial credit**, then the **Hobby
  plan at $5/month**. There is no perpetual free allowance. Budget for it or
  choose Fly.io / Render (see `DEPLOYMENT_LIVE_CLASSES.md` §1).

---

## Known limitations

Every gap known at release, in one list.

**Authorization**

1. **`GET /api/classes/upcoming` has no cohort scoping.** Every authenticated
   student sees every non-archived class in the window, across all cohorts.
   Structural — `weeks` has no cohort column. Harmless while
   `concurrentCohorts: false`; a leak the day a second cohort runs.
   (`src/app/api/classes/upcoming/route.ts:117`)
2. **Presentation grading is not owner-scoped.** Any instructor can grade or
   overwrite any submission, including one a colleague already graded; the
   previous grade is not retained. Structural — assignments have no owning
   instructor. (`.../submissions/[submissionId]/grade/route.ts:98`)

**Testing**

3. **The 34 CHECK constraints are untested.** They exist in the database and the
   handlers map a constraint violation to a 4xx via `statusForDbError`, but no
   test drives a violating write against real Postgres to confirm which
   constraint fires or what status comes back.
4. **The Postgres store has never executed** (see above).
5. **CORS on the realtime service is untested.** The allowlist is correct by
   reading and `"*"` is rejected at boot, but a Node socket client sends no
   `Origin` header, so no test exercises the check.
6. **No load test above 4 concurrent sockets.** A cohort is larger than four.
7. **No Lighthouse, no axe, no screen reader, no real browser, no real device.**
8. **No route exercised over HTTP with a real session.**

**Product / content**

9. **Duplicate visualization components.** `src/components/exercises/animations/BoxModelDiagram.tsx`
   and `HttpCycleDiagram.tsx` cover the same two concepts as the new
   `src/components/learn/visualizations/BoxModelVisualizer.tsx` and
   `HTTPCycleDiagram.tsx`. Both pairs are live. **Somebody must pick one per
   concept and delete the other**, or students will meet two different
   explanations of the box model depending on which page they are on. (Note
   `FlexAxesDiagram.tsx` and `FlexboxPlayground.tsx` are arguably a third
   overlap, though they are less directly equivalent — not assessed in detail.)
10. **Reference solutions have no attempt gate.** Any signed-in user can read
    the model answer to any practice problem. The problems are ungraded so no
    score is affected, but the course owner should agree to this rather than
    discover it.
11. **Live-class email notifications do not send.** The three messages are
    written and unit tested but cannot be enqueued until a `live_class_email`
    job kind is registered — three one-line changes, listed in
    `src/lib/live-classes/class-mail.ts`.

**Rollback**

12. **Rollback has not been rehearsed.** Both migrations are additive and the
    reasoning that a code rollback is safe is sound (see `DEPLOYMENT.md` §2), but
    it is reasoning from the SQL, not an executed drill.

---

## Recommendation

Fix the `%5Fui` directory so the build passes. Then enable **learning
enhancements** and **presentations** — dependency-free, and the two open
authorization findings on them are either non-issues at current scale (grading,
with one instructor) or product decisions to confirm (solution access).

Hold **live classes** until the realtime service is deployed and reachable, and
be clear internally that the live text layer is a REST fallback until a token
endpoint exists.

Before any of it reaches a cohort, run Lighthouse and an accessibility scan
against a deployed preview, and click through each feature in a real browser
with a real session. That is a few hours of work and it is the largest remaining
unknown in this release.
