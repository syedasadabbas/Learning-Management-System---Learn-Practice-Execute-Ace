# Deploying live classes

How to put the real-time service (`services/realtime`) on a host, wire it to the
Next.js app, verify it, roll it back, and turn it off.

Read this before provisioning anything. The first section is about money, and it
is the section most likely to change your mind about which host to use.

---

## 0. What this is, and what happens without it

`services/realtime` is a standalone Socket.io server. It carries the **live text
layer** of a class: chat, Q&A, reactions, typing indicators and presence. It runs
on a host **outside Vercel**, because a serverless function is frozen when its
response is flushed and cannot hold a WebSocket open.

**It is optional, and the app is built for its absence.** With
`NEXT_PUBLIC_REALTIME_URL` unset, `isRealtimeAvailable()` in `src/lib/features.ts`
returns false, the chat and Q&A panels render read-only from the REST history
endpoints, and the class still runs — the video is Jitsi's, attendance is written
over HTTP on join and leave. Only the live text layer degrades. This is the
documented, supported state, not a broken one.

That property is what makes a sleeping free-tier instance survivable: the first
student to open a class while the container is cold either waits a second or two
for it to start, or falls back to REST history and gets the live layer on their
next reload. Nobody is locked out of a class.

---

## 1. Hosting: the money, stated plainly

**Railway has no free tier as of 2026.** New accounts get a **$5 one-time trial
credit**; when it is spent the account must move to the **Hobby plan at $5/month**
(which includes $5 of usage). There is no perpetual free allowance to fall back
to. Budget $5/month, or choose one of the alternatives below.

| Host | Free allowance | Sleeps? | Notes |
|---|---|---|---|
| **Railway** | $5 one-time trial credit, then **$5/month Hobby** | No | Simplest setup. Injects `PORT`. Not free. |
| **Fly.io** | Pay-as-you-go with a small monthly usage allowance; a `shared-cpu-1x` 256 MB machine with `auto_stop_machines` costs approximately nothing when idle | Yes, if you enable auto-stop (`fly.toml` does) | Does **not** inject `PORT` — set it in `fly.toml`. Cold start is ~1-2 s. |
| **Render** | Free web service, 750 instance-hours/month | **Yes — spins down after 15 minutes idle**, and cold start is **~50 s** | Free, but the 50 s cold start is long enough that the first student of every class falls back to REST. Acceptable if you keep it warm (see §7). |

**Recommendation, given the trade-offs:** Fly.io if you want near-zero cost with a
fast cold start; Railway if you want the least operational surface and can spend
$5/month; Render only if free is a hard constraint and you are willing to run a
keep-alive ping.

All three deploy the **same unchanged code**. The service uses no platform SDK.
Its entire contract with the host is: the host sets `PORT`, sends `SIGTERM` to
stop it, and may probe `GET /healthz`.

---

## 2. Environment variables

### On the realtime service

| Variable | Required | Notes |
|---|---|---|
| `REALTIME_SHARED_SECRET` | **Yes** | Must be **byte-identical** to the value on the Next app. Every handshake token is verified against it. Minimum 32 characters. Generate: `openssl rand -base64 32`. |
| `ALLOWED_ORIGINS` | **Yes** | Comma-separated **exact** origins, e.g. `https://your-app.vercel.app,http://localhost:3000`. `*` is rejected. Trailing slashes are stripped for you. |
| `DATABASE_URL` | No | The same Neon connection string the Next app uses. **Absent means nothing persists** — chat and Q&A work live and vanish. Logged loudly at boot. |
| `PORT` | Injected by Railway and Render; **set it yourself on Fly** | Defaults to 4001. |
| `LOG_LEVEL` | No | `debug` \| `info` \| `warn` \| `error`. Default `info`. |
| `MAX_SOCKETS_PER_USER` | No | Default 4. Two tabs is normal; the cap stops a client with a reconnect bug exhausting file descriptors. |

