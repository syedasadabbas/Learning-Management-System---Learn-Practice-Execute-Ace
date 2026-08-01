// =============================================================================
// PROBLEM VIEW — statement, workbench, history. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// A server component that renders the statement and delegates everything
// interactive to `ProblemWorkbench`, which is the only client component in this
// stream. That boundary is deliberate: the statement is markdown that never changes
// after render, so rendering it on the server keeps it out of the client bundle
// entirely.
//
// Shared by /problems/[slug] and /interview/[slug] for the same reason
// `ProblemBrowser` is shared — one object, two surfaces.
// =============================================================================

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge, buttonClasses, Card } from "@/components/ui";
import {
  BANK_BASE_PATH,
  isMarkupLanguage,
  TRACK_LABELS,
  type StudentProblem,
} from "@/lib/problems";

import { LazyMarkupWorkbench } from "./LazyMarkupWorkbench";
import { ProblemWorkbench } from "./ProblemWorkbench";

export interface ProblemViewProps {
  problem: StudentProblem;
}

export function ProblemView({ problem }: ProblemViewProps) {
  const backHref = `${BANK_BASE_PATH[problem.bank]}?track=${problem.track}&level=${problem.level}`;

  return (
    <div className="space-y-6" data-testid="problem-view" data-slug={problem.slug}>
      <header className="space-y-3">
        <Link href={backHref} className="text-sm text-brand underline underline-offset-2">
          ← {problem.bank === "interview" ? "Interview drills" : "Practice problems"}
        </Link>
        <h1 className="text-2xl font-semibold text-ink">{problem.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{TRACK_LABELS[problem.track]}</Badge>
          <Badge tone="neutral">{problem.level}</Badge>
          {problem.solved ? (
            <Badge tone="success" data-testid="problem-solved-badge">
              solved
            </Badge>
          ) : null}
          {problem.tags.map((tag) => (
            <Badge key={tag} tone="neutral" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      </header>

      <Card data-testid="problem-statement">
        <div className="prose prose-sm max-w-none text-ink">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{problem.statement}</ReactMarkdown>
        </div>
      </Card>

      {/*
        WHICH WORKBENCH, AND WHY THE SERVER BRANCH IS NOT A BUNDLE BOUNDARY.

        CORRECTED 2026-07-31, with measurements. This comment used to claim that
        because the branch is taken in a SERVER component, "the unchosen workbench
        never appears in the RSC payload and its chunk is never fetched", and that
        therefore the 353 kB First Load JS `next build` reported for the four
        problem routes was an accounting artifact. The first half is true. The
        conclusion is false, and the build was right:

          First Load JS      BEFORE (static import)   AFTER (LazyMarkupWorkbench)
            /problems              353 kB                   129 kB
            /problems/[slug]       353 kB                   129 kB
            /interview             353 kB                   129 kB
            /interview/[slug]      353 kB                   129 kB
            /practice/[lectureId]  162 kB                   162 kB  (control)

        THE EVIDENCE that settled it, from
        .next/server/app/(app)/problems/[slug]/page_client-reference-manifest.js:
        the `clientModules` entry for ProblemWorkbench.tsx listed the SAME 12 chunks
        as the entry for MarkupWorkbench.tsx, including static/chunks/1227-*.js
        (373 kB, sandpack + codemirror), 363642f4-*.js (174 kB, codemirror) and
        e58a7f8f-*.js (103 kB, sandpack). A route has one webpack client entry;
        every client component reachable from its server graph lands in that entry's
        chunk group, and the manifest records the whole group against each module.
        React's Flight client loads every chunk listed for a module reference before
        it can render it — so a JavaScript problem, whose payload contains only
        ProblemWorkbench, still downloaded Sandpack. The server branch chooses the
        component; webpack chose the chunks, and it did so from the static import
        graph, where both branches are always present.

        The corroborating tell was on the LIST pages: /problems and /interview also
        measured 353 kB, and they mount no workbench under either branch. They
        reach this file through BankPages.tsx:32. A server-side branch cannot
        explain a cost on a page where neither branch runs.

        The fix is the house pattern, not a new one — see LazyMarkupWorkbench.tsx,
        and src/components/exercises/LazyExerciseList.tsx which exists because the
        identical mistake took a lecture route from ~115 kB to 377 kB.
        ProblemWorkbench stays a static import: it is a textarea and a fetch, it is
        the common case, and deferring it would trade 8 kB for a loading flash.

        Every HTML and CSS problem takes the markup branch, including the ones that
        stayed reference-only: the product owner's complaint was "no editor at all",
        and an editor with a live preview is worth having even where there is nothing
        to grade. MarkupWorkbench hides its Submit button in that case.
      */}
      {isMarkupLanguage(problem.language) ? (
        <LazyMarkupWorkbench problem={problem} />
      ) : (
        <ProblemWorkbench problem={problem} />
      )}

      {/* The reference solution, when the payload was allowed to carry it. Its
          presence or absence was decided server-side by `mayRevealSolution`; there
          is no client-side gate here to bypass, because there is nothing to gate. */}
      {problem.referenceSolution ? (
        <Card
          title="Reference solution"
          subtitle={
            problem.solved
              ? "You have solved this — here is one worked answer to compare with yours."
              : "Shown because this problem cannot be checked automatically."
          }
          data-testid="problem-reference-solution"
        >
          <pre className="overflow-x-auto rounded border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink">
            {problem.referenceSolution}
          </pre>
        </Card>
      ) : null}

      {/* Attempt history. This IS the source of the solved state — there is no
          stored flag anywhere (src/lib/problems/completion.ts). */}
      {problem.attempts.length > 0 ? (
        <Card
          title="Your submissions"
          subtitle={`${problem.attempts.length} recorded run${problem.attempts.length === 1 ? "" : "s"}`}
          data-testid="problem-attempts"
        >
          <ul className="space-y-1 text-sm">
            {problem.attempts.map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={attempt.passed ? "success" : "neutral"} size="sm">
                  {attempt.passedCount}/{attempt.totalCount}
                </Badge>
                <span className="text-ink-muted">
                  {new Date(attempt.createdAt).toISOString().replace("T", " ").slice(0, 16)} ·{" "}
                  {attempt.runtimeMs == null ? "—" : `${attempt.runtimeMs} ms`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-sm">
        <Link href={backHref} className={buttonClasses("secondary", "sm")}>
          Back to the list
        </Link>
      </p>
    </div>
  );
}

export default ProblemView;
