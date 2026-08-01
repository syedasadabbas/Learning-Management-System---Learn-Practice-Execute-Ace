// =============================================================================
// UNIT TESTS — link resolution and the stand-in response sheet.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// These tests are the ONLY verification of the ingestion pipeline that does not
// need a network or a database, and while no Google Form exists they are the only
// verification of the stand-in that runs anywhere at all. Imports are from the
// individual modules, never from ./index, because the barrel re-exports the
// database-backed modules and would drag in the `pg` Pool (see the note at the top
// of index.ts).
//
// The chain proved here, in order:
//   1. resolveAssignmentLinks prefers a REAL configured URL and falls back to the
//      stand-in — the whole point being that a course owner's URL always wins.
//   2. The stand-in sheet is fetchable at all: its URL passes the SSRF allow-list
//      in fetch-csv.ts. A stand-in the fetcher refuses is worse than no stand-in.
//   3. The bytes it emits parse through the REAL parser into the REAL fields.
//   4. Those parsed rows, run through the REAL lateness and scoring code, produce
//      the intended penalty for each week.
// Nothing is re-implemented here; every step calls the production function.
// =============================================================================

import { describe, expect, it } from "vitest";

import { POINTS } from "@/lib/contracts/scoring";

import { parseSubmissionCsv } from "./csv";
import { isAllowedCsvUrl } from "./fetch-csv";
import { computeLateness, pointsForSubmission } from "./lateness";
import {
  STAND_IN_FLAG,
  STAND_IN_STUDENT_EMAIL,
  buildStandInResponsesCsv,
  isStandInUrl,
  resolveAssignmentLinks,
  standInBaseUrl,
  standInFormUrl,
  standInOffsetHours,
  standInSheetUrl,
  standInSubmittedAt,
} from "./stand-in";

/** The seeded cohort grace window, `cohorts.grace_period_days` in scripts/seed.ts. */
const GRACE_DAYS = 2;

/** An arbitrary but fixed deadline. Nothing here may depend on the wall clock. */
const DUE_AT = new Date("2026-09-15T00:00:00.000Z");

// ---------------------------------------------------------------------------
// 1. Link resolution
// ---------------------------------------------------------------------------

