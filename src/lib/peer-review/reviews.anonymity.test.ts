// =============================================================================
// ANONYMITY AND THE REVEAL GATE, ASSERTED ON THE ACTUAL RETURNED OBJECT.
// -----------------------------------------------------------------------------
// WHY THIS TEST IS SHAPED LIKE THIS. "Reviews are anonymous" is a claim about what
// comes OUT of the read model, so a test that inspects the query, or that trusts the
// projection because a comment says so, proves nothing. Instead the mocked database
// hands the read model rows that DO carry the reviewer's id, name and email —
// exactly what a future careless `select()` would produce — and the test then
// serialises the returned value and fails if any of those three values appears
// anywhere in the object graph, at any depth.
//
// That is the property that matters: even if the QUERY changed to fetch an identity,
// the reviewee-facing shape must not carry it out of the function. Two layers,
// tested at the outer one.
//
// WHAT THIS TEST CANNOT COVER, stated rather than implied. The `where` clauses that
// scope rows to `reviewee_id = viewer` and `reviewer_id = viewer` are SQL, and a
// mocked client does not execute SQL. Those are asserted end-to-end in
// tests/e2e/peer-review/authorization.spec.ts, which this stream is NOT permitted to
// run (eight agents share one database and one port). They are therefore UNVERIFIED
// by anything that has actually been executed — see the TODO at the foot of this
// file.
//
// `@/db` is mocked with a factory so the real module — which throws at import time
// when DATABASE_URL is unset and opens a pool when it is — is never evaluated. Same
// technique and same reason as
// src/lib/queue/handlers/submission-graded-email.test.ts.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Rows the mocked query chain returns. Set per test. */
let queryRows: unknown[] = [];

vi.mock("@/db", () => {
  // Shaped like the drizzle select builder these read models use:
  //   .select().from().innerJoin()xN.leftJoin().where().orderBy()   -> rows
  //   .select().from()...where().limit()                            -> rows
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "innerJoin", "leftJoin", "where"]) {
    chain[method] = () => chain;
  }
  chain.orderBy = async () => queryRows;
  chain.limit = async () => queryRows;
  return { db: chain };
});

import { getMyReviewTasks, getReceivedReviews } from "./reviews";
import { DEFAULT_RUBRIC_CRITERIA } from "./rubric";
import { REVIEWER_IDENTITY_FIELDS } from "./visibility";

// The identity that must never reach the reviewee. Distinctive strings so a
// substring search over the serialised result cannot pass by coincidence.
const SECRET_REVIEWER_ID = 987654;
const SECRET_REVIEWER_NAME = "Zainab Reviewer-Identity";
const SECRET_REVIEWER_EMAIL = "secret-reviewer@codequeenshub.test";

const RELEASED_AT = new Date("2026-07-31T12:00:00.000Z");
const SUBMITTED_AT = new Date("2026-07-30T09:00:00.000Z");

/**
 * A row as the reviewee-facing query returns it, PLUS the three identity fields a
 * careless projection would add. The read model must ignore them.
 */
function revieweeRow(overrides: Record<string, unknown> = {}) {
  return {
    roundId: 1,
    assignmentId: 7,
    assignmentTitle: "Week 2 — Responsive Layout",
    weekNumber: 2,
    reviewsPerSubmission: 2,
    releasedAt: RELEASED_AT,
    criteria: [...DEFAULT_RUBRIC_CRITERIA],
    content: "The grid holds at 360 mm and the footer contrast is too low to read.",
    rubricScores: { requirements: 4, quality: 3, presentation: 5 },
    totalScore: 12,
    submittedAt: SUBMITTED_AT,
    flaggedAt: null,
    // --- the leak bait -----------------------------------------------------
    reviewerId: SECRET_REVIEWER_ID,
    reviewerName: SECRET_REVIEWER_NAME,
    reviewerEmail: SECRET_REVIEWER_EMAIL,
    ...overrides,
  };
}

/** Every string and number in an object graph, flattened. */
function flatten(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (value instanceof Date) return out;
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      flatten(nested, out);
    }
    return out;
  }
  out.push(String(value));
  return out;
}

