import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import {
  BACKOFF_MAX_MS,
  MAX_RECONNECT_ATTEMPTS,
  backoffDelayMs,
  useRealtime,
  type RealtimeTransport,
  type TransportFactory,
  type TransportOptions,
} from "./use-realtime";

/**
 * A stand-in for `NEXT_PUBLIC_REALTIME_URL`.
 *
 * Injected rather than set on `process.env`, because Next.js inlines
 * `NEXT_PUBLIC_*` at BUILD time — assigning it in a test changes nothing, which
 * is exactly the trap that made the first version of these tests report
 * "unavailable" for the connected path.
 */
const SERVICE_URL = "https://realtime.test.invalid";

// =============================================================================
// The central property under test is the DEGRADED PATH: with no service
// configured, the hook must construct NO transport, request NO token and
// schedule NO retry. Every assertion of that form checks the FACTORY SPY was
// never called — "no socket was constructed" is the only observable that cannot
// be satisfied by a hook that connects and then hides it.
// =============================================================================

/** A transport that records what was done to it, plus its option bag. */
function fakeTransport() {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  let disposed = 0;
  let options: TransportOptions | null = null;

  const transport: RealtimeTransport = {
    on: (event, listener) => listeners.set(event, listener),
    off: (event) => listeners.delete(event),
    emit: (event, payload) => emitted.push({ event, payload }),
    disconnect: () => {
      disposed += 1;
    },
  };

  const factory: TransportFactory = vi.fn((opts: TransportOptions) => {
    options = opts;
    return transport;
  });

  return {
    factory,
    emitted,
    listeners,
    get disposed() {
      return disposed;
    },
    get options() {
      return options;
    },
  };
}

function Probe(props: Parameters<typeof useRealtime>[0]) {
  const { mode, connected, attempts, send } = useRealtime(props);
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="attempts">{attempts}</span>
      <button type="button" onClick={() => send("chat:send", { body: "hi" })}>
        send
      </button>
    </div>
  );
}

describe("backoffDelayMs", () => {
  it("grows exponentially and is capped", () => {
    // random() forced to 1 so the jitter returns the full delay and the
    // progression is assertable.
    const full = () => 1;
    expect(backoffDelayMs(1, full)).toBe(1_000);
    expect(backoffDelayMs(2, full)).toBe(2_000);
    expect(backoffDelayMs(3, full)).toBe(4_000);
    expect(backoffDelayMs(20, full)).toBe(BACKOFF_MAX_MS);
  });

  it("applies full jitter, so two clients do not retry in lockstep", () => {
    expect(backoffDelayMs(4, () => 0)).toBe(0);
    expect(backoffDelayMs(4, () => 0.5)).toBe(4_000);
  });
});

describe("useRealtime — the degraded path", () => {
  it("constructs NO transport and requests NO token when no service is available", async () => {
    const transport = fakeTransport();
    const fetchToken = vi.fn(async () => "token");

    render(<Probe classId={1} available={false} fetchToken={fetchToken} transportFactory={transport.factory} />);

    expect(screen.getByTestId("mode")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("connected")).toHaveTextContent("false");

    // The load-bearing assertions.
    expect(transport.factory).not.toHaveBeenCalled();
    expect(fetchToken).not.toHaveBeenCalled();

    // And it stays that way — no deferred retry sneaks a connection in later.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(transport.factory).not.toHaveBeenCalled();
  });

  it("stays unavailable when a transport is supplied but nothing mints a token", () => {
    // This is the CURRENT STATE OF THE REPOSITORY: no route mints a handshake
    // token, so even a wired-up socket library cannot connect.
    const transport = fakeTransport();
    render(<Probe classId={1} available serviceUrl={SERVICE_URL} transportFactory={transport.factory} />);

    expect(screen.getByTestId("mode")).toHaveTextContent("unavailable");
    expect(transport.factory).not.toHaveBeenCalled();
  });

  it("stays unavailable when a token source exists but no socket library does", () => {
    // The other half of the same gap: `socket.io-client` is not a dependency.
    const fetchToken = vi.fn(async () => "token");
    render(<Probe classId={1} available serviceUrl={SERVICE_URL} fetchToken={fetchToken} />);

    expect(screen.getByTestId("mode")).toHaveTextContent("unavailable");
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("refuses to send, so an optimistic UI rolls back instead of hanging", () => {
    const transport = fakeTransport();
    render(<Probe classId={1} available={false} transportFactory={transport.factory} />);

    screen.getByRole("button", { name: "send" }).click();
    expect(transport.emitted).toHaveLength(0);
  });
});

describe("useRealtime — the connected path", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints a token, connects, and reports live", async () => {
    const transport = fakeTransport();
    const fetchToken = vi.fn(async () => "fresh-token");

    render(<Probe classId={7} available serviceUrl={SERVICE_URL} fetchToken={fetchToken} transportFactory={transport.factory} />);

    await waitFor(() => expect(transport.factory).toHaveBeenCalledTimes(1));
    expect(fetchToken).toHaveBeenCalledWith(7);
    expect(transport.options?.token).toBe("fresh-token");
    expect(transport.options?.namespace).toBe("/classes");

    await act(async () => {
      transport.options?.onConnect();
    });
    expect(screen.getByTestId("mode")).toHaveTextContent("live");
    expect(screen.getByTestId("connected")).toHaveTextContent("true");
  });

  it("requests a FRESH token on every reconnect, because the TTL is 120 seconds", async () => {
    const transport = fakeTransport();
    let issued = 0;
    const fetchToken = vi.fn(async () => `token-${++issued}`);

    render(<Probe classId={3} available serviceUrl={SERVICE_URL} fetchToken={fetchToken} transportFactory={transport.factory} />);
    await waitFor(() => expect(transport.factory).toHaveBeenCalledTimes(1));

    await act(async () => {
      transport.options?.onConnect();
    });
    await act(async () => {
      transport.options?.onDisconnect("transport close");
    });
    expect(screen.getByTestId("mode")).toHaveTextContent("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS + 100);
    });

    await waitFor(() => expect(fetchToken).toHaveBeenCalledTimes(2));
    // The second connect used a NEW token, not the cached first one.
    expect(transport.options?.token).toBe("token-2");
  });

  it("gives up after the attempt ceiling rather than retrying forever", async () => {
    const transport = fakeTransport();
    const fetchToken = vi.fn(async () => "t");

    render(<Probe classId={1} available serviceUrl={SERVICE_URL} fetchToken={fetchToken} transportFactory={transport.factory} />);
    await waitFor(() => expect(transport.factory).toHaveBeenCalledTimes(1));

    for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i += 1) {
      await act(async () => {
        transport.options?.onConnectError("refused");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS + 100);
      });
    }

    expect(screen.getByTestId("mode")).toHaveTextContent("failed");
  });

  it("disconnects the transport on unmount", async () => {
    const transport = fakeTransport();
    const fetchToken = vi.fn(async () => "t");

    const view = render(
      <Probe classId={1} available serviceUrl={SERVICE_URL} fetchToken={fetchToken} transportFactory={transport.factory} />,
    );
    await waitFor(() => expect(transport.factory).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(transport.disposed).toBe(1);
  });
});
