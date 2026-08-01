---
name: ui-shell
description: Builds the shared visual foundation — Next.js App Router layout, navigation, design tokens from app.config, theming, and reusable primitives (Button, Card, ProgressBar, StarRating, Badge, LockBadge). Use whenever a stream needs a page frame or a shared component. Runs in Wave 1 alongside auth; every feature page composes these primitives, so build it early.
---

# ui-shell

Read `../HOUSE_RULES.md`. Before writing any component, read
`/mnt/skills/public/frontend-design/SKILL.md` for the environment's design
conventions and follow them.

## Depends on
- shared-contracts (for `app.config.ts` branding tokens).

## Owns
- `src/app/layout.tsx`, global styles, Tailwind v4 setup wired to config colors.
- `src/components/ui/*` primitives: Button, Card, Badge, ProgressBar,
  StarRating (read-only + interactive), LockBadge, Avatar, EmptyState, Toast.
- `src/components/nav/*`: top bar + sidebar with role-aware links
  (student vs instructor vs admin). Links are data-driven, not hardcoded.

## Contract exposed to other streams
- Import primitives from `@/components/ui`. Do not fork styles per page.
- Colors/brand come from `app.config.ts` only — never hardcode hex in components.

## Acceptance / definition of done
- Renders in light theme with brand colors from config.
- Nav shows the correct link set per role prop.
- Storybook-style demo page at `/_ui` exercising every primitive.

## Test (e2e)
- Playwright: load `/_ui`, assert every primitive renders and StarRating
  responds to clicks (1..5).
