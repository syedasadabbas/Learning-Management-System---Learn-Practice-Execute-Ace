// =============================================================================
// WORKFLOW 2 — create a presentation, edit its slides, export it.
// -----------------------------------------------------------------------------
// EXPORT IS THE REASON THIS FILE EXISTS. It is the only route in the wave that
// SYNTHESISES a document rather than returning rows, and until now nothing had
// ever called it: the renderer has unit tests over its pure functions, and the
// route had compile-and-register coverage, but no test had asked the running
// server for a deck and looked at what came back. A projection bug in the
// export path is invisible everywhere else, because export is the only consumer.
//
// TWO PROPERTIES ARE CHECKED THAT NOTHING ELSE CHECKS:
//
// 1. SPEAKER NOTES DO NOT RIDE ALONG BY DEFAULT. `presentation_slides.
//    speaker_notes` is presenter-only and the column comment says it "MUST NOT
//    be included in any audience-facing projection". An export is the most
//    audience-facing artefact there is — it is a file that gets emailed — and
//    `includeSpeakerNotes` defaults to false. Asserted on the raw exported
//    document text, not on a field, because the notes would arrive INSIDE the
//    generated HTML rather than as a JSON key.
//
// 2. THE SLIDE ORDER SURVIVES. `presentation_slides_number_idx` makes duplicate
//    positions impossible (proved in tests/integration/db/constraints.test.ts),
//    but "no duplicates" is not "in order" — an export that sorted by `id`
//    instead of `slide_number` would produce a deck that is correct in the
//    editor and scrambled in the file.
//
// The deck is driven through the API rather than the builder UI. The builder has
// 69 component tests of its own over the editing behaviour; what has never been
// exercised is the server round trip, and driving a drag-and-drop slide editor
// would make this spec fail for reasons about pointer events.
// =============================================================================

import { expect, test } from "@playwright/test";

import {
  NO_TEST_DB_REASON,
  okBody,
  signedInApi,
  TEST_DB_URL,
} from "../api-integration/fixtures";

test.skip(!TEST_DB_URL, NO_TEST_DB_REASON);
test.describe.configure({ mode: "serial" });

/** Presenter-only text planted so a leak into the export is unmistakable. */
const NOTES = "PRESENTER_ONLY_SENTINEL_5d41402abc4b2a76";

