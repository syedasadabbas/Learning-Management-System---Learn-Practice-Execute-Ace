# Add-on integration — layering these advanced features onto the existing app

The base (auth, users, course/weeks/lectures, practice quizzes, progress,
leaderboard, submissions, dashboards) is already built. Everything in this
expansion is ADDITIVE and integrates through the existing seam — it does not
replace or re-scaffold what you have.

## What each new feature plugs into
| New feature (skill) | Integrates with existing | Integration point |
|---|---|---|
| grand-quiz | quizzes, progress, leaderboard | new `quizzes.kind='grand'` rows; reuses attempts/answers with the added columns; calls the existing scoring/leaderboard hooks. |
| code-execution | grand-quiz, coding-problems | new internal `/api/execute`; nothing existing changes. |
| coding-problems | auth, ui-shell, code-execution | new `/practice` + `/interview` sections; new tables only. |
| interactive-learning | ui-shell, code-execution | new `/learn/*` sections; `learning_modules` tables. |
| video-ingestion | course-content lectures | fills `topic_videos`; the lecture view renders them where a `topicKey` is set. |
| account | existing auth/users | new `/settings` + reset routes; adds `authTokens` only. |
| realtime-quiz | course-content lectures | inline component; `quizzes.kind='realtime'`, no grade impact. |
| curriculum-content | all content tables | seed data only; no app-code change. |
| qa-hardening | every stream | review/test/audit pass; no runtime footprint. |

## Migration is additive
The schema changes are new tables plus new nullable columns and new indexes on
existing tables (`quizzes.kind`, `questions.language/starter_code/points`,
`quiz_attempts.deadline_at/auto_submitted`, `answers.code_answer/awarded/max`).
Existing rows keep working: `kind` defaults to `practice`, new columns are
nullable or defaulted. Generate one additive migration; no data backfill needed
beyond seeding the new content.

## Build order for the add-ons (all free)
1. Apply the additive migration (new tables + columns).
2. code-execution (free Piston + browser runtimes) — needed by grand-quiz and
   coding-problems.
3. account, video-ingestion, realtime-quiz — independent, parallelizable.
4. grand-quiz + curriculum-content (the 50Q exams) together.
5. coding-problems, interactive-learning.
6. qa-hardening pass over each, then the release-gate audits.
