// =============================================================================
// TRACK REGISTRY — the human copy for each track slug.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// `learning_modules.track` is a varchar, so the set of tracks lives in the DATA,
// not in an enum. That is the right call for content that grows, but it leaves
// nowhere to put a track's title and blurb: they are not per-module, so they
// cannot go on a module row without being repeated (and eventually contradicted)
// on every one of them.
//
// So the registry below is presentation copy keyed by slug, and it is NOT the
// authority on which tracks exist — the query is. A track present in the
// database but missing here still renders, under a title derived from its slug;
// a track present here with no published module does not render at all. That
// ordering means adding content can never be blocked on editing this file.
//
// Slugs and prefixes follow docs/research/CURRICULUM_PLAN.md so the two do not
// diverge.
// =============================================================================

import type { LearnLevel } from "./types";

export interface TrackMeta {
  /** `learning_modules.track` value. */
  track: string;
  title: string;
  /** One or two sentences for the /learn index card. */
  summary: string;
  /** Module-slug prefix the content uses, from the curriculum plan's conventions. */
  slugPrefix: string;
  /** Position on the /learn index. Lower first. */
  order: number;
}

export const TRACKS: readonly TrackMeta[] = [
  {
    track: "oop",
    title: "Object-Oriented Programming",
    summary:
      "Splitting a program into units that each own a piece of state and the operations allowed on it. Labs are JavaScript and Python.",
    slugPrefix: "oop-",
    order: 10,
  },
  {
    track: "dbms",
    title: "Database Management",
    summary:
      "Relational databases as a set of guarantees you buy, and the query language you collect on them with. Labs run SQLite in your browser.",
    slugPrefix: "dbms-",
    order: 20,
  },
  {
    track: "dsa",
    title: "Data Structures and Algorithms",
    summary:
      "Choosing a data structure for the operations you actually perform, and reasoning about cost before measuring it.",
    slugPrefix: "dsa-",
    order: 30,
  },
  {
    track: "prompt-engineering",
    title: "Prompt Engineering",
    summary:
      "Writing instructions a language model can follow reliably, and telling a prompt problem apart from a model problem.",
    slugPrefix: "pe-",
    order: 40,
  },
  {
    track: "claude-usage",
    title: "Working with Claude",
    summary:
      "Using Claude as a working tool: context, tools, projects, and where to check its output rather than trust it.",
    slugPrefix: "cu-",
    order: 50,
  },
  {
    track: "llm-apps",
    title: "Building with LLMs",
    summary:
      "Putting a model behind an interface: retrieval, tool calls, evaluation, cost and failure handling.",
    slugPrefix: "llm-",
    order: 60,
  },
  {
    track: "cryptography",
    title: "Applied Cryptography",
    summary:
      "Using the primitives your platform already ships, correctly. Every lab runs on the browser's own SubtleCrypto — nothing here is a from-scratch cipher for production use.",
    slugPrefix: "crypto-",
    order: 70,
  },
  {
    track: "cybersecurity",
    title: "Defensive Security",
    summary:
      "Building software that holds up: input validation, output encoding, password storage, authorization modelling and secure headers. Defensive only, demonstrated against our own fixtures in a sandbox.",
    slugPrefix: "sec-",
    order: 80,
  },
] as const;

const BY_SLUG = new Map(TRACKS.map((t) => [t.track, t]));

/** Registry entry for a track slug, or undefined when the slug is not registered. */
export function trackMeta(track: string): TrackMeta | undefined {
  return BY_SLUG.get(track);
}

/**
 * Turn an unregistered slug into a readable title, so unknown content is still
 * usable rather than blank: "graph-theory" -> "Graph Theory".
 */
export function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Title and summary for a track, registered or not. Never throws. */
export function trackDisplay(track: string): { title: string; summary: string } {
  const meta = trackMeta(track);
  if (meta) return { title: meta.title, summary: meta.summary };
  return { title: titleFromSlug(track), summary: "" };
}

/**
 * Sort key for a track. Registered tracks keep the registry order; unregistered
 * ones sort after all of them, alphabetically, rather than being interleaved at
 * an arbitrary position.
 */
export function trackOrder(track: string): number {
  return trackMeta(track)?.order ?? 10_000;
}

/** Human label for a level, for a badge that must not rely on colour alone. */
export function levelLabel(level: LearnLevel): string {
  switch (level) {
    case "beginner":
      return "Beginner";
    case "intermediate":
      return "Intermediate";
    case "advanced":
      return "Advanced";
    default:
      return titleFromSlug(String(level));
  }
}
