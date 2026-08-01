"use client";

// =============================================================================
// <PracticeProblemCard /> — one scaffolded problem: context, statement,
// criteria, starter code, the hint ladder, and a solution behind one click.
// Spec: TECHNICAL_SPECIFICATION.md §3.2.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE `showSolution` PROP IS NOT WHAT IT LOOKS LIKE, and this is the one thing
// to read before editing this file.
//
// The spec types it as `showSolution?: boolean`, which reads as "render the
// solution". It CANNOT mean that here, because the solution is not in this
// component's data: `practiceProblemDetailColumns` does not select
// `solution_code` or `solution_explanation`, on purpose, and the projection
// module's header explains why — "the detail view is where a student WORKS, and
// shipping the answer into the page that hosts the editor puts it one devtools
// tab away from the person trying to resist it."
//
// So `showSolution` means "offer the reveal affordance", and pressing it issues
// `GET /api/practice-problems/:id/solution` — a request the student made on
// purpose, which is the entire access-control model the API stream chose (that
// route's header is explicit that it is architectural, not authorizational:
// any signed-in user may call it, because these problems are ungraded and there
// is no attempts ledger to gate on). Nothing in this component pretends
// otherwise, and no UI here suggests the reveal is tracked. It is not; the
// endpoint records nothing.
//
// NO EMBEDDED EDITOR. The spec's feature list says "interactive editor". This
// component renders the starter code read-only and links to the runner instead.
// Sandpack IS a dependency (`@codesandbox/sandpack-react`) and the
// interactive-exercises stream owns it; mounting a second, differently
// configured editor from this stream would be two components that both claim to
// be "the editor" and drift. The seam is `renderEditor`, a render prop, so the
// page that owns an editor can inject it without this file depending on one.
// =============================================================================

import * as React from "react";

import { LiveRegion, useAnnouncer } from "@/components/learn/visualizations/controls";
import { CodeSnippetViewer } from "@/components/learn/samples/CodeSnippetViewer";
import {
  readAcceptanceCriteria,
  readStringList,
} from "@/components/learn/samples/types";
import { Badge, Button, Card, cn } from "@/components/ui";
import { apiPath, apiRequest } from "@/lib/client/api";

import { ProgressiveHintRevealer } from "./ProgressiveHintRevealer";

/** The detail payload from `GET /api/practice-problems/:problemId`. */
export interface PracticeProblem {
  id: number;
  lectureId: number;
  title: string;
  description: string | null;
  difficultyLevel: "beginner" | "intermediate" | "advanced";
  learningObjectives: unknown;
  problemContext: string;
  problemStatement: string;
  acceptanceCriteria?: unknown;
  starterCode: string | null;
  starterLanguage: string | null;
  execution: "browser" | "server" | string;
  problemOrder: number;
  hintCount: number;
  maxHintLevel: number;
  solutionAvailable?: boolean;
  createdAt: string;
}

/** The payload from `GET /api/practice-problems/:problemId/solution`. */
interface SolutionPayload {
  id: number;
  lectureId: number;
  solutionCode: string | null;
  solutionExplanation: string | null;
  solutionScreenshotUrl: string | null;
}

export interface PracticeProblemCardProps {
  problem: PracticeProblem;
  /** Offer the "reveal reference solution" button. See the header. */
  showSolution?: boolean;
  showHints?: boolean;
  /** Injection point for the interactive editor owned by another stream. */
  renderEditor?: (problem: PracticeProblem) => React.ReactNode;
  onAttemptSubmit?: (code: string, language: string) => void;
  className?: string;
  fetchImpl?: typeof fetch;
}

const SOLUTION_ROUTE = "GET  /api/practice-problems/:problemId/solution" as const;

const DIFFICULTY_TONE = {
  beginner: "success",
  intermediate: "warning",
  advanced: "danger",
} as const;

