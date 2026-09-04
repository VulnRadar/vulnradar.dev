/**
 * The email design system: the branded shell plus every block a message is
 * built from, as pure functions of their inputs.
 *
 * This exists because there were two of it. lib/email/email.ts owned the real
 * `layout()` (server-only: it reads APP_URL/LOGO_URL/SUPPORT_EMAIL from
 * constants and is reached through nodemailer), and
 * components/admin/shared/email-preview-html.ts owned a hand-kept client-side
 * copy for the admin preview iframes, with a comment asking whoever edited one
 * to remember the other. They drifted on four things: the preview hardcoded
 * `${appUrl}/favicon.svg` instead of the deployment's LOGO_URL, it shipped no
 * `@media (max-width: 600px)` rules so it could not show the mobile rendering,
 * it never rendered the "Manage email preferences" button, and its footer
 * stopped before the support address. An admin composing a broadcast was
 * previewing a message that was not the one recipients received.
 *
 * The body blocks (heading, lead, button, callout, detail rows, code block,
 * severity chips) moved here for the same reason: they were private to
 * email.ts, so the admin preview hand-rolled an `<h1>` at a different font
 * weight than every real message used.
 *
 * Nothing in here imports server-only code or reads deployment config, so the
 * admin preview and the mail sender can both call it. Everything that differs
 * between the two callers (which app URL, which logo, whether there is an
 * unsubscribe token) is an argument.
 *
 * WHAT THE SHELL LOOKS LIKE, AND WHY IT CHANGED
 *
 * The first version of this shell put a wordmark on the canvas, floating above
 * a white card with a 3px brand-blue bar across its top, and drew every
 * label/value pair as a bordered table with row rules. Read in an inbox that
 * is a 2010 newsletter: a masthead stripe, dead space, then spreadsheet
 * output. The rebuild:
 *
 *  - The canvas is two steps lighter (lib/config/brand.ts explains the value),
 *    so card-on-canvas reads as a sheet on a page rather than as white on mud.
 *  - The wordmark moved INSIDE the card, top-left, which is where it sits on
 *    every other surface of the product. The message now opens with the
 *    product's own header instead of a detached logo and 60px of nothing.
 *  - The blue top bar is gone. A hairline border is the only card edge, and
 *    the brand shows up where it means something: the button, the links, the
 *    logo.
 *  - Detail rows have no gridlines and no outer border. They are a muted
 *    surface with a quiet label column and generous vertical rhythm, which is
 *    how the same information is drawn in the app.
 *  - Callouts are a tinted box with a hairline edge of the same hue, not a
 *    grey box with a coloured stripe down the side.
 *  - The footer is one sentence and one row of quiet links, not a weak
 *    outlined button over three lines of grey text.
 *
 * WHAT THIS IS WRITTEN AGAINST
 *
 * Email HTML is not web HTML, and the rules below are the reason this file
 * looks like 2004:
 *
 *  - Outlook 2016-2021 on Windows renders with Word, not a browser. No
 *    flexbox, no grid, no `max-width` on a table, no `border-radius` (corners
 *    come out square, which is fine, it just cannot be load-bearing), no
 *    background images. Layout is nested `<table>` with a real `width`
 *    attribute, and the fixed-width column is additionally wrapped in an
 *    `<!--[if mso]>` table so Word has something with an explicit width.
 *  - Word also ignores padding on a `<table>` element, which the old detail
 *    panel relied on, so its rows sat flush against the panel edge in every
 *    Outlook. Padding goes on a `<td>` here, never on a `<table>`.
 *  - The primary button is a VML `<v:roundrect>` under `<!--[if mso]>` with
 *    the anchor hidden from Word, because `border-radius` on an `<a>` is
 *    dropped there and a square, unfilled link is not a call to action.
 *  - Gmail strips `<head>` and `<style>` entirely for messages read through
 *    the Gmail app on a non-Gmail account (the "GANGA" case), so the
 *    stylesheet is only ever progressive enhancement. Every element also
 *    carries the inline style that matters.
 *  - Gmail does not honour `prefers-color-scheme`; it force-inverts instead,
 *    and does so partially. So the default palette is LIGHT (the palette that
 *    survives being left alone on white and reads sanely when inverted), and
 *    dark mode is an override, never the baseline.
 *  - Outlook.com rewrites the document in dark mode and marks it with
 *    `[data-ogsc]` / `[data-ogsb]` rather than answering the media query, so
 *    the dark rules are emitted twice under both selector sets.
 *  - No webfont: Gmail, Outlook and Yahoo all drop `@font-face`. The stacks
 *    below are faces that actually ship on the platforms that matter.
 *  - No JavaScript, no external stylesheet, no CSS custom properties (Word
 *    and several webmail sanitisers drop `var()` and leave the property
 *    unset, which is worse than a literal hex).
 *  - Gmail clips a message past 102KB and hides the rest behind a "view entire
 *    message" link, which would cut the footer off. The largest template
 *    renders around 15KB, so there is room, but that is the ceiling every
 *    addition here is spending against.
 */