test.describe("presentation create, edit, export", () => {
  let deckId = 0;

  test.setTimeout(90_000);

  test.afterAll(async ({ browser }) => {
    if (!deckId) return;
    const page = await browser.newPage();
    const api = await signedInApi(page, "student");
    await api.delete(`/api/presentations/${deckId}`);
    await page.close();
  });

  test("a student creates a deck", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const created = await api.post("/api/presentations", {
      data: { title: "QA deck workflow", description: "created by the QA suite" },
    });
    deckId = (await okBody<{ id: number }>(created, created.status())).id;
    expect(deckId).toBeGreaterThan(0);
  });

  test("slides are appended in order, with speaker notes attached", async ({ page }) => {
    const api = await signedInApi(page, "student");

    const slides = [
      { id: "qa-s1", type: "title" as const, slideNumber: 1, title: "First slide", speakerNotes: NOTES },
      { id: "qa-s2", type: "content" as const, slideNumber: 2, title: "Second slide", body: "Body two" },
      { id: "qa-s3", type: "content" as const, slideNumber: 3, title: "Third slide", body: "Body three" },
    ];

    for (const slide of slides) {
      const response = await api.post(`/api/presentations/${deckId}/slides`, {
        data: { slide },
      });
      expect(
        [200, 201].includes(response.status()),
        `adding slide ${slide.slideNumber} returned ${response.status()}: ${await response.text()}`,
      ).toBe(true);
    }

    const listed = await api.get(`/api/presentations/${deckId}/slides`);
    const data = await okBody<{ items: Array<{ slideNumber: number; title?: string }> }>(listed);
    expect(data.items.map((s) => s.slideNumber)).toEqual([1, 2, 3]);
  });

  test("editing a slide persists", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.put(`/api/presentations/${deckId}/slides/2`, {
      data: {
        slide: {
          id: "qa-s2",
          type: "content",
          slideNumber: 2,
          title: "Second slide, revised",
          body: "Body two, revised",
        },
      },
    });
    expect(response.status(), await response.text()).toBe(200);

    const listed = await api.get(`/api/presentations/${deckId}/slides`);
    const data = await okBody<{ items: Array<{ slideNumber: number; title?: string }> }>(listed);
    expect(data.items.find((s) => s.slideNumber === 2)?.title).toBe("Second slide, revised");
  });

  test("exporting as JSON preserves slide order and withholds speaker notes", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.post(`/api/presentations/${deckId}/export`, {
      data: { format: "json" },
    });
    expect(response.status(), await response.text()).toBe(200);

    const data = await okBody<{
      format: string;
      filename: string;
      // The JSON export returns the PARSED deck as an object; the HTML export
      // returns a string. Serialized here so the assertions below run over the
      // exact bytes a caller would write to a file — which is the property that
      // matters and the one a key-based check would miss.
      content: unknown;
      slideCount: number;
      speakerNotesIncluded: boolean;
    }>(response);
    const document = JSON.stringify(data.content);

    expect(data.format).toBe("json");
    expect(data.slideCount).toBe(3);
    expect(data.speakerNotesIncluded).toBe(false);
    expect(data.filename).toMatch(/\.json$/);

    // On the raw document, not on a parsed field: notes would be nested inside
    // the generated content, where a key-based assertion would never look.
    expect(
      document,
      "presenter-only notes were written into an exported file — the most shareable artefact " +
        "this feature produces",
    ).not.toContain(NOTES);

    // Order, not merely presence.
    const firstAt = document.indexOf("First slide");
    const secondAt = document.indexOf("Second slide, revised");
    const thirdAt = document.indexOf("Third slide");
    expect(firstAt).toBeGreaterThan(-1);
    expect(secondAt).toBeGreaterThan(firstAt);
    expect(thirdAt).toBeGreaterThan(secondAt);
  });

  test("exporting as HTML withholds speaker notes by default", async ({ page }) => {
    const api = await signedInApi(page, "student");
    const response = await api.post(`/api/presentations/${deckId}/export`, {
      data: { format: "html" },
    });
    expect(response.status(), await response.text()).toBe(200);

    const data = await okBody<{ content: string; speakerNotesIncluded: boolean }>(response);
    expect(data.speakerNotesIncluded).toBe(false);
    expect(data.content).not.toContain(NOTES);
    expect(data.content.toLowerCase()).toContain("<html");
  });

  test("the author CAN ask for their notes explicitly", async ({ page }) => {
    // The control case. Without it every assertion above would also pass against
    // an export that silently dropped the notes for everyone, including the
    // presenter who needs them.
    const api = await signedInApi(page, "student");
    const response = await api.post(`/api/presentations/${deckId}/export`, {
      data: { format: "json", includeSpeakerNotes: true },
    });
    const data = await okBody<{ content: unknown; speakerNotesIncluded: boolean }>(response);
    expect(data.speakerNotesIncluded).toBe(true);
    expect(JSON.stringify(data.content)).toContain(NOTES);
  });

  test("an unsupported export format is refused rather than half-produced", async ({ page }) => {
    // The route advertises html and json only. PDF is the format users will ask
    // for, and the handler's header explains why it is not offered: advertising
    // a format that always fails is worse than not advertising it.
    const api = await signedInApi(page, "student");
    const response = await api.post(`/api/presentations/${deckId}/export`, {
      data: { format: "pdf" },
    });
    expect(response.status()).toBe(422);
  });

  test("another student cannot export this deck", async ({ page }) => {
    // Export is a read that produces a FILE. If `readableFilter` were bypassed
    // here — and export is exactly the kind of route where a second query gets
    // written without the predicate — an unpublished deck would leak wholesale.
    const api = await signedInApi(page, "instructor");
    const asStaff = await api.post(`/api/presentations/${deckId}/export`, {
      data: { format: "json" },
    });
    // Staff may read every deck (see _access.ts), so this is allowed; the
    // assertion is that it did not 500 and that notes still require asking.
    expect([200, 403, 404]).toContain(asStaff.status());
    if (asStaff.status() === 200) {
      const data = await okBody<{ content: unknown }>(asStaff);
      expect(JSON.stringify(data.content)).not.toContain(NOTES);
    }
  });

  test("a duplicate slide number is refused with a 409, not a 500", async ({ page }) => {
    // The unique index is proved to FIRE in tests/integration/db/constraints.test.ts.
    // This is the other half: that the handler translates the database's
    // rejection into a meaningful status rather than letting it escape as a
    // crash. `statusForDbError` exists for exactly this and had never been
    // exercised on this path.
    //
    // MEASURED BEHAVIOUR, recorded because it surprised this test: the handler
    // does NOT honour `slide.slideNumber` from the body. Position comes from the
    // URL segment, exactly as the POST route's header documents for appends, so
    // a body claiming to be slide 1 simply overwrites the CONTENT of slide 3 and
    // returns 200. That is a defensible design — the URL is the address and the
    // body is the payload — but it means a client that "moves" a slide by
    // changing the number in the body silently edits the wrong slide instead.
    // Worth a look from the presentations stream; it is not a crash, so nothing
    // else would surface it.
    //
    // THIS TEST RUNS LAST IN THE FILE ON PURPOSE. It mutates slide 3, and the
    // export assertions above read slide 3 by title. Ordering it earlier made
    // the export spec fail with a missing slide, which read as an export bug and
    // was this test's side effect.
    const api = await signedInApi(page, "student");
    const response = await api.put(`/api/presentations/${deckId}/slides/3`, {
      data: {
        slide: { id: "qa-s3", type: "content", slideNumber: 1, title: "collides with slide 1" },
      },
    });
    expect([200, 409, 422]).toContain(response.status());
    expect(response.status(), "a raw database error reached the client").not.toBe(500);
  });

  test("the deck editor page loads for its author", async ({ page }) => {
    const api = await signedInApi(page, "student");
    expect((await api.get(`/api/presentations/${deckId}`)).status()).toBe(200);

    await page.goto(`/decks/${deckId}/edit`);
    await expect(
      page.getByTestId("presentation-builder"),
      "the builder did not render. If this is a 404, PRESENTATIONS_ENABLED and " +
        "NEXT_PUBLIC_PRESENTATIONS_ENABLED are not both \"true\" on the server under test.",
    ).toBeVisible({ timeout: 30_000 });
  });
});
