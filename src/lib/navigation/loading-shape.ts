// =============================================================================
// LOADING SHAPE — which skeleton a pending route should paint.
// -----------------------------------------------------------------------------
// Owner: ui-shell stream (navigation). Pure data + a pure function, deliberately
// free of React so the mapping can be unit-tested without rendering anything.
//
// WHY A SHAPE TABLE AND NOT ONE GENERIC SKELETON
//
// A skeleton is only worth showing if it is a promise the page keeps. A generic
// grey block that is replaced by a four-column table reads as a second layout
// change, which is the thing that makes an app feel unsettled — the user sees
// two transitions instead of one. So the skeleton is chosen from the pathname
// the router has ALREADY committed to (App Router updates the URL and the
// active nav item at click time, before the server has answered), and each
// entry mirrors the real page's above-the-fold structure:
//
//   /weeks              -> a grid of week cards          (WeekCard grid)
//   /dashboard          -> stat tiles + a list           (progress summary)
//   /leaderboard        -> a dense table                 (standings rows)
//   /problems, /learn   -> a list of rows                (browse lists)
//   everything else     -> heading + prose block
//
// WHY THE PATHNAME AND NOT A PER-SEGMENT loading.tsx FILE
//
// Next's loading.tsx receives NO props — no params, no pathname — so a
// per-route shape would need one file per segment (twenty-odd of them), each a
// separate Suspense boundary to keep in step with a page owned by a different
// stream. One boundary per route group plus this table is one place to edit and
// one place to test. The cost is that the skeleton is picked in the client
// component that reads usePathname; that is ~1 kB, measured, not assumed.
//
// ORDER MATTERS: the table is scanned longest-prefix-first, the same rule
// src/middleware.ts uses for its PROTECTED list, so "/leaderboard/me" cannot be
// captured by a shorter sibling that happens to be declared earlier.
// =============================================================================

/** The skeleton layouts PageSkeleton knows how to draw. */
export type LoadingShape = "cards" | "dashboard" | "table" | "list" | "prose";

export interface LoadingShapeSpec {
  shape: LoadingShape;
  /**
   * How many placeholder units to draw (cards, rows, tiles). Chosen to match
   * what the real page usually shows above the fold — an over-long skeleton
   * makes the page appear to SHRINK when the data lands, which is a worse
   * transition than a slightly short one growing.
   */
  count: number;
}

interface ShapeRule extends LoadingShapeSpec {
  prefix: string;
}

