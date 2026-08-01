"use client";

// =============================================================================
// LIVE EDITOR — Sandpack wrapper for HTML/CSS/JS practice
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// WHY SANDPACK AT ALL
// W3Schools' "Try it Yourself" sends X-Frame-Options and therefore cannot be
// iframed (docs/DECISIONS.md). course-content links OUT to W3Schools; this file is
// the in-app equivalent, so a student can practise without leaving the LMS.
//
// WHY template="static", NOT "vanilla"
// The `vanilla` template runs the Sandpack bundler over an /index.js entry with a
// package.json. That is wrong for this curriculum twice over: the seeded
// exercises are plain `/index.html` + `/styles.css` + `/app.js` files that
// reference each other with `<link href>` and `<script src>` — exactly the raw
// mechanics week 1-3 is teaching — and bundling them would both break those
// relative references and hide the fact that a browser needs no build step. The
// `static` template serves the files as a browser would.
//
// The cost of `static`, stated plainly: there is no compile step, so there is no
// bundler error to report. A missing brace or a mistyped `src` yields a blank or
// unstyled frame and silence. We buy that visibility back with our own linter
// (src/lib/exercises/diagnostics.ts) rendered under the editor, plus Sandpack's
// own runtime error overlay for uncaught JS exceptions. A beginner never sees an
// empty box with no explanation.
// =============================================================================

