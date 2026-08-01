import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import type { RevealApi, RevealFactory } from "@/lib/presentations/reveal-api";
import type { Slide, SlideDeck } from "@/lib/presentations/types";

import { RevealDeck } from "./RevealDeck";

// ---------------------------------------------------------------------------
// A fake Reveal
// ---------------------------------------------------------------------------
// Reveal cannot initialize under jsdom (it needs layout, matchMedia and a real
// resize observer), so the engine is substituted through the component's
// `createReveal` seam. That is the point of the seam existing: the LIFECYCLE
// contract — created once, destroyed on unmount, listener removed — is what
// this wrapper is responsible for, and it is exactly what a fake can verify.
// The single cast below is confined to this helper; the component itself never
// widens the Reveal type.
interface FakeReveal {
  api: RevealApi;
  initialize: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  slide: ReturnType<typeof vi.fn>;
  sync: ReturnType<typeof vi.fn>;
  emitSlideChanged: (indexh: number) => void;
  emitRaw: (event: Event) => void;
}

function makeFakeReveal(): FakeReveal {
  const listeners = new Map<string, Set<EventListener>>();
  const initialize = vi.fn(() => Promise.resolve(api));
  const destroy = vi.fn();
  const slide = vi.fn();
  const sync = vi.fn();

  const api = {
    initialize,
    destroy,
    slide,
    sync,
    isReady: () => true,
    getIndices: () => ({ h: 0, v: 0, f: 0 }),
    on: (type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(type, set);
    },
    off: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as RevealApi;

  const emitRaw = (event: Event): void => {
    for (const listener of listeners.get("slidechanged") ?? []) {
      listener(event);
    }
  };

  return {
    api,
    initialize,
    destroy,
    slide,
    sync,
    emitRaw,
    emitSlideChanged: (indexh: number) => {
      emitRaw(new CustomEvent("slidechanged", { detail: { indexh, indexv: 0 } }));
    },
  };
}

function deckOf(...slides: Slide[]): SlideDeck {
  return {
    slides,
    metadata: { theme: "lms", transition: "slide", width: 1280, height: 720 },
  };
}

const slideA: Slide = {
  id: "a",
  slideNumber: 1,
  type: "title",
  title: "Alpha",
};
const slideB: Slide = {
  id: "b",
  slideNumber: 2,
  type: "content",
  title: "Beta",
  bullets: ["one"],
  speakerNotes: "say something",
};

describe("RevealDeck lifecycle", () => {
  it("creates exactly one instance and initializes it", async () => {
    const fake = makeFakeReveal();
    const createReveal: RevealFactory = vi.fn(() => fake.api);

    render(<RevealDeck deck={deckOf(slideA, slideB)} createReveal={createReveal} />);

    await waitFor(() => expect(fake.initialize).toHaveBeenCalledTimes(1));
    expect(createReveal).toHaveBeenCalledTimes(1);
  });

  it("destroys the instance on unmount", async () => {
    // The regression this guards: a leaked instance keeps document-level key
    // handlers alive, and the editor's live preview remounts constantly.
    const fake = makeFakeReveal();
    const { unmount } = render(
      <RevealDeck deck={deckOf(slideA, slideB)} createReveal={() => fake.api} />,
    );

    await waitFor(() => expect(fake.initialize).toHaveBeenCalled());
    unmount();

    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys once per mount across repeated remounts", async () => {
    const instances: FakeReveal[] = [];
    const createReveal: RevealFactory = () => {
      const fake = makeFakeReveal();
      instances.push(fake);
      return fake.api;
    };

    for (let i = 0; i < 3; i += 1) {
      const { unmount } = render(
        <RevealDeck deck={deckOf(slideA)} createReveal={createReveal} />,
      );
      await waitFor(() => expect(instances[i].initialize).toHaveBeenCalled());
      unmount();
    }

    expect(instances).toHaveLength(3);
    for (const instance of instances) {
      expect(instance.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("syncs rather than rebuilding when the slide set changes", async () => {
    const fake = makeFakeReveal();
    const { rerender } = render(
      <RevealDeck deck={deckOf(slideA)} createReveal={() => fake.api} />,
    );
    await waitFor(() => expect(fake.initialize).toHaveBeenCalledTimes(1));

    rerender(
      <RevealDeck deck={deckOf(slideA, slideB)} createReveal={() => fake.api} />,
    );

    expect(fake.sync).toHaveBeenCalled();
    expect(fake.destroy).not.toHaveBeenCalled();
  });
});

describe("RevealDeck navigation", () => {
  it("reports engine-driven slide changes through onSlideChange", async () => {
    const fake = makeFakeReveal();
    const onSlideChange = vi.fn();
    render(
      <RevealDeck
        deck={deckOf(slideA, slideB)}
        createReveal={() => fake.api}
        onSlideChange={onSlideChange}
      />,
    );
    await waitFor(() => expect(fake.initialize).toHaveBeenCalled());

    fake.emitSlideChanged(1);

    expect(onSlideChange).toHaveBeenCalledWith(1, slideB);
  });

  it("ignores an event with no usable detail", async () => {
    const fake = makeFakeReveal();
    const onSlideChange = vi.fn();
    render(
      <RevealDeck
        deck={deckOf(slideA, slideB)}
        createReveal={() => fake.api}
        onSlideChange={onSlideChange}
      />,
    );
    await waitFor(() => expect(fake.initialize).toHaveBeenCalled());

    // Reveal routes several events through the same plumbing; a cast-based
    // implementation would read `undefined.indexh` out of this one and navigate
    // to slide NaN.
    fake.emitRaw(new Event("slidechanged"));
    fake.emitRaw(new CustomEvent("slidechanged", { detail: { other: 1 } }));

    expect(onSlideChange).not.toHaveBeenCalled();
  });

  it("drives the engine when a controlled index changes", async () => {
    const fake = makeFakeReveal();
    const { rerender } = render(
      <RevealDeck
        deck={deckOf(slideA, slideB)}
        currentIndex={0}
        createReveal={() => fake.api}
      />,
    );
    await waitFor(() => expect(fake.initialize).toHaveBeenCalled());
    fake.slide.mockClear();

    rerender(
      <RevealDeck
        deck={deckOf(slideA, slideB)}
        currentIndex={1}
        createReveal={() => fake.api}
      />,
    );

    expect(fake.slide).toHaveBeenCalledWith(1, 0, 0);
  });
});

describe("RevealDeck accessibility", () => {
  it("announces the current slide in a live region", async () => {
    const fake = makeFakeReveal();
    render(<RevealDeck deck={deckOf(slideA, slideB)} createReveal={() => fake.api} />);

    const announcer = screen.getByTestId("slide-announcer");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("Slide 1 of 2: Alpha");

    await waitFor(() => expect(fake.initialize).toHaveBeenCalled());
    fake.emitSlideChanged(1);
    await waitFor(() =>
      expect(screen.getByTestId("slide-announcer")).toHaveTextContent(
        "Slide 2 of 2: Beta",
      ),
    );
  });

  it("marks each section as a slide and keeps it out of the tab order", () => {
    const fake = makeFakeReveal();
    render(<RevealDeck deck={deckOf(slideA, slideB)} createReveal={() => fake.api} />);

    const sections = screen.getAllByLabelText(/^Slide \d of 2$/);
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section).toHaveAttribute("aria-roledescription", "slide");
      expect(section).toHaveAttribute("tabindex", "-1");
    }
  });

  it("renders speaker notes into Reveal's notes aside", () => {
    const fake = makeFakeReveal();
    const { container } = render(
      <RevealDeck deck={deckOf(slideB)} createReveal={() => fake.api} />,
    );
    expect(container.querySelector("aside.notes")?.textContent).toBe(
      "say something",
    );
  });
});

describe("RevealDeck readOnly", () => {
  it("creates no engine at all", () => {
    const createReveal = vi.fn();
    render(
      <RevealDeck deck={deckOf(slideA, slideB)} readOnly createReveal={createReveal} />,
    );
    expect(createReveal).not.toHaveBeenCalled();
    expect(screen.getByTestId("reveal-preview")).toBeInTheDocument();
  });

  it("does not respond to navigation keys", () => {
    const onSlideChange = vi.fn();
    render(
      <RevealDeck
        deck={deckOf(slideA, slideB)}
        readOnly
        onSlideChange={onSlideChange}
        createReveal={vi.fn()}
      />,
    );

    const preview = screen.getByTestId("reveal-preview");
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "PageDown" });
    fireEvent.keyDown(document, { key: " " });

    expect(onSlideChange).not.toHaveBeenCalled();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("says so when there are no slides to preview", () => {
    render(<RevealDeck deck={deckOf()} readOnly createReveal={vi.fn()} />);
    expect(screen.getByText("No slides yet")).toBeInTheDocument();
  });
});

describe("RevealDeck degenerate decks", () => {
  it("renders an empty deck without crashing", () => {
    const fake = makeFakeReveal();
    render(<RevealDeck deck={deckOf()} createReveal={() => fake.api} />);
    expect(screen.getByTestId("slide-announcer")).toHaveTextContent(
      "This presentation has no slides.",
    );
  });

  it("renders a single-slide deck without crashing", async () => {
    const fake = makeFakeReveal();
    render(<RevealDeck deck={deckOf(slideA)} createReveal={() => fake.api} />);
    await waitFor(() => expect(fake.initialize).toHaveBeenCalled());
    expect(screen.getByTestId("slide-announcer")).toHaveTextContent(
      "Slide 1 of 1: Alpha",
    );
  });
});
