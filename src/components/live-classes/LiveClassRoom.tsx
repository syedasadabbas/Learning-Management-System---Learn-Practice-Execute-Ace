"use client";

// =============================================================================
// <LiveClassRoom /> — video, chat, Q&A and participants in one screen.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE RESPONSIVE PROBLEM, WHICH IS THE HARD PART OF THIS COMPONENT.
//
// Four regions, one of which (video) has a fixed 16:9 aspect ratio and two of
// which (chat, Q&A) are scrolling transcripts that need vertical room. At
// 1280 px that is a two-column layout. At 360 px it is not a layout at all: any
// side-by-side arrangement produces either a horizontal scrollbar on the page —
// which is the single most common mobile defect and makes the whole screen
// unusable, not just the sidebar — or three columns of forty pixels.
//
// So the side panels COLLAPSE INTO A TABLIST below the `lg` breakpoint, and the
// same three panels are rendered as columns above it. WHY NOT RENDER BOTH AND
// LET CSS HIDE ONE: two mounted ChatPanels means two polling loops and two
// optimistic-send state machines, and the one that is display:none still
// fetches. The layout is chosen once, from a media query read in JS, and only
// the chosen tree is mounted.
//
// THE TABS ARE REAL TABS. Arrow keys move between them, Home/End jump to the
// ends, roving tabindex keeps Tab moving past the strip rather than through it,
// and each panel is labelled by its tab. This is the WAI-ARIA tablist pattern
// and it is written out rather than approximated, because a student on a phone
// with a switch device is exactly the user who cannot work around a broken one.
//
// AUTHORIZATION IS NEVER DERIVED HERE. `canModerate` arrives from the page,
// which read it from the session. It is passed down to QAPanel and
// ParticipantsPanel purely so the controls are not rendered where they would
// fail; every one of those routes checks the session itself and additionally
// filters on class ownership in its WHERE clause.
// =============================================================================

import * as React from "react";

import { Button, cn } from "@/components/ui";
import {
  createSocketTransport,
  defaultFetchRealtimeToken,
} from "@/lib/live-classes/socket-transport";
import { useRealtime, type UseRealtimeOptions } from "@/lib/live-classes/use-realtime";

import { ChatPanel } from "./ChatPanel";
import { ClassStatusBadge } from "./ClassStatusBadge";
import { JitsiEmbed } from "./JitsiEmbed";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { QAPanel } from "./QAPanel";
import type { JoinPayload } from "./types";

/**
 * The breakpoint at which the side panels stop being tabs.
 *
 * 1024 px is Tailwind's `lg`. Chosen rather than `md` (768) because at 768 the
 * two-column split leaves the transcripts about 280 px wide, which is narrower
 * than the message bubbles they contain.
 */
export const SIDE_BY_SIDE_MIN_PX = 1_024;

type PanelKey = "chat" | "qa" | "people";

const PANEL_LABEL: Record<PanelKey, string> = {
  chat: "Chat",
  qa: "Questions",
  people: "Participants",
};

/**
 * Track a media query.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState`: it gives a
 * server snapshot, which is what stops the first client render disagreeing with
 * the server's HTML and triggering a hydration mismatch. The server snapshot is
 * `false` — narrow layout — so a mobile user gets the correct tree in the very
 * first paint and a desktop user gets one reconciliation.
 */
export function useIsWide(minWidthPx: number = SIDE_BY_SIDE_MIN_PX): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const query = window.matchMedia(`(min-width: ${minWidthPx}px)`);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    [minWidthPx],
  );

  return React.useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(`(min-width: ${minWidthPx}px)`).matches
        : false,
    () => false,
  );
}

export interface LiveClassRoomProps {
  /** The `/join` payload, fetched by the page's server component. */
  join: JoinPayload;
  currentUserId: number;
  currentUserName?: string | null;
  /** From the session. Enables the answer composer and the roster. */
  canModerate?: boolean;
  /** Wiring for the socket layer. Omit and the room runs on REST — see useRealtime. */
  realtime?: Pick<UseRealtimeOptions, "fetchToken" | "transportFactory">;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function LiveClassRoom({
  join,
  currentUserId,
  currentUserName,
  canModerate = false,
  realtime,
  className,
  fetchImpl,
}: LiveClassRoomProps) {
  const wide = useIsWide();
  const [activePanel, setActivePanel] = React.useState<PanelKey>("chat");
  const [conferenceCount, setConferenceCount] = React.useState<number | null>(null);

  // THE DEFAULT IS NOW THE REAL WIRING, and the degraded path is unchanged by
  // it. Both defaults are module-level constants, so their identity is stable
  // and the hook's connect effect does not re-run on every render. Neither is
  // CALLED unless `isRealtimeAvailable()` — flag on AND NEXT_PUBLIC_REALTIME_URL
  // set — which is the hook's own gate: with no service URL the factory is never
  // invoked, no token is requested and no timer is scheduled, exactly as before.
  // The prop stays overridable because that is what the room's tests inject.
  const { mode } = useRealtime({
    classId: join.class.id,
    fetchToken: realtime?.fetchToken ?? defaultFetchRealtimeToken,
    transportFactory: realtime?.transportFactory ?? createSocketTransport,
  });

  const tabRefs = React.useRef<Record<PanelKey, HTMLButtonElement | null>>({
    chat: null,
    qa: null,
    people: null,
  });
  const order: PanelKey[] = ["chat", "qa", "people"];

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, key: PanelKey): void {
    const index = order.indexOf(key);
    let next: PanelKey | null = null;
    if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
    else if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order[order.length - 1];
    if (next === null) return;

    event.preventDefault();
    setActivePanel(next);
    tabRefs.current[next]?.focus();
  }

