import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { emptyDeck, type SlideDeck } from "@/lib/presentations/types";

import { PresentationBuilder } from "./PresentationBuilder";
import { SlideContentEditor, bulletsToText, textToBullets } from "./SlideContentEditor";
import { SpeakerNotes, ThemeSelector } from "./SpeakerNotes";

function deckWith(count: number): SlideDeck {
  const base = emptyDeck();
  return {
    ...base,
    slides: Array.from({ length: count }, (_, i) => ({
      id: `s${i + 1}`,
      slideNumber: i + 1,
      type: "title" as const,
      title: `Slide ${i + 1}`,
    })),
  };
}

function jsonFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response,
  ) as unknown as typeof fetch;
}

const BASE = { presentationId: 3, title: "My deck", notesEditable: true };

describe("textToBullets / bulletsToText", () => {
  it("round-trips, dropping blank lines", () => {
    expect(textToBullets("a\n\n  b  \n")).toEqual(["a", "b"]);
    expect(bulletsToText(["a", "b"])).toBe("a\nb");
    expect(bulletsToText(undefined)).toBe("");
  });
});

describe("ThemeSelector", () => {
  it("keeps an unrecognised stored theme selectable", () => {
    // Otherwise opening a deck themed by an older build silently rewrites it.
    render(<ThemeSelector value="retro" onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: /retro \(not a built-in theme\)/ })).toBeInTheDocument();
  });

  it("reports a change", () => {
    const onChange = vi.fn();
    render(<ThemeSelector value="lms" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
    expect(onChange).toHaveBeenCalledWith("dark");
  });
});

