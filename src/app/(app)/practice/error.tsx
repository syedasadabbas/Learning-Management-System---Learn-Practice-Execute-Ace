"use client";

// =============================================================================
// Error boundary for the /practice segment.
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream. Scoped to this folder deliberately: an
// exercise or a database read that fails should degrade the practice area only,
// and must not replace the whole app shell with a stack trace.
//
// Malformed `starterCode` never reaches here — the parser turns that into a card
// (see ExercisePanel). This catches the genuinely unexpected: a failed query, or a
// Sandpack client that throws while mounting.
// =============================================================================

import { Button, Card } from "@/components/ui";

export default function PracticeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-2xl p-6" data-testid="practice-error">
      <Card title="Practice could not be loaded">
        <p className="text-sm text-ink">
          Something went wrong while loading this practice page. Your work in other parts of
          the app is unaffected.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-ink-muted">
            Reference for your instructor: {error.digest}
          </p>
        )}
        <div className="mt-4">
          <Button variant="primary" size="sm" onClick={reset}>
            Try again
          </Button>
        </div>
      </Card>
    </main>
  );
}
