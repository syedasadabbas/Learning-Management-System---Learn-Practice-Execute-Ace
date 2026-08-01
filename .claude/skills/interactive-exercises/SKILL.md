---
name: interactive-exercises
description: Builds in-browser live coding practice — a Sandpack editor with live preview for HTML/CSS/JS, animated concept explainers, and per-lecture starter exercises defined in the lecture "resources" field. Use for anything about interactive learning, live editors, "try it in the browser", or animated concept delivery. Wave 2, independent of quizzes.
---

# interactive-exercises

Read `../HOUSE_RULES.md`. Read `/mnt/skills/public/frontend-design/SKILL.md`
before building UI.

## Depends on
- shared-contracts (`lectures.resources` shape: items of
  `{ title, type: "link" | "sandpack", url?, starterCode? }`).
- ui-shell, course-content (exercises render inside the lecture view).

## Owns
- `src/components/exercise/LiveEditor.tsx` — wraps `@codesandbox/sandpack-react`
  for HTML/CSS/JS with live preview; seeds from `starterCode`.
- `src/components/exercise/ConceptAnimation.tsx` — small, dependency-light
  animated explainers (CSS/JS transitions) for topics like the box model,
  flexbox axes, the DOM tree. Keep animations opt-out via reduced-motion.
- `src/lib/exercises/registry.ts` — maps syllabus topics to starter snippets.

## Facts
- Sandpack runs client-side; mark components `"use client"`.
- W3Schools cannot be iframed — provide our own Sandpack equivalent for
  in-app practice and let course-content link out to W3Schools separately.

## Acceptance / definition of done
- A lecture with a `sandpack` resource shows an editable live editor; typing
  HTML/CSS updates the preview in real time.
- At least one animated concept explainer renders and respects reduced-motion.

## Test (e2e)
- Playwright: open a lecture with a live exercise, type into the editor, assert
  the preview iframe updates. Assert the animation container mounts.
