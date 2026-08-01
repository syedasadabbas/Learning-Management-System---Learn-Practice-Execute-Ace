"use client";

// =============================================================================
// <ChatPanel /> — class chat, live when the socket service is there and
// perfectly usable when it is not.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE TWO TRANSPORTS, AND WHY THE REST ONE IS NOT A FALLBACK BOLTED ON LATER.
//
// This panel ALWAYS reads its history from `GET /api/classes/:id/chat` and
// ALWAYS sends through `POST /api/classes/:id/chat`. The socket, when present,
// only adds two things: it pushes other people's messages in without a poll,
// and it lets the poll interval drop to zero. Nothing about sending changes.
//
// That is the opposite of the usual arrangement (socket primary, REST fallback)
// and it is deliberate. A send that goes over the socket has its persistence
// performed by a different process, on a different host, with its own database
// connection — so "did my message get saved?" has two answers depending on
// which transport was up when I pressed enter. Routing every write through the
// Next route means the message is in Postgres before the UI acknowledges it,
// under every configuration, and the socket is purely a notification channel.
// The cost is one HTTP round trip per message, which is not the bottleneck in a
// class of forty.
//
// OPTIMISTIC SEND AND ROLLBACK. The message appears immediately as a
// `PendingChatMessage` keyed by a client ref (never an id — see the type's
// comment for the bug that prevents). On success it is replaced by the server
// row, which carries the SERVER's timestamp; on failure it stays visible,
// marked, with a retry, because silently deleting what someone typed is the
// worst possible response to a dropped request.
//
// ACCESSIBILITY:
//   - the transcript is an `aria-live="polite"` log, so arriving messages are
//     announced without stealing focus from the composer;
//   - `role="log"` tells assistive tech that only ADDITIONS matter, which stops
//     the whole transcript being re-read on every message;
//   - the composer is a real `<form>`, so Enter submits without a keydown hack;
//   - the composer is DISABLED, with a stated reason, when chat is off for the
//     class — never hidden, because a missing control is indistinguishable from
//     a broken layout. It is disabled with a stated reason for the same purpose
//     during the pre-hydration window; see ./use-composer-hydration.ts for the
//     bug that closes and why the fix salvages the DOM value before it disables
//     anything.
// =============================================================================

import * as React from "react";

import { AsyncSection } from "@/components/async/AsyncSection";
import { Badge, Button, cn } from "@/components/ui";
import { apiPath, apiPathWithQuery, apiRequest } from "@/lib/client/api";
import { useApiResource } from "@/lib/client/use-api-resource";
import type { Paginated } from "@/lib/learning/pagination";
import type { RealtimeMode } from "@/lib/live-classes/use-realtime";

import { RealtimeStatusLine } from "./ClassStatusBadge";
import { useComposerHydration } from "./use-composer-hydration";
import type { ChatRow, PendingChatMessage } from "./types";

const CHAT_GET = "GET  /api/classes/:classId/chat" as const;
const CHAT_POST = "POST /api/classes/:classId/chat" as const;

/** Matches `postChatSchema.message` in src/lib/live-classes/schemas.ts. */
export const CHAT_MAX_CHARS = 2_000;

/**
 * Poll interval while the socket is absent.
 *
 * 10 s, not 2 s. A class of forty polling every 2 s is 1200 requests a minute
 * against a serverless function with a per-invocation cost, to deliver messages
 * that are on average one second fresher. 10 s is the point where the chat
 * still feels like a conversation and the bill still looks like a hobby project.
 * When the socket IS live the interval is zero and this constant is unused.
 */
export const REST_POLL_MS = 10_000;

/** Most recent messages fetched per poll. */
const HISTORY_LIMIT = 100;

