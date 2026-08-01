// =============================================================================
// AUTHORIZATION — THE NEGATIVES.
// -----------------------------------------------------------------------------
// Every test in the first two describes is a case that must be REFUSED. That is
// the deliberate emphasis: an authorization bug in peer review does not throw and
// does not 500 — it shows one student another student's feedback, or shows a
// student feedback before a human has looked at it. The positive cases are here
// too, but they are the cheap half.
//
// Pure functions, so the refusals are enumerated as a table rather than clicked
// through in a browser.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  REVIEWER_IDENTITY_FIELDS,
  canReadReview,
  canWriteReview,
  isRevealedToReviewee,
  isRoundReleased,
} from "./visibility";

const REVIEWER = 11;
const REVIEWEE = 22;
const STRANGER = 33;

const ALLOCATION = { reviewerId: REVIEWER, revieweeId: REVIEWEE };

const RELEASED = { releasedAt: new Date("2026-07-31T12:00:00.000Z") };
const UNRELEASED = { releasedAt: null };

const SUBMITTED = { submittedAt: new Date("2026-07-30T09:00:00.000Z"), flaggedAt: null };
const FLAGGED = {
  submittedAt: new Date("2026-07-30T09:00:00.000Z"),
  flaggedAt: new Date("2026-07-30T10:00:00.000Z"),
};

describe("canReadReview — refusals", () => {
  it("refuses a student who is neither the reviewer nor the reviewee", () => {
    // The commonest attack on this feature is incrementing an id in a URL. This is
    // the check that must come FIRST, before anything about release state, so that a
    // stranger cannot even learn whether a review exists.
    const decision = canReadReview({
      viewerId: STRANGER,
      allocation: ALLOCATION,
      round: RELEASED,
      review: SUBMITTED,
    });
    expect(decision).toEqual({ allowed: false, reason: "not_a_party" });
  });

  it("refuses a stranger even when everything else would allow it", () => {
    // Belt and braces on the ordering: a released, submitted, unflagged review is
    // the most readable state there is, and a stranger still may not have it.
    for (const round of [RELEASED, UNRELEASED]) {
      for (const review of [SUBMITTED, FLAGGED, null]) {
        expect(
          canReadReview({ viewerId: STRANGER, allocation: ALLOCATION, round, review }).allowed,
        ).toBe(false);
      }
    }
  });

  it("refuses the reviewee before the round is released", () => {
    // THE REVEAL POINT. The review exists, it is theirs to see eventually, and they
    // may not see it yet.
    const decision = canReadReview({
      viewerId: REVIEWEE,
      allocation: ALLOCATION,
      round: UNRELEASED,
      review: SUBMITTED,
    });
    expect(decision).toEqual({ allowed: false, reason: "not_released" });
  });

  it("refuses the reviewee a review an instructor has flagged", () => {
    // The gaming defence's teeth: a flagged review is withheld from the person it
    // was written about even after the round is released.
    const decision = canReadReview({
      viewerId: REVIEWEE,
      allocation: ALLOCATION,
      round: RELEASED,
      review: FLAGGED,
    });
    expect(decision).toEqual({ allowed: false, reason: "flagged" });
  });

  it("refuses everyone when no review has been written", () => {
    for (const viewerId of [REVIEWER, REVIEWEE]) {
      expect(
        canReadReview({ viewerId, allocation: ALLOCATION, round: RELEASED, review: null }),
      ).toEqual({ allowed: false, reason: "not_submitted" });
    }
  });

  it("treats a review row with a null submittedAt as not written", () => {
    // Defensive: the column is NOT NULL in the schema, so this can only arise from a
    // future draft feature. If one is added, the default must be "not visible".
    expect(
      canReadReview({
        viewerId: REVIEWEE,
        allocation: ALLOCATION,
        round: RELEASED,
        review: { submittedAt: null, flaggedAt: null },
      }),
    ).toEqual({ allowed: false, reason: "not_submitted" });
  });
});

describe("canReadReview — the permitted cases", () => {
  it("lets the reviewee read a submitted, released, unflagged review", () => {
    expect(
      canReadReview({
        viewerId: REVIEWEE,
        allocation: ALLOCATION,
        round: RELEASED,
        review: SUBMITTED,
      }),
    ).toEqual({ allowed: true });
  });

  it("lets the reviewer re-read their own review before release", () => {
    // Their own writing. Withholding it would be theatre and would stop them
    // checking what they said.
    expect(
      canReadReview({
        viewerId: REVIEWER,
        allocation: ALLOCATION,
        round: UNRELEASED,
        review: SUBMITTED,
      }),
    ).toEqual({ allowed: true });
  });

  it("lets the reviewer re-read their own review even once it is flagged", () => {
    // The flag withholds it from the REVIEWEE. Hiding it from its author would mean
    // a student told their work was flagged cannot see what they wrote.
    expect(
      canReadReview({
        viewerId: REVIEWER,
        allocation: ALLOCATION,
        round: RELEASED,
        review: FLAGGED,
      }),
    ).toEqual({ allowed: true });
  });
});

