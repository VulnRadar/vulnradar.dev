# VulnRadar Design Language — extracted spec

Derived for AUDIT-011 section 5 by reading the strongest existing work:
`app/landing/page.tsx` + all of `components/landing/`, `public/og-image.svg`,
the five Chrome-store PNGs in `extension/public/store/`, `app/globals.css`,
`components/ui/`, `components/shared/response-readout.tsx`,
`components/scanner/severity-badge.tsx`, `tailwind.config.mjs`, `CLAUDE.md`.

This is the yardstick every other surface gets measured against. It is
descriptive, not aspirational: it records what the strong work actually does.

---

## A. COLOR

### A1. Canonical tokens (`app/globals.css:164-265`)

HSL channel triplets without `hsl()`, consumed as `hsl(var(--x))` via
`tailwind.config.mjs:23-74`. Anything not in this table is not a token.

| Token | Light (`:root`) | ≈ hex | Dark (`.dark`) | ≈ hex |
|---|---|---|---|---|
| `--background` | `213 25% 90%` | `#DFE5EC` | `224 20% 6%` | `#0C0E12` |
| `--foreground` | `220 20% 10%` | `#14181F` | `210 20% 95%` | `#F0F2F5` |
| `--card` / `--popover` | `213 22% 95%` | `#EFF2F5` | `224 18% 9%` | `#13151B` |
| `--primary` | `213 94% 68%` | **`#60A5FA`** | `213 94% 68%` | **`#60A5FA`** |
| `--primary-foreground` | `220 20% 10%` | `#14181F` | `224 20% 6%` | `#0C0E12` |
| `--secondary` | `213 20% 87%` | `#D6DCE5` | `220 10% 14%` | `#202227` |
| `--muted` | `213 18% 85%` | `#D2D8E0` | `220 10% 16%` | `#25272D` |
| `--muted-foreground` | `220 10% 42%` | `#606876` | `220 8% 55%` | `#838995` |
| `--accent` | `213 18% 81%` | `#C7CFDB` | `220 8% 22%` | `#343740` |
| `--destructive` | `0 84% 60%` | `#EF4444` | `0 91% 71%` | `#FA7070` |
| `--border` / `--input` | `213 16% 78%` | `#BEC6D0` | `224 15% 16%` | `#23262F` |
| `--ring` | `213 94% 68%` | `#60A5FA` | `213 94% 68%` | `#60A5FA` |
| `--radius` | `0.5rem` | | inherits | |

**Severity scale** (`globals.css:204-208`, `249-253`), identical in both themes
except `info`. Confirmed against `lib/config/brand.ts:61-67`:

| Token | HSL | hex |
|---|---|---|
| `--severity-critical` | `0 84% 60%` | `#EF4444` |
| `--severity-high` | `25 95% 53%` | `#F97316` |
| `--severity-medium` | `45 93% 47%` | `#E7B008` |
| `--severity-low` | `210 90% 56%` | `#2A8FF4` |
| `--severity-info` | light `220 10% 46%` / dark `215 15% 55%` | `#6A7181` / `#7B899D` |

**Status pair** (`globals.css:216-219`, `261-264`): `--success` light
`142 76% 36%` / dark `142 70% 45%`; `--warning` `38 92% 50%` both themes.

**Chart ramp** `--chart-1`..`--chart-5` (`globals.css:197-201`, `243-247`).
`--chart-1: 190 90% 42%` is the only 190° hue left in the system — a vestige
of the old cyan brand.

### A2. What is canonical

- **`--primary` is `#60a5fa` (blue-400), not cyan.** Agreed by
  `globals.css:178`, `lib/config/config-values.ts:188`
  (`CONFIG_PRIMARY_COLOR = "#60a5fa"`), `lib/config/brand.ts:16-21`,
  `og-image.svg:36,58`, and the store PNGs (sampled `#60A5FA`/`#5EA5FF`).
- **`CLAUDE.md` line 1 is stale.** It says "cyan/teal (~190° hue)". Nothing
  shipped is 190° except the unused `--chart-1`. **Audit against blue.**
- **Severity is encoded only through `SEVERITY_TONE`**
  (`components/scanner/severity-badge.tsx:37-78`), never a raw Tailwind color.