**The service refuses to boot** without the first two, naming every problem at
once. That is deliberate: a service that starts and then rejects every connection
reads in the log as "clients cannot connect" and costs hours.

### On the Next.js app (Vercel)

| Variable | Required | Notes |
|---|---|---|
| `REALTIME_SHARED_SECRET` | Yes, to mint tokens | Same value as above. Server-side only — **not** `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_REALTIME_URL` | Yes, for the client to connect | e.g. `https://lms-realtime.up.railway.app`. **Unset is a supported state** — the app degrades to REST history. |
| `LIVE_CLASSES_ENABLED` | Yes | `true` exactly. Anything else is off. Gates every server route. |
| `NEXT_PUBLIC_LIVE_CLASSES_ENABLED` | Yes | `true` exactly. Gates the client surface. Both are needed; see `src/lib/features.ts`. |
| `NEXT_PUBLIC_JITSI_DOMAIN` | No | Defaults to `meet.jit.si`, which is shared public infrastructure with no SLA. |

Both `*_LIVE_CLASSES_ENABLED` flags default to **off**. A typo, an unset variable
or a fresh preview deployment fails closed and the feature disappears.

---

## 3. Deploying to Railway

1. **Create the service.** New Project → Deploy from GitHub repo → select this
   repository.
2. **Set the root directory to `services/realtime`.** Settings → Service →
   Root Directory. This is the step people miss; without it Railway builds the
   Next app.
3. **Set the variables** from §2 under Variables. `PORT` is injected — do not set
   it.
4. **Deploy.** `railway.json` in the service directory selects the Dockerfile
   builder, points the health check at `/healthz` and pins one replica.
5. **Copy the generated domain** (Settings → Networking → Generate Domain) into
   `NEXT_PUBLIC_REALTIME_URL` on Vercel, and add that Vercel origin to
   `ALLOWED_ORIGINS` on Railway.
6. **Redeploy the Vercel app** so the `NEXT_PUBLIC_*` values are inlined —
   they are substituted at **build** time, so setting them without a rebuild
   changes nothing.

### Fly.io, in brief

```bash
cd services/realtime
fly launch --no-deploy          # edit the generated app name in fly.toml
fly secrets set REALTIME_SHARED_SECRET=... ALLOWED_ORIGINS=... DATABASE_URL=...
fly deploy
```

`PORT` is set in `fly.toml` under `[env]` and must match `internal_port`. Secrets
go through `fly secrets set`, never into `fly.toml` — that file is committed.

### Render, in brief

New → Web Service → this repository → **Root Directory `services/realtime`**,
Runtime **Docker**, Health Check Path `/healthz`. Add the variables from §2;
`PORT` is injected. Note the 15-minute idle spin-down and ~50 s cold start.

---

## 4. Verifying

Run these in order. Each one isolates a different failure.

**1. The service is up.**

```bash
curl -s https://<your-service-host>/healthz
# {"status":"ok","uptimeMs":41230,"connectedSockets":0,"store":"postgres",...}
```

`"store":"memory"` here means `DATABASE_URL` is not set and **nothing is being
persisted**. That is the single most likely misconfiguration and it is visible
from this one call.

**2. CORS is right.** From a browser console on your deployed app's origin:

```js
// Should log a connect_error with code "missing_token" — NOT a CORS error.
const s = io(process.env.NEXT_PUBLIC_REALTIME_URL + "/classes");
s.on("connect_error", (e) => console.log(e.message, e.data));
```

Reaching `missing_token` proves the origin is allowlisted and the transport
works. A CORS error means `ALLOWED_ORIGINS` does not contain this exact origin.

**3. The secret matches.** Open a live class as a student. A handshake rejected
with `bad_signature` in the service log means the two deployments hold different
`REALTIME_SHARED_SECRET` values. `expired` means the clocks differ by more than
the 120-second token TTL, or the page sat open before connecting.

