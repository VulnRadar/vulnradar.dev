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
 * The body blocks (heading, lead, button, note, detail panel, code block,
 * severity chips) moved here for the same reason: they were private to
 * email.ts, so the admin preview hand-rolled an `<h1>` at a different font
 * weight than every real message used.
 *
 * Nothing in here imports server-only code or reads deployment config, so the
 * admin preview and the mail sender can both call it. Everything that differs
 * between the two callers (which app URL, which logo, whether there is an
 * unsubscribe token) is an argument.
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
 * light value is measured on #f2f5f9 (surfaceRaised, the tighter of the two
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
  return [
    `${prefix}body,${p(C.canvas)}{background-color:${BRAND.bg}!important}`,
    `${p(C.card)}{background-color:${BRAND.surface}!important;border-color:${BRAND.border}!important}`,
    `${p(C.panel)}{background-color:${BRAND.surfaceRaised}!important;border-color:${BRAND.borderStrong}!important}`,
    `${p(C.heading)}{color:${BRAND.text}!important}`,
    `${p(C.body)}{color:${BRAND.textMuted}!important}`,
    `${p(C.faint)}{color:${BRAND.textFaint}!important}`,
    `${p(C.link)}{color:${BRAND.primaryLight}!important}`,
    `${p(C.rule)}{border-color:${BRAND.border}!important}`,
    `${p(C.button)}{background-color:${BRAND.primary}!important;color:${BRAND.onPrimary}!important}`,
    `${p("v-tint-ok")}{background-color:${BRAND.successBg}!important}`,
    `${p("v-tint-bad")}{background-color:${BRAND.dangerBg}!important}`,
    accentRules,
    severityRules,
  ].join("");
}

