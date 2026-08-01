import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";

// ESLint flat config. `next lint` is deprecated in Next 15 and prompts
// interactively when no config exists, which would hang CI indefinitely — so the
// lint script calls the ESLint CLI directly against this file.
//
// eslint-config-next still ships as an eslintrc-style config, so FlatCompat
// translates it. Remove the compat layer once it publishes native flat config.
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "playwright-report/**",
      "test-results/**",
      "src/db/migrations/**", // generated SQL + drizzle journal
      // Separate npm package with its own toolchain and deploy target
      // (services/realtime, see DEPLOYMENT_LIVE_CLASSES.md). Linting it from
      // here would apply eslint-config-next — React and Next.js rules — to a
      // headless Node socket server, and would resolve plugins against the root
      // node_modules rather than its own.
      "services/**",
      ".venv/**",
      "next-env.d.ts",
    ],
  },

  ...compat.extends("next/core-web-vitals"),
  ...tseslint.configs.recommended,

  {
    rules: {
      // An unused variable is usually a half-finished edit. Allowed only with a
      // leading underscore, which makes the intent explicit at the call site.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // `any` defeats the frozen-type seam that makes parallel streams safe.
      // Warn rather than error so a stream is never blocked, but it shows up.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    // Scripts and tests run in Node and legitimately log to the console.
    files: ["scripts/**/*.ts", "tests/**/*.ts", "**/*.test.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
);
