"use client";

// =============================================================================
// <SampleCard /> — one worked sample: screenshot, live preview, code, features.
// Spec: TECHNICAL_SPECIFICATION.md §3.1.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE SECURITY DECISION IN THIS FILE IS THE IFRAME, and it is not optional.
//
// `assignment_samples.sample_output_html` is authored HTML. The schema column
// comment says outright: "UNTRUSTED BY CONSTRUCTION ... intended to be rendered
// inside a sandboxed iframe, never injected into the app document." An
// instructor account is not an attacker, but an instructor account that gets
// phished is, and `dangerouslySetInnerHTML` here would put arbitrary script in
// the same origin as every student's session cookie. The forums stream fought
// this exact battle (src/components/forums/xss.test.tsx) and reached the same
// answer from the other direction.
//
// So the preview is an `<iframe srcDoc>` with `sandbox=""` — the empty value,
// which is every restriction ON. No `allow-scripts`, no `allow-same-origin`,
// and specifically NEVER BOTH: that pair is documented by the HTML spec as
// equivalent to removing the sandbox, because the framed document can then
// reach out and remove its own sandbox attribute. A sample that needs
// JavaScript to demonstrate itself is a sample that belongs at `liveUrl`, which
// is a link the student chooses to follow, in a tab of its own.
//
// WHY THE PREVIEW IS BEHIND A DISCLOSURE.
// Rendering N iframes in a carousel costs N document loads on a page a student
// opens to read a brief. The screenshot is the default and the live render is a
// click, which is also why the schema carries `screenshot_url` at all.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, cn } from "@/components/ui";

import { CodeSnippetViewer } from "./CodeSnippetViewer";
import { readCodeFiles, readFeatures, type AssignmentSample } from "./types";

export interface SampleCardProps {
  sample: AssignmentSample;
  showCode?: boolean;
  showVideo?: boolean;
  /** Render the code and preview sections collapsed behind a disclosure. */
  expandable?: boolean;
  onCopyCode?: (filename: string) => void;
  className?: string;
}

/**
 * Every sandbox restriction on. Named rather than inlined so that a future
 * edit adding `allow-scripts` has to walk past this comment to do it.
 */
const IFRAME_SANDBOX = "";

