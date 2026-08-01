// =============================================================================
// BADGE CATALOGUE — the single source of truth for what a badge IS.
// Owner: badges stream.
// -----------------------------------------------------------------------------
// This file is the half of the badges feature that IMPLEMENTATION_ROADMAP.md put
// in a `badges` table with a `criteria` jsonb column. The argument for moving it
// into code is written out in full in src/db/schema.badges.ts:29-64; the short
// version is that `{ type: 'quiz_score', value: 95 }` is only meaningful to code
// that knows the string "quiz_score", so the decision procedure lives in
// TypeScript either way and a database copy of it is a second opinion waiting to
// disagree. src/lib/contracts/scoring.ts:6-10 made the same call for the same
// stated reason.
//
// -----------------------------------------------------------------------------
// WHICH BADGES SHIPPED, AND WHY THE OTHER THREE DID NOT.
//
// The roadmap's `badgeTypes` enum (IMPLEMENTATION_ROADMAP.md:224-233) lists eight.
// Five are here. The three that are not are omitted because THE DATA THEY WOULD BE
// COMPUTED FROM DOES NOT EXIST IN THIS REPOSITORY, and a badge nobody can ever
// earn is worse than an absent one: it renders as a permanently locked card that
// tells the student they have failed at something unavailable.
//
//   * `peer_review_master` — peer review is roadmap feature 6, PHASE 2
//     (roadmap:427). There is no `peer_reviews` table.
//   * `forum_helper` — discussion forums are roadmap feature 5, PHASE 2
//     (roadmap:383). There is no `forum_posts` table.
//   * `consecutive_days` — needs a per-day record of student activity. The only
//     thing that would provide it is `activity_logs`, roadmap feature 4
//     (roadmap:326), which is a DIFFERENT STREAM IN THIS SAME WAVE and may or may
//     not be on the branch this merges into. Guessing at its column names from the
//     roadmap and shipping a query against a table that might not exist would turn
//     a missing badge into a 500 on the dashboard.
//
// TODO(badges): add `consecutive_days` once `activity_logs` has landed. It is a
// `count(distinct date_trunc('day', created_at))` over a 7-day window per student,
// and the shape of the rest of this module — a fact in ./facts.ts, a pure rule in
// ./evaluate.ts, one catalogue row here — is exactly what it needs. The same is
// true of the two PHASE 2 badges. Nothing about the schema has to change: `type`
// is a varchar precisely so adding one is code rather than an ALTER TYPE
// (src/db/schema.badges.ts:126-152).
//
// TODO(badges): the roadmap also asks for "Admin badge management". Not shipped,
// and it needs a decision this stream should not make alone: with the catalogue in
// code, the only thing an admin could edit is presentation (name, description,
// glyph, rarity), NOT criteria — and an admin panel whose fields are all cosmetic
// invites the assumption that the threshold next to them is editable too. The
// honest version is either a read-only catalogue view for staff or a genuine rules
// engine, and the second one needs the criteria vocabulary frozen first.
//
// All thresholds derive from src/lib/contracts/scoring.ts where a scoring rule
// already exists. Metric units throughout (house rule).
// =============================================================================

import { courseMaxScore, letterGrade } from "@/lib/contracts/scoring";
import type { BadgeTone } from "@/components/ui";

/**
 * Every badge this build can award.
 *
 * The order is the order the /badges page renders them in: roughly "easiest
 * first", so a student with none sees an achievable one at the top rather than a
 * wall of legendary.
 */
export const BADGE_TYPES = [
  "first_submission",
  "perfect_quiz",
  "all_assignments_ontime",
  "coding_genius",
  "high_score",
] as const;

export type BadgeType = (typeof BADGE_TYPES)[number];

/**
 * Rarity tiers, from the roadmap (IMPLEMENTATION_ROADMAP.md:243, and
 * INTEGRATION_SUMMARY.md:107 which credits Coursera for the idea).
 *
 * Purely presentational — nothing branches on rarity except the colour of the pill
 * and the sort order above. It is NOT a difficulty score the evaluator reads.
 */
export const BADGE_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type BadgeRarity = (typeof BADGE_RARITIES)[number];

/**
 * Rarity -> tone on the SHARED `Badge` primitive (src/components/ui/Badge.tsx).
 *
 * Note the collision this mapping sits on top of, because it is the confusing part
 * of this whole feature: `Badge` in src/components/ui is a PILL — a visual label
 * primitive. A "badge" in this module is an AWARDED ACHIEVEMENT. Two different
 * concepts, one English word. This file and everything under
 * src/components/badges/** therefore say "achievement" in every component name
 * (AchievementCard, AchievementGrid) and reuse the primitive for rendering rather
 * than forking its pill styles, which is the rule stated at
 * src/components/ui/index.ts:4-6.
 */
