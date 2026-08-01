// =============================================================================
// ENTRY POINT — the only file that reads the environment and installs signal
// handlers.
// -----------------------------------------------------------------------------
// Everything testable lives in ./server.ts. This file exists to do the three
// things a test must never do: read process.env, bind the real port, and hook
// SIGTERM.
//
// HOST-AGNOSTIC BY CONSTRUCTION. There is no Railway SDK, no Fly API, no Render
// client, and nothing reads a platform-specific variable. The entire contract
// with the host is: it sets PORT, it sends SIGTERM to stop us, and it may probe
// GET /healthz. All three of Railway, Fly.io and Render satisfy that, which is
// why the same image deploys unchanged to any of them.
// =============================================================================

import { ConfigError, loadConfig } from "./config";
import { log } from "./log";
import { createRealtimeServer } from "./server";
import { createMemoryStore } from "./store/memory";
import { createPgStore } from "./store/pg";
import type { Store } from "./store/types";

async function main(): Promise<void> {
  const config = loadConfig();

  const store: Store = config.databaseUrl
    ? createPgStore(config.databaseUrl)
    : createMemoryStore();

  const server = createRealtimeServer(config, store);
  await server.listen();

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    // Guarded because a platform that does not see us exit fast enough sends a
    // SECOND signal, and two concurrent shutdowns would double-flush engagement
    // and then close an already-closed pool.
    if (shuttingDown) {
      log.warn("second shutdown signal ignored; already draining", { signal });
      return;
    }
    shuttingDown = true;
    log.info("shutdown signal received; draining", { signal });

    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      log.error("shutdown did not complete cleanly", { error });
      // Non-zero so the platform records this as a bad exit rather than a
      // successful one — a shutdown that silently half-works is how a flush bug
      // survives for months.
      process.exit(1);
    }
  }

  // SIGTERM is what Railway, Fly and Render all send. SIGINT is Ctrl-C locally.
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // A throw with nowhere to go must not leave the process running in an unknown
  // state. Logged with the same structured logger so it lands in the platform's
  // log viewer as a searchable record rather than a bare stack trace.
  process.on("uncaughtException", (error) => {
    log.error("uncaught exception; exiting", { error });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection; exiting", { error: reason });
    process.exit(1);
  });
}

void main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    // The configuration message names every problem at once. Printing it and
    // exiting 1 is the whole point: the operator fixes all of them in one pass
    // instead of one redeploy per missing variable.
    log.error("configuration error; refusing to start", { problems: error.problems });
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  log.error("failed to start", { error });
  process.exit(1);
});
