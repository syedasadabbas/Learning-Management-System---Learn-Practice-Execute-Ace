import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AssignmentSampleShowcase } from "./AssignmentSampleShowcase";
import { CodeSnippetViewer, normaliseLineNotes, toLines } from "./CodeSnippetViewer";
import { SampleCard } from "./SampleCard";
import { readCodeFiles, readFeatures, type AssignmentSample } from "./types";

function sample(overrides: Partial<AssignmentSample> = {}): AssignmentSample {
  return {
    id: 1,
    assignmentId: 4,
    title: "Desktop view",
    description: "The reference layout at 1280 px.",
    sampleOrder: 0,
    sampleOutputHtml: "<p>hello</p>",
    screenshotUrl: null,
    codeExample: [
      { filename: "index.html", language: "html", code: "<h1>Hi</h1>" },
      { filename: "styles.css", language: "css", code: "h1 { color: red; }" },
    ],
    liveUrl: "https://example.com/sample",
    features: ["Responsive", "Form validation"],
    videoWalkthroughUrl: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A fetch that never settles, so the loading state can be observed. */
function pendingFetch(): typeof fetch {
  return vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
}

function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response,
  ) as unknown as typeof fetch;
}

describe("readCodeFiles / readFeatures", () => {
  it("drops malformed jsonb entries rather than rendering them", () => {
    // The precedent is `hintsUpTo` in projection.ts: one fewer tab beats a tab
    // labelled "undefined".
    expect(readCodeFiles([{ filename: "a.js" }, null, "nope"])).toEqual([]);
    expect(readFeatures(["ok", 3, "", null])).toEqual(["ok"]);
  });

  it("treats a non-array blob as empty", () => {
    expect(readCodeFiles({ filename: "a.js" })).toEqual([]);
    expect(readFeatures("Responsive")).toEqual([]);
  });
});

describe("toLines / normaliseLineNotes", () => {
  it("does not invent a trailing blank line", () => {
    expect(toLines("a\nb\n")).toEqual(["a", "b"]);
    expect(toLines("a\nb")).toEqual(["a", "b"]);
  });

  it("accepts numeric-string keys, which is how jsonb stores them", () => {
    expect(normaliseLineNotes({ "2": "second" }).get(2)).toBe("second");
    expect(normaliseLineNotes({ "0": "bad", x: "bad" }).size).toBe(0);
  });
});

describe("CodeSnippetViewer", () => {
  it("numbers lines without putting the numbers in the copyable text", () => {
    render(<CodeSnippetViewer filename="a.js" language="javascript" code={"one\ntwo"} />);
    const gutters = screen.getByTestId("code-snippet").querySelectorAll('[aria-hidden="true"]');
    expect(gutters.length).toBeGreaterThan(0);
    // The number lives in an aria-hidden, select-none span beside the code.
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("marks highlighted lines with a border as well as a tint", () => {
    // WCAG 1.4.1: a background tint alone is not a perceivable difference.
    render(
      <CodeSnippetViewer
        filename="a.js"
        language="javascript"
        code={"one\ntwo"}
        highlightedLines={[2]}
      />,
    );
    const line = screen.getByTestId("code-snippet").querySelector('[data-line="2"]');
    expect(line).toHaveAttribute("data-highlighted", "true");
    expect(line?.className).toContain("border-brand");
  });

  it("makes the scroll container keyboard reachable with a name", () => {
    render(<CodeSnippetViewer filename="a.js" language="javascript" code="x" />);
    const scroller = screen.getByRole("group", { name: "a.js source" });
    expect(scroller).toHaveAttribute("tabindex", "0");
  });

  it("tells the student to copy by hand when the clipboard is unavailable", async () => {
    // jsdom has no navigator.clipboard; this is the real behaviour on an http
    // origin too, and a silent no-op button is the failure being avoided.
    render(<CodeSnippetViewer filename="a.js" language="javascript" code="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy a.js" }));
    await waitFor(() => expect(screen.getByTestId("code-copy-failed")).toBeInTheDocument());
  });

  it("renders line explanations as a visible list, not a tooltip", () => {
    render(
      <CodeSnippetViewer
        filename="a.js"
        language="javascript"
        code={"one\ntwo"}
        lineExplanations={{ 1: "the first line" }}
      />,
    );
    expect(screen.getByTestId("line-notes")).toHaveTextContent("the first line");
  });
});

