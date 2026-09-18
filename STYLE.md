# Style guide

How this product is put together, and why. Every rule here came from a defect:
something looked wrong, or read wrong, or could not be tapped, and the fix was
written down so the next person does not have to rediscover it.

The short version: be specific, do not repeat one template, and let a
container's shape tell you what it is.

---

## The core rule: specific, not templated

Most generated marketing pages use the same structure:

- uppercase label → H2 → paragraph → 3 or 6 identical icon cards
- Rinse and repeat for every section

That is what we want to avoid. Instead:

- Vary section layouts. Not everything is a grid of cards.
- Vary section widths and alignments (some left-aligned, some centered, some 2-col).
- Vary visual weight: some sections are light prose, some are heavier.
- Not every item needs an icon in a rounded square.

### Copy voice

Bad (generic marketing): "Lightning Fast", "Deep Analysis", "Developer First", "Privacy Focused"
Good (specific and honest): "Under 3 seconds. Same URL, same result, same IDs.", "No agent to install, just paste a URL."

Rules:

- Be specific. Say WHAT happens, not just that it is "fast" or "secure".
- Sound like a developer talking to another developer.
- No em dashes (—) in UI copy. Use a colon, comma, or rewrite the sentence.
- No generic SaaS platitudes.
- OK to be a little blunt or opinionated.

### Layout patterns to use

- 2-column asymmetric split (e.g., 40/60 or 45/55) for important sections
- Single prominent feature block + several smaller supporting items
- Full-width prose sections with pull-out callouts
- Numbered lists that read like prose (not circle badges)
- Inline stat bars instead of 4 separate stat cards

### Layout patterns to avoid

- 6 identical icon cards for "features"
- 3 identical cards for "how it works" with numbered circles and connecting lines
- Every section following the exact same template
- "Everything you need to X" as a section title

---

### Color usage

```tsx
// Primary / brand
"text-primary"; // brand blue text
"bg-primary/10"; // subtle brand blue background
"border-primary/20"; // subtle brand blue border

// Backgrounds
"bg-background"; // page background
"bg-card"; // card background
"bg-muted"; // muted surface
"bg-muted/30"; // very subtle surface

// Text
"text-foreground"; // body text
"text-muted-foreground"; // secondary text

// Severity (in UI only, not landing)
"hsl(var(--severity-high))";
"hsl(var(--severity-medium))";
```

### Button conventions

```tsx
<Button size="lg" className="h-11 px-6 gap-2">...</Button>   // hero CTA
<Button size="sm" className="h-8 gap-1.5">...</Button>       // nav
<Button variant="outline">...</Button>                        // secondary action
<Button variant="ghost">...</Button>                         // tertiary / nav

<Button size="lg" shape="pill">...</Button>                  // marketing CTA only
```

`shape` is a separate axis from `size` and `variant`, and it is opt-in. The
marketing surface uses `shape="pill"`, where the full-pill radius IS the
"this is the action" signal. The app does not: a pill on a dense toolbar reads
as a chip, and `rounded-md` is the control rung of the radius ladder that every
other control sits on. Nav buttons stay rectangular on purpose, which is the
second of the two button grammars, not an oversight.

Buttons and other clickable controls do not move. No press scale, no
`hover:scale-*`, no arrow that slides on hover: state is shown with colour
(`transition-colors` is on the primitive). Motion is kept for things that
open, close or report progress, not for the control that triggered them.

### Typography conventions

Two H1 tiers for pages someone chose to visit, plus a third for pages
nobody chose. Pick by what the page is, not by how big it should look.
Inventing a size outside these three is how the inconsistency this replaced
got in: before they were applied there were H1s at five different sizes
across `app/`.

```tsx
// Tier A: page titles. Marketing and standalone pages that are the whole
// reason the visitor is here (/pricing, /contact, /security, /changelog,
// /legal, /donate, the checkout pages).
<h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance">

// Tier B: sub-page titles. Tools and panels reached from inside the app,
// where the H1 labels the surface rather than sells it (/profile, /badge,
// /compare, /attack-surface).
<h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
```

