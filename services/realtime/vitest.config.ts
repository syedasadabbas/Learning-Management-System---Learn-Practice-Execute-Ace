import { defineConfig } from "vitest/config";

// The service's OWN test config, and it must exist even though its contents are
// close to the defaults: without it, Vitest walks up the directory tree, finds
// the Next app's vitest.config.ts and applies that one — jsdom, a React plugin,
// and a setupFiles path (./tests/setup.ts) that does not exist here, which fails
// every suite before a single test runs. That is a real failure that happened
// once already, and its message ("Failed to load url .../tests/setup.ts") names
// a file rather than the config that asked for it.
export default defineConfig({
  test: {
    // Node, not jsdom. This is a server; a DOM would be a fiction and jsdom
    // costs several seconds of environment setup per run.
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    // The integration suite boots a real server on an ephemeral port. Serial
    // execution is not required for correctness (each file binds port 0) but a
    // socket test starved of an event-loop turn by three parallel workers
    // produces flakes that look like latency problems and are not.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
