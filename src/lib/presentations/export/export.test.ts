import { afterEach, describe, expect, it, vi } from "vitest";

import type { Presentation, Slide } from "../types";
import {
  downloadBlob,
  escapeHtml,
  exportDeckToHtml,
  exportFilename,
  htmlExportBlob,
  millimetresToPoints,
  presentationToPdfPages,
  slideToPdfPage,
} from "./index";

const slides: Slide[] = [
  { id: "s1", slideNumber: 1, type: "title", title: "Week 1", subtitle: "HTML" },
  {
    id: "s2",
    slideNumber: 2,
    type: "content",
    title: "Goals",
    bullets: ["Semantic markup", "Accessibility"],
    speakerNotes: "Mention the audit tool",
  },
  {
    id: "s3",
    slideNumber: 3,
    type: "code",
    language: "html",
    code: "<main>ok</main>",
  },
  {
    id: "s4",
    slideNumber: 4,
    type: "two-column",
    left: { heading: "Do", bullets: ["Use <button>"] },
    right: { heading: "Avoid", body: "Divs with onclick" },
  },
  { id: "s5", slideNumber: 5, type: "quote", quote: "Ship it", attribution: "A" },
];

const presentation: Presentation = {
  id: "p1",
  title: "Week 1 <Intro>",
  description: "First session",
  deck: {
    slides,
    metadata: { theme: "lms", transition: "slide", width: 1280, height: 720 },
  },
};

describe("escapeHtml", () => {
  it("escapes the characters that break out of markup", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;",
    );
  });

  it("escapes ampersands once, not twice", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("exportDeckToHtml", () => {
  const html = exportDeckToHtml(presentation);

  it("produces a non-empty standalone document", () => {
    expect(html.length).toBeGreaterThan(500);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
  });

  it("references no external resource", () => {
    // The whole promise of this format is that it opens offline.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("cdn.");
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });

  it("renders one section per slide", () => {
    expect(html.match(/class="slide"/g)).toHaveLength(slides.length);
  });

  it("escapes the deck title rather than emitting raw markup", () => {
    expect(html).toContain("Week 1 &lt;Intro&gt;");
    expect(html).not.toContain("<Intro>");
  });

  it("omits speaker notes by default and includes them on request", () => {
    expect(html).not.toContain("Mention the audit tool");
    expect(
      exportDeckToHtml(presentation, { includeSpeakerNotes: true }),
    ).toContain("Mention the audit tool");
  });

  it("does not crash on an empty deck", () => {
    const empty = exportDeckToHtml({
      ...presentation,
      deck: { ...presentation.deck, slides: [] },
    });
    expect(empty).toContain("no slides");
  });

  it("yields a non-empty utf-8 blob", () => {
    const blob = htmlExportBlob(presentation);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("text/html;charset=utf-8");
  });
});

describe("exportFilename", () => {
  it("strips characters Windows rejects", () => {
    expect(exportFilename('Week 1: HTML/CSS?', "html")).toBe("Week-1-HTMLCSS.html");
  });

  it("falls back when the title reduces to nothing", () => {
    expect(exportFilename("///", "pdf")).toBe("presentation.pdf");
  });
});

describe("downloadBlob", () => {
  it("clicks an anchor and cleans it out of the document", () => {
    // jsdom implements neither object URLs nor downloads, so both are stubbed.
    // The assertion is that the DOM is left clean and the object URL is
    // released — the two leaks this function must not have.
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:stub",
      revokeObjectURL: revoke,
    });

    const before = document.body.childElementCount;
    downloadBlob(new Blob(["x"], { type: "text/plain" }), "x.txt");

    expect(document.body.childElementCount).toBe(before);
    // The revoke is deferred by a tick (Safari cancels same-tick revocations),
    // so it has to be flushed before the stub is torn down.
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:stub");
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("pdf page model", () => {
  it("produces one page per slide", () => {
    expect(presentationToPdfPages(presentation)).toHaveLength(slides.length);
  });

  it("flattens a two-column slide into linear blocks", () => {
    const page = slideToPdfPage(slides[3]);
    expect(page.heading).toBeUndefined();
    expect(page.blocks.map((block) => block.kind)).toEqual([
      "text",
      "bullets",
      "text",
      "text",
    ]);
  });

  it("keeps the code and its language", () => {
    const page = slideToPdfPage(slides[2]);
    const block = page.blocks[0];
    expect(block.kind).toBe("code");
    if (block.kind === "code") {
      expect(block.language).toBe("html");
      expect(block.code).toContain("<main>");
    }
  });

  it("withholds speaker notes unless asked", () => {
    expect(slideToPdfPage(slides[1]).speakerNotes).toBeUndefined();
    expect(
      slideToPdfPage(slides[1], { includeSpeakerNotes: true }).speakerNotes,
    ).toBe("Mention the audit tool");
  });

  it("produces no pages for an empty deck", () => {
    expect(
      presentationToPdfPages({
        ...presentation,
        deck: { ...presentation.deck, slides: [] },
      }),
    ).toHaveLength(0);
  });
});

describe("millimetresToPoints", () => {
  it("converts the A4 margin correctly", () => {
    // 15 mm at 72 pt/inch = 42.52 pt.
    expect(millimetresToPoints(15)).toBeCloseTo(42.52, 2);
  });
});
