// =============================================================================
// LiveEditor — THE TAB-STATE REGRESSION, reproduced in a test that can fail.
// Owner: interactive-exercises stream.
// -----------------------------------------------------------------------------
// WHY A SECOND TEST FILE RATHER THAN MORE CASES IN LiveEditor.test.tsx.
// That file's Sandpack mock is a prop RECORDER: SandpackProvider assigns its props
// to a module-level object and renders its children. It cannot express the bug
// under test, because the bug is a STATE TRANSITION inside Sandpack — a recorder
// has no state to lose. Two mocks with opposite jobs cannot share one module
// factory, so they get one file each.
//
// WHAT THE MOCK HERE DOES INSTEAD: it re-implements the ~15 lines of Sandpack that
// cause the reported symptom, from node_modules/@codesandbox/sandpack-react/dist/
// index.mjs, so the assertions are about the student's visible experience (which
// tab is open, whether the typed text is still there) and not about object
// identity:
//
//   index.mjs:2078-2089  `useFiles(props)` holds the file map in useState and runs
//                        `setState(getSandpackStateFromProps(props))` from an
//                        effect whose deps are `[props.files, props.customSetup,
//                        props.template]` — compared BY REFERENCE, guarded by an
//                        isMountedRef so it is skipped on the first render only.
//   index.mjs:1365-1378  `getSandpackStateFromProps` rebuilds `files` from
//                        `props.files` (discarding every edit) and recomputes
//                        `activeFile` from `props.options.activeFile`.
//
// And src/lib/exercises/parse.ts pins `options.activeFile` to /index.html whenever
// an HTML file exists. Compose the three and you have the product owner's report
// verbatim: "when we click to open js code, it opens and then switches back to
// html page, and does not keep the changes."
//
// THE TRIGGER, which is the part the e2e suite could not supply. Sandpack resets
// when the `files` PROP CHANGES IDENTITY while the editor stays mounted. That
// needs a parent that (a) re-renders and (b) mints a fresh exercise object when it
// does. Every page hosting the editor today is a server component, so no such
// parent exists in the app and the three tab-state Playwright specs pass with or
// without the fix (see the TODO block in
// tests/e2e/interactive-exercises/practice.spec.ts). `StatefulHost` below IS that
// parent, written to match what the real producers do — the lecture page calls
// parseSandpackResources inline in JSX, the concept page passes an inline
// `{ ok: true, exercise }` literal, registry.ts re-runs normaliseStarterCode — all
// of which return a NEW object with identical CONTENT on every call.
//
// PROVEN TO FAIL WITHOUT THE FIX. Reverting LiveEditor.tsx's `initial` memo to the
// original `files={exercise.files}` and deleting the React.memo wrapper, then
// running `npx vitest run src/components/exercises/LiveEditor.tabstate.test.tsx`:
//   x survives a parent re-render that mints a fresh exercise object
//       expected "/app.js" to be the active tab, got "/index.html"
//   x does not re-enter the editor at all when the parent re-renders
//       expected 1 provider render, got 2
//   ✓ MarkupWorkbench — a hint reveal ... (passes either way; see its own note)
// Restored, all four pass. Recorded here because a guard whose failure mode has
// never been observed is indistinguishable from a guard that cannot fail.
// =============================================================================

import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SandpackExercise } from "@/lib/exercises";
import type { StudentProblem } from "@/lib/problems";

// ---------------------------------------------------------------------------
// The emulator
// ---------------------------------------------------------------------------

const emu = vi.hoisted(() => ({
  /** How many times SandpackProvider's function body ran. */
  providerRenders: 0,
  /** How many times the by-reference `files` effect rebuilt state after mount. */
  resets: 0,
}));

