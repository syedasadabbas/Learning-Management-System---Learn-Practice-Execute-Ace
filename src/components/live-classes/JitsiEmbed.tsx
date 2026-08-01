"use client";

// =============================================================================
// <JitsiEmbed /> — the video plane, via the Jitsi External API.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// FOUR THINGS IN THIS FILE ARE LOAD-BEARING. In rough order of how expensive
// they are to get wrong:
//
// 1. `dispose()` ON UNMOUNT, ALWAYS, INCLUDING ON THE FAILURE PATHS.
//    `JitsiMeetExternalAPI` creates an iframe, a postMessage listener on
//    `window`, and — once the conference is joined — live getUserMedia tracks.
//    React removing the container div does NOT stop any of that: the camera
//    light stays on and the microphone keeps transmitting into a room the
//    student thinks they left. Every return path of the effect below disposes,
//    and the ref is nulled so a second dispose cannot double-fire. This is the
//    single defect that would be most obviously unacceptable in a product used
//    by students.
//
// 2. THE SCRIPT IS LOADED LAZILY, INSIDE THE EFFECT, NEVER AT MODULE SCOPE.
//    `external_api.js` defines a global and touches `document` on evaluation.
//    A module-scope import or a `<Script>` in a shared layout would (a) break
//    server rendering, (b) pull ~200 kB from meet.jit.si onto every page in the
//    LMS including the ones with no video, and (c) contact a third-party host
//    for students who never open a class. It is fetched when this component
//    mounts and not before, which is also why this component must only ever be
//    mounted behind the `liveClasses` flag.
//
// 3. THE SCRIPT TAG IS REUSED, THE PROMISE IS SHARED.
//    Two embeds mounting at once (a rejoin during a re-render) must not append
//    two script tags racing to define the same global. `loadJitsiScript` caches
//    its promise at module scope and every caller awaits the same one.
//
// 4. `videoConferenceJoined` AND `videoConferenceLeft` ARE THE ATTENDANCE
//    SIGNALS, and the leave one is the unreliable half. A student who closes
//    the tab fires nothing. So the leave POST is best-effort and the SERVER
//    clamps what it is told: `leaveClassSchema` bounds `minutesPresent` to
//    0..600 and the handler cross-checks it against wall-clock since
//    `joined_at`, precisely because this number comes from a client. Nothing
//    here should read as though the client is trusted — it is not, and the
//    duration below is computed from `performance.now()` only so that the
//    server has a hint to clamp rather than a blank.
//
// SECURITY NOTE, STATED PLAINLY. The default domain is `meet.jit.si` — shared
// public infrastructure, no SLA, no retention guarantee (the config module says
// this too). No JWT is minted; the room name is a 96-bit random token from
// `/start`, which is the access control that deployment actually offers. Do not
// treat a session held here as private.
//
// All durations are milliseconds unless the name says minutes (house rule).
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";
import { apiPath, apiRequest } from "@/lib/client/api";
import { liveClassesConfig, publicFeatures } from "@/lib/features";

/**
 * The slice of the Jitsi External API this component uses.
 *
 * Hand-declared because `@jitsi/react-sdk` is not a dependency of this project
 * and this stream may not add one. Typing the global as `any` would silence the
 * compiler on the exact calls most likely to be misspelled — `addListener` vs
 * `addEventListener` is a real and silent difference in this API's history.
 */
export interface JitsiApi {
  addListener(event: string, handler: (payload: unknown) => void): void;
  removeListener(event: string, handler: (payload: unknown) => void): void;
  executeCommand(command: string, ...args: unknown[]): void;
  dispose(): void;
}

export interface JitsiApiOptions {
  roomName: string;
  parentNode: HTMLElement;
  width: string | number;
  height: string | number;
  userInfo?: { displayName?: string };
  configOverwrite?: Record<string, unknown>;
  interfaceConfigOverwrite?: Record<string, unknown>;
}

export type JitsiApiConstructor = new (domain: string, options: JitsiApiOptions) => JitsiApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiApiConstructor;
  }
}

/** Shared across every embed on the page — see point 3 in the header. */
let scriptPromise: Promise<JitsiApiConstructor> | null = null;

