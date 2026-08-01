// =============================================================================
// NAVIGATION BARREL — import from "@/components/nav".
// Role comes in as a prop from the page (a server component that read the
// session); nothing here imports src/lib/auth, so nav stays client-safe and
// unit-testable without a session.
// Owner: ui-shell stream.
// =============================================================================

export { AppShell } from "./AppShell";
export type { AppShellProps } from "./AppShell";

export { TopBar } from "./TopBar";
export type { TopBarProps } from "./TopBar";

export { Sidebar } from "./Sidebar";
export type { SidebarProps } from "./Sidebar";

export { NavLinkItem } from "./NavLinkItem";
export type { NavLinkItemProps } from "./NavLinkItem";

// The loading.tsx fallback for both route groups. Exported from the barrel so a
// stream that adds its own narrower Suspense boundary uses the same skeleton
// instead of inventing a second visual language for "waiting".
export { PageSkeleton } from "./PageSkeleton";
export type { PageSkeletonProps } from "./PageSkeleton";

export {
  NAV_LINKS,
  ROLES,
  ROLE_LABEL,
  navLinksFor,
  isActiveLink,
} from "./nav-links";
export type { Role, NavLink } from "./nav-links";
