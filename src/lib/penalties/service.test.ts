// =============================================================================
// Penalty persistence tests — the DATABASE IS MOCKED (see attendance/service.test.ts
// for the same rationale). These assert the statements this module issues and the
// resolution semantics, not real round trips.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** FIFO of result sets, one per awaited select(), in issue order. */
  selectQueue: [] as unknown[][],
  /** FIFO of result sets, one per awaited update().returning(). */
  updateQueue: [] as unknown[][],
  inserted: [] as Record<string, unknown>[][],
  updateSets: [] as Record<string, unknown>[],
}));

vi.mock("@/db", () => {
  function makeQuery(): Record<string, unknown> {
    return {
      from: () => makeQuery(),
      where: () => makeQuery(),
      orderBy: () => makeQuery(),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject),
    };
  }

  return {
    db: {
      select: () => makeQuery(),
      insert: () => ({
        values: (values: Record<string, unknown>[]) => {
          state.inserted.push(values);
          return { returning: async () => values.map((v, i) => ({ id: 200 + i, ...v })) };
        },
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => {
          state.updateSets.push(set);
          return {
            where: () => ({
              returning: async () => state.updateQueue.shift() ?? [],
            }),
          };
        },
      }),
    },
  };
});

const { issuePenalties, listPenalties, resolvePenalty, penaltySummary } = await import(
  "./service"
);

beforeEach(() => {
  state.selectQueue.length = 0;
  state.updateQueue.length = 0;
  state.inserted.length = 0;
  state.updateSets.length = 0;
});

const lateWarning = {
  type: "late_submission",
  severity: "warning",
  description: "2 days late",
  penaltyPoints: 1,
} as const;

describe("issuePenalties", () => {
  it("writes nothing when the rules returned no decisions", async () => {
    const rows = await issuePenalties({ studentId: 1, decisions: [] });
    expect(rows).toEqual([]);
    expect(state.inserted).toHaveLength(0);
  });

  it("inserts a decision the student does not already hold", async () => {
    state.selectQueue.push([]); // no existing unresolved penalties
    const rows = await issuePenalties({ studentId: 1, decisions: [lateWarning] });

    expect(rows).toHaveLength(1);
    expect(state.inserted[0][0]).toMatchObject({
      studentId: 1,
      type: "late_submission",
      severity: "warning",
      penaltyPoints: 1,
      issuedBy: null,
    });
  });

  it("does not stack a duplicate of an unresolved penalty of the same type", async () => {
    state.selectQueue.push([
      { id: 1, type: "late_submission", resolved: false, severity: "warning", penaltyPoints: 1 },
    ]);
    const rows = await issuePenalties({ studentId: 1, decisions: [lateWarning] });

    expect(rows).toEqual([]);
    expect(state.inserted).toHaveLength(0);
  });

  it("records the issuing instructor when one is supplied", async () => {
    state.selectQueue.push([]);
    await issuePenalties({ studentId: 1, decisions: [lateWarning], issuedBy: 9 });
    expect(state.inserted[0][0]).toMatchObject({ issuedBy: 9 });
  });
});

describe("resolvePenalty", () => {
  it("sets resolved and stamps resolvedAt", async () => {
    state.updateQueue.push([{ id: 5, resolved: true }]);
    const row = await resolvePenalty(5, 9);

    expect(row).toMatchObject({ id: 5, resolved: true });
    expect(state.updateSets[0]).toMatchObject({ resolved: true });
    expect(state.updateSets[0].resolvedAt).toBeInstanceOf(Date);
  });

  it("is idempotent: resolving twice returns the row without rewriting resolvedAt", async () => {
    state.updateQueue.push([]); // WHERE resolved = false matched nothing
    state.selectQueue.push([{ id: 5, resolved: true }]);

    const row = await resolvePenalty(5, 9);
    expect(row).toMatchObject({ id: 5, resolved: true });
  });

  it("returns null for a penalty that does not exist", async () => {
    state.updateQueue.push([]);
    state.selectQueue.push([]);
    expect(await resolvePenalty(404, 9)).toBeNull();
  });
});

describe("listPenalties / penaltySummary", () => {
  it("hides resolved penalties by default — a cleared penalty stops counting", async () => {
    state.selectQueue.push([
      { id: 1, type: "late_submission", severity: "warning", penaltyPoints: 1, resolved: false },
    ]);
    const rows = await listPenalties(1);
    expect(rows).toHaveLength(1);
  });

  it("summarises escalation from the unresolved rows only", async () => {
    state.selectQueue.push([
      { id: 1, severity: "warning", penaltyPoints: 1, resolved: false },
      { id: 2, severity: "notice", penaltyPoints: 2, resolved: false },
      { id: 3, severity: "warning", penaltyPoints: 1, resolved: false },
    ]);

    const summary = await penaltySummary(1);
    expect(summary.escalation.activeCount).toBe(3);
    expect(summary.escalation.escalated).toBe(true);
  });
});
