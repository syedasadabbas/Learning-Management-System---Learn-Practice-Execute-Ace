// =============================================================================
// PRESENTATION BUILDER BARREL — the EDITOR only.
// -----------------------------------------------------------------------------
// The VIEWER already exists one directory up (`RevealPresentation`,
// `PresenterView`, `SlideContent`) and is composed by these components rather
// than reimplemented. Nothing here renders slides itself.
// =============================================================================

export { PresentationBuilder, newDeck } from "./PresentationBuilder";
export type { PresentationBuilderProps } from "./PresentationBuilder";

export { SlideEditor } from "./SlideEditor";
export type { SlideEditorProps } from "./SlideEditor";

export { SlideContentEditor, textToBullets, bulletsToText } from "./SlideContentEditor";
export type { SlideContentEditorProps } from "./SlideContentEditor";

export { SlideThumbnails } from "./SlideThumbnails";
export type { SlideThumbnailsProps } from "./SlideThumbnails";

export { ThemeSelector, SpeakerNotes, EDITOR_THEMES } from "./SpeakerNotes";
export type { ThemeSelectorProps, SpeakerNotesProps } from "./SpeakerNotes";

export {
  moveSlide,
  removeSlide,
  insertSlideAfter,
  duplicateSlide,
  replaceSlide,
  blankSlide,
  newSlideId,
} from "./slide-ops";
