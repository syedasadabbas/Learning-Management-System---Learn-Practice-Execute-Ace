// =============================================================================
// ATTENDANCE BARREL — pure modules only.
// -----------------------------------------------------------------------------
// `./service` imports @/db and `./actions` is a "use server" module; neither is
// re-exported here, so a client component importing this barrel cannot pull a
// database pool into the browser bundle. Import those directly from server code:
//     import { attendanceGridForWeek } from "@/lib/attendance/service";
//     import { markAttendanceAction } from "@/lib/attendance/actions";
// =============================================================================

export { MIN_ATTENDANCE_PERCENT, participationForWeek } from "./participation";
export type { AttendanceRecord, ParticipationResult } from "./participation";
