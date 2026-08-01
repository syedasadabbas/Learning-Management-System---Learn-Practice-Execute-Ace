// =============================================================================
// ACTIVITY LOG / AUDIT TRAIL — the barrel other streams import from.
// Owner: activity-logs stream. Import from "@/lib/activity", not from a file.
// -----------------------------------------------------------------------------
// WHAT A CALLING STREAM NEEDS, AND NOTHING ELSE:
//
//   recordActivity(entry, tx)          record an act. Throws if it cannot. Pass
//                                      your transaction and the row commits with
//                                      the act or not at all. THE DEFAULT.
//   recordActivityDetached(entry)      routine, high-volume acts only. Refuses a
//                                      critical action at runtime.
//   originFromRequest / …Headers       NOT exported here — import
//                                      "@/lib/activity/context" directly. It pulls
//                                      in `next/headers`, which would make this
//                                      barrel unusable from a unit test and from
//                                      any non-request context.
//
// HOOK_POINTS is the wiring plan: which route emits which action, whether it is
// transactional, and what belongs in `details`. Read it before adding a call site;
// it is asserted against the frozen route map so it cannot describe routes that no
// longer exist.
// =============================================================================

export {
  ACTION_META,
  ACTIVITY_ACTIONS,
  ACTIVITY_CATEGORIES,
  actionCategory,
  actionLabel,
  actionSignificance,
  actionsInCategory,
  isActivityAction,
  isActivityCategory,
} from "./actions";
export type {
  ActionMeta,
  ActivityActionName,
  ActivityCategory,
  ActivitySignificance,
} from "./actions";

export {
  detachedFailureCount,
  recordActivity,
  recordActivityDetached,
} from "./record";
export type { ActivityDb, ActivityEntry, ActivityOrigin, RecordResult } from "./record";

export {
  DEFAULT_PAGE_SIZE,
  EMPTY_FILTER,
  MAX_EXPORT_ROWS,
  MAX_PAGE_SIZE,
  filterToQuery,
  isFiltered,
  parseActivityFilter,
} from "./filter";
export type { ActivityFilter, FilterParseResult } from "./filter";

export {
  activityActionCounts,
  activityActors,
  activitySummary,
  exportActivity,
  listActivity,
} from "./query";
export type { ActivityRow, ActivitySummary, ListResult } from "./query";

export { CSV_COLUMNS, csvCell, csvFilename, csvLine, toCsv } from "./csv";
export type { CsvColumn, ExportRow } from "./csv";

export {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  PRUNE_BATCH_ROWS,
  PRUNE_BUDGET_MS,
  RECOMMENDED_RETENTION_DAYS,
  countOlderThan,
  pruneActivity,
  retentionCutoff,
  retentionDays,
} from "./retention";
export type { PruneOptions, PruneResult } from "./retention";

export {
  HOOK_POINTS,
  hookPointsForRoute,
  hookedRoutes,
  unwiredActions,
} from "./hook-points";
export type { HookPoint } from "./hook-points";

export {
  CLIENT_FAMILY_MAX_CHARS,
  DETAILS_MAX_BYTES,
  DETAILS_MAX_KEYS,
  DETAIL_STRING_MAX_CHARS,
  REDACTED_MARKER,
  clientFamily,
  coarsenIp,
  isForbiddenDetailKey,
  sanitiseDetails,
} from "./redact";
export type { Details, DetailsInput, DetailValue } from "./redact";