- The codebase is genuinely clean here: **zero** `bg-gray-*`, `text-gray-*`,
  `bg-slate-*`, `bg-zinc-*`, `border-gray-*` in `app/` + `components/`.

### A3. Untokenised colors that legitimately exist

Know these so they aren't cited as precedent for ad-hoc color inside the app.

1. **`public/og-image.svg` is a hand-tuned dark palette of its own**: bg
   `#0a0e18 → #0e1526` (`:4-5`), glow `#2f6bff` (`:8-10`), wordmark gradient
   `#ffffff → #b9d1f7` (`:13-14`), card `#141d30 → #101827` (`:17-18`), stroke
   `#26344d` (`:61`), rules `#22304a` (`:72`), label `#7e93b4` (`:77,89`), body
   `#dbe4f2` (`:51,54`), eyebrow `#8ea3c2` (`:47`), pill `#1b2a44`/`#93c5fd`
   (`:68,71`), score chip `#12321f`/`#4ade80` (`:81,84`). **The severity dots
   do match the token scale exactly** (`:93-101`).
2. **`lib/config/brand.ts`** is a deliberate third palette for email
   (documented `:1-13`): `bg #0b0e14`, `surface #12151c`, `surfaceRaised
   #1b1f28`, `border #252a34`, `text #f1f5f9`, `textMuted #9aa6b8`.
3. **Store PNGs are a fourth near-black navy**: `#0c0f18`/`#0d1019`/`#0e111a`,
   raised `#13161f`, cards `#171b26`/`#181c27`/`#1d232f`, accent `#60a5fa`.
4. **`app/global-error.tsx:10` hardcodes `BRAND_TEAL = "#0891b2"`** plus
   `#09090b`, `#fafafa`, `#a1a1aa`, `#71717a`, `#52525b` (`:28-192`). Stale
   brand. Inline hex is unavoidable there (runs outside React/CSS) but the
   *value* is wrong.
5. **`components/ui/badge.tsx:16-19` bypasses tokens** for `info`/`success`/
   `warning`/`error` (`bg-blue-500/10 text-blue-600` etc). Hardcoded palette in
   a primitive, and it does not respond to dark mode.
6. `globals.css:9` safelists literal palette colors for role badges.
7. `globals.css:487-575` hardcodes hover/selection surfaces as literal
   `hsl(220 10% 88% / 0.95)` with `!important` rather than tokens.
8. **Dead tokens**: `--surface-1/2/3` defined (`globals.css:210-213`,
   `255-258`), used nowhere. `--sidebar-*` wired into `tailwind.config.mjs:64-73`
   but never defined in CSS and never used — those utilities resolve to nothing.

---

## B. TYPE

### B1. Families

`app/layout.tsx:39-43` imports `Inter` and `JetBrains_Mono` from
`next/font/google` **but assigns both to underscore-prefixed unused consts**;
their `--font-inter` / `--font-jetbrains-mono` variables are never applied.
`app/layout.tsx:170` is `<body className="font-sans antialiased">` and
`tailwind.config.mjs` has no `fontFamily` extension.

