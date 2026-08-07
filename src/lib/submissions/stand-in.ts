// =============================================================================
// ASSIGNMENT DELIVERY / INGESTION LINKS — resolution, plus the LOCAL STAND-IN.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// WHAT THIS EXISTS TO FIX
//
// Every seeded assignment had `google_form_url` and `google_sheet_csv_url` NULL
// (confirmed against the live database on 2026-07-31: 4 assignment rows, 4/4 NULL
// in BOTH columns). The delivery code and the ingestion code were both correct
// and both unreachable: SubmitLink.tsx renders its "not yet configured" banner
// whenever the Form URL is blank (src/components/submissions/SubmitLink.tsx:28),
// and fetchPublishedCsv returns `no_csv_url` before it opens a socket
// (src/lib/submissions/fetch-csv.ts:88). So the whole pipeline was a documented
// no-op — nothing to click, nothing to read, and every ingest run reported
// "4 considered, 0 ingested, 4 skipped: no_csv_url".
//
// WHAT IS REAL HERE AND WHAT IS NOT — READ THIS BEFORE TRUSTING ANY OF IT
//
// A Google Form cannot be created from inside this repository. There is no API
// call, no credential, and no account; a Form is made by a human in a browser.
// So this module does NOT pretend to have one. It resolves each assignment's two
// URLs from one of two sources, and says which one it used:
//
//   source "configured"  The course owner supplied a real URL through the admin
//                        console (src/components/instructor/AdminForms.tsx) or
//                        through the environment variables below. REAL.
//
//   source "stand-in"    Nothing was supplied, so the URLs point at two local
//                        surfaces this repository serves itself:
//                          - a submission page inside the LMS, and
//                          - a CSV endpoint that emits a Google-Forms-SHAPED
//                            response sheet for one seeded demo account.
//                        The transport, the parser, the student matcher, the
//                        lateness maths and the upsert are all the REAL ones.
//                        The RESPONDENT DATA IS MANUFACTURED, and Google is not
//                        involved at any point.
//
// TODO(course-owner): create the four Google Forms, publish each linked response
// sheet (File -> Share -> Publish to web -> comma-separated values), and set the
// two URLs per assignment — either in the admin console or via
// SUBMISSIONS_FORM_URL_WEEK_<n> / SUBMISSIONS_SHEET_CSV_URL_WEEK_<n>. Until that
// is done the pipeline is proven against a stand-in ONLY. Specifically still
// unproven: the exact header text a real Form emits per question, the sheet's
// spreadsheet timezone (see the TIMEZONE DECISION in csv.ts), and Google's 307
// from docs.google.com to googleusercontent.com.
//
// Pure module: no `db`, no `fetch`. Unit-tested in stand-in.test.ts.
// =============================================================================

/**
 * The subset of the environment this module reads.
 *
 * Typed as a plain record rather than NodeJS.ProcessEnv so a test can pass a
 * two-key literal. ProcessEnv requires NODE_ENV, so every call site in the tests
 * would otherwise need a double cast through `unknown` — and such a cast would
 * also silence a genuine mistake in the object being passed.
 */
export type EnvLike = Record<string, string | undefined>;

/**
 * Query flag stamped on every URL this module invents.
 *
 * A stand-in URL must be recognisable AFTER it has been written to the database,
 * by code that no longer has the environment that produced it — the admin console
 * badge, the student's submit panel, and any future migration that wants to clear
 * stand-ins without touching a real URL an instructor typed. Encoding that in the
 * URL itself rather than in a new column keeps it out of src/db/schema.ts, which
 * is a shared frozen seam; a boolean column would be a schema edit for something
 * that is a property of the value, not of the row.
 */
export const STAND_IN_FLAG = "standin";

/** Milliseconds in an hour / a day. Metric units per the house rules. */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Where the stand-in surfaces live. Kept next to the code that builds them. */
export const STAND_IN_SHEET_PATH_PREFIX = "/api/stand-in/assignments";
export const STAND_IN_FORM_PATH_SUFFIX = "/submit";

export type LinkSource = "configured" | "stand-in";

