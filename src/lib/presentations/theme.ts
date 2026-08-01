// =============================================================================
// PRESENTATION THEMING
// -----------------------------------------------------------------------------
// Reveal ships a dozen themes as full stylesheets (black.css, white.css, ...),
// each of which sets colours, fonts AND layout in one blob. Importing one would
// (a) make presentations look like generic Reveal decks rather than like this
// LMS, and (b) fight the app's Tailwind layer, because those stylesheets style
// bare element selectors like `h1` at global scope.
//
// So we import only Reveal's structural stylesheet (`dist/reveal.css`, which is
// layout and transitions) and supply appearance ourselves through CSS custom
// properties derived from `appConfig.branding.colors`. Changing the brand
// palette in app.config.ts therefore re-skins every presentation, which is the
// property that file promises.
// =============================================================================

import type { CSSProperties } from "react";

import { appConfig } from "@/lib/config/app.config";

/**
 * The custom properties the presentation stylesheet reads.
 *
 * Named with a `--rp-` prefix (reveal presentation) so they cannot collide with
 * Reveal's own `--r-*` variables or with the app's Tailwind theme tokens.
 */
export interface PresentationThemeVars {
  readonly "--rp-bg": string;
  readonly "--rp-fg": string;
  readonly "--rp-accent": string;
  readonly "--rp-primary": string;
  readonly "--rp-muted": string;
  readonly "--rp-code-bg": string;
  readonly "--rp-link": string;
}

/**
 * Relative luminance per WCAG 2.1, used to choose foreground text.
 *
 * Hardcoding white-on-brand would fail contrast the moment someone sets a pale
 * accent as a slide background, and slide text failing contrast on a projector
 * is the single most common accessibility complaint about decks.
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Black or white text, whichever contrasts better against `background`.
 *
 * 0.179 is the luminance at which #000 and #fff have equal contrast ratio
 * against a colour; above it black wins, below it white does.
 */
export function readableForeground(background: string): "#000000" | "#ffffff" {
  return relativeLuminance(background) > 0.179 ? "#000000" : "#ffffff";
}

/**
 * Build the theme variables for a deck.
 *
 * `surfaceOverride` exists for the presenter's dark mode and for a slide that
 * carries its own `backgroundColor`; everything else derives from app config so
 * there is exactly one palette in the product.
 */
export function presentationThemeVars(
  surfaceOverride?: string,
): PresentationThemeVars {
  const { primary, accent, surface } = appConfig.branding.colors;
  const background = surfaceOverride ?? surface;
  const foreground = readableForeground(background);

  return {
    "--rp-bg": background,
    "--rp-fg": foreground,
    "--rp-accent": accent,
    "--rp-primary": primary,
    // 62% opacity against the chosen foreground keeps captions legible while
    // still reading as secondary; a fixed grey would vanish on a dark slide.
    "--rp-muted":
      foreground === "#000000" ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.72)",
    "--rp-code-bg":
      foreground === "#000000" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.10)",
    "--rp-link": primary,
  };
}

/**
 * The same variables as a `style` object React will accept.
 *
 * React's `CSSProperties` does not admit custom properties in its index
 * signature, and the community workaround is `as CSSProperties` on an
 * object literal. That cast is confined to this one function rather than
 * repeated at every call site.
 */
export function presentationThemeStyle(
  surfaceOverride?: string,
): CSSProperties {
  return presentationThemeVars(surfaceOverride) as CSSProperties;
}

/**
 * The same variables serialised for a `<style>` block.
 *
 * Used by the standalone HTML export, which has no React runtime to apply an
 * inline style object.
 */
export function presentationThemeCss(surfaceOverride?: string): string {
  const vars = presentationThemeVars(surfaceOverride);
  return Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
}
