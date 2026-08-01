// Shared Vitest setup, loaded before every unit/component test file.
import "@testing-library/jest-dom/vitest";

// Tests must never reach the real Neon database. Any DB-backed behaviour is
// covered by Playwright e2e against a seeded database instead. If a unit test
// imports src/db, that is a design smell — mock the query layer or move the
// test to e2e.
process.env.DATABASE_URL ??=
  "postgresql://unit-test:unit-test@localhost:5432/never-connected";
process.env.AUTH_SECRET ??= "unit-test-secret-not-used-for-real-sessions";
