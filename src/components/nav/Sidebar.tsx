"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";
import { NavLinkItem } from "./NavLinkItem";
import { isActiveLink, navLinksFor, ROLE_LABEL, type Role } from "./nav-links";

export interface SidebarProps {
  /** Role of the signed-in user. Passed in as a prop — the nav never reads the
   * session itself, which keeps it a pure, testable, client-safe component. */
  role: Role;
  /** Overrides the pathname used for active detection. Tests only. */
  pathnameOverride?: string;
  /** Mobile drawer state, owned by AppShell. */
  open?: boolean;
  onNavigate?: () => void;
  className?: string;
}

export function Sidebar({
  role,
  pathnameOverride,
  open = false,
  onNavigate,
  className,
}: SidebarProps) {
  const livePathname = usePathname();
  const pathname = pathnameOverride ?? livePathname;
  const links = navLinksFor(role);

  return (
    <nav
      // Referenced by the TopBar toggle's aria-controls.
      id="app-sidebar"
      aria-label={`${ROLE_LABEL[role] ?? "User"} navigation`}
      data-testid="sidebar"
      data-role={role}
      data-open={open}
      className={cn(
        // Off-canvas drawer under md, static column from md up. 200 ms slide.
        "fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-line bg-panel",
        "transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "-translate-x-full",
        "md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:translate-x-0",
        className,
      )}
    >
      {/* The row markup moved to NavLinkItem so a component INSIDE each <Link>
          can call useLinkStatus and light the clicked row up in the same tick
          as the click. The hook returns { pending: false } permanently if it is
          called from an ancestor, which is what an inline .map() would have
          made it. Attributes (data-testid, data-active, aria-current) are
          unchanged, so the existing nav specs still address the same nodes. */}
      <ul className="flex flex-col gap-0.5 overflow-y-auto p-3 pt-16 md:pt-3">
        {links.map((link) => (
          <li key={link.href}>
            <NavLinkItem
              link={link}
              active={isActiveLink(link, pathname)}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
