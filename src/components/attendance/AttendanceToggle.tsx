"use client";

import * as React from "react";

export interface AttendanceToggleProps {
  studentId: number;
  lectureId: number;
  /** Current recorded state. Undefined/false both render as "not present". */
  attended: boolean;
  /** Accessible label, e.g. "Demo Student — Lecture 2". */
  label: string;
  /**
   * Persists the change. Injected rather than imported so this component has no
   * server dependency and can be unit-tested. Production callers pass a wrapper
   * around `markAttendanceAction` from "@/lib/attendance/actions".
   */
  onChange: (next: boolean) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * One attendance checkbox.
 *
 * Optimistic: the box flips immediately and reverts if the write fails, because
 * an instructor ticking 60 boxes should not wait on a round trip per tick. The
 * underlying write is an upsert, so re-ticking a box that was already recorded
 * updates the row instead of erroring on the unique index.
 */
export function AttendanceToggle({
  studentId,
  lectureId,
  attended,
  label,
  onChange,
}: AttendanceToggleProps) {
  const [checked, setChecked] = React.useState(attended);
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // Keep in step when the server re-renders the grid with fresh data.
  React.useEffect(() => setChecked(attended), [attended]);

  async function handleChange(next: boolean) {
    setChecked(next);
    setPending(true);
    setFailed(false);
    try {
      const result = await onChange(next);
      if (!result.ok) {
        setChecked(!next);
        setFailed(true);
      }
    } catch {
      setChecked(!next);
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="inline-flex items-center justify-center" title={label}>
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-invalid={failed || undefined}
        data-testid={`attendance-${studentId}-${lectureId}`}
        onChange={(e) => void handleChange(e.currentTarget.checked)}
        className="size-4 accent-brand disabled:opacity-50"
      />
    </label>
  );
}
