# House rules (every stream must follow)

These apply to all skills. They encode the organization's engineering standards.

1. **Never edit the seam from inside a feature stream.** The frozen files are
   `src/db/schema.ts`, `src/lib/contracts/*`, and `src/lib/config/app.config.ts`.
   If a stream needs a change there, stop and raise it to the shared-contracts
   owner — a schema change is a coordinated, all-streams event.

2. **Change log is mandatory.** Append an entry to `CHANGELOG.log` for every
   change, with a one-line justification. Format:
   `[YYYY-MM-DD HH:MM] <type>(<scope>): <summary> — why: <justification>`

3. **Git workflow.** Work on `feature/<skill-name>` branched off `develop`.
   Meaningful commits (conventional-commit style: feat/fix/test/docs/chore).
   Open a PR into `develop`; never commit straight to `main`.

4. **Tests, including end-to-end, are part of "done".** Unit tests (Vitest) for
   logic, Playwright e2e for the user-facing flow the stream delivers. Run them
   and confirm green before declaring the stream complete. If a test cannot be
   made to pass, do NOT silently skip it — leave a `// TODO(test):` warning
   comment explaining the blocker and flag it in the PR description.

5. **Metric units everywhere** a unit appears (time in ms/s, sizes in metric).

6. **No secrets in code.** Read from environment; keep `.env.example` current.

7. **State facts, offer options.** Where a design choice is open, document the
   trade-off in the PR rather than silently picking one.
