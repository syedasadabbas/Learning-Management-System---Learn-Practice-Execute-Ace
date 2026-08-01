// =============================================================================
// UNIT TESTS — the level ladder. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// The rule under test is stated once, in progression.ts. These cases pin the two
// parts of it that are easy to get wrong:
//
//   * the requirement is CAPPED at the number of gradeable problems the level
//     below actually has, so a thin level is satisfiable rather than a dead end;
//   * a level with NO gradeable problems (HTML and CSS, which have no runtime and
//     are therefore all `execution: "none"`) has a requirement of zero and does not
//     gate the level above it. Gating on an unsatisfiable condition would show an
//     open track as permanently locked.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  emptyTallies,
  isLevelUnlocked,
  LEVEL_UNLOCK_THRESHOLD,
  levelProgression,
  previousLevel,
  talliesFor,
  unlockedLevels,
  type LevelTallies,
} from "./progression";

function tallies(spec: Partial<LevelTallies>): LevelTallies {
  return { ...emptyTallies(), ...spec };
}

const RICH = {
  beginner: { gradeable: 5, solved: 0 },
  intermediate: { gradeable: 5, solved: 0 },
  advanced: { gradeable: 5, solved: 0 },
};

describe("previousLevel", () => {
  it("has no level below beginner", () => {
    expect(previousLevel("beginner")).toBeNull();
    expect(previousLevel("intermediate")).toBe("beginner");
    expect(previousLevel("advanced")).toBe("intermediate");
  });
});

describe("levelProgression", () => {
  it("always opens beginner, even with nothing solved", () => {
    const [beginner] = levelProgression(tallies(RICH));
    expect(beginner.unlocked).toBe(true);
    expect(beginner.requiredBelow).toBe(0);
  });

  it("locks intermediate until the threshold is solved at beginner", () => {
    const below = LEVEL_UNLOCK_THRESHOLD - 1;
    const states = levelProgression(
      tallies({ ...RICH, beginner: { gradeable: 5, solved: below } }),
    );
    expect(states[1].unlocked).toBe(false);
    expect(states[1].requiredBelow).toBe(LEVEL_UNLOCK_THRESHOLD);
    expect(states[1].solvedBelow).toBe(below);
  });

  it("opens intermediate exactly on the threshold", () => {
    const states = levelProgression(
      tallies({ ...RICH, beginner: { gradeable: 5, solved: LEVEL_UNLOCK_THRESHOLD } }),
    );
    expect(states[1].unlocked).toBe(true);
    expect(states[2].unlocked).toBe(false);
  });

  it("keeps advanced locked while intermediate is locked, however much beginner is solved", () => {
    const states = levelProgression(
      tallies({
        beginner: { gradeable: 5, solved: 5 },
        intermediate: { gradeable: 5, solved: 0 },
        advanced: { gradeable: 5, solved: 0 },
      }),
    );
    expect(states[1].unlocked).toBe(true);
    expect(states[2].unlocked).toBe(false);
  });

  it("opens the whole ladder once each level below is satisfied", () => {
    const n = LEVEL_UNLOCK_THRESHOLD;
    expect(
      [...unlockedLevels(
        tallies({
          beginner: { gradeable: 5, solved: n },
          intermediate: { gradeable: 5, solved: n },
          advanced: { gradeable: 5, solved: 0 },
        }),
      )].sort(),
    ).toEqual(["advanced", "beginner", "intermediate"]);
  });

  it("caps the requirement at a thin level's gradeable count", () => {
    // Two gradeable problems at beginner: solving both must be enough, otherwise
    // intermediate is unreachable no matter what the student does.
    const states = levelProgression(
      tallies({ ...RICH, beginner: { gradeable: 2, solved: 2 } }),
    );
    expect(states[1].requiredBelow).toBe(2);
    expect(states[1].unlocked).toBe(true);
  });

  it("does not gate on a level that has no gradeable problems at all", () => {
    // The HTML/CSS case: every problem is reference-only, so no passing run can
    // ever exist and a non-zero requirement would lock the track forever.
    const states = levelProgression(
      tallies({
        beginner: { gradeable: 0, solved: 0 },
        intermediate: { gradeable: 0, solved: 0 },
        advanced: { gradeable: 0, solved: 0 },
      }),
    );
    expect(states.every((s) => s.unlocked)).toBe(true);
    expect(states[1].requiredBelow).toBe(0);
  });

  it("isLevelUnlocked agrees with the ladder it delegates to", () => {
    const t = tallies({ ...RICH, beginner: { gradeable: 5, solved: 0 } });
    expect(isLevelUnlocked(t, "beginner")).toBe(true);
    expect(isLevelUnlocked(t, "intermediate")).toBe(false);
    expect(isLevelUnlocked(t, "advanced")).toBe(false);
  });
});

describe("talliesFor", () => {
  it("counts only gradeable problems, and only solved gradeable ones", () => {
    const built = talliesFor(
      [
        { id: 1, level: "beginner", gradeable: true },
        { id: 2, level: "beginner", gradeable: true },
        { id: 3, level: "beginner", gradeable: false },
        { id: 4, level: "intermediate", gradeable: true },
      ],
      // Problem 3 is reference-only; a "solved" id for it must not be counted.
      new Set([1, 3]),
    );
    expect(built.beginner).toEqual({ gradeable: 2, solved: 1 });
    expect(built.intermediate).toEqual({ gradeable: 1, solved: 0 });
    expect(built.advanced).toEqual({ gradeable: 0, solved: 0 });
  });
});
