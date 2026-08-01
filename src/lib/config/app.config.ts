// =============================================================================
// APP CONFIG — the ONE place to change branding, course meta, and deadlines.
// -----------------------------------------------------------------------------
// Every blank left in the Pre-Development Decisions form lives here as a clearly
// marked placeholder. Editing this file re-brands and re-schedules the whole app;
// no other file hardcodes these values.
// =============================================================================

export const appConfig = {
  branding: {
    // TODO(decision): confirm public app name. Placeholder below.
    appName: "Code Queens LMS",
    organizationName: "Code Queens Hub",
    // TODO(decision): supply a logo file at /public/logo.svg (yes/no pending).
    logoPath: "/logo.svg",
    // TODO(decision): confirm brand palette. Values mirror the syllabus cover (indigo/slate).
    colors: {
      primary: "#4f5bd5", // indigo from the syllabus cover
      accent: "#f4b942",
      surface: "#f4f4f6",
    },
  },

  course: {
    title: "Web Development Internship",
    // TODO(decision): custom description or reuse syllabus objective block?
    description:
      "Build professional responsive websites with HTML5, CSS3, JavaScript, Git & deployment — from beginner to job-ready in four weeks.",
    durationWeeks: 4,
    // TODO(decision): 1 cohort at a time, or concurrent? Schema supports both.
    concurrentCohorts: false,
  },

  // TODO(decision): fill real dates before launch. All deadlines are cohort-scoped
  // in the DB (cohorts.startsAt + weeks.dueAt); these are the seed defaults.
  schedule: {
    week1StartISO: "2026-09-01T00:00:00Z", // PLACEHOLDER
    gracePeriodDays: 2, // TODO(decision): 0-3 day grace window
    // Per-week assignment due offsets (days after cohort start).
    weekDueOffsetsDays: [7, 14, 21, 28],
    finalProjectDueOffsetDays: 28,
  },

  quiz: {
    attemptsAllowed: 3,
    passingScorePercent: 70,
  },

  // ---------------------------------------------------------------------------
  // SUBJECT SECTIONS — how the course is divided, and which parts are OPEN.
  // ---------------------------------------------------------------------------
  // The course has always been a flat list of four weeks. This groups them into
  // named subject sections so /weeks reads as "HTML5 / CSS3 / JavaScript / Git"
  // rather than "Week 1 / 2 / 3 / 4", and adds a release switch that is
  // INDEPENDENT of the quiz-progression unlock.
  //
  // THE TWO LOCKS ARE DIFFERENT THINGS AND BOTH APPLY.
  //   `enabled: false` here  -> the cohort has not been given this subject yet.
  //                             No amount of student progress opens it.
  //   quiz progression       -> within an OPEN subject, week N+1 still requires
  //                             passing week N (unchanged, see lock-state.ts).
  // A week is readable only when BOTH allow it. The section switch wins on
  // conflict, which is why `deriveWeekLockStates` checks it before anything else
  // — including the "week 1 is always unlocked" rule. Otherwise disabling the
  // HTML section would leave week 1 open and the switch would be a suggestion.
  //
  // `weekNumbers` refers to `weeks.week_number`, NOT the primary key. Week rows
  // are re-seeded per cohort and get fresh ids; the week NUMBER is the stable
  // identifier the curriculum is authored against (see scripts/seed-content.ts).
  //
  // TO OPEN THE NEXT SUBJECT: flip `enabled` to true and redeploy. This is a
  // deliberate trade-off — the switch is in version control (auditable, reviewed,
  // and impossible to flip by accident from a logged-in browser) rather than in
  // the database. Making it admin-editable at runtime needs a schema migration
  // and an admin screen; see docs/SUBJECT_SECTIONS.md for what that would take.
  curriculumSections: [
    {
      slug: "html",
      title: "HTML5",
      subtitle: "Structure & semantics",
      description:
        "Document structure, semantic elements, text and media, links, lists, tables, and accessible forms.",
      weekNumbers: [1],
      enabled: true,
    },
    {
      slug: "css",
      title: "CSS3",
      subtitle: "Styling & responsive layout",
      description:
        "The cascade, the box model, Flexbox, Grid, responsive breakpoints and modern layout technique.",
      weekNumbers: [2],
      enabled: false,
    },
    {
      slug: "javascript",
      title: "JavaScript",
      subtitle: "Programming the browser",
      description:
        "Types, functions, control flow, the DOM, events, and asynchronous requests.",
      weekNumbers: [3],
      enabled: false,
    },
    {
      slug: "git-deployment",
      title: "Git & Deployment",
      subtitle: "Shipping your work",
      description:
        "Version control with Git and GitHub, collaboration workflow, deployment, and the final project.",
      weekNumbers: [4],
      enabled: false,
    },
  ],
} as const;

export type AppConfig = typeof appConfig;