**4. Messages round-trip and persist.** Two browsers, same class, send a message
in one and see it in the other. Reload: it should still be there. If it appears
live and vanishes on reload, you are on the in-memory store (see step 1).

**5. Nothing leaks.** After a class, `GET /healthz` should report
`connectedSockets: 0` and `presence: {"classes":0,"sockets":0}`. Non-zero
`classes` with no one connected is a leak and should be reported.

---

## 5. Rolling back

**Fastest, and it needs no deploy:** unset `NEXT_PUBLIC_REALTIME_URL` on Vercel
and redeploy the app. Clients stop attempting a socket and fall back to REST
history immediately. The service keeps running and costs the same; nothing is
lost.

**Rolling back the service itself:** Railway → Deployments → the previous
deployment → Redeploy. Fly: `fly releases` then `fly deploy --image <previous>`.
Render: Manual Deploy → the previous commit.

**There is no database migration to reverse.** The service only reads and writes
the live-class chat, Q&A and engagement tables; rolling the service back does not
require a schema change either way.

---

## 6. Turning the feature off

Three levels, in increasing order of severity:

1. **Live text only.** Unset `NEXT_PUBLIC_REALTIME_URL`. Classes still run with
   video, attendance and REST-backed chat history.
2. **The whole live-classes surface.** Set `LIVE_CLASSES_ENABLED` and
   `NEXT_PUBLIC_LIVE_CLASSES_ENABLED` to anything other than `true` and redeploy.
   Every live-classes route returns **404** — not 403, so a disabled feature is
   indistinguishable from one that was never built.
3. **Stop paying.** Delete or suspend the service on the host. With step 1 or 2
   already done, students see no change at all.

Nothing in the rest of the LMS depends on this service. `src/lib/features.ts`
argues the design at length; the short version is that the default is off and off
is a fully working product.

---

## 7. Operational notes

**Keeping a free instance warm.** `GET /healthz` is a cheap, unauthenticated
endpoint intended for exactly this. A 10-minute ping from an uptime monitor keeps
a Render instance from spinning down. Weigh it honestly: it also consumes the free
instance-hours the plan gives you, so it trades cold starts for running out of
hours near the end of a busy month.

**One replica, and that is a constraint, not a default.** The rate limiter
(`src/ratelimit.ts`) and the presence registry are per-process `Map`s. With two
instances behind a load balancer, a user's two tabs can land on different
instances and get double the message budget, and the participant count splits.
Scaling out needs a shared store (Redis), which this stack does not have. One
instance handles a cohort of this size comfortably.

**Logs.** JSON lines on stdout, which all three platforms collect. Search for
`"msg":"handshake rejected"` and read the `code` field to diagnose connection
problems; it is one of `missing_token`, `malformed`, `invalid_claims`,
`bad_signature`, `expired`, `too_many_sockets`.

**Graceful shutdown.** The service handles `SIGTERM`: it stops accepting, flushes
in-memory engagement counters, drains for up to 5 seconds, closes the Postgres
pool and exits 0. Every one of these hosts sends `SIGTERM` on deploy, so a rolling
deploy mid-class loses the sockets (clients reconnect) but not the data.

---

## 8. Known prerequisites that are NOT yet satisfied

Stated here rather than discovered in production.

**Email notifications for live classes do not send yet.** The three messages —
class scheduled, 15 minutes before, recording available — are written and unit
tested in `src/lib/live-classes/class-mail.ts`, using the existing
`src/lib/mail/` sender and the existing Postgres-backed queue in
`src/lib/queue/` (**not** Bull, which needs Redis that this stack does not have).
They cannot be enqueued until a `live_class_email` job kind is registered. The
three exact one-line changes required, in files the real-time stream does not
own, are listed in the block comment at the bottom of that file.

**The "15 minutes before" reminder depends on an existing cron.** The queue is
drained by `.github/workflows/drain-jobs.yml` on a 5-minute GitHub Actions
schedule. No new infrastructure is needed, but two things follow:

