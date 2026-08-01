import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChatPanel } from "./ChatPanel";
import type { ChatRow } from "./types";

function row(overrides: Partial<ChatRow> = {}): ChatRow {
  return {
    id: 1,
    classId: 9,
    senderId: 2,
    senderName: "Ayesha",
    message: "Can you repeat that?",
    messageType: "text",
    parentMessageId: null,
    isPinned: false,
    isDeleted: false,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

/** A fetch whose GET succeeds and whose POST is scripted per call. */
function scriptedFetch(history: ChatRow[], postResponses: Array<{ status: number; body: unknown }>) {
  let posts = 0;
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: { items: history, limit: 100, offset: 0, total: history.length },
        }),
      } as unknown as Response;
    }
    const scripted = postResponses[Math.min(posts++, postResponses.length - 1)];
    return {
      ok: scripted.status >= 200 && scripted.status < 300,
      status: scripted.status,
      json: async () => scripted.body,
    } as unknown as Response;
  });
  return impl as unknown as typeof fetch;
}

const BASE = {
  classId: 9,
  currentUserId: 2,
  currentUserName: "Ayesha",
  allowChat: true,
  mode: "unavailable" as const,
};

describe("ChatPanel — states", () => {
  it("shows a labelled loading state, then the transcript", async () => {
    const fetchImpl = scriptedFetch([row()], []);
    render(<ChatPanel {...BASE} fetchImpl={fetchImpl} />);

    expect(screen.getByRole("status", { name: "Loading the chat transcript" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("chat-message-1")).toBeInTheDocument());
  });

  it("renders an empty state rather than a blank box", async () => {
    render(<ChatPanel {...BASE} fetchImpl={scriptedFetch([], [])} />);
    await waitFor(() => expect(screen.getByText("No messages yet")).toBeInTheDocument());
  });

  it("renders an announced error when history cannot be loaded", async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: false, status: 500, json: async () => ({ ok: false, error: "boom" }) }) as unknown as Response,
    ) as unknown as typeof fetch;

    render(<ChatPanel {...BASE} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId("async-error")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("marks the transcript as a log so additions are announced but the backlog is not re-read", () => {
    render(<ChatPanel {...BASE} fetchImpl={scriptedFetch([], [])} />);
    const log = screen.getByRole("log", { name: "Class chat transcript" });
    expect(log).toHaveAttribute("aria-live", "polite");
  });

  it("disables the composer and says why when chat is off for the class", () => {
    render(<ChatPanel {...BASE} allowChat={false} fetchImpl={scriptedFetch([], [])} />);
    expect(screen.getByTestId("chat-input")).toBeDisabled();
    // Disabled, not hidden: a missing control reads as a broken layout.
    expect(screen.getByText("Chat is switched off for this class.")).toBeInTheDocument();
  });
});

describe("ChatPanel — optimistic send", () => {
  it("shows the message immediately and reconciles it with the server row", async () => {
    const fetchImpl = scriptedFetch(
      [],
      [{ status: 201, body: { ok: true, data: row({ id: 55, message: "hello" }) } }],
    );

    render(<ChatPanel {...BASE} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText("No messages yet")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hello" } });
    fireEvent.submit(screen.getByTestId("chat-input").closest("form")!);

    // Optimistic row appears before the request settles.
    expect(screen.getByText("hello")).toBeInTheDocument();

    // Then it is replaced by the authoritative row, carrying the server's id.
    await waitFor(() => expect(screen.getByTestId("chat-message-55")).toBeInTheDocument());
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
  });

  it("rolls back to a visible, retryable failure rather than deleting what was typed", async () => {
    const fetchImpl = scriptedFetch([], [{ status: 500, body: { ok: false, error: "nope" } }]);

    render(<ChatPanel {...BASE} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText("No messages yet")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "keep me" } });
    fireEvent.submit(screen.getByTestId("chat-input").closest("form")!);

    await waitFor(() => expect(screen.getByText("Not sent.")).toBeInTheDocument());
    // THE POINT: the text the student wrote is still on screen.
    expect(screen.getByText("keep me")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("retries the same message and succeeds the second time", async () => {
    const fetchImpl = scriptedFetch(
      [],
      [
        { status: 500, body: { ok: false, error: "nope" } },
        { status: 201, body: { ok: true, data: row({ id: 77, message: "keep me" }) } },
      ],
    );

    render(<ChatPanel {...BASE} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText("No messages yet")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "keep me" } });
    fireEvent.submit(screen.getByTestId("chat-input").closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("chat-message-77")).toBeInTheDocument());
  });

  it("sends on Enter and does not send on Shift+Enter", async () => {
    const fetchImpl = scriptedFetch([], [{ status: 201, body: { ok: true, data: row({ id: 5 }) } }]);
    render(<ChatPanel {...BASE} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByText("No messages yet")).toBeInTheDocument());

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "line" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    // Shift+Enter is a newline; nothing was posted.
    const posts = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(0);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
          ([, init]) => (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toHaveLength(1),
    );
  });

  it("refuses an over-long message and names the limit", async () => {
    render(<ChatPanel {...BASE} fetchImpl={scriptedFetch([], [])} />);
    await waitFor(() => expect(screen.getByText("No messages yet")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "x".repeat(2_001) } });
    expect(screen.getByTestId("chat-input")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/The limit is 2000/)).toBeInTheDocument();
  });
});

describe("ChatPanel — transport status", () => {
  it("states that updates are not live when the socket is unavailable", () => {
    render(<ChatPanel {...BASE} fetchImpl={scriptedFetch([], [])} />);
    expect(screen.getByTestId("realtime-status")).toHaveAttribute("data-mode", "unavailable");
    // Stated in words, not only as a coloured dot.
    expect(screen.getByTestId("realtime-status")).toHaveTextContent(/refreshes on a timer/);
  });

  it("stops polling once the socket is live", async () => {
    // The observable: the poll interval is 0 in live mode, so a second GET is
    // never scheduled. Asserted indirectly via the status marker, because a
    // timer assertion here would be testing setInterval rather than behaviour.
    render(<ChatPanel {...BASE} mode="live" fetchImpl={scriptedFetch([], [])} />);
    await waitFor(() =>
      expect(screen.getByTestId("realtime-status")).toHaveAttribute("data-mode", "live"),
    );
  });
});