/**
 * Fetch and evaluate `external_api.js` exactly once per page load.
 *
 * @param domain the Jitsi host, e.g. `meet.jit.si`
 * @throws Error when the script cannot be loaded. The caller renders a link to
 *         the room instead — a student on a network that blocks the CDN can
 *         still attend the class in a separate tab, which is a far better
 *         outcome than an empty box.
 */
export function loadJitsiScript(domain: string): Promise<JitsiApiConstructor> {
  if (typeof window === "undefined") {
    // Defensive: the effect that calls this never runs during SSR. Rejecting
    // rather than throwing synchronously keeps the caller's error handling on
    // one path.
    return Promise.reject(new Error("The Jitsi script cannot load during server rendering."));
  }
  if (window.JitsiMeetExternalAPI) return Promise.resolve(window.JitsiMeetExternalAPI);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<JitsiApiConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.onload = () => {
      const api = window.JitsiMeetExternalAPI;
      if (api) resolve(api);
      else reject(new Error("The Jitsi script loaded but defined no API."));
    };
    script.onerror = () => {
      // Clear the cache so a later mount can retry. A permanently rejected
      // shared promise means one flaky load poisons the rest of the session.
      scriptPromise = null;
      reject(new Error("The Jitsi script could not be loaded."));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface JitsiEmbedProps {
  classId: number;
  roomName: string;
  /** Room password from `/join`. Applied via `password` command after join. */
  password?: string | null;
  displayName?: string | null;
  /** From `/join`'s `class.allowScreenShare`. Derived server-side, never a UI toggle. */
  allowScreenShare?: boolean;
  /** Called after the attendance POST for a join succeeds. */
  onJoined?: () => void;
  /** Called when the student leaves the conference. */
  onLeft?: (minutesPresent: number) => void;
  /** Participant count changed. Feeds ParticipantsPanel. */
  onParticipantCountChange?: (count: number) => void;
  className?: string;
  /** Injected for tests. Defaults to the lazily-loaded global. */
  loadApi?: (domain: string) => Promise<JitsiApiConstructor>;
  fetchImpl?: typeof fetch;
}

const JOIN_ROUTE = "GET  /api/classes/:classId/join" as const;
const LEAVE_ROUTE = "POST /api/classes/:classId/leave" as const;

/** One minute, for converting the elapsed-time reading. */
const MS_PER_MINUTE = 60_000;

export function JitsiEmbed({
  classId,
  roomName,
  password,
  displayName,
  allowScreenShare = true,
  onJoined,
  onLeft,
  onParticipantCountChange,
  className,
  loadApi = loadJitsiScript,
  fetchImpl,
}: JitsiEmbedProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const apiRef = React.useRef<JitsiApi | null>(null);
  const joinedAtRef = React.useRef<number | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  // Callbacks through a ref so a parent passing inline arrow functions does not
  // tear down and rebuild the conference on every render. Rebuilding a Jitsi
  // conference means leaving and rejoining the room, in front of everybody.
  const callbacks = React.useRef({ onJoined, onLeft, onParticipantCountChange });
  callbacks.current = { onJoined, onLeft, onParticipantCountChange };

  const roomUrl = `https://${liveClassesConfig.jitsiDomain}/${encodeURIComponent(roomName)}`;

  React.useEffect(() => {
    // The flag is checked HERE as well as by the page's `requireFeature`,
    // because this component's whole job is to contact a third-party host and
    // "the page above me was gated" is not a property this file can verify.
    if (!publicFeatures.liveClasses) {
      setError("Live classes are switched off for this deployment.");
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    const postLeave = () => {
      const startedAt = joinedAtRef.current;
      if (startedAt === null) return;
      joinedAtRef.current = null;

      const minutesPresent = Math.max(
        0,
        Math.round((performance.now() - startedAt) / MS_PER_MINUTE),
      );

      // Best-effort and deliberately unawaited: this runs during teardown, and
      // an await here would not survive a tab close anyway. The server clamps
      // the number (see point 4 in the header) and reconciles on /end.
      void apiRequest(LEAVE_ROUTE, apiPath(LEAVE_ROUTE, { classId }), {
        body: { minutesPresent },
        fetchImpl,
      });
      callbacks.current.onLeft?.(minutesPresent);
    };

    const start = async (): Promise<void> => {
      let Constructor: JitsiApiConstructor;
      try {
        Constructor = await loadApi(liveClassesConfig.jitsiDomain);
      } catch {
        if (disposed) return;
        setError(
          "The video window could not load. Use the direct room link below to join in a new tab.",
        );
        return;
      }
      if (disposed) return;

      const api = new Constructor(liveClassesConfig.jitsiDomain, {
        roomName,
        parentNode: container,
        width: "100%",
        height: "100%",
        userInfo: displayName ? { displayName } : undefined,
        configOverwrite: {
          prejoinPageEnabled: false,
          // Screen sharing is a per-class server-side setting delivered by
          // /join. It is applied as a config override rather than trusted from
          // a prop a student could influence — the prop's value came from the
          // route, and this comment exists so nobody replaces it with a toggle.
          disableDeepLinking: true,
          startWithAudioMuted: true,
          startWithVideoMuted: true,
        },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: [
            "microphone",
            "camera",
            "hangup",
            "chat",
            "raisehand",
            "tileview",
            "fullscreen",
            ...(allowScreenShare ? ["desktop"] : []),
          ],
        },
      });

      apiRef.current = api;
      setReady(true);

      const onConferenceJoined = () => {
        joinedAtRef.current = performance.now();
        if (password) api.executeCommand("password", password);

        // The attendance write. `/join` is idempotent by unique index, so a
        // reconnect within the same class does not double-count — the route's
        // header makes that the whole point of the upsert.
        void apiRequest(JOIN_ROUTE, apiPath(JOIN_ROUTE, { classId }), { fetchImpl }).then(
          (result) => {
            if (disposed) return;
            if (result.ok) callbacks.current.onJoined?.();
            // A failed attendance write is NOT surfaced as a blocking error.
            // The student is in the class; telling them it failed would suggest
            // leaving, and the /end sweep reconciles attendance server-side.
          },
        );
      };

      const onConferenceLeft = () => postLeave();

      const onParticipantChange = () => {
        // The API exposes a count method on the instance in newer builds; this
        // component does not depend on it existing, because a missing count is
        // a cosmetic loss and a thrown TypeError inside a Jitsi listener is not
        // caught by a React error boundary.
        const counter = (api as unknown as { getNumberOfParticipants?: () => number })
          .getNumberOfParticipants;
        if (typeof counter === "function") {
          callbacks.current.onParticipantCountChange?.(counter.call(api));
        }
      };

      api.addListener("videoConferenceJoined", onConferenceJoined);
      api.addListener("videoConferenceLeft", onConferenceLeft);
      api.addListener("participantJoined", onParticipantChange);
      api.addListener("participantLeft", onParticipantChange);
    };

    void start();

    return () => {
      disposed = true;
      // If the student is still in the conference when the component unmounts —
      // a route change, a browser back — that is a leave, and the duration is
      // owed to the server.
      postLeave();
      const api = apiRef.current;
      apiRef.current = null;
      // Guarded: `dispose` on an instance whose iframe already went away throws
      // in some Jitsi builds, and an exception thrown from a cleanup function
      // aborts the rest of React's unmount.
      try {
        api?.dispose();
      } catch {
        // Nothing useful to do. The instance is being discarded either way.
      }
    };
  }, [allowScreenShare, classId, displayName, fetchImpl, loadApi, password, roomName]);

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="jitsi-embed">
      <div
        ref={containerRef}
        // A named region: without it the iframe is announced as an unlabelled
        // frame, and a screen-reader user tabbing into a video conference with
        // no idea what they have entered is a genuinely disorienting experience.
        role="region"
        aria-label="Class video conference"
        data-ready={ready || undefined}
        className={cn(
          // Aspect ratio rather than a fixed height, so 360 px wide gives a
          // 202 px tall video instead of a letterboxed strip.
          "aspect-video w-full overflow-hidden rounded-lg border border-line bg-slate-900",
          error && "hidden",
        )}
      />

      {error && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line bg-panel p-4 text-sm"
          data-testid="jitsi-error"
        >
          <p className="text-ink">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(roomUrl, "_blank", "noopener,noreferrer")}
          >
            Open the room in a new tab
          </Button>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        {`Room hosted on ${liveClassesConfig.jitsiDomain}. `}
        <a className="underline" href={roomUrl} target="_blank" rel="noopener noreferrer">
          Direct room link
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}
