// =============================================================================
// MarkupWorkbench tests. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// LiveEditor IS MOCKED, and that is a decision rather than a shortcut. It mounts
// Sandpack, which creates an iframe, a service worker and a bundler client — none
// of which jsdom provides, and all of which the interactive-exercises stream
// already covers in its own Playwright specs. Mocking it leaves exactly this
// component's own behaviour under test, which is the three things it does that
// LiveEditor does not:
//
//   1. it turns ONE starter_code column into the file map the editor mounts,
//      including the HTML scaffold a CSS problem needs for its preview to show
//      anything (asserted through the props handed to the mock);
//   2. it reads the student's edits back out of the draft store and submits them as
//      a re-joined bundle — the seam described at length in the component header,
//      and the one most likely to break silently, because when it does the student
//      is graded on the STARTER and told they are wrong;
//   3. it refuses to submit when there is no draft, with a message, instead of
//      submitting the starter and reporting a failure the student cannot explain.
//
// The two grading paths themselves are covered in src/lib/problems/markup.test.ts;
// nothing here re-tests the checker.
// =============================================================================

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// fireEvent, not user-event: @testing-library/user-event is not a dependency of
// this repo and package.json is outside this stream's file ownership. Every
// interaction here is a plain click on a button, which fireEvent models exactly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudentProblem } from "@/lib/problems";

// --- mocks, declared before the import under test -------------------------

/** Props the mocked LiveEditor last received, so the file map can be asserted. */
const editorProps: { current: { exercise: { id: string; files: Record<string, string>; visibleFiles: string[] } } | null } = {
  current: null,
};

vi.mock("@/components/exercises/LiveEditor", () => ({
  LiveEditor: (props: { exercise: { id: string; files: Record<string, string>; visibleFiles: string[] } }) => {
    editorProps.current = props;
    return <div data-testid="live-editor-mock" data-exercise-id={props.exercise.id} />;
  },
}));

const draft: { current: Record<string, string> | null } = { current: null };

vi.mock("@/lib/exercises/persistence", () => ({
  // A stable fingerprint: this test is not exercising the fingerprint rule (that is
  // persistence.ts's own test), only whether a draft is read at all.
  fingerprintFiles: () => "fp",
  loadDraft: () =>
    draft.current ? { files: draft.current, activeFile: "/index.html", starterFingerprint: "fp", savedAt: Date.now() } : null,
}));

import { MarkupWorkbench } from "./MarkupWorkbench";

// --- fixtures --------------------------------------------------------------

const HTML_PROBLEM: StudentProblem = {
  slug: "html-valid-document-skeleton",
  title: "A document that validates",
  statement: "Write the smallest complete HTML5 document.",
  track: "html",
  level: "beginner",
  bank: "practice",
  language: "html",
  execution: "browser",
  timeLimitMs: 5000,
  starterCode: "<html>\n  <head></head>\n  <body></body>\n</html>\n",
  hints: ["Without a doctype the browser uses quirks mode."],
  tags: ["document-structure"],
  visibleTests: [
    {
      id: 1,
      name: "the four declarations",
      input: null,
      expectedOutput: "attr html lang\ntag title",
      orderIndex: 0,
    },
  ],
  hiddenTestCount: 2,
  solved: false,
  attempts: [],
  serverGradingAvailable: true,
};

const CSS_PROBLEM: StudentProblem = {
  ...HTML_PROBLEM,
  slug: "css-centre-a-block",
  title: "Three ways to centre",
  track: "css",
  language: "css",
  starterCode:
    '<!-- file: /index.html -->\n<div class="card"></div>\n/* file: /styles.css */\n.card { width: 320px; }\n',
  visibleTests: [
    {
      id: 9,
      name: "the box is centred",
      input: null,
      expectedOutput: "declares .card | margin-inline: auto",
      orderIndex: 0,
    },
  ],
};

/** A markup problem with nothing to grade: the judgement-shaped kind. */
const REFERENCE_ONLY: StudentProblem = {
  ...HTML_PROBLEM,
  slug: "html-image-alternatives",
  execution: "none",
  visibleTests: [],
  hiddenTestCount: 0,
  referenceSolution: '<img alt="" />',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  draft.current = null;
  editorProps.current = null;
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      data: {
        graded: true,
        attemptId: 1,
        passedCount: 3,
        totalCount: 3,
        passed: true,
        newlySolved: true,
        runtimeMs: 2,
        stderr: null,
        tests: [{ name: "the four declarations", visible: true, passed: true }],
      },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("MarkupWorkbench — the editor it mounts", () => {
  it("hands the starter to the editor as one HTML file for an HTML problem", () => {
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);
    expect(screen.getByTestId("live-editor-mock")).toBeInTheDocument();
    expect(Object.keys(editorProps.current!.exercise.files)).toEqual(["/index.html"]);
  });

  it("splits a CSS problem's bundle into the scaffold and the stylesheet", () => {
    // The whole reason the bundle format exists: without the scaffold the live
    // preview is a blank white frame and the editor is worse than the reference page
    // it replaces.
    render(<MarkupWorkbench problem={CSS_PROBLEM} />);
    const files = editorProps.current!.exercise.files;
    expect(Object.keys(files).sort()).toEqual(["/index.html", "/styles.css"]);
    expect(files["/styles.css"]).toContain("width: 320px");
    expect(files["/index.html"]).toContain('class="card"');
    // HTML tab first — a student should land on the page, not on whichever key the
    // column happened to list first.
    expect(editorProps.current!.exercise.visibleFiles[0]).toBe("/index.html");
  });

  it("namespaces the draft key by slug so it cannot collide with a lecture exercise", () => {
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);
    expect(editorProps.current!.exercise.id).toBe("problem:html-valid-document-skeleton");
  });
});