Tier B carries `text-foreground` explicitly and Tier A does not: Tier B
appears on surfaces that already set a muted colour on the wrapper, so
without it the title inherits `text-muted-foreground`.

There is a third tier, and it is deliberately small:

```tsx
// Tier C: failure pages. app/error.tsx, app/not-found.tsx and
// components/shared/maintenance-screen.tsx only. A 404 or a 500 is not a
// page someone chose to visit, and sizing its title like a landing hero
// shouts at them about something they cannot act on.
<h1 className="text-lg font-semibold text-foreground">
```

Tier C is a closed set. If a fourth page wants it, it is probably a Tier B
sub-page that happens to be reporting an error, and Tier B is the answer.
`app/global-error.tsx` matches Tier C visually but writes it as a hand-rolled
CSS class rather than utilities, because it is the root error boundary and
cannot assume the app's CSS pipeline loaded at all.

### H2 tiers

H1 has three documented tiers; H2 had none and 85 of them across the app, in
more than twenty spellings of what turned out to be three jobs. The three:

```tsx
// Marketing section title. A band on a page someone is reading top to bottom.
<h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-6 text-balance">

// Panel heading. The title of a card or a section inside the app. The single
// most common heading in the product.
<h2 className="text-base font-semibold tracking-tight text-foreground">

// Panel-group heading. One step up, for a heading that owns several panels
// under it (an admin manager, a support thread, a billing overview).
<h2 className="text-lg font-semibold tracking-tight text-foreground">
```

Only the margin varies on the first (`mb-3` through `mb-8`, by how much room
the band needs). The other two do not vary: `tracking-tight` and
`text-foreground` are part of them, and the copies that dropped one or the
other are why the same heading looked slightly different between
/profile, the dashboard, the admin panels and the support inbox.

An eyebrow above a heading is not an H2. It is a `<p>` or a `<span>`, because
it labels the heading rather than replacing it.

### Section surfaces

Marketing sections get their rhythm from a change of surface, not a
`border-t`. Three steps, defined as `--tile-*` in `app/globals.css`:

| Class           | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `tile-base`     | The page itself. The default, and most of a page                 |
| `tile-alt`      | One step away. The every-other-one band that marks a new section |
| `tile-contrast` | The strongest step the theme has room for. Two or three per page |

These are steps on a ladder, not colours, so both themes stay coherent:
light steps _down_ from the page for `contrast` (90% -> 82%) while dark steps
_up_ (6% -> 15%). `tile-contrast` is **not** an inversion. A near-black band
on the light theme reads as the theme having broken rather than as rhythm,
which is exactly the report that produced this rule.

`tile-contrast` remaps the semantic tokens for its whole subtree
(`--foreground`, `--muted-foreground`, `--card`, `--border`, `--primary-text`),
so content inside it keeps using `text-muted-foreground` and simply resolves
it against the tile. Do not write on-dark variants at the call site. The one
value that needs re-pitching per theme is the link colour, and the tile
already routes it.

The section element is already full-bleed and the inner container is what
constrains the content, so a surface class goes on the `<section>` and nothing
else has to change.

### Radius ladder

Corner radius encodes the size of the thing, so a container's radius should
be predictable from what it is. Four rungs:

| Class          | Use                                                         |
| -------------- | ----------------------------------------------------------- |
| `rounded-xl`   | Panel: a page-level container, the outer shell of a section |
| `rounded-lg`   | Small card, modal, dialog, callout                          |
| `rounded-md`   | Control: input, select, button-shaped thing, chip, badge    |
| `rounded-full` | Pill: avatar, dot, status pill, icon button                 |

`rounded-sm` is not a fifth rung. It exists only to keep a focus ring from
being drawn square on an inline link or a bare `<button>` that has no
background of its own, and it is always paired with `focus.ring`.

`rounded-2xl` is drift. A nested element never gets a larger radius than the
container it sits in.

### Confirm before changing data

A control that clears, resets, overwrites or destroys data asks first. Both
sides of the product: the user's own account and the admin panel, where the
data belongs to somebody else. Also anything that exposes data (making a scan
public, listing it in the directory), charges a card, or changes what another
person can do (a team role, a support ticket they can no longer reply to).