**The real shipped stack is Tailwind v4's defaults** — `ui-sans-serif,
system-ui, ...` and `ui-monospace, SFMono-Regular, Menlo, ...`. Consistent
with `og-image.svg:42`. Any spec claiming "Inter" describes intent, not reality.

**Mono is load-bearing brand, not just code.** The wordmark is mono
(`landing-nav.tsx:67`, `footer.tsx:35`), as are stats
(`landing-hero.tsx:110`), eyebrows (`landing-features.tsx:22`), table numerals
(`landing-categories.tsx:66,135`), `<dt>` terms
(`landing-api-example.tsx:130`), version pills (`footer.tsx:39`), and all of
`ResponseReadout` (`response-readout.tsx:165`).

### B2. The scale that ships

Global defaults `globals.css:307-332` (all headings `font-semibold
tracking-tight text-balance`; `h1 text-4xl md:text-5xl`; `h2 text-3xl
md:text-4xl`; `p leading-7`) — but the landing page **overrides h2 downward
everywhere**. Actual scale:

| Role | Classes | Cite |
|---|---|---|
| Hero H1 | `text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold tracking-tight leading-[1.06] mb-6 text-balance` | `landing-hero.tsx:70` |
| **Section H2 (canonical)** | `text-2xl sm:text-3xl font-semibold tracking-tight` | 9 landing sections |
| Page H1 (non-hero) | `text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance` | `app/pricing/page.tsx:77` |
| Card H3 | `text-base font-semibold tracking-tight text-balance` | `landing-sample-finding.tsx:63` |
| List-item H3 | `text-sm font-semibold text-foreground` | `landing-features.tsx:43` |
| Pull-quote | `text-lg sm:text-xl font-medium tracking-tight text-foreground text-balance` | `landing-how-it-works.tsx:31` |
| Body | `text-muted-foreground leading-relaxed` | `landing-features.tsx:28` |
| Body (prose) | `text-muted-foreground leading-relaxed text-[15px] sm:text-base` | `landing-how-it-works.tsx:13` |
| Lead para | `text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl text-pretty` | `landing-hero.tsx:76` |
| Secondary body | `text-sm text-muted-foreground leading-relaxed` | `landing-faq.tsx:24` |
| Eyebrow (accent) | `font-mono text-xs uppercase tracking-wider text-primary` | `landing-features.tsx:22` |
| Eyebrow (muted) | `text-xs font-medium uppercase tracking-wider text-muted-foreground` | `landing-sample-finding.tsx:90` |
| Inline code | `font-mono text-xs px-1.5 py-0.5 rounded bg-background border border-border/60 text-foreground` | `landing-sample-finding.tsx:43` |
| Code block | `p-4 overflow-x-auto text-xs leading-6 font-mono text-foreground/90` | `landing-api-example.tsx:74` |
| Dense evidence | `p-3 text-[11px] font-mono leading-5` | `landing-sample-finding.tsx:93` |

### B3. Weight and tracking

- **Three weights only**: `font-medium`, `font-semibold`, default.
  **`font-bold` appears nowhere in the landing work.**
- **`tracking-tight` on every heading, always.** Never `tracking-tighter`.
- **`tracking-wider` only on uppercase micro-labels.** Uppercase never at body size.
- **`tabular-nums` on every number that can change.**
- **`text-balance` on headings, `text-pretty` on the lead** (custom utilities,
  `globals.css:29-35`).

### B4. The two-tone headline idiom — store only

All five store PNGs use white clause + `#60a5fa` clause ("You're already on the
page." / "See what's wrong with it."). **The web landing page deliberately does
NOT**: `landing-hero.tsx:70-74` is single-color with a manual `<br />`. The web
surface spends accent on borders, tints, and one flagship table row instead.

**Auditor rule: the two-tone headline is correct for store/marketing art only.
Inside the product it is a deviation, not a match.**

### B5. Composed line breaks

Both strong headline treatments hard-break with `<br />` rather than wrapping:
`landing-hero.tsx:71-73`, `auth-split-layout.tsx:105-107`.

---

## C. SPACING

### C1. Section rhythm

| Pattern | Class | Notes |
|---|---|---|
| Standard section | `py-16 sm:py-20` | 12 uses repo-wide |
| Prominent section | `py-16 sm:py-24` | only 2 uses, both "hero moment" sections |
| Hero (asymmetric) | `pt-12 pb-14 sm:pt-20 sm:pb-20` | `landing-hero.tsx:66` |
| Section divider | `border-t border-border/50` | 7 sections |
| Emphasis band | `border-y border-border/50 bg-muted/30` | `landing-sample-finding.tsx:29` |

**`border-border/50` is the divider, not `border-border`.** Full opacity is
reserved for the footer's outer edge and card outlines.

### C2. Container widths carry meaning

| Width | Used for |
|---|---|
| `max-w-6xl mx-auto px-4 sm:px-6` | the default (33 uses) |
| `max-w-5xl mx-auto px-4 sm:px-6` | the use-cases definition list |
| **`max-w-3xl mx-auto px-4 sm:px-6`** | **prose-only sections** (how-it-works, FAQ) |
| `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` | footer only |
| `max-w-2xl` / `max-w-xl` / `max-w-lg` | inner measure caps |

**Rule: reading-heavy sections narrow to `max-w-3xl`.** Prose at `max-w-6xl`
is a deviation.

### C3. Card / block padding

