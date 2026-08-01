// =============================================================================
// STRUCTURED LOGGER — JSON lines on stdout.
// -----------------------------------------------------------------------------
// WHY NOT console.log, AND WHY NOT pino.
//
// Not `console.log`, because Railway, Fly and Render all collect stdout into a
// log viewer with a search box and nothing else. An unstructured line is
// greppable and nothing more; the first time somebody needs "every rejected
// handshake for class 12 in the last hour" they need fields, not prose. One JSON
// object per line is the lowest-common-denominator format all three ingest.
//
// Not `pino`, because it is a dependency, a transport configuration and a worker
// thread for what is thirty lines. This service's dependency list is small on
// purpose — it is the thing that has to `npm install` cleanly on a host nobody
// is watching.
//
// SECRETS NEVER REACH HERE. Nothing in this file redacts, because nothing calls
// it with a token or a connection string; the call sites log the DECISION
// ("handshake rejected", reason "expired") and never the material. A redactor
// would create the impression that passing a secret is safe.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Anything a log line may carry. `unknown` values are serialised defensively below. */
export type LogFields = Record<string, unknown>;

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

let minimum = LEVEL_ORDER[configuredLevel()];

/** Re-read LOG_LEVEL. Exposed for tests; production reads it once at import. */
export function setLogLevel(level: LogLevel): void {
  minimum = LEVEL_ORDER[level];
}

/**
 * Convert a value into something `JSON.stringify` will not choke on or truncate
 * uselessly.
 *
 * Errors are the case that matters: `JSON.stringify(new Error("x"))` is `{}`,
 * which is how a service ends up with a log full of empty objects at exactly the
 * moment somebody needs the message.
 */
function normalise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < minimum) return;

  const line: Record<string, unknown> = {
    // ISO 8601 UTC. The platforms stamp their own receive time too, but that is
    // the time the line was INGESTED; when the service is under load the two
    // diverge and only this one orders events correctly.
    ts: new Date().toISOString(),
    level,
    msg: message,
  };

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      // Never let a field shadow the envelope: a field called "level" that
      // overwrote the real one would make level filtering lie.
      if (key === "ts" || key === "level" || key === "msg") continue;
      line[key] = normalise(value);
    }
  }

  let serialised: string;
  try {
    serialised = JSON.stringify(line);
  } catch {
    // A circular reference in a field must not take down the process from
    // inside a catch block. Degrade to the envelope.
    serialised = JSON.stringify({ ts: line.ts, level, msg: message, logError: "unserialisable" });
  }

  // process.stdout.write, not console.log: console adds its own formatting layer
  // and, on some Node versions, its own newline handling for objects. One write,
  // one line, no ambiguity.
  process.stdout.write(`${serialised}\n`);
}

export const log = {
  debug: (message: string, fields?: LogFields): void => emit("debug", message, fields),
  info: (message: string, fields?: LogFields): void => emit("info", message, fields),
  warn: (message: string, fields?: LogFields): void => emit("warn", message, fields),
  error: (message: string, fields?: LogFields): void => emit("error", message, fields),
};