import { BRAND } from "@/lib/config/brand";

/**
 * The wordmark is monospace on every other surface (the app header, the
 * landing nav and the auth layout all render APP_NAME with `font-mono
 * font-semibold tracking-tight`, backed by JetBrains Mono). Email was the one
 * place it was set in bold sans, so the first thing a recipient saw did not
 * look like the product they signed up for.
 *
 * Email clients cannot load a webfont reliably, so this is a stack of faces
 * that actually ship on the platforms that matter, ending in the generic
 * `monospace` keyword. JetBrains Mono is listed first for the handful of
 * desktop clients where the recipient happens to have it installed.
 */
export const MONO_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/** Body copy. Ends in a generic so Word has something to fall back to. */
export const SANS_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LIGHT = BRAND.onLight;

/**
 * The spacing and radius scale, in one place so a block cannot invent a
 * seventh value. CLAUDE.md's radius ladder in email terms: the card is the
 * panel (12), a detail group or callout is the card (8), the button is a
 * control (6), a chip is a pill. Nothing nested ever gets a larger radius
 * than what contains it.
 */
const R = { card: "12px", block: "8px", control: "6px", pill: "999px" };

/** Vertical rhythm between blocks, and the card's own padding. */
const SPACE = {
  /** Gap under a block that another block follows. */
  block: "22px",
  cardPad: "32px 36px 34px 36px",
  shellPad: "32px 16px",
};

/**
 * Class hooks. Inline styles carry the light rendering; these exist only so
 * the stylesheet has something to override in dark mode. Names are short
 * because every one of them is repeated through the document and the rendered
 * copy has to stay under email.ts's EMAIL_LOG_HTML_MAX_CHARS.
 */
const C = {
  canvas: "v-bg",
  card: "v-card",
  panel: "v-panel",
  heading: "v-h",
  body: "v-t",
  faint: "v-t2",
  link: "v-a",
  rule: "v-rule",
  button: "v-btn",
} as const;

export type EmailAccent = "brand" | "ok" | "warn" | "bad" | "neutral";
export type EmailSeverity = "critical" | "high" | "medium" | "low" | "info";

/**
 * Accent pairs. A template names the tone it means and never a hex, so it
 * cannot pick a colour that fails contrast on one of the two grounds: the
 * light value is measured on #f5f7fa (surfaceRaised, the tighter of the two
 * surfaces an accent lands on) and the dark value on #12151c.
 */
const ACCENTS: Record<EmailAccent, { light: string; dark: string }> = {
  brand: { light: LIGHT.primaryText, dark: BRAND.primaryLight },
  ok: { light: LIGHT.success, dark: BRAND.successLight },
  warn: { light: LIGHT.warning, dark: BRAND.warningLight },
  bad: { light: LIGHT.danger, dark: BRAND.dangerLight },
  neutral: { light: LIGHT.textMuted, dark: BRAND.textMuted },
};

const SEVERITIES: Record<EmailSeverity, { light: string; dark: string }> = {
  critical: { light: LIGHT.severity.critical, dark: BRAND.severity.critical },
  high: { light: LIGHT.severity.high, dark: BRAND.severity.high },
  medium: { light: LIGHT.severity.medium, dark: BRAND.severity.medium },
  low: { light: LIGHT.severity.low, dark: BRAND.severity.low },
  info: { light: LIGHT.severity.info, dark: BRAND.severity.info },
};

