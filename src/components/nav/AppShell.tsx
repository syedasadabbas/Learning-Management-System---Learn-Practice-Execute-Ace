"use client";

import * as React from "react";
import { cn } from "@/components/ui";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { Role } from "./nav-links";

export interface AppShellProps {
  /** Role of the signed-in user. Every feature page passes this down; the shell
   * never reads the session, so it stays a pure client component. */
  role: Role;
  userName?: string;
  avatarUrl?: string | null;
  homeHref?: string;
  /** Right-hand top-bar slot (the auth stream's sign-out control goes here). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Page frame: sticky top bar + role-aware sidebar + main content column.
 * Owns only the mobile drawer state, so it is safe to render on every page.
 */
export function AppShell({
  role,
  userName,
  avatarUrl,
  homeHref = "/",
  actions,
  children,
  className,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <div data-testid="app-shell" className="min-h-screen bg-surface">
      {/* First tab stop: skip past the whole nav straight to the content. */}
      <a
        href="#main-content"
        className={cn(
          "sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-60",
          "focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-white",
        )}
      >
        Skip to main content
      </a>

      <TopBar
        role={role}
        userName={userName}
        avatarUrl={avatarUrl}
        homeHref={homeHref}
        actions={actions}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      <div className="flex">
        <Sidebar
          role={role}
          open={sidebarOpen}
          onNavigate={() => setSidebarOpen(false)}
        />

        {/* Scrim closes the mobile drawer. Not a tab stop — the toggle button
            and Escape-free design mean the button remains the keyboard path. */}
        {sidebarOpen && (
          <div
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
            data-testid="sidebar-scrim"
            className="fixed inset-0 z-30 bg-ink/40 md:hidden"
          />
        )}

        <main
          id="main-content"
          className={cn("min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8", className)}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