const RULES: ReadonlyArray<ShapeRule> = (
  [
    // Student surfaces -------------------------------------------------------
    // Four weeks is the seeded curriculum length (scripts/seed.ts) and the
    // number /weeks renders today.
    { prefix: "/weeks", shape: "cards", count: 4 },
    { prefix: "/dashboard", shape: "dashboard", count: 4 },
    // /courses is the catalogue of OTHER courses, added to the student sidebar
    // in 11:50 on 2026-07-31 — after this table was written, which is why
    // loading-shape.test.ts was failing on `student:/courses` before this rule
    // existed. Four is the seeded course count.
    //
    // The rule also captures /courses/[courseId], the detail page, whose real
    // shape is a heading plus a week outline rather than a card grid. Stated
    // rather than split, because a prefix cannot distinguish the two: the detail
    // URL is /courses/<id> with nothing constant to match on. Cards is the
    // closer of the two available guesses for the page that is reached by a
    // sidebar click, and that is the click this table exists to serve.
    { prefix: "/courses", shape: "cards", count: 4 },
    { prefix: "/leaderboard", shape: "table", count: 8 },
    { prefix: "/problems", shape: "list", count: 6 },
    { prefix: "/learn", shape: "cards", count: 6 },
    { prefix: "/interview", shape: "list", count: 6 },
    { prefix: "/practice", shape: "cards", count: 3 },
    { prefix: "/assignments", shape: "list", count: 4 },
    // /badges — the achievements grid, added to the student sidebar by the badges
    // stream. Cards, because the page IS a card grid
    // (src/components/badges/AchievementGrid.tsx renders one AchievementCard per
    // catalogue entry, 1/2/3 columns by breakpoint). Five is the catalogue length,
    // written as a literal for the same reason "/weeks" hardcodes four: this table
    // is deliberately React- and import-free, and pulling in BADGE_TYPES to save a
    // digit would make it depend on a feature module. If the catalogue grows, the
    // skeleton is one card short — which grows into place, the direction this
    // file's own comment prefers over a skeleton that shrinks.
    { prefix: "/badges", shape: "cards", count: 5 },
    // /notifications — a reverse-chronological history list plus the preference
    // form beneath it. "list", not "cards": the page renders rows, and a skeleton
    // that paints cards where rows arrive is a worse lie than a plain block. Eight
    // rows because the history reads up to fifty but only about that many fit
    // above the fold, and this table's own rule is to under-fill rather than
    // over-fill — a skeleton that shrinks on arrival reads as content being taken
    // away.
    { prefix: "/notifications", shape: "list", count: 8 },
    // /certificates — the credential gallery. Cards, matching the page. Two rather
    // than the badge grid's five: a certificate is per completed COURSE, and a
    // student on the seeded curriculum can hold one. Two leaves room for the
    // second without promising a wall of them.
    { prefix: "/certificates", shape: "cards", count: 2 },
    // /forums — the per-week discussion index, and the thread pages beneath it.
    // "list", not "cards": every one of the three surfaces renders ROWS (weeks with
    // a discussion count, then threads, then posts), and a skeleton that paints
    // cards where rows arrive is a worse lie than a plain block — the same argument
    // the /notifications entry above makes.
    //
    // FOUR, matching the seeded curriculum length (scripts/seed.ts), because the
    // index is one row per week and that is the count it will show. The deeper
    // routes are longest-prefix matches on this same rule and will usually hold
    // more rows than four, which under-fills rather than over-fills — this table's
    // own stated preference, since a skeleton that shrinks on arrival reads as
    // content being taken away.
    { prefix: "/forums", shape: "list", count: 4 },
    { prefix: "/quizzes", shape: "prose", count: 1 },
    { prefix: "/exams", shape: "prose", count: 1 },
    { prefix: "/settings", shape: "prose", count: 1 },

    // Staff surfaces ---------------------------------------------------------
    // Every staff page is a queue or a report, so a table is the honest shape.
    { prefix: "/instructor/grading", shape: "table", count: 6 },
    { prefix: "/instructor/students", shape: "table", count: 8 },
    { prefix: "/instructor/analytics", shape: "dashboard", count: 4 },
    { prefix: "/instructor", shape: "dashboard", count: 4 },
    { prefix: "/admin/analytics", shape: "dashboard", count: 4 },
    { prefix: "/admin/videos", shape: "list", count: 6 },
    { prefix: "/admin/students", shape: "table", count: 8 },
    // /admin/activity — the audit trail. "table", not the "/admin" fallback's
    // "list": the page is a filtered log with a column per field, and the fallback
    // would paint rows of the wrong shape. Count 10 rather than the usual 8 because
    // an audit page is read by scrolling, so a slightly taller skeleton is closer
    // to what arrives.
    { prefix: "/admin/activity", shape: "table", count: 10 },
    { prefix: "/admin", shape: "list", count: 6 },
    { prefix: "/attendance", shape: "table", count: 8 },
  ] satisfies ShapeRule[]
)
  .slice()
  .sort((a, b) => b.prefix.length - a.prefix.length);

/** The shape used when nothing matches. Heading + prose is the safest guess:
 *  every page in the app has a heading, so at minimum the skeleton is not
 *  claiming structure the page does not have. */
export const DEFAULT_SHAPE: LoadingShapeSpec = { shape: "prose", count: 1 };

/**
 * Which skeleton should be drawn while `pathname` is loading?
 *
 * Never throws and never returns undefined — a pending navigation is the worst
 * possible moment to render an error, and a missing entry must degrade to a
 * plausible skeleton rather than to nothing at all (nothing at all is exactly
 * the frozen-page behaviour this whole change exists to remove).
 */
export function loadingShapeFor(
  pathname: string | null | undefined,
): LoadingShapeSpec {
  if (!pathname) return DEFAULT_SHAPE;
  for (const rule of RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return { shape: rule.shape, count: rule.count };
    }
  }
  return DEFAULT_SHAPE;
}

/** Exported for the test that asserts every nav destination has a shape. */
export const LOADING_SHAPE_PREFIXES: readonly string[] = RULES.map(
  (r) => r.prefix,
);