describe("SampleCard", () => {
  it("renders the preview in a fully sandboxed iframe, never as innerHTML", () => {
    // The schema calls sample_output_html "UNTRUSTED BY CONSTRUCTION". An empty
    // sandbox attribute is every restriction ON.
    render(<SampleCard sample={sample()} expandable={false} />);
    const frame = screen.getByTestId("sample-preview");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("exposes the file switcher as a keyboard-navigable tablist", () => {
    render(<SampleCard sample={sample()} expandable={false} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "Home" });
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("says a link opens in a new tab, in the accessible name", () => {
    render(<SampleCard sample={sample()} expandable={false} />);
    expect(
      screen.getByRole("link", { name: /Open live sample \(opens in a new tab\)/ }),
    ).toBeInTheDocument();
  });

  it("lists features as text, with the tick decorative", () => {
    render(<SampleCard sample={sample()} expandable={false} />);
    expect(screen.getByTestId("sample-features")).toHaveTextContent("Responsive");
  });
});

describe("AssignmentSampleShowcase", () => {
  it("renders a labelled loading state first", () => {
    render(<AssignmentSampleShowcase assignmentId={4} fetchImpl={pendingFetch()} />);
    expect(screen.getByTestId("async-loading")).toBeInTheDocument();
    // The primitive puts the label on the role="status" wrapper as its
    // accessible name, not as visible text — which is the point: the bars are
    // aria-hidden and the announcement is the only thing spoken.
    expect(screen.getByRole("status", { name: "Loading worked samples" })).toBeInTheDocument();
  });

  it("renders the samples on success", async () => {
    const fetchImpl = jsonFetch(200, {
      ok: true,
      data: { items: [sample()], limit: 50, offset: 0, total: 1 },
    });

    render(<AssignmentSampleShowcase assignmentId={4} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId("sample-card-1")).toBeInTheDocument());
    expect(screen.getByText("Desktop view")).toBeInTheDocument();
  });

  it("requests the frozen route path, built from the ROUTES key", async () => {
    const fetchImpl = jsonFetch(200, {
      ok: true,
      data: { items: [], limit: 50, offset: 0, total: 0 },
    });

    render(<AssignmentSampleShowcase assignmentId={4} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "/api/assignments/4/samples?limit=50",
    );
  });

  it("renders an empty state, not an error, when the assignment has no samples", async () => {
    const fetchImpl = jsonFetch(200, {
      ok: true,
      data: { items: [], limit: 50, offset: 0, total: 0 },
    });

    render(<AssignmentSampleShowcase assignmentId={4} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());
    expect(screen.getByText("No samples published yet")).toBeInTheDocument();
  });

  it("renders an announced error with a retry when the request fails", async () => {
    const fetchImpl = jsonFetch(500, { ok: false, error: "The database is unwell." });

    render(<AssignmentSampleShowcase assignmentId={4} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId("async-error")).toBeInTheDocument());

    // role="alert" so it is announced without the user going looking.
    expect(screen.getByRole("alert")).toHaveTextContent("The database is unwell.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("re-requests when the retry button is pressed", async () => {
    const fetchImpl = jsonFetch(500, { ok: false, error: "nope" });
    render(<AssignmentSampleShowcase assignmentId={4} fetchImpl={fetchImpl} />);

    await waitFor(() => expect(screen.getByTestId("async-error")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2),
    );
  });
});