export function PracticeProblemCard({
  problem,
  showSolution = true,
  showHints = true,
  renderEditor,
  onAttemptSubmit,
  className,
  fetchImpl,
}: PracticeProblemCardProps) {
  const [solution, setSolution] = React.useState<SolutionPayload | null>(null);
  const [solutionLoading, setSolutionLoading] = React.useState(false);
  const [solutionError, setSolutionError] = React.useState<string | null>(null);
  const { message, announce } = useAnnouncer();

  const objectives = React.useMemo(
    () => readStringList(problem.learningObjectives),
    [problem.learningObjectives],
  );
  const criteria = React.useMemo(
    () => readAcceptanceCriteria(problem.acceptanceCriteria),
    [problem.acceptanceCriteria],
  );

  // A different problem is a different answer. Holding the previous one would
  // put problem 3's solution under problem 4's heading.
  React.useEffect(() => {
    setSolution(null);
    setSolutionError(null);
  }, [problem.id]);

  async function revealSolution(): Promise<void> {
    if (solutionLoading || solution) return;
    setSolutionLoading(true);
    setSolutionError(null);

    const result = await apiRequest<SolutionPayload>(
      SOLUTION_ROUTE,
      apiPath(SOLUTION_ROUTE, { problemId: problem.id }),
      { fetchImpl },
    );
    setSolutionLoading(false);

    if (!result.ok) {
      if (result.aborted) return;
      // 404 with code `no_solution` is a documented, non-exceptional answer:
      // the route returns it rather than 200-with-nulls precisely so a client
      // does not render an empty answer panel. Say what happened.
      const text =
        result.code === "no_solution"
          ? "This problem has no published solution yet."
          : result.error;
      setSolutionError(text);
      announce(text);
      return;
    }

    // Belt and braces against a stale response landing after the prop changed:
    // the route carries `id` for exactly this check.
    if (result.data.id !== problem.id) return;
    setSolution(result.data);
    announce("Reference solution revealed.");
  }

  return (
    <Card
      className={className}
      data-testid={`practice-problem-${problem.id}`}
      title={problem.title}
      subtitle={problem.description ?? undefined}
      action={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={DIFFICULTY_TONE[problem.difficultyLevel] ?? "neutral"} size="sm">
            {problem.difficultyLevel}
          </Badge>
          {problem.hintCount > 0 && (
            <Badge tone="neutral" size="sm">{`${problem.hintCount} hints`}</Badge>
          )}
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        <section aria-label="Why this problem matters">
          <h3 className="text-sm font-semibold text-ink">Why this matters</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
            {problem.problemContext}
          </p>
        </section>

        <section aria-label="What to do">
          <h3 className="text-sm font-semibold text-ink">What to do</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
            {problem.problemStatement}
          </p>
        </section>

        {objectives.length > 0 && (
          <section aria-label="Learning objectives">
            <h3 className="text-sm font-semibold text-ink">You will practise</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
              {objectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
          </section>
        )}

        {criteria.length > 0 && (
          <section aria-label="Acceptance criteria">
            <h3 className="text-sm font-semibold text-ink">Done when</h3>
            <dl className="mt-1 flex flex-col gap-2 text-sm">
              {criteria.map((item) => (
                <div key={item.criteria}>
                  <dt className="font-medium text-ink">{item.criteria}</dt>
                  <dd className="m-0 text-ink-muted">{`Check it: ${item.how_to_verify}`}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {problem.starterCode && (
          <CodeSnippetViewer
            filename={`starter.${problem.starterLanguage ?? "txt"}`}
            language={problem.starterLanguage ?? "text"}
            code={problem.starterCode}
            explanation="Starter code. Copy it into your editor — this panel is read-only."
          />
        )}

        {renderEditor?.(problem)}

        {onAttemptSubmit && problem.starterCode && (
          <Button
            variant="primary"
            size="md"
            className="self-start"
            onClick={() => onAttemptSubmit(problem.starterCode ?? "", problem.starterLanguage ?? "text")}
          >
            Run the self-check
          </Button>
        )}

        {showHints && (
          <ProgressiveHintRevealer
            problemId={problem.id}
            maxLevel={problem.maxHintLevel}
            fetchImpl={fetchImpl}
          />
        )}

        {showSolution && (
          <section aria-label="Reference solution" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Reference solution</h3>
            {solution === null ? (
              <>
                <p className="text-sm text-ink-muted">
                  Nothing is recorded when you open this. It is here so you can compare
                  approaches once you have finished — reading it first is the only way to
                  waste it.
                </p>
                <Button
                  variant="secondary"
                  size="md"
                  className="self-start"
                  loading={solutionLoading}
                  disabled={solutionLoading || problem.solutionAvailable === false}
                  onClick={() => void revealSolution()}
                  data-testid="reveal-solution"
                >
                  {problem.solutionAvailable === false
                    ? "No solution published"
                    : "Show the reference solution"}
                </Button>
                {solutionError && (
                  <p role="alert" className="text-sm text-ink" data-testid="solution-error">
                    {solutionError}
                  </p>
                )}
              </>
            ) : (
              <div className={cn("flex flex-col gap-3")} data-testid="solution-panel">
                {solution.solutionExplanation && (
                  <p className="whitespace-pre-line text-sm text-ink-muted">
                    {solution.solutionExplanation}
                  </p>
                )}
                {solution.solutionCode && (
                  <CodeSnippetViewer
                    filename={`solution.${problem.starterLanguage ?? "txt"}`}
                    language={problem.starterLanguage ?? "text"}
                    code={solution.solutionCode}
                  />
                )}
              </div>
            )}
          </section>
        )}

        <LiveRegion message={message} testId="practice-live-region" />
      </div>
    </Card>
  );
}
