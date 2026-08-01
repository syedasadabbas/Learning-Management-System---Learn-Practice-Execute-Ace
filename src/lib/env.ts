// =============================================================================
// ENVIRONMENT CONTRACT — the four variables this app cannot run without.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS, stated as the incident it is a response to.
//
// On 2026-08-01 a suite run reported 48 failed / 2 passed across account and
// coding-problems, with fifteen failures in a feature nobody had touched. Two
// sessions were spent reading `FormNotice`, `settings/loading.tsx`,
// `resolveNotice`, `problems/[slug]/layout.tsx` and `loadProblem`'s level ladder.
// All five were innocent. The cause, both times, was a MISSING ENVIRONMENT
// VARIABLE:
//
//   round one   DATABASE_URL absent -> src/db/index.ts:36 throws at import, so
//               every database-backed page returned HTTP 500. The account spec
//               failed at :61 (`register()` cannot fill a field on an error page),
//               NOT at :129 where the report pointed, and `mode: "serial"` turned
//               one fault into eleven failures.
//   round two   AUTH_SECRET absent -> Auth.js threw MissingSecret 51 times in one
//               server log, surfacing as 503 on API routes and as `loginAs`
//               hitting an error overlay. Read, again, as feature bugs.
//
// The lesson generalises past the test suite, which is the reason this is app
// code and not a test helper: A MISSING VARIABLE PRESENTS AS A LARGE NUMBER OF
// FAILURES IN WHICHEVER FEATURE IS TOUCHED FIRST, and in that shape it is
// indistinguishable from a code regression. In production it is worse than in a
// test run, because the deploy SUCCEEDS. `next build` does not need AUTH_SECRET,
// nothing in src/** references it (Auth.js reads process.env itself), so a Vercel
// deployment missing it goes green, serves its marketing pages, and 500s the
// instant a student tries to sign in.
//
// DATABASE_URL was already guarded, at src/db/index.ts:36, and that guard is
// deliberately left where it is rather than moved here — it protects the scripts
// in scripts/**, which import { db } without going through the server bootstrap.
// This file is the AGGREGATE check: it names every missing variable in one error
// instead of failing on whichever one is dereferenced first, because discovering
// them one deploy at a time is the same trap in slow motion.
//
// SERVER ONLY. Nothing here may be imported from a client component: the values
// are secrets, and `src/lib/forums/policy.ts` already recorded in this repo's
// CHANGELOG what happens when a module assumed to be pure is pulled into the
// browser bundle (`next build` failed on "Can't resolve 'fs' / 'dns' / 'net'").
// The only importer is src/instrumentation.ts, which Next.js runs on the server.
// =============================================================================

/** A variable the app cannot serve a single authenticated request without. */
interface RequiredVar {
  name: string;
  /** What breaks, in terms of observable behaviour rather than of code. */
  consequence: string;
  /** Optional extra check for a value that is present but unusable. */
  validate?: (value: string) => string | null;
}

/**
 * Minimum length for AUTH_SECRET.
 *
 * 32 bytes is what `openssl rand -base64 32` produces and what .env.example asks
 * for. The check is on LENGTH and not on entropy, which cannot be measured from a
 * single sample — it catches the realistic mistake, which is a placeholder or a
 * short hand-typed string, not a determined adversary choosing a long weak value.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * A value that is set but is still the placeholder from .env.example. Copying that
 * file and filling in only DATABASE_URL is exactly how this went wrong, so a
 * placeholder must count as missing rather than as configured.
 */
const PLACEHOLDER = /replace-with|your-|changeme|xxxx/i;

function secretValidator(name: string) {
  return (value: string): string | null => {
    if (PLACEHOLDER.test(value)) {
      return `${name} is still the placeholder from .env.example`;
    }
    if (value.length < MIN_SECRET_LENGTH) {
      return `${name} is ${value.length} characters; at least ${MIN_SECRET_LENGTH} are required (generate with: openssl rand -base64 32)`;
    }
    return null;
  };
}

const REQUIRED: readonly RequiredVar[] = [
  {
    name: "DATABASE_URL",
    consequence:
      "every database-backed page returns HTTP 500 (src/db/index.ts throws at import)",
  },
  {
    name: "AUTH_SECRET",
    consequence:
      "Auth.js throws MissingSecret on every request, so NOBODY CAN SIGN IN — and because no source file references this variable, the build and the deploy both succeed first",
    validate: secretValidator("AUTH_SECRET"),
  },
];

/**
 * Variables whose absence degrades a feature rather than stopping the app. These
 * WARN and never throw: refusing to boot over them would take the whole platform
 * down to protect one scheduled job, which is the wrong trade.
 */
const RECOMMENDED: readonly RequiredVar[] = [
  {
    name: "CRON_SECRET",
    consequence:
      "every /api/cron/* route fails closed with 503 (requireCron, src/lib/guard.ts:225) — submission ingestion, the job drain, exam finalisation and activity pruning all stop silently",
    validate: secretValidator("CRON_SECRET"),
  },
  {
    name: "NEXTAUTH_URL",
    consequence:
      "absolute URLs in outgoing mail fall back to a default origin, so password-reset links may point at the wrong host (src/lib/mail/index.ts appOrigin)",
  },
];

export interface EnvReport {
  /** Human-readable problems that must stop the process. */
  fatal: string[];
  /** Human-readable problems worth logging but not worth refusing to boot. */
  warnings: string[];
}

function inspect(vars: readonly RequiredVar[]): string[] {
  const problems: string[] = [];

  for (const spec of vars) {
    const raw = process.env[spec.name];
    const value = raw?.trim() ?? "";

    if (!value) {
      problems.push(`${spec.name} is not set — ${spec.consequence}`);
      continue;
    }

    const invalid = spec.validate?.(value);
    if (invalid) problems.push(`${invalid} — ${spec.consequence}`);
  }

  return problems;
}

/**
 * Inspect the environment without throwing. Separated from `assertEnv` so the
 * test harness can report the same findings and abort a run, rather than let 500s
 * masquerade as failed assertions — which is what cost two sessions.
 */
export function inspectEnv(): EnvReport {
  return { fatal: inspect(REQUIRED), warnings: inspect(RECOMMENDED) };
}

/**
 * Throw ONE error naming every fatal problem, after logging the non-fatal ones.
 *
 * Deliberately throws rather than calling process.exit: on a serverless platform
 * the throw is captured and reported against the deployment, while an exit code
 * from an init hook is not, and locally a stack trace tells the reader which file
 * asked for the check.
 */
export function assertEnv(): void {
  const { fatal, warnings } = inspectEnv();

  for (const warning of warnings) {
    console.warn(`[env] WARNING: ${warning}`);
  }

  if (fatal.length === 0) return;

  const lines = fatal.map((problem) => `  - ${problem}`).join("\n");
  throw new Error(
    `Refusing to start: ${fatal.length} environment problem(s).\n${lines}\n\n` +
      `Copy .env.example to .env and fill in every value. In a deployment, set these ` +
      `in the platform's environment settings — a missing secret does NOT fail the ` +
      `build, it fails the first student who tries to sign in.`,
  );
}