Use `useConfirm` from `components/shared/use-confirm.tsx`:

```tsx
const { confirm, confirmDialog } = useConfirm();
...
onClick={() =>
  confirm({
    title: "Remove this trusted device?",
    description: "It has to pass two-factor again next time it signs in.",
    confirmLabel: "Remove device",
    danger: true,
    onConfirm: () => handleRevokeDevice(d.id),
  })
}
...
{confirmDialog}
```

It renders the one `ConfirmDialog`, shows its busy state while `onConfirm`
runs, closes on success and stays open with the message when it throws. Never
`window.confirm`: it cannot be styled, it blocks the tab, and it reads as a
browser warning rather than as part of the page
(`tests/repo/confirm-before-mutating.test.ts` fails on it).

What does NOT confirm: a switch that flips straight back and destroys nothing
(pause a webhook or a schedule, a notification preference, a display toggle).
A confirmation on those is how people learn to click through confirmations.

### Target size

A control's tappable area is at least 24x24 CSS pixels (WCAG 2.2 SC 2.5.8),
and 44px tall for anything primary on a phone. The trap is a link inside a
roomy row: the ROW is 44px and the `<a>` is 19px, so the target is 19px. Put
the padding on the link, not around it, and pull it back with a negative
margin if the row's height matters:

```tsx
className = "-my-1.5 block rounded-sm py-1.5 ...";
```

Inline links inside a sentence are exempt, and stay inline.

/checks had 543 links at 20px and /docs had 23 at 19px, on the two pages whose
whole job is browsing to somewhere else. Both were found by measuring the real
page at 390px, which is the only way this one shows up: it reads fine in the
markup.

### Panel tones

A panel is one of exactly two things, and the difference is nesting:

| Classes                                         | Use                                                             |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `rounded-xl border border-border bg-card`       | The panel itself: a section of a page                           |
| `rounded-xl border border-border/50 bg-card/50` | A panel INSIDE a panel, quieter so the nesting reads as nesting |

There were seven combinations across 119 call sites before this was written
down (`border-border/60` with a solid card, `bg-card/40`, `bg-card/30`, and so
on). Nobody chose those: they are what happens when the nearest file is copied
and the opacity is typed from memory, and the result was the same card a shade
different on /pricing, /repos, /teams and the support inbox.
`tests/components/shared/panel-tones.test.ts` keeps it at two.

### Shared UI helpers (use these, do not hand-roll)

Each of these replaced several drifting local copies. A new call site that
writes its own version is the drift coming back.

| Need                                           | Use                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Absolute date                                  | `formatDate` / `formatDateTime` / `formatMonthDay` from `lib/ui/format-date.ts`     |
| Relative time                                  | `lib/ui/relative-time.ts`                                                           |
| "3 scans"                                      | `pluralize` / `plural` from `lib/ui/plural.ts`                                      |
| Copy button state + screen-reader confirmation | `useCopyFeedback` + `CopiedAnnouncement` from `components/shared/copy-feedback.tsx` |
| List search box                                | `ListSearchInput` from `components/shared/list-filter-bar.tsx`                      |
| Icon beside text that may wrap                 | `LeadingIcon` (never inside a `Button`: the primitive already centres its icon)     |
| Error / warning / success box                  | `InlineAlert` from `components/shared/inline-alert.tsx`                             |
| API path                                       | the `API` map in `lib/config/client-constants.ts`, never a literal `/api/v3/...`    |

Base-layer rules in `app/globals.css` set plain `line-height`, never
`@apply leading-*`: a leading utility sets `--tw-leading`, which overrides the
line height of every `text-*` class on that element and clipped descenders
app-wide. Admin text is never below 11px (`tests/components/admin/admin-type-floor.test.ts`).

### Spacing conventions

- Section vertical padding: `py-16 sm:py-20` (standard) or `py-16 sm:py-24` (prominent)
- Container: `max-w-6xl mx-auto px-4 sm:px-6`
- Section divider: `border-t border-border/50`
- Card gap: `gap-3` or `gap-4`
- Card padding: `p-4 sm:p-5` or `p-5 sm:p-6`

---
