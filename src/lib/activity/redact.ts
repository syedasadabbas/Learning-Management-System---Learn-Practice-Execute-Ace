// =============================================================================
// THE PRIVACY BOUNDARY of the audit trail. Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// Nothing reaches `activity_logs.details`, `.ip_prefix` or `.client_family`
// except through this file. That is the whole design: a single choke point that
// can be unit-tested without a database, rather than a rule that every future
// call site has to remember.
//
// WHY A CHOKE POINT AND NOT A CONVENTION — the evidence is in this repository,
// twice over, and neither instance was malicious:
//
//   1. `getAtRiskStudents` selects `users.email` and
//      src/components/analytics/AnalyticsPanels.tsx renders it on a staff page.
//      Nobody decided to publish student addresses; a query selected the whole
//      row and a component rendered what it was handed.
//   2. In `next dev`, React serialises the awaited session object — email
//      included — into the RSC payload embedded in the HTML, whether the page
//      asked for it or not. tests/e2e/fixtures.ts:39-47 documents this and the
//      leaderboard spec asserts around it.
//
// Both are the same failure: identity data travelling further than anyone
// intended, because the default was "pass it along". An audit trail is the worst
// possible place for that default, because it is the one table designed to be
// (a) written from everywhere, (b) kept for 90 days, and (c) read in bulk by an
// admin through a UI with a CSV export button on it.
//
// WHAT IS DELIBERATELY NOT RECORDED, ANYWHERE, EVER:
//
//   * passwords, password hashes, and any field whose name looks like either;
//   * session tokens, JWTs, cookies, `authorization` headers, CSRF tokens,
//     password-reset tokens, and API keys;
//   * request bodies and query strings in any form — see `sanitiseDetails`, which
//     takes a flat record of named values and cannot be handed a body at all;
//   * email addresses and personal names. The actor is a foreign key
//     (`activity_logs.actor_id`); the address lives in `users` and is joined at
//     read time by an admin who is already authorised to see it. A copy here
//     would outlive account deletion and defeat erasure — see the note on
//     `actorId` in src/db/schema.activity.ts;
//   * quiz and exam answers, submitted work, instructor feedback text, forum and
//     message content — i.e. anything a human wrote;
//   * full IP addresses (only a /24 or /48 network prefix — see `coarsenIp`);
//   * full User-Agent strings (only a coarse family — see `clientFamily`);
//   * exception messages and stack traces (only a short `errorCode`).
//
// All lengths here are characters and all sizes are bytes.
// =============================================================================

/** Values `details` may hold. Flat on purpose — see `sanitiseDetails`. */
export type DetailValue = string | number | boolean | null;
export type DetailsInput = Readonly<Record<string, unknown>>;
export type Details = Record<string, DetailValue>;

/**
 * A DENYLIST IS THE SECOND LINE, NOT THE FIRST. The first is that `details` only
 * ever receives values a call site named one by one; there is no path that spreads
 * a request body into it. This list exists because a call site can still write
 * `{ token: resetToken }` in good faith, and because "the reviewer will notice" is
 * not a control.
 *
 * TWO MATCHING MODES, and the split is not cosmetic — a substring test on the
 * short ambiguous names is actively wrong. `"ip"` as a substring rejects
 * `rowsSkipped`, `recipientCount` and `description`; `"auth"` rejects `authorName`;
 * `"note"` rejects `denotedBy`. The first version of this file used substrings for
 * everything and hook-points.test.ts caught it by asserting that no planned
 * `details` key is one the redactor would silently drop — `rowsSkipped`, an integer
 * count in the ingest hook, was being thrown away.
 *
 * Over-blocking is not a safe failure here: it makes the audit trail quietly less
 * useful while looking like it is working, which is the same class of defect as
 * under-blocking, just pointing the other way.
 */

