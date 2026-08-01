"use client";

// =============================================================================
// <ClassRecording /> — the recording of a finished class.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE PLAYER IS A LINK, NOT AN EMBEDDED <video>, AND THAT IS DELIBERATE.
//
// The route returns `hlsUrl` and `dashUrl` — adaptive streaming manifests.
// Neither plays in a bare `<video>` element outside Safari: HLS needs hls.js
// and DASH needs dash.js, and neither is a dependency of this project. An
// embedded player would therefore be a black rectangle for the majority of
// students, which is a worse outcome than an honest link that opens in the
// browser's own handler. `filePath` — a plain file, when one exists — IS
// rendered in a `<video>`, because that one does play.
//
// A 404 FROM THIS ROUTE IS NOT AN ERROR STATE. The route answers 404 for four
// distinct situations, only one of which is a fault: the flag is off, the class
// has no recording, the recording is not public and the caller is not staff, or
// the class does not exist. From the student's side "there is no recording for
// this class" is the overwhelmingly common one, and rendering "something went
// wrong" over it would send people to support for a class that simply was not
// recorded. So 404 is mapped to an empty state and every other status to an
// error.
//
// UNITS ARE THE ROUTE'S: MEGABYTES and SECONDS (house rule 5 — metric, and
// named in the identifier). They are formatted for display here and never
// converted into a second stored spelling.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { apiPath } from "@/lib/client/api";
import { useApiResource } from "@/lib/client/use-api-resource";

import type { RecordingPayload } from "./types";

const RECORDING_ROUTE = "GET  /api/classes/:classId/recording" as const;

/**
 * Seconds to a human duration.
 *
 * Exported for the unit test. `1h 05m` rather than `65 min` because a
 * ninety-minute lecture read as "90 min" makes a student do arithmetic to
 * decide whether they have time to watch it.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "length unknown";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.round((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes} min`;
}

/** Megabytes, rounded. Above 1024 MB it reads as gigabytes. */
export function formatSize(megabytes: number | null | undefined): string | null {
  if (megabytes === null || megabytes === undefined || megabytes <= 0) return null;
  return megabytes >= 1_024
    ? `${(megabytes / 1_024).toFixed(1)} GB`
    : `${Math.round(megabytes)} MB`;
}

export interface ClassRecordingProps {
  classId: number;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function ClassRecording({ classId, className, fetchImpl }: ClassRecordingProps) {
  const { state, reload } = useApiResource<RecordingPayload>(
    RECORDING_ROUTE,
    apiPath(RECORDING_ROUTE, { classId }),
    { fetchImpl },
  );

  if (state.status === "loading") {
    return (
      <div className={className}>
        <Skeleton shape="block" label="Loading the class recording" />
      </div>
    );
  }

  if (state.status === "failed") {
    // The mapping described in the header.
    if (state.failure.status === 404) {
      return (
        <div className={className}>
          <EmptyState
            title="No recording for this class"
            description="Either the session was not recorded, or the recording has not been published. Ask your instructor if you expected one."
          />
        </div>
      );
    }
    return (
      <div role="alert" className={cn("text-sm text-ink", className)} data-testid="recording-error">
        <p>{state.failure.error}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }

  const recording = state.data;

  if (recording.status === "deleted") {
    return (
      <div className={className}>
        <EmptyState
          title="This recording has been deleted"
          description="Recordings contain students' faces, names and voices, and are removed once their retention period ends."
        />
      </div>
    );
  }

  const size = formatSize(recording.fileSizeMb);
  const streamUrl = recording.hlsUrl ?? recording.dashUrl ?? null;

  return (
    <Card
      title="Class recording"
      className={className}
      data-testid="class-recording"
      action={
        <Badge tone={recording.isPublic ? "success" : "warning"} size="sm">
          {recording.isPublic ? "Published" : "Not published"}
        </Badge>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          {[
            formatDuration(recording.durationSeconds),
            size,
            recording.recordingStartedAt
              ? `recorded ${new Date(recording.recordingStartedAt).toLocaleDateString()}`
              : null,
          ]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </p>

        {recording.filePath ? (
          // A real file. `controls` gives the browser's own accessible player —
          // keyboard operable, with captions support if a track is added later.
          <video
            controls
            preload="metadata"
            className="w-full rounded-lg border border-line bg-black"
            data-testid="recording-player"
          >
            <source src={recording.filePath} />
            {/* Fallback text for a browser that cannot play the container. */}
            Your browser cannot play this recording. Use the download link below.
          </video>
        ) : streamUrl ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-sm">
            <p className="text-ink">
              This recording is an adaptive stream. It opens in your browser or media player
              rather than in this page.
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-2"
              onClick={() => window.open(streamUrl, "_blank", "noopener,noreferrer")}
            >
              Open the recording
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            The recording exists but no playable URL has been attached to it yet.
          </p>
        )}

        {!recording.isPublic && (
          <p className="text-xs text-ink-muted">
            Only staff can see this recording until it is published.
          </p>
        )}
      </div>
    </Card>
  );
}
