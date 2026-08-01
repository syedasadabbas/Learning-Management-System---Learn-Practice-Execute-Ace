// =============================================================================
// PREFERENCE TESTS — the absent row, the opt-out gate, and the checkbox trap.
// -----------------------------------------------------------------------------
// Three behaviours here can only be got wrong once, and each one is silent:
//   * an ABSENT row must read as the defaults, because nothing creates a row at
//     registration, so on a fresh cohort every student is in that state;
//   * an UNCHECKED checkbox sends nothing at all in a form POST, so "absent means
//     false" has to be deliberate — read it as "unchanged" and a student can never
//     turn anything off;
//   * an UNREADABLE row must fail OPEN (send anyway). Fail-closed would drop a
//     wanted notification with no row, no job and no trace, which is
//     indistinguishable from working. The argument is in ./preferences.ts.
//
// `@/db` is mocked with a factory so the real module — which throws at import when
// DATABASE_URL is unset, and opens a pool when it is set — is never evaluated.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { NOTIFICATION_TYPES } from "@/db/schema.notifications";

import {
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  isEnabled,
  preferencesFromFormData,
  resolvePreferences,
  resolvePreferencesOrDefault,
  savePreferences,
  type NotificationPreferences,
} from "./preferences";
import { PREFERENCE_COLUMN_FOR_TYPE } from "./types";

/**
 * A chainable stub shaped like the drizzle builders these functions use:
 *   select().from().where().limit()
 *   insert().values().onConflictDoUpdate().returning()
 */
function fakeClient(options: {
  selectRows?: unknown[];
  selectThrows?: boolean;
  returningRows?: unknown[];
  captured?: Record<string, unknown>;
}) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "insert", "values", "onConflictDoUpdate"]) {
    chain[method] = (arg: unknown) => {
      if (method === "values" && options.captured) options.captured.values = arg;
      if (method === "onConflictDoUpdate" && options.captured) options.captured.upsert = arg;
      return chain;
    };
  }
  chain.limit = async () => {
    if (options.selectThrows) throw new Error("neon: connection terminated");
    return options.selectRows ?? [];
  };
  chain.returning = async () => options.returningRows ?? [];
  return chain as never;
}

const ROW = {
  id: 1,
  userId: 7,
  quizSubmitted: false,
  examCompleted: true,
  assignmentFeedback: false,
  penaltyIssued: true,
  forumReply: false,
  badgeEarned: false,
  gradePosted: true,
  courseMessage: false,
  digestDaily: true,
  digestWeekly: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the absent row is the common case", () => {
  it("returns the defaults when the student has no preferences row", async () => {
    const prefs = await resolvePreferences(7, fakeClient({ selectRows: [] }));
    expect(prefs).toEqual({ ...PREFERENCE_DEFAULTS });
  });

  it("defaults every event category ON and the daily digest OFF", () => {
    // Asserted as a fact about the product decision, not as a tautology over the
    // constant: an accidental flip to opt-in would silently reduce the feature to
    // the students who go looking for a settings page.
    expect(PREFERENCE_DEFAULTS.quizSubmitted).toBe(true);
    expect(PREFERENCE_DEFAULTS.examCompleted).toBe(true);
    expect(PREFERENCE_DEFAULTS.assignmentFeedback).toBe(true);
    expect(PREFERENCE_DEFAULTS.penaltyIssued).toBe(true);
    expect(PREFERENCE_DEFAULTS.digestDaily).toBe(false);
  });

  it("returns the stored row, field by field, when one exists", async () => {
    const prefs = await resolvePreferences(7, fakeClient({ selectRows: [ROW] }));
    expect(prefs.quizSubmitted).toBe(false);
    expect(prefs.examCompleted).toBe(true);
    expect(prefs.digestDaily).toBe(true);
    // The row's own id and userId must NOT come back — the settings form round-trips
    // this object into an UPDATE and neither may be writable from a form.
    expect(Object.keys(prefs).sort()).toEqual([...PREFERENCE_KEYS].sort());
  });
});

describe("a read failure fails OPEN, loudly", () => {
  it("resolvePreferences propagates so a settings page fails visibly", async () => {
    await expect(resolvePreferences(7, fakeClient({ selectThrows: true }))).rejects.toThrow(
      /connection terminated/,
    );
  });

  it("resolvePreferencesOrDefault yields the defaults and logs one error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prefs = await resolvePreferencesOrDefault(7, fakeClient({ selectThrows: true }));
    expect(prefs).toEqual({ ...PREFERENCE_DEFAULTS });
    expect(spy).toHaveBeenCalledTimes(1);
    // The log is the only trace that a stored opt-out was not consulted, so its
    // content is asserted rather than just its existence.
    expect(String(spy.mock.calls[0][0])).toContain("treating every category as ENABLED");
  });
});

describe("the type -> switch mapping covers every declared type", () => {
  it("has a column for every member of the notification_type enum", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(PREFERENCE_COLUMN_FOR_TYPE[type]).toBeTruthy();
    }
  });

  it("gates each type on its own switch", () => {
    const prefs = { ...PREFERENCE_DEFAULTS, quizSubmitted: false } as NotificationPreferences;
    expect(isEnabled(prefs, "quiz_submitted")).toBe(false);
    expect(isEnabled(prefs, "exam_completed")).toBe(true);
    expect(isEnabled(prefs, "penalty_issued")).toBe(true);
  });
});

describe("an unchecked checkbox is ABSENT, not false", () => {
  it("reads a missing field as off", () => {
    const form = new FormData();
    form.set("quizSubmitted", "on");
    const prefs = preferencesFromFormData(form);
    expect(prefs.quizSubmitted).toBe(true);
    expect(prefs.examCompleted).toBe(false);
    expect(prefs.digestWeekly).toBe(false);
  });

  it("returns every switch, so a save can never be partial", () => {
    const prefs = preferencesFromFormData(new FormData());
    expect(Object.keys(prefs).sort()).toEqual([...PREFERENCE_KEYS].sort());
    expect(Object.values(prefs).every((v) => v === false)).toBe(true);
  });

  it("accepts the values a non-browser client would send", () => {
    const form = new FormData();
    form.set("penaltyIssued", "true");
    form.set("badgeEarned", "1");
    const prefs = preferencesFromFormData(form);
    expect(prefs.penaltyIssued).toBe(true);
    expect(prefs.badgeEarned).toBe(true);
  });
});

describe("saving is one upsert, not read-modify-write", () => {
  it("targets the unique user_id index so two concurrent tabs cannot both insert", async () => {
    const captured: Record<string, unknown> = {};
    const values = { ...PREFERENCE_DEFAULTS, quizSubmitted: false } as NotificationPreferences;
    const saved = await savePreferences(
      7,
      values,
      fakeClient({ returningRows: [{ ...ROW, ...values }], captured }),
    );

    expect(captured.values).toMatchObject({ userId: 7, quizSubmitted: false });
    expect(captured.upsert).toBeTruthy();
    expect(saved.quizSubmitted).toBe(false);
  });
});
