/**
 * Shared transition, toggle, focus and backdrop recipes.
 *
 * Usage:
 *   import { transitions, focus } from "@/lib/ui/animations"
 *   <div className={transitions.default}>...</div>
 *
 * Every entry below is imported by at least one call site, and that is the
 * rule this file is kept to. It used to hold 45 constants of which 15 were
 * imported: a keyframe-class alias group nothing but one component used, three
 * dialog backdrops no dialog reads, and ten transition presets, several of
 * them the long `transition-all` this release removed from controls. A recipe
 * nobody imports is not neutral, it is a suggestion, and these suggested the
 * thing we had just finished undoing.
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
//
// Four entries, because four are imported. This was a fourteen-entry menu
// with ten entries nothing had ever imported, and a menu is not free: half of
// them were `transition-all` at 200-500ms, which is the recipe this release
// spent commits removing from controls (a press scale and a hover slide that
// made buttons move), sitting here ready to be reached for again under names
// like `interactive` and `hover` that read like the right answer.
//
// Add one back when a call site needs it, not in advance.
export const transitions = {
  fast: "transition-all duration-150 ease-out",
  default: "transition-all duration-200 ease-out",
  colors: "transition-colors duration-200 ease-out",
  opacity: "transition-opacity duration-200 ease-out",
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
   * Entry for a mark that is mounted rather than restyled when it turns on.
   * This is the tick a user is actually waiting for after a click, so it is
   * the one place a delay is most noticeable: kept to 100ms to match
   * `control`, so the box and the mark inside it finish together.
   */
  markIn: "animate-in fade-in-0 zoom-in-95 duration-100",
} as const;

// FOCUS STATES

// `within` and `none` are not here for the same reason as the transitions
// above: nothing imported them. `ring` is imported 31 times and is the
// focus-visible recipe the radius ladder in CLAUDE.md refers to.
export const focus = {
  ring: "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
} as const;

// The `animations` group is gone. It aliased fifteen keyframe classes behind
// names of its own (`animations.spin` for `animate-spin`), one of which was
// ever imported, while every other call site in the app writes the Tailwind
// class literally. An alias used once is a second name for the same thing,
// and this file's own header explains why a class that lives only in lib/ is
// the riskier of the two names.

// BACKDROP / OVERLAY
//
// The three overlay entries (`modal`, `modalSubtle`, `sheet`) had no
// importers: every dialog in the app takes its overlay from
// components/ui/dialog.tsx, which is where a change to it has to happen.
export const backdrops = {
  header:
    "bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60",
  card: "bg-card/95 backdrop-blur-xs",
} as const;