`p-6 sm:p-8` (the one big feature block) · `p-5` (finding card body) ·
`px-5 py-4` (card header) · `px-4 py-3` and `px-4 sm:px-5 py-3` (meta and table
cells) · `p-4` (small mobile card) · `p-3` (evidence `<pre>`) · `p-6` (shadcn
`Card` default).

### C4. Recurring gaps

Grid gutters `gap-10 lg:gap-16`, `gap-8 lg:gap-14`, `gap-8 lg:gap-12`. Button
rows `flex flex-wrap gap-3`. Prose stacks `space-y-4` / `space-y-5`. Divided
lists `divide-y divide-border/50` with `py-5`/`py-6` rows. Inline stat strip
`gap-x-6 gap-y-2`.

### C5. Radius ladder

`--radius: 0.5rem` → `rounded-lg`; `rounded-md = radius-2px`;
`rounded-sm = radius-4px` (`tailwind.config.mjs:75-79`).

Use: `rounded-2xl` for the single flagship block · `rounded-xl` for content
cards, code blocks, tables, the readout · `rounded-lg` for small cards and chip
links · `rounded-md` for buttons · `rounded-full` for pills.

---

## D. COMPONENT IDIOMS

### D1. Three card grammars — there is no single "the card"

1. **Content card**: `rounded-xl border border-border bg-card overflow-hidden
   min-w-0` with an internal `border-b border-border/60` header.
2. **Accent block (once per page, maximum)**: `rounded-2xl border
   border-primary/20 bg-primary/10 p-6 sm:p-8` (`landing-features.tsx:21`).
   Quieter sibling `border-primary/25 bg-primary/5` for one flagship table row.
3. **Quiet surface**: `rounded-lg border border-border/60 bg-card p-4`, or
   `rounded-xl border border-border/60 bg-muted/40` for code.

shadcn `Card` is `rounded-lg border bg-card text-card-foreground shadow-xs` —
**`shadow-xs`, not `shadow-md`.** Shadows here are near-invisible; the hero
readout adds only `shadow-xs shadow-black/5 dark:shadow-black/20`.

**Cards are not the default container.** Four of nine landing sections use no
card at all — they use dividers and definition lists.

### D2. Buttons

`components/ui/button.tsx:23-28` defines `default h-10 px-4 py-2`, `sm h-9
px-3`, `lg h-11 px-8`, `icon h-10 w-10`. **The landing work always overrides
size with an explicit height + padding:**

| Role | Usage |
|---|---|
| Hero / CTA primary | `<Button size="lg" className="h-11 px-6 gap-2">` |
| Hero / CTA secondary | `<Button size="lg" variant="outline" className="h-11 px-6">` |
| Nav | `<Button size="sm" className="h-8 gap-1.5">` |
| Nav tertiary | `<Button variant="ghost" size="sm" className="h-8">` |
| In-card utility | `<Button variant="ghost" size="sm" className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground">` |

Icons: `h-4 w-4` at `lg`, `h-3.5 w-3.5` at `sm`/`h-7`.

Hand-built link-buttons match the same geometry: primary link
(`landing-api-example.tsx:143`), text link (`landing-sample-finding.tsx:52`),
chip link (`landing-open-source.tsx:16`) with an accent variant reserved for
the one link that is the point of the section.

**Every interactive element carries `focus-visible:outline-hidden
focus-visible:ring-2 focus-visible:ring-ring`**, literally or via `focus.ring`
from `lib/ui/animations.ts:92`. Global `:focus-visible` at `globals.css:370-372`.

### D3. Pills and badges

The idiom: `rounded-full`, `text-[10px]`, `font-mono` or `uppercase
tracking-wider`, tinted `/10` with a border at `/25`–`/30`.

The severity badge is the deliberate exception — `rounded` (not
`rounded-full`) so it does not read as a marketing pill:
`inline-flex items-center gap-1.5 rounded border font-semibold uppercase
tracking-wide tabular-nums` + `px-1.5 py-0.5 text-[10px]` (sm) or
`px-2 py-1 text-xs` (md), with an `h-1.5 w-1.5 rounded-full` dot.

Global pill hover at `globals.css:136-138`.

### D4. Data rows — tables and definition lists over cards

1. **Divided `<dl>` row**: `grid grid-cols-1
   sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-2 sm:gap-8 py-6` in a
   `divide-y divide-border/50 border-y border-primary/20` container.