describe("MarkupWorkbench — the requirements", () => {
  it("lists the visible requirements as sentences and counts the hidden ones", () => {
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);
    expect(screen.getByTestId("problem-requirements")).toBeInTheDocument();
    const items = screen.getAllByTestId("problem-requirement").map((el) => el.textContent);
    expect(items).toEqual([
      "a <html> element sets the lang attribute",
      "the document contains a <title> element",
    ]);
    expect(screen.getByTestId("problem-submit")).toHaveTextContent(
      "Submit for all 3 requirements",
    );
  });

  it("says out loud that structure is checked and appearance is not", () => {
    // The one sentence that stops a student concluding the grader looked at their
    // page and disagreed with it.
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);
    expect(screen.getByTestId("problem-requirements")).toHaveTextContent(
      /not compared with the reference answer/i,
    );
  });

  it("checks the shown requirements locally against the draft, recording nothing", async () => {
    draft.current = { "/index.html": '<html lang="en"><title>x</title></html>' };
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);

    fireEvent.click(screen.getByTestId("problem-check"));

    expect(screen.getByTestId("problem-check-results")).toHaveTextContent("1 of 1 met");
    // Advisory only. A local check that posted anywhere would be a client-reported
    // grade, which the attempt route exists to refuse.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows which requirement failed, and why, when the draft does not satisfy it", async () => {
    draft.current = { "/index.html": "<html><title>x</title></html>" };
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);

    fireEvent.click(screen.getByTestId("problem-check"));

    expect(screen.getByTestId("problem-check-results")).toHaveTextContent("0 of 1 met");
    expect(screen.getByTestId("problem-check-results")).toHaveTextContent(/no <html> sets lang/);
  });
});

describe("MarkupWorkbench — submit", () => {
  it("submits the student's draft, re-joined into a bundle", async () => {
    draft.current = {
      "/index.html": '<div class="card"></div>',
      "/styles.css": ".card { margin-inline: auto; }",
    };
    render(<MarkupWorkbench problem={CSS_PROBLEM} />);

    fireEvent.click(screen.getByTestId("problem-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/problems/css-centre-a-block/attempt");
    const sent = JSON.parse(String(init.body)) as { code: string };
    // Both files, with the delimiters that let one text column carry them — and the
    // student's edits, NOT the starter. If this ever regresses to the starter the
    // student is graded on code they did not write.
    expect(sent.code).toContain("<!-- file: /index.html -->");
    expect(sent.code).toContain("/* file: /styles.css */");
    expect(sent.code).toContain("margin-inline: auto");
    expect(sent.code).not.toContain("width: 320px");
  });

  it("renders the graded outcome in the shared panel, in requirement vocabulary", async () => {
    draft.current = { "/index.html": '<html lang="en"><title>x</title></html>' };
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);

    fireEvent.click(screen.getByTestId("problem-submit"));

    await waitFor(() => expect(screen.getByTestId("problem-submit-result")).toBeInTheDocument());
    // "requirements", not "tests": there is no test runner here and calling it one
    // sends a student looking for output that does not exist.
    expect(screen.getByTestId("problem-submit-result")).toHaveTextContent(
      "All requirements passed",
    );
  });

  it("REFUSES to submit when no draft can be read, rather than grading the starter", async () => {
    draft.current = null;
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);

    fireEvent.click(screen.getByTestId("problem-submit"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("problem-submit-error")).toHaveTextContent(
      /could not be read back from the editor/i,
    );
  });

  it("reports a grader error without claiming the answer was wrong", async () => {
    draft.current = { "/index.html": "<html></html>" };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: "This level is not open yet." }),
    });
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);

    fireEvent.click(screen.getByTestId("problem-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("problem-submit-error")).toHaveTextContent(
        "This level is not open yet.",
      ),
    );
    expect(screen.queryByTestId("problem-submit-result")).not.toBeInTheDocument();
  });
});

describe("MarkupWorkbench — a problem with nothing to grade", () => {
  it("still mounts the editor but offers no Submit", () => {
    // The judgement-shaped markup problems. The editor is the part that was missing;
    // a Submit button here could only ever refuse, which is the same reasoning that
    // hides Run for C++ during a Piston outage.
    render(<MarkupWorkbench problem={REFERENCE_ONLY} />);
    expect(screen.getByTestId("live-editor-mock")).toBeInTheDocument();
    expect(screen.getByTestId("problem-reference-only")).toBeInTheDocument();
    expect(screen.queryByTestId("problem-submit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("problem-check")).not.toBeInTheDocument();
    expect(screen.queryByTestId("problem-requirements")).not.toBeInTheDocument();
  });
});