export type AssignmentLinks = {
  googleFormUrl: string;
  googleSheetCsvUrl: string;
  formSource: LinkSource;
  sheetSource: LinkSource;
};

/**
 * Base origin the stand-in URLs are built against.
 *
 * Order matters. `SUBMISSIONS_STAND_IN_BASE_URL` is the explicit override for a
 * preview deployment whose port is not 3000. `NEXTAUTH_URL` is already required
 * by the auth stream and already holds this app's own origin, so reusing it means
 * a developer who has a working .env needs no new variable at all. The literal
 * fallback matches the dev server and playwright.config.ts's default port.
 *
 * The trailing slash is stripped so callers can concatenate a rooted path without
 * producing a double slash, which Next.js redirects and which would then be a
 * SECOND request on the ingestion hot path.
 */
export function standInBaseUrl(env: EnvLike = process.env): string {
  const raw =
    env.SUBMISSIONS_STAND_IN_BASE_URL?.trim() ||
    env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** The stand-in response sheet for one assignment, as an absolute URL. */
export function standInSheetUrl(assignmentId: number, env?: EnvLike): string {
  return `${standInBaseUrl(env)}${STAND_IN_SHEET_PATH_PREFIX}/${assignmentId}/responses?${STAND_IN_FLAG}=1`;
}

/**
 * The stand-in submission page for one week, as an ORIGIN-RELATIVE path.
 *
 * Keyed on `weeks.id` rather than the week NUMBER because that is what the
 * existing route takes: `/assignments/[weekId]` resolves through
 * `getAssignmentForWeek(weekId, ...)`, which matches on `weeks.id`
 * (src/lib/submissions/history.ts:148). Passing a week number would 404 on any
 * database that has been reseeded.
 *
 * DELIBERATELY NOT ABSOLUTE, unlike `standInSheetUrl`. This was an absolute URL
 * built from `standInBaseUrl()`, and it was a real defect rather than a cosmetic
 * one, because the value is WRITTEN TO THE DATABASE at seed time and then served
 * to whatever origin the student is actually browsing:
 *
 *   - The seeded value was "http://localhost:3000/assignments/1/submit?standin=1"
 *     (NEXTAUTH_URL), while playwright.config.ts serves the app on
 *     "http://127.0.0.1:3000". Clicking the link crossed origins, the host-only
 *     session cookie was not sent, and the student landed on /login instead of the
 *     page — which is exactly how the e2e spec at
 *     tests/e2e/submissions/submissions.spec.ts:478 failed.
 *   - The same defect bites in production the moment the app is reached on any
 *     origin other than the one NEXTAUTH_URL held when the database was seeded: a
 *     Vercel preview deployment, a custom domain added later, www vs apex.
 *
 * A same-app link needs no origin. A relative path is correct on every origin at
 * once and cannot go stale. The SHEET url stays absolute because its consumer is
 * a server-side `fetch`, which has no document to resolve a relative path against.
 */
export function standInFormUrl(weekRowId: number): string {
  return `/assignments/${weekRowId}${STAND_IN_FORM_PATH_SUFFIX}?${STAND_IN_FLAG}=1`;
}

/**
 * Base used only to make a RELATIVE stand-in path parseable by `new URL`.
 *
 * Never fetched, never rendered, and deliberately not a real host: if this string
 * ever escapes into a link or a report, it should be obviously wrong rather than
 * plausibly right.
 */
const RELATIVE_URL_BASE = "https://stand-in.invalid";

/**
 * Is this URL one of ours rather than a real Google one?
 *
 * Handles BOTH forms, because both are now stored: the relative path
 * `standInFormUrl` produces, and the absolute URL `standInSheetUrl` produces (plus
 * the absolute form-URL rows that older seeds already wrote, which must keep
 * being recognised as stand-ins or the student loses the warning banner).
 *
 * Deliberately tolerant of a malformed value: an unparseable string is NOT a
 * stand-in. Treating junk as a stand-in would let the UI quietly suppress the
 * "this is not the real form" warning for a URL nobody understands. Note that a
 * relative path is now PARSEABLE rather than junk, so the distinction rests on the
 * `standin=1` flag alone — a bare "/assignments/1/submit" is not a stand-in.
 */
export function isStandInUrl(url: string | null | undefined): boolean {
  const value = (url ?? "").trim();
  if (value === "") return false;
  // A protocol-relative "//evil.example/x" would resolve against the base and be
  // treated as same-site by an unwary reader. It cannot carry our flag unless it
  // literally contains standin=1, and it is not a value this repository writes;
  // rejected here so the answer does not depend on that coincidence.
  if (value.startsWith("//")) return false;
  try {
    const parsed = value.startsWith("/")
      ? new URL(value, RELATIVE_URL_BASE)
      : new URL(value);
    return parsed.searchParams.get(STAND_IN_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Resolve both URLs for one assignment.
 *
 * The environment variables are read per WEEK NUMBER, not per assignment id,
 * because a week number is stable across reseeds and an assignment id is not —
 * the course owner writes these once and must not have to revisit them because CI
 * dropped and recreated the database.
 */
export function resolveAssignmentLinks(input: {
  weekNumber: number;
  weekRowId: number;
  assignmentId: number;
  env?: EnvLike;
}): AssignmentLinks {
  const env = input.env ?? process.env;
  const configuredForm = env[`SUBMISSIONS_FORM_URL_WEEK_${input.weekNumber}`]?.trim();
  const configuredSheet = env[`SUBMISSIONS_SHEET_CSV_URL_WEEK_${input.weekNumber}`]?.trim();

  return {
    googleFormUrl: configuredForm || standInFormUrl(input.weekRowId),
    googleSheetCsvUrl: configuredSheet || standInSheetUrl(input.assignmentId, env),
    formSource: configuredForm ? "configured" : "stand-in",
    sheetSource: configuredSheet ? "configured" : "stand-in",
  };
}

// ---------------------------------------------------------------------------
// The stand-in response sheet
// ---------------------------------------------------------------------------

/** One manufactured Form response, positioned RELATIVE to the deadline. */
export type StandInRespondent = {
  email: string;
  /**
   * Hours from `assignments.due_at`. Negative is early.
   *
   * Relative rather than absolute because the seeded deadlines move: they are
   * derived from the cohort start date in scripts/seed.ts, and the week 1
   * deadline in the live database is currently 2026-12-01 while weeks 2-4 sit in
   * September. A hard-coded timestamp would make every stand-in row either
   * absurdly early or absurdly late depending on which database it met, and the
   * lateness path would be exercised by accident rather than by design.
   */
  offsetHours: number;
  githubUrl: string;
  liveUrl: string;
  description: string;
};

/**
 * WHY EXACTLY ONE RESPONDENT, AND WHY THAT ONE.
 *
 * `student@codequeenshub.test` is the only seeded account with no submissions of
 * its own — scripts/seed-demo-activity.ts gives graded week-1 submissions to
 * advanced@, steady@ and struggling@ (sheet_row_ref "seed:<email>"). Including
 * any of those three would make every ingest run report
 * `supersedes_graded_submission`, because persistRow refuses to overwrite an
 * instructor's stars (src/lib/submissions/ingest.ts:341). That refusal is correct
 * behaviour, but it is the wrong thing for a stand-in to demonstrate by default.
 *
 * One respondent also bounds the blast radius. This repository is built by
 * several streams against ONE shared seeded database, and ingestion is a WRITE:
 * every row here becomes a real `submissions` row the moment anyone triggers the
 * scheduled sweep. Four rows for one known demo account is a change other streams
 * can reason about; a manufactured cohort would not be.
 */
export const STAND_IN_STUDENT_EMAIL = "student@codequeenshub.test";

/**
 * Offset per week number, chosen so the four assignments together cover every
 * branch of the lateness rule against the seeded 2-day cohort grace window
 * (`cohorts.grace_period_days`, see scripts/seed.ts):
 *
 *   week 1   -6 h    before the deadline      -> daysLate 0, is_late false
 *   week 2  +24 h    inside the grace window  -> daysLate 0, is_late false, withinGrace
 *   week 3  +72 h    1 day past grace         -> daysLate 1, is_late true, 10% penalty
 *   week 4 +120 h    3 days past grace        -> daysLate 3, is_late true, 30% penalty
 *
 * An unknown week number falls back to the on-time offset: a new week appearing
 * in the curriculum must not silently start manufacturing late submissions.
 */
const OFFSET_HOURS_BY_WEEK: Readonly<Record<number, number>> = {
  1: -6,
  2: 24,
  3: 72,
  4: 120,
};
const DEFAULT_OFFSET_HOURS = -6;

export function standInOffsetHours(weekNumber: number): number {
  return OFFSET_HOURS_BY_WEEK[weekNumber] ?? DEFAULT_OFFSET_HOURS;
}

export function standInRespondents(weekNumber: number): StandInRespondent[] {
  return [
    {
      email: STAND_IN_STUDENT_EMAIL,
      offsetHours: standInOffsetHours(weekNumber),
      githubUrl: `https://github.com/codequeenshub-demo/week-${weekNumber}`,
      liveUrl: `https://week-${weekNumber}.codequeenshub-demo.example`,
      description:
        `STAND-IN RESPONSE for week ${weekNumber}. Manufactured by ` +
        "src/lib/submissions/stand-in.ts because no Google Form exists yet.",
    },
  ];
}

/**
 * RFC 4180 quoting for one cell.
 *
 * Written out rather than string-concatenated because the description above
 * contains a comma, and an unquoted comma would shift every later column by one —
 * which the parser would accept without complaint, producing a submission whose
 * "live URL" is the tail of a sentence. Papa Parse reads what Google writes, so
 * the stand-in must write what Google writes.
 */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Timestamp in the shape a Google Sheet renders with the ISO date format:
 * "2026-09-15 14:03:21", no zone. csv.ts's ISO_NAIVE branch parses exactly this
 * and interprets it as UTC (see the TIMEZONE DECISION there). Emitting the
 * ZONELESS form on purpose: the stand-in must exercise the same code path a real
 * sheet will, not the easier zoned one.
 */
function sheetTimestamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Build the stand-in response sheet for one assignment.
 *
 * The header row copies Google Forms' own column naming — "Timestamp",
 * "Email Address", then the question text verbatim — because that is what
 * `mapColumns` is written to match (src/lib/submissions/csv.ts:57). It is also
 * the part of this file most likely to be WRONG about the real thing: the real
 * question text is whatever the course owner types into the Form, and if it does
 * not match an alias the column is silently dropped. That is the single biggest
 * thing the stand-in cannot prove.
 */
export function buildStandInResponsesCsv(input: {
  dueAt: Date;
  weekNumber: number;
  respondents?: readonly StandInRespondent[];
}): string {
  const respondents = input.respondents ?? standInRespondents(input.weekNumber);
  const header = [
    "Timestamp",
    "Email Address",
    "GitHub Repository URL",
    "Live Site URL",
    "Anything else you want us to know?",
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const r of respondents) {
    const submittedAt = new Date(input.dueAt.getTime() + r.offsetHours * HOUR_MS);
    lines.push(
      [
        sheetTimestamp(submittedAt),
        r.email,
        r.githubUrl,
        r.liveUrl,
        r.description,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // Google's published CSV ends with a newline; parseSubmissionCsv treats the
  // resulting empty final row as `blank_row` and skips it. Emitted anyway so the
  // stand-in is byte-shaped like the real thing rather than conveniently tidy.
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Expected lateness of the stand-in row for a week, for tests and for the page
 * copy. Duplicating the arithmetic would defeat the purpose, so this returns the
 * INPUTS and leaves the maths to computeLateness in lateness.ts.
 */
export function standInSubmittedAt(dueAt: Date, weekNumber: number): Date {
  return new Date(dueAt.getTime() + standInOffsetHours(weekNumber) * HOUR_MS);
}

/** Exported for the tests that assert the grace-window boundaries. */
export const STAND_IN_DAY_MS = DAY_MS;
