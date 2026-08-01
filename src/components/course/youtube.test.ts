// =============================================================================
// Unit tests for YouTube URL / id parsing. Owner: course-content stream.
// -----------------------------------------------------------------------------
// The id used throughout is "dQw4w9WgXcQ" — a real, well-known public video id.
// It is used ONLY as a parse fixture; no seeded lecture points at it, because
// inventing video ids for the curriculum would ship 404ing embeds (see
// scripts/seed-content.ts).
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  extractYouTubeId,
  isYouTubeVideoId,
  youTubeEmbedUrl,
  youTubeWatchUrl,
} from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("isYouTubeVideoId", () => {
  it("accepts exactly 11 URL-safe base64 characters", () => {
    expect(isYouTubeVideoId(ID)).toBe(true);
    expect(isYouTubeVideoId("_-aAzZ09xyz")).toBe(true);
  });

  it("rejects wrong lengths and illegal characters", () => {
    expect(isYouTubeVideoId("dQw4w9WgXc")).toBe(false); // 10
    expect(isYouTubeVideoId("dQw4w9WgXcQQ")).toBe(false); // 12
    expect(isYouTubeVideoId("dQw4w9WgXc!")).toBe(false);
    expect(isYouTubeVideoId("")).toBe(false);
  });
});

describe("extractYouTubeId — full watch URLs", () => {
  it("reads the v parameter", () => {
    expect(extractYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("ignores extra query parameters and ordering", () => {
    expect(
      extractYouTubeId(`https://www.youtube.com/watch?list=PL123&v=${ID}&t=42s`),
    ).toBe(ID);
  });

  it("handles http, no-www, and mobile hosts", () => {
    expect(extractYouTubeId(`http://youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("handles a scheme-less or protocol-relative URL", () => {
    expect(extractYouTubeId(`www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractYouTubeId(`//youtu.be/${ID}`)).toBe(ID);
  });
});

describe("extractYouTubeId — short, embed, shorts and live URLs", () => {
  it("reads the youtu.be short form", () => {
    expect(extractYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://youtu.be/${ID}?t=90`)).toBe(ID);
  });

  it("reads an existing embed URL, including the nocookie host", () => {
    expect(extractYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`)).toBe(ID);
  });

  it("reads /shorts/, /live/ and legacy /v/ paths", () => {
    expect(extractYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://www.youtube.com/v/${ID}`)).toBe(ID);
  });
});

describe("extractYouTubeId — bare id", () => {
  it("passes a bare id straight through", () => {
    expect(extractYouTubeId(ID)).toBe(ID);
  });

  it("trims surrounding whitespace from a pasted id", () => {
    expect(extractYouTubeId(`  ${ID}\n`)).toBe(ID);
  });
});

describe("extractYouTubeId — null and empty", () => {
  it("returns null for every empty-ish input", () => {
    // This is the state of EVERY seeded lecture row today.
    expect(extractYouTubeId(null)).toBeNull();
    expect(extractYouTubeId(undefined)).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
    expect(extractYouTubeId("   ")).toBeNull();
  });
});

describe("extractYouTubeId — malformed and hostile input", () => {
  it("returns null for a non-YouTube host", () => {
    expect(extractYouTubeId(`https://vimeo.com/watch?v=${ID}`)).toBeNull();
    // Look-alike host: must not be accepted by a substring check.
    expect(extractYouTubeId(`https://youtube.com.evil.test/watch?v=${ID}`)).toBeNull();
    expect(extractYouTubeId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
  });

  it("returns null for a YouTube URL with no id in it", () => {
    expect(extractYouTubeId("https://www.youtube.com/")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch?v=")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/@somechannel")).toBeNull();
  });

  it("returns null when the candidate id is the wrong shape", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=tooshort")).toBeNull();
    expect(extractYouTubeId("https://youtu.be/way-too-long-to-be-an-id")).toBeNull();
  });

  it("returns null for non-http schemes and unparseable junk", () => {
    expect(extractYouTubeId("javascript:alert(1)")).toBeNull();
    expect(extractYouTubeId("not a url at all")).toBeNull();
    expect(extractYouTubeId("http://")).toBeNull();
  });
});

describe("youTubeEmbedUrl", () => {
  it("always uses the privacy-friendly nocookie host", () => {
    const url = youTubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`);
    expect(url).toContain("https://www.youtube-nocookie.com/embed/");
    expect(url).not.toContain("//www.youtube.com/embed");
  });

  it("keeps recommendations restricted and branding modest", () => {
    const url = youTubeEmbedUrl(ID) ?? "";
    expect(url).toContain("rel=0");
    expect(url).toContain("modestbranding=1");
  });

  it("returns null when there is no video to embed", () => {
    expect(youTubeEmbedUrl(null)).toBeNull();
    expect(youTubeEmbedUrl("https://example.test/video")).toBeNull();
  });

  it("converts a millisecond start offset to whole seconds", () => {
    // House rule: durations are handled in ms; YouTube's API takes seconds.
    expect(youTubeEmbedUrl(ID, { startMs: 90_000 })).toContain("start=90");
    expect(youTubeEmbedUrl(ID, { startMs: 1_500 })).toContain("start=1");
  });

  it("omits the start parameter for zero, negative and non-finite offsets", () => {
    expect(youTubeEmbedUrl(ID, { startMs: 0 })).not.toContain("start=");
    expect(youTubeEmbedUrl(ID, { startMs: -5_000 })).not.toContain("start=");
    expect(youTubeEmbedUrl(ID, { startMs: Number.NaN })).not.toContain("start=");
  });
});

describe("youTubeWatchUrl", () => {
  it("builds a canonical watch URL from any accepted form", () => {
    expect(youTubeWatchUrl(`https://youtu.be/${ID}?t=10`)).toBe(
      `https://www.youtube.com/watch?v=${ID}`,
    );
  });

  it("returns null when there is no id", () => {
    expect(youTubeWatchUrl(null)).toBeNull();
  });
});