describe("canWriteReview — refusals", () => {
  it("refuses a student who was not allocated this submission", () => {
    expect(
      canWriteReview({ viewerId: STRANGER, allocation: ALLOCATION, existingReview: null }),
    ).toEqual({ allowed: false, reason: "not_the_reviewer" });
  });

  it("refuses the REVIEWEE writing a review of their own work", () => {
    // The party with the most motive. `peer_review_allocations` also carries a
    // database CHECK that reviewer_id <> reviewee_id, so no such allocation can
    // exist in the first place — this covers the case where the ids are supplied by
    // a request rather than read from a row.
    expect(
      canWriteReview({ viewerId: REVIEWEE, allocation: ALLOCATION, existingReview: null }),
    ).toEqual({ allowed: false, reason: "not_the_reviewer" });
  });

  it("refuses editing a review that has already been submitted", () => {
    // There is no edit path at all: `peer_reviews.allocation_id` is UNIQUE and no
    // code issues an UPDATE. This check exists so the refusal is a sentence rather
    // than a Postgres 23505.
    expect(
      canWriteReview({ viewerId: REVIEWER, allocation: ALLOCATION, existingReview: SUBMITTED }),
    ).toEqual({ allowed: false, reason: "already_submitted" });
  });

  it("refuses editing a flagged review", () => {
    // A flagged review is submitted, so the already_submitted refusal covers it. A
    // reviewer must not be able to launder a flag by rewriting the review.
    expect(
      canWriteReview({ viewerId: REVIEWER, allocation: ALLOCATION, existingReview: FLAGGED })
        .allowed,
    ).toBe(false);
  });

  it("lets the allocated reviewer write once", () => {
    expect(
      canWriteReview({ viewerId: REVIEWER, allocation: ALLOCATION, existingReview: null }),
    ).toEqual({ allowed: true });
  });

  it("does NOT refuse a late review", () => {
    // Stated as a test because it is a deliberate non-condition: `review_due_at` is
    // advisory, and refusing after it would leave a reviewee with no feedback in
    // exchange for punctuality nobody is scored on.
    expect(
      canWriteReview({ viewerId: REVIEWER, allocation: ALLOCATION, existingReview: null }).allowed,
    ).toBe(true);
  });
});

describe("isRoundReleased / isRevealedToReviewee", () => {
  it("is not released until an instructor sets releasedAt", () => {
    expect(isRoundReleased(UNRELEASED)).toBe(false);
    expect(isRoundReleased(RELEASED)).toBe(true);
  });

  it("reveals only a submitted, released, unflagged review", () => {
    expect(isRevealedToReviewee({ round: RELEASED, review: SUBMITTED })).toBe(true);
    expect(isRevealedToReviewee({ round: UNRELEASED, review: SUBMITTED })).toBe(false);
    expect(isRevealedToReviewee({ round: RELEASED, review: FLAGGED })).toBe(false);
    expect(isRevealedToReviewee({ round: RELEASED, review: null })).toBe(false);
    expect(isRevealedToReviewee({ round: UNRELEASED, review: null })).toBe(false);
  });

  it("agrees with canReadReview for the reviewee, in every combination", () => {
    // Two functions expressing one rule is exactly how the rule comes to differ
    // between the filter and the check. This is the test that stops that.
    for (const round of [RELEASED, UNRELEASED]) {
      for (const review of [SUBMITTED, FLAGGED, null]) {
        const revealed = isRevealedToReviewee({ round, review });
        const readable = canReadReview({
          viewerId: REVIEWEE,
          allocation: ALLOCATION,
          round,
          review,
        }).allowed;
        expect(revealed).toBe(readable);
      }
    }
  });
});

describe("the identity field list is not empty", () => {
  it("names the fields the anonymity test forbids", () => {
    // A vacuous loop over an empty list is a green test that checks nothing —
    // the same failure mode boundary-scope.test.ts guards against with its
    // "the route derivation itself works" case.
    expect(REVIEWER_IDENTITY_FIELDS.length).toBeGreaterThan(2);
    expect(REVIEWER_IDENTITY_FIELDS).toContain("reviewerId");
    expect(REVIEWER_IDENTITY_FIELDS).toContain("reviewerName");
    expect(REVIEWER_IDENTITY_FIELDS).toContain("reviewerEmail");
  });
});
