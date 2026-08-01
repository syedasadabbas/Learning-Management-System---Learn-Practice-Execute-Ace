# Deployment

How to deploy the LMS, what state the database is already in, which environment
variables each feature needs, the order to turn things on in, and how to roll
back.

The realtime service has its own guide — **[DEPLOYMENT_LIVE_CLASSES.md](./DEPLOYMENT_LIVE_CLASSES.md)**
— which covers hosting, cost, Railway/Fly/Render specifics and the service's own
environment. This document does not repeat it.

Related: [SECURITY_REVIEW_ADDON_WAVE.md](./SECURITY_REVIEW_ADDON_WAVE.md) (read
findings 1 and 2 before enabling live classes or presentations),
[RELEASE_NOTES_ADDON_WAVE.md](./RELEASE_NOTES_ADDON_WAVE.md) (what is and is not
verified), [SCHEMA_ENHANCEMENT.md](./SCHEMA_ENHANCEMENT.md) (what the tables are).

---

## 1. Migration state — read this first

Migrations live in `src/db/migrations/`. There are eight: `0000` through `0007`.

**`0006` and `0007` have already been applied to the production Neon database.**
That is a fact about the live database as of 2026-08-01, not an instruction.

| Situation | What to run |
|---|---|
| The existing production Neon database | **Nothing.** Both are already applied. |
| A fresh database (new environment, local, preview branch) | `npm run db:migrate` — runs `0000`…`0007` in order. |
| Unsure | `npm run db:verify-schema` — asserts the add-on tables and columns exist. |

What the two migrations added, in total: 13 new tables plus `class_qa_votes`
(14), 17 additive columns on `lectures` / `assignments` / `questions`, and 34
CHECK constraints.

### Both migrations are additive

Verified by reading the SQL: `0006_narrow_deathbird.sql` contains **zero** `DROP`
statements. `0007_faithful_dragon_lord.sql` contains no `DROP` and no
`ALTER COLUMN` — it is one `CREATE TABLE` (`class_qa_votes`), three `ADD COLUMN`
and three `ADD CONSTRAINT ... CHECK`.

Nothing existing was dropped, renamed, narrowed, or made stricter. That is what
makes the rollback story below simple.

---

## 2. Rollback

### Rolling back application code is safe, and needs no down-migration

Because both migrations are purely additive, the previous release's code runs
unchanged against the migrated database. Postgres does not care that tables and
columns exist which nobody selects; Drizzle only names the columns its schema
modules declare, so unknown extra columns are invisible to old code. There is no
`INSERT` in the old code that would now fail — every added column is either
nullable or has a default (see the next paragraph).

**So: to roll back, redeploy the previous build. Do not attempt to reverse the
migrations.** There are no down-migrations, and writing them would risk
destroying student data (`presentations.slides_json` is the student's deck;
`class_attendance` is the record a participation mark was computed from — those
bytes exist nowhere else).

### The one column worth understanding: `class_chat.reactions`

`0007` line 9:

```sql
ALTER TABLE "class_chat" ADD COLUMN "reactions" jsonb DEFAULT '{}'::jsonb NOT NULL;
```

This is `NOT NULL`, which is the shape people worry about on a rollback. Here it
is harmless, and specifically:

- It has a **`DEFAULT`**, so any `INSERT` that does not mention the column — which
  is every `INSERT` in the pre-wave code — succeeds and gets `'{}'`. A `NOT NULL`
  column *without* a default is the one that breaks old writers; this is not that.
- `class_chat` is itself a **new table from `0006`**. Pre-wave code never
  touches it at all, so on a code rollback the question is moot: nothing reads
  or writes that table.
- Postgres 11+ adds a defaulted column without rewriting the table, so applying
  it was not a long lock either.

**Not verified:** rollback has not been rehearsed against a copy of production.
The reasoning above is from reading the SQL and the schema modules, not from an
executed drill.

### The faster rollback: turn the flag off

For anything wrong with an add-on feature, the first move is not a redeploy. Set
the feature's two environment variables to anything other than `"true"` (or
remove them) and redeploy. Every add-on route returns 404 and the UI disappears.
See §5.

---

## 3. Environment variables

Copy `.env.example` to `.env` and fill it in. Everything below is documented in
that file too; this is the deployment-time summary.