function accentClass(name: string): string {
  return `v-ac-${name}`;
}

/** The tinted-surface class for a callout, which dark mode repaints. */
function calloutClass(accent: EmailAccent): string {
  return `v-cl-${accent}`;
}

/** The light hex for an accent, for the one caller that needs it inline. */
export function accentColor(accent: EmailAccent): string {
  return ACCENTS[accent].light;
}

/** Class + inline colour for an accent, ready to drop into an element. */
function accentAttrs(accent: EmailAccent): { cls: string; color: string } {
  return { cls: accentClass(accent), color: ACCENTS[accent].light };
}

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------

/**
 * Every dark override, emitted once per selector prefix. Inline styles beat a
 * class, so all of it is `!important`; that is the standard cost of doing
 * dark mode in email and the reason the light rendering has to be the one
 * that is correct without any stylesheet at all.
 */
function darkRules(prefix: string): string {
  const p = (cls: string) => `${prefix}.${cls}`;
  const accentRules = (
    Object.entries(ACCENTS) as [EmailAccent, { dark: string }][]
  )
    .map(
      ([name, v]) =>
        `${p(accentClass(name))}{color:${v.dark}!important;border-color:${v.dark}!important}`,
    )
    .join("");
  const severityRules = (
    Object.entries(SEVERITIES) as [EmailSeverity, { dark: string }][]
  )
    .map(
      ([name, v]) =>
        `${p(accentClass(name))}{color:${v.dark}!important;border-color:${v.dark}!important}`,
    )
    .join("");
  const calloutRules = (
    Object.entries(BRAND.callout) as [
      EmailAccent,
      { bg: string; edge: string },
    ][]
  )
    .map(
      ([name, v]) =>
        `${p(calloutClass(name))}{background-color:${v.bg}!important;border-color:${v.edge}!important}`,
    )
    .join("");
  return [
    `${prefix}body,${p(C.canvas)}{background-color:${BRAND.bg}!important}`,
    `${p(C.card)}{background-color:${BRAND.surface}!important;border-color:${BRAND.border}!important}`,
    `${p(C.panel)}{background-color:${BRAND.surfaceRaised}!important;border-color:${BRAND.border}!important}`,
    `${p(C.heading)}{color:${BRAND.text}!important}`,
    `${p(C.body)}{color:${BRAND.textMuted}!important}`,
    `${p(C.faint)}{color:${BRAND.textFaint}!important}`,
    `${p(C.link)}{color:${BRAND.primaryLight}!important}`,
    `${p(C.rule)}{border-color:${BRAND.border}!important}`,
    // The quote rule is the one edge that has to stay visible on its own,
    // with no fill behind it, so it takes the stronger of the two.
    `${p("v-qr")}{border-color:${BRAND.borderStrong}!important}`,
    `${p(C.button)}{background-color:${BRAND.primary}!important;color:${BRAND.onPrimary}!important}`,
    `${p("v-tint-ok")}{background-color:${BRAND.successBg}!important}`,
    `${p("v-tint-bad")}{background-color:${BRAND.dangerBg}!important}`,
    accentRules,
    severityRules,
    calloutRules,
  ].join("");
}

function styleBlock(): string {
  return [
    "body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}",
    "table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}",
    "img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}",
    // iOS turns dates, addresses and phone-shaped strings into blue links
    // inside the footer and the detail rows. This keeps them the colour
    // they were set to.
    "a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}",
    "@media only screen and (max-width:600px){",
    ".v-shell{padding:20px 10px!important}",
    ".v-card{padding:26px 22px 28px 22px!important}",
    ".v-w{width:100%!important}",
    // A 132px label column next to a long value is unreadable at 320px, so
    // label and value stack instead. The value loses its own top padding so
    // it sits under its label rather than a row-gap away from it.
    ".v-dt,.v-dd{display:block!important;width:100%!important;padding-left:0!important;padding-right:0!important}",
    ".v-dt{padding-bottom:2px!important}",
    ".v-dd{padding-top:0!important}",
    // Full-bleed button on a phone. `display:block` on the anchor alone did
    // nothing here, which is what shipped: the anchor filled a cell inside a
    // shrink-to-fit table, so it stayed exactly as wide as its own label. The
    // wrapper table has to be told to span first.
    ".v-btnw{width:100%!important}",
    ".v-btn a{display:block!important;text-align:center!important}",
    "}",
    `@media (prefers-color-scheme:dark){${darkRules("")}}`,
    // Outlook.com does not answer the media query; it rewrites the document
    // and stamps these attributes on the elements it changed.
    darkRules("[data-ogsc] "),
    darkRules("[data-ogsb] "),
  ].join("");
}

