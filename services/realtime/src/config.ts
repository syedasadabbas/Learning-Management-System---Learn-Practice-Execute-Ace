// =============================================================================
// CONFIGURATION FROM THE ENVIRONMENT — read once, validated loudly.
// -----------------------------------------------------------------------------
// The service REFUSES TO BOOT without REALTIME_SHARED_SECRET and without at
// least one allowed origin, and that is the same argument src/lib/env.ts makes
// in the Next app: a misconfiguration that lets the process start produces a
// service that accepts connections and rejects every single one of them, which
// reads in the log as "clients cannot connect" and costs hours. Failing at boot
// names the actual problem, once, before a student is affected.
//
// DATABASE_URL is the exception and is OPTIONAL. Without it the service runs
// with the in-memory store: chat and Q&A work live for the duration of the class
// and nothing persists. That is a legitimate mode — a smoke test on a fresh host
// before the database is reachable — and it is logged at WARN on every boot so
// nobody discovers it from a student asking where the transcript went.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { log } from "./log";

export interface RealtimeConfig {
  /** Injected by Railway, Fly and Render alike. 4001 is the local default. */
  port: number;
  /** Shared with the Next app. Verifies every handshake. */
  sharedSecret: string;
  /**
   * Exact origins permitted to open a socket. NEVER "*".
   *
   * A wildcard here is not the usual harmless CORS relaxation: this socket
   * carries a class's private conversation and, worse, `*` combined with
   * credentials makes any page the student visits able to open an authenticated
   * socket on their behalf. The token limits the damage (an attacker page cannot
   * mint one) but the browser's origin check is the layer that stops the attempt.
   */
  allowedOrigins: string[];
  /** Postgres connection string, or null to run against the in-memory store. */
  databaseUrl: string | null;
  /** Max sockets one user may hold at once. Two tabs is normal; twenty is not. */
  maxSocketsPerUser: number;
  /** How long a class's engagement counters survive with nobody connected. */
  engagementIdleTtlMs: number;
}

export class ConfigError extends Error {
  public readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `The realtime service cannot start. ${problems.length} configuration problem(s):\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\nSee DEPLOYMENT_LIVE_CLASSES.md for every variable and where it is set.",
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/**
 * Values that look like a placeholder count as missing.
 *
 * The mistake actually made in this repo before (recorded in CHANGELOG.log for
 * the Next app's env guard) was copying `.env.example` and filling in only some
 * of it. A truthiness test passes `your-secret-here` straight through and the
 * service then boots with a secret an attacker can read on GitHub.
 */
const PLACEHOLDER = /replace-with|your-|changeme|xxxx|example/i;

function looksUnset(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return !trimmed || trimmed.length === 0 || PLACEHOLDER.test(trimmed);
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw?.trim() ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parse ALLOWED_ORIGINS.
 *
 * Trailing slashes are stripped because a browser's `Origin` header never has
 * one, and an operator pasting `https://app.example.org/` out of the address bar
 * would otherwise produce an allowlist that matches nothing — a failure whose
 * only symptom is a CORS error in a console nobody is reading.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry.length > 0 && entry !== "*");
}

export const MIN_SECRET_CHARS = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RealtimeConfig {
  const problems: string[] = [];

  const secret = env.REALTIME_SHARED_SECRET?.trim() ?? "";
  if (looksUnset(env.REALTIME_SHARED_SECRET)) {
    problems.push(
      "REALTIME_SHARED_SECRET is missing or is a placeholder. It must be the SAME value " +
        "set on the Next.js deployment; every handshake is verified against it.",
    );
  } else if (secret.length < MIN_SECRET_CHARS) {
    // Length, not entropy — entropy cannot be measured from one sample. 32 chars
    // matches what the Next app's .env.example asks for, so the two agree.
    problems.push(
      `REALTIME_SHARED_SECRET is ${secret.length} characters; at least ${MIN_SECRET_CHARS} are required.`,
    );
  }

  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowedOrigins.length === 0) {
    problems.push(
      "ALLOWED_ORIGINS is empty (or was set to '*', which is rejected). Give it a " +
        "comma-separated list of exact origins, e.g. " +
        "'https://your-app.vercel.app,http://localhost:3000'.",
    );
  }

  if (problems.length > 0) throw new ConfigError(problems);

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (!databaseUrl) {
    log.warn(
      "DATABASE_URL is not set. Running with the IN-MEMORY store: chat and Q&A will work " +
        "for the duration of each class and NOTHING WILL BE PERSISTED. This is a valid " +
        "smoke-test mode and a wrong production configuration.",
    );
  }

  return {
    port: readPositiveInt(env.PORT, 4001),
    sharedSecret: secret,
    allowedOrigins,
    databaseUrl,
    maxSocketsPerUser: readPositiveInt(env.MAX_SOCKETS_PER_USER, 4),
    engagementIdleTtlMs: readPositiveInt(env.ENGAGEMENT_IDLE_TTL_MS, 1_800_000),
  };
}
