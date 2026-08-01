// =============================================================================
// EXERCISE DRAFT PERSISTENCE — a student's edits survive a reload.
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// THE PROBLEM THIS SOLVES
// Nothing in the app stored exercise edits anywhere: a grep for localStorage,
// sessionStorage and indexedDB across src/ returned zero hits, and no table in
// src/db/schema.ts holds Sandpack file contents. So every reload, every
// navigation away and back, and every re-render that reset the Sandpack provider
// silently discarded whatever the student had typed. For a "try it yourself"
// exercise that is the whole value of the feature.
//
// WHY localStorage AND NOT THE DATABASE
// These exercises carry no marks (they are practice, not submissions — see
// src/lib/exercises/types.ts), so a draft is personal scratch work, not evidence.
// Persisting it server-side would mean a new table, a write on every keystroke
// debounce, and a per-student row for content nobody grades. localStorage costs
// nothing, works offline, and cannot leak one student's draft to another because
// it is scoped to the browser profile. The trade-off, stated plainly: a draft
// does NOT follow the student to another device or survive clearing site data.
// If drafts ever need to be portable, that is a schema change, not a tweak here.
//
// EVERY FAILURE MODE HERE IS NON-FATAL. localStorage throws when it is full,
// when the browser is in a privacy mode that disables it, and when a cross-origin
// iframe touches it. A student whose storage is full must still be able to use
// the editor — they just lose persistence. So every entry point is wrapped and
// returns a neutral value rather than propagating.
// =============================================================================

/**
 * Key prefix, versioned.
 *
 * The version is part of the KEY, not the value: bumping it orphans every old
 * draft instead of requiring migration code that would have to understand a
 * shape nobody keeps around. Orphans are then cleared by `pruneStaleDrafts`.
 */
const STORAGE_PREFIX = "lms:exercise-draft:v1:";

/**
 * Refuse to store a draft larger than this (characters, ≈bytes for ASCII source).
 *
 * localStorage is a shared ~5 MB budget for the whole origin. One pathological
 * exercise — a student pasting a minified library — must not consume it and
 * evict every other draft. 256 kB is far above any hand-written practice file.
 */
const MAX_DRAFT_CHARS = 256_000;

/** Drafts older than this are pruned on next load. Milliseconds (house rule 5). */
const DRAFT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface ExerciseDraft {
  /** Sandpack `files` prop shape: path -> source. */
  files: Record<string, string>;
  /** The tab the student was last looking at. */
  activeFile: string;
  /**
   * Fingerprint of the STARTER the draft was made against.
   *
   * Without this, an instructor editing an exercise would leave every student
   * who had touched it stuck on the old starter forever, with no way to see the
   * new one short of pressing reset — and no reason to suspect they should.
   * A mismatch discards the draft, which loses that student's edits exactly
   * once, at the moment the exercise legitimately changed underneath them.
   */
  starterFingerprint: string;
  /** Epoch milliseconds of the last write, for TTL pruning. */
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Order-independent, deterministic fingerprint of a file map.
 *
 * FNV-1a over the sorted `path\0code` pairs. Not cryptographic and does not need
 * to be: it guards against an instructor's content edit, not against a student
 * forging a collision — and the worst outcome of a collision is that one stale
 * draft is kept rather than discarded.
 */
export function fingerprintFiles(files: Record<string, string>): string {
  const parts = Object.keys(files)
    .sort()
    .map((path) => `${path}\u0000${files[path]}`)
    .join("\u0001");

  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    // FNV prime, via shifts so this stays in 32-bit integer arithmetic.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return `${parts.length.toString(36)}-${hash.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Storage access
// ---------------------------------------------------------------------------

/**
 * The backing store, or null when unavailable.
 *
 * Returns null during server rendering (no `window`) and whenever touching
 * localStorage throws — Safari's private mode and some embedded webviews raise
 * on ACCESS, not just on write, so the probe has to be inside the try.
 */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyFor(exerciseId: string): string {
  return `${STORAGE_PREFIX}${exerciseId}`;
}

function isDraft(value: unknown): value is ExerciseDraft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Partial<ExerciseDraft>;
  if (typeof d.activeFile !== "string") return false;
  if (typeof d.starterFingerprint !== "string") return false;
  if (typeof d.savedAt !== "number" || !Number.isFinite(d.savedAt)) return false;
  if (typeof d.files !== "object" || d.files === null) return false;
  // Every value must be a string; a nested object here would reach Sandpack as
  // a file whose `code` is not source and blank the preview with no explanation.
  return Object.values(d.files).every((v) => typeof v === "string");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The saved draft for an exercise, or null when there is none to use.
 *
 * Returns null — meaning "fall back to the starter" — for a missing key, corrupt
 * JSON, a shape that fails validation, an expired draft, and a fingerprint that
 * no longer matches the starter. Corrupt and stale entries are DELETED on the
 * way out so a broken value cannot be re-parsed on every mount forever.
 */
export function loadDraft(
  exerciseId: string,
  starterFingerprint: string,
): ExerciseDraft | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(keyFor(exerciseId));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft(exerciseId);
    return null;
  }

  if (!isDraft(parsed)) {
    clearDraft(exerciseId);
    return null;
  }

  if (parsed.starterFingerprint !== starterFingerprint) {
    // The exercise itself changed. Discard rather than show the old content.
    clearDraft(exerciseId);
    return null;
  }

  if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
    clearDraft(exerciseId);
    return null;
  }

  return parsed;
}

