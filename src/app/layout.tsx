import type { Metadata, Viewport } from "next";
import { appConfig } from "@/lib/config/app.config";
import "./globals.css";

// OWNERSHIP: ui-shell stream.
// The root layout stays deliberately thin: <html>/<body> plus global tokens.
// The chrome (top bar + role-aware sidebar) lives in <AppShell> and is applied
// per route group, because the shell needs a role and only a page inside an
// authenticated segment knows it. Public pages (landing, sign-in) render bare.

export const metadata: Metadata = {
  title: {
    default: appConfig.branding.appName,
    template: `%s · ${appConfig.branding.appName}`,
  },
  description: appConfig.course.description,
  applicationName: appConfig.branding.appName,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Brand colour for the mobile browser chrome. Read from the token rather than
  // a literal so app.config remains the only place the palette is decided.
  themeColor: appConfig.branding.colors.primary,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
