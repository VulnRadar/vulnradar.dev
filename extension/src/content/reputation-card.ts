// On-page "site alert" card: a dismissible panel injected into the page
// (Shadow DOM, isolated from page CSS both ways) that shows either
//   - a known-host summary (last scan's danger score + severity counts), or
//   - a "scan this site?" prompt for a host nobody has scanned yet.
//
// Modeled on a password manager's save-login prompt: corner-positioned,
// one click to dismiss or mute. The background decides WHETHER to show
// this (mute settings, throttling, the API call itself all happen there -
// see service-worker.ts's maybeShowReputationFromSender) and just hands
// this module the data to render.

import { html, render, type TemplateResult } from "lit-html";
import { TIER_VAR, tierForScore } from "../lib/badge";
import { VULNRADAR } from "../lib/constants";
import { formatRelative } from "../lib/format";
import { buildScopedTokensCss } from "../lib/tokens";
import type {
  CardPosition,
  ReputationResponse,
  ReputationSeverityCounts,
  SafetyVerdict,
} from "../lib/types";

const HOST_ID = "vulnradar-reputation-host";
const AUTO_DISMISS_MS_KNOWN = 14_000;
const AUTO_DISMISS_MS_UNKNOWN = 20_000;

export interface CardActions {
  readonly onScanNow: (url: string) => void;
  readonly onMuteSite: () => void;
  readonly onMuteGlobal: () => void;
  readonly onSnooze: () => void;
  readonly onDismiss: () => void;
}

let shadowRoot: ShadowRoot | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
// The duration most recently armed via scheduleAutoDismiss(), so a
// mouseleave can re-arm the same countdown a mouseenter paused (see
// cancelAutoDismiss/resumeAutoDismiss below). Null means "the currently
// rendered card has no auto-dismiss at all" -- showScanningCard clears it
// explicitly, since a scan can take minutes and must never auto-dismiss,
// even via a mouseenter/mouseleave cycle that would otherwise re-arm a
// duration inherited from whatever card was showing before it.
let dismissDuration: number | null = null;

// Which screen corner the card renders in - defaults to the original
// hardcoded top-right until setCardPosition() is called with the loaded
// Settings.cardPosition value. Read by Chrome() on every render (see
// CARD_CSS's `.card[data-position=...]` rules below), so a change takes
// effect the next time any card is shown rather than needing its own
// re-render call.
let cardPosition: CardPosition = "top-right";

/** Called by detector.ts once it has loaded (or live-updated) the user's
 *  Settings.cardPosition, so every subsequently rendered card uses the
 *  right corner. */
export function setCardPosition(position: CardPosition): void {
  cardPosition = position;
}

// Appended to <html> rather than <body>: a host page that applies a
// transform/filter/will-change to <body> (common for dark-mode-inversion
// tricks) would otherwise become the containing block for this card's
// position:fixed, making it track that element's box instead of the
// viewport. <html> itself is transformed far less often in practice.
function overlayParent(): Element {
  return document.documentElement ?? document.body;
}

/**
 * Layout properties pinned on the HOST element with `!important`.
 *
 * Everything inside the shadow root is already unreachable from the page's
 * stylesheets, but the host <div> is an ordinary element of the page's DOM and
 * IS matched by the page's own selectors. `:host { all: initial }` in CARD_CSS
 * does not settle it either: a `:host` rule loses the cascade to a rule in the
 * outer document that matches the host, so a site with `div { position:
 * absolute }`, an inverted-dark-mode `filter` on everything, a global
 * `* { visibility: hidden }` behind a loading class, or a `[id] { display:
 * none }` reset takes the card with it. An inline declaration marked important
 * is the highest author-origin priority there is, so this is the one form the
 * page cannot outrank.
 *
 * Deliberately a short list of only the properties that can HIDE the card or
 * break the `position: fixed` inside it (a transform, filter, perspective,
 * backdrop-filter, contain or will-change on an ancestor makes that ancestor
 * the containing block). Everything cosmetic is left to the shadow tree.
 */