export interface ChatPanelProps {
  classId: number;
  /** From the session, via the page. Used to label the student's own messages. */
  currentUserId: number;
  currentUserName?: string | null;
  /** `class.allowChat` from `/join`. Server-derived; never a client toggle. */
  allowChat: boolean;
  /** Transport state from `useRealtime`. Drives polling and the status line. */
  mode: RealtimeMode;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function ChatPanel({
  classId,
  currentUserId,
  currentUserName,
  allowChat,
  mode,
  className,
  fetchImpl,
}: ChatPanelProps) {
  const url = React.useMemo(
    () => apiPathWithQuery(CHAT_GET, { classId }, { limit: HISTORY_LIMIT }),
    [classId],
  );

  const { state, reload, setData } = useApiResource<Paginated<ChatRow>>(CHAT_GET, url, {
    // Polling stops entirely once the socket is live. Leaving it on would be a
    // second copy of every message arriving 10 s after the first.
    refreshMs: mode === "live" ? 0 : REST_POLL_MS,
    fetchImpl,
  });

  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState<PendingChatMessage[]>([]);
  const [sending, setSending] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  // A message typed before React hydrates lands in the DOM and not in state,
  // and hydration then renders "" over it — silently. See
  // ./use-composer-hydration.ts. `setDraft` is the salvage path.
  const hydration = useComposerHydration(inputRef, setDraft);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > CHAT_MAX_CHARS;
  const canSend = allowChat && hydration.ready && trimmed.length > 0 && !tooLong && !sending;

  async function send(text: string, replacingRef?: string): Promise<void> {
    const clientRef = replacingRef ?? `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setSending(true);
    setPending((prev) => {
      const without = prev.filter((row) => row.clientRef !== clientRef);
      return [
        ...without,
        {
          clientRef,
          message: text,
          senderName: currentUserName ?? "You",
          // The optimistic row's timestamp is the CLIENT's clock and is replaced
          // by the server's on reconciliation. It exists so the row sorts to the
          // bottom, not so anybody reads it as authoritative.
          createdAt: new Date().toISOString(),
          failed: false,
        },
      ];
    });

    const result = await apiRequest<ChatRow>(CHAT_POST, apiPath(CHAT_POST, { classId }), {
      body: { message: text, messageType: "text" },
      fetchImpl,
    });
    setSending(false);

    if (!result.ok) {
      if (result.aborted) return;
      // ROLLBACK, but not a delete: the row stays, marked failed, with a retry.
      setPending((prev) =>
        prev.map((row) => (row.clientRef === clientRef ? { ...row, failed: true } : row)),
      );
      return;
    }

    // Reconcile: drop the optimistic row and splice in the authoritative one,
    // so the id, the sender name and the timestamp are all the server's.
    setPending((prev) => prev.filter((row) => row.clientRef !== clientRef));
    setData((page) =>
      page === null
        ? page
        : { ...page, items: [...page.items, result.data], total: page.total + 1 },
    );
  }

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canSend) return;
    const text = trimmed;
    setDraft("");
    // Focus is kept in the composer deliberately: a student sending a second
    // message should not have to find the field again.
    inputRef.current?.focus();
    void send(text);
  }

  const composerHint = !allowChat
    ? "Chat is switched off for this class."
    : // Ordered after the read-only case deliberately: "chat is off" is the
      // permanent fact and outranks a window that lasts a frame.
      !hydration.ready
      ? hydration.reason
      : mode === "live"
      ? null
      : "Messages are sent over HTTP and the transcript refreshes every few seconds.";

  return (
    <section
      aria-labelledby={`chat-${classId}-heading`}
      className={cn("flex min-h-0 flex-col gap-2", className)}
      data-testid="chat-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`chat-${classId}-heading`} className="text-base font-semibold text-ink">
          Chat
        </h3>
        {!allowChat && (
          <Badge tone="neutral" size="sm">
            Read only
          </Badge>
        )}
      </div>

      <RealtimeStatusLine mode={mode} />

      <div
        // role="log" + polite: additions are announced, the backlog is not
        // re-read. aria-relevant defaults to "additions text", which is what a
        // transcript wants.
        role="log"
        aria-live="polite"
        aria-label="Class chat transcript"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-panel p-2"
        data-testid="chat-transcript"
      >
        <AsyncSection
          state={state}
          loadingLabel="Loading the chat transcript"
          loadingLines={5}
          onRetry={() => void reload()}
          isEmpty={(page) => page.items.length === 0 && pending.length === 0}
          emptyTitle="No messages yet"
          emptyDescription="Say hello — the transcript is kept with the class."
        >
          {(page) => (
            <ul className="flex flex-col gap-2">
              {page.items
                .filter((row) => !row.isDeleted)
                .map((row) => (
                  <li
                    key={row.id}
                    data-testid={`chat-message-${row.id}`}
                    className={cn(
                      "rounded-md px-2 py-1 text-sm",
                      row.senderId === currentUserId && "bg-brand/5",
                      row.isPinned && "border-l-4 border-l-accent pl-2",
                    )}
                  >
                    <span className="font-semibold text-ink">
                      {row.senderName ?? `User ${row.senderId}`}
                    </span>
                    {row.isPinned && (
                      <Badge tone="accent" size="sm" className="ml-2">
                        Pinned
                      </Badge>
                    )}
                    <span className="ml-2 whitespace-pre-wrap break-words text-ink-muted">
                      {row.message}
                    </span>
                  </li>
                ))}

              {pending.map((row) => (
                <li
                  key={row.clientRef}
                  data-testid={`chat-pending-${row.clientRef}`}
                  data-failed={row.failed || undefined}
                  className={cn(
                    "rounded-md px-2 py-1 text-sm",
                    row.failed ? "bg-red-50" : "opacity-70",
                  )}
                >
                  <span className="font-semibold text-ink">{row.senderName}</span>
                  <span className="ml-2 whitespace-pre-wrap break-words text-ink-muted">
                    {row.message}
                  </span>
                  {/* The state is a word, not a greyed-out tint. */}
                  <span className="ml-2 text-xs text-ink-muted">
                    {row.failed ? "Not sent." : "Sending…"}
                  </span>
                  {row.failed && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2"
                      onClick={() => void send(row.message, row.clientRef)}
                    >
                      Retry
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-1">
        <label htmlFor={`chat-${classId}-input`} className="sr-only">
          Write a chat message
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={`chat-${classId}-input`}
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter is a newline. A textarea rather than an
              // input because pasting a two-line snippet into a class chat is
              // routine and an input silently strips the newline.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit(event);
              }
            }}
            disabled={!allowChat || !hydration.ready}
            rows={2}
            maxLength={CHAT_MAX_CHARS + 100}
            aria-describedby={`chat-${classId}-hint`}
            aria-invalid={tooLong || undefined}
            placeholder={
              !allowChat ? "Chat is switched off" : hydration.ready ? "Message the class" : "Loading…"
            }
            className={cn(
              "min-h-11 flex-1 resize-y rounded-md border border-line bg-panel p-2 text-sm",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
            data-testid="chat-input"
          />
          <Button type="submit" variant="primary" size="md" disabled={!canSend} loading={sending}>
            Send
          </Button>
        </div>
        <p id={`chat-${classId}-hint`} className="text-xs text-ink-muted">
          {tooLong
            ? `That is ${trimmed.length} characters. The limit is ${CHAT_MAX_CHARS}.`
            : (composerHint ?? "Enter sends. Shift and Enter starts a new line.")}
        </p>
      </form>
    </section>
  );
}