export function SampleCard({
  sample,
  showCode = true,
  showVideo = true,
  expandable = true,
  onCopyCode,
  className,
}: SampleCardProps) {
  const files = React.useMemo(() => readCodeFiles(sample.codeExample), [sample.codeExample]);
  const features = React.useMemo(() => readFeatures(sample.features), [sample.features]);

  const [activeFile, setActiveFile] = React.useState(0);
  const [previewOpen, setPreviewOpen] = React.useState(!expandable);
  const [codeOpen, setCodeOpen] = React.useState(!expandable);

  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = React.useId();

  const current = files[Math.min(activeFile, Math.max(files.length - 1, 0))];

  /**
   * Tablist keyboard contract, per the WAI-ARIA authoring practices: arrows
   * move and ACTIVATE (this is an automatic-activation tablist, which is correct
   * when switching panels is cheap), Home/End jump to the ends, and focus
   * follows selection. Written by hand because there is no tabs primitive in
   * the house design system and inventing one is out of this stream's scope.
   */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = files.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;

    event.preventDefault();
    setActiveFile(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <Card
      title={sample.title}
      subtitle={sample.description ?? undefined}
      className={className}
      data-testid={`sample-card-${sample.id}`}
      action={
        sample.liveUrl ? (
          <a
            href={sample.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex min-h-11 items-center rounded-md border border-line px-3",
              "text-sm font-medium text-brand underline",
            )}
          >
            {/* "opens in a new tab" is in the accessible name, not only the title
                attribute, because a title attribute is not announced reliably and
                an unannounced context switch is WCAG 3.2.5. */}
            Open live sample
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {features.length > 0 && (
          <ul className="flex flex-wrap gap-2" data-testid="sample-features">
            {features.map((feature) => (
              <li key={feature}>
                <Badge tone="success" size="sm">
                  {/* The checkmark is decorative; the text carries the meaning. */}
                  <span aria-hidden="true">✓ </span>
                  {feature}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {sample.screenshotUrl && (
          /*
           * A plain <img>, not next/image. next/image requires every remote
           * host to be declared in next.config.ts `images.remotePatterns`, and
           * a screenshot URL here is authored content pointing at an arbitrary
           * host. This stream may not edit next.config.ts, and an unconfigured
           * host makes next/image THROW at request time rather than degrade —
           * a broken page instead of an unoptimised image. `loading="lazy"`
           * recovers most of what next/image would have bought.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sample.screenshotUrl}
            alt={`Screenshot of the finished ${sample.title} sample`}
            loading="lazy"
            className="w-full rounded-lg border border-line"
            data-testid="sample-screenshot"
          />
        )}

        {sample.sampleOutputHtml && (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={previewOpen}
              aria-controls={`${baseId}-preview`}
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {previewOpen ? "Hide live preview" : "Show live preview"}
            </Button>
            {previewOpen && (
              <iframe
                id={`${baseId}-preview`}
                title={`Live preview of ${sample.title}`}
                srcDoc={sample.sampleOutputHtml}
                sandbox={IFRAME_SANDBOX}
                // referrerPolicy so a sample that loads a remote asset does not
                // leak the LMS URL (which contains ids) to that host.
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-96 w-full rounded-lg border border-line bg-white"
                data-testid="sample-preview"
              />
            )}
          </div>
        )}

        {showVideo && sample.videoWalkthroughUrl && (
          <p className="text-sm">
            <a
              className="text-brand underline"
              href={sample.videoWalkthroughUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Watch the video walkthrough
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        )}

        {showCode && files.length > 0 && (
          <div className="flex flex-col gap-2">
            {expandable && (
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={codeOpen}
                aria-controls={`${baseId}-code`}
                onClick={() => setCodeOpen((open) => !open)}
              >
                {codeOpen ? "Hide code" : `Show code (${files.length} files)`}
              </Button>
            )}

            {codeOpen && (
              <div id={`${baseId}-code`} className="flex flex-col gap-3">
                {files.length > 1 && (
                  <div
                    role="tablist"
                    aria-label={`Files in ${sample.title}`}
                    className="flex flex-wrap gap-1"
                  >
                    {files.map((file, index) => (
                      <button
                        key={file.filename}
                        ref={(node) => {
                          tabRefs.current[index] = node;
                        }}
                        type="button"
                        role="tab"
                        id={`${baseId}-tab-${index}`}
                        aria-selected={index === activeFile}
                        aria-controls={`${baseId}-panel-${index}`}
                        // Roving tabindex: only the selected tab is in the tab
                        // order, so Tab leaves the tablist rather than walking
                        // every file.
                        tabIndex={index === activeFile ? 0 : -1}
                        onKeyDown={(event) => onTabKeyDown(event, index)}
                        onClick={() => setActiveFile(index)}
                        className={cn(
                          // 44 px minimum touch target (WCAG 2.5.5 AAA, adopted
                          // as the house floor for this wave).
                          "min-h-11 rounded-md border px-3 font-mono text-sm",
                          index === activeFile
                            ? "border-brand bg-brand/10 font-semibold text-ink"
                            : "border-line text-ink-muted",
                        )}
                      >
                        {file.filename}
                      </button>
                    ))}
                  </div>
                )}

                {current && (
                  <div
                    role={files.length > 1 ? "tabpanel" : undefined}
                    id={`${baseId}-panel-${activeFile}`}
                    aria-labelledby={files.length > 1 ? `${baseId}-tab-${activeFile}` : undefined}
                    tabIndex={files.length > 1 ? 0 : undefined}
                  >
                    <CodeSnippetViewer
                      filename={current.filename}
                      language={current.language}
                      code={current.code}
                      explanation={current.explanation}
                      highlightedLines={current.highlighted_lines}
                      lineExplanations={current.line_explanations}
                    />
                    {onCopyCode && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => onCopyCode(current.filename)}
                      >
                        {`I copied ${current.filename}`}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