const HOST_STYLE_PINS: ReadonlyArray<readonly [string, string]> = [
  ["display", "block"],
  ["position", "static"],
  ["visibility", "visible"],
  ["opacity", "1"],
  ["pointer-events", "auto"],
  ["transform", "none"],
  ["filter", "none"],
  ["backdrop-filter", "none"],
  ["perspective", "none"],
  ["contain", "none"],
  ["will-change", "auto"],
  ["clip-path", "none"],
  ["mask", "none"],
  ["width", "auto"],
  ["height", "auto"],
  ["max-width", "none"],
  ["max-height", "none"],
  ["margin", "0"],
  ["padding", "0"],
  ["border", "0"],
  ["float", "none"],
  ["inset", "auto"],
];

function ensureRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-vulnradar", "true");
  for (const [prop, value] of HOST_STYLE_PINS) {
    host.style.setProperty(prop, value, "important");
  }
  overlayParent().appendChild(host);
  shadowRoot = host.attachShadow({ mode: "open" });
  // Escape closes the card, the way it closes the options page's confirm
  // dialog. Bound to the host element rather than to the document on purpose:
  // this listener only ever fires while focus is INSIDE the card, so it can
  // never swallow an Escape the page underneath wanted (closing its own modal,
  // leaving a full-screen video, cancelling an autocomplete). A keyboard user
  // reaches the card by tabbing to it, and the card never takes focus by
  // itself, so the page keeps control until the user hands it over.
  host.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hideCard();
    }
  });
  // SC 2.2.1. The countdown already paused on mouseenter; a keyboard user got
  // no such courtesy, so the card could vanish mid-tab-through. focusin fires
  // for focus anywhere inside the shadow tree and bubbles out to the host.
  host.addEventListener("focusin", cancelAutoDismiss);
  host.addEventListener("focusout", (e) => {
    // Moving between two buttons inside the card retargets both target and
    // relatedTarget to the host, and the DOM spec skips dispatch entirely when
    // those are equal, so this normally does not even fire for an internal
    // move. The guard makes that guarantee explicit rather than relying on it.
    if (e.relatedTarget === host) return;
    resumeAutoDismiss();
  });
  return shadowRoot;
}

export function hideCard(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  dismissDuration = null;
  if (!shadowRoot) return;
  render(html``, shadowRoot);
}

function scheduleAutoDismiss(ms: number): void {
  dismissDuration = ms;
  if (dismissTimer !== null) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(hideCard, ms);
}

