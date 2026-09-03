/**
 * One modal grammar, in one file.
 *
 * Before this, the product shipped four incompatible modal shells: the padded
 * shadcn `DialogContent`, an ad-hoc three-band shell that a handful of newer
 * modals hand-rolled with their own padding and divider opacity, an
 * `AlertDialog` with a third set of numbers, and seven `<div className="fixed
 * inset-0">` overlays in the admin area that painted their own `bg-black/60`
 * scrim and `rounded-xl` panel. Opening two of them in a row looked like two
 * different products.
 *
 * The three-band shell won, because it is the only one that keeps a footer
 * reachable on a short viewport. These strings are what every modal surface in
 * the app is built from: components/ui/dialog.tsx, alert-dialog.tsx, sheet.tsx
 * and modal-shell.tsx all import from here, so the scrim, the panel edge, the
 * radius and the band rhythm cannot drift apart again.
 *
 * Two tiers survive, and the difference is deliberate:
 *
 *   shell   Header band, scrolling body, footer band. Anything with a form, a
 *           list, a picker or content that can grow.
 *   compact A single padded box, the whole panel scrolls. Confirmations and
 *           one-line prompts, where bands would be three dividers around two
 *           sentences. Nothing is clipped: the footer is inside the scroll
 *           flow rather than pinned below it.
 */

/**
 * The scrim. Built from --background, not black: --background is `213 25% 90%`
 * in the light theme, so a `bg-black/80` scrim dimmed the page to near black in
 * dark mode and a `bg-background/80` one washed it to near white in light mode.
 * Opening one of each in sequence read as a rendering bug.
 */
export const modalScrim =
  "fixed inset-0 z-50 bg-background/80 backdrop-blur-xs";

/** Centering layer. The p-4 is why the panel can be `rounded-lg` on mobile: it
 *  never touches the viewport edge, so square corners would be arbitrary. */
export const modalPositioner =
  "fixed inset-0 z-50 flex items-center justify-center p-4";

/**
 * The panel surface, shared by every tier.
 *
 * `bg-card`, not bg-background: the scrim above is built from --background, so
 * a bg-background panel would have nothing but its border separating it from
 * the dimmed page behind it.
 *
 * A bare `border`, which resolves to --border through the
 * `* { @apply border-border }` rule in app/globals.css. This was briefly
 * `border-input` to satisfy SC 1.4.11, which was a misread: that criterion
 * asks for 3:1 on the visual information required to identify a user interface
 * COMPONENT and its states. A modal panel is not a component you operate. It
 * is identified by its own surface, its shadow and the scrim over the page
 * behind it. Putting a 3:1 rule around it bought no conformance and drew a
 * hard outline around every modal in the product. The control edge inside the
 * panel is where --input belongs, and that is where it stayed.
 *
 * `rounded-lg` flat, per the radius ladder in CLAUDE.md: a modal is a card, not
 * a page-level panel. The admin overlays used rounded-xl and the shadcn shells
 * used `sm:rounded-lg`, which left square corners on mobile even though the
 * positioner already insets the panel by 16px.
 *
 * The max-height is the reason nine modals stopped clipping their own footers:
 * `100dvh` follows the mobile URL bar, and the `-2rem` is the positioner's p-4
 * on both sides.
 */
export const modalPanel =
  "relative z-50 w-full max-h-[calc(100dvh-2rem)] rounded-lg border bg-card shadow-lg sm:max-h-[85vh]";

/** Tier bodies. `shell` is a flex column so the middle band can scroll on its
 *  own; `compact` scrolls as one box. */
export const modalTier = {
  shell: "flex flex-col overflow-hidden",
  compact: "grid gap-4 overflow-y-auto p-6",
} as const;

export type ModalTier = keyof typeof modalTier;

/**
 * Width ladder. A confirmation is legitimately narrower than a repo picker, so
 * the sizes stay different; what they no longer do is get invented per file
 * (`max-w-md`, `sm:max-w-md`, `sm:max-w-[440px]` and `max-w-sm` were all in use
 * for the same kind of modal).
 *
 * Unprefixed `max-w-*`, not the `sm:max-w-*` these used to be. Two reasons.
 * The panel is `w-full` inside a positioner with `p-4`, so on a phone the
 * viewport already constrains it below every rung here and the `sm:` prefix
 * bought nothing. And a responsive class outranks an unprefixed one at the
 * same breakpoint, so a call site that genuinely needs a width off the ladder
 * (`className="max-w-5xl"` on the email preview) could not override a
 * `sm:max-w-lg` default: it went back to 32rem at 640px and up, which is the
 * opposite of what the override says.
 */
export const modalSize = {
  /** Confirmations, single-field prompts. */
  sm: "max-w-md",
  /** Standard forms and detail panels. */
  md: "max-w-lg",
  /** Pickers, checklists, anything with a list. */
  lg: "max-w-2xl",
  /** Rendered-content previews (an email body, a cropper, a screenshot). */
  xl: "max-w-4xl",
} as const;

export type ModalSize = keyof typeof modalSize;

/**
 * Band rhythm. px-5 py-4 on the header and footer, p-5 on the body: the two
 * prior shells disagreed (`p-5 pb-4` vs `px-6 pt-6 pb-4`) and so did their
 * divider opacity (`border-border/50` vs `/60`).
 *
 * The footer is `gap-2`, not the shadcn `sm:space-x-2`: space-x only applies on
 * a row, so stacked on mobile the cancel and confirm buttons touched. Half the
 * call sites in the app had already hand-patched `flex-col-reverse gap-2` on
 * top of it, which is the tell.
 */
export const modalBand = {
  header:
    "flex shrink-0 flex-col space-y-1.5 border-b border-border/50 px-5 py-4 text-left",
  body: "min-h-0 flex-1 overflow-y-auto p-5",
  footer:
    "flex shrink-0 flex-col-reverse gap-2 border-t border-border/50 px-5 py-4 sm:flex-row sm:justify-end",
} as const;

/**
 * The compact tier's header and footer. No dividers, but the same left
 * alignment and the same gap as the bands.
 *
 * `text-left`, not the shadcn default `text-center sm:text-left`: nothing else
 * in this product centers text on mobile and only on mobile, and the flip at
 * 640px was visible any time a confirm dialog was resized.
 */
export const modalCompact = {
  header: "flex flex-col space-y-1.5 text-left",
  footer: "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
} as const;

/**
 * Right padding that keeps a header clear of the close chip's corner (right-4,
 * 28px wide, so it wants 44px). Applied only by the surfaces that render one:
 * an alert dialog deliberately has no close chip, because it has to be
 * answered, and padding its header for an absent button reads as a typo.
 */
export const modalCloseClearance = {
  shell: "pr-12",
  compact: "pr-8",
} as const;

/**
 * The close chip. A real background chip rather than a bare icon, so it stays
 * legible over whatever is directly behind it: a coloured severity rail, an
 * avatar, a screenshot.
 *
 * 32px, up from the 28px it was. Converging the hand-rolled overlays onto this
 * chip took one 44px mobile close button (the crawl URL selector's) down with
 * it, and 28px is only barely over the 24px floor in SC 2.5.8. 32px costs
 * nothing visually inside a 52px header band and puts every close control in
 * the product comfortably clear of it.
 */
export const modalCloseChip =
  "absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground backdrop-blur-xs transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none";