describe("SpeakerNotes", () => {
  it("renders no editable field when the server withheld the notes", () => {
    // A field that silently discards what you type is worse than an absent one.
    render(<SpeakerNotes value="" onChange={vi.fn()} editable={false} />);
    expect(screen.getByTestId("speaker-notes-hidden")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("edits when the caller is the deck's creator", () => {
    const onChange = vi.fn();
    render(<SpeakerNotes value="" onChange={onChange} editable />);
    fireEvent.change(screen.getByLabelText("Speaker notes"), { target: { value: "pause here" } });
    expect(onChange).toHaveBeenCalledWith("pause here");
  });
});

describe("SlideContentEditor", () => {
  it("gives every field a real label, not a placeholder", () => {
    render(
      <SlideContentEditor
        slide={{ id: "a", slideNumber: 1, type: "image", src: "https://x/y.png", alt: "" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Image URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Alternative text")).toBeInTheDocument();
  });

  it("keeps the alt-text guidance permanently visible", () => {
    // The only field whose emptiness is both valid and usually wrong, so
    // validation cannot make the distinction — only the help text can.
    render(
      <SlideContentEditor
        slide={{ id: "a", slideNumber: 1, type: "image", src: "https://x/y.png", alt: "" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Leave EMPTY only if the image is decorative/)).toBeInTheDocument();
  });

  it("edits bullets as one line each", () => {
    const onChange = vi.fn();
    render(
      <SlideContentEditor
        slide={{ id: "a", slideNumber: 1, type: "content", bullets: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Bullets"), { target: { value: "one\ntwo" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bullets: ["one", "two"] }));
  });

  it("renders the right fields for a quote slide", () => {
    render(
      <SlideContentEditor
        slide={{ id: "a", slideNumber: 1, type: "quote", quote: "hi" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("editor-quote")).toBeInTheDocument();
    expect(screen.getByLabelText("Quote")).toHaveValue("hi");
  });
});

describe("PresentationBuilder", () => {
  it("renders an empty state and an add button for a deck with no slides", () => {
    render(<PresentationBuilder {...BASE} initialDeck={emptyDeck()} fetchImpl={jsonFetch(200, {})} />);
    expect(screen.getByText("This deck has no slides")).toBeInTheDocument();
  });

  it("starts clean, with save disabled until something changes", () => {
    render(<PresentationBuilder {...BASE} initialDeck={deckWith(2)} fetchImpl={jsonFetch(200, {})} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByTestId("save-deck")).toBeDisabled();
  });

  it("adds a slide, marks the deck dirty, and announces it", async () => {
    render(<PresentationBuilder {...BASE} initialDeck={deckWith(1)} fetchImpl={jsonFetch(200, {})} />);

    fireEvent.click(screen.getByRole("button", { name: "quote" }));

    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());
    expect(screen.getByTestId("builder-live-region")).toHaveTextContent("quote slide added");
    expect(screen.getByTestId("save-deck")).toBeEnabled();
  });

  it("reorders by keyboard-operable buttons, not drag and drop", async () => {
    render(<PresentationBuilder {...BASE} initialDeck={deckWith(3)} fetchImpl={jsonFetch(200, {})} />);

    // Each button names the slide it acts on, so the rail is usable without sight.
    const down = screen.getByRole("button", { name: "Move slide 1 down" });
    expect(down).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move slide 1 up" })).toBeDisabled();

    fireEvent.click(down);
    await waitFor(() =>
      expect(screen.getByTestId("builder-live-region")).toHaveTextContent(
        "Slide moved to position 2",
      ),
    );
  });

  it("deletes a slide and reports how many remain", async () => {
    render(<PresentationBuilder {...BASE} initialDeck={deckWith(2)} fetchImpl={jsonFetch(200, {})} />);

    fireEvent.click(screen.getByRole("button", { name: /^Delete slide 2/ }));
    await waitFor(() =>
      expect(screen.getByTestId("builder-live-region")).toHaveTextContent("1 slides remain"),
    );
  });

  it("saves the WHOLE deck in one PUT, with slideNumber matching array order", async () => {
    const fetchImpl = jsonFetch(200, { ok: true, data: {} });
    render(<PresentationBuilder {...BASE} initialDeck={deckWith(3)} fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByRole("button", { name: "Move slide 1 down" }));
    fireEvent.click(screen.getByTestId("save-deck"));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(url).toBe("/api/presentations/3");
    expect(init.method).toBe("PUT");

    const body = JSON.parse(init.body as string);
    // One atomic document, not per-slide writes against numbers that just changed.
    expect(body.deck.slides).toHaveLength(3);
    expect(body.deck.slides.map((s: { slideNumber: number }) => s.slideNumber)).toEqual([1, 2, 3]);
    expect(body.deck.slides.map((s: { id: string }) => s.id)).toEqual(["s2", "s1", "s3"]);
  });

  it("returns to a clean state after a successful save", async () => {
    render(<PresentationBuilder {...BASE} initialDeck={deckWith(2)} fetchImpl={jsonFetch(200, { ok: true, data: {} })} />);

    fireEvent.click(screen.getByRole("button", { name: "Move slide 1 down" }));
    fireEvent.click(screen.getByTestId("save-deck"));

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("reports a save failure in an alert and stays dirty", async () => {
    render(
      <PresentationBuilder
        {...BASE}
        initialDeck={deckWith(2)}
        fetchImpl={jsonFetch(403, { ok: false, error: "Not your deck." })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move slide 1 down" }));
    fireEvent.click(screen.getByTestId("save-deck"));

    await waitFor(() =>
      expect(screen.getByTestId("save-error")).toHaveTextContent("Not your deck."),
    );
    // Still dirty, so the author can retry rather than losing the change.
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("refuses to send an invalid deck, naming the problem before the round trip", async () => {
    const fetchImpl = jsonFetch(200, { ok: true, data: {} });
    const broken: SlideDeck = {
      ...emptyDeck(),
      // An empty title fails `titleSlideSchema.title.min(1)`.
      slides: [{ id: "s1", slideNumber: 1, type: "title", title: "" }],
    };

    render(<PresentationBuilder {...BASE} initialDeck={broken} fetchImpl={fetchImpl} />);

    // Dirty it without fixing the slide.
    fireEvent.click(screen.getByRole("button", { name: "quote" }));
    fireEvent.click(screen.getByTestId("save-deck"));

    await waitFor(() => expect(screen.getByTestId("save-error")).toBeInTheDocument());
    expect(screen.getByTestId("save-error")).toHaveTextContent(/cannot be saved yet/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