2. **Mono-term `<dl>` row**: `flex gap-3` with a `font-mono text-xs uppercase
   tracking-wider text-muted-foreground w-[76px] shrink-0` `<dt>`.
3. **Real semantic table**: `w-full min-w-[560px] text-sm border-collapse`
   inside `overflow-x-auto rounded-xl border border-border/60`, with
   `<caption className="sr-only">`, `<thead>` at `border-b border-border/60
   bg-muted/30`, `<th scope="col">`, rows at `border-b border-border/40
   last:border-0 transition-colors hover:bg-muted/20`, `<th scope="row">` on
   the first cell.
4. **`ResponseReadout`** (`components/shared/response-readout.tsx:161-216`) —
   the house signature component. `overflow-hidden rounded-xl border
   border-border bg-card font-mono`, a `border-b border-border/60 bg-muted/20`
   request header with `text-primary` method, body rows as `flex items-center
   justify-between gap-3`, and a `border-t border-border/60 bg-muted/20
   text-xs` footer showing a **real** finding ID from `generateId()`.
   `aria-hidden="true"` on the wrapper, one-shot `motion-safe:animate-[...]`
   stagger with `motion-reduce:opacity-100` fallback.

**Mobile alternates are hand-written, not responsive-squeezed**:
`landing-categories.tsx:42` renders `sm:hidden` cards and `:81` a
`hidden sm:block` table — two real layouts, not one that reflows badly.

### D5. Severity encoding

Single source of truth `components/scanner/severity-badge.tsx:37-78`. Five
properties per level:

```
solid    → bg-[hsl(var(--severity-X))]        // rails, dots, bars
text     → text-[hsl(var(--severity-X))]      // fg on neutral surface
surface  → /15 (critical, high) or /10 (medium, low); info = bg-muted
border   → /40 (critical, high) or /30 (medium, low); info = border-border
emphasis → "loud" | "normal" | "quiet"
```

`emphasis` drives type weight, documented `:31-34` — **severity is encoded by
weight AND color, not color alone.**