  const chat = (
    <ChatPanel
      classId={join.class.id}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
      allowChat={join.class.allowChat}
      mode={mode}
      className="h-full"
      fetchImpl={fetchImpl}
    />
  );

  const qa = (
    <QAPanel
      classId={join.class.id}
      currentUserId={currentUserId}
      allowQa={join.class.allowQa}
      canAnswer={canModerate}
      mode={mode}
      className="h-full"
      fetchImpl={fetchImpl}
    />
  );

  const people = (
    <ParticipantsPanel
      classId={join.class.id}
      canSeeRoster={canModerate}
      conferenceCount={conferenceCount}
      className="h-full"
      fetchImpl={fetchImpl}
    />
  );

  const panels: Record<PanelKey, React.ReactNode> = { chat, qa, people };

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="live-class-room">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">{join.class.title}</h1>
        <ClassStatusBadge status={join.class.status} />
      </header>

      {/* A skip link, because the video region contains a third-party iframe
          with its own long focus order. Without this a keyboard user must tab
          through every Jitsi toolbar button to reach the chat composer. */}
      <a
        href="#class-side-panels"
        className={cn(
          "sr-only rounded-md bg-brand px-3 py-2 text-sm text-white",
          "focus:not-sr-only focus:absolute focus:z-50",
        )}
      >
        Skip the video and go to chat
      </a>

      <div
        className={cn(
          "grid gap-4",
          // The only place the two layouts differ structurally. Below lg the
          // grid is one column and the panels are a tablist underneath.
          wide ? "grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]" : "grid-cols-1",
        )}
      >
        <JitsiEmbed
          classId={join.class.id}
          roomName={join.jitsiConfig.roomName}
          password={join.jitsiConfig.password}
          displayName={currentUserName}
          allowScreenShare={join.class.allowScreenShare}
          onParticipantCountChange={setConferenceCount}
          fetchImpl={fetchImpl}
        />

        <div id="class-side-panels" className="flex min-h-0 flex-col">
          {wide ? (
            // Side by side: all three mounted, stacked vertically in the rail.
            // Each is capped so one long transcript cannot push the others off
            // the bottom of the viewport.
            <div className="flex flex-col gap-4" data-layout="columns">
              <div className="max-h-96 min-h-0">{chat}</div>
              <div className="max-h-96 min-h-0">{qa}</div>
              <div className="max-h-64 min-h-0">{people}</div>
            </div>
          ) : (
            <div data-layout="tabs">
              <div
                role="tablist"
                aria-label="Class side panels"
                className="flex gap-1 border-b border-line"
              >
                {order.map((key) => (
                  <button
                    key={key}
                    ref={(node) => {
                      tabRefs.current[key] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`class-tab-${key}`}
                    aria-selected={activePanel === key}
                    aria-controls={`class-panel-${key}`}
                    tabIndex={activePanel === key ? 0 : -1}
                    onKeyDown={(event) => onTabKeyDown(event, key)}
                    onClick={() => setActivePanel(key)}
                    className={cn(
                      // 44 px minimum touch target, and flex-1 so three tabs
                      // divide a 360 px screen into three comfortable ones.
                      "min-h-11 flex-1 rounded-t-md px-2 text-sm",
                      activePanel === key
                        ? "border-b-2 border-brand font-semibold text-ink"
                        : "text-ink-muted",
                    )}
                  >
                    {PANEL_LABEL[key]}
                  </button>
                ))}
              </div>

              <div
                role="tabpanel"
                id={`class-panel-${activePanel}`}
                aria-labelledby={`class-tab-${activePanel}`}
                tabIndex={0}
                className="max-h-[32rem] min-h-0 overflow-hidden pt-3"
              >
                {panels[activePanel]}
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            // Navigating away unmounts JitsiEmbed, whose cleanup disposes the
            // conference and posts the duration. There is deliberately no
            // second "leave" request here — two would double-count.
            window.history.back();
          }}
        >
          Leave the class
        </Button>
        <p className="text-xs text-ink-muted">
          Leaving stops your camera and microphone and records how long you were present.
        </p>
      </footer>
    </div>
  );
}