- GitHub's scheduled workflows are **best effort** and are routinely late under
  load. A "15 minutes before" reminder will in practice arrive between about 15
  and 10 minutes ahead, and occasionally later.
- **GitHub disables scheduled workflows on repositories with 60 days of no
  activity.** If that happens, reminders stop silently. Check the Actions tab if
  reminders go missing.

Vercel's three cron slots (`vercel.json`) are spent and are hourly or daily
anyway, so they could not serve a 15-minute reminder even if one were free.

**The database schema for live-class chat, Q&A and engagement is written by
another stream.** `services/realtime/src/store/pg.ts` names every column it
expects beside a `TODO(schema)`, and the contract is summarised at the top of that
file. Until those tables exist, the service must run without `DATABASE_URL` (the
in-memory store) or it will error on the first message.

---

## 9. Addendum — state as of 2026-08-01 (end of the add-on wave)

This section **updates** the sections above rather than replacing them. Where it
contradicts an earlier paragraph, this one is current.

The app-side deployment (migrations, feature flags, rollout order, rollback,
post-deploy checks) now lives in **[DEPLOYMENT.md](./DEPLOYMENT.md)**. This file
remains the authority on the realtime service itself.

### The chat / Q&A / attendance tables now exist

§8's last paragraph said the schema was still owed by another stream. It has
landed. Migrations `0006` and `0007` are written **and applied to the production
Neon database**, creating `class_chat`, `class_qa`, `class_qa_votes`,
`class_attendance` and the rest — 14 tables in total across the wave, plus 34
CHECK constraints.

Consequence: the service may now be given `DATABASE_URL` and will run on the
Postgres store rather than being forced into the in-memory one. `/health` reports
`"store":"postgres"` when it is set.

**Caveat, and it is a real one:** the Postgres store's contract test suite has
**never executed**. It is skipped unless `REALTIME_TEST_DATABASE_URL` is set, and
that variable has not been set in any run. The 135 passing tests all exercise the
in-memory store. `services/realtime/src/store/pg.ts` was reconciled against
`information_schema.columns` in the live database by reading, not by running. The
first real Postgres-backed class is the first execution of that code path.

To run it before trusting it, point the variable at a **throwaway** database that
already has the migrations applied — the suite writes and truncates:

```bash
cd services/realtime
REALTIME_TEST_DATABASE_URL="postgresql://..." npx vitest run src/store/contract.test.ts
```

### The browser cannot open a socket yet

Two pieces are missing and neither is in this service:

1. **No route mints a handshake token.** `src/lib/live-classes/realtime-token.ts`
   is complete and tested, and this service verifies its tokens correctly — but
   grepping `mintRealtimeToken` across `src/` finds no call site outside the
   definition. No endpoint in the frozen `ROUTES` map returns a token.
2. **`socket.io-client` is not in the app's `package.json`.**

So today, deploying this service changes nothing observable in the app: the chat
and Q&A panels take the REST-history fallback path regardless of
`NEXT_PUBLIC_REALTIME_URL`. That is the documented degraded mode from §0, and the
class still runs on Jitsi plus HTTP attendance.

Closing the gap is a token endpoint (which must decide *who the caller is* and
*which class they may enter* server-side — see the security argument in
`realtime-token.ts`), the client dependency, and a ~20-line transport adapter
passed to `useRealtime`'s `transportFactory` seam.

### CORS is correct by reading and unverified by execution

`ALLOWED_ORIGINS` is an exact-match allowlist; `src/config.ts` refuses to boot on
an empty list or on `"*"`. No test exercises it, because a Node Socket.io client
sends no `Origin` header. Verify it from a real browser against the deployed
service before treating it as proven.

### Load

Measured: **median 1.7 ms** round trip, over loopback, with the in-memory store,
at **4 concurrent sockets**. That figure excludes network latency and excludes
Postgres entirely. Nothing above 4 sockets has been tested. Do not extrapolate it
to a class of thirty.