describe("standInBaseUrl", () => {
  it("prefers the explicit override over NEXTAUTH_URL", () => {
    expect(
      standInBaseUrl({
        SUBMISSIONS_STAND_IN_BASE_URL: "https://preview.example.test",
        NEXTAUTH_URL: "http://localhost:3000",
      }),
    ).toBe("https://preview.example.test");
  });

  it("falls back to NEXTAUTH_URL, then to the dev server origin", () => {
    expect(standInBaseUrl({ NEXTAUTH_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
    expect(standInBaseUrl({})).toBe("http://localhost:3000");
  });

  it("strips a trailing slash so a rooted path does not produce a double slash", () => {
    // A "//api/..." path is a redirect, i.e. a SECOND request on the ingestion
    // hot path, and the redirect target would have to re-pass the allow-list.
    expect(
      standInBaseUrl({ SUBMISSIONS_STAND_IN_BASE_URL: "http://localhost:3000/" }),
    ).toBe("http://localhost:3000");
  });
});

describe("resolveAssignmentLinks", () => {
  const base = { weekNumber: 2, weekRowId: 12, assignmentId: 7 };

  it("uses the stand-in when nothing is configured, and says so", () => {
    const links = resolveAssignmentLinks({ ...base, env: {} });
    expect(links.formSource).toBe("stand-in");
    expect(links.sheetSource).toBe("stand-in");
    // Keyed on weeks.id, not the week number: /assignments/[weekId] resolves on
    // weeks.id, so a week number here would 404 after any reseed.
    //
    // The FORM url is ORIGIN-RELATIVE and the SHEET url is absolute. That asymmetry
    // is the fix for the e2e failure at tests/e2e/submissions/submissions.spec.ts:478
    // and is argued in full on `standInFormUrl`: the form link is followed by a
    // BROWSER that is already on some origin (which may not be the NEXTAUTH_URL the
    // database was seeded with — 127.0.0.1 vs localhost, or a preview deployment),
    // while the sheet URL is fetched by the SERVER, which has no document to resolve
    // a relative path against.
    expect(links.googleFormUrl).toBe(`/assignments/12/submit?${STAND_IN_FLAG}=1`);
    expect(links.googleSheetCsvUrl).toBe(
      `http://localhost:3000/api/stand-in/assignments/7/responses?${STAND_IN_FLAG}=1`,
    );
  });

  it("a real configured URL always wins over the stand-in", () => {
    const links = resolveAssignmentLinks({
      ...base,
      env: {
        SUBMISSIONS_FORM_URL_WEEK_2: "https://docs.google.com/forms/d/e/REAL/viewform",
        SUBMISSIONS_SHEET_CSV_URL_WEEK_2: "https://docs.google.com/spreadsheets/d/REAL/pub?output=csv",
      },
    });
    expect(links.formSource).toBe("configured");
    expect(links.sheetSource).toBe("configured");
    expect(links.googleFormUrl).toContain("docs.google.com/forms");
    expect(isStandInUrl(links.googleFormUrl)).toBe(false);
  });

  it("resolves the two columns independently", () => {
    // A Form URL is often known before its response sheet has been published, so
    // half-configured must be a supported state rather than an all-or-nothing.
    const links = resolveAssignmentLinks({
      ...base,
      env: {
        SUBMISSIONS_FORM_URL_WEEK_2: "https://docs.google.com/forms/d/e/REAL/viewform",
      },
    });
    expect(links.formSource).toBe("configured");
    expect(links.sheetSource).toBe("stand-in");
  });

  it("reads the variables by week NUMBER, so a reseed does not invalidate them", () => {
    const links = resolveAssignmentLinks({
      weekNumber: 3,
      weekRowId: 99,
      assignmentId: 400,
      env: { SUBMISSIONS_FORM_URL_WEEK_2: "https://docs.google.com/forms/wrong" },
    });
    expect(links.formSource).toBe("stand-in");
  });
});

describe("isStandInUrl", () => {
  it("recognises a URL this repository minted", () => {
    expect(isStandInUrl(standInSheetUrl(3, {}))).toBe(true);
  });

  it("does not claim a real Google URL", () => {
    expect(isStandInUrl("https://docs.google.com/forms/d/e/ABC/viewform")).toBe(false);
  });

  it("treats null, blank and unparseable values as NOT stand-ins", () => {
    // Deliberate: suppressing the "this is not the real form" warning for a value
    // nobody understands is the failure mode worth avoiding.
    expect(isStandInUrl(null)).toBe(false);
    expect(isStandInUrl("   ")).toBe(false);
    expect(isStandInUrl("not a url at all")).toBe(false);
  });

  // -- The relative form, added 2026-07-31 with the :478 e2e fix ---------------

  it("recognises the ORIGIN-RELATIVE form URL this repository now mints", () => {
    // Load-bearing. `standInFormUrl` no longer carries an origin, and `new URL(value)`
    // throws on a relative path — so without this the seeded Form URL would be
    // classified as a REAL Google form, SubmitLink would drop the "this is not the
    // real form" warning, and the student would be told to submit through a page that
    // is explicitly not a submission form.
    expect(isStandInUrl(standInFormUrl(1))).toBe(true);
    expect(isStandInUrl(`/assignments/12/submit?${STAND_IN_FLAG}=1`)).toBe(true);
  });

  it("still recognises the ABSOLUTE form URL an older seed wrote", () => {
    // Databases seeded before this change hold the absolute shape. They must keep
    // being recognised as stand-ins until a re-seed renormalises them, or those rows
    // lose their warning banner in the meantime.
    expect(isStandInUrl(`http://localhost:3000/assignments/1/submit?${STAND_IN_FLAG}=1`)).toBe(
      true,
    );
  });

  it("does not treat a bare relative path as a stand-in — the FLAG decides", () => {
    // A relative path is now parseable rather than junk, so the distinction rests
    // entirely on `standin=1`. An instructor who typed a relative path by hand has
    // not thereby declared it a stand-in.
    expect(isStandInUrl("/assignments/1/submit")).toBe(false);
    expect(isStandInUrl("/assignments/1/submit?standin=0")).toBe(false);
    expect(isStandInUrl("/assignments/1/submit?other=1")).toBe(false);
  });

  it("refuses a protocol-relative URL, which is not same-site despite looking it", () => {
    // "//evil.example/x" resolves against a base and would read as a local path to a
    // careless reader. Not a value this repository writes; rejected explicitly so the
    // answer does not depend on that coincidence.
    expect(isStandInUrl(`//evil.example/assignments/1/submit?${STAND_IN_FLAG}=1`)).toBe(false);
  });
});

describe("standInFormUrl — relative on purpose", () => {
  it("carries no origin at all", () => {
    // THE FIX FOR tests/e2e/submissions/submissions.spec.ts:478. The value is written
    // to the database at seed time from NEXTAUTH_URL ("http://localhost:3000"), and
    // the app is served to the test browser on "http://127.0.0.1:3000". Clicking an
    // absolute link crossed origins, the host-only session cookie was not sent, and
    // requireUser() redirected the student to /login instead of the stand-in page. The
    // same defect bites any origin the app is reached on that is not the one the
    // database was seeded with — a preview deployment, a custom domain, www vs apex.
    const url = standInFormUrl(1);
    expect(url.startsWith("/")).toBe(true);
    expect(url).not.toContain("://");
    expect(url).toBe(`/assignments/1/submit?${STAND_IN_FLAG}=1`);
  });

  it("is keyed on weeks.id, since that is what /assignments/[weekId] resolves on", () => {
    expect(standInFormUrl(42)).toContain("/assignments/42/");
  });

  it("takes no env, so it cannot go stale against a moved origin", () => {
    // Asserted on the SIGNATURE rather than on behaviour: the previous version
    // accepted an `env` and that parameter is what made a stale origin possible.
    expect(standInFormUrl.length).toBe(1);
  });

  it("the SHEET url stays absolute, because a server-side fetch has no base", () => {
    // The asymmetry is the point. `fetchPublishedCsv` calls global fetch with this
    // string; a relative path there is not a URL at all.
    expect(standInSheetUrl(1, { NEXTAUTH_URL: "http://localhost:3000" })).toContain(
      "http://localhost:3000/",
    );
  });
});

describe("the stand-in sheet URL is actually fetchable", () => {
  it("passes the SSRF allow-list in fetch-csv.ts on the default origin", () => {
    // The allow-list permits loopback precisely so a locally served fixture works.
    expect(isAllowedCsvUrl(standInSheetUrl(1, {}))).toEqual({ ok: true });
  });

  it("is REFUSED on a non-loopback http origin, which is the allow-list working", () => {
    // Documented consequence, not a bug: a stand-in on a remote http host would be
    // an unauthenticated plaintext fetch. Recorded as a test so the behaviour is
    // known rather than discovered during an outage.
    const url = standInSheetUrl(1, {
      SUBMISSIONS_STAND_IN_BASE_URL: "http://staging.example.test",
    });
    expect(isAllowedCsvUrl(url).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The emitted CSV, through the real parser
// ---------------------------------------------------------------------------

describe("buildStandInResponsesCsv", () => {
  it("emits a header whose columns the real mapper resolves", () => {
    const parsed = parseSubmissionCsv(buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber: 1 }));
    expect(parsed.aborted).toBeNull();
    expect(parsed.columns.timestamp).toBeGreaterThanOrEqual(0);
    expect(parsed.columns.email).toBeGreaterThanOrEqual(0);
    expect(parsed.columns.githubUrl).toBeGreaterThanOrEqual(0);
    expect(parsed.columns.liveUrl).toBeGreaterThanOrEqual(0);
    expect(parsed.columns.description).toBeGreaterThanOrEqual(0);
  });

  it("parses to exactly one usable row, for the one demo student", () => {
    const parsed = parseSubmissionCsv(buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber: 1 }));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].email).toBe(STAND_IN_STUDENT_EMAIL);
    expect(parsed.rows[0].githubUrl).toContain("github.com");
    // A derivable row ref is what makes ingestion idempotent; a null one would
    // escape the unique index and re-insert on every run.
    expect(parsed.rows[0].rowRef).toMatch(/^v1:[0-9a-f]{32}$/);
  });

  it("quotes the description, so its comma does not shift later columns", () => {
    const csv = buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber: 1 });
    const parsed = parseSubmissionCsv(csv);
    expect(parsed.rows[0].description).toContain("STAND-IN RESPONSE");
    // The live URL must survive intact — that is the column a bad quote breaks.
    expect(parsed.rows[0].liveUrl).toBe("https://week-1.codequeenshub-demo.example");
  });

  it("places the timestamp at the intended offset from the deadline", () => {
    const parsed = parseSubmissionCsv(buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber: 3 }));
    const expected = standInSubmittedAt(DUE_AT, 3);
    expect(parsed.rows[0].submittedAt.toISOString()).toBe(expected.toISOString());
    expect(standInOffsetHours(3)).toBe(72);
  });

  it("re-emitting for the same deadline is byte-identical, so re-ingestion is a no-op", () => {
    // Row refs are derived from the row's content. If the CSV wobbled between
    // requests, every hourly cron run would mint a new ref and supersede the
    // previous submission instead of leaving it alone.
    expect(buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber: 2 })).toBe(
      buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber: 2 }),
    );
  });

  it("defaults an unknown week to the ON-TIME offset", () => {
    // A new week appearing in the curriculum must not silently start
    // manufacturing late submissions and the penalties that follow them.
    expect(standInOffsetHours(99)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Lateness and penalties, through the real scoring code
// ---------------------------------------------------------------------------

describe("the stand-in exercises every branch of the lateness rule", () => {
  /** Parse the stand-in for a week and measure it exactly as ingestion does. */
  function latenessForWeek(weekNumber: number) {
    const parsed = parseSubmissionCsv(
      buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber }),
    );
    return computeLateness({
      submittedAt: parsed.rows[0].submittedAt,
      dueAt: DUE_AT,
      gracePeriodDays: GRACE_DAYS,
    });
  }

  it("week 1 is before the deadline — not late", () => {
    const l = latenessForWeek(1);
    expect(l.daysLate).toBe(0);
    expect(l.isLate).toBe(false);
    expect(l.withinGrace).toBe(false);
  });

  it("week 2 is inside the 2-day grace window — past due, still not late", () => {
    const l = latenessForWeek(2);
    expect(l.daysLate).toBe(0);
    expect(l.isLate).toBe(false);
    expect(l.withinGrace).toBe(true);
    // rawDaysLate is what the penalties module consumes; it must NOT be graced,
    // or evaluatePenaltiesWithGrace would subtract the window twice.
    expect(l.rawDaysLate).toBe(1);
  });

  it("week 3 is one day past the grace window", () => {
    const l = latenessForWeek(3);
    expect(l.daysLate).toBe(1);
    expect(l.isLate).toBe(true);
  });

  it("week 4 is three days past the grace window", () => {
    const l = latenessForWeek(4);
    expect(l.daysLate).toBe(3);
    expect(l.isLate).toBe(true);
  });
});

describe("late penalties applied to the stand-in submissions", () => {
  /** Points for the stand-in row of a week, at a given star rating. */
  function pointsForWeek(weekNumber: number, stars: number | null) {
    const parsed = parseSubmissionCsv(buildStandInResponsesCsv({ dueAt: DUE_AT, weekNumber }));
    return pointsForSubmission({
      submittedAt: parsed.rows[0].submittedAt,
      dueAt: DUE_AT,
      gracePeriodDays: GRACE_DAYS,
      latePenaltyPercentPerDay: 10,
      stars,
    });
  }

  it("an on-time 5-star submission loses nothing", () => {
    const onTime = pointsForWeek(1, 5);
    expect(onTime.lateness.daysLate).toBe(0);
    // The absolute value belongs to the frozen scoring contract, not to this
    // stream, so the assertion is "no deduction", expressed as a comparison.
    expect(onTime.points).toBe(pointsForWeek(2, 5).points);
  });

  it("a one-day-late submission is penalised, and a three-day-late one more so", () => {
    const clean = pointsForWeek(1, 5).points;
    const oneDay = pointsForWeek(3, 5).points;
    const threeDay = pointsForWeek(4, 5).points;
    expect(oneDay).toBeLessThan(clean);
    expect(threeDay).toBeLessThan(oneDay);
  });

  it("the deduction is capped, so lateness can never drive a score below zero", () => {
    expect(pointsForWeek(4, 5).points).toBeGreaterThanOrEqual(0);
    expect(pointsForWeek(4, 1).points).toBeGreaterThanOrEqual(0);
  });

  it("an UNGRADED submission scores NOTHING until an instructor rates it", () => {
    // INVERTED 2026-07-31, and the previous version of this test is worth reading in
    // `git log` because it documented a real defect faithfully. It asserted that an
    // ungraded submission already scored the full 40, because `assignmentPoints`
    // started at POINTS.ASSIGNMENT_MAX and only ever DEDUCTED — so `stars: null`
    // meant "no star deduction", not "not yet worth anything".
    //
    // That mattered here more than anywhere: `standInRespondents` manufactures a
    // response, ingestion turns it into a submission row, and the student dashboard
    // reads its score through `assignmentPointsForWeek`. The stand-in existing was
    // therefore enough to award a student 40% of a week's marks. Fixed in the scoring
    // contract; asserted here so the stand-in's effect on a real score stays explicit.
    expect(pointsForWeek(1, null).points).toBe(0);
    expect(pointsForWeek(4, null).points).toBe(0);
    // A rating is what turns it into marks, and lateness bites on the rated value.
    expect(pointsForWeek(1, 3).points).toBe(POINTS.ASSIGNMENT_MAX);
    expect(pointsForWeek(4, 3).points).toBeLessThan(pointsForWeek(1, 3).points);
  });
});
