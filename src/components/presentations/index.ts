// Only RevealPresentation and PresenterView are public. RevealDeck is
// deliberately NOT re-exported: it statically imports reveal.js and must only
// ever be reached through RevealPresentation's `next/dynamic({ ssr: false })`
// boundary. Exporting it here is how someone accidentally breaks `next build`.

export { RevealPresentation } from "./RevealPresentation";
export type { RevealPresentationProps } from "./RevealPresentation";

export { PresenterView, formatElapsed } from "./PresenterView";
export type { PresenterViewProps } from "./PresenterView";

export { SlideContent } from "./SlideContent";
