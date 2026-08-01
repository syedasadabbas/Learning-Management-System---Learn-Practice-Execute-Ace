"use client";

import * as React from "react";
import Link from "next/link";
import { appConfig } from "@/lib/config/app.config";
import { Avatar, Badge, cn } from "@/components/ui";
import { ROLE_LABEL, type Role } from "./nav-links";

export interface TopBarProps {
  role: Role;
  /** Display name of the signed-in user. */
  userName?: string;
  avatarUrl?: string | null;
  /** Home target for the wordmark — differs per role, so the caller decides. */
  homeHref?: string;
  /**
   * Right-hand slot. The auth stream drops its sign-out control in here; ui-shell
   * deliberately does not import from src/lib/auth so nav stays session-free.
   */
  actions?: React.ReactNode;
  /** Mobile drawer toggle, wired by AppShell. */
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  className?: string;
}

export function TopBar({
  role,
  userName,
  avatarUrl,
  homeHref = "/",
  actions,
  onToggleSidebar,
  sidebarOpen = false,
  className,
}: TopBarProps) {
  return (
    <header
      data-testid="top-bar"
      data-role={role}
      className={cn(
        "sticky top-0 z-50 flex h-14 items-center gap-3 border-b border-line bg-panel px-3 sm:px-4",
        className,
      )}
    >
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
          data-testid="sidebar-toggle"
          className={cn(
            "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md",
            "text-ink-muted hover:bg-surface hover:text-ink md:hidden",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          )}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            {sidebarOpen ? "✕" : "☰"}
          </span>
        </button>
      )}

      {/* Wordmark. A text mark rather than <img src={logoPath}> because the logo
          file is still an open decision in app.config (TODO(decision) there) and
          a 404'd image is worse than no image. */}
      <Link
        href={homeHref}
        data-testid="brand-mark"
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-bold text-white"
        >
          {appConfig.branding.appName.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm leading-tight font-semibold text-ink">
            {appConfig.branding.appName}
          </span>
          <span className="hidden truncate text-[11px] leading-tight text-ink-muted sm:block">
            {appConfig.branding.organizationName}
          </span>
        </span>
      </Link>

      <div className="flex-1" />

      <Badge tone="brand" size="sm" data-testid="role-badge">
        {ROLE_LABEL[role] ?? role}
      </Badge>

      {userName && (
        <span className="hidden text-sm text-ink-muted sm:inline">
          {userName}
        </span>
      )}
      {userName && <Avatar name={userName} src={avatarUrl} size="sm" />}

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