### Always required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`). |
| `AUTH_SECRET` | `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Vercel sets this automatically in production. |
| `CRON_SECRET` | Guards the server-to-server ingest and cron routes. |

`src/lib/env.ts` + `src/instrumentation.ts` make the server **refuse to boot** on
an invalid environment, so a missing required variable is a failed deploy rather
than a runtime 500. That is deliberate.

### Optional, pre-existing

| Variable | Default when unset |
|---|---|
| `PISTON_URL` | `https://emkc.org/api/v2/piston` — the free public code-execution instance. Set it to point at a self-hosted Piston. |
| `SMTP_HOST` and friends | Dev transport: the reset link is logged to the server console. Supported state. |
| `SUBMISSIONS_*` | Local stand-in for the Google Form/Sheet pipeline. |

### The three add-on feature flags

**Each feature has two variables and they must be set to the same value.**

| Feature | Server variable (gates API + server components) | Public variable (gates client components, inlined at **build** time) |
|---|---|---|
| Learning enhancements | `LEARNING_ENHANCEMENTS_ENABLED` | `NEXT_PUBLIC_LEARNING_ENHANCEMENTS_ENABLED` |
| Presentations | `PRESENTATIONS_ENABLED` | `NEXT_PUBLIC_PRESENTATIONS_ENABLED` |
| Live classes | `LIVE_CLASSES_ENABLED` | `NEXT_PUBLIC_LIVE_CLASSES_ENABLED` |

Parsing is **strict**: only the exact string `"true"` enables. Not `"1"`, not
`"TRUE"`, not `"yes"`. Whitespace is trimmed. Unset means off, and all three
default off.

**The consequence of setting only one half:**

| What you set | What happens |
|---|---|
| Server only | The endpoints answer, but no navigation entry and no UI renders. The feature is invisible and unreachable through the app. Harmless but pointless. |
| Public only | The UI renders in full — buttons, panels, forms — and **every request it makes returns 404**. This is the bad one: it looks like a broken feature to students rather than an absent one. |
| Both | The feature works. |

**`NEXT_PUBLIC_*` is inlined at build time.** Changing it on the hosting
dashboard does nothing until you **redeploy**. The unprefixed server variable
takes effect on the next request. Flip both, then redeploy.

