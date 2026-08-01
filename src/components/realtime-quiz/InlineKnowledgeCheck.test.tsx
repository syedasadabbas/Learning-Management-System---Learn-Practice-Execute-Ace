// =============================================================================
// InlineKnowledgeCheck component tests.
// -----------------------------------------------------------------------------
// The checker is INJECTED, not mocked at module level: the component takes it as a
// prop precisely so these tests need no server action, no session and no database.
//
// `fireEvent`, not `user-event`: @testing-library/user-event is not a dependency of
// this repo and this stream may not add one. For a native radio that is not a
// meaningful loss — Space on a focused radio dispatches exactly the click these
// tests dispatch. What CANNOT be tested here is arrow-key traversal of the radio
// group: jsdom does not implement it, so a passing assertion would prove nothing
// about a real browser. That is asserted for real, with real key presses, in
// tests/e2e/realtime-quiz/inline-check.spec.ts. What this file asserts instead is
// the precondition for it: native <input type="radio"> in a <fieldset>, each with
// an accessible name and no tabindex that would remove it from the tab order.
//
// What is asserted here is the part that can regress silently:
//   - the explanation is absent from the DOM until the student commits;
//   - the verdict lands in a live region that already existed;
//   - right/wrong is carried by WORDS, not only by a colour;
//   - tries are unlimited — five wrong answers change nothing about what is next;
//   - two instances on one page do not share a radio group.
// =============================================================================

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineKnowledgeCheck } from "./InlineKnowledgeCheck";
import type { InlineCheck } from "@/lib/realtime-quiz";

afterEach(cleanup);

const CHECK: InlineCheck = {
  quizId: 7,
  weekId: 2,
  title: "Quick check: flexbox",
  questions: [
    {
      id: 10,
      questionText: "Which axis does justify-content act on?",
      orderIndex: 0,
      options: [
        { id: 100, optionText: "The main axis", orderIndex: 0 },
        { id: 101, optionText: "The cross axis", orderIndex: 1 },
      ],
    },
  ],
};

const EXPLANATION = "justify-content distributes free space along the main axis.";

/** A checker that says option 100 is right, mirroring what the server returns. */
function fakeChecker() {
  return vi.fn(
    async (input: { questionId: number; selectedOptionId: number }) => ({
      ok: true as const,
      reveal: {
        questionId: input.questionId,
        selectedOptionId: input.selectedOptionId,
        isCorrect: input.selectedOptionId === 100,
        correctOptionId: 100,
        explanation: EXPLANATION,
      },
    }),
  );
}

const mainAxis = () => screen.getByRole("radio", { name: /the main axis/i });
const crossAxis = () => screen.getByRole("radio", { name: /the cross axis/i });
const checkButton = () => screen.getByTestId("realtime-check-answer");

describe("before the student answers", () => {
  it("ships no explanation and no correctness hint in the DOM", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    expect(screen.queryByTestId("realtime-explanation")).toBeNull();
    expect(screen.queryByTestId("realtime-verdict")).toBeNull();
    expect(document.body.textContent).not.toContain(EXPLANATION);
    expect(document.body.textContent).not.toContain("correct answer");
  });

  it("renders the live region already present, so the first verdict is announced", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    const region = screen.getByTestId("realtime-feedback");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region.textContent).toBe("");
  });

  it("says out loud that it is not graded", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    expect(screen.getByTestId("realtime-ungraded-badge")).toHaveTextContent("Not graded");
    expect(screen.getByText(/nothing here counts towards your marks/i)).toBeInTheDocument();
  });

  it("cannot be checked with nothing selected", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    expect(checkButton()).toBeDisabled();
  });
});

describe("keyboard reachability (the structural precondition)", () => {
  it("uses native radios inside a fieldset with a legend", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    const fieldset = document.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.querySelector("legend")?.textContent).toContain(
      "Which axis does justify-content act on?",
    );
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.tagName).toBe("INPUT");
      expect((radio as HTMLInputElement).type).toBe("radio");
      // Anything other than the default tab behaviour would take these out of
      // keyboard reach or make them a focus trap.
      expect(radio).not.toHaveAttribute("tabindex");
    }
  });

  it("labels every option, so a radio has an accessible name", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    expect(mainAxis()).toBeInTheDocument();
    expect(crossAxis()).toBeInTheDocument();
  });

  it("selecting a radio the way the keyboard does enables the check", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    // Space on a focused radio dispatches a click; this is that event.
    fireEvent.click(mainAxis());
    expect(mainAxis()).toBeChecked();
    expect(checkButton()).toBeEnabled();
  });
});

