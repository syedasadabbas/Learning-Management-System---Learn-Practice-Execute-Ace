// =============================================================================
// Barrel for the courses / access-requests stream's components.
// Import from "@/components/courses"; do not deep-import a file. Mirrors the
// convention "@/components/ui" and "@/components/videos" already set.
// =============================================================================

export { CourseCatalog } from "./CourseCatalog";
export type { CourseCatalogProps, CatalogCourse, CatalogState } from "./CourseCatalog";

export { RequestQueue } from "./RequestQueue";
export type { RequestQueueProps, RequestQueueItem, QueueStatus } from "./RequestQueue";