`SeverityDistribution` (`:129-190`) is the canonical aggregate: **one
horizontal `h-2 rounded-full bg-muted` bar with proportional segments plus an
inline legend, explicitly not five stat cards** (docblock `:125-128`:
*"Reads as one bar rather than five cards, and the segment widths carry the
information."*).

---

## E. LAYOUT PRINCIPLES

### E1. What CLAUDE.md forbids

- 6 identical icon cards for "features"
- 3 identical cards for "how it works" with numbered circles and connecting lines
- Every section following the exact same template
- "Everything you need to X" as a section title
- Generic icon-in-rounded-square for every feature item
- Em dashes in any user-facing text

Named anti-pattern: *"uppercase label → H2 → paragraph → 3 or 6 identical icon
cards / Rinse and repeat for every section."*

### E2. What the landing page does instead — nine structurally different sections

| # | Section | Layout |
|---|---|---|
| 1 | Hero | 2-col asymmetric `lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]`; copy left, live readout right; inline `<dl>` stat strip on a `border-t` rule |
| 2 | Sample finding | 2-col **4fr/6fr** (copy is the minority column); tinted band; full realistic finding card with 3-col meta `<dl>` and two `<pre>` blocks |
| 3 | How it works | **Single-column `max-w-3xl` prose with a `border-l-2 border-primary pl-5 sm:pl-6` pull-quote.** No cards, no numbers, no steps |
| 4 | Features | **One prominent accent block + a divided list of three.** `lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]` |
| 5 | Categories | **A real `<table>`** (16 rows) with an `sm:hidden` card alternate; one row gets the accent, the other fifteen deliberately do not |
| 6 | Use cases | `max-w-5xl` **definition list**, `divide-y divide-border/50 border-y border-primary/20` |
| 7 | API | 2-col **1.5fr/1fr with the code on the LEFT**; two copyable `CodeBlock`s; a mono-term `<dl>` and two differently-weighted links |
| 8 | Open source | Left-aligned `max-w-2xl` prose + chip-link row + `grid-cols-2 sm:grid-cols-3` fact `<dl>` |
| 9 | FAQ / CTA | `max-w-3xl` divided `<dl>`; CTA is `lg:grid-cols-[minmax(0,1fr)_auto]` on `bg-muted/30` |

**Accent-restraint doctrine, twice documented in code comments:**
- `landing-categories.tsx:6-11`: *"the one category this table calls out with
  colour... earns the accent the other fifteen rows deliberately don't get."*
- `landing-open-source.tsx:18-19`: *"The repo link is the point of this
  section, so it carries the accent the other two deliberately don't."*

**Zero icon-in-rounded-square instances on the landing page.** Only three
lucide icons appear across all nine sections. No `md:grid-cols-3` icon grids.

**Illustration doctrine** (`response-readout.tsx:140-146`): *"The actual
mechanism of the product, rendered as itself: a request line, a status line,
and the header checks that came back. Not a metaphor for scanning, the literal
shape of scanning."* Hero severities come from
`lib/scanner/checks-data/headers.json`; the stat strip uses `checkCount` from
the live registry, commented *"Real count from the scanner registry, not a
marketing label."*

### E3. The store-screenshot system

All five PNGs (533×333) share one composition: **alternating side** (copy left
on 1/3/5, product left on 2/4 — never the same side twice running); a small
mono wordmark lockup top-left; a two-tone white/blue headline of 3-4 short
lines; a muted body paragraph; **a monospace footnote with a bold lead clause
and a muted tail** (e.g. `700+ checks` bold + "across headers, TLS, DNS, email
auth, secrets, and client-side code."); and a product glimpse rendered as
**real UI over a browser-chrome mock** (rounded window, three traffic-light
dots, a URL pill, gray placeholder bars) with the VulnRadar panel floating over
it in full color with real severity chips.

**No section on any screenshot is a grid of cards. Not one.**

---

## F. VOICE

### F1. Real good copy from the codebase

1. "Paste a URL. The request goes out from our servers, not your browser, and
   comes back with the response evidence we flagged, a finding ID that does not
   change between runs, and a fix you can paste straight into your config."
   — `landing-hero.tsx:77-80`
2. "The request leaves our servers, not your browser. No session cookies, no
   VPN, no corporate proxy in the path. What comes back is what an
   unauthenticated stranger on the internet sees, which is usually the thing
   you actually wanted to know." — `landing-how-it-works.tsx:15-19`
3. "No model decides your severity. The same URL produces the same finding IDs
   and the same ratings on every run, which is the only reason a diff between
   two scans means anything." — `landing-how-it-works.tsx:32-35`
4. "There is no model in the detection path deciding today that something is
   medium when yesterday it was low." — `landing-features.tsx:30-32`
5. "Fixes, not lectures: each finding ships with a config snippet for Nginx,
   Caddy, Express, and Next.js. Copy it, deploy, rescan, watch it disappear."
   — `landing-features.tsx:7-8`
6. "Self-hosting is one Dockerfile and a Postgres connection string. If you
   disagree with a severity rating, open the check, argue with it, and send a
   pull request." — `landing-open-source.tsx:39-42`
7. "Every finding carries the raw evidence it was derived from, so you can
   check our work rather than take it on faith." — `landing-how-it-works.tsx:40-42`
8. "Paste a URL. Get findings, not a grade out of ten." — `auth-split-layout.tsx:105-107`

**Section headings are declarative sentences, not noun-phrase labels:** "This
is a finding, in full" · "What actually happens when you hit scan" · "The whole
check list" · "Who actually runs this" · "One endpoint. Bearer token. JSON
out." · "It is all in the open" · "Questions people ask first" · "Paste a URL
and see what comes back".

**Voice rules:** lead with mechanism not benefit · name things precisely
("Missing HSTS", not "a missing security setting") · assume competence, never
explain what a security header is · no fear framing or urgency theatre ·
numbers are real and pulled from the registry at render time · comfortable
saying no ("Telemetry: None").

Em dashes are banned and the codebase honors it: the only `—` in `app/` +
`components/` are in code comments or an empty-cell placeholder.

### F2. Weak copy found

1. **`app/docs/architecture/page.tsx:77`** — "Everything you need…", the exact
   phrase `CLAUDE.md` bans as a section title. Survives only as mid-sentence prose.
2. **`components/ui/badge.tsx:16-19`** — variant names `info`/`success`/
   `warning`/`error` are generic framework labels sitting beside a real
   severity vocabulary. Two overlapping vocabularies for "how bad is this".
3. **`app/global-error.tsx:10`** — `BRAND_TEAL = "#0891b2"`, an artifact of a
   brand the product no longer has.
4. **`landing-nav.tsx:124`** — `"Get Started"`, the most generic string on the
   page and inconsistent in case with the sentence-case everything else.

---

## G. THE TELL-TALE LIST

Apply to any page. A **No** is a deviation to report, with file:line.

| # | Check | Pass | Fail |
|---|---|---|---|
| 1 | Section rhythm | `py-16 sm:py-20` (or `py-16 sm:py-24` for ≤2 prominent sections) | `py-12`, `py-24 md:py-32`, ad-hoc `mt-20` stacking |
| 2 | Container | `max-w-6xl mx-auto px-4 sm:px-6`; prose narrows to `max-w-3xl` | `container mx-auto`, `max-w-7xl` outside the footer, prose at `max-w-6xl` |
| 3 | Tokens only | `bg-muted/30`, `bg-card`, `border-border/50`, `text-muted-foreground` | any `bg-gray-*`, `bg-slate-*`, `text-zinc-*`, `bg-[#hex]`, raw brand constants |
| 4 | Primary is blue and rationed | accent on ≤2 elements per section, on the one that matters | every card has a `text-primary` icon; cyan/teal anywhere; `from-cyan-500 to-blue-500` |
| 5 | No 3-across identical icon cards | tables, definition lists, divided lists, prose, one-big-plus-three | `grid md:grid-cols-3` of identical Cards each opening with an icon in a tinted rounded square |
| 6 | Sections don't repeat one template | adjacent sections differ in column count, alignment, width, card use | eyebrow → H2 → paragraph → card grid, three times running |
| 7 | Heading scale | H2 `text-2xl sm:text-3xl font-semibold tracking-tight` | `text-5xl font-bold` section headers; any `font-bold`; missing `tracking-tight` |
| 8 | Numbers real and monospaced | from `getCategoryCounts()` / props, `font-mono tabular-nums` | hardcoded "500+", "99.9% uptime", "10,000 developers" |
| 9 | Severity via `SEVERITY_TONE` | `SEVERITY_TONE[s].*` or `hsl(var(--severity-high))` | `text-red-500`/`bg-orange-100` for a finding; five stat cards instead of one bar |
| 10 | Shadows near-invisible | `shadow-xs`, or none plus `border-border/60` | `shadow-lg`, `shadow-2xl`, `hover:shadow-xl hover:-translate-y-1` |
| 11 | Copy states mechanism | "Under 3 seconds. Same URL, same finding IDs." | "Lightning fast", "Enterprise-grade", "Trusted by thousands" |
| 12 | No em dash in user-facing text | colon, comma, rewrite | `—` inside any JSX string literal |
| 13 | Focus + semantics | `focus-visible:ring-2 focus-visible:ring-ring` everywhere; real `<dl>`/`<table>` with `scope` and `sr-only` captions | `<div onClick>`, missing focus ring, a div-table, decorative art without `aria-hidden` |
| 14 | Motion one-shot, reduced-motion safe | `motion-safe:animate-[...]` + `motion-reduce:opacity-100` | infinite `animate-pulse` decoration, parallax, looping scanning animations |

### Quick triage heuristic

If a page has **(a)** a `grid md:grid-cols-3` of cards each starting with an
icon in a tinted rounded square, **(b)** an uppercase eyebrow above every H2,
and **(c)** at least one adjective-only benefit claim, it is generic. The
landing page has zero of the three across nine sections.

---

## Known drift any auditor will trip over

1. **`CLAUDE.md` line 1 says cyan/teal (~190°). It is blue `#60a5fa` (213°).**
   Audit against blue.
2. **Inter and JetBrains Mono are loaded but never applied.** The site ships in
   system-ui / ui-monospace.
3. **Four separate near-black navy palettes** (app dark tokens, `og-image.svg`,
   `lib/config/brand.ts`, store PNGs), each close to but not equal to the
   others. Only `brand.ts` documents why.
4. **Dead tokens**: `--surface-1/2/3` unused; `--sidebar-*` referenced in
   Tailwind config but never defined in CSS.
5. **`components/ui/badge.tsx` is the one primitive that hardcodes Tailwind
   palette colors** and does not respond to dark mode.