import * as React from "react";
import {
  SandpackCodeEditor,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";

import { Button, cn } from "@/components/ui";
import { diagnoseFiles } from "@/lib/exercises";
import type { Diagnostic, SandpackExercise } from "@/lib/exercises";
import {
  clearDraft,
  fingerprintFiles,
  loadDraft,
  saveDraft,
} from "@/lib/exercises/persistence";
import { PREVIEW_DEBOUNCE_MS } from "@/lib/exercises/reduced-motion";

/** How long the reset button stays armed before it disarms itself, in ms. */
export const RESET_ARM_TIMEOUT_MS = 5_000;

/** Default editor/preview height, in CSS pixels. */
const DEFAULT_HEIGHT_PX = 380;

/**
 * How long to wait after the last keystroke before writing a draft, in ms.
 *
 * Matched to the preview debounce so a save and a recompile settle together
 * rather than interleaving two timers over the same edit.
 */
const DRAFT_SAVE_DEBOUNCE_MS = PREVIEW_DEBOUNCE_MS;

export interface LiveEditorProps {
  exercise: SandpackExercise;
  /** Editor and preview height in CSS pixels. */
  heightPx?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Reset to starter
// ---------------------------------------------------------------------------

/**
 * Two-step reset. `sandpack.resetAllFiles()` restores the `files` prop — i.e. the
 * seeded starter code — and cannot be undone, so a single misplaced click would
 * destroy a student's work. A `window.confirm` would do the job but is a modal
 * the page cannot style, announce, or test; arming the button in place keeps the
 * whole interaction inside one focusable control.
 */
function ResetToStarterButton({
  onReset,
  buttonRef,
}: {
  onReset: () => void;
  buttonRef: React.Ref<HTMLButtonElement>;
}) {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), RESET_ARM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      ref={buttonRef}
      variant={armed ? "danger" : "secondary"}
      size="sm"
      data-testid="exercise-reset"
      aria-label={
        armed
          ? "Confirm reset: discard my edits and restore the starter code"
          : "Reset this exercise to its starter code"
      }
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        // NOT `sandpack.resetAllFiles()`. That restores the `files` PROP, and
        // this editor now seeds that prop from the saved draft — so calling it
        // would "reset" the exercise to the student's own edits and appear to do
        // nothing at all. The parent instead clears the draft and remounts the
        // provider, which reads the starter because there is no longer a draft.
        onReset();
        setArmed(false);
      }}
    >
      {armed ? "Confirm reset — discards your edits" : "Reset to starter code"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics panel
// ---------------------------------------------------------------------------

const SEVERITY_CLASSES: Record<Diagnostic["severity"], string> = {
  error: "text-red-700",
  warning: "text-ink-muted",
};

/**
 * What is wrong with the code, in words. Reads the LIVE file contents out of the
 * Sandpack context, so it updates as the student types — the same trigger that
 * refreshes the preview.
 */
function EditorDiagnostics({ warnings }: { warnings: string[] }) {
  const { sandpack } = useSandpack();

  const plainFiles = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const [path, file] of Object.entries(sandpack.files)) {
      if (typeof file?.code === "string") out[path] = file.code;
    }
    return out;
  }, [sandpack.files]);

  const diagnostics = React.useMemo<Diagnostic[]>(() => {
    const fromFiles = diagnoseFiles(plainFiles);
    const fromResource: Diagnostic[] = warnings.map((message) => ({
      file: null,
      severity: "warning",
      message,
    }));
    return [...fromFiles, ...fromResource];
  }, [plainFiles, warnings]);

  const runtimeError = sandpack.error?.message ?? null;

  return (
    <div
      data-testid="exercise-diagnostics"
      role="status"
      aria-live="polite"
      className="border-t border-line px-3 py-2 text-xs"
    >
      {runtimeError && (
        <p data-testid="exercise-runtime-error" className="mb-1 font-medium text-red-700">
          The preview threw an error: {runtimeError}
        </p>
      )}

      {diagnostics.length === 0 && !runtimeError ? (
        <p className="text-ink-muted">
          No syntax problems detected. The preview updates as you type.
        </p>
      ) : (
        <ul className="space-y-1">
          {diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.file ?? "sandbox"}-${index}`}
              className={cn(SEVERITY_CLASSES[diagnostic.severity])}
            >
              <span className="sr-only">{diagnostic.severity}: </span>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft persistence bridge
// ---------------------------------------------------------------------------

/**
 * Writes the student's edits and current tab to localStorage, debounced.
 *
 * Renders nothing. It must live INSIDE `SandpackProvider` because `useSandpack`
 * is the only way to read live file contents and the active tab — Sandpack keeps
 * both in its own context and exposes no callback prop for them.
 *
 * The save is debounced rather than per-keystroke: writing on every character
 * would serialise the whole file map on each one, and localStorage writes are
 * synchronous and block the main thread — i.e. it would stutter the typing it
 * exists to protect.
 */
function DraftPersistence({
  exerciseId,
  starterFingerprint,
}: {
  exerciseId: string;
  starterFingerprint: string;
}) {
  const { sandpack } = useSandpack();
  const { files, activeFile } = sandpack;

  React.useEffect(() => {
    const timer = setTimeout(() => {
      const plain: Record<string, string> = {};
      for (const [path, file] of Object.entries(files)) {
        if (typeof file?.code === "string") plain[path] = file.code;
      }
      saveDraft(exerciseId, { files: plain, activeFile, starterFingerprint });
    }, DRAFT_SAVE_DEBOUNCE_MS);

    // Cancelling on every change is what makes this a debounce; it also means an
    // unmount mid-debounce drops that last edit. Accepted: the alternative is a
    // synchronous write in a cleanup that runs during navigation, and losing at
    // most the final few hundred milliseconds of typing is the smaller cost.
    return () => clearTimeout(timer);
  }, [files, activeFile, exerciseId, starterFingerprint]);

  return null;
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

function LiveEditorImpl({ exercise, heightPx = DEFAULT_HEIGHT_PX, className }: LiveEditorProps) {
  const height = `${heightPx}px`;

  // Bumped by the reset button to force a remount. This is the ONLY thing that
  // legitimately re-reads the starter, so it is also the only thing allowed to
  // change the provider's identity.
  const [resetNonce, setResetNonce] = React.useState(0);

  const starterFingerprint = React.useMemo(
    () => fingerprintFiles(exercise.files),
    [exercise.files],
  );

  // -------------------------------------------------------------------------
  // THE FIX FOR "the tab switches back to HTML and loses my changes".
  //
  // Sandpack's `useFiles` effect is keyed on `props.files` BY REFERENCE
  // (node_modules/@codesandbox/sandpack-react/dist/index.mjs, deps
  // `[props.files, props.customSetup, props.template]`). When that identity
  // changes it runs `setState(getSandpackStateFromProps(props))`, which rebuilds
  // the file map from the prop — discarding every edit — and recomputes
  // `activeFile` from `options.activeFile`, which src/lib/exercises/parse.ts
  // pins to /index.html whenever an HTML file exists. That is precisely the
  // reported symptom: open the JS tab, something re-renders, and it snaps back
  // to HTML with the edits gone.
  //
  // Previously `files={exercise.files}` was passed straight through and every
  // producer minted a fresh object per render (parseSandpackResources called
  // inline in JSX on the lecture page, an inline entry literal on the concept
  // page, registry.ts re-running normaliseStarterCode). So the editor's state
  // survived only as long as nothing above it ever re-rendered.
  //
  // Memoising on `exercise.id` + `resetNonce` — NOT on the object — gives
  // Sandpack one stable reference for the lifetime of the exercise, so its
  // internal state is never reset and the active tab persists on its own. No
  // controlled `activeFile` is needed, and adding one would fight the library.
  //
  // RESOLVED 2026-07-31 — the TODO that stood here is discharged, and this is
  // what replaced it. The warning was that this fix had no failing test: the
  // three tab-state Playwright specs pass with or without it, because a browser
  // test can only trigger the hazard through a page, and every page hosting the
  // editor is a server component. That was a limit of the HARNESS, not evidence
  // the hazard was theoretical.
  //
  // src/components/exercises/LiveEditor.tabstate.test.tsx now supplies the
  // trigger directly. It mocks @codesandbox/sandpack-react with a faithful
  // transcription of the ~15 lines above (index.mjs:1365 and :2078) rather than a
  // prop recorder, and mounts this editor under a client parent that re-renders
  // and mints a fresh, content-identical exercise object — what every real
  // producer does. Reverting the two memos below and re-running it:
  //
  //   x keeps the open tab and the typed code when the parent re-renders
  //       expected '/index.html' to be '/app.js'
  //   x survives ten parent re-renders, not just the first        (same)
  //   x does not re-enter the editor at all when the parent re-renders
  //       expected 3 provider renders to be 1
  //
  // That first message IS the owner's report — "it opens and then switches back
  // to html page" — so the mechanism described above is confirmed, not inferred.
  //
  // WHICH HALF IS LOAD-BEARING, measured the same way. The `initial` memo alone
  // is sufficient for CORRECTNESS: its deps are the exercise identity and the
  // fingerprint STRING, so a fresh object with unchanged content recomputes
  // nothing and `files` keeps one reference. The React.memo wrapper is a
  // performance guard on top, and the third case above is the only thing that can
  // detect its removal. Do not delete either on the grounds that the other covers
  // it.
  //
  // STILL OPEN, and narrower than before: no page in the app can trigger this
  // today (the /problems host was checked and is safe — see that test file's
  // second describe block and the note at MarkupWorkbench.tsx:114). So the fix is
  // a guard against a hazard whose in-app trigger has yet to be built, and the
  // owner's report remains unexplained AT /practice. See the note in
  // tests/e2e/interactive-exercises/practice.spec.ts for what was ruled out.
  // -------------------------------------------------------------------------
  const initial = React.useMemo(() => {
    const draft = loadDraft(exercise.id, starterFingerprint);
    return {
      files: draft?.files ?? exercise.files,
      // Restore the tab the student was last on, but only if it still exists —
      // a draft naming a file the starter no longer has would leave Sandpack
      // pointing at nothing.
      activeFile:
        draft && exercise.visibleFiles.includes(draft.activeFile)
          ? draft.activeFile
          : exercise.activeFile,
      restored: draft != null,
    };
    // Deps are deliberately the exercise IDENTITY, not the objects it holds.
    // exhaustive-deps wants exercise.files/visibleFiles/activeFile here, and
    // adding them would recompute this on every render — which is the exact bug
    // being fixed, since every producer builds those objects fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id, starterFingerprint, resetNonce]);

  const options = React.useMemo(
    () => ({
      visibleFiles: exercise.visibleFiles,
      activeFile: initial.activeFile,
      // Live preview with no run button: every keystroke schedules a reload,
      // debounced so a fast typist does not reload on each character.
      autorun: true,
      autoReload: true,
      recompileMode: "delayed" as const,
      recompileDelay: PREVIEW_DEBOUNCE_MS,
      // "lazy", NOT "user-visible". Both defer mounting until the exercise
      // scrolls into view, which is what a lecture page carrying several iframes
      // needs. But "user-visible" ALSO calls unregisterAllClients() when the
      // exercise scrolls back OUT of view (index.mjs ~1779), tearing down the
      // preview of an exercise the student is still working on — scroll down to
      // read the notes, scroll back, and the preview is blank until it re-inits.
      initMode: "lazy" as const,
    }),
    // Same reasoning as `initial`: stable per exercise, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.id, initial.activeFile],
  );

  // Reset works by remounting the provider, and the reset button lives inside it
  // — so the very element the student just activated is destroyed and rebuilt.
  // For a mouse user that is invisible; for a keyboard user focus falls to
  // <body>, and the next Tab restarts from the top of the document. Putting focus
  // back on the rebuilt button keeps the interaction where they left it.
  const resetButtonRef = React.useRef<HTMLButtonElement>(null);
  const refocusAfterResetRef = React.useRef(false);

  const handleReset = React.useCallback(() => {
    // Recorded BEFORE the remount, while the old button is still focused. Only
    // restore focus if the button actually had it — calling focus() after a mouse
    // click would raise a focus ring the student did not ask for.
    refocusAfterResetRef.current =
      typeof document !== "undefined" && document.activeElement === resetButtonRef.current;
    clearDraft(exercise.id);
    setResetNonce((n) => n + 1);
  }, [exercise.id]);

  React.useEffect(() => {
    if (resetNonce === 0 || !refocusAfterResetRef.current) return;
    refocusAfterResetRef.current = false;
    // The ref is reattached during the commit that recreates the button, so by
    // the time this effect runs it already points at the new node.
    resetButtonRef.current?.focus();
  }, [resetNonce]);

  return (
    <SandpackProvider
      // Changes ONLY on an explicit reset. A key that changed per render would
      // reintroduce exactly the remount this component exists to prevent.
      key={`${exercise.id}:${resetNonce}`}
      template="static"
      files={initial.files}
      theme="light"
      options={options}
    >
      <div
        className={cn("overflow-hidden rounded-md border border-line bg-panel", className)}
        data-testid="live-editor"
        data-exercise-id={exercise.id}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <p className="text-xs text-ink-muted">
            Editing {exercise.visibleFiles.length}{" "}
            {exercise.visibleFiles.length === 1 ? "file" : "files"}. Changes preview
            automatically and are saved in this browser.
          </p>
          <ResetToStarterButton onReset={handleReset} buttonRef={resetButtonRef} />
        </div>

        {initial.restored && (
          // Told, not silent. A student returning to find their own edits rather
          // than the starter should know why, and know that reset is the way
          // back — otherwise a half-finished attempt looks like broken content.
          <p
            data-testid="exercise-draft-restored"
            role="status"
            className="border-b border-line bg-surface px-3 py-1.5 text-xs text-ink-muted"
          >
            Your earlier edits to this exercise were restored. Use “Reset to
            starter code” to begin again.
          </p>
        )}

        {/*
          Keyboard note, shown to everyone rather than hidden in an sr-only span:
          CodeMirror captures Tab to indent, which is correct inside an editor but
          traps focus for anyone navigating by keyboard. Escape releases it.
        */}
        <p className="px-3 pt-2 text-xs text-ink-muted">
          Inside the editor, Tab indents. Press{" "}
          <kbd className="rounded border border-line px-1">Esc</kbd> then{" "}
          <kbd className="rounded border border-line px-1">Tab</kbd> to move focus out.
        </p>

        <SandpackLayout>
          <SandpackCodeEditor
            showTabs
            showLineNumbers
            showInlineErrors
            wrapContent
            style={{ height }}
            aria-label={`Code editor: ${exercise.title}`}
          />
          <SandpackPreview
            showOpenInCodeSandbox={false}
            showRefreshButton
            showSandpackErrorOverlay
            style={{ height }}
            aria-label={`Live preview: ${exercise.title}`}
          />
        </SandpackLayout>

        <EditorDiagnostics warnings={exercise.warnings} />
        <DraftPersistence
          exerciseId={exercise.id}
          starterFingerprint={starterFingerprint}
        />
      </div>
    </SandpackProvider>
  );
}

/**
 * Memoised on the exercise IDENTITY, not the object.
 *
 * The second half of the fix. Stabilising `files` inside the component stops
 * Sandpack resetting, but every parent re-render would still re-run this
 * component and its hooks for no reason — and every producer of an
 * `SandpackExercise` builds a new object each time (see the note in
 * LiveEditorImpl). Comparing `exercise.id` means a re-render of the lecture page
 * cannot touch an editor the student is typing into.
 *
 * `id` is `${lectureId}-${resourceIndex}` (src/lib/exercises/types.ts) and is
 * stable for a given exercise, so this is a correct comparison rather than a
 * convenient one. `heightPx` and `className` are compared too, because those
 * genuinely should re-render.
 */
export const LiveEditor = React.memo(LiveEditorImpl, (prev, next) => {
  return (
    prev.exercise.id === next.exercise.id &&
    prev.heightPx === next.heightPx &&
    prev.className === next.className
  );
});

LiveEditor.displayName = "LiveEditor";

export default LiveEditor;
