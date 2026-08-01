"use client";

// =============================================================================
// LAST-RESORT ERROR BOUNDARY — the only one that can catch a ROOT LAYOUT failure.
// -----------------------------------------------------------------------------
// WHY BOTH THIS AND error.tsx EXIST, since one file looks like enough.
//
// A segment `error.tsx` renders INSIDE the root layout, so it cannot catch an
// error thrown BY that layout — if src/app/layout.tsx throws, there is no layout
// left to render the boundary into. `global-error.tsx` REPLACES the root layout,
// which is why it must emit its own <html> and <body> tags: nothing else will.
// That is also why it cannot use the design tokens from globals.css or any
// component from @/components/ui — the stylesheet is imported by the layout this
// file is standing in for, so those class names would resolve to nothing. The
// styles here are therefore inline, which is deliberate and not an oversight.
//
// WHAT THIS DOES NOT DO: report to an error tracker. There is none in this stack
// (FREE_STACK.md), so `digest` is shown to the visitor instead — it is the same
// value Next.js logs server-side, which makes a student's screenshot enough to
// find the entry in the server log. No message and no stack is rendered: in
// production Next.js deliberately withholds them from the client because they
// carry file paths and query fragments, and re-adding them here would undo that.
// =============================================================================

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    // lang is repeated from the root layout because that layout is not rendering.
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <main
          data-testid="global-error"
          style={{ maxWidth: "32rem", textAlign: "center" }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, margin: "0 0 1rem" }}>
            The page could not be displayed. Your work has not been lost — nothing on
            this screen was saved or deleted.
          </p>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", color: "#64748b", margin: "0 0 1.5rem" }}>
              Reference for your instructor: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "0.375rem",
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "#ffffff",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
