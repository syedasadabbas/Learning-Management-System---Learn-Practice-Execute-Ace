// =============================================================================
// LiveEditor / ExercisePanel component tests.
// -----------------------------------------------------------------------------
// SANDPACK IS MOCKED HERE, DELIBERATELY.
//
// A real <SandpackProvider> boots a bundler client and an iframe; in jsdom it
// needs a service worker, postMessage across frames and network access to
// Sandpack's bundler URL, none of which exist. Mounting it here would either hang
// or pass vacuously.
//
// So these tests replace the Sandpack primitives with stubs and assert OUR wrapper
// logic, which is the part that can actually regress:
//   - the configuration handed to Sandpack (static template, files, live-reload);
//   - the two-step reset, and that it clears the saved draft rather than calling
//     sandpack.resetAllFiles() (see the note on ResetToStarterButton: that call
//     restores the `files` PROP, which is now seeded FROM the draft, so it would
//     "reset" the exercise to the student's own edits and appear to do nothing);
//   - seeding the editor from a saved draft, and announcing that it did;
//   - the diagnostics panel translating the live file contents into words;
//   - the accessible names and the keyboard-escape hint.
//
// That the real editor mounts, accepts typing and refreshes the preview is covered
// by tests/e2e/interactive-exercises/practice.spec.ts against a real browser.
// =============================================================================

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sandpack: {
    files: {} as Record<string, { code: string }>,
    error: null as null | { message: string },
    // `activeFile` is read by DraftPersistence, which is what records the tab the
    // student was last on. Without it here the draft would save `undefined` and
    // the tab-restore path would be untested.
    activeFile: "/index.html",
    resetAllFiles: vi.fn(),
  },
  providerProps: {} as Record<string, unknown>,
}));

vi.mock("@codesandbox/sandpack-react", () => ({
  SandpackProvider: ({ children, ...props }: { children?: React.ReactNode }) => {
    Object.assign(mocks.providerProps, props);
    return <div data-testid="sandpack-provider">{children}</div>;
  },
  SandpackLayout: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sandpack-layout">{children}</div>
  ),
  SandpackCodeEditor: (props: Record<string, unknown>) => (
    <div data-testid="sandpack-editor" aria-label={props["aria-label"] as string} />
  ),
  SandpackPreview: (props: Record<string, unknown>) => (
    <div data-testid="sandpack-preview" aria-label={props["aria-label"] as string} />
  ),
  useSandpack: () => ({ sandpack: mocks.sandpack }),
}));

import { LiveEditor } from "./LiveEditor";
import { ExerciseList, ExercisePanel } from "./ExercisePanel";
import { parseSandpackResources } from "@/lib/exercises";
import { fingerprintFiles, loadDraft, saveDraft } from "@/lib/exercises/persistence";
import type { SandpackExercise } from "@/lib/exercises";

const FLEXBOX: SandpackExercise = {
  id: "12-2",
  title: "Practice: centre a card with Flexbox",
  lectureId: 12,
  files: {
    "/index.html": '<html><head><link rel="stylesheet" href="styles.css" /></head><body></body></html>',
    "/styles.css": ".stage { min-height: 100vh; }",
  },
  visibleFiles: ["/index.html", "/styles.css"],
  activeFile: "/index.html",
  warnings: [],
};

function setLiveFiles(files: Record<string, string>) {
  mocks.sandpack.files = Object.fromEntries(
    Object.entries(files).map(([path, code]) => [path, { code }]),
  );
}

beforeEach(() => {
  mocks.sandpack.resetAllFiles.mockClear();
  mocks.sandpack.error = null;
  mocks.sandpack.activeFile = "/index.html";
  setLiveFiles(FLEXBOX.files);
  for (const key of Object.keys(mocks.providerProps)) delete mocks.providerProps[key];
  // Drafts live in localStorage, which jsdom shares across tests in a file.
  // Without this, a draft saved by one test seeds the editor in the next and the
  // "mounts with the exercise's files" assertions fail for a reason unrelated to
  // what they are testing.
  localStorage.clear();
});

