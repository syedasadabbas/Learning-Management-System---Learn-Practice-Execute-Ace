# Activity Logs / Audit Trail

Feature 4 of PHASE 1 in `IMPLEMENTATION_ROADMAP.md`. Owner: the activity-logs
stream. Stated purpose: **compliance and security** — so this is an audit trail,
not a debug log, and every decision below follows from that difference.

| | |
|---|---|
| Table | `activity_logs` in `src/db/schema.activity.ts` |
| Library | `src/lib/activity/**` (import from `@/lib/activity`) |
| Admin surface | `/admin/activity` |
| API | `GET /api/admin/activity`, `GET /api/admin/activity/export`, `POST\|GET /api/cron/prune-activity` |
| Retention | 90 days by default, `ACTIVITY_RETENTION_DAYS` to override, floor 30 |

---

## 1. What happens when the audit write fails

**For every action classified `critical`: the act fails too. Fail closed.**

`recordActivity(entry, client)` takes a database client. A caller inside
`db.transaction()` passes its `tx`, so the audit row is one more statement in the
same unit of work:

    the act commits  <=>  its audit row commits

If the INSERT throws, the exception propagates and the transaction rolls back. The
student sees an error instead of a graded quiz.

Why, when the usual instinct is "logging must never break the app":

* the premise of an audit trail is that the record and the act are the same event.
  A system performing graded, irreversible, disputable acts while its trail is
  broken is not degraded — it is producing exactly the state an audit exists to
  rule out: outcomes nobody can account for;
* a missing row is indistinguishable from an act that never happened, so an appeal
  gets decided on data with an unexplained gap;
* whatever broke (dead pool, full disk, dropped Neon connection) stays invisible,
  because the one signal it produced was swallowed — and a broad outage means *many*
  missing rows, not one.

**The cost is affordable for one structural reason**: the audit INSERT runs on the
same connection and inside the same transaction as the act. If it cannot execute,
the act's own statements could not have executed either. This is not a new
dependency — it is one more statement in a unit of work that already had to succeed
or fail as a whole. **If the sink were elsewhere** (a log service, a second
database, a queue) failing closed would couple availability to an unrelated system
and the answer would have to be different.

**For `routine` actions: `recordActivityDetached` fails open**, swallows the error,
counts it, and never throws. `code_execute` is the case that motivates it — a live
editor can fire it many times a minute and no individual row will ever be read. The
loss mode is stated in its docstring, and it **refuses a critical action at
runtime**, so the cheap path is unreachable for events that need the expensive one.

### Why not the queue

`src/lib/queue/**` exists, with retries and DB-level idempotency. Rejected for the
critical path:

* `enqueueJob` is itself one INSERT on the same pool, so queueing performs the same
  round trip (~245 ms warm, measured in `src/db/index.ts`) and avoids nothing;
* a job that exhausts its attempts becomes `status = 'dead'`. **An audit entry that
  can be dead-lettered is not an audit entry**;
* the row would land seconds-to-minutes late, out of order, from a different clock;
* the payload would carry actor and details through a jsonb column in a table that
  is *not* subject to this stream's redaction rules.

The queue is right for an effect that must survive failure and can tolerate delay
(its actual job: email). An audit row must be simultaneous with its act.

**And not an in-memory buffer**: Vercel has no long-lived process, so a buffer
flushed on a timer loses whatever it holds when the invocation is recycled —
silently, which is the one property this table may not have.

---

## 2. What is deliberately not recorded

There is no column for any of it, which is stronger than a rule about what to pass:

* passwords, password hashes, and any field whose name looks like either;
* session tokens, JWTs, cookies, `authorization` headers, CSRF tokens,
  password-reset tokens, API keys;
* **request bodies and query strings in any form.** `sanitiseDetails` takes a *flat*
  record and drops every nested value, so spreading a body into it yields nothing
  usable rather than a leak;
* **email addresses and personal names.** The actor is a foreign key; the address
  lives in `users` and is joined at read time for a caller that has already passed
  `requireRole("admin")`. A copy here would outlive account deletion;
* quiz and exam answers, submitted work, instructor feedback, forum and message
  content — anything a human wrote;
* **full IP addresses.** Only the IPv4 /24 or IPv6 /48 prefix. The fraud question is
  "did these two accounts act from the same network?", which a /24 answers; a full
  address additionally answers "which subscriber", which has no extra audit value
  and would then need protecting for the whole retention window;
* **full User-Agent strings.** Only a coarse family ("Chrome on Windows"), with no
  version numbers — version plus build plus device model can single out one person
  in a cohort of 80. An unrecognised header is stored as `"Unrecognised client"`,
  keeping *no fragment* of an attacker-controlled string;
* exception messages and stack traces. Only a short `error_code`.

