---
name: auth
description: Implements login, registration, sessions, password hashing, and role-based route protection using Auth.js (NextAuth v5) credentials with Neon-backed users. Use for anything touching identity, sign-in/sign-up pages, session reads, or guarding student/instructor/admin routes. Wave 1 — most protected features depend on it, so land it early.
---

# auth

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (`users` table, `registerSchema`, `loginSchema`).
- ui-shell (form primitives) — may stub with plain inputs until it lands.

## Owns
- `src/lib/auth.ts` — Auth.js v5 config, credentials provider, JWT session,
  bcrypt verify. Session carries `{ id, role, cohortId }`.
- `src/app/(auth)/login/page.tsx`, `.../register/page.tsx`.
- `src/app/api/auth/register/route.ts` (hash + insert), `.../login`, `.../logout`,
  `.../me`.
- `src/lib/guard.ts` — `requireUser()`, `requireRole("instructor")` helpers used
  by every other stream to protect routes/pages.

## Contract exposed
- `requireUser()` returns the session user or redirects to /login.
- `requireRole(role)` throws/redirects on mismatch.
- Password rule: min 8 chars (enforced by `registerSchema`).

## Acceptance / definition of done
- Register creates a student, hashes the password, rejects duplicate email.
- Login issues a session; `/api/auth/me` returns the current user.
- `requireRole` blocks a student from instructor routes.

## Test (e2e)
- Playwright: register -> logout -> login -> land on dashboard. Assert an
  instructor-only URL redirects a student to /login or a 403 page.