afterEach(cleanup);

describe("LiveEditor — Sandpack configuration", () => {
  it("mounts the static template with the exercise's files and tabs", () => {
    render(<LiveEditor exercise={FLEXBOX} />);

    expect(mocks.providerProps.template).toBe("static");
    expect(mocks.providerProps.files).toEqual(FLEXBOX.files);

    const options = mocks.providerProps.options as Record<string, unknown>;
    expect(options.visibleFiles).toEqual(["/index.html", "/styles.css"]);
    expect(options.activeFile).toBe("/index.html");
  });

  it("configures a live preview with no manual run step", () => {
    render(<LiveEditor exercise={FLEXBOX} />);
    const options = mocks.providerProps.options as Record<string, number | boolean | string>;
    expect(options.autorun).toBe(true);
    expect(options.autoReload).toBe(true);
    // Debounced rather than per-keystroke, in milliseconds.
    expect(options.recompileMode).toBe("delayed");
    expect(options.recompileDelay).toBe(300);
  });

  it("labels the editor and the preview, and tags the exercise id", () => {
    render(<LiveEditor exercise={FLEXBOX} />);
    expect(screen.getByTestId("live-editor")).toHaveAttribute("data-exercise-id", "12-2");
    expect(screen.getByLabelText(`Code editor: ${FLEXBOX.title}`)).toBeInTheDocument();
    expect(screen.getByLabelText(`Live preview: ${FLEXBOX.title}`)).toBeInTheDocument();
  });

  it("tells keyboard users how to escape the editor's Tab capture", () => {
    render(<LiveEditor exercise={FLEXBOX} />);
    expect(screen.getByText(/Esc/)).toBeInTheDocument();
    expect(screen.getByText(/to move focus out/)).toBeInTheDocument();
  });
});

/** Put a saved draft in place, as a previous session would have left it. */
function seedDraft(exercise: SandpackExercise, files: Record<string, string>, activeFile: string) {
  saveDraft(exercise.id, {
    files,
    activeFile,
    starterFingerprint: fingerprintFiles(exercise.files),
  });
}

const EDITED_CSS = ".stage { min-height: 100vh; display: flex; }";

