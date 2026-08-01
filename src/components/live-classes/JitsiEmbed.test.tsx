import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { JitsiEmbed, type JitsiApi, type JitsiApiConstructor } from "./JitsiEmbed";

// =============================================================================
// THE TEST THAT MATTERS IS `dispose()` ON UNMOUNT. Everything else in this file
// is secondary. React removing the container div does not stop a Jitsi
// conference: the iframe, the window postMessage listener and — once joined —
// the getUserMedia tracks all survive it. A student who navigates away with a
// live camera is the single least acceptable defect in this wave.
// =============================================================================

/** A fake External API that records its lifecycle. */
function fakeJitsi() {
  const listeners = new Map<string, (payload: unknown) => void>();
  const commands: Array<{ command: string; args: unknown[] }> = [];
  let disposals = 0;
  let constructions = 0;
  let lastOptions: unknown = null;

  const api: JitsiApi = {
    addListener: (event, handler) => listeners.set(event, handler),
    removeListener: (event) => listeners.delete(event),
    executeCommand: (command, ...args) => commands.push({ command, args }),
    dispose: () => {
      disposals += 1;
    },
  };

  const Constructor = function (this: unknown, _domain: string, options: unknown) {
    constructions += 1;
    lastOptions = options;
    return api;
  } as unknown as JitsiApiConstructor;

  return {
    Constructor,
    listeners,
    commands,
    get disposals() {
      return disposals;
    },
    get constructions() {
      return constructions;
    },
    get lastOptions() {
      return lastOptions as { roomName?: string; interfaceConfigOverwrite?: { TOOLBAR_BUTTONS?: string[] } };
    },
  };
}

function okFetch() {
  return vi.fn(async () =>
    ({ ok: true, status: 200, json: async () => ({ ok: true, data: {} }) }) as unknown as Response,
  ) as unknown as typeof fetch;
}

const PROPS = { classId: 9, roomName: "abc123XYZ", displayName: "Ayesha" };

describe("JitsiEmbed", () => {
  beforeEach(() => {
    // `publicFeatures.liveClasses` is inlined false at build time in tests, so
    // the component renders its "switched off" branch unless the flag module is
    // mocked. Mocking it is the only way to reach the embed path at all.
    vi.resetModules();
  });

  it("refuses to load the third-party script when the feature flag is off", async () => {
    // The real, unmocked state of the test environment: the flag is false.
    const jitsi = fakeJitsi();
    const loadApi = vi.fn(async () => jitsi.Constructor);

    render(<JitsiEmbed {...PROPS} loadApi={loadApi} fetchImpl={okFetch()} />);

    await waitFor(() => expect(screen.getByTestId("jitsi-error")).toBeInTheDocument());
    // Nothing was fetched from meet.jit.si.
    expect(loadApi).not.toHaveBeenCalled();
    expect(jitsi.constructions).toBe(0);
  });

  it("always offers a direct room link, so a blocked script is not a dead end", () => {
    render(<JitsiEmbed {...PROPS} loadApi={vi.fn()} fetchImpl={okFetch()} />);
    const link = screen.getByRole("link", { name: /Direct room link/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("abc123XYZ"));
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("names the video region, so it is not announced as an anonymous frame", () => {
    render(<JitsiEmbed {...PROPS} loadApi={vi.fn()} fetchImpl={okFetch()} />);
    expect(screen.getByRole("region", { name: "Class video conference" })).toBeInTheDocument();
  });
});

describe("JitsiEmbed — with the feature flag on", () => {
  /**
   * Import the component fresh with `publicFeatures.liveClasses` forced true.
   *
   * `vi.doMock` plus a dynamic import rather than a top-level `vi.mock`,
   * because the other describe block in this file needs the REAL (false) value
   * — the two behaviours are both worth testing and they disagree about the
   * module.
   */
  async function renderWithFlagOn(extra: Record<string, unknown> = {}) {
    vi.resetModules();
    vi.doMock("@/lib/features", async () => {
      const actual = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
      return {
        ...actual,
        publicFeatures: { ...actual.publicFeatures, liveClasses: true },
      };
    });

    const loaded = await import("./JitsiEmbed");
    const jitsi = fakeJitsi();
    const loadApi = vi.fn(async () => jitsi.Constructor);
    const fetchImpl = okFetch();

    const view = render(
      <loaded.JitsiEmbed {...PROPS} loadApi={loadApi} fetchImpl={fetchImpl} {...extra} />,
    );

    await waitFor(() => expect(jitsi.constructions).toBe(1));
    return { view, jitsi, loadApi, fetchImpl };
  }

  it("constructs the conference into the container and joins the named room", async () => {
    const { jitsi } = await renderWithFlagOn();
    expect(jitsi.lastOptions.roomName).toBe("abc123XYZ");
  });

  it("DISPOSES the conference on unmount — the camera must not survive navigation", async () => {
    const { view, jitsi } = await renderWithFlagOn();
    expect(jitsi.disposals).toBe(0);

    view.unmount();

    expect(jitsi.disposals).toBe(1);
  });

  it("posts attendance on videoConferenceJoined", async () => {
    const { jitsi, fetchImpl } = await renderWithFlagOn();

    await act(async () => {
      jitsi.listeners.get("videoConferenceJoined")?.({});
    });

    await waitFor(() => {
      const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([url]) => String(url) === "/api/classes/9/join")).toBe(true);
    });
  });

  it("posts the duration on videoConferenceLeft", async () => {
    const { jitsi, fetchImpl } = await renderWithFlagOn();

    await act(async () => {
      jitsi.listeners.get("videoConferenceJoined")?.({});
    });
    await act(async () => {
      jitsi.listeners.get("videoConferenceLeft")?.({});
    });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const leave = calls.find(([url]) => String(url) === "/api/classes/9/leave");
    expect(leave).toBeDefined();
    // A bounded, server-clamped hint — never a trusted number. See the header.
    expect(JSON.parse((leave?.[1] as RequestInit).body as string)).toHaveProperty(
      "minutesPresent",
    );
  });

  it("applies the room password after joining, never before", async () => {
    const { jitsi } = await renderWithFlagOn({ password: "s3cret" });
    expect(jitsi.commands).toHaveLength(0);

    await act(async () => {
      jitsi.listeners.get("videoConferenceJoined")?.({});
    });
    expect(jitsi.commands).toContainEqual({ command: "password", args: ["s3cret"] });
  });

  it("omits the screen-share button when the class forbids it", async () => {
    const { jitsi } = await renderWithFlagOn({ allowScreenShare: false });
    expect(jitsi.lastOptions.interfaceConfigOverwrite?.TOOLBAR_BUTTONS).not.toContain("desktop");
  });

  it("falls back to a link when the external script cannot be loaded", async () => {
    vi.resetModules();
    vi.doMock("@/lib/features", async () => {
      const actual = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
      return { ...actual, publicFeatures: { ...actual.publicFeatures, liveClasses: true } };
    });
    const loaded = await import("./JitsiEmbed");

    render(
      <loaded.JitsiEmbed
        {...PROPS}
        loadApi={vi.fn(async () => {
          throw new Error("blocked");
        })}
        fetchImpl={okFetch()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("jitsi-error")).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: "Open the room in a new tab" }),
    ).toBeInTheDocument();
  });
});
