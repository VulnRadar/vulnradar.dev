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
import { colorForScore } from "../lib/badge";
import { VULNRADAR } from "../lib/constants";
import { formatRelative } from "../lib/format";
import type {
  CardPosition,
  ReputationResponse,
  ReputationSeverityCounts,
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

function ensureRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-vulnradar", "true");
  overlayParent().appendChild(host);
  shadowRoot = host.attachShadow({ mode: "open" });
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
 * Loose local read of the server's tiered safety rating (lib/scanner/
 * safety-rating.ts), derived from just the summary fields the reputation
 * endpoint returns -- not a reimplementation of that check-by-check logic,
 * just enough to color the rail and pick a one-line label consistently
 * with the score thresholds colorForScore already uses.
 */
type Verdict = "safe" | "caution" | "unsafe";

function verdictFor(
  score: number,
  counts: ReputationSeverityCounts | null,
): { tier: Verdict; label: string } {
  const critical = counts?.critical ?? 0;
  const high = counts?.high ?? 0;
  if (score >= 8 || critical > 0) {
    return { tier: "unsafe", label: "Actively exploitable issues found" };
  }
  if (score >= 5 || high > 0) {
    return { tier: "caution", label: "Review before trusting this host" };
  }
  return { tier: "safe", label: "No exploitable issues found" };
}

const VERDICT_RAIL: Record<Verdict, string> = {
  safe: "#22c55e",
  caution: "#eab308",
  unsafe: "#ef4444",
};

function MuteRow(actions: CardActions): TemplateResult {
  return html`
    <div class="mute-row">
      <button class="text-btn" @click=${actions.onSnooze}>Snooze 24h</button>
      <button class="text-btn" @click=${actions.onMuteSite}>
        Not this site
      </button>
      <button class="text-btn" @click=${actions.onMuteGlobal}>Turn off</button>
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
    <div
      class="card"
      data-position=${cardPosition}
      @mouseenter=${cancelAutoDismiss}
      @mouseleave=${resumeAutoDismiss}
    >
      <span class="rail" style="background:${rail}"></span>
      <button class="dismiss-btn" title="Dismiss" @click=${onDismiss}>
        &times;
      </button>
      ${body}
    </div>
  `;
}

function SeverityChips(
  counts: ReputationSeverityCounts | null,
): TemplateResult {
  const order = ["critical", "high", "medium", "low"] as const;
  const colors: Record<(typeof order)[number], string> = {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#eab308",
    low: "#3b82f6",
  };
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
          <span class="chip">
            <span class="dot" style="background:${colors[s]}"></span>
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
  counts: ReputationSeverityCounts | null,
  whenLabel: string,
  reportLink: { host: string; onDismiss: () => void } | null,
): TemplateResult {
  const scoreColor = colorForScore(score);
  const verdict = verdictFor(score, counts);
  const ringPct = Math.max(0, Math.min(10, score)) * 10;

  return html`
    <div class="score-block">
      <div
        class="score-ring"
        style="--ring-color:${scoreColor};--ring-pct:${ringPct}%"
      >
        <span class="score-num" style="color:${scoreColor}">${score}</span>
      </div>
      <div class="score-meta">
        <div class="eyebrow">Danger score</div>
        <div class="verdict" style="color:${VERDICT_RAIL[verdict.tier]}">
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
  counts: ReputationSeverityCounts | null,
): string {
  return VERDICT_RAIL[verdictFor(score, counts).tier];
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
    ${ScoreBody(score, data.severityCounts, whenLabel, {
      host: data.host,
      onDismiss: actions.onDismiss,
    })}
    ${MuteRow(actions)}
  `;

  render(
    Chrome(railFor(score, data.severityCounts), body, actions.onDismiss),
    root,
  );
  scheduleAutoDismiss(AUTO_DISMISS_MS_KNOWN);
}

export function showUnknownCard(url: string, actions: CardActions): void {
  const root = ensureRoot();
  const body = html`
    <div class="prompt-row">
      <div class="eyebrow">Not scanned yet</div>
      <div class="title">No VulnRadar record for this host</div>
      <div class="sub">
        Run the full check suite now, or skip it and keep browsing.
      </div>
    </div>
    <button class="btn-primary" @click=${() => actions.onScanNow(url)}>
      Scan this site
    </button>
    ${MuteRow(actions)}
  `;
  render(Chrome("#0babcc", body, actions.onDismiss), root);
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
    <div class="scanning-row">
      <span class="spinner-ring"></span>
      <div>
        <div class="eyebrow">Running the full check suite</div>
        <div class="title">Scanning ${hostname}&hellip;</div>
      </div>
    </div>
  `;
  render(Chrome("#0babcc", body, onDismiss), root);
  // No auto-dismiss: a scan can legitimately take minutes, and it should
  // stay put until it actually has something to report.
}

/** A scan just finished (triggered from this card) -- rendered exactly like
 *  an existing result via the shared ScoreBody, per the user's ask. */
export function showScanResultCard(
  result: {
    readonly url: string;
    readonly dangerScore?: number;
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
    ${ScoreBody(score, result.summary, "Just now", { host, onDismiss })}
  `;
  render(Chrome(railFor(score, result.summary), body, onDismiss), root);
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
    <div class="prompt-row">
      <div class="eyebrow">Scan failed</div>
      <div class="title">Could not finish scanning this site</div>
      <div class="sub">${error}</div>
    </div>
    <button class="btn-primary" @click=${onRetry}>Try again</button>
  `;
  render(Chrome("#ef4444", body, onDismiss), root);
  scheduleAutoDismiss(AUTO_DISMISS_MS_UNKNOWN);
}

const CARD_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card {
    --vr-bg: #ffffff;
    --vr-text: #15192a;
    --vr-text-muted: #666e80;
    --vr-border: #e2e5ec;
    --vr-primary: #0babcc;
    --vr-primary-fg: #ffffff;
    --vr-muted-bg: #f4f6f9;
    position: fixed;
    top: 16px;
    right: 16px;
    width: 360px;
    background: var(--vr-bg);
    color: var(--vr-text);
    border: 1px solid var(--vr-border);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08);
    font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
    .card {
      --vr-bg: #14171f;
      --vr-text: #eaeef4;
      --vr-text-muted: #8791a8;
      --vr-border: #262b3a;
      --vr-primary: #0dccf2;
      --vr-primary-fg: #0e111a;
      --vr-muted-bg: #1b1f2b;
    }
    .card {
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
    }
  }
  @keyframes vr-slide-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .rail {
    display: block;
    height: 3px;
    width: 100%;
  }
  .dismiss-btn {
    appearance: none;
    background: none;
    border: none;
    position: absolute;
    top: 9px;
    right: 10px;
    color: var(--vr-text-muted);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 5px;
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
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--vr-muted-bg);
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vr-text);
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
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
    border-top-color: var(--vr-primary);
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
    border-radius: 7px;
    padding: 9px 12px;
    font: inherit;
    font-weight: 700;
    font-size: 12.5px;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  .btn-primary:hover { opacity: 0.9; }
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
  .mute-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
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
  }
  .text-btn:hover { color: var(--vr-text); text-decoration: underline; }
`;