// ---------------------------------------------------------------------------
// Body blocks
// ---------------------------------------------------------------------------

/**
 * weight 600, not 700: the app ships three weights (default, medium,
 * semibold) and bold appears nowhere in it, so an email heading at 700 was
 * heavier than any heading the recipient sees after they click through. The
 * wordmark below is 600 for the same reason.
 */
export function emailHeading(text: string): string {
  return `<h1 class="${C.heading}" style="margin:0 0 12px 0;font-family:${SANS_STACK};font-size:22px;line-height:1.32;font-weight:600;color:${LIGHT.text};letter-spacing:-0.3px;mso-line-height-rule:exactly;">${text}</h1>`;
}

/**
 * The sentence under the heading. A step larger than body copy, which is the
 * only thing separating it from a paragraph: both are muted, so a lead set at
 * the same size as what follows it was not leading anything.
 */
export function emailLead(text: string): string {
  return `<p class="${C.body}" style="margin:0 0 ${SPACE.block} 0;font-family:${SANS_STACK};font-size:16px;color:${LIGHT.textMuted};line-height:1.62;mso-line-height-rule:exactly;">${text}</p>`;
}

export function emailParagraph(text: string): string {
  return `<p class="${C.body}" style="margin:0 0 20px 0;font-family:${SANS_STACK};font-size:15px;color:${LIGHT.textMuted};line-height:1.65;mso-line-height-rule:exactly;">${text}</p>`;
}

/**
 * A block of already-built HTML in body-copy styling. The admin broadcast
 * composer's only content block: an admin writes markup, and this gives it the
 * same colour, size and dark-mode behaviour as a real template's prose.
 */
export function emailProse(html: string): string {
  return `<div class="${C.body}" style="font-family:${SANS_STACK};font-size:15px;color:${LIGHT.textMuted};line-height:1.65;">${html}</div>`;
}

/** Emphasis inside a lead or paragraph, in the heading colour. */
export function emailStrong(text: string): string {
  return `<strong class="${C.heading}" style="color:${LIGHT.text};font-weight:600;">${text}</strong>`;
}

/**
 * A trailing aside inside a line that is mostly something else: the previous
 * value next to the current one, a unit after a number. Small and faint, so
 * the number stays the thing being read.
 */
export function emailQuiet(text: string): string {
  return `<span class="${C.faint}" style="color:${LIGHT.textFaint};font-size:12px;font-weight:400;">${text}</span>`;
}

/**
 * Somebody else's words, quoted: the body of a support ticket or a contact
 * form submission.
 *
 * A rule and no fill, deliberately unlike `emailPanel`. Those blocks were
 * panels too, so a support notification was a grey box of metadata directly
 * on top of a grey box of message, and the reader's own sentence looked like
 * one more field of exported data. A blockquote rule is the oldest convention
 * there is for "this text is not ours" and it costs no surface.
 *
 * The rule is `border`, the neutral container colour, not an accent: this is
 * not the coloured stripe the callouts used to carry.
 */
export function emailQuote(label: string, inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${SPACE.block} 0;">
      <tr>
        <td class="v-qr" style="border-left:2px solid ${LIGHT.borderStrong};padding:1px 0 1px 16px;">
          <p class="${C.faint}" style="margin:0 0 8px 0;font-family:${SANS_STACK};font-size:12px;color:${LIGHT.textFaint};letter-spacing:0.2px;">${label}</p>
          ${inner}
        </td>
      </tr>
    </table>`;
}

/**
 * An inline link, in whichever blue the current scheme calls for.
 *
 * The href is escaped here rather than at the call site. Every template that
 * renders one builds it from APP_URL plus a server-generated token today, but
 * a block that writes an attribute is the right place to be sure a value
 * cannot close the quote, and a `&` in a query string has to be `&amp;` in an
 * attribute anyway.
 */
export function emailLink(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" class="${C.link}" style="color:${LIGHT.primaryText};text-decoration:underline;">${text}</a>`;
}