/**
 * Write a draft. Returns true when it was stored.
 *
 * Silently declines to store an oversized draft (see MAX_DRAFT_CHARS) rather
 * than throwing or evicting someone else's work, and swallows the quota error
 * that a full store raises. The student keeps editing either way; only the
 * persistence is lost, which is strictly better than an exception unmounting the
 * editor they are typing into.
 */
export function saveDraft(
  exerciseId: string,
  draft: Omit<ExerciseDraft, "savedAt">,
): boolean {
  const store = storage();
  if (!store) return false;

  const payload: ExerciseDraft = { ...draft, savedAt: Date.now() };
  let serialised: string;
  try {
    serialised = JSON.stringify(payload);
  } catch {
    return false;
  }
  if (serialised.length > MAX_DRAFT_CHARS) return false;

  try {
    store.setItem(keyFor(exerciseId), serialised);
    return true;
  } catch {
    // Most likely QuotaExceededError. Try once more after pruning, because the
    // usual cause is our own accumulated drafts rather than a genuinely full
    // store — but do not loop, and do not delete anything that is not ours.
    try {
      pruneStaleDrafts();
      store.setItem(keyFor(exerciseId), serialised);
      return true;
    } catch {
      return false;
    }
  }
}

/** Remove one draft. Used by the reset button and by every rejection above. */
export function clearDraft(exerciseId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(keyFor(exerciseId));
  } catch {
    // Nothing to do: failing to clear a draft is not worth surfacing.
  }
}

/**
 * Delete expired drafts belonging to this app.
 *
 * Only touches keys carrying STORAGE_PREFIX — never clears the store wholesale,
 * which would take Auth.js state and anything else the origin owns with it.
 */
export function pruneStaleDrafts(now: number = Date.now()): number {
  const store = storage();
  if (!store) return 0;

  let removed = 0;
  try {
    // Collect first, delete after: removing during iteration reindexes the store
    // and silently skips entries.
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const raw = store.getItem(key);
      if (!raw) {
        doomed.push(key);
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isDraft(parsed) || now - parsed.savedAt > DRAFT_TTL_MS) doomed.push(key);
      } catch {
        doomed.push(key);
      }
    }
    for (const key of doomed) {
      store.removeItem(key);
      removed += 1;
    }
  } catch {
    return removed;
  }
  return removed;
}

/** Exported for tests so they assert the real bounds rather than copies. */
export const DRAFT_LIMITS = {
  MAX_DRAFT_CHARS,
  DRAFT_TTL_MS,
  STORAGE_PREFIX,
} as const;