beforeEach(() => {
  queryRows = [revieweeRow()];
});

describe("getReceivedReviews — the reviewee never receives an identity", () => {
  it("returns the review text but no reviewer id, name or email", async () => {
    const groups = await getReceivedReviews(22);
    expect(groups).toHaveLength(1);
    expect(groups[0].reviews).toHaveLength(1);
    // The review really did come through — otherwise the assertions below would pass
    // vacuously on an empty result, which is the failure mode this guards.
    expect(groups[0].reviews[0].content).toContain("360 mm");

    const serialised = JSON.stringify(groups);
    expect(serialised).not.toContain(String(SECRET_REVIEWER_ID));
    expect(serialised).not.toContain(SECRET_REVIEWER_NAME);
    expect(serialised).not.toContain(SECRET_REVIEWER_EMAIL);
    // Not even the local part of the address, in case a template ever splits it.
    expect(serialised).not.toContain("secret-reviewer");
  });

  it("carries none of the forbidden field NAMES, at any depth", async () => {
    const groups = await getReceivedReviews(22);
    const keysAndValues = flatten(groups);
    for (const field of REVIEWER_IDENTITY_FIELDS) {
      expect(keysAndValues, `"${field}" must not appear in a reviewee-facing response`).not.toContain(
        field,
      );
    }
  });

  it("labels reviews positionally, never with the database row id", async () => {
    // A real `peer_reviews.id` is a global sequence. Two students comparing the ids
    // they received could narrow down who reviewed whom, and a student who got ids 41
    // and 63 learns how many reviews the cohort wrote in between.
    queryRows = [
      revieweeRow({ content: "First review, at least one hundred and twenty characters of it." }),
      revieweeRow({ content: "Second review, also long enough to have been accepted at submit." }),
    ];
    const groups = await getReceivedReviews(22);
    expect(groups[0].reviews.map((r) => r.reviewNumber)).toEqual([1, 2]);
    expect(JSON.stringify(groups)).not.toContain('"id"');
  });
});

describe("getReceivedReviews — the reveal gate", () => {
  it("returns NO reviews before the instructor releases the round", async () => {
    // The round is present so the page can say "being reviewed by an instructor",
    // and `reviews` is empty so there is nothing to read. Both halves matter: a
    // missing group would be indistinguishable from "nobody reviewed your work".
    queryRows = [revieweeRow({ releasedAt: null })];
    const groups = await getReceivedReviews(22);
    expect(groups).toHaveLength(1);
    expect(groups[0].released).toBe(false);
    expect(groups[0].reviews).toEqual([]);
    // And the content is not smuggled through some other field.
    expect(JSON.stringify(groups)).not.toContain("360 mm");
  });

  it("withholds a review an instructor flagged, even after release", async () => {
    queryRows = [revieweeRow({ flaggedAt: new Date("2026-07-30T10:00:00.000Z") })];
    const groups = await getReceivedReviews(22);
    expect(groups[0].released).toBe(true);
    expect(groups[0].reviews).toEqual([]);
    expect(JSON.stringify(groups)).not.toContain("360 mm");
  });

  it("never leaks the instructor's private note about a flagged review", async () => {
    queryRows = [
      revieweeRow({
        flaggedAt: new Date("2026-07-30T10:00:00.000Z"),
        instructorNote: "Low effort, reviewer spoken to.",
      }),
    ];
    const groups = await getReceivedReviews(22);
    expect(JSON.stringify(groups)).not.toContain("Low effort");
  });

  it("shows a released, unflagged review alongside one that is withheld", async () => {
    queryRows = [
      revieweeRow({ content: "A perfectly good review that is long enough to have been stored." }),
      revieweeRow({ flaggedAt: new Date(), content: "Withheld one, also long enough to store." }),
    ];
    const groups = await getReceivedReviews(22);
    expect(groups[0].reviews).toHaveLength(1);
    expect(groups[0].reviews[0].content).toContain("perfectly good");
  });

  it("reports a round with no submitted reviews as released but empty", async () => {
    queryRows = [revieweeRow({ submittedAt: null, content: null, rubricScores: null })];
    const groups = await getReceivedReviews(22);
    expect(groups[0].released).toBe(true);
    expect(groups[0].reviews).toEqual([]);
    // `reviewsPerSubmission` still comes through, so the page can say "0 of 2".
    expect(groups[0].reviewsPerSubmission).toBe(2);
  });
});

