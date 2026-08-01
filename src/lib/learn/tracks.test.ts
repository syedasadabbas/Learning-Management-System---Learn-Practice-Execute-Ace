// The track registry is presentation copy, not the authority on which tracks
// exist. These tests pin that: an unregistered slug must still render, and the
// registry must not be able to make a track disappear.
import { describe, expect, it } from "vitest";

import { levelLabel, titleFromSlug, trackDisplay, trackOrder, TRACKS } from "./tracks";
import { LEARN_LEVELS } from "./types";

describe("TRACKS registry", () => {
  it("has unique slugs", () => {
    const slugs = TRACKS.map((t) => t.track);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has unique order values, so the index order is deterministic", () => {
    const orders = TRACKS.map((t) => t.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("covers the eight tracks the curriculum plan names", () => {
    expect(TRACKS.map((t) => t.track).sort()).toEqual(
      [
        "claude-usage",
        "cryptography",
        "cybersecurity",
        "dbms",
        "dsa",
        "llm-apps",
        "oop",
        "prompt-engineering",
      ].sort(),
    );
  });

  it("uses the curriculum plan's slug prefixes", () => {
    const prefixes = new Map(TRACKS.map((t) => [t.track, t.slugPrefix]));
    expect(prefixes.get("oop")).toBe("oop-");
    expect(prefixes.get("cryptography")).toBe("crypto-");
    expect(prefixes.get("cybersecurity")).toBe("sec-");
    expect(prefixes.get("prompt-engineering")).toBe("pe-");
  });

  it("gives every track a title and a non-empty summary", () => {
    for (const track of TRACKS) {
      expect(track.title.length).toBeGreaterThan(0);
      expect(track.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("trackDisplay", () => {
  it("returns registry copy for a registered track", () => {
    expect(trackDisplay("dbms").title).toBe("Database Management");
  });

  it("renders an UNREGISTERED track rather than hiding it", () => {
    // The database decides which tracks exist. Content must never be blocked on
    // someone remembering to edit the registry.
    expect(trackDisplay("graph-theory")).toEqual({ title: "Graph Theory", summary: "" });
  });
});

describe("titleFromSlug", () => {
  it("title-cases hyphenated and underscored slugs", () => {
    expect(titleFromSlug("prompt-engineering")).toBe("Prompt Engineering");
    expect(titleFromSlug("llm_apps")).toBe("Llm Apps");
  });

  it("survives empty and degenerate input", () => {
    expect(titleFromSlug("")).toBe("");
    expect(titleFromSlug("---")).toBe("");
  });
});

describe("trackOrder", () => {
  it("keeps registered tracks in registry order", () => {
    expect(trackOrder("oop")).toBeLessThan(trackOrder("dbms"));
    expect(trackOrder("cryptography")).toBeLessThan(trackOrder("cybersecurity"));
  });

  it("sorts unregistered tracks after every registered one", () => {
    const maxRegistered = Math.max(...TRACKS.map((t) => t.order));
    expect(trackOrder("something-new")).toBeGreaterThan(maxRegistered);
  });
});

describe("levelLabel", () => {
  it("labels every level in the frozen enum", () => {
    for (const level of LEARN_LEVELS) {
      expect(levelLabel(level).length).toBeGreaterThan(0);
    }
    expect(levelLabel("intermediate")).toBe("Intermediate");
  });
});
