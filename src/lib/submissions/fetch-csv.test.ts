// =============================================================================
// Unit tests — the null-URL no-op and the published-sheet host allow-list.
// Owner: submissions stream. `fetch` is injected; no real network is used.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

import { fetchPublishedCsv, isAllowedCsvUrl } from "./fetch-csv";

/** A stand-in for a published sheet response. */
function okResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/csv" } });
}

describe("fetchPublishedCsv — the null CSV URL case", () => {
  // This is the SEEDED state of every assignment: scripts/seed.ts sets both
  // googleFormUrl and googleSheetCsvUrl to null with a TODO(decision), because
  // the real URLs have not been supplied. It must be a clear, logged no-op.
  it("returns no_csv_url for null, undefined and blank, without calling fetch", async () => {
    const fetchImpl = vi.fn();
    for (const value of [null, undefined, "", "   "]) {
      const result = await fetchPublishedCsv(value, { fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("no_csv_url");
      // The message must say what to do about it, not just that it failed.
      expect(result.detail).toMatch(/Publish to web/);
      expect(result.detail).toMatch(/Nothing was ingested/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("isAllowedCsvUrl — SSRF guard on a staff-supplied URL", () => {
  it("allows Google published-sheet hosts", () => {
    for (const url of [
      "https://docs.google.com/spreadsheets/d/abc/pub?output=csv",
      "https://drive.google.com/x.csv",
      "https://doc-0g-sheets.googleusercontent.com/pub?output=csv",
    ]) {
      expect(isAllowedCsvUrl(url).ok, url).toBe(true);
    }
  });

  it("allows loopback so the e2e suite can serve a fixture CSV", () => {
    expect(isAllowedCsvUrl("http://127.0.0.1:3100/fixture.csv").ok).toBe(true);
    expect(isAllowedCsvUrl("http://localhost:3100/fixture.csv").ok).toBe(true);
  });

  it("rejects arbitrary and internal hosts", () => {
    for (const url of [
      "https://evil.test/steal.csv",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/admin",
      "https://docs.google.com.evil.test/x.csv",
    ]) {
      expect(isAllowedCsvUrl(url).ok, url).toBe(false);
    }
  });

  it("rejects non-http schemes and malformed URLs", () => {
    expect(isAllowedCsvUrl("file:///etc/passwd").ok).toBe(false);
    expect(isAllowedCsvUrl("not a url").ok).toBe(false);
  });

  it("rejects plain http to a remote host", () => {
    expect(isAllowedCsvUrl("http://docs.google.com/x.csv").ok).toBe(false);
  });
});

describe("fetchPublishedCsv — network outcomes", () => {
  it("returns the body on success", async () => {
    const fetchImpl = vi.fn(async () => okResponse("Timestamp,Email Address\n")) as unknown as typeof fetch;
    const result = await fetchPublishedCsv("http://localhost:3100/fixture.csv", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("Timestamp");
  });

  it("reports fetch_failed with the status for an unpublished sheet", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const result = await fetchPublishedCsv("https://docs.google.com/x?output=csv", { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("fetch_failed");
    expect(result.detail).toContain("404");
  });

  it("reports fetch_failed rather than throwing when the request errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const result = await fetchPublishedCsv("https://docs.google.com/x?output=csv", { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("fetch_failed");
    expect(result.detail).toContain("socket hang up");
    // Durations are reported in milliseconds (metric units per house rules).
    expect(result.detail).toMatch(/after \d+ ms/);
  });

  it("never echoes the sheet URL back in an error, since it is a capability token", async () => {
    const secretish = "https://docs.google.com/spreadsheets/d/SECRET-KEY/pub?output=csv";
    const fetchImpl = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    const result = await fetchPublishedCsv(secretish, { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).not.toContain("SECRET-KEY");
  });
});

// ---------------------------------------------------------------------------
// THE WRONG PUBLISH SETTING — added 2026-07-31
// ---------------------------------------------------------------------------
// A sheet published as "Web page" instead of "Comma-separated values" answers
// 200 OK with a complete HTML document. Every check above passes it, so it used to
// reach the parser, be read as a one-column CSV, and abort as `no_email_column` —
// pointing the operator at their Form's question wording, the one thing that was
// not wrong. Caught here, at the layer that has the content-type header.
// ---------------------------------------------------------------------------

describe("fetchPublishedCsv — a sheet published as a web page", () => {
  const HTML_BODY = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><title>Week 1 responses</title></head>',
    "<body><table><tr><td>Timestamp</td></tr></table></body></html>",
  ].join("\n");

  it("reports html_not_csv on a text/html response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(HTML_BODY, { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;
    const result = await fetchPublishedCsv("https://docs.google.com/x/pubhtml", { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("html_not_csv");
  });

  it("still catches it when the content-type LIES, via the body sniff", async () => {
    // Not hypothetical robustness: Google's publish endpoint has been observed
    // answering text/plain, and any proxy in between can rewrite the header. A
    // check that trusted the header alone would be defeated by the commonest
    // variant of the very failure it exists to catch.
    const fetchImpl = vi.fn(
      async () =>
        new Response(HTML_BODY, { status: 200, headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;
    const result = await fetchPublishedCsv("https://docs.google.com/x/pubhtml", { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("html_not_csv");
  });

  it("says exactly which dropdown to change, and does not leak the URL", async () => {
    // The whole point of a separate reason code is that the report can carry the
    // fix. "html_not_csv" alone would still leave the operator guessing.
    const secretish = "https://docs.google.com/spreadsheets/d/SECRET-KEY/pubhtml";
    const fetchImpl = vi.fn(
      async () =>
        new Response(HTML_BODY, { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;
    const result = await fetchPublishedCsv(secretish, { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("Comma-separated values");
    expect(result.detail).toContain("Publish to web");
    expect(result.detail).not.toContain("SECRET-KEY");
  });

  it("does NOT reject a real CSV whose cells contain markup", async () => {
    // The false positive that would matter: a free-text answer containing a tag
    // must not take the whole cohort's ingest down.
    const csv =
      'Timestamp,Email Address,Notes\n2026-09-08 14:03:21,ada@example.test,"I tried <html> tags"\n';
    const fetchImpl = vi.fn(
      async () =>
        new Response(csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } }),
    ) as unknown as typeof fetch;
    const result = await fetchPublishedCsv("https://docs.google.com/x?output=csv", { fetchImpl });
    expect(result.ok).toBe(true);
  });
});