// Pauses the countdown while the cursor is over the card, without
// forgetting the duration itself -- resumeAutoDismiss() below re-arms it.
function cancelAutoDismiss(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

// Re-arms the countdown cancelAutoDismiss() paused, once the cursor
// leaves the card. No-ops for a card that never had an auto-dismiss to
// begin with (showScanningCard clears dismissDuration for exactly this
// reason).
function resumeAutoDismiss(): void {
  if (dismissDuration !== null) scheduleAutoDismiss(dismissDuration);
}

/**
 * Prefers the server's own canonical safe/caution/unsafe tier
 * (lib/scanner/safety-rating.ts's getSafetyRating, threaded through as
 * ReputationResponse.verdict / ScanResult.verdict) so this card always
 * agrees with the public host page, history, and every other surface for
 * the exact same scan.
 *
 * Falls back to a local, deliberately CONSERVATIVE score/critical-only
 * heuristic only when no server verdict is available at all (the narrow
 * case of a result cached from a scan this extension just ran, before
 * that response included a verdict field -- see cacheReputationFromScan).
 * The old fallback used `high > 0` as an automatic "caution", which
 * can't tell a high-severity EXPLOITABLE finding from a high-severity
 * HARDENING one (e.g. a lone "Missing HSTS") -- that's what caused this
 * card to say "review before trusting this host" for hosts the canonical
 * scorer, and every other surface, correctly called safe. The fallback
 * below only escalates past "safe" on the danger score itself, never on
 * a raw severity count, so a missing verdict degrades to "less specific"
 * rather than "wrong in the alarming direction."
 */
function verdictFor(
  score: number,
  serverVerdict: SafetyVerdict | null | undefined,
): { tier: SafetyVerdict; label: string } {
  const tier: SafetyVerdict =
    serverVerdict ?? (score >= 8 ? "unsafe" : score >= 5 ? "caution" : "safe");
  const LABEL: Record<SafetyVerdict, string> = {
    safe: "No exploitable issues found",
    caution: "Review before trusting this host",
    unsafe: "Actively exploitable issues found",
  };
  return { tier, label: LABEL[tier] };
}

/**
 * The verdict rail and the verdict sentence beside it, as CSS variables rather
 * than the three literal hexes this used to hold.
 *
 * Those literals were a dark-theme palette painted on both themes: measured on
 * the light card, #22c55e reads 2.03:1 and #eab308 1.71:1 as the verdict TEXT,
 * against the 4.5:1 SC 1.4.3 asks for, and both are under 3:1 as the rail
 * itself. The tokens follow the theme (buildScopedTokensCss declares them on
 * `.card`, including the prefers-color-scheme block) and are the values the
 * rest of the extension already measures against: 6.04:1, 5.35:1 and 5.32:1 on
 * the light card, 8.01:1, 9.00:1 and 6.64:1 on the dark one.
 */
const VERDICT_RAIL: Record<SafetyVerdict, string> = {
  safe: "var(--vr-success)",
  caution: "var(--vr-warning)",
  unsafe: "var(--vr-danger)",
};

function MuteRow(actions: CardActions): TemplateResult {
  return html`
    <div class="mute-row">
      <button type="button" class="text-btn" @click=${actions.onSnooze}>
        Snooze 24h
      </button>
      <button
        type="button"
        class="text-btn"
        @click=${actions.onMuteSite}
        aria-label="Never show this alert on this site"
      >
        Not this site
      </button>
      <button
        type="button"
        class="text-btn"
        @click=${actions.onMuteGlobal}
        aria-label="Turn off site alerts everywhere"
      >
        Turn off
      </button>
    </div>
  `;
}

// No wordmark, no logo mark in the header: this card only ever appears
// injected by the extension itself, so labeling it is redundant -- the
// user already knows exactly what put it there. Dismiss floats in the
// corner instead of sitting in its own header row, so removing the brand
// row doesn't leave a dead strip of empty space above the content.
function Chrome(
  rail: string,
  body: TemplateResult,
  onDismiss: () => void,
): TemplateResult {
  return html`
    <style>
      ${CARD_CSS}
    </style>
    <!-- role="complementary" with a name, not a bare <div>: this is an
         extension panel floating over somebody else's page, and without a
         landmark and a label a screen reader user meets it as loose text with
         no indication of where it came from. Deliberately NOT role="dialog":
         the card appears without the user asking for it and must not behave
         modally over the page it is sitting on. -->
    <div
      class="card"
      role="complementary"
      aria-label="VulnRadar site alert"
      data-position=${cardPosition}
      @mouseenter=${cancelAutoDismiss}
      @mouseleave=${resumeAutoDismiss}
    >
      <span class="rail" style="background:${rail}" aria-hidden="true"></span>
      <button
        type="button"
        class="dismiss-btn"
        title="Dismiss"
        aria-label="Dismiss this VulnRadar alert"
        @click=${onDismiss}
      >
        <span aria-hidden="true">&times;</span>
      </button>
      ${body}
    </div>
  `;
}

/**
 * The severity read-out, drawn the way the popup and the app's own
 * severity-badge component draw it: a tint of the severity's own hue with a
 * matching edge, label and dot.
 *
 * It used to be a neutral grey pill with a coloured dot, painted from
 * severityHex() - the solid (dark) ramp on both themes, so on a light page the
 * "medium" dot measured 1.7:1 against the pill behind it and was effectively
 * invisible, and the same finding looked like two different things depending
 * on whether you read it here or in the popup. `data-sev` supplies the hue
 * (see SEVERITY_CHIP_VARS in CARD_CSS) so nothing here is a literal colour.
 */
function SeverityChips(
  counts: ReputationSeverityCounts | null,
): TemplateResult {
  const order = ["critical", "high", "medium", "low"] as const;
  const present = counts
    ? order.filter((s) => counts[s] > 0).map((s) => ({ s, n: counts[s] }))
    : [];
  if (present.length === 0) {
    return html`<p class="no-findings">No findings recorded on that scan.</p>`;
  }
  return html`
    <div class="chip-row">
      ${present.map(
        ({ s, n }) => html`
          <span class="chip" data-sev=${s}>
            <span class="dot" aria-hidden="true"></span>
            ${n} ${s}
          </span>
        `,
      )}
    </div>
  `;
}

/**
 * Shared "score summary" body -- a danger-score ring, verdict line, severity
 * chips, and a "when scanned" row -- used both by a reputation-lookup result
 * (showKnownCard, an existing scan someone else already ran) and by a scan
 * this browser just finished (showScanResultCard, below). Kept as one
 * renderer so a scan you just triggered from the card looks exactly like
 * looking up an existing result, per the user's own ask: "it will show the
 * results like if we just viewed a page with results."
 */
function ScoreBody(
  score: number,
  serverVerdict: SafetyVerdict | null | undefined,
  counts: ReputationSeverityCounts | null,
  whenLabel: string,
  reportLink: { host: string; onDismiss: () => void } | null,
): TemplateResult {
  // A CSS variable, not colorForScore()'s hex: that returns the solid ramp
  // (the dark theme's) whatever theme the page is being read in, which put
  // this numeral at 1.56:1 against the ring's own centre on a light page.
  // Same three tiers, same boundaries: see badge.ts's tierForScore.
  const scoreColor = TIER_VAR[tierForScore(score)];
  const verdict = verdictFor(score, serverVerdict);
  const ringPct = Math.max(0, Math.min(10, score)) * 10;

  return html`
    <div class="score-block">
      <!-- The ring is a conic gradient with no text of its own, so it is
           decorative: the number inside it and the "out of 10" in the label
           beside it carry the value. -->
      <div
        class="score-ring"
        style="--ring-color:${scoreColor};--ring-pct:${ringPct}%"
        aria-hidden="true"
      >
        <span class="score-num" style="color:${scoreColor}">${score}</span>
      </div>
      <div class="score-meta">
        <div class="eyebrow">Danger score</div>
        <div class="verdict" style="color:${VERDICT_RAIL[verdict.tier]}">
          <span class="score-spoken">${score} out of 10.</span>
          ${verdict.label}
        </div>
      </div>
    </div>

    ${SeverityChips(counts)}

    <div class="meta-row">
      <span class="when">${whenLabel}</span>
    </div>

    ${
      reportLink
        ? html`
            <a
              class="btn-primary"
              href="${VULNRADAR.apiHost}/host/${encodeURIComponent(reportLink.host)}"
              target="_blank"
              rel="noreferrer"
              @click=${reportLink.onDismiss}
            >
              View full report
            </a>
          `
        : null
    }
  `;
}

function railFor(
  score: number,
  serverVerdict: SafetyVerdict | null | undefined,
): string {
  return VERDICT_RAIL[verdictFor(score, serverVerdict).tier];
}

export function showKnownCard(
  data: ReputationResponse,
  actions: CardActions,
): void {
  const root = ensureRoot();
  const score = data.dangerScore ?? 0;
  const whenLabel = data.lastScannedAt
    ? formatRelative(data.lastScannedAt)
    : "";
  const body = html`
    ${ScoreBody(score, data.verdict, data.severityCounts, whenLabel, {
      host: data.host,
      onDismiss: actions.onDismiss,
    })}
    ${MuteRow(actions)}
  `;

  render(Chrome(railFor(score, data.verdict), body, actions.onDismiss), root);
  scheduleAutoDismiss(AUTO_DISMISS_MS_KNOWN);
}

/**
 * `signedIn` is a heuristic (see detector.ts's looksSignedIn), not a
 * determination: a scan always hits the target with a fresh, logged-out
 * request, so it can never cover what a signed-in visitor sees. Without
 * this caveat, the prompt read the same on every unknown host, which is
 * actively misleading on a site the visitor is signed into -- it implies
 * "Scan this site" will check the page in front of them, when it can only
 * ever check the logged-out surface.
 */
export function showUnknownCard(
  url: string,
  actions: CardActions,
  signedIn: boolean,
): void {
  const root = ensureRoot();
  const body = html`
    <div class="prompt-row">
      <div class="eyebrow">Not scanned yet</div>
      <div class="title">No VulnRadar record for this host</div>
      <div class="sub">
        ${
          signedIn
            ? html`You look signed in here. A scan checks this site the way a
              logged-out visitor sees it, not what you're logged into.`
            : html`Run the full check suite now, or skip it and keep browsing.`
        }
      </div>
    </div>
    <button
      type="button"
      class="btn-primary"
      @click=${() => actions.onScanNow(url)}
    >
      Scan this site
    </button>
    ${
      signedIn
        ? html`
            <a
              class="signed-in-link"
              href="${VULNRADAR.apiHost}/dashboard"
              target="_blank"
              rel="noreferrer"
              @click=${actions.onDismiss}
            >
              Need it scanned while signed in? Use authenticated scanning
            </a>
          `
        : null
    }
    ${MuteRow(actions)}
  `;
  // Token, not the literal #60a5fa this and the two cards below carried: the
  // whole reason VERDICT_RAIL above stopped holding hexes was that a literal
  // is one theme's value painted on both, and the error card's #ef4444 in
  // particular is the dark ramp's red on a light card (3.35:1, against 6.14:1
  // for the danger token).
  render(Chrome("var(--vr-primary)", body, actions.onDismiss), root);
  scheduleAutoDismiss(AUTO_DISMISS_MS_UNKNOWN);
}

/**
 * Shown the instant "Scan this site" is clicked, in place of dismissing the
 * card -- previously the card vanished immediately and a scan in progress
 * was only reflected in a small top-right corner pill, which read as "did
 * this even do anything?" and, once the scan finished or failed, as a
 * confusing tiny "Scan Failed" text with no context. This stays up as the
 * same size card, replaced in place by showScanResultCard/showScanErrorCard
 * once background.ts's scan:complete/scan:error message arrives.
 */
export function showScanningCard(url: string, onDismiss: () => void): void {
  const root = ensureRoot();
  // Cancel any timer/duration inherited from whatever card was showing
  // right before this one (e.g. showUnknownCard's 20s countdown, if "Scan
  // this site" was clicked right before it fired) -- without this, that
  // stale timer would still be armed underneath the scanning card and
  // could hide it mid-scan, and a stale dismissDuration would let a
  // mouseenter/mouseleave cycle on THIS card re-arm a dismiss it should
  // never have. A scan can legitimately take minutes and must never
  // auto-dismiss, full stop.
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  dismissDuration = null;
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* keep raw url as a fallback label */
  }
  const body = html`
    <div class="scanning-row" role="status">
      <span class="spinner-ring" aria-hidden="true"></span>
      <div>
        <div class="eyebrow">Running the full check suite</div>
        <div class="title">Scanning ${hostname}&hellip;</div>
      </div>
    </div>
  `;
  render(Chrome("var(--vr-primary)", body, onDismiss), root);
  // No auto-dismiss: a scan can legitimately take minutes, and it should
  // stay put until it actually has something to report.
}

/** A scan just finished (triggered from this card) -- rendered exactly like
 *  an existing result via the shared ScoreBody, per the user's ask. */
export function showScanResultCard(
  result: {
    readonly url: string;
    readonly dangerScore?: number;
    readonly verdict?: SafetyVerdict;
    readonly summary: ReputationSeverityCounts & { readonly total: number };
  },
  onDismiss: () => void,
): void {
  const root = ensureRoot();
  let host = result.url;
  try {
    host = new URL(result.url).hostname;
  } catch {
    /* keep raw url as a fallback */
  }
  const score = result.dangerScore ?? 0;
  const body = html`
    ${ScoreBody(score, result.verdict, result.summary, "Just now", { host, onDismiss })}
  `;
  render(Chrome(railFor(score, result.verdict), body, onDismiss), root);
  scheduleAutoDismiss(AUTO_DISMISS_MS_KNOWN);
}

/** A scan just failed -- kept as a full-size card with a real retry action,
 *  not a vanishing corner-pill error message. */
export function showScanErrorCard(
  error: string,
  onRetry: () => void,
  onDismiss: () => void,
): void {
  const root = ensureRoot();
  const body = html`
    <div class="prompt-row" role="alert">
      <div class="eyebrow">Scan failed</div>
      <div class="title">Could not finish scanning this site</div>
      <div class="sub">${error}</div>
    </div>
    <button type="button" class="btn-primary" @click=${onRetry}>
      Try again
    </button>
  `;
  render(Chrome("var(--vr-danger)", body, onDismiss), root);
  scheduleAutoDismiss(AUTO_DISMISS_MS_UNKNOWN);
}

/**
 * --vr-sev / --vr-sev-text per severity: the same two-variable contract
 * tokens.css declares for the popup's badges, scoped to this card's chips.
 * Built from the token NAMES rather than their values, so a severity retune in
 * tokens.json reaches the injected card without an edit here.
 */
const SEVERITY_CHIP_VARS = (
  ["critical", "high", "medium", "low", "info"] as const
)
  .map(
    (k) =>
      `  .chip[data-sev="${k}"] { --vr-sev: var(--vr-sev-${k}); --vr-sev-text: var(--vr-sev-${k}-text); }`,
  )
  .join("\n");

// The palette is built from lib/tokens.json, the same source scripts/
// gen-tokens.mjs uses for src/tokens.css. This file used to declare its own
// copy, which had drifted to a white card against the popup blue-tinted
// surface and a white-on-primary button the popup had already fixed as a
// sub-3:1 contrast failure.
const CARD_CSS = `
  :host { all: initial; }
${buildScopedTokensCss("  .card")}
${SEVERITY_CHIP_VARS}
  * { box-sizing: border-box; }
  .card {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 360px;
    /* The elevated-surface token, not the page background: this is a card
       floating over someone else's site. */
    background: var(--vr-card);
    color: var(--vr-text);
    /* The one place --vr-border's "container edges do not need 3:1" reasoning
       does not hold. Everywhere else in the extension a container sits on a
       surface this palette chose; here it floats over a page of unknown
       colour, and the edge is the only thing that says where the extension
       ends and the site begins. --vr-input is the token that carries a real
       floor (4.02:1 on the light card, 3.91:1 on the dark one), so the card
       reads as a deliberate object on a white page, a dark page or a
       photograph, instead of a faint 1.36:1 rectangle. */
    border: 1px solid var(--vr-input);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08);
    font: 13px/1.5 var(--vr-font);
    z-index: 2147483647;
    overflow: hidden;
    animation: vr-slide-in 200ms ease-out;
  }
  /* Default (and explicit top-right): matches the original hardcoded
     corner. The other three are sibling overrides driven by Chrome()'s
     data-position attribute, set from Settings.cardPosition. */
  .card[data-position="top-left"] {
    left: 16px;
    right: auto;
  }
  .card[data-position="bottom-right"] {
    top: auto;
    bottom: 16px;
  }
  .card[data-position="bottom-left"] {
    top: auto;
    bottom: 16px;
    left: 16px;
    right: auto;
  }
  @media (prefers-color-scheme: dark) {
    /* Only the elevation survives here: a floating overlay needs a heavier
       shadow on a dark page. Every colour comes from the shared tokens. */
    .card {
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
    }
  }
  @keyframes vr-slide-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  /* SC 2.3.3. The entrance is decoration and goes; the scanning spinner below
     does not, because it is the only signal that a scan which can legitimately
     run for minutes is still alive, and 2.2.2 exempts movement essential to
     the activity. Same split, and the same reasoning, as popup.css. */
  @media (prefers-reduced-motion: reduce) {
    .card { animation: none; }
  }
  .rail {
    display: block;
    height: 3px;
    width: 100%;
  }
  /* SC 2.4.7. Nothing here sets a focus style and the card is a keyboard
     user's only way to act on the alert, so the ring is declared explicitly in
     the theme's own colour rather than left to whatever the host page's
     rendering happens to give a shadow-tree element. */
  .card :focus-visible {
    outline: 2px solid var(--vr-primary-text);
    outline-offset: 2px;
    border-radius: var(--vr-radius-sm);
  }
  /* Text only the screen reader gets: the score ring is aria-hidden because it
     is a conic gradient, so the number has to be spoken somewhere. */
  .score-spoken {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  /* Icon-only and 17x23px before this: the 24px floor (SC 2.5.5) applies, and
     a dismiss control is exactly the one you do not want to miss and hit
     something on the page behind instead. */
  .dismiss-btn {
    appearance: none;
    background: none;
    border: none;
    position: absolute;
    top: 7px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    min-height: 24px;
    color: var(--vr-text-muted);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    border-radius: var(--vr-radius-sm);
    transition:
      color 0.12s ease,
      background 0.12s ease;
  }
  .dismiss-btn:hover { color: var(--vr-text); background: var(--vr-muted-bg); }
  .score-block {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 20px 16px 0;
  }
  .score-ring {
    flex-shrink: 0;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: conic-gradient(var(--ring-color) var(--ring-pct, 0%), var(--vr-muted-bg) 0);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .score-ring::before {
    content: "";
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background: var(--vr-bg);
  }
  .score-num {
    position: relative;
    font-size: 24px;
    font-weight: 800;
    line-height: 1;
  }
  .eyebrow {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--vr-text-muted);
  }
  .verdict {
    margin-top: 3px;
    font-size: 14px;
    font-weight: 600;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 16px 0;
  }
  /* Tinted by its own severity, matching the popup's .badge and the app's
     severity-badge component. It was a neutral grey pill with a dot painted
     from the solid ramp, so on a light page the "medium" dot sat at 1.7:1
     against the pill behind it, and the same finding looked like two
     unrelated things depending on which surface you read it on. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: color-mix(in srgb, var(--vr-sev) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--vr-sev) 40%, transparent);
    border-radius: var(--vr-radius-sm);
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vr-sev-text);
  }
  /* The graded tint, copied from the popup, which copied it from the app's
     SEVERITY_TONE: the quiet end of the ramp is the lightest part of the
     scale, so the tint gives way rather than the ramp. */
  .chip[data-sev="medium"],
  .chip[data-sev="low"],
  .chip[data-sev="info"] {
    background: color-mix(in srgb, var(--vr-sev) 10%, transparent);
    border-color: color-mix(in srgb, var(--vr-sev) 30%, transparent);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--vr-sev);
    flex-shrink: 0;
  }
  .no-findings {
    margin: 12px 16px 0;
    font-size: 12px;
    color: var(--vr-text-muted);
  }
  .meta-row {
    padding: 10px 16px 0;
    font-size: 11.5px;
    color: var(--vr-text-muted);
  }
  .scanning-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 20px 16px;
  }
  .spinner-ring {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 3px solid var(--vr-muted-bg);
    /* The moving arc has to be visible against its own track for the spinner
       to read as spinning: the brand fill is 2.2:1 there on the light theme. */
    border-top-color: var(--vr-primary-text);
    animation: vr-spin 800ms linear infinite;
  }
  @keyframes vr-spin {
    to { transform: rotate(360deg); }
  }
  .scanning-row .title {
    margin-top: 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vr-text);
  }
  .prompt-row { padding: 14px 16px 0; }
  .prompt-row .title {
    margin-top: 3px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vr-text);
  }
  .prompt-row .sub {
    margin-top: 3px;
    font-size: 12px;
    color: var(--vr-text-muted);
  }
  .btn-primary {
    appearance: none;
    display: block;
    width: calc(100% - 32px);
    margin: 14px 16px 0;
    background: var(--vr-primary);
    color: var(--vr-primary-fg);
    border: none;
    border-radius: var(--vr-radius);
    padding: 9px 12px;
    font: inherit;
    font-weight: 700;
    font-size: 12.5px;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    transition: filter 0.12s ease;
  }
  /* Brightness, not opacity: fading a filled button fades its label with it,
     and this one's label/fill pair is measured. Same hover as the popup's. */
  .btn-primary:hover { filter: brightness(1.08); }
  .signed-in-link {
    display: block;
    margin: 8px 16px 0;
    font-size: 11.5px;
    color: var(--vr-text-muted);
    text-align: center;
    text-decoration: none;
  }
  /* --vr-primary-text, not --vr-primary: hovering a muted link must not make
     it harder to read, and the brand fill measures 2.26:1 as text on the light
     card against this token's 5.15:1. */
  .signed-in-link:hover { color: var(--vr-primary-text); text-decoration: underline; }
  /* lit-html inlines a nested TemplateResult's top-level nodes as direct
     children of .card (no wrapper element), so this targets exactly the
     case where a card's body ends right at the primary action button with
     nothing after it (showScanResultCard, showScanErrorCard) -- every
     other card ends with .mute-row instead, which already supplies its
     own bottom padding below. Without this, those two cards' buttons sit
     almost flush against the card's rounded bottom corners instead of
     matching the breathing room every other card state gets. */
  .card > .btn-primary:last-child {
    margin-bottom: 16px;
  }
  /* Three related quick actions, so they sit together as one row. Spread edge
     to edge across 328px by space-between they read as three unrelated links
     that happen to share a line. */
  .mute-row {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin: 12px 16px 0;
    padding: 10px 0 14px;
    border-top: 1px solid var(--vr-border);
  }
  .text-btn {
    appearance: none;
    background: none;
    border: none;
    color: var(--vr-text-muted);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
    padding: 0;
    transition: color 0.12s ease;
  }
  .text-btn:hover { color: var(--vr-text); text-decoration: underline; }
`;
