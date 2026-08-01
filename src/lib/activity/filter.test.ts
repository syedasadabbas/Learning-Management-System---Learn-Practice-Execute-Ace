// =============================================================================
// Tests for filter parsing — the half of "readable by the people who need it"
// that is decidable without a database.
//
// The assertions that matter most are the REJECTIONS. A filter that is silently
// ignored shows an admin the whole unfiltered table, and an admin who searched for
// an event and got everything back concludes the event did not happen. In an
// investigation that is a false negative, which is worse than an error message.
// =============================================================================

import { describe, it, expect } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  EMPTY_FILTER,
  filterToQuery,
  isFiltered,
  parseActivityFilter,
} from "./filter";

function parse(query: string, options?: Parameters<typeof parseActivityFilter>[1]) {
  return parseActivityFilter(new URLSearchParams(query), options);
}

function ok(query: string) {
  const result = parse(query);
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result.filter;
}

describe("an empty query means an unfiltered, still-bounded read", () => {
  it("defaults to the page size and no clauses", () => {
    expect(ok("")).toEqual({ ...EMPTY_FILTER, limit: DEFAULT_PAGE_SIZE });
  });

  it("is not reported as filtered", () => {
    expect(isFiltered(ok(""))).toBe(false);
  });
});

describe("actor", () => {
  it("accepts a positive integer id", () => {
    expect(ok("actor=7").actorId).toBe(7);
  });

  it.each(["actor=abc", "actor=0", "actor=-3", "actor=1.5", "actor=%20"])(
    "rejects %s",
    (query) => {
      const result = parse(query);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_actor");
    },
  );

  it("treats actor=all as no filter, so a UI reset link works", () => {
    expect(ok("actor=all").actorId).toBeNull();
  });
});

describe("action", () => {
  it("accepts one name", () => {
    expect(ok("action=login").actions).toEqual(["login"]);
  });

  it("accepts a comma list", () => {
    expect(ok("action=login,login_failed").actions).toEqual(["login", "login_failed"]);
  });

  it("REJECTS an unknown name rather than ignoring the filter", () => {
    // The single most important assertion in this file. `?action=logn` must not
    // return the whole table.
    const result = parse("action=logn");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_action");
      expect(result.error).toContain("logn");
    }
  });

  it("rejects a list where only SOME names are valid", () => {
    // The partial case is the dangerous one: two of three filters applied looks
    // like a working query.
    const result = parse("action=login,nonsense");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_action");
  });
});

describe("category", () => {
  it("expands to the actions in that category", () => {
    const actions = ok("category=identity").actions!;
    expect(actions).toContain("login");
    expect(actions).toContain("password_change");
    expect(actions).not.toContain("quiz_submit");
  });

  it("rejects an unknown category", () => {
    const result = parse("category=nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_category");
  });

  it("intersects with an action filter instead of one silently winning", () => {
    expect(ok("category=identity&action=login").actions).toEqual(["login"]);
  });

  it("refuses a combination that could never match", () => {
    // Returning zero rows would look like "this never happened".
    const result = parse("category=identity&action=quiz_submit");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("contradictory_filter");
  });
});

describe("status and entity", () => {
  it("accepts the two statuses", () => {
    expect(ok("status=failure").status).toBe("failure");
    expect(ok("status=success").status).toBe("success");
  });

  it("rejects any other status", () => {
    const result = parse("status=maybe");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_status");
  });

  it("accepts an entity type and id together", () => {
    const filter = ok("entityType=submission&entityId=441");
    expect(filter.entityType).toBe("submission");
    expect(filter.entityId).toBe(441);
  });

  it("refuses an entity id with no type", () => {
    // "441" matches a submission AND a user; returning both is a wrong answer.
    const result = parse("entityId=441");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("entity_id_without_type");
  });

  it("rejects an entity type that is not a slug", () => {
    const result = parse("entityType=Submission;drop");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_entity_type");
  });
});

