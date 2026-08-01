"use client";

// =============================================================================
// MARKUP WORKBENCH — a real editor and a real submit for HTML and CSS problems.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// THE COMPLAINT THIS ANSWERS, verbatim: "Editor + submit for HTML/CSS problems —
// currently they get a worked answer and no editor at all."
//
// WHY THIS IS NOT A SECOND EDITOR.
// The interactive-exercises stream already ships a working Sandpack editor with a
// live preview at src/components/exercises/LiveEditor.tsx, and its header comment
// records two findings this component would otherwise have had to rediscover the
// hard way: `template="static"` rather than `vanilla` (the bundler would break the
// `<link href>`/`<script src>` mechanics these very problems are teaching), and the
// reason an in-app editor exists at all (W3Schools sends X-Frame-Options, so the
// "Try it Yourself" pages cannot be iframed — docs/DECISIONS.md). Rebuilding that
// would have meant maintaining two Sandpack configurations that must not drift.
// So this component OWNS NO EDITOR. It composes LiveEditor, and its own job is the
// three things LiveEditor does not do: turn one text column into a file map, show
// the requirements, and submit.
//
// HOW THE STUDENT'S FILES ARE READ BACK, AND THE ONE SEAM IT COSTS.
// LiveEditor exposes no `onChange`: Sandpack keeps the live file map in its own
// React context, reachable only from INSIDE `SandpackProvider` via `useSandpack`,
// and the provider is created inside LiveEditor. Adding a callback prop would mean
// editing another stream's component, which this wave's file ownership does not
// permit. What LiveEditor does do is persist every edit to localStorage through
// src/lib/exercises/persistence.ts (debounced by PREVIEW_DEBOUNCE_MS), keyed by
// `exercise.id` and fingerprinted against the starter. So Submit reads the draft
// back through that same module.
//
// The seam, stated rather than hidden:
//   * it couples this component to the interactive-exercises draft format. Both
//     halves are pure functions in one module and the fingerprint check makes a
//     mismatch fail CLOSED (loadDraft returns null), so the failure mode is "we
//     submitted the starter", not "we submitted garbage" — and the guard below
//     turns that into a message rather than a silent zero.
//   * if localStorage is unavailable (private mode, a full quota) there is no draft
//     to read. Same guard, same message.
//   * an edit made in the last few hundred milliseconds before the click may not be
//     written yet. A human moving from the keyboard to the Submit button takes
//     longer than the debounce, so this is a theoretical race rather than an
//     observed one — but it is a race, and it is why the guard exists at all.
// TODO(interactive-exercises): an `onFilesChange` prop on LiveEditor would delete
// this entire mechanism. Ask for one; do not add it from this stream.
//
// GRADING: see src/lib/problems/markup.ts. In short, a submission is checked
// against a list of structural requirements, not rendered and compared — and the
// limits of that choice are written down there, not glossed.
// =============================================================================

import * as React from "react";

import { LiveEditor } from "@/components/exercises/LiveEditor";
import { Badge, Button, Card } from "@/components/ui";
import { normaliseStarterCode, type SandpackExercise } from "@/lib/exercises";
import { fingerprintFiles, loadDraft } from "@/lib/exercises/persistence";
import {
  describeCheck,
  evaluateMarkupTest,
  joinMarkupBundle,
  parseMarkupAssertions,
  splitMarkupBundle,
  type CheckResult,
  type MarkupAssertion,
  type MarkupLanguage,
  type StudentProblem,
  type SubmitOutcome,
} from "@/lib/problems";

import { SubmitPanel } from "./SubmitPanel";

export interface MarkupWorkbenchProps {
  problem: StudentProblem;
}

/** Editor height in CSS pixels. Taller than the lecture-page default: a problem
 *  page has no surrounding prose competing for the viewport. */
const EDITOR_HEIGHT_PX = 460;

/**
 * Shown when the draft store had nothing for this problem. Module scope, not a
 * const inside the component: a string rebuilt every render would change the
 * identity of the `submit` callback on every render, which is the same class of
 * churn LiveEditor's own header describes fighting with Sandpack's `files` prop.
 */
const NO_DRAFT_MESSAGE =
  "Your edits could not be read back from the editor. Make a change (or wait a moment " +
  "after typing) and submit again. If this keeps happening, your browser may be " +
  "blocking local storage, which is where the editor keeps your work.";

