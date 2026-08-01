import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Unit / component test harness. Playwright owns end-to-end (see
// playwright.config.ts) — the two must not overlap: anything that needs a
// browser, a session cookie, or a real database belongs in e2e.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the "@/*" -> "./src/*" mapping in tsconfig.json. Kept in sync by
    // hand rather than via a plugin so there is one fewer dependency to break.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // jsdom for every test so component streams need no per-file pragma. Pure
    // logic tests (e.g. scoring) are unaffected by the environment.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Co-located *.test.ts(x) next to the code, plus tests/unit for anything
    // that spans modules. Playwright specs are excluded by directory.
    //
    // tests/integration/** holds suites that talk to a REAL Postgres over the
    // wire — currently the constraint negative tests, which prove the 42 CHECK
    // constraints and unique indexes added by migrations 0006/0007 actually
    // reject bad writes rather than merely existing in pg_constraint. They live
    // under vitest rather than Playwright because they assert on SQLSTATE codes
    // and constraint names, not on rendered pages, and a browser would add
    // nothing. Each such file declares `// @vitest-environment node` and gates
    // itself on TEST_DATABASE_URL, skipping loudly when it is absent, so a
    // contributor without a throwaway database still gets a clean run and a
    // named skip in the summary telling them what they did not exercise.
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      // scoring.ts is the highest-leverage file in the repo; every stream's
      // grades depend on it. Held to a higher bar than the app average.
      include: ["src/lib/contracts/**", "src/lib/**"],
    },
  },
});
