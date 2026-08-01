import { describe, expect, it, vi } from "vitest";

import { apiMethod, apiPath, apiPathWithQuery, apiRequest } from "./api";

/** A `fetch` that answers once with the given status and body. */
function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return vi.fn(async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response,
  );
}

describe("apiPath", () => {
  it("substitutes path parameters into a frozen route key", () => {
    expect(apiPath("GET  /api/classes/:classId", { classId: 12 })).toBe("/api/classes/12");
  });

  it("handles the map's inconsistent spacing after the verb", () => {
    // "GET  " has two spaces so the paths line up in the source; every other
    // verb has one. Splitting on the first slash is what tolerates both.
    expect(apiPath("POST /api/classes")).toBe("/api/classes");
    expect(apiPath("GET  /api/classes")).toBe("/api/classes");
  });

  it("substitutes several parameters", () => {
    expect(
      apiPath("POST /api/classes/:classId/qa/:questionId/upvote", {
        classId: 3,
        questionId: 88,
      }),
    ).toBe("/api/classes/3/qa/88/upvote");
  });

  it("percent-encodes a value that would otherwise change the address", () => {
    expect(
      apiPath("PUT  /api/presentations/:presentationId/slides/:slideNumber", {
        presentationId: 1,
        slideNumber: "a/b?c",
      }),
    ).toBe("/api/presentations/1/slides/a%2Fb%3Fc");
  });

  it("throws on a missing parameter rather than fetching a literal colon segment", () => {
    // The alternative 404s in a way that looks like a missing row.
    expect(() => apiPath("GET  /api/classes/:classId")).toThrow(/missing path parameter/);
  });
});

describe("apiMethod", () => {
  it("reads the verb off the key", () => {
    expect(apiMethod("GET  /api/classes")).toBe("GET");
    expect(apiMethod("DELETE /api/classes/:classId")).toBe("DELETE");
  });
});

describe("apiPathWithQuery", () => {
  it("appends supplied values", () => {
    expect(apiPathWithQuery("GET  /api/classes/upcoming", {}, { days: 7, limit: 20 })).toBe(
      "/api/classes/upcoming?days=7&limit=20",
    );
  });

  it("drops undefined and null instead of serialising them", () => {
    // `?limit=undefined` is a 422 from every list route in this wave.
    expect(
      apiPathWithQuery("GET  /api/classes/upcoming", {}, { days: undefined, limit: null }),
    ).toBe("/api/classes/upcoming");
  });
});

describe("apiRequest", () => {
  it("unwraps an apiOk envelope", async () => {
    const result = await apiRequest<{ x: number }>("GET  /api/classes", "/api/classes", {
      fetchImpl: stubFetch(200, { ok: true, data: { x: 1 } }),
    });
    expect(result).toEqual({ ok: true, data: { x: 1 }, status: 200 });
  });

  it("returns 204 as a success with no body, without trying to parse one", async () => {
    const json = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, json }) as unknown as Response);

    const result = await apiRequest("DELETE /api/classes/:classId", "/api/classes/1", {
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(json).not.toHaveBeenCalled();
  });

  it("carries the server's machine code through, so a caller can branch on it", async () => {
    const result = await apiRequest("GET  /api/classes/:classId/join", "/api/classes/1/join", {
      fetchImpl: stubFetch(425, { ok: false, error: "Not started.", code: "not_started" }, false),
    });

    expect(result).toMatchObject({ ok: false, status: 425, code: "not_started" });
  });

  it("survives an HTML error body, which is what a flagged-off feature returns", async () => {
    // A disabled feature answers with Next's own 404 page. `.json()` rejects,
    // the helper falls back to the status, and the panel renders a sentence
    // rather than the word "undefined".
    const fetchImpl = vi.fn(async () =>
      ({
        ok: false,
        status: 404,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      }) as unknown as Response,
    );

    const result = await apiRequest("GET  /api/classes", "/api/classes", { fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(result.ok === false && result.error).toContain("404");
  });

  it("reports a transport failure as status 0 with a readable message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await apiRequest("GET  /api/classes", "/api/classes", { fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 0, aborted: false });
    expect(result.ok === false && result.error).toMatch(/connection/i);
  });

  it("flags an aborted request so the caller can skip a setState after unmount", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });

    controller.abort();
    const result = await apiRequest("GET  /api/classes", "/api/classes", {
      signal: controller.signal,
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, aborted: true });
  });

  it("sends a JSON body with the content-type header set", async () => {
    const fetchImpl = stubFetch(201, { ok: true, data: { id: 1 } });
    await apiRequest("POST /api/classes", "/api/classes", {
      body: { title: "x" },
      fetchImpl,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "x" }));
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
});