describe("LiveEditor — reset to starter", () => {
  it("arms on the first click and only clears the draft on the second", () => {
    seedDraft(FLEXBOX, { ...FLEXBOX.files, "/styles.css": EDITED_CSS }, "/styles.css");
    render(<LiveEditor exercise={FLEXBOX} />);
    const reset = screen.getByTestId("exercise-reset");

    fireEvent.click(reset);
    expect(loadDraft(FLEXBOX.id, fingerprintFiles(FLEXBOX.files))).not.toBeNull();
    expect(reset).toHaveTextContent(/discards your edits/i);

    fireEvent.click(reset);
    expect(loadDraft(FLEXBOX.id, fingerprintFiles(FLEXBOX.files))).toBeNull();
    // Re-query rather than reuse `reset`: the reset remounts the provider, so the
    // button is a NEW element and the old node is detached, frozen mid-armed.
    expect(screen.getByTestId("exercise-reset")).toHaveTextContent(/Reset to starter code/i);
  });

  it("keeps focus on the reset button it just rebuilt", () => {
    seedDraft(FLEXBOX, { ...FLEXBOX.files, "/styles.css": EDITED_CSS }, "/styles.css");
    render(<LiveEditor exercise={FLEXBOX} />);

    const reset = screen.getByTestId("exercise-reset");
    reset.focus();
    fireEvent.click(reset);
    fireEvent.click(reset);

    // Without the refocus, the remount drops focus to <body> and a keyboard
    // user's next Tab restarts from the top of the document.
    const rebuilt = screen.getByTestId("exercise-reset");
    expect(rebuilt).not.toBe(reset);
    expect(document.activeElement).toBe(rebuilt);
  });

  it("does not grab focus when the reset came from a mouse click", () => {
    seedDraft(FLEXBOX, { ...FLEXBOX.files, "/styles.css": EDITED_CSS }, "/styles.css");
    render(<LiveEditor exercise={FLEXBOX} />);

    // fireEvent.click does not move focus, so this is the mouse-user path.
    const reset = screen.getByTestId("exercise-reset");
    fireEvent.click(reset);
    fireEvent.click(reset);

    expect(document.activeElement).not.toBe(screen.getByTestId("exercise-reset"));
  });

  it("puts the starter files back on the provider, not the draft", () => {
    seedDraft(FLEXBOX, { ...FLEXBOX.files, "/styles.css": EDITED_CSS }, "/styles.css");
    render(<LiveEditor exercise={FLEXBOX} />);
    // Precondition: the draft really is what Sandpack was handed.
    expect((mocks.providerProps.files as Record<string, string>)["/styles.css"]).toBe(EDITED_CSS);

    const reset = screen.getByTestId("exercise-reset");
    fireEvent.click(reset);
    fireEvent.click(reset);

    // The regression this guards: resetAllFiles() would have restored the prop —
    // i.e. the draft — leaving the edit in place and the button looking broken.
    expect(mocks.providerProps.files).toEqual(FLEXBOX.files);
    expect(screen.queryByTestId("exercise-draft-restored")).not.toBeInTheDocument();
  });

  it("disarms itself after the timeout so a stale click cannot wipe work", () => {
    vi.useFakeTimers();
    try {
      seedDraft(FLEXBOX, { ...FLEXBOX.files, "/styles.css": EDITED_CSS }, "/styles.css");
      render(<LiveEditor exercise={FLEXBOX} />);
      const reset = screen.getByTestId("exercise-reset");
      fireEvent.click(reset);
      expect(reset).toHaveTextContent(/discards your edits/i);
      // Advance past RESET_ARM_TIMEOUT_MS (5 000 ms).
      act(() => vi.advanceTimersByTime(5_100));
      expect(reset).toHaveTextContent(/Reset to starter code/i);
      fireEvent.click(reset);
      expect(loadDraft(FLEXBOX.id, fingerprintFiles(FLEXBOX.files))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the control keyboard reachable and labelled", () => {
    render(<LiveEditor exercise={FLEXBOX} />);
    const reset = screen.getByRole("button", {
      name: /reset this exercise to its starter code/i,
    });
    expect(reset.tagName).toBe("BUTTON");
    expect(reset).not.toBeDisabled();
  });
});

describe("LiveEditor — draft restore", () => {
  it("hands Sandpack the starter, and no notice, when there is no draft", () => {
    render(<LiveEditor exercise={FLEXBOX} />);
    expect(mocks.providerProps.files).toEqual(FLEXBOX.files);
    expect(screen.queryByTestId("exercise-draft-restored")).not.toBeInTheDocument();
  });

  it("seeds the editor from a draft and says so", () => {
    seedDraft(FLEXBOX, { ...FLEXBOX.files, "/styles.css": EDITED_CSS }, "/styles.css");
    render(<LiveEditor exercise={FLEXBOX} />);

    expect((mocks.providerProps.files as Record<string, string>)["/styles.css"]).toBe(EDITED_CSS);
    // The saved tab is reopened — the "it switches back to HTML" complaint.
    expect((mocks.providerProps.options as Record<string, unknown>).activeFile).toBe(
      "/styles.css",
    );
    expect(screen.getByTestId("exercise-draft-restored")).toBeInTheDocument();
  });

  it("ignores a draft written against different starter code", () => {
    // An instructor edited the exercise since the draft was saved. Restoring it
    // would show the student their old work against a changed brief, with the
    // new starter nowhere to be seen.
    saveDraft(FLEXBOX.id, {
      files: { ...FLEXBOX.files, "/styles.css": EDITED_CSS },
      activeFile: "/styles.css",
      starterFingerprint: fingerprintFiles({ "/index.html": "<html>different</html>" }),
    });
    render(<LiveEditor exercise={FLEXBOX} />);

    expect(mocks.providerProps.files).toEqual(FLEXBOX.files);
    expect(screen.queryByTestId("exercise-draft-restored")).not.toBeInTheDocument();
  });

  it("falls back to the starter's tab when the draft names a file that is gone", () => {
    seedDraft(FLEXBOX, FLEXBOX.files, "/deleted.css");
    render(<LiveEditor exercise={FLEXBOX} />);
    // Pointing Sandpack at a file outside visibleFiles leaves it showing nothing.
    expect((mocks.providerProps.options as Record<string, unknown>).activeFile).toBe(
      FLEXBOX.activeFile,
    );
  });
});

describe("LiveEditor — diagnostics instead of a blank frame", () => {
  it("states that nothing is wrong when the files are sound", () => {
    render(<LiveEditor exercise={FLEXBOX} />);
    expect(screen.getByTestId("exercise-diagnostics")).toHaveTextContent(
      /No syntax problems detected/i,
    );
  });

  it("explains an unbalanced brace in the student's live CSS", () => {
    setLiveFiles({ ...FLEXBOX.files, "/styles.css": ".stage { min-height: 100vh;" });
    render(<LiveEditor exercise={FLEXBOX} />);
    expect(screen.getByTestId("exercise-diagnostics")).toHaveTextContent(/curly brace/i);
  });

  it("surfaces a runtime error from the sandbox", () => {
    mocks.sandpack.error = { message: "count is not defined" };
    render(<LiveEditor exercise={FLEXBOX} />);
    expect(screen.getByTestId("exercise-runtime-error")).toHaveTextContent(
      /count is not defined/,
    );
  });

  it("repeats the parser's normalisation warnings to the student", () => {
    render(
      <LiveEditor
        exercise={{ ...FLEXBOX, warnings: ["No HTML file was supplied, so /index.html was generated."] }}
      />,
    );
    expect(screen.getByTestId("exercise-diagnostics")).toHaveTextContent(/was generated/);
  });

  it("announces changes politely rather than interrupting", () => {
    render(<LiveEditor exercise={FLEXBOX} />);
    expect(screen.getByTestId("exercise-diagnostics")).toHaveAttribute("aria-live", "polite");
  });
});

describe("ExercisePanel — malformed resources must not crash the page", () => {
  it("renders the editor for a usable exercise", () => {
    render(<ExercisePanel entry={{ ok: true, exercise: FLEXBOX }} />);
    expect(screen.getByTestId("exercise-panel")).toBeInTheDocument();
    expect(screen.getByTestId("live-editor")).toBeInTheDocument();
  });

  it("renders a readable explanation for a malformed one", () => {
    const entries = parseSandpackResources(5, [
      { title: "Broken exercise", type: "sandpack", starterCode: {} },
    ]);
    render(<ExercisePanel entry={entries[0]} />);
    expect(screen.getByTestId("exercise-problem")).toBeInTheDocument();
    expect(screen.getByText(/starter code is empty/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is wrong with your work/i)).toBeInTheDocument();
    expect(screen.queryByTestId("live-editor")).not.toBeInTheDocument();
  });

  it("renders good and broken exercises side by side from one lecture", () => {
    const entries = parseSandpackResources(5, [
      { title: "Read me", type: "link", url: "https://www.w3schools.com/html/html_intro.asp" },
      { title: "Broken", type: "sandpack", starterCode: null },
      { title: "Works", type: "sandpack", starterCode: { "/index.html": "<h1>hi</h1>" } },
    ]);
    render(<ExerciseList entries={entries} />);
    expect(screen.getAllByTestId("exercise-problem")).toHaveLength(1);
    expect(screen.getAllByTestId("exercise-panel")).toHaveLength(1);
    // The W3Schools link belongs to course-content; this stream must not render it.
    expect(screen.queryByText(/Read me/)).not.toBeInTheDocument();
  });
});