/**
 * Primary call to action, as a bulletproof button.
 *
 * Left-aligned with the body copy on purpose: it reads like a next step in a
 * sentence, not a centered marketing banner.
 *
 * Two renderings, and only one of them is ever shown. Word (Outlook 2016-2021)
 * drops `border-radius` on an anchor and will not paint a background on an
 * inline element reliably, which left the button square and, in a few builds,
 * unfilled. So Word gets a VML `<v:roundrect>` with the fill and the corner as
 * shape attributes, and the ordinary anchor is hidden from it. The VML shape
 * needs a literal width, which is estimated from the label: 15px semibold in
 * the fallback stacks averages a shade over 8px per character, plus the
 * horizontal padding. Being a few pixels wide is invisible; being narrow would
 * clip the label, so the estimate rounds up and floors at 168.
 */
export function emailButton(
  href: string,
  label: string,
  accent: "brand" | "bad" = "brand",
): string {
  const bg = accent === "bad" ? LIGHT.danger : LIGHT.primary;
  // The dark override belongs on the cell and the label, which are the two
  // things that actually paint, and only on the brand button: the danger red
  // reads correctly on both grounds and does not want repainting. The wrapper
  // table carried the class and the cell did not, which left the cell on the
  // light blue behind an anchor that had switched to the dark one.
  const cls = accent === "bad" ? "" : ` class="${C.button}"`;
  const safeHref = escapeHtml(href);
  const vmlWidth = Math.max(168, Math.ceil(label.length * 8.6) + 56);
  return `
    <div style="margin:6px 0 24px 0;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:46px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="14%" stroke="f" fillcolor="${bg}">
        <w:anchorlock/>
        <center style="color:${LIGHT.onPrimary};font-family:${SANS_STACK};font-size:15px;font-weight:600;">${label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="v-btnw" style="border-collapse:separate;">
        <tr>
          <td bgcolor="${bg}"${cls} style="border-radius:${R.control};background-color:${bg};">
            <a href="${safeHref}"${cls} style="display:inline-block;padding:13px 28px;background-color:${bg};color:${LIGHT.onPrimary};font-family:${SANS_STACK};font-size:15px;font-weight:600;line-height:1.2;text-decoration:none;border-radius:${R.control};">${label}</a>
          </td>
        </tr>
      </table>
      <!--<![endif]-->
    </div>`;
}

/**
 * The "if the button doesn't work" fallback, as plain prose plus the URL.
 *
 * The URL is escaped, which it was not: every template guarded the button's
 * `href` with an http(s) test and then printed the unguarded, unescaped value
 * here two lines later, so a link containing markup would have rendered it.
 * The one caller that could ever have passed such a value builds the URL
 * itself from APP_URL and a server-generated token, so nothing was
 * exploitable, but a block that writes user-influenced text into a document
 * should not depend on that.
 */
export function emailFallbackLink(url: string): string {
  return `
    <p class="${C.faint}" style="margin:0 0 5px 0;font-family:${SANS_STACK};font-size:13px;color:${LIGHT.textFaint};line-height:1.6;">Or paste this link into your browser:</p>
    <p class="${C.link}" style="margin:0;font-family:${MONO_STACK};font-size:12px;color:${LIGHT.primaryText};word-break:break-all;line-height:1.6;">${escapeHtml(url)}</p>`;
}

/**
 * A quiet callout: a tinted box with a hairline edge of the same hue, and
 * prose, no bold question label. Use it for the genuinely useful aside
 * (expiry, "you can ignore this"), not a platitude.
 *
 * It used to be a grey box with a 3px accent bar down its left edge. On a
 * security notice that bar was `warning`, a dark orange that sat next to the
 * brand blue in the same message and matched nothing else in the product. A
 * tint plus an edge is how the in-app UI draws the same thing, and it lets the
 * hue read as a temperature rather than as a stripe.
 */