export const RARITY_TONE: Record<BadgeRarity, BadgeTone> = {
  common: "neutral",
  rare: "brand",
  epic: "accent",
  legendary: "warning",
};

export interface BadgeDefinition {
  type: BadgeType;
  /** Shown as the card title. */
  name: string;
  /** One sentence, second person, present tense. */
  description: string;
  /**
   * A TEXT GLYPH, not an icon URL. IMPLEMENTATION_ROADMAP.md:240 specifies
   * `iconUrl varchar(500) NOT NULL`; there is no asset pipeline and no blob store
   * in this repo, and every other visual affordance in the app is a glyph chosen
   * in code — see the `glyph` field on every row of
   * src/components/nav/nav-links.ts. Decorative, so it is rendered aria-hidden.
   */
  glyph: string;
  rarity: BadgeRarity;
  /**
   * How to earn it, in the student's own terms, INCLUDING the number.
   *
   * Rendered verbatim on an unearned card. A gamification feature that will not
   * say what the threshold is trains students to treat it as random, which is the
   * opposite of the 10-15% engagement effect it is here for
   * (INTEGRATION_SUMMARY.md:109).
   */
  criteria: string;
}

/**
 * How many distinct coding problems must be fully solved for `coding_genius`.
 *
 * Not derived from anything — there is no scoring rule about coding problems, so
 * this is a judgement call and is labelled as one. 10 is roughly a third of the
 * seeded bank, which makes it a real milestone rather than a participation trophy,
 * and it does not move if the bank grows (a percentage would silently re-lock the
 * badge for students who already earned it, and this table has no un-award path).
 */
export const CODING_GENIUS_PROBLEMS = 10;

/**
 * The total score at which `high_score` is earned: the bottom of grade A.
 *
 * DERIVED, never hardcoded. `letterGrade` puts A at >= 90% of `courseMaxScore()`
 * (src/lib/contracts/scoring.ts:143-156), and `courseMaxScore()` is itself derived
 * from the course length in app.config — a literal here would rot the first time
 * the course is not four weeks long, exactly as the literal 330 described at
 * scoring.ts:128-131 did.
 */
export function highScoreThreshold(maxScore: number = courseMaxScore()): number {
  const threshold = Math.ceil(maxScore * 0.9);
  // Belt and braces against a future change to the grade bands: assert the
  // threshold really is an A rather than trusting that 0.9 still matches.
  return letterGrade(threshold, maxScore) === "A" ? threshold : maxScore;
}

export const BADGE_CATALOGUE: Record<BadgeType, BadgeDefinition> = {
  first_submission: {
    type: "first_submission",
    name: "First steps",
    description: "You submitted your first assignment.",
    glyph: "✦",
    rarity: "common",
    criteria: "Submit any assignment once.",
  },
  perfect_quiz: {
    type: "perfect_quiz",
    name: "Flawless",
    description: "You scored 100% on a quiz.",
    glyph: "◎",
    rarity: "rare",
    criteria: "Score 100% on any quiz attempt.",
  },
  all_assignments_ontime: {
    type: "all_assignments_ontime",
    name: "Always on time",
    description: "You submitted every assignment in the course before its deadline.",
    glyph: "◔",
    rarity: "epic",
    // The wording is load-bearing: EVERY assignment, so this cannot be earned
    // early by a student who has submitted one thing on time. See ./evaluate.ts.
    criteria: "Submit every assignment in the course, none of them late.",
  },
  coding_genius: {
    type: "coding_genius",
    name: "Coding genius",
    description: `You solved ${CODING_GENIUS_PROBLEMS} coding problems.`,
    glyph: "❯",
    rarity: "epic",
    criteria: `Pass every test on ${CODING_GENIUS_PROBLEMS} different coding problems.`,
  },
  high_score: {
    type: "high_score",
    name: "Top of the class",
    description: "Your total score reached grade A.",
    glyph: "▲",
    rarity: "legendary",
    criteria: "Reach a total score in the A band (90% of the course maximum).",
  },
};

/** The catalogue as a list, in BADGE_TYPES order. */
export const BADGE_LIST: readonly BadgeDefinition[] = BADGE_TYPES.map(
  (t) => BADGE_CATALOGUE[t],
);

/**
 * Runtime membership test, for a `type` string arriving from the database.
 *
 * The column is a varchar, so this is the boundary that keeps an unrecognised row
 * — a badge from a newer deploy, or a hand-inserted typo — from reaching the UI as
 * a card with no name. Callers drop what this rejects; they do not throw. A stale
 * row is not a reason to fail a page load.
 */
export function isBadgeType(value: unknown): value is BadgeType {
  return typeof value === "string" && (BADGE_TYPES as readonly string[]).includes(value);
}

/** Definition for a type, or null when the type is not in this build. */
export function badgeDefinition(type: string): BadgeDefinition | null {
  return isBadgeType(type) ? BADGE_CATALOGUE[type] : null;
}
