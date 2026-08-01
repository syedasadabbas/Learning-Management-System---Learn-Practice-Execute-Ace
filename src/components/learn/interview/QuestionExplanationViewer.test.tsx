import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CommonMistakesDisplay, readCommonMistakes } from "./CommonMistakesDisplay";
import { QuestionExplanationViewer, wasChosen } from "./QuestionExplanationViewer";
import { TestResultsBreakdown, encouragementFor } from "../practice/TestResultsBreakdown";

const EXPLANATION = {
  correctAnswer: {
    text: "block",
    whyCorrect: "A div is a block-level element by default.",
    visualBreakdown: "div { display: block }",
  },
  incorrectOptions: [
    { optionText: "inline", whyWrong: "Inline elements do not take width." },
    {
      optionText: "flex",
      whyWrong: "Flex must be set explicitly.",
      commonMistake: "Confusing the default with a common override.",
    },
  ],
  deeperLearning: { concepts: ["Box model"], videoUrl: "https://example.com/v" },
};

describe("wasChosen", () => {
  it("compares trimmed and case-folded, so authoring whitespace does not break the marker", () => {
    expect(wasChosen("Block ", "block")).toBe(true);
    expect(wasChosen("inline", "block")).toBe(false);
  });
});

describe("QuestionExplanationViewer", () => {
  it("states the verdict in words rather than by colour", () => {
    render(
      <QuestionExplanationViewer questionId={1} explanation={EXPLANATION} selectedAnswer="flex" />,
    );
    expect(screen.getByTestId("explanation-verdict")).toHaveTextContent(
      'You chose "flex". That is not the correct answer.',
    );
  });

  it("marks the option the student actually picked, with a text badge", () => {
    render(
      <QuestionExplanationViewer questionId={1} explanation={EXPLANATION} selectedAnswer="flex" />,
    );
    const chosen = screen.getByTestId("incorrect-option-1");
    expect(chosen).toHaveAttribute("data-chosen", "true");
    expect(chosen).toHaveTextContent("You chose this");
    // The other wrong option is not marked.
    expect(screen.getByTestId("incorrect-option-0")).not.toHaveAttribute("data-chosen");
  });

  it("congratulates a correct answer without inventing a wrong-option marker", () => {
    render(
      <QuestionExplanationViewer questionId={1} explanation={EXPLANATION} selectedAnswer="block" />,
    );
    expect(screen.getByTestId("explanation-verdict")).toHaveTextContent(
      "You chose the correct answer.",
    );
    expect(screen.queryByText("You chose this")).not.toBeInTheDocument();
  });

  it("escapes the visual breakdown instead of injecting it as HTML", () => {
    render(
      <QuestionExplanationViewer
        questionId={1}
        explanation={{
          ...EXPLANATION,
          correctAnswer: {
            ...EXPLANATION.correctAnswer,
            visualBreakdown: '<img src=x onerror="alert(1)">',
          },
        }}
        selectedAnswer="block"
      />,
    );
    // The payload is TEXT in the document; no element was created from it.
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders the deeper-learning links with a new-tab warning in the name", () => {
    render(
      <QuestionExplanationViewer questionId={1} explanation={EXPLANATION} selectedAnswer="block" />,
    );
    expect(
      screen.getByRole("link", { name: /Watch the explainer \(opens in a new tab\)/ }),
    ).toBeInTheDocument();
  });
});

describe("readCommonMistakes", () => {
  it("drops malformed jsonb entries", () => {
    expect(readCommonMistakes([{ mistake: "a" }, null, 3])).toEqual([]);
    expect(
      readCommonMistakes([{ mistake: "a", why_wrong: "b", correction: "c" }]),
    ).toHaveLength(1);
  });
});

describe("CommonMistakesDisplay", () => {
  const mistakes = [
    {
      mistake: "Using margin to centre a flex item",
      why_wrong: "It works by accident and breaks on wrap.",
      correction: "Use justify-content: center.",
      visual_refutation: ".row { justify-content: center }",
    },
  ];

  it("labels the wrong and right halves in text, not only in colour", () => {
    render(<CommonMistakesDisplay mistakes={mistakes} />);
    expect(screen.getByText("Mistake")).toBeInTheDocument();
    expect(screen.getByText("Instead")).toBeInTheDocument();
  });

  it("renders nothing at all when there are no mistakes", () => {
    const { container } = render(<CommonMistakesDisplay mistakes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("escapes the visual refutation", () => {
    render(
      <CommonMistakesDisplay
        mistakes={[{ ...mistakes[0], visual_refutation: "<script>x()</script>" }]}
      />,
    );
    expect(screen.getByText("<script>x()</script>")).toBeInTheDocument();
  });
});

describe("TestResultsBreakdown", () => {
  const results = [
    { name: "renders a heading", passed: true, expected: "h1", actual: "h1" },
    {
      name: "centres the row",
      passed: false,
      expected: "center",
      actual: "flex-start",
      explanation: "justify-content was not set.",
    },
  ];

  it("labels pass and fail in words alongside the glyph", () => {
    render(<TestResultsBreakdown results={results} totalTests={2} passedTests={1} />);
    expect(screen.getByTestId("test-result-0")).toHaveTextContent("Passed");
    expect(screen.getByTestId("test-result-1")).toHaveTextContent("Failed");
  });

  it("shows expected and actual only for failures", () => {
    render(<TestResultsBreakdown results={results} totalTests={2} passedTests={1} />);
    expect(screen.getByTestId("test-result-1")).toHaveTextContent("flex-start");
    expect(screen.getByTestId("test-result-0")).not.toHaveTextContent("Expected");
  });

  it("clamps a caller-supplied count that exceeds the total", () => {
    // An over-100% bar overflows its track and reports aria-valuenow past max.
    render(<TestResultsBreakdown results={[]} totalTests={2} passedTests={9} />);
    expect(screen.getByText("2 of 2 tests passing")).toBeInTheDocument();
  });

  it("picks encouragement by ratio", () => {
    expect(encouragementFor(0, 0)).toMatch(/no tests/);
    expect(encouragementFor(3, 3)).toMatch(/Every test passes/);
    expect(encouragementFor(0, 3)).toMatch(/Nothing passes yet/);
    expect(encouragementFor(2, 3)).toMatch(/More than half/);
    expect(encouragementFor(1, 4)).toMatch(/Some tests pass/);
  });
});