/** One visible test's locally checked outcome. Advisory; nothing is recorded. */
interface LocalCheck {
  name: string;
  passed: boolean;
  results: CheckResult[];
}

export function MarkupWorkbench({ problem }: MarkupWorkbenchProps) {
  const language = problem.language.trim().toLowerCase() as MarkupLanguage;

  // -------------------------------------------------------------------------
  // The starter, as files.
  //
  // Two steps, and both are reuse rather than new logic: `splitMarkupBundle`
  // turns the single `starter_code` column into a file map (see markup.ts on why
  // one column carries several files), and `normaliseStarterCode` — the
  // interactive-exercises parser — fixes up the paths, orders the tabs and, for a
  // CSS-only problem, SYNTHESISES the `/index.html` that gives the preview
  // something to show. Without that second step a CSS problem opens on a blank
  // white frame, which is worse than the reference-only page it replaces.
  //
  // DO NOT UNWRAP THIS useMemo, however cheap the two calls look. This is the
  // first CLIENT component in the app to host LiveEditor, and it holds five pieces
  // of state — so it re-renders while a student is typing. Sandpack's `useFiles`
  // effect is keyed on the `files` prop BY REFERENCE
  // (node_modules/@codesandbox/sandpack-react/dist/index.mjs:2089); handing it a
  // fresh object makes it rebuild from the prop, discarding the edits and snapping
  // the open tab back to /index.html. That is the product owner's "we click to
  // open js code, it opens and then switches back to html page" verbatim.
  //
  // Both `splitMarkupBundle` and `normaliseStarterCode` mint new objects per call,
  // so the deps are the four PRIMITIVES the result derives from — stable for the
  // lifetime of the page. LiveEditor memoises defensively too, and either guard
  // alone is enough (verified by removing them one at a time), which is exactly
  // why this one is easy to delete by accident. Pinned by the second describe
  // block in src/components/exercises/LiveEditor.tabstate.test.tsx, which drives
  // this component's real Check and hint buttons with the real editor.
  // -------------------------------------------------------------------------
  const exercise = React.useMemo<SandpackExercise>(() => {
    const files = splitMarkupBundle(problem.starterCode, language);
    const normalised = normaliseStarterCode(files);
    const value = normalised.ok
      ? normalised.value
      : // Cannot happen for a validated seed row (validate.ts refuses an empty
        // starterCode on an executable problem), but this is a client component
        // rendering database content: degrade to the raw text on one tab rather
        // than throwing inside the render.
        {
          files: { [`/index.${language === "css" ? "css" : "html"}`]: problem.starterCode },
          visibleFiles: [`/index.${language === "css" ? "css" : "html"}`],
          activeFile: `/index.${language === "css" ? "css" : "html"}`,
          warnings: [normalised.ok ? "" : normalised.reason].filter(Boolean),
        };

    return {
      // Namespaced by slug so a problem's draft can never collide with a lecture
      // exercise's (`${lectureId}-${index}`) in the shared localStorage keyspace.
      id: `problem:${problem.slug}`,
      title: problem.title,
      // `lectureId` is part of the exercise contract and is not read by LiveEditor;
      // a problem has no lecture, and 0 is the honest "not applicable" rather than
      // a lecture id that would point at real content.
      lectureId: 0,
      files: value.files,
      visibleFiles: value.visibleFiles,
      activeFile: value.activeFile,
      warnings: value.warnings,
    };
  }, [problem.starterCode, problem.slug, problem.title, language]);

  const starterFingerprint = React.useMemo(
    () => fingerprintFiles(exercise.files),
    [exercise.files],
  );

  // The VISIBLE requirements. These are not a leak — they restate the problem, and
  // the hidden ones never leave the server (src/lib/problems/payload.ts).
  const visibleRequirements = React.useMemo(
    () =>
      problem.visibleTests.map((test) => ({
        id: test.id,
        name: test.name,
        assertions: parseMarkupAssertions(test.expectedOutput),
      })),
    [problem.visibleTests],
  );

  const [localChecks, setLocalChecks] = React.useState<LocalCheck[] | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [outcome, setOutcome] = React.useState<SubmitOutcome | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [revealedHints, setRevealedHints] = React.useState(0);

  const mounted = React.useRef(true);
  React.useEffect(() => () => {
    mounted.current = false;
  }, []);

  /**
   * The student's current files, or null when they could not be read.
   *
   * NULL IS NOT "no changes". It means the draft store had nothing for this
   * problem, which is either "they have not typed anything yet" or "persistence is
   * unavailable" — and the two are indistinguishable from here. Both are reported
   * the same way, because in both cases submitting would grade the starter code
   * and hand back a failure the student cannot explain.
   */
  const currentFiles = React.useCallback((): Record<string, string> | null => {
    const draft = loadDraft(exercise.id, starterFingerprint);
    return draft ? draft.files : null;
  }, [exercise.id, starterFingerprint]);

  const check = React.useCallback(() => {
    setSubmitError(null);
    setOutcome(null);
    const files = currentFiles() ?? exercise.files;
    setLocalChecks(
      visibleRequirements.map((requirement) => {
        const result = evaluateMarkupTest(files, requirement.assertions);
        return { name: requirement.name, passed: result.passed, results: result.results };
      }),
    );
  }, [currentFiles, exercise.files, visibleRequirements]);

  const submit = React.useCallback(async () => {
    setSubmitError(null);
    setOutcome(null);

    const files = currentFiles();
    if (!files) {
      setSubmitError(NO_DRAFT_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/problems/${encodeURIComponent(problem.slug)}/attempt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Re-joined into the same bundle format the starter arrived in, so
        // `coding_attempts.code` round-trips: an instructor opening a stored
        // attempt sees the same file structure the student was editing.
        body: JSON.stringify({ code: joinMarkupBundle(files) }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !(body as { ok?: boolean }).ok) {
        setSubmitError(
          (body as { error?: string }).error ?? `The grader answered ${response.status}.`,
        );
      } else {
        setOutcome((body as { data: SubmitOutcome }).data);
      }
    } catch {
      setSubmitError("Could not reach the grader. Your work is still in the editor.");
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [currentFiles, problem.slug]);

  const totalRequirements = problem.visibleTests.length + problem.hiddenTestCount;

  /**
   * Is there anything to grade?
   *
   * FALSE for the markup problems that stayed `execution: "none"` — the ones whose
   * requirement is a judgement ("fix a heading order that lies") rather than a
   * structure a checker can look for. Those still get the editor and the live
   * preview, which is most of what was missing, and ProblemView still shows the
   * worked answer beneath. What they do NOT get is a Submit button, for the same
   * reason C++ loses one during an outage: a button that can only ever refuse is
   * worse than no button. See scripts/content/problems/html.ts for which problems
   * were converted and why the rest were not.
   */
  const gradeable = totalRequirements > 0;

  return (
    <div className="space-y-4" data-testid="problem-workbench">
      {/* ---- Hints, revealed one at a time ---------------------------------- */}
      {problem.hints.length > 0 ? (
        <Card
          title="Hints"
          subtitle={`${revealedHints} of ${problem.hints.length} shown`}
          data-testid="problem-hints"
        >
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">
            {problem.hints.slice(0, revealedHints).map((hint, index) => (
              <li key={index} data-testid="problem-hint">
                {hint}
              </li>
            ))}
          </ol>
          {revealedHints < problem.hints.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              data-testid="problem-hint-reveal"
              onClick={() => setRevealedHints((n) => n + 1)}
            >
              {revealedHints === 0 ? "Show a hint" : "Show another hint"}
            </Button>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">That is every hint for this problem.</p>
          )}
        </Card>
      ) : null}

      {/* ---- What will be checked ------------------------------------------- */}
      {gradeable ? (
      <Card
        title="What is checked"
        subtitle={
          problem.hiddenTestCount > 0
            ? `${problem.visibleTests.length} shown, ${problem.hiddenTestCount} more on submit`
            : "Every requirement is listed"
        }
        data-testid="problem-requirements"
      >
        <p className="mb-2 text-sm text-ink-muted">
          {/* Said out loud rather than left for the student to infer from a failure.
              A grader that checks structure and not appearance is a surprise worth
              spending two sentences on. */}
          Your markup is checked for the structures this problem asks for — elements,
          attributes, selectors and declarations. It is not compared with the reference
          answer, so any correct way of meeting these requirements passes.
        </p>
        {visibleRequirements.map((requirement) => (
          <div key={requirement.id} className="mt-3" data-testid="problem-requirement-group">
            <p className="text-sm font-medium text-ink">{requirement.name}</p>
            <ul className="mt-1 space-y-1 pl-5 text-sm text-ink-muted">
              {requirement.assertions.map((assertion, index) => (
                <li key={index} className="list-disc" data-testid="problem-requirement">
                  {describeAssertion(assertion)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {problem.hiddenTestCount > 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            {problem.hiddenTestCount} further requirement
            {problem.hiddenTestCount === 1 ? " is" : "s are"} checked on submit and not shown
            here — knowing the count tells you the list above is not the whole job, which is
            the part you need.
          </p>
        ) : null}
      </Card>
      ) : (
        <Card
          title="No automatic checking for this problem"
          data-testid="problem-reference-only"
          action={<Badge tone="neutral">Reference solution</Badge>}
        >
          <p className="text-sm text-ink-muted">
            What this problem asks for is a judgement rather than a structure a checker can
            look for, so there is nothing to submit. Write your version in the editor below —
            the preview updates as you type — and then compare it with the worked answer at
            the foot of the page.
          </p>
        </Card>
      )}

      {/* ---- The editor, borrowed whole from interactive-exercises ----------- */}
      <div data-testid="problem-markup-editor">
        <LiveEditor exercise={exercise} heightPx={EDITOR_HEIGHT_PX} />
      </div>

      {/* ---- Actions --------------------------------------------------------- */}
      {gradeable ? (
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            data-testid="problem-check"
            onClick={check}
            disabled={submitting || visibleRequirements.length === 0}
          >
            Check the {visibleRequirements.length} shown requirement
            {visibleRequirements.length === 1 ? "" : "s"}
          </Button>
          <Button
            data-testid="problem-submit"
            onClick={submit}
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? "Checking…" : `Submit for all ${totalRequirements} requirements`}
          </Button>
        </div>
        <p className="text-xs text-ink-muted">
          {/* The same Run/Submit distinction the executed problems make, in the
              vocabulary of this one. Conflating them is how a student comes to
              believe that satisfying the visible list is finishing. */}
          Check runs in your browser against the requirements above and records nothing.
          Submit checks all {totalRequirements} on the server, and only a submit can mark the
          problem solved. Use “Reset to starter code” in the editor to start again.
        </p>
      </Card>
      ) : null}

      {/* ---- Local (advisory) results ---------------------------------------- */}
      {localChecks ? (
        <Card
          title="Requirement check"
          subtitle="Checked in your browser. Nothing recorded — submit to be marked."
          data-testid="problem-check-results"
          action={
            <Badge tone={localChecks.every((c) => c.passed) ? "success" : "warning"}>
              {localChecks.filter((c) => c.passed).length} of {localChecks.length} met
            </Badge>
          }
        >
          <ul className="space-y-3">
            {localChecks.map((localCheck) => (
              <li key={localCheck.name} className="text-sm" data-testid="problem-check-result">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <Badge tone={localCheck.passed ? "success" : "danger"} size="sm">
                    {localCheck.passed ? "pass" : "fail"}
                  </Badge>
                  {localCheck.name}
                </p>
                <ul className="mt-1 space-y-1 pl-5">
                  {localCheck.results.map((result, index) => (
                    <li
                      key={index}
                      className={result.met ? "text-ink-muted" : "text-red-700"}
                      data-testid="problem-check-line"
                    >
                      <span aria-hidden="true">{result.met ? "✓ " : "✗ "}</span>
                      <span className="sr-only">{result.met ? "met: " : "not met: "}</span>
                      {result.description}
                      {result.detail ? ` — ${result.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {submitError ? (
        <Card data-testid="problem-submit-error">
          <p className="text-sm text-red-700" role="alert">
            {submitError}
          </p>
        </Card>
      ) : null}

      {outcome ? (
        <SubmitPanel outcome={outcome} unit={{ one: "requirement", many: "requirements" }} />
      ) : null}
    </div>
  );
}

/**
 * One requirement in words. An unparseable one is shown as its raw line with a
 * warning: a content bug must be visible to the student who hit it, because a
 * requirement that silently vanished from this list would still be graded on
 * submit and the failure would look like their mistake.
 */
function describeAssertion(assertion: MarkupAssertion): string {
  return assertion.check
    ? describeCheck(assertion.check)
    : `${assertion.source} (this requirement could not be read — please report it)`;
}

export default MarkupWorkbench;
