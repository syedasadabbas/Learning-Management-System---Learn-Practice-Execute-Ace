"use client";

import * as React from "react";

import { Button } from "@/components/ui";

export interface ResolvePenaltyButtonProps {
  penaltyId: number;
  /**
   * Server action that clears the penalty. Injected rather than imported so this
   * component carries no server dependency and can be rendered in a unit test.
   * Production callers pass `resolvePenaltyAction` from
   * "@/lib/penalties/actions".
   */
  onResolve: (penaltyId: number) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Instructor control for clearing a penalty. Disabled while in flight so a
 * double click cannot fire the action twice.
 */
export function ResolvePenaltyButton({ penaltyId, onResolve }: ResolvePenaltyButtonProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const result = await onResolve(penaltyId);
      if (!result.ok) setError(result.error ?? "Could not clear this penalty.");
    } catch {
      setError("Could not clear this penalty.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={handleClick}
        data-testid={`resolve-penalty-${penaltyId}`}
      >
        Clear
      </Button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
