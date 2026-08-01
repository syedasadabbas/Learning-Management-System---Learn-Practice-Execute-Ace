import { describe, expect, it } from "vitest";

import {
  ESCALATION_DEMERIT_POINTS,
  ESCALATION_PENALTY_COUNT,
  dedupeAgainstExisting,
  escalationFor,
  type CountablePenalty,
} from "./accumulation";
import { SEVERITY_DEMERITS } from "./rules";

function p(
  severity: CountablePenalty["severity"],
  resolved = false,
  penaltyPoints = SEVERITY_DEMERITS[severity],
): CountablePenalty {
  return { severity, resolved, penaltyPoints };
}

describe("escalationFor", () => {
  it("is not escalated with nothing on record", () => {
    const state = escalationFor([]);
    expect(state).toMatchObject({ activeCount: 0, activeDemerits: 0, escalated: false });
    expect(state.reason).toBe("");
  });

  it("is not escalated with two warnings", () => {
    expect(escalationFor([p("warning"), p("warning")]).escalated).toBe(false);
  });

  it("escalates at three unresolved penalties", () => {
    const state = escalationFor([p("warning"), p("warning"), p("warning")]);
    expect(state.activeCount).toBe(ESCALATION_PENALTY_COUNT);
    expect(state.escalated).toBe(true);
    expect(state.reason).toContain("3 unresolved penalties");
  });

  it("escalates on severity alone: two serious penalties reach the demerit ceiling", () => {
    const state = escalationFor([p("serious"), p("serious")]);
    expect(state.activeDemerits).toBe(ESCALATION_DEMERIT_POINTS);
    expect(state.escalated).toBe(true);
  });

  it("EXCLUDES resolved penalties — a cleared penalty stops counting", () => {
    const state = escalationFor([
      p("warning", true),
      p("warning", true),
      p("warning", false),
    ]);
    expect(state.activeCount).toBe(1);
    expect(state.activeDemerits).toBe(SEVERITY_DEMERITS.warning);
    expect(state.escalated).toBe(false);
  });

  it("de-escalates once an instructor clears one of three penalties", () => {
    const before = escalationFor([p("warning"), p("warning"), p("warning")]);
    const after = escalationFor([p("warning"), p("warning"), p("warning", true)]);
    expect(before.escalated).toBe(true);
    expect(after.escalated).toBe(false);
  });

  it("counts by severity for the instructor view", () => {
    const state = escalationFor([p("warning"), p("notice"), p("serious"), p("notice", true)]);
    expect(state.bySeverity).toEqual({ warning: 1, notice: 1, serious: 1 });
  });

  it("falls back to the severity ladder when stored points are missing", () => {
    const state = escalationFor([p("serious", false, 0)]);
    expect(state.activeDemerits).toBe(SEVERITY_DEMERITS.serious);
  });
});

describe("dedupeAgainstExisting", () => {
  const late = {
    type: "late_submission",
    severity: "warning",
    description: "x",
    penaltyPoints: 1,
  } as const;
  const quiz = {
    type: "quiz_failure",
    severity: "serious",
    description: "y",
    penaltyPoints: 3,
  } as const;

  it("drops a decision the student already holds unresolved", () => {
    const out = dedupeAgainstExisting([late, quiz], [
      { type: "late_submission", resolved: false },
    ]);
    expect(out.map((d) => d.type)).toEqual(["quiz_failure"]);
  });

  it("re-issues a decision whose earlier penalty was resolved", () => {
    const out = dedupeAgainstExisting([late], [{ type: "late_submission", resolved: true }]);
    expect(out).toHaveLength(1);
  });

  it("passes everything through when nothing is on record", () => {
    expect(dedupeAgainstExisting([late, quiz], [])).toHaveLength(2);
  });
});