export function emailNote(text: string, accent: EmailAccent = "brand"): string {
  const tint = LIGHT.callout[accent];
  // Fill and edge live on the `<td>`, not on the `<table>`: Word paints a cell
  // background and a cell border reliably and a table's only sometimes. The
  // `bgcolor` attribute is the belt to that brace for the oldest clients.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${SPACE.block} 0;">
      <tr>
        <td class="${calloutClass(accent)}" bgcolor="${tint.bg}" style="background-color:${tint.bg};border:1px solid ${tint.edge};border-radius:${R.block};padding:14px 16px;">
          <span class="${C.body}" style="font-family:${SANS_STACK};font-size:14px;color:${LIGHT.textMuted};line-height:1.6;">${text}</span>
        </td>
      </tr>
    </table>`;
}

export interface EmailDetailRow {
  label: string;
  /** Already-escaped HTML. */
  value: string;
  mono?: boolean;
  accent?: EmailAccent | EmailSeverity;
  /**
   * A small, de-emphasised second line under the value. Already-escaped HTML.
   * For the raw form of something the value states in human terms: the exact
   * user-agent string under "Firefox 155 on Windows".
   */
  hint?: string;
}

function rowAccent(
  accent: EmailDetailRow["accent"],
): { cls: string; color: string } | null {
  if (!accent) return null;
  if (accent in ACCENTS) return accentAttrs(accent as EmailAccent);
  const sev = SEVERITIES[accent as EmailSeverity];
  return { cls: accentClass(accent), color: sev.light };
}

/**
 * Label/value rows on a muted surface.
 *
 * No outer border and no row rules. The first version drew a 1px box with a
 * divider above every row after the first, which is a spreadsheet: three of
 * those stacked in one message read as exported data pasted into a mail rather
 * than as part of a written message. What separates rows now is space.
 *
 * Padding lives on a `<td>` and not on the `<table>`, because Word ignores
 * the latter and every Outlook was rendering these rows flush to the edge.
 *
 * The label column collapses onto its own line under 600px.
 */
export function emailDetailPanel(rows: EmailDetailRow[]): string {
  const body = rows
    .map((r, i) => {
      const top = i === 0 ? "0" : "14px";
      const font = r.mono ? MONO_STACK : SANS_STACK;
      const a = rowAccent(r.accent);
      const hint = r.hint
        ? `<div class="${C.faint}" style="margin-top:4px;font-family:${MONO_STACK};font-size:11px;line-height:1.5;color:${LIGHT.textFaint};word-break:break-all;">${r.hint}</div>`
        : "";
      return `
        <tr>
          <td class="v-dt ${C.faint}" style="padding:${top} 16px 0 0;color:${LIGHT.textFaint};font-family:${SANS_STACK};font-size:13px;line-height:1.5;width:132px;vertical-align:top;">${r.label}</td>
          <td class="v-dd ${a ? a.cls : C.heading}" style="padding:${top} 0 0 0;color:${a ? a.color : LIGHT.text};font-family:${font};font-size:14px;font-weight:500;line-height:1.5;word-break:break-word;vertical-align:top;">${r.value}${hint}</td>
        </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${SPACE.block} 0;">
      <tr>
        <td class="${C.panel}" bgcolor="${LIGHT.surfaceRaised}" style="background-color:${LIGHT.surfaceRaised};border-radius:${R.block};padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
        </td>
      </tr>
    </table>`;
}

/**
 * A titled panel wrapping arbitrary block content: the finding lists and the
 * admin change table. One shape for all three, which previously each built
 * their own panel with slightly different padding.
 */
export function emailPanel(label: string, inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      <tr>
        <td class="${C.panel}" bgcolor="${LIGHT.surfaceRaised}" style="background-color:${LIGHT.surfaceRaised};border-radius:${R.block};padding:18px 20px;">
          <p class="${C.faint}" style="margin:0 0 12px 0;font-family:${SANS_STACK};font-size:12px;color:${LIGHT.textFaint};letter-spacing:0.2px;">${label}</p>
          ${inner}
        </td>
      </tr>
    </table>`;
}

/**
 * A one-time code, rendered big, centered, and letter-spaced so it's easy to
 * read off the screen and copy. The `text-indent` cancels the trailing gap
 * letter-spacing leaves after the last glyph, keeping the run visually
 * centered.
 */