describe("after the student answers", () => {
  it("announces 'Correct' in words and reveals the explanation only then", async () => {
    const checker = fakeChecker();
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={checker} />);

    fireEvent.click(mainAxis());
    fireEvent.click(checkButton());

    const verdict = await screen.findByTestId("realtime-verdict");
    expect(verdict).toHaveTextContent("Correct");
    expect(screen.getByTestId("realtime-explanation")).toHaveTextContent(EXPLANATION);
    expect(checker).toHaveBeenCalledWith({ questionId: 10, selectedOptionId: 100 });

    // The verdict is INSIDE the pre-existing live region, not a sibling of it.
    const region = screen.getByTestId("realtime-feedback");
    expect(within(region).getByTestId("realtime-verdict")).toBe(verdict);
  });

  it("announces 'Not quite' in words for a wrong answer — not colour alone", async () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);

    fireEvent.click(crossAxis());
    fireEvent.click(checkButton());

    expect(await screen.findByTestId("realtime-verdict")).toHaveTextContent("Not quite");
    // The right answer is identified by TEXT beside the option, not by its border.
    const options = screen.getAllByTestId("realtime-option");
    expect(options.find((el) => el.dataset.optionId === "100")).toHaveTextContent(
      /\(correct answer\)/i,
    );
    expect(options.find((el) => el.dataset.optionId === "101")).toHaveTextContent(
      /\(your answer\)/i,
    );
  });

  it("keeps the ✓ glyph out of the accessible name", async () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    fireEvent.click(mainAxis());
    fireEvent.click(checkButton());

    const verdict = await screen.findByTestId("realtime-verdict");
    const glyph = verdict.querySelector("[aria-hidden='true']");
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveTextContent("✓");
  });

  it("clears the verdict when the student changes their mind", async () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);

    fireEvent.click(crossAxis());
    fireEvent.click(checkButton());
    await screen.findByTestId("realtime-verdict");

    fireEvent.click(mainAxis());
    // Leaving "Not quite" next to a freshly picked option would mislabel it.
    expect(screen.queryByTestId("realtime-verdict")).toBeNull();
  });
});

describe("attempts are unlimited", () => {
  it("stays fully answerable after five wrong answers", async () => {
    const checker = fakeChecker();
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={checker} />);

    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(crossAxis());
      fireEvent.click(checkButton());
      await screen.findByTestId("realtime-verdict");
      fireEvent.click(screen.getByTestId("realtime-try-again"));
    }

    expect(checker).toHaveBeenCalledTimes(5);
    // No lockout, no counter, no "attempts remaining" anywhere: nothing counts the
    // tries, so nothing can run out.
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/attempts?\s+(remaining|left|used)/i);

    fireEvent.click(mainAxis());
    fireEvent.click(checkButton());
    expect(await screen.findByTestId("realtime-verdict")).toHaveTextContent("Correct");
  });

  it("'Try again' returns the question to unanswered", async () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);

    fireEvent.click(mainAxis());
    fireEvent.click(checkButton());
    await screen.findByTestId("realtime-verdict");

    fireEvent.click(screen.getByTestId("realtime-try-again"));
    expect(screen.queryByTestId("realtime-verdict")).toBeNull();
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(checkButton()).toBeDisabled();
  });
});

describe("safe to place more than once on one page", () => {
  it("does not share a radio group between two instances", () => {
    const second: InlineCheck = { ...CHECK, quizId: 8, title: "Quick check: grid" };
    render(
      <div>
        <InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />
        <InlineKnowledgeCheck check={second} onCheckAnswer={fakeChecker()} />
      </div>,
    );

    const [first, secondSection] = screen.getAllByTestId("realtime-check");
    fireEvent.click(within(first).getByRole("radio", { name: /the main axis/i }));
    fireEvent.click(within(secondSection).getByRole("radio", { name: /the cross axis/i }));

    // A shared `name` would have unchecked the first instance's selection.
    expect(within(first).getByRole("radio", { name: /the main axis/i })).toBeChecked();
    expect(
      within(secondSection).getByRole("radio", { name: /the cross axis/i }),
    ).toBeChecked();

    const names = screen.getAllByRole("radio").map((el) => (el as HTMLInputElement).name);
    expect(new Set(names).size).toBe(2);

    // Duplicated element ids would break every <label for> on the page.
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assumes no page frame: no main and no h1 of its own", () => {
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={fakeChecker()} />);
    expect(document.querySelector("main")).toBeNull();
    expect(document.querySelector("h1")).toBeNull();
    expect(screen.getByTestId("realtime-check").tagName).toBe("SECTION");
  });
});

describe("failure is survivable mid-lecture", () => {
  it("shows the refusal instead of a verdict when the checker refuses", async () => {
    const refusing = vi.fn(async () => ({
      ok: false as const,
      code: "not_realtime" as const,
      error: "That question belongs to a graded quiz and cannot be checked here.",
    }));
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={refusing} />);

    fireEvent.click(mainAxis());
    fireEvent.click(checkButton());

    expect(await screen.findByTestId("realtime-error")).toHaveTextContent(/graded quiz/i);
    expect(screen.queryByTestId("realtime-explanation")).toBeNull();
    expect(screen.queryByTestId("realtime-verdict")).toBeNull();
  });

  it("shows a retryable message when the checker rejects", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    render(<InlineKnowledgeCheck check={CHECK} onCheckAnswer={throwing} />);

    fireEvent.click(mainAxis());
    fireEvent.click(checkButton());

    expect(await screen.findByTestId("realtime-error")).toHaveTextContent(/try again/i);
    expect(checkButton()).toBeEnabled();
  });
});

describe("nothing to render", () => {
  it("renders null for a check with no questions rather than an empty panel", () => {
    const { container } = render(
      <InlineKnowledgeCheck check={{ ...CHECK, questions: [] }} onCheckAnswer={fakeChecker()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