This is not hypothetical caution. This codebase has a live instance of the failure:
`getAtRiskStudents` selects `users.email` and `src/components/analytics/AnalyticsPanels.tsx`
renders it on a staff page — nobody decided to publish addresses, a query selected
the whole row and a component rendered what it was handed. Separately, in `next dev`
React serialises the whole session object, email included, into the RSC payload in
the HTML (`tests/e2e/fixtures.ts`). "Log everything" leaks by default.

The choke point is `src/lib/activity/redact.ts`, with 81 unit assertions against it.

### Erasure

`actor_id` is nullable with `on delete set null`. Deleting a user pseudonymises
their trail rather than erasing the acts or leaving a snapshot of their address
behind. Cost, stated: after a deletion you can see that *someone with role student*
did these things in this order, but not who.

---

## 3. Forgery

`actorId` and `actorRole` come from the server-side guards (`apiGuard` /
`requireRole`), never from a request body or a client header. **There is no route
that writes a log entry** — the admin API is read-only plus a prune, and an e2e spec
asserts that `POST /api/admin/activity` does not exist, so a future convenience
handler fails the suite.

Residual, out of scope and stated rather than half-built: anything holding the app's
database credentials can INSERT or DELETE directly. Tamper-evidence against a
compromised database (hash chaining, an append-only replica, shipping rows off-box)
is not implemented.

---

## 4. Index strategy

Four indexes plus a partial unique one, each tied to a query that is actually
issued. Measured against this project's Neon instance in a throwaway schema with
400 000 rows over 2 000 actors, `explain (analyze, buffers)` per shape.

| Index | Serves | Measured |
|---|---|---|
| `(actor_id, id DESC)` | "everything this person did, newest first" | Index Scan, **0.102 ms**, 54 buffers |
| `(action, id DESC)` | "every failed login in the last day" | planner preferred filter-then-sort of ~300 rows (0.458 ms); kept for the wide-window shape |
| `(entity_type, entity_id)` | "what happened to submission 441?" | Index Scan, 0.024 ms |
| `occurred_at` **BRIN** | unfiltered recent view, retention scan | **24 kB vs 8792 kB** for the equivalent btree |
| `dedupe_key` partial UNIQUE | idempotent recording of a retried act | 16 kB |

Three deliberate deviations from the roadmap's index list:

1. **`id DESC`, not `occurred_at DESC`, as the second column.** The list query orders
   by `id` (a bigserial is unique and monotonic, so the keyset cursor cannot be
   ambiguous; two rows can share a timestamp). With `occurred_at` there, Postgres
   used the index for the filter and still had to **Sort** — visible in the probe.
2. **BRIN instead of a btree on `occurred_at`.** A btree is one entry per row of the
   largest table in the database, maintained on every insert, to serve two wide-range
   queries. BRIN summarises per block range, and is near-optimal exactly when
   physical order matches logical order — guaranteed here because the table is
   append-only, never updated, inserted in time order.
3. **No GIN on `details`.** It would be the most expensive index in the database and
   nothing queries inside `details`; the admin surface filters on real columns.

`status` is deliberately unindexed: two values is never selective enough to beat
filtering rows another index already narrowed.

### Reads are bounded

Page size is clamped to 200 (`MAX_PAGE_SIZE`), export to 20 000 rows. Paging is a
**keyset cursor**, not OFFSET — constant cost at any depth, and an event written
while an investigator pages cannot shift the window and hide a row. The
"how big is this table?" tile uses `pg_class.reltuples`, not `count(*)`: an exact
count on every admin page load is the likeliest way this feature becomes the
performance problem it exists to watch.

---

## 5. Retention and pruning

`INTEGRATION_SUMMARY.md` states the policy: "keep 90 days hot, auto-archive older".
So **90 days is the default**, from the spec.

Where the spec and this stack disagree, and what was done about it:

* **there is no cold storage.** `@vercel/blob` is a proposed dependency, not an
  installed one, and the free stack has no object store. So a prune **deletes**;
  the CSV export is the archive path, and pruning **refuses to run without
  `confirm=exported`**;
* **90 days is shorter than this cohort's audit horizon.** A course runs for weeks
  and grade appeals arrive after it ends, so a dispute about week 1 can fall outside
  the window. Recommended production value: **400 days** (a year plus 35 days of
  grace) via `ACTIVITY_RETENTION_DAYS`. The default follows the spec so that
  following the spec is a choice, not an accident;
* **hard floor of 30 days, enforced in code.** `ACTIVITY_RETENTION_DAYS=1` — a typo,
  a misread unit — would otherwise erase almost the whole trail on the next run, and
  there is no undo. A malformed value falls back to the *default*, never to a smaller
  window: failing towards keeping data is the only safe direction. Parsing is
  decimal-digits-only, because `Number("1e3")` is 1000 and `Number("0x5A")` is 90 —
  both integers, both windows nobody typed;
