# Free stack — no paid APIs, no paid keys

Every dependency below is free and (where possible) keyless. Where a credential
exists, it is the organization's OWN free account, never a paid third-party API.
Paid/keyed services from the earlier draft are struck and replaced.

## Mapping

| Concern | Earlier (avoided) | FREE choice now | Key needed? | Notes / trade-off |
|---|---|---|---|---|
| Database | — | Neon free tier | connection string (own DB) | Ample for 50-80 students. |
| Hosting | — | Vercel hobby | none | Next.js native. |
| Auth | — | Auth.js v5 + bcrypt (self-hosted) | none | No external auth vendor. |
| Live editor | — | Sandpack (npm) | none | Client-side. |
| Server code grading | Judge0 via RapidAPI (paid) | Piston (open source) — public instance or self-host | none | Public is keyless+free but rate-limited; self-host (Docker) for grand-quiz bursts, still free. |
| Practice/lab code runs | — | In-browser: Web Worker (JS), Pyodide (Python), sql.js (SQL) | none | Runs in the student's browser -> unlimited scale, zero cost. Not for hidden-test grading. |
| Password-reset email | Resend (key + domain) | Nodemailer + org's own free SMTP (e.g. Gmail app password) | org mailbox cred (free) | No third-party paid API. |
| Email fallback | — | Admin-mediated reset link (+ dev log) | none | Works with zero email service configured. |
| YouTube videos | Data API (Google Cloud key) | Curated IDs validated via keyless oEmbed; optional channel RSS | none | Embedding by ID is free/unlimited; only search needed a key, which we drop. |
| Grand-quiz sweeper | (implied paid scheduler) | GitHub Actions cron (free) or Vercel Cron hobby | shared secret (own) | Plus lazy finalize on state-read + client auto-submit, so the scheduler is only a safety net. |
| Crypto labs | — | Browser SubtleCrypto (SHA-256 etc.) | none | Native, free. |
| CI | — | GitHub Actions + Neon DB branching (free tiers) | none | e2e runs against an ephemeral Neon branch. |

## Scaling note (still free)
For a synchronized 50-80 student grand quiz, code questions are graded at submit
in batches. The public Piston instance can rate-limit under a burst; the free
answer is to self-host Piston (open-source, Docker) on any machine you already
have. Practice/interview/labs use in-browser runtimes, which never hit a server
and therefore never rate-limit.

## What this means for the code
- `.env.example` contains no paid keys — only your own DB string, an app SMTP
  cred (optional), a Piston URL (defaults to the free public one), and a random
  cron secret.
- The `code-execution`, `account`, and `video-ingestion` skills are written to
  these free paths. Nothing else changes.
