---
name: course-content
description: Builds the course/week/lecture browsing experience — week list with lock state, lecture pages rendering markdown content, embedded YouTube videos, and W3Schools practice links. Also owns the week-unlock read model. Use for anything about viewing lessons, week navigation, or gating locked weeks. Wave 2.
---

# course-content

Read `../HOUSE_RULES.md`.

## Depends on
- shared-contracts (`courses`, `weeks`, `lectures`, `progress`).
- auth (`requireUser`), ui-shell (LockBadge, Card, ProgressBar).

## Owns
- `src/app/(app)/course/page.tsx` — week grid; each week shows locked/unlocked
  from `progress.weekUnlocked`. Week 1 is unlocked by default at enrolment.
- `src/app/(app)/course/[weekId]/page.tsx` — lectures list for the week.
- `src/app/(app)/course/[weekId]/[lectureId]/page.tsx` — lecture view:
  render `content` (markdown), embed `youtubeUrl` (extract id -> privacy-mode
  iframe), and render `resources` (link cards to W3Schools Tryit pages).
- `src/app/api/courses/route.ts`, `.../weeks/[weekId]`, `.../lectures/[lectureId]`.
- `src/lib/unlock.ts` — read helper `isWeekUnlocked(studentId, weekId)`.

## Important facts (don't waste time rediscovering)
- W3Schools "Try it Yourself" pages block iframing (X-Frame-Options). Link OUT
  to them in a new tab; do NOT try to embed. In-app live practice is delivered
  by the interactive-exercises stream (Sandpack), not by embedding W3Schools.
- YouTube: embed via `https://www.youtube-nocookie.com/embed/<id>`.

## Acceptance / definition of done
- Locked weeks are visibly locked and their lecture routes redirect/deny.
- A lecture renders content + video + practice links.

## Test (e2e)
- Playwright: as a seeded student, open Week 1 lecture, assert video iframe and
  at least one practice link present; assert Week 2 shows locked and its lecture
  URL is denied.