describe("getMyReviewTasks — the reviewer is not told whose work it is", () => {
  /** A reviewer-side row, again with identity bait the projection must ignore. */
  function taskRow(overrides: Record<string, unknown> = {}) {
    return {
      allocationId: 5,
      roundId: 1,
      submissionId: 42,
      assignmentTitle: "Week 2 — Responsive Layout",
      weekNumber: 2,
      githubUrl: "https://github.com/example/week2",
      liveUrl: null,
      description: "Deployed to Netlify.",
      reviewDueAt: new Date("2026-08-05T12:00:00.000Z"),
      submittedAt: null,
      content: null,
      rubricScores: null,
      totalScore: null,
      flaggedAt: null,
      criteria: [...DEFAULT_RUBRIC_CRITERIA],
      // --- leak bait: the AUTHOR's identity this time ------------------------
      revieweeId: 22,
      studentName: "Chandni Struggling",
      studentEmail: "struggling@codequeenshub.test",
      ...overrides,
    };
  }

  it("does not carry the author's name, email or user id", async () => {
    // Best-effort blinding, not a guarantee: the header of ./visibility.ts states
    // that `githubUrl` frequently names its owner, which is why this stream claims
    // single-blind-enforced rather than double-blind. What IS enforced is that this
    // stream does not hand the reviewer the name.
    queryRows = [taskRow()];
    const tasks = await getMyReviewTasks(11);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].submissionId).toBe(42);

    const serialised = JSON.stringify(tasks);
    expect(serialised).not.toContain("Chandni");
    expect(serialised).not.toContain("struggling@codequeenshub.test");
    expect(flatten(tasks)).not.toContain("revieweeId");
  });

  it("shows the reviewer their own submitted review back", async () => {
    queryRows = [
      taskRow({
        submittedAt: SUBMITTED_AT,
        content: "What I said about this work, at length and above the character floor.",
        rubricScores: { requirements: 4, quality: 3, presentation: 5 },
        totalScore: 12,
      }),
    ];
    const tasks = await getMyReviewTasks(11);
    expect(tasks[0].submittedAt).toEqual(SUBMITTED_AT);
    expect(tasks[0].content).toContain("What I said");
    expect(tasks[0].scoreLines).toHaveLength(3);
    expect(tasks[0].totalScore).toBe(12);
  });

  it("shows no score lines for a task not yet written", async () => {
    queryRows = [taskRow()];
    const tasks = await getMyReviewTasks(11);
    expect(tasks[0].scoreLines).toEqual([]);
    expect(tasks[0].submittedAt).toBeNull();
  });

  it("tells the reviewer their review was flagged, without the instructor's note", async () => {
    queryRows = [
      taskRow({
        submittedAt: SUBMITTED_AT,
        content: "A review of mine that an instructor decided to withhold from its subject.",
        flaggedAt: new Date(),
      }),
    ];
    const tasks = await getMyReviewTasks(11);
    expect(tasks[0].flagged).toBe(true);
    expect(flatten(tasks)).not.toContain("instructorNote");
  });
});

// =============================================================================
// TODO(peer-review): UNVERIFIED BY EXECUTION.
// The row-scoping halves of the authorization story — `where reviewee_id = viewer`
// in getReceivedReviews, `where reviewer_id = viewer` in getReviewTask and
// submitReview — are SQL predicates, and the mocked client above does not execute
// SQL. They are covered by tests/e2e/peer-review/authorization.spec.ts, which this
// stream is not permitted to run (eight agents, one shared database, one port). Run
// that spec before trusting the claim that a student cannot read a review they were
// not party to.
// =============================================================================
