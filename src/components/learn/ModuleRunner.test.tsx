// =============================================================================
// MODULE RUNNER TESTS — the markup contract the e2e suite depends on.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL, given the behaviour is already covered end to end.
//
// Four specs in tests/e2e/interactive-learning/learn.spec.ts shipped RED on
// 2026-07-30 with a note blaming "a mismatch between each stream's specs and its
// own rendered markup". Nobody could check that claim without booting Playwright
// against the shared database, so it stood for a day and was wrong: the markup
// was right, and the real cause was accumulated `learning_progress` rows moving
// the runner's opening step (diagnosed 2026-07-31 — see that file's header).
//
// So the assertions below are exactly the DOM claims those specs make, pinned
// where a `npx vitest run` can settle them in a second:
//
//   * the runner opens at the first INCOMPLETE step, and at the LAST step once
//     the module is finished — the behaviour that made three specs order
//     dependent, stated as a test instead of as a comment;
//   * `data-done` is the string "true"/"false", never empty;
//   * `aria-current="step"` moves with the current step;
//   * every tab carries `data-step-kind`, which is what lets a spec open the lab
//     or the check step without completing everything in front of it;
//   * the lab/check test ids appear when their step is current.
//
// WHAT THIS FILE CANNOT PROVE, and does not pretend to: the POST really reaching
// the route (postStepComplete is mocked here and covered in client.test.ts), the
// Web Worker running a lab (no Worker in jsdom), and the real
// prefers-reduced-motion media feature. Those stay with Playwright.
//
// LazyCodeRunner IS MOCKED, following MarkupWorkbench.test.tsx: it is a
// next/dynamic boundary onto the whole execution graph, and this file is about
// the runner's own markup, not about the code editor.
// =============================================================================

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LearnModuleDetail, LearnStepView } from "@/lib/learn";

// --- mocks, declared before the import under test -------------------------

vi.mock("@/components/execution", () => ({
  LazyCodeRunner: (props: { language: string }) => (
    <div data-testid="code-runner-mock" data-language={props.language} />
  ),
}));

// react-markdown renders asynchronously enough in jsdom to add noise to every
// assertion here, and the prose is not what is under test.
vi.mock("@/components/course/MarkdownContent", () => ({
  MarkdownContent: ({ markdown }: { markdown: string }) => (
    <div data-testid="markdown-mock">{markdown}</div>
  ),
}));

const postStepComplete = vi.fn();
vi.mock("@/lib/learn/client", () => ({
  postStepComplete: (stepId: number, answerIndex?: number) =>
    postStepComplete(stepId, answerIndex),
}));

import { ModuleRunner } from "./ModuleRunner";

// --- fixture --------------------------------------------------------------

/**
 * The seeded shape of `oop-objects-and-state`, read off the database on
 * 2026-07-31: explain(diagram), lab(js), explain, check, lab(js), explain.
 * Mirrored here so a test that passes means something about the real content.
 */
const STEP_KINDS = ["explain", "lab", "explain", "check", "lab", "explain"] as const;

function step(index: number): LearnStepView {
  const kind = STEP_KINDS[index];
  return {
    id: 100 + index,
    stepNumber: index + 1,
    kind,
    title: `Step ${index + 1}`,
    body: `Body of step ${index + 1}`,
    starterCode: kind === "lab" ? "console.log(1);" : null,
    language: kind === "lab" ? "javascript" : null,
    execution: kind === "lab" ? "browser" : "none",
    explain:
      kind === "explain" && index === 0
        ? {
            kind: "explain",
            diagramTitle: "Parallel arrays versus one object",
            frames: [
              { label: "Two arrays", caption: "One unwritten rule." },
              { label: "The rule breaks", caption: "Nothing raises an error." },
              { label: "One object", caption: "The class of bug is gone." },
            ],
          }
        : null,
    lab: kind === "lab" ? { kind: "lab", goal: "Add deposit and withdraw." } : null,
    check:
      kind === "check"
        ? {
            prompt: "What does === report?",
            options: [{ text: "false" }, { text: "true" }],
          }
        : null,
  };
}

function moduleWith(completedStepIds: number[]): LearnModuleDetail {
  const steps = STEP_KINDS.map((_, i) => step(i));
  return {
    id: 7,
    slug: "oop-objects-and-state",
    track: "oop",
    title: "Objects and State",
    summary: "State, behaviour, identity.",
    level: "beginner",
    estimatedMinutes: 30,
    orderIndex: 0,
    stepCount: steps.length,
    completedSteps: completedStepIds.length,
    steps,
    completedStepIds,
  };
}

/** Every step id, i.e. a module the student has finished. */
const ALL_STEP_IDS = STEP_KINDS.map((_, i) => 100 + i);

function tab(stepNumber: number): HTMLElement {
  const found = screen
    .getAllByTestId("learn-step-tab")
    .find((el) => el.getAttribute("data-step-number") === String(stepNumber));
  if (!found) throw new Error(`No step tab ${stepNumber} rendered.`);
  return found;
}