function styleBlock(): string {
  return [
    "body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}",
    "table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}",
    "img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}",
    // iOS turns dates, addresses and phone-shaped strings into blue links
    // inside the footer and the detail panels. This keeps them the colour
    // they were set to.
    "a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}",
    "@media only screen and (max-width:600px){",
    ".v-shell{padding:24px 12px!important}",
    ".v-card{padding:26px 20px!important}",
    ".v-w{width:100%!important}",
    // A 130px label column next to a long value is unreadable at 320px, so
    // label and value stack instead.
    ".v-dt,.v-dd{display:block!important;width:100%!important;padding-left:0!important;padding-right:0!important}",
    ".v-dt{padding-bottom:2px!important}",
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
  return `<h1 class="${C.heading}" style="margin:0 0 12px 0;font-family:${SANS_STACK};font-size:22px;line-height:1.3;font-weight:600;color:${LIGHT.text};letter-spacing:-0.3px;mso-line-height-rule:exactly;">${text}</h1>`;
}

export function emailLead(text: string): string {
  return `<p class="${C.body}" style="margin:0 0 22px 0;font-family:${SANS_STACK};font-size:15px;color:${LIGHT.textMuted};line-height:1.65;mso-line-height-rule:exactly;">${text}</p>`;
}

export function emailParagraph(text: string): string {
  return `<p class="${C.body}" style="margin:0 0 20px 0;font-family:${SANS_STACK};font-size:14px;color:${LIGHT.textMuted};line-height:1.65;mso-line-height-rule:exactly;">${text}</p>`;
}

/**
 * A block of already-built HTML in body-copy styling. The admin broadcast
 * composer's only content block: an admin writes markup, and this gives it the
 * same colour, size and dark-mode behaviour as a real template's prose.
 */
export function emailProse(html: string): string {
  return `<div class="${C.body}" style="font-family:${SANS_STACK};font-size:14px;color:${LIGHT.textMuted};line-height:1.65;">${html}</div>`;
}

/** Emphasis inside a lead or paragraph, in the heading colour. */
export function emailStrong(text: string): string {
  return `<strong class="${C.heading}" style="color:${LIGHT.text};font-weight:600;">${text}</strong>`;
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
 * Primary call to action. Left-aligned with the body copy on purpose: it
 * reads like a next step in a sentence, not a centered marketing banner. The
 * `bgcolor` attribute is what Outlook actually paints; the inline
 * `background-color` is for everything else, and the class is what dark mode
 * overrides.
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
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px 0;border-collapse:separate;">
      <tr>
        <td bgcolor="${bg}"${cls} style="border-radius:8px;background-color:${bg};">
          <a href="${escapeHtml(href)}"${cls} style="display:inline-block;padding:13px 30px;background-color:${bg};color:${LIGHT.onPrimary};font-family:${SANS_STACK};font-size:15px;font-weight:600;line-height:1.2;text-decoration:none;border-radius:8px;">${label}</a>
        </td>
      </tr>
    </table>`;
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
    <p class="${C.faint}" style="margin:0 0 6px 0;font-family:${SANS_STACK};font-size:13px;color:${LIGHT.textFaint};line-height:1.6;">Or paste this link into your browser:</p>
    <p class="${C.link}" style="margin:0;font-family:${MONO_STACK};font-size:13px;color:${LIGHT.primaryText};word-break:break-all;line-height:1.6;">${escapeHtml(url)}</p>`;
}

/**
 * A quiet callout: an accent edge and prose, no bold question label. Use it
 * for the genuinely useful aside (expiry, "you can ignore this"), not a
 * platitude.
 */
export function emailNote(text: string, accent: EmailAccent = "brand"): string {
  const { cls, color } = accentAttrs(accent);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      <tr>
        <td class="${C.panel} ${cls}" style="background-color:${LIGHT.surfaceRaised};border-left:3px solid ${color};border-radius:6px;padding:12px 16px;">
          <span class="${C.body}" style="font-family:${SANS_STACK};font-size:13px;color:${LIGHT.textMuted};line-height:1.65;">${text}</span>
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
 * A surface panel of label/value rows. Replaces the ad-hoc grey card + inline
 * `<table>` each old template hand-rolled; callers pass already-escaped
 * values. The label column collapses onto its own line under 600px.
 */
export function emailDetailPanel(rows: EmailDetailRow[]): string {
  const body = rows
    .map((r, i) => {
      const divider =
        i === 0 ? "" : `border-top:1px solid ${LIGHT.border};padding-top:10px;`;
      const dividerCls = i === 0 ? "" : ` ${C.rule}`;
      const gap = i === 0 ? "0" : "10px";
      const font = r.mono ? MONO_STACK : SANS_STACK;
      const a = rowAccent(r.accent);
      return `
        <tr>
          <td class="v-dt ${C.faint}${dividerCls}" style="padding:${gap} 12px 8px 0;${divider}color:${LIGHT.textFaint};font-family:${SANS_STACK};font-size:13px;width:140px;vertical-align:top;">${r.label}</td>
          <td class="v-dd ${a ? a.cls : C.heading}${dividerCls}" style="padding:${gap} 0 8px 0;${divider}color:${a ? a.color : LIGHT.text};font-family:${font};font-size:13px;word-break:break-word;vertical-align:top;">${r.value}</td>
        </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${C.panel}" style="background-color:${LIGHT.surfaceRaised};border:1px solid ${LIGHT.border};border-radius:8px;padding:16px;margin:0 0 22px 0;">
      ${body}
    </table>`;
}

/**
 * A titled panel wrapping arbitrary block content: the finding lists and the
 * admin change table. One shape for all three, which previously each built
 * their own panel with slightly different padding.
 */
export function emailPanel(label: string, inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${C.panel}" style="background-color:${LIGHT.surfaceRaised};border:1px solid ${LIGHT.border};border-radius:8px;padding:16px;margin:0 0 20px 0;">
      <tr><td>
        <p class="${C.faint}" style="margin:0 0 10px 0;font-family:${SANS_STACK};font-size:12px;color:${LIGHT.textFaint};letter-spacing:0.2px;">${label}</p>
        ${inner}
      </td></tr>
    </table>`;
}

/**
 * A one-time code, rendered big, centered, and letter-spaced so it's easy to
 * read off the screen and copy. The `text-indent` cancels the trailing gap
 * letter-spacing leaves after the last glyph, keeping the run visually
 * centered.
 */
export function emailCodeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr>
        <td align="center" class="${C.panel}" style="background-color:${LIGHT.surfaceRaised};border:1px solid ${LIGHT.borderStrong};border-radius:10px;padding:24px 16px;">
          <div class="${C.link}" style="font-family:${MONO_STACK};font-size:32px;font-weight:700;letter-spacing:10px;text-indent:10px;color:${LIGHT.primaryText};line-height:1.2;mso-line-height-rule:exactly;">${escapeHtml(code)}</div>
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
  return `<td style="padding:0 6px 6px 0;"><span class="${accentClass(severity)}" style="display:inline-block;padding:5px 11px;border:1px solid ${light};border-radius:999px;font-family:${SANS_STACK};font-size:12px;font-weight:600;color:${light};white-space:nowrap;">${count} ${severity}</span></td>`;
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
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr>${chips}</tr></table>`
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
  const settingsUrl = `${appUrl}/profile?tab=notifications`;

  const preferencesButton = unsubscribeUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 16px auto;">
        <tr>
          <td bgcolor="${LIGHT.surface}" class="${C.card}" style="border-radius:6px;background-color:${LIGHT.surface};">
            <a href="${unsubscribeUrl}" class="${C.faint}" style="display:inline-block;padding:8px 18px;border:1px solid ${LIGHT.borderStrong};color:${LIGHT.textMuted};font-family:${SANS_STACK};font-size:12px;font-weight:600;text-decoration:none;border-radius:6px;">Manage email preferences</a>
          </td>
        </tr>
      </table>`
    : "";

  // Two different reasons a message can land, and telling the reader the
  // wrong one is worse than saying nothing. A message that carries an
  // unsubscribe token went through the preference gate and really can be
  // turned off; one without a token is a security or billing notice that
  // cannot, and pointing that reader at a settings page they will find no
  // switch on is a support ticket waiting to happen.
  const reasonLine = unsubscribeUrl
    ? `You're getting this because you have a ${appName} account. Choose what we send you in your <a href="${settingsUrl}" class="${C.link}" style="color:${LIGHT.primaryText};text-decoration:underline;">notification settings</a>, or reach us at <a href="mailto:${supportEmail}" class="${C.link}" style="color:${LIGHT.primaryText};text-decoration:underline;">${supportEmail}</a>.`
    : `This is a service message about your ${appName} account, so it isn't covered by email preferences. Questions go to <a href="mailto:${supportEmail}" class="${C.link}" style="color:${LIGHT.primaryText};text-decoration:underline;">${supportEmail}</a>.`;

  return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
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
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${C.canvas}" style="background-color:${LIGHT.canvas};">
    <tr>
      <td align="center" class="v-shell" style="padding:40px 20px;">
        <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="v-w" style="width:600px;max-width:600px;">
          <tr>
            <td align="center" style="padding:0 0 22px 0;">
              <a href="${appUrl}" class="${C.heading}" style="text-decoration:none;color:${LIGHT.text};">
                <img src="${logoSrc}" alt="${escapeHtml(appName)} logo" width="30" height="30" style="display:inline-block;vertical-align:middle;border:0;" />
                <span class="${C.heading}" style="display:inline-block;vertical-align:middle;margin-left:9px;font-family:${MONO_STACK};font-size:18px;font-weight:600;letter-spacing:-0.3px;color:${LIGHT.text};">${escapeHtml(appName)}</span>
              </a>
            </td>
          </tr>
          <tr>
            <td class="${C.card}" style="background-color:${LIGHT.surface};border:1px solid ${LIGHT.border};border-top:3px solid ${LIGHT.primary};border-radius:12px;padding:34px 32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:26px 16px 0 16px;text-align:center;">
              ${preferencesButton}
              <p class="${C.body}" style="margin:0 0 10px 0;font-family:${SANS_STACK};font-size:12px;color:${LIGHT.textMuted};line-height:1.6;">
                ${reasonLine}
              </p>
              <p class="${C.faint}" style="margin:0;font-family:${SANS_STACK};font-size:11px;color:${LIGHT.textFaint};line-height:1.5;">
                ${escapeHtml(appName)}, web vulnerability scanner &middot; <a href="${appUrl}" class="${C.faint}" style="color:${LIGHT.textFaint};text-decoration:underline;">${hostname}</a>
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