/**
 * Matched as a SUBSTRING of the key with separators stripped, so `pass_word`,
 * `passWord` and `password` all match. Only names long and specific enough that a
 * substring hit is never a false positive.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  "password",
  "passwd",
  "secret",
  "token",
  "credential",
  "apikey",
  "bearer",
  "signature",
  "authorization",
  "authorisation",
  "email",
  "feedback",
  "useragent",
] as const;

/**
 * The ONE exception to the rules below, and it is here because the denylist was
 * deleting the audit trail's own evidence.
 *
 * `filterQuery` is written by src/app/api/admin/activity/export/route.ts:105, and
 * that route's comment states its purpose: "records exactly what was taken, so a
 * reviewer can reproduce the selection". It never arrived. `filterQuery`
 * tokenises to ["filter", "query"], `"query"` is in FORBIDDEN_KEY_TOKENS, so the
 * key was dropped and counted — the stored row read
 * `{_redacted: 1, exportedRows: 3, truncated: false}`. An export audit row that
 * does not say what was exported is the one thing this table exists to prevent,
 * and it failed silently: `_redacted: 1` is indistinguishable from a genuinely
 * unsafe field having been refused. Caught by activity-log.spec.ts:236, which
 * could not report it until that file's fifteen skipped tests were made to run.
 *
 * WHY EXEMPTING THIS KEY IS SAFE, rather than convenient. The ban on "query" is
 * right in general — a query string is a place user-supplied text ends up. This
 * particular value cannot contain any: `filterToQuery` (src/lib/activity/
 * filter.ts:288) emits only `actor` and `entityId` (integers), `from` and `to`
 * (ISO timestamps), and `action`, `status` and `entityType`, each a member of a
 * closed set the API validates before this point — an unrecognised action is
 * refused with `invalid_action` and never reaches an export. There is no branch
 * that copies a raw request query into it.
 *
 * KEEP THIS SET SMALL. Every entry is a hole in a control that exists because
 * this table is retained for 90 days. An addition needs the same argument made
 * above: not "the key is fine" but "no user-supplied text can reach this value".
 * Matched on the NORMALISED key, so `filter_query` and `filterQuery` both pass.
 */
const ALLOWED_DETAIL_KEYS = new Set(["filterquery"]);

/**
 * Matched as a WHOLE TOKEN after splitting the key on separators and camelCase
 * boundaries, so `ipAddress` and `ip_address` are rejected while `rowsSkipped` and
 * `description` are not.
 */
const FORBIDDEN_KEY_TOKENS = new Set([
  // credentials
  "pwd",
  "hash",
  "hashes",
  "jwt",
  "cookie",
  "cookies",
  "session",
  "sessions",
  "auth",
  "otp",
  "pin",
  // NOT bare "key": `apiKey` is already caught by the `apikey` substring, whereas
  // `topicKey` and `sortKey` are legitimate identifiers that a substring or token
  // ban on "key" would throw away.
  // identity
  "mail",
  "mails",
  "phone",
  "phones",
  "address",
  "addresses",
  "ip",
  "ips",
  "ua",
  "bio",
  "name",
  "names",
  // human-written content
  "answer",
  "answers",
  "response",
  "responses",
  "comment",
  "comments",
  "content",
  "contents",
  "body",
  "bodies",
  "message",
  "messages",
  "note",
  "notes",
  "text",
  "source",
  "code",
  // request shape
  "query",
  "url",
  "urls",
  "sql",
  "header",
  "headers",
  "params",
  "payload",
]);

/** The largest an encoded `details` object may be. */
export const DETAILS_MAX_BYTES = 2_048;
/** The longest a single string value may be before it is truncated. */
export const DETAIL_STRING_MAX_CHARS = 200;
/** The most keys one entry may carry. */
export const DETAILS_MAX_KEYS = 20;

/** Marker key added when something was dropped, so a reader is never misled. */
export const REDACTED_MARKER = "_redacted";

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Split a key into lower-case words on separators AND camelCase boundaries, so
 * `ipAddress`, `ip_address` and `IPAddress` all yield a token `ip`.
 *
 * The `[A-Z]+(?![a-z])` alternative is what handles a run of capitals: without it
 * `IPAddress` tokenises as one word and the token test misses it.
 */