beforeEach(() => {
  postStepComplete.mockReset();
  postStepComplete.mockImplementation(async (stepId: number) => ({
    ok: true,
    data: {
      created: true,
      stepId,
      moduleId: 7,
      progress: { stepCount: 6, completedSteps: 1, percent: 17, status: "in_progress" },
      announcement: "Step 1 of 6 complete — 17 per cent.",
      check: null,
    },
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("ModuleRunner — where the module opens", () => {
  it("opens at step 1 when nothing is complete", () => {
    render(<ModuleRunner module={moduleWith([])} />);
    expect(tab(1)).toHaveAttribute("aria-current", "step");
    expect(tab(1)).toHaveAttribute("data-done", "false");
  });

  it("opens at the first INCOMPLETE step, which is what a reload resumes to", () => {
    // Exactly the state the e2e reload assertion checks: step 1 saved, so the
    // second render lands on step 2 rather than back at the beginning.
    render(<ModuleRunner module={moduleWith([100])} />);
    expect(tab(1)).toHaveAttribute("data-done", "true");
    expect(tab(1)).not.toHaveAttribute("aria-current");
    expect(tab(2)).toHaveAttribute("aria-current", "step");
  });

  it("opens at the LAST step once every step is complete — the e2e reset's reason", () => {
    // This is the behaviour that broke three e2e specs when `learning_progress`
    // accumulated: with the module finished there is no step in front to advance
    // to, so a spec that walked forward to find a lab could never reach one.
    render(<ModuleRunner module={moduleWith(ALL_STEP_IDS)} />);
    expect(tab(6)).toHaveAttribute("aria-current", "step");
    expect(screen.queryByTestId("learn-lab-step")).not.toBeInTheDocument();
    // And "next" cannot move: the button says the module is complete.
    expect(screen.getByTestId("learn-next-step")).toHaveTextContent(/module complete/i);
  });
});

describe("ModuleRunner — advancing a step", () => {
  it("marks the step done in words and in data-done, and moves aria-current on", async () => {
    render(<ModuleRunner module={moduleWith([])} />);

    fireEvent.click(screen.getByTestId("learn-next-step"));

    await waitFor(() => expect(tab(1)).toHaveAttribute("data-done", "true"));
    expect(postStepComplete).toHaveBeenCalledWith(100, undefined);
    expect(tab(2)).toHaveAttribute("aria-current", "step");
    // Not colour-only: the word "done" is in the tab's accessible name.
    expect(tab(1)).toHaveTextContent(/done/i);
    // The live region carries the counts the e2e spec matches on (/1 of \d+/).
    expect(screen.getByTestId("learn-progress-announcement")).toHaveTextContent(/1 of 6/);
  });

  it("does not re-POST a step that is already complete", async () => {
    render(<ModuleRunner module={moduleWith([100])} />);
    // Step 2 is current; go back to the completed step 1 and press continue.
    fireEvent.click(tab(1));
    fireEvent.click(screen.getByTestId("learn-next-step"));
    await waitFor(() => expect(tab(2)).toHaveAttribute("aria-current", "step"));
    expect(postStepComplete).not.toHaveBeenCalled();
  });

  it("keeps the step un-ticked and says so when the save fails, without blocking", async () => {
    postStepComplete.mockResolvedValue({ ok: false, error: "Could not save that step." });
    render(<ModuleRunner module={moduleWith([])} />);

    fireEvent.click(screen.getByTestId("learn-next-step"));

    await waitFor(() => expect(screen.getByTestId("learn-save-error")).toBeInTheDocument());
    expect(tab(1)).toHaveAttribute("data-done", "false");
    expect(tab(2)).toHaveAttribute("aria-current", "step");
  });
});

describe("ModuleRunner — a step is addressable by kind", () => {
  it("puts data-step-kind on every tab", () => {
    render(<ModuleRunner module={moduleWith([])} />);
    expect(
      screen.getAllByTestId("learn-step-tab").map((el) => el.getAttribute("data-step-kind")),
    ).toEqual([...STEP_KINDS]);
  });

  it("opens the lab step without completing anything in front of it", () => {
    // The property the e2e lab spec now relies on instead of pressing "continue"
    // in a loop: clicking a tab navigates and writes nothing.
    render(<ModuleRunner module={moduleWith(ALL_STEP_IDS)} />);
    fireEvent.click(
      screen
        .getAllByTestId("learn-step-tab")
        .find((el) => el.getAttribute("data-step-kind") === "lab")!,
    );
    expect(screen.getByTestId("learn-lab-step")).toBeInTheDocument();
    expect(screen.getByTestId("code-runner-mock")).toHaveAttribute("data-language", "javascript");
    expect(postStepComplete).not.toHaveBeenCalled();
  });

  it("opens the check step, and its markup carries no answer key", () => {
    const { container } = render(<ModuleRunner module={moduleWith(ALL_STEP_IDS)} />);
    fireEvent.click(
      screen
        .getAllByTestId("learn-step-tab")
        .find((el) => el.getAttribute("data-step-kind") === "check")!,
    );
    expect(screen.getByTestId("learn-check-step")).toBeInTheDocument();
    // `PublicCheck` has no `correct` field to render, and no explanation either
    // until the server grades the answer. Asserted on the rendered DOM because
    // that is what the e2e canary looks at.
    expect(container.innerHTML).not.toMatch(/"correct"\s*:\s*true/);
    expect(screen.queryByText(/correct answer/i)).not.toBeInTheDocument();
  });

  it("grades a check through the server and shows the returned explanation", async () => {
    postStepComplete.mockResolvedValue({
      ok: true,
      data: {
        created: false,
        stepId: 103,
        moduleId: 7,
        progress: { stepCount: 6, completedSteps: 6, percent: 100, status: "complete" },
        announcement: "Module complete. All 6 steps done.",
        check: {
          correct: false,
          correctIndex: 0,
          explanation: "=== on objects compares identity, not contents.",
        },
      },
    });
    render(<ModuleRunner module={moduleWith(ALL_STEP_IDS)} />);
    fireEvent.click(
      screen
        .getAllByTestId("learn-step-tab")
        .find((el) => el.getAttribute("data-step-kind") === "check")!,
    );
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByTestId("learn-check-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("learn-check-result")).toHaveTextContent(/not quite/i),
    );
    // The answer index reached the server; the explanation came back from it.
    expect(postStepComplete).toHaveBeenCalledWith(103, 1);
    expect(screen.getByTestId("learn-check-result")).toHaveTextContent(/compares identity/);
  });
});
