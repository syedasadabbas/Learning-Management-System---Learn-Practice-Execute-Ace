import { describe, expect, it } from "vitest";

import {
  CONCEPTS,
  CONCEPT_IDS,
  conceptById,
  conceptExercise,
  conceptsForLecture,
} from "./registry";
import { diagnoseFiles } from "./diagnostics";

describe("concept registry", () => {
  it("exposes one meta entry per declared id", () => {
    expect(CONCEPTS.map((c) => c.id).sort()).toEqual([...CONCEPT_IDS].sort());
    for (const id of CONCEPT_IDS) expect(conceptById(id)?.id).toBe(id);
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(conceptById("does-not-exist")).toBeNull();
    // @ts-expect-error — deliberately passing an invalid id, as a bad URL would.
    expect(conceptExercise("does-not-exist")).toBeNull();
  });

  it("ships snippets that pass our own diagnostics", () => {
    for (const id of CONCEPT_IDS) {
      const exercise = conceptExercise(id);
      expect(exercise, id).not.toBeNull();
      expect(diagnoseFiles(exercise!.files), id).toEqual([]);
      expect(exercise!.warnings, id).toEqual([]);
    }
  });
});

describe("conceptsForLecture", () => {
  it("matches the box model to the CSS cascade lecture", () => {
    const ids = conceptsForLecture({
      title: "Selectors, the Cascade & Specificity",
      content: "padding and margin collapse",
    }).map((c) => c.id);
    expect(ids).toContain("box-model");
  });

  it("matches flex axes to the Flexbox & CSS Grid lecture", () => {
    const ids = conceptsForLecture({ title: "Flexbox & CSS Grid", content: null }).map((c) => c.id);
    expect(ids).toContain("flex-axes");
  });

  it("matches the HTTP cycle to the week 1 opener and the deployment lecture", () => {
    expect(
      conceptsForLecture({ title: "How the Web Works & Your First HTML Document" }).map((c) => c.id),
    ).toContain("http-cycle");
    expect(conceptsForLecture({ title: "Deployment & Going Live" }).map((c) => c.id)).toContain(
      "http-cycle",
    );
  });

  it("matches nothing for an unrelated lecture", () => {
    expect(conceptsForLecture({ title: "Values, Types & Functions", content: "let and const" })).toEqual(
      [],
    );
  });

  it("handles null, empty and content-only lectures without throwing", () => {
    expect(conceptsForLecture(null)).toEqual([]);
    expect(conceptsForLecture(undefined)).toEqual([]);
    expect(conceptsForLecture({})).toEqual([]);
    expect(conceptsForLecture({ title: "", content: "" })).toEqual([]);
    expect(conceptsForLecture({ title: null, content: "justify-content: center" }).map((c) => c.id)).toContain(
      "flex-axes",
    );
  });

  it("is case-insensitive", () => {
    expect(conceptsForLecture({ title: "FLEXBOX BASICS" }).map((c) => c.id)).toContain("flex-axes");
  });
});