export function emailCodeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${SPACE.block} 0;">
      <tr>
        <td align="center" class="${C.panel}" bgcolor="${LIGHT.surfaceRaised}" style="background-color:${LIGHT.surfaceRaised};border-radius:${R.block};padding:26px 16px;">
          <div class="${C.link}" style="font-family:${MONO_STACK};font-size:30px;font-weight:600;letter-spacing:9px;text-indent:9px;color:${LIGHT.primaryText};line-height:1.2;mso-line-height-rule:exactly;">${escapeHtml(code)}</div>
        </td>
      </tr>
    </table>`;
}

/**
 * One severity pill: an outlined chip. Empty when the count is zero, so a
 * chip row only shows the severities actually present.
 */
function severityChip(severity: EmailSeverity, count: number): string {
  if (count <= 0) return "";
  const { light } = SEVERITIES[severity];
  return `<td style="padding:0 6px 6px 0;"><span class="${accentClass(severity)}" style="display:inline-block;padding:5px 11px;border:1px solid ${light};border-radius:${R.pill};font-family:${SANS_STACK};font-size:12px;font-weight:600;color:${light};white-space:nowrap;">${count} ${severity}</span></td>`;
}

export function severityChipRow(counts: {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
}): string {
  const chips = (
    ["critical", "high", "medium", "low", "info"] as EmailSeverity[]
  )
    .map((s) => severityChip(s, counts[s] ?? 0))
    .join("");
  return chips
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${SPACE.block} 0;"><tr>${chips}</tr></table>`
    : "";
}

/** One line of a finding list: a severity tag, a title, and optional context. */
export function emailFindingItem(
  severity: string,
  title: string,
  context?: string,
): string {
  const key = (severity in SEVERITIES ? severity : "info") as EmailSeverity;
  const { light } = SEVERITIES[key];
  const trailer = context
    ? ` <span class="${C.faint}" style="color:${LIGHT.textFaint};font-size:11px;">${context}</span>`
    : "";
  return `<li class="${C.body}" style="margin:0 0 8px 0;font-family:${SANS_STACK};font-size:13px;color:${LIGHT.textMuted};line-height:1.6;"><span class="${accentClass(key)}" style="display:inline-block;min-width:56px;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;color:${light};">${escapeHtml(severity)}</span> ${title}${trailer}</li>`;
}

export function emailFindingList(items: string): string {
  return `<ul style="margin:0;padding-left:18px;">${items}</ul>`;
}

/**
 * One before/after row for the admin change notice: the old value struck
 * through in a red tint, the new one in a green tint. `&rarr;` rather than a
 * bare arrow glyph, because Outlook renders an unencoded U+2192 from a
 * non-UTF8 part as a question mark.
 */
