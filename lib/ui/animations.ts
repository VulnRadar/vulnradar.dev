/**
 * Centralized Animation & Transition Configuration
 * ================================================
 * All animations, transitions, and motion settings are defined here.
 * Import these constants to ensure consistency across all pages.
 *
 * Usage:
 *   import { transitions, animations } from "@/lib/ui/animations"
 *   <div className={transitions.default}>...</div>
 *
 * One constraint worth knowing before adding to this file: tailwind.config.mjs
 * does NOT scan lib/, so a Tailwind class whose only appearance in the repo is
 * here generates no CSS, with no build error. Tailwind extracts candidates
 * token by token, so composing from tokens that already appear under
 * components/ or app/ is safe; inventing a new one (an arbitrary value such as
 * `active:scale-[0.98]`, say) is not, and has to be added to the
 * `@source inline(...)` safelist in app/globals.css as well.
 *
 * That paragraph is kept as the house rule but is no longer literally true:
 * Tailwind v4's automatic source detection does scan lib/, so the class is
 * generated either way. See the measured write-up in app/globals.css before
 * diagnosing anything as a missing-class problem. Follow the rule regardless,
 * since it costs nothing and it is what keeps this file safe.
 */

// STANDARD TRANSITIONS (combine duration + easing)

export const transitions = {
  // Basic transitions
  none: "",
  instant: "transition-all duration-75 ease-out",
  fast: "transition-all duration-150 ease-out",
  default: "transition-all duration-200 ease-out",
  normal: "transition-all duration-300 ease-out",
  slow: "transition-all duration-500 ease-out",

  // Specific property transitions
  colors: "transition-colors duration-200 ease-out",
  opacity: "transition-opacity duration-200 ease-out",
  transform: "transition-transform duration-200 ease-out",
  shadow: "transition-shadow duration-200 ease-out",

  // Combined common patterns
  interactive: "transition-all duration-150 ease-out", // buttons, links
  hover: "transition-all duration-200 ease-out", // hover states
  modal: "transition-all duration-300 ease-out", // modals, sheets
  page: "transition-all duration-500 ease-out", // page transitions
} as const;

// TOGGLES / SEGMENTED CONTROLS
//
// Pressed-state controls -- segmented filters, view switches, page-size
// pickers, expand/collapse -- had no shared motion rule, so each was written
// with whatever transition its author remembered and several had none at all:
// the state change landed as a hard snap. Everything here is short on purpose.
// A toggle is a control a user clicks repeatedly, and a filter that takes
// 300ms to acknowledge a click reads as lag rather than polish.
//
// These were 150ms on their first pass and read as slightly laggy. 150ms is
// the right ballpark for an incidental hover, but a toggle's selected state is
// direct manipulation: the user has already decided, and the animation is only
// there to stop the change arriving as a hard cut. Past roughly 100ms that
// stops being softening and starts being a wait. The reason it is worse here
// than the number alone suggests is that a toggle row is not one element: in
// the scan-form check-family and active-probe lists the row background carries
// this transition while the label inside it recolours with none, so at 150ms
// the surface visibly trails text that has already committed. At 100ms that
// mismatch drops below the threshold where it reads as two separate events.
// (The real fix for those two lists is to put `toggles.control` on the label
// span as well; that file is owned elsewhere.)
//
// Deliberately NOT split into a fast pressed timing and a slower hover one:
// in every real call site a single element carries both the selected
// background and the hover background, so one class governs both states and
// CSS cannot time them apart without a second rule per control. 100ms is a
// good hover timing too, so the split would buy nothing.
//
// `transition-all` is deliberately not used: on a segmented control it also
// animates width and padding, so the whole row shuffles whenever an active
// label is a different length from the one it replaced.
//
// prefers-reduced-motion is already honoured globally in app/globals.css,
// which clamps every transition-duration to 0.01ms. `motion-reduce:
// transition-none` is still spelled out on the transform-based entries so the
// intent survives if that global rule is ever narrowed.
//
// On the "lib/ is not scanned" warning at the top of this file: it no longer
// holds. Tailwind v4's automatic source detection reaches lib/, verified
// against the production bundle and written up in app/globals.css. The rule is
// kept here and in tests/lib/ui/animations.test.ts anyway, because composing
// from tokens that already exist under components/ costs nothing and is the
// only thing that keeps this file safe if the build is ever narrowed again.
// `duration-100` satisfies it via components/shared/site-notifications.tsx and
// `motion-reduce:transition-none` via components/scanner/inline-auth-form.tsx.
export const toggles = {
  /** The toggle's own surface: text, background and border settle together. */
  control: "transition-colors duration-100 ease-out",
  /** A mark inside a toggle (a tick, a dot) that moves rather than recolours. */
  indicator:
    "transition-transform duration-100 ease-out motion-reduce:transition-none",
  /**
   * A caret that rotates when the section it heads expands. Slower than the
   * rest on purpose: this one is not a confirmation, it is the visual half of
   * a panel opening, and it should keep pace with the panel rather than the
   * click.
   */
  chevron:
    "transition-transform duration-150 ease-out motion-reduce:transition-none",
  /**
   * Entry for a mark that is mounted rather than restyled when it turns on.
   * This is the tick a user is actually waiting for after a click, so it is
   * the one place a delay is most noticeable: kept to 100ms to match
   * `control`, so the box and the mark inside it finish together.
   */
  markIn: "animate-in fade-in-0 zoom-in-95 duration-100",
} as const;

// FOCUS STATES

export const focus = {
  ring: "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
  within: "focus-within:ring-2 focus-within:ring-ring",
  none: "focus:outline-hidden focus-visible:outline-hidden",
} as const;

// ANIMATION CLASSES (for keyframe animations)

export const animations = {
  // Fade
  fadeIn: "animate-fade-in",
  fadeOut: "animate-fade-out",

  // Slide
  slideUp: "animate-slide-up",
  slideDown: "animate-slide-down",
  slideLeft: "animate-slide-left",
  slideRight: "animate-slide-right",

  // Scale
  scaleIn: "animate-scale-in",
  scaleOut: "animate-scale-out",

  // Special
  pulse: "animate-pulse",
  spin: "animate-spin",
  bounce: "animate-bounce",
  ping: "animate-ping",

  // Custom
  shimmer: "animate-shimmer",
  glow: "animate-glow",
  float: "animate-float",
} as const;

// BACKDROP / OVERLAY

export const backdrops = {
  modal: "bg-black/80 backdrop-blur-md",
  modalSubtle: "bg-black/60 backdrop-blur-xs",
  sheet: "bg-black/50 backdrop-blur-xs",
  header:
    "bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60",
  card: "bg-card/95 backdrop-blur-xs",
} as const;