describe("time range", () => {
  it("parses a bare date as midnight UTC, not local", () => {
    // A local interpretation makes the same URL mean different spans in two
    // regions, which for an audit range is a correctness bug.
    expect(ok("from=2026-07-01").from?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("parses a full instant", () => {
    expect(ok("from=2026-07-01T09:30:00Z").from?.toISOString()).toBe(
      "2026-07-01T09:30:00.000Z",
    );
  });

  it.each([
    "from=31/07/2026",
    "from=2026",
    "from=last-tuesday",
    "from=2026-13-45",
    "to=nonsense",
  ])("rejects %s rather than guessing", (query) => {
    const result = parse(query);
    expect(result.ok).toBe(false);
  });

  it("rejects a range that is empty or inverted", () => {
    const inverted = parse("from=2026-07-31&to=2026-07-01");
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.code).toBe("empty_range");

    const same = parse("from=2026-07-01&to=2026-07-01");
    expect(same.ok).toBe(false);
  });

  it("supports days= as a shorthand", () => {
    const filter = ok("days=7");
    const ageMs = Date.now() - (filter.from?.getTime() ?? 0);
    expect(ageMs).toBeGreaterThan(6.9 * 86_400_000);
    expect(ageMs).toBeLessThan(7.1 * 86_400_000);
  });

  it("lets an explicit from win over days=", () => {
    expect(ok("days=7&from=2026-01-01").from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects an absurd days value", () => {
    expect(parse("days=0").ok).toBe(false);
    expect(parse("days=99999").ok).toBe(false);
    expect(parse("days=1.5").ok).toBe(false);
  });
});

describe("no unbounded read is possible", () => {
  it("clamps limit to the ceiling instead of erroring", () => {
    expect(ok(`limit=${MAX_PAGE_SIZE * 10}`).limit).toBe(MAX_PAGE_SIZE);
  });

  it("honours a raised ceiling for the export path", () => {
    expect(parse("limit=5000", { maxLimit: 20_000 })).toMatchObject({
      ok: true,
      filter: { limit: 5_000 },
    });
  });

  it("still clamps against the raised ceiling", () => {
    const result = parse("limit=999999", { maxLimit: 20_000 });
    expect(result.ok && result.filter.limit).toBe(20_000);
  });

  it("rejects a non-numeric or non-positive limit", () => {
    expect(parse("limit=abc").ok).toBe(false);
    expect(parse("limit=0").ok).toBe(false);
    expect(parse("limit=-5").ok).toBe(false);
  });
});

describe("keyset cursor", () => {
  it("accepts a row id", () => {
    expect(ok("before=1200").beforeId).toBe(1_200);
  });

  it("rejects a non-id cursor", () => {
    const result = parse("before=xyz");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_cursor");
  });
});

describe("filterToQuery round-trips what the table is showing", () => {
  // An export that applies a different filter than the table on screen is a
  // compliance artefact that does not match what was reviewed.
  it("re-parses to the same selective clauses", () => {
    const original = ok(
      "actor=7&action=login,login_failed&status=failure&entityType=user&entityId=7&from=2026-07-01&to=2026-08-01",
    );
    const round = parseActivityFilter(filterToQuery(original));
    expect(round.ok).toBe(true);
    if (round.ok) {
      expect(round.filter.actorId).toBe(original.actorId);
      expect(round.filter.actions).toEqual(original.actions);
      expect(round.filter.status).toBe(original.status);
      expect(round.filter.entityType).toBe(original.entityType);
      expect(round.filter.entityId).toBe(original.entityId);
      expect(round.filter.from?.toISOString()).toBe(original.from?.toISOString());
      expect(round.filter.to?.toISOString()).toBe(original.to?.toISOString());
    }
  });

  it("omits paging, which is per-request and not part of the selection", () => {
    const query = filterToQuery(ok("limit=10&before=99"));
    expect(query.has("limit")).toBe(false);
    expect(query.has("before")).toBe(false);
  });

  it("reports a filtered view as filtered", () => {
    expect(isFiltered(ok("actor=7"))).toBe(true);
    expect(isFiltered(ok("days=1"))).toBe(true);
    expect(isFiltered(ok("limit=10"))).toBe(false);
  });
});