vi.mock("@codesandbox/sandpack-react", async () => {
  const React = await import("react");

  interface EmuState {
    files: Record<string, { code: string }>;
    activeFile: string;
  }
  interface EmuProps {
    files?: Record<string, string>;
    template?: string;
    customSetup?: unknown;
    options?: { visibleFiles?: string[]; activeFile?: string };
  }

  // index.mjs:1365 — files come from the PROP, activeFile from options. Both are
  // recomputed from scratch, which is precisely why edits and the open tab are
  // lost rather than merged.
  function getStateFromProps(props: EmuProps): EmuState {
    const files: Record<string, { code: string }> = {};
    for (const [path, code] of Object.entries(props.files ?? {})) {
      files[path] = { code: typeof code === "string" ? code : String(code) };
    }
    return {
      files,
      activeFile: props.options?.activeFile ?? Object.keys(files)[0] ?? "",
    };
  }

  const Ctx = React.createContext<{ sandpack: unknown } | null>(null);

  function SandpackProvider({
    children,
    ...props
  }: EmuProps & { children?: React.ReactNode }) {
    emu.providerRenders += 1;
    const [state, setState] = React.useState<EmuState>(() => getStateFromProps(props));
    const isMountedRef = React.useRef(false);

    // index.mjs:2082-2089, transcribed. The deps are the three props by
    // reference; `isMountedRef` is what makes the first render exempt.
    React.useEffect(() => {
      if (isMountedRef.current) {
        emu.resets += 1;
        setState(getStateFromProps(props));
      } else {
        isMountedRef.current = true;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.files, props.customSetup, props.template]);

    const value = React.useMemo(
      () => ({
        sandpack: {
          files: state.files,
          activeFile: state.activeFile,
          error: null,
          visibleFiles: props.options?.visibleFiles ?? Object.keys(state.files),
          setActiveFile: (path: string) => setState((s) => ({ ...s, activeFile: path })),
          updateCurrentFile: (code: string) =>
            setState((s) => ({ ...s, files: { ...s.files, [s.activeFile]: { code } } })),
          resetAllFiles: () => setState(getStateFromProps(props)),
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [state, props.options?.visibleFiles],
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  interface EmuSandpack {
    files: Record<string, { code: string }>;
    activeFile: string;
    visibleFiles: string[];
    setActiveFile: (path: string) => void;
    updateCurrentFile: (code: string) => void;
  }

  const useSandpack = () => React.useContext(Ctx) as { sandpack: EmuSandpack };

  // A tab strip and one editable pane, standing in for CodeMirror. `data-active`
  // mirrors the attribute the Playwright specs assert on `.sp-tab-button`, so the
  // two suites describe the same thing in the same vocabulary.
  function SandpackCodeEditor() {
    const { sandpack } = useSandpack();
    return (
      <div data-testid="sandpack-editor">
        {sandpack.visibleFiles.map((path) => (
          <button
            key={path}
            data-testid="sp-tab"
            data-path={path}
            data-active={String(path === sandpack.activeFile)}
            onClick={() => sandpack.setActiveFile(path)}
          >
            {path}
          </button>
        ))}
        <textarea
          data-testid="sp-code"
          aria-label="code"
          value={sandpack.files[sandpack.activeFile]?.code ?? ""}
          onChange={(event) => sandpack.updateCurrentFile(event.target.value)}
        />
      </div>
    );
  }

  return {
    SandpackProvider,
    SandpackLayout: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SandpackCodeEditor,
    SandpackPreview: () => <div data-testid="sandpack-preview" />,
    useSandpack,
  };
});

import { LiveEditor } from "./LiveEditor";
import { MarkupWorkbench } from "@/components/problems/MarkupWorkbench";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Three files, the middle one JavaScript, and `activeFile` pinned to /index.html
 * exactly as parse.ts pins it. The pin is half the bug: without it a reset would
 * merely lose the edits and stay on the same tab.
 */
const COUNTER: SandpackExercise = {
  id: "7-0",
  title: "Practice: an increment button",
  lectureId: 7,
  files: {
    "/index.html":
      '<html><body><button id="up">+1</button><script src="app.js"></script></body></html>',
    "/app.js": "document.getElementById('up').addEventListener('click', () => {});",
    "/styles.css": "button { padding: 8px; }",
  },
  visibleFiles: ["/index.html", "/app.js", "/styles.css"],
  activeFile: "/index.html",
  warnings: [],
};

const JS_TAB = "/app.js";
const STUDENT_EDIT = "let count = 0; // my working";

/**
 * A parent that re-renders AND rebuilds the exercise, which is the combination the
 * hazard needs. Content-identical on every render, only the object identity
 * differs — that is what makes this a test of Sandpack's by-reference dep rather
 * than a test of content equality.
 */
function StatefulHost({ exercise }: { exercise: SandpackExercise }) {
  const [nonce, setNonce] = React.useState(0);
  const fresh: SandpackExercise = {
    ...exercise,
    files: { ...exercise.files },
    visibleFiles: [...exercise.visibleFiles],
  };
  return (
    <div>
      <button data-testid="host-rerender" onClick={() => setNonce((n) => n + 1)}>
        re-render {nonce}
      </button>
      <LiveEditor exercise={fresh} />
    </div>
  );
}

/** Open the JS tab and type into it, as the owner's report describes. */
function openJsTabAndType() {
  const jsTab = screen
    .getAllByTestId("sp-tab")
    .find((tab) => tab.getAttribute("data-path") === JS_TAB);
  if (!jsTab) throw new Error(`fixture is wrong: no ${JS_TAB} tab`);
  fireEvent.click(jsTab);
  expect(jsTab).toHaveAttribute("data-active", "true");

  const code = screen.getByTestId("sp-code");
  fireEvent.change(code, { target: { value: STUDENT_EDIT } });
  expect(code).toHaveValue(STUDENT_EDIT);
}

function activeTabPath(): string | null {
  const active = screen
    .getAllByTestId("sp-tab")
    .find((tab) => tab.getAttribute("data-active") === "true");
  return active?.getAttribute("data-path") ?? null;
}

beforeEach(() => {
  emu.providerRenders = 0;
  emu.resets = 0;
  // Drafts are per-origin in jsdom and outlive a test. A draft left by one case
  // seeds the next editor's `files`, which would make a later case pass for the
  // wrong reason.
  localStorage.clear();
});

afterEach(cleanup);

describe("LiveEditor — the reported bug: the JS tab snaps back to HTML", () => {
  it("keeps the open tab and the typed code when the parent re-renders", () => {
    render(<StatefulHost exercise={COUNTER} />);
    openJsTabAndType();

    // The trigger. In the app this would be any state change in a client parent —
    // MarkupWorkbench's Check button, a hint reveal, an arriving grade.
    fireEvent.click(screen.getByTestId("host-rerender"));

    expect(
      activeTabPath(),
      "the JS tab must stay open — snapping back to /index.html IS the reported bug",
    ).toBe(JS_TAB);
    expect(
      screen.getByTestId("sp-code"),
      "the edit must survive; losing it is the second half of the report",
    ).toHaveValue(STUDENT_EDIT);
    // The mechanism, asserted directly as well as through its symptom: a stable
    // `files` reference means Sandpack's effect never refires.
    expect(emu.resets, "Sandpack must not have rebuilt its state from the prop").toBe(0);
  });

  it("survives ten parent re-renders, not just the first", () => {
    // A single re-render can be survived by accident — e.g. if React batched the
    // state update away. Ten cannot.
    render(<StatefulHost exercise={COUNTER} />);
    openJsTabAndType();

    for (let i = 0; i < 10; i += 1) {
      fireEvent.click(screen.getByTestId("host-rerender"));
    }

    expect(activeTabPath()).toBe(JS_TAB);
    expect(screen.getByTestId("sp-code")).toHaveValue(STUDENT_EDIT);
    expect(emu.resets).toBe(0);
  });

  it("does not re-enter the editor at all when the parent re-renders", () => {
    // The React.memo half of the fix, which the two cases above cannot detect:
    // the `initial` memo alone already keeps the `files` reference stable, so
    // correctness survives without React.memo and only the wasted work remains.
    // Counting provider renders is what makes that half falsifiable.
    render(<StatefulHost exercise={COUNTER} />);
    const rendersAfterMount = emu.providerRenders;

    fireEvent.click(screen.getByTestId("host-rerender"));

    expect(
      emu.providerRenders,
      "React.memo on the exercise id must absorb a parent re-render entirely",
    ).toBe(rendersAfterMount);
  });

  it("still rebuilds when the exercise genuinely changes", () => {
    // The fix must not be a blanket freeze. A DIFFERENT exercise — a different
    // `id` — has to reach the editor, or navigating between two exercises would
    // show the first one's code under the second one's title.
    const { rerender } = render(<LiveEditor exercise={COUNTER} />);
    openJsTabAndType();

    const other: SandpackExercise = {
      ...COUNTER,
      id: "7-1",
      files: { "/index.html": "<h1>a different exercise</h1>" },
      visibleFiles: ["/index.html"],
      activeFile: "/index.html",
    };
    rerender(<LiveEditor exercise={other} />);

    expect(activeTabPath()).toBe("/index.html");
    expect(screen.getByTestId("sp-code")).toHaveValue("<h1>a different exercise</h1>");
  });
});

// ---------------------------------------------------------------------------
// The lead that was worth checking and did not pan out
// ---------------------------------------------------------------------------

const HTML_PROBLEM: StudentProblem = {
  slug: "html-increment-button",
  title: "Wire up an increment button",
  statement: "The markup is written. Correct the JavaScript.",
  track: "html",
  level: "beginner",
  bank: "practice",
  language: "html",
  execution: "browser",
  timeLimitMs: 5_000,
  starterCode:
    '<!-- file: /index.html -->\n<button id="up">+1</button>\n<script src="app.js"></script>\n' +
    "/* file: /app.js */\nlet count = 0;\n",
  hints: ["addEventListener takes the event name first."],
  tags: ["dom"],
  visibleTests: [
    {
      id: 1,
      name: "the button exists",
      input: null,
      expectedOutput: "tag button",
      orderIndex: 0,
    },
  ],
  hiddenTestCount: 1,
  solved: false,
  attempts: [],
  serverGradingAvailable: true,
};

describe("MarkupWorkbench — the /problems client host, which turned out to be safe", () => {
  /**
   * THE LEAD: MarkupWorkbench is the first CLIENT component in the app to host
   * LiveEditor (/problems/[slug] and /interview/[slug]), it holds five pieces of
   * state, and a client component that re-renders and rebuilds the exercise is
   * exactly the trigger the hazard needs. It looked like the reported bug on a
   * real page.
   *
   * IT IS NOT, and the reason is one line: MarkupWorkbench.tsx:114-144 builds the
   * exercise inside `React.useMemo` keyed on `[problem.starterCode, problem.slug,
   * problem.title, language]` — four primitives, all stable for the lifetime of
   * the page — so its own re-renders hand LiveEditor the SAME object. The
   * protection is therefore doubled: MarkupWorkbench keeps the object stable, and
   * LiveEditor's `initial` memo keeps `files` stable even for a caller that does
   * not. Reverting LiveEditor.tsx alone leaves these two cases green.
   *
   * They are kept anyway, because they pin the half that lives in THIS stream's
   * blind spot: if someone drops MarkupWorkbench's useMemo — an easy, plausible
   * "simplification", since nothing else in that component needs it — these tests
   * are what says the tab-state hazard is back for real users. They are also the
   * only test anywhere that drives the real MarkupWorkbench with the real
   * LiveEditor rather than a mock of one of them.
   */
  it("keeps the JS tab and the edit when a hint is revealed", () => {
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);
    openJsTabAndType();

    fireEvent.click(screen.getByTestId("problem-hint-reveal"));
    expect(screen.getByTestId("problem-hint")).toBeInTheDocument();

    expect(activeTabPath(), "revealing a hint must not close the student's tab").toBe(JS_TAB);
    expect(screen.getByTestId("sp-code")).toHaveValue(STUDENT_EDIT);
    expect(emu.resets).toBe(0);
  });

  it("keeps the JS tab and the edit when Check runs and renders results", () => {
    // Check is the heavier trigger: it sets two pieces of state and mounts a whole
    // results Card below the editor.
    render(<MarkupWorkbench problem={HTML_PROBLEM} />);
    openJsTabAndType();

    fireEvent.click(screen.getByTestId("problem-check"));
    expect(screen.getByTestId("problem-check-results")).toBeInTheDocument();

    expect(activeTabPath(), "running Check must not close the student's tab").toBe(JS_TAB);
    expect(screen.getByTestId("sp-code")).toHaveValue(STUDENT_EDIT);
    expect(emu.resets).toBe(0);
  });
});