* **bounded batches, not one big DELETE.** 5 000 rows per statement with a 20 000 ms
  self-imposed budget. A single `DELETE ... WHERE occurred_at < cutoff` over millions
  of rows holds one transaction open for minutes and gets killed at the platform's
  wall-clock limit, rolling the work back and repeating it forever;
* **the prune records itself**, as an `activity_pruned` row written *before* any
  deletion, carrying the cutoff, the eligible count and the batch size. Deleting from
  an audit trail must never be the untraceable operation.

The scheduled entry in `vercel.json` runs the **dry run** — it reports how many rows
are past the window and deletes nothing, because a Vercel cron cannot supply the
confirmation flag. Real pruning is a deliberate operator action:

```
GET /api/admin/activity/export?days=…      # archive first
POST /api/cron/prune-activity?dryRun=0&confirm=exported
```

### When batches stop being enough

**Monthly range partitioning on `occurred_at`.** Dropping a partition is a catalogue
operation — instant, no row-by-row delete, no bloat, no vacuum — replacing
`retention.ts` with `DROP TABLE activity_logs_2026_03`. It is cheap to adopt later
precisely because of the choices above: append-only, never updated, inserted in time
order, so no row has to move and BRIN stays optimal per partition. Trigger: prune
runs regularly reporting `incomplete: true`.

---

## 6. Coverage — read this before trusting the table

The roadmap's success metric is "100% of actions". **It is not 100% in this commit.**

Live call sites today: `activity_export`, `activity_export_denied`, `activity_pruned`
— the audit trail auditing itself. Every other action in the enum is **declared
vocabulary plus a documented hook point**, because the write paths that would emit
them (`src/lib/auth.ts`, the quiz submit handler, the grading handler, the admin
server actions) live in files this stream does not own.

`src/lib/activity/hook-points.ts` is that plan, expressed as data keyed on the frozen
route map, and asserted against `ROUTES` so it cannot describe routes that no longer
exist. Each entry names the route, the action, the entity type, whether the row must
be written inside the act's transaction, and which `details` keys to pass. Adding a
call site is:

```ts
await db.transaction(async (tx) => {
  await tx.update(submissions).set({ stars }).where(eq(submissions.id, id));
  await recordActivity(
    { action: "submission_graded", actorId: user.id, actorRole: user.role,
      entityType: "submission", entityId: id, details: { stars, previousStars } },
    tx,                       // <- the row commits with the grade, or neither does
  );
});
```

`unwiredActions()` derives the gap from the code, and `/admin/activity` prints it on
screen. A gap an operator knows about is one they can work around; a gap they believe
is coverage is a wrong conclusion in an investigation.

---

## 7. Was `guard.ts` or `middleware.ts` instrumented?

**No. Neither file was modified.** The brief flagged them as the natural place to
observe actor identity; both were considered and rejected on evidence:

* **`src/middleware.ts` runs on the edge runtime.** It cannot reach Postgres — that
  is the whole reason it verifies the JWT with `next-auth/jwt` instead of importing
  `src/lib/auth.ts` (see its own header). There is no sink available to it.
* **`src/lib/guard.ts` is called several times per request** — the `(staff)` layout
  and then the page each call `requireRole`, and RSC re-renders call it again. Logging
  per call produces duplicate rows and a *page-view log*, which is a different
  artefact: orders of magnitude larger, answering a different question, and it would
  put a database write on the render path of every page.
* **Instrumenting only the denial branch was considered and is worse than it looks.**
  `src/middleware.ts` denies at the edge *before* `guard.ts` is reached for every
  prefix in its `PROTECTED` table, so `requireRole`'s forbidden branch only fires for
  pages under an *unlisted* prefix. It would capture a small and unpredictable subset
  of denials — a trail that looks like "all refusals" and is not, which is worse than
  a known absence.

Denials are visible as 401/403 responses in the platform's request log. Recording
them durably needs a non-edge sink and belongs with whoever owns those two files.

Files outside this stream's ownership that *were* touched, all additive:

| File | Change | Why |
|---|---|---|
| `drizzle.config.ts` | +1 schema path | the documented pattern; an unlisted table is one `db:push` offers to DROP |
| `src/lib/contracts/api.ts` | 3 route entries | an unlisted route has no `ROUTE_AUTH` entry, so the exhaustiveness check cannot catch a route that forgot to authorize itself — the same argument the async-queues block in that file makes |
| `src/components/nav/nav-links.ts` | 1 admin row | a table nobody can find is not compliance. Admin set only; `nav-links.test.tsx` forbids `/admin` hrefs for instructors, which is correct here |
| `vercel.json` | 1 cron entry | dry run only — see §5 |
