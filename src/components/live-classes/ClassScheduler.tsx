"use client";

// =============================================================================
// <ClassScheduler /> — the instructor's "schedule a class" form.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE TIMEZONE DECISION IS THE ONE THAT MATTERS HERE, and getting it wrong
// schedules classes at the wrong hour for everybody.
//
// `createClassSchema` rejects a local-time string with no offset, and its
// comment says exactly why: "stored into a `timestamptz` it would be
// interpreted in the SERVER's zone, so the same request would schedule a
// different class depending on where it was deployed." But `<input
// type="datetime-local">` produces precisely that — `2026-08-01T14:00`, no
// offset — because it is by definition a local wall-clock control.
//
// So this form converts before it sends: the local value goes through `new
// Date(...)`, which interprets it in the BROWSER's zone (the instructor's own,
// which is what they meant), and out through `.toISOString()`, which is UTC
// with a `Z`. That is the only conversion in this file and it is done once, in
// `toIsoInstant`, which is exported so it is testable — a timezone bug that
// only appears for users east of Greenwich is not something to leave to
// inspection.
//
// The form also shows the resulting UTC instant back to the instructor, because
// "did it understand my timezone?" is a question they should be able to answer
// before pressing the button rather than after the class is missed.
//
// WHAT THE FORM DOES NOT SEND: `instructorId` (taken from the session),
// `status`, `jitsiRoomName`, `startedAt` — all listed as forbidden in the
// schema module's header. They are not disabled inputs; they are absent.
// =============================================================================

import * as React from "react";

import { Button, Card, cn } from "@/components/ui";
import { apiPath, apiRequest } from "@/lib/client/api";

import type { LiveClassSummary } from "./types";

const CREATE_ROUTE = "POST /api/classes" as const;

/** `durationMinutes` bounds from `createClassSchema`. Metric, as the house requires. */
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 600;

/**
 * Convert a `datetime-local` value to the ISO 8601 instant the API requires.
 *
 * @param local e.g. `"2026-08-01T14:00"` — wall clock, no zone
 * @returns e.g. `"2026-08-01T09:00:00.000Z"` when the browser is at UTC+5
 * @returns null when the value is empty or unparseable, so the caller can
 *          refuse to submit rather than send `"Invalid Date"`
 */
export function toIsoInstant(local: string): string | null {
  if (local.trim().length === 0) return null;
  const parsed = new Date(local);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export interface ClassSchedulerProps {
  /** Weeks the instructor may schedule into. Supplied by the page. */
  weeks: ReadonlyArray<{ id: number; label: string }>;
  onScheduled?: (created: LiveClassSummary) => void;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function ClassScheduler({
  weeks,
  onScheduled,
  className,
  fetchImpl,
}: ClassSchedulerProps) {
  // `null` rather than the empty string a <select> gives back: a union of
  // number and "" makes every downstream comparison a type error waiting to
  // happen, and the conversion belongs at the change handler, once.
  const [weekId, setWeekId] = React.useState<number | null>(weeks[0]?.id ?? null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [scheduledLocal, setScheduledLocal] = React.useState("");
  const [durationMinutes, setDurationMinutes] = React.useState(60);
  const [allowChat, setAllowChat] = React.useState(true);
  const [allowQa, setAllowQa] = React.useState(true);
  const [allowScreenShare, setAllowScreenShare] = React.useState(true);
  const [enableRecording, setEnableRecording] = React.useState(true);

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const isoInstant = toIsoInstant(scheduledLocal);
  const durationValid =
    Number.isInteger(durationMinutes) &&
    durationMinutes >= MIN_DURATION_MINUTES &&
    durationMinutes <= MAX_DURATION_MINUTES;

  const canSubmit =
    weekId !== null && title.trim().length > 0 && isoInstant !== null && durationValid && !submitting;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit || isoInstant === null || weekId === null) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const result = await apiRequest<LiveClassSummary>(CREATE_ROUTE, apiPath(CREATE_ROUTE), {
      body: {
        weekId,
        title: title.trim(),
        // Omitted rather than sent empty: the schema types it `.max(5000)
        // .optional()`, and an empty string is a description of "" rather than
        // an absent one.
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        scheduledAt: isoInstant,
        durationMinutes,
        allowChat,
        allowQa,
        allowScreenShare,
        enableRecording,
      },
      fetchImpl,
    });
    setSubmitting(false);

    if (!result.ok) {
      if (result.aborted) return;
      setError(result.error);
      return;
    }

    setSuccess(`"${result.data.title}" is scheduled.`);
    setTitle("");
    setDescription("");
    setScheduledLocal("");
    onScheduled?.(result.data);
  }

  const fieldClass =
    "min-h-11 w-full rounded-md border border-line bg-panel p-2 text-sm text-ink";

  return (
    <Card title="Schedule a class" className={className} data-testid="class-scheduler">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="class-week" className="text-sm font-medium text-ink">
              Week
            </label>
            <select
              id="class-week"
              className={fieldClass}
              value={weekId ?? ""}
              onChange={(event) => setWeekId(Number(event.target.value))}
              required
            >
              {weeks.map((week) => (
                <option key={week.id} value={week.id}>
                  {week.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="class-duration" className="text-sm font-medium text-ink">
              Length in minutes
            </label>
            <input
              id="class-duration"
              type="number"
              inputMode="numeric"
              className={fieldClass}
              min={MIN_DURATION_MINUTES}
              max={MAX_DURATION_MINUTES}
              value={durationMinutes}
              aria-describedby="class-duration-hint"
              aria-invalid={!durationValid || undefined}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
            />
            <p id="class-duration-hint" className="text-xs text-ink-muted">
              {`Between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="class-title" className="text-sm font-medium text-ink">
            Title
          </label>
          <input
            id="class-title"
            className={fieldClass}
            value={title}
            maxLength={255}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="class-description" className="text-sm font-medium text-ink">
            Description (optional)
          </label>
          <textarea
            id="class-description"
            rows={3}
            className={cn(fieldClass, "resize-y")}
            value={description}
            maxLength={5_000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="class-when" className="text-sm font-medium text-ink">
            Starts at
          </label>
          <input
            id="class-when"
            type="datetime-local"
            className={fieldClass}
            value={scheduledLocal}
            required
            aria-describedby="class-when-hint"
            onChange={(event) => setScheduledLocal(event.target.value)}
          />
          <p id="class-when-hint" className="text-xs text-ink-muted" data-testid="class-when-hint">
            {isoInstant === null
              ? "Entered in your own timezone."
              : `In your timezone. Stored as ${isoInstant} (UTC).`}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium text-ink">During the class</legend>
          {(
            [
              ["Allow chat", allowChat, setAllowChat],
              ["Allow questions", allowQa, setAllowQa],
              ["Allow screen sharing", allowScreenShare, setAllowScreenShare],
              ["Record the session", enableRecording, setEnableRecording],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="size-5"
                checked={value}
                onChange={(event) => set(event.target.checked)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-ink" data-testid="scheduler-error">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-ink" data-testid="scheduler-success">
            {success}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="md"
          className="self-start"
          disabled={!canSubmit}
          loading={submitting}
        >
          Schedule the class
        </Button>
      </form>
    </Card>
  );
}