function tokeniseKey(key: string): string[] {
  return (
    key
      .replace(/[^A-Za-z0-9]+/g, " ")
      .replace(/([A-Z]+)(?![a-z])/g, " $1 ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * Is this key forbidden by name?
 *
 * Exported for the test suite and for a caller that wants to assert its own payload
 * before writing code that would be silently trimmed — which is exactly what
 * hook-points.test.ts does for every key in the wiring plan.
 */
export function isForbiddenDetailKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (!normalised) return true;
  // The allowlist is consulted FIRST and is deliberately tiny. See its comment.
  if (ALLOWED_DETAIL_KEYS.has(normalised)) return false;
  if (FORBIDDEN_KEY_SUBSTRINGS.some((part) => normalised.includes(part))) return true;
  return tokeniseKey(key).some((token) => FORBIDDEN_KEY_TOKENS.has(token));
}

/**
 * Reduce arbitrary named context to something safe to keep for 90 days.
 *
 * Rules, in order of application:
 *   1. a key that looks like a secret or like content is DROPPED (not masked —
 *      a masked value still proves the field was present and how long it was);
 *   2. nested objects and arrays are DROPPED. This is the rule that makes handing
 *      a request body to this function useless rather than dangerous: a body is an
 *      object, and its interesting contents are one level down;
 *   3. strings are truncated to `DETAIL_STRING_MAX_CHARS`;
 *   4. non-finite numbers, functions, symbols and undefined are DROPPED;
 *   5. at most `DETAILS_MAX_KEYS` keys survive, and the encoded result is capped
 *      at `DETAILS_MAX_BYTES` — keys are dropped from the end until it fits;
 *   6. if anything was dropped for any reason, `_redacted` records HOW MANY. An
 *      auditor must be able to tell "there was nothing else" from "there was
 *      something else and this table refused to keep it".
 *
 * Returns null for an empty result rather than `{}`, so the column stays NULL
 * instead of filling with empty objects.
 */
export function sanitiseDetails(input: DetailsInput | null | undefined): Details | null {
  if (!input || typeof input !== "object") return null;

  const out: Details = {};
  let dropped = 0;
  let kept = 0;

  for (const [key, raw] of Object.entries(input)) {
    if (kept >= DETAILS_MAX_KEYS) {
      dropped += 1;
      continue;
    }
    if (isForbiddenDetailKey(key)) {
      dropped += 1;
      continue;
    }

    const value = coerce(raw);
    if (value === undefined) {
      dropped += 1;
      continue;
    }

    out[key] = value;
    kept += 1;
  }

  // Size cap last: truncating a string above may already have brought it under.
  // Keys are removed newest-first so the earliest-named context survives, which
  // is the order a call site writes the most significant fields in.
  let keys = Object.keys(out);
  while (keys.length > 0 && encodedBytes(out) > DETAILS_MAX_BYTES) {
    const victim = keys[keys.length - 1];
    delete out[victim];
    keys = Object.keys(out);
    dropped += 1;
  }

  if (dropped > 0) out[REDACTED_MARKER] = dropped;

  return Object.keys(out).length > 0 ? out : null;
}

function coerce(raw: unknown): DetailValue | undefined {
  if (raw === null) return null;
  switch (typeof raw) {
    case "string":
      return raw.length > DETAIL_STRING_MAX_CHARS
        ? `${raw.slice(0, DETAIL_STRING_MAX_CHARS)}…`
        : raw;
    case "number":
      // NaN and ±Infinity are not representable in JSON and become `null`, which
      // would silently look like a deliberately recorded null.
      return Number.isFinite(raw) ? raw : undefined;
    case "boolean":
      return raw;
    default:
      // Objects, arrays, functions, symbols, bigint, undefined. Rule 2.
      return undefined;
  }
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

// ---------------------------------------------------------------------------
// Network origin
// ---------------------------------------------------------------------------

/**
 * Reduce an IP address to a NETWORK PREFIX: IPv4 to /24, IPv6 to /48.
 *
 * WHY NOT THE FULL ADDRESS, given the roadmap's column is `ip_address`. The
 * stated purpose is fraud detection, and the fraud question this table gets asked
 * is "did these two accounts act from the same network, at the same time?" — which
 * a /24 answers. The full address additionally answers "which specific connection,
 * traceable to a subscriber" — a device-level identifier with no extra audit value
 * that this table would then have to protect for the whole retention window and
 * hand to every admin who clicks Export.
 *
 * COST, STATED: two students behind one campus or CGNAT /24 are indistinguishable
 * here. This column supports "worth a look", never "proven". If an institution
 * later requires full addresses for a specific investigation, that is a policy
 * decision with a retention consequence, and it belongs in this function with a
 * comment — not spread across call sites.
 *
 * Returns null for anything unparseable, including the empty string and the
 * comma-separated `x-forwarded-for` chain's junk entries. A null column is honest;
 * a stored "unknown" string is a value that sorts and groups.
 */
export function coarsenIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // `x-forwarded-for` is a chain: client, proxy1, proxy2. The left-most entry is
  // the closest thing to the client, and is also the one a client can forge — see
  // the note in context.ts about why that is acceptable for this column.
  const first = raw.split(",")[0]?.trim() ?? "";
  if (!first) return null;

  // Strip a port and any brackets: "1.2.3.4:5678", "[2001:db8::1]:443".
  const bare = stripPortAndBrackets(first);
  if (!bare) return null;

  if (isIpv4(bare)) {
    const octets = bare.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  if (bare.includes(":")) {
    const groups = expandIpv6Head(bare);
    if (!groups) return null;
    return `${groups.join(":")}::/48`;
  }

  return null;
}

function stripPortAndBrackets(value: string): string | null {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    return close > 1 ? value.slice(1, close) : null;
  }
  // A single colon with dots before it is an IPv4:port pair. Multiple colons mean
  // IPv6, where a trailing ":port" is only legal inside brackets (handled above).
  const colons = value.split(":").length - 1;
  if (colons === 1 && value.includes(".")) return value.split(":")[0];
  return value;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * The first three 16-bit groups of an IPv6 address, which is the /48 boundary.
 * Handles "::" compression only as far as it must to get three groups.
 */
function expandIpv6Head(value: string): string[] | null {
  if (!/^[0-9a-fA-F:]+$/.test(value)) return null;

  const [head, tail] = value.split("::", 2);
  const headGroups = head ? head.split(":").filter(Boolean) : [];
  const isCompressed = value.includes("::");

  if (!isCompressed && headGroups.length < 3) return null;

  const out: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const group = headGroups[i];
    if (group === undefined) {
      // Inside the compressed run: every elided group is zero. `tail` is not
      // consulted, because a group after "::" cannot fall inside the first three
      // unless the address is shorter than /48, in which case zero is correct.
      out.push("0");
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(group.toLowerCase().replace(/^0+(?=.)/, ""));
  }
  void tail;
  return out;
}

// ---------------------------------------------------------------------------
// Client family
// ---------------------------------------------------------------------------

/** Max length of the derived family string; matches the column's 120 chars. */
export const CLIENT_FAMILY_MAX_CHARS = 120;

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  // Order matters: every Chromium browser also says "Chrome", and Edge/Opera say
  // both, so the more specific token has to be tested first.
  [/\bEdgA?\/|\bEdge\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
  [/\bcurl\/|\bwget\b/i, "CLI client"],
  [/\bHeadlessChrome\b|\bPlaywright\b|\bpuppeteer\b/i, "Automation"],
  [/\bbot\b|\bspider\b|\bcrawler\b/i, "Bot"],
];

const PLATFORMS: ReadonlyArray<[RegExp, string]> = [
  [/\bAndroid\b/, "Android"],
  [/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b|\bX11\b/, "Linux"],
];

/**
 * Reduce a User-Agent header to a coarse family such as "Chrome on Windows".
 *
 * NO VERSION NUMBERS, on purpose. Version plus build plus device model is a
 * fingerprint that can single out one person in a cohort of 80; the family is
 * enough for the only question this column serves, which is "does this act look
 * like it came from a different kind of client than everything else on this
 * account?" (a submission from "Automation" on an account that otherwise only
 * ever shows "Safari on iOS" is worth a look).
 *
 * Automation and bot families are recognised and kept, because "this exam was
 * submitted by a headless browser" is the single most useful thing this column
 * will ever say.
 *
 * Returns null for a missing header rather than "Unknown": absence is a fact, and
 * storing a placeholder makes it look like a recognised family.
 */
export function clientFamily(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.slice(0, 400); // bound the work on a hostile header

  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const platform = PLATFORMS.find(([re]) => re.test(ua))?.[1] ?? null;

  if (browser && platform) return `${browser} on ${platform}`.slice(0, CLIENT_FAMILY_MAX_CHARS);
  if (browser) return browser;
  if (platform) return platform;
  // An unrecognised agent is recorded as the fact that it was unrecognised, with
  // NO fragment of the header itself — a raw slice would be a fingerprint again,
  // and an arbitrary prefix of an attacker-controlled string is the sort of value
  // that later shows up rendered somewhere.
  return "Unrecognised client";
}

/** A short error code, defensively bounded and normalised. Never a message. */
export function errorCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return code || null;
}