export function emailChangeRow(
  field: string,
  oldValue: string,
  newValue: string,
): string {
  const pill = (
    value: string,
    tint: string,
    bg: string,
    accent: EmailAccent,
    strike: boolean,
  ) =>
    `<span class="${tint} ${accentClass(accent)}" style="display:inline-block;padding:3px 8px;background-color:${bg};border-radius:4px;font-family:${SANS_STACK};font-size:12px;color:${ACCENTS[accent].light};${strike ? "text-decoration:line-through;" : ""}">${escapeHtml(value || "(empty)")}</span>`;
  return `<tr>
        <td class="${C.faint} ${C.rule}" style="padding:10px 12px 10px 0;border-bottom:1px solid ${LIGHT.border};color:${LIGHT.textFaint};font-family:${SANS_STACK};font-size:13px;width:120px;vertical-align:top;">${escapeHtml(field)}</td>
        <td class="${C.rule}" style="padding:10px 0;border-bottom:1px solid ${LIGHT.border};vertical-align:top;">
          ${pill(oldValue, "v-tint-bad", LIGHT.dangerBg, "bad", true)}
          <span class="${C.faint}" style="color:${LIGHT.textFaint};padding:0 6px;">&rarr;</span>
          ${pill(newValue, "v-tint-ok", LIGHT.successBg, "ok", false)}
        </td>
      </tr>`;
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export interface EmailLayoutInput {
  /** Already-safe HTML for the card body. Callers escape their own text. */
  content: string;
  appName: string;
  appUrl: string;
  /** Absolute URL. Email clients do not resolve root-relative asset paths. */
  logoSrc: string;
  supportEmail: string;
  /** Human-facing preferences page, null when there is no unsubscribe token. */
  unsubscribeUrl?: string | null;
  /** Already-built hidden preview block, empty string when there is none. */
  preheaderHtml?: string;
  /**
   * Used for the `<title>`, which several clients show above the message and
   * which screen readers announce first. Falls back to the app name.
   */
  title?: string;
}

export function emailLayout({
  content,
  appName,
  appUrl,
  logoSrc,
  supportEmail,
  unsubscribeUrl = null,
  preheaderHtml = "",
  title,
}: EmailLayoutInput): string {
  const hostname = new URL(appUrl).hostname;

  // One style for every footer link, so the row reads as a row rather than as
  // four differently-weighted things that happen to be blue.
  const footLink = (href: string, text: string) =>
    `<a href="${escapeHtml(href)}" class="${C.faint}" style="color:${LIGHT.textFaint};text-decoration:underline;white-space:nowrap;">${text}</a>`;
  const dot = `<span class="${C.faint}" style="color:${LIGHT.textFaint};padding:0 7px;">&middot;</span>`;

  // Two different reasons a message can land, and telling the reader the
  // wrong one is worse than saying nothing. A message that carries an
  // unsubscribe token went through the preference gate and really can be
  // turned off; one without a token is a security or billing notice that
  // cannot, and pointing that reader at a settings page they will find no
  // switch on is a support ticket waiting to happen.
  const reasonLine = unsubscribeUrl
    ? `You're getting this because you have a ${escapeHtml(appName)} account.`
    : `This is a service notice about your ${escapeHtml(appName)} account, so email preferences don't cover it.`;

  // The preferences affordance used to be an outlined pseudo-button above
  // three lines of grey text carrying four links. It is a link in the link
  // row now: it is the least likely thing a reader wants, and giving it a
  // button made the footer louder than the message.
  const links = [
    ...(unsubscribeUrl
      ? [footLink(unsubscribeUrl, "Manage email preferences")]
      : []),
    footLink(`mailto:${supportEmail}`, escapeHtml(supportEmail)),
    footLink(appUrl, hostname),
  ].join(dot);

  return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${escapeHtml(title || appName)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>${styleBlock()}</style>
</head>
<body class="${C.canvas}" style="margin:0;padding:0;background-color:${LIGHT.canvas};font-family:${SANS_STACK};color:${LIGHT.text};">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${C.canvas}" bgcolor="${LIGHT.canvas}" style="background-color:${LIGHT.canvas};">
    <tr>
      <td align="center" class="${C.canvas} v-shell" bgcolor="${LIGHT.canvas}" style="background-color:${LIGHT.canvas};padding:${SPACE.shellPad};">
        <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="v-w" style="width:600px;max-width:600px;">
          <tr>
            <td class="${C.card}" bgcolor="${LIGHT.surface}" style="background-color:${LIGHT.surface};border:1px solid ${LIGHT.border};border-radius:${R.card};padding:${SPACE.cardPad};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
                <tr>
                  <td>
                    <a href="${appUrl}" class="${C.heading}" style="text-decoration:none;color:${LIGHT.text};">
                      <img src="${logoSrc}" alt="" width="26" height="26" style="display:inline-block;vertical-align:middle;border:0;" />
                      <span class="${C.heading}" style="display:inline-block;vertical-align:middle;margin-left:9px;font-family:${MONO_STACK};font-size:16px;font-weight:600;letter-spacing:-0.3px;color:${LIGHT.text};">${escapeHtml(appName)}</span>
                    </a>
                  </td>
                </tr>
              </table>
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 12px 0 12px;text-align:center;">
              <p class="${C.faint}" style="margin:0 0 9px 0;font-family:${SANS_STACK};font-size:12px;color:${LIGHT.textFaint};line-height:1.6;">
                ${reasonLine}
              </p>
              <p class="${C.faint}" style="margin:0;font-family:${SANS_STACK};font-size:12px;color:${LIGHT.textFaint};line-height:1.9;">
                ${links}
              </p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