### Live classes only

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_JITSI_DOMAIN` | `meet.jit.si` | Free public shared infrastructure. **No SLA, no retention guarantee.** Do not treat a session held on it as private or as durably recorded. Self-hosting on Railway is impossible — the videobridge needs UDP/10000 and Railway routes HTTP/TCP only. |
| `NEXT_PUBLIC_REALTIME_URL` | unset | Base URL of `services/realtime`. **Unset is a supported state**: chat and Q&A fall back to read-only REST history; video, attendance and the class itself still work. |
| `REALTIME_SHARED_SECRET` | unset | Must be **byte-identical** to the same variable on the realtime service. `openssl rand -base64 32`. No insecure default — an empty value makes token minting throw rather than produce a forgeable token. |

The realtime service's own variables (`ALLOWED_ORIGINS`, `PORT`, `LOG_LEVEL`,
`MAX_SOCKETS_PER_USER`, `ENGAGEMENT_IDLE_TTL_MS`) are documented in
`services/realtime/.env.example` and in
[DEPLOYMENT_LIVE_CLASSES.md](./DEPLOYMENT_LIVE_CLASSES.md) §2.

---

## 4. Deploying the Next.js app

Vercel, as before this wave. Nothing about the app's deployment changed —
`vercel.json` is untouched by the add-on wave.

```bash
npm ci
npm run typecheck        # must be clean
npm run lint             # must be clean
npm run test             # see RELEASE_NOTES for the one known failure
npm run build            # see the build-status note in RELEASE_NOTES
```

Then push the branch; Vercel builds it. Set the environment variables **before**
the build if any `NEXT_PUBLIC_*` flag is being turned on, since those are inlined
during the build.

---

## 5. Recommended rollout order

The three features are independent by design, and they are **not** equally
risky. Turn them on in this order, not all at once.

### Step 1 — Learning enhancements

```
LEARNING_ENHANCEMENTS_ENABLED=true
NEXT_PUBLIC_LEARNING_ENHANCEMENTS_ENABLED=true
```

Additive, read-mostly surfaces over lectures and assignments. **No external
dependency.** Nothing else in the LMS changes behaviour when this is on. Safe
first.

Before enabling, know: reference solutions are readable by any signed-in user
with no attempt gate (Security Review, Finding 3). The problems are ungraded, so
this affects pedagogy, not scores — but the course owner should agree to it.

### Step 2 — Presentations

```
PRESENTATIONS_ENABLED=true
NEXT_PUBLIC_PRESENTATIONS_ENABLED=true
```

Entirely client-side (Reveal.js) plus a JSON column. **No external dependency.**

Before enabling, know: any instructor can grade any presentation submission and
overwrite a colleague's grade (Security Review, Finding 2). With a single
instructor account this is theoretical. With several, decide whether it is
acceptable first.

### Step 3 — Live classes, and only after the realtime service is up

```
LIVE_CLASSES_ENABLED=true
NEXT_PUBLIC_LIVE_CLASSES_ENABLED=true
```

This is the **only** feature with an out-of-process dependency. Do not enable it
until:

1. `services/realtime` is deployed and its `/health` endpoint answers — see
   [DEPLOYMENT_LIVE_CLASSES.md](./DEPLOYMENT_LIVE_CLASSES.md) §3 and §4.
2. `REALTIME_SHARED_SECRET` is set to the same value on both sides.
3. `ALLOWED_ORIGINS` on the service names the app's exact production origin.

Also know before enabling:

- **Only one cohort at a time.** `GET /api/classes/upcoming` has no cohort
  scoping — every student sees every class in the window (Security Review,
  Finding 1). With `concurrentCohorts: false` this is correct behaviour; with two
  cohorts it is a leak.
- **The live socket path is not currently reachable from a browser.** Nothing
  mints a handshake token and `socket.io-client` is not a dependency, so chat and
  Q&A run in the REST-history fallback regardless of `NEXT_PUBLIC_REALTIME_URL`.
  Video (Jitsi), attendance, scheduling and the class room itself do work. See
  RELEASE_NOTES.
- `meet.jit.si` has no SLA.

---

## 6. Post-deploy verification

Commands that can actually be run, in order. Replace `$APP` with the deployed
origin and `$SVC` with the realtime service origin.

### Before deploying — local gates

```bash
npm run typecheck                 # expect: no output, exit 0
npm run lint                      # expect: no output, exit 0
npm run test                      # expect: 1 known pre-existing failure, see RELEASE_NOTES
npm run build                     # expect: see RELEASE_NOTES for current status
(cd services/realtime && npx vitest run)   # expect: 135 passed, 1 skipped
```

### Database

```bash
npm run db:smoke                  # connectivity against DATABASE_URL
npm run db:verify-schema          # asserts the add-on tables and columns exist
```

### The app is up and auth still works

```bash
curl -s -o /dev/null -w '%{http_code}\n' $APP/login          # expect 200
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/auth/me    # expect 401 unauthenticated
```

### Flags are off — a disabled feature must be a 404, not a 401

Run these with **no** session cookie. A 404 proves the gate runs before auth; a
401 would mean the order is inverted and the route map is leaking.

```bash
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/classes/upcoming        # expect 404 when live classes are off
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/presentations           # expect 404 when presentations are off
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/interview-questions     # expect 404 when learning enhancements are off
```

### Flags are on

Same three URLs, still with no session cookie — now expect **401**, which proves
the flag is on and auth is doing its job.

```bash
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/presentations           # expect 401
```

Then sign in in a browser and confirm the corresponding navigation entries
appear. If the endpoints answer but the UI is absent, the `NEXT_PUBLIC_` half is
missing or the app was not rebuilt after setting it.

### Realtime service, if deployed

```bash
curl -s $SVC/health
# expect: {"status":"ok","uptimeMs":...,"connectedSockets":0,"store":"postgres",...}
```

`"store":"memory"` means `DATABASE_URL` is not set on the service and nothing
persists. That is a supported configuration but probably not the one you wanted
in production.

### Answer keys are not leaking

Signed in as a **student**, confirm the list endpoints return booleans rather
than solution text:

```bash
curl -s -b "$COOKIE" $APP/api/lectures/1/practice-problems | grep -c solutionCode   # expect 0
curl -s -b "$COOKIE" $APP/api/interview-questions          | grep -c sampleAnswer   # expect 0
```

(`solutionAvailable` and `hasSampleAnswer` — booleans — are what should appear.)

**Not verified:** none of the HTTP checks in this section have been executed
against a running deployment with a real session. They are written from the
handler code. Treat the first run as the verification.
