import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// `fireEvent`, not `@testing-library/user-event` — the latter is not a
// dependency of this project and this stream may not add one. The house idiom
// (src/components/ui/Button.test.tsx, every visualizations spec) is fireEvent.

import { ProgressiveHintRevealer } from "./ProgressiveHintRevealer";

// =============================================================================
// The property this file exists to protect: A HINT THE STUDENT HAS NOT ASKED
// FOR IS NOT IN THE BROWSER. That is why the assertions are about what the
// FETCH SPY was called with, and about the absence of hint text from the DOM —
// not merely about what is visible. A component that fetched all ten and
// revealed them one at a time would pass a visibility test and fail these.
// =============================================================================

/** A metered `/hints` endpoint: returns exactly levels 1..upTo, like the route. */
function meteredHintsFetch(allHints: Array<{ level: number; text: string }>) {
  const calls: number[] = [];
  const maxLevel = allHints.reduce((max, h) => Math.max(max, h.level), 0);

  const fetchImpl = vi.fn(async (url: string) => {
    const upTo = Number(new URL(url, "http://t").searchParams.get("upTo") ?? "1");
    calls.push(upTo);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          problemId: 5,
          hints: allHints.filter((h) => h.level <= upTo),
          revealedUpTo: Math.min(upTo, maxLevel),
          maxLevel,
          hasMore: upTo < maxLevel,
        },
      }),
    } as unknown as Response;
  });

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const HINTS = [
  { level: 1, text: "Start with the container." },
  { level: 2, text: "Set display to flex." },
  { level: 3, text: "The answer is justify-content: space-between." },
];

describe("ProgressiveHintRevealer — metering", () => {
  it("fetches nothing until the student asks", () => {
    const { fetchImpl, calls } = meteredHintsFetch(HINTS);
    render(<ProgressiveHintRevealer problemId={5} maxLevel={3} fetchImpl={fetchImpl} />);

    expect(calls).toEqual([]);
    expect(screen.getByTestId("progressive-hints")).toHaveAttribute("data-source", "metered");
    expect(screen.getByText("0 of 3 revealed")).toBeInTheDocument();
  });

  it("requests ONE more rung per press, and no hint text arrives before it is asked for", async () => {
    const { fetchImpl, calls } = meteredHintsFetch(HINTS);
    render(<ProgressiveHintRevealer problemId={5} maxLevel={3} fetchImpl={fetchImpl} />);

    // Nothing at all in the document yet.
    expect(screen.queryByText(HINTS[0].text)).not.toBeInTheDocument();
    expect(screen.queryByText(HINTS[2].text)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reveal-hint"));
    await waitFor(() => expect(screen.getByText(HINTS[0].text)).toBeInTheDocument());
    expect(calls).toEqual([1]);
    // THE ASSERTION THAT MATTERS: level 3 is still nowhere in the browser.
    expect(screen.queryByText(HINTS[2].text)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reveal-hint"));
    await waitFor(() => expect(screen.getByText(HINTS[1].text)).toBeInTheDocument());
    expect(calls).toEqual([1, 2]);
    expect(screen.queryByText(HINTS[2].text)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reveal-hint"));
    await waitFor(() => expect(screen.getByText(HINTS[2].text)).toBeInTheDocument());
    expect(calls).toEqual([1, 2, 3]);
  });

  it("stops offering more once the ladder is exhausted", async () => {
    const { fetchImpl } = meteredHintsFetch([HINTS[0]]);
    render(<ProgressiveHintRevealer problemId={5} maxLevel={1} fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByTestId("reveal-hint"));
    await waitFor(() => expect(screen.getByTestId("hints-exhausted")).toBeInTheDocument());
    expect(screen.queryByTestId("reveal-hint")).not.toBeInTheDocument();
  });

  it("reports a level as revealed through onHintRevealed", async () => {
    const onHintRevealed = vi.fn();
    const { fetchImpl } = meteredHintsFetch(HINTS);

    render(
      <ProgressiveHintRevealer
        problemId={5}
        maxLevel={3}
        fetchImpl={fetchImpl}
        onHintRevealed={onHintRevealed}
      />,
    );

    fireEvent.click(screen.getByTestId("reveal-hint"));
    await waitFor(() => expect(onHintRevealed).toHaveBeenCalledWith(1));
  });
});

describe("ProgressiveHintRevealer — states", () => {
  it("renders an error, keeps the button, and announces the failure", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: false,
        status: 500,
        json: async () => ({ ok: false, error: "The server is unwell." }),
      }) as unknown as Response,
    ) as unknown as typeof fetch;

    render(<ProgressiveHintRevealer problemId={5} maxLevel={2} fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId("reveal-hint"));

    await waitFor(() =>
      expect(screen.getByTestId("hint-error")).toHaveTextContent("The server is unwell."),
    );
    // The failure is announced, not only rendered: the button looks unchanged.
    expect(screen.getByTestId("hint-live-region")).toHaveTextContent("could not be loaded");
    // And it is still pressable, so a transient failure is recoverable.
    expect(screen.getByTestId("reveal-hint")).toBeEnabled();
  });

  it("says so plainly when a problem has no hints at all", () => {
    render(<ProgressiveHintRevealer problemId={5} maxLevel={0} />);
    expect(screen.getByTestId("hints-none")).toBeInTheDocument();
  });

  it("is reachable and operable from the keyboard", async () => {
    const { fetchImpl } = meteredHintsFetch(HINTS);
    render(<ProgressiveHintRevealer problemId={5} maxLevel={3} fetchImpl={fetchImpl} />);

    // Focusable by keyboard, and Enter on a native <button> fires click —
    // which is precisely why the control is a Button and not a div.
    const button = screen.getByTestId("reveal-hint");
    act(() => button.focus());
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(HINTS[0].text)).toBeInTheDocument());
  });

  it("exposes the button by an accessible name that names the next rung", () => {
    const { fetchImpl } = meteredHintsFetch(HINTS);
    render(<ProgressiveHintRevealer problemId={5} maxLevel={3} fetchImpl={fetchImpl} />);
    expect(screen.getByRole("button", { name: "Show the first hint" })).toBeInTheDocument();
  });
});

describe("ProgressiveHintRevealer — the preview escape hatch", () => {
  it("does not fetch when the ladder is supplied, and marks itself as preloaded", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    render(
      <ProgressiveHintRevealer problemId={5} maxLevel={3} hints={HINTS} fetchImpl={fetchImpl} />,
    );

    expect(screen.getByTestId("progressive-hints")).toHaveAttribute("data-source", "preloaded");
    fireEvent.click(screen.getByTestId("reveal-hint"));
    expect(screen.getByText(HINTS[0].text)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("orders a preloaded ladder by level, not by the order jsonb happened to store", async () => {
    const shuffled = [HINTS[2], HINTS[0], HINTS[1]];

    render(<ProgressiveHintRevealer problemId={5} maxLevel={3} hints={shuffled} />);
    fireEvent.click(screen.getByTestId("reveal-hint"));

    expect(screen.getByTestId("hint-1")).toHaveTextContent(HINTS[0].text);
  });
});
