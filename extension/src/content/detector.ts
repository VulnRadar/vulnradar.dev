// Content script: runs on every page (<all_urls>). Reports the
// current page URL to the background service worker on load.
// The background uses sender.tab.url (not msg.url) as the authoritative
// URL — but we still send url+title for completeness.
//
// Receives scan lifecycle messages back from the background to show/hide
// the page indicator badge, and reputation:* messages to show the
// on-page site-alert card (see reputation-card.ts). The background owns
// the API key and every policy/mute/throttle decision - this file only
// renders what it's told and reports user actions (scan now, mute) back
// up as fire-and-forget messages.

import browser from "webextension-polyfill";
import {
  hideCard,
  showKnownCard,
  showScanErrorCard,
  showScanningCard,
  showScanResultCard,
  showUnknownCard,
} from "./reputation-card";
import type { CardActions } from "./reputation-card";
import { VULNRADAR } from "../lib/constants";
import type { ReputationResponse, ScanSummary } from "../lib/types";

interface PageLoadedMsg {
  readonly kind: "page:loaded";
  readonly url: string;
  readonly title: string;
}

type FromBackground =
  | { readonly kind: "scan:started" }
  | {
      readonly kind: "scan:complete";
      readonly result: {
        readonly url: string;
        readonly dangerScore?: number;
        readonly summary: ScanSummary;
        readonly findings: readonly unknown[];
      };
    }
  | { readonly kind: "scan:skipped"; readonly reason: string }
  | { readonly kind: "scan:error"; readonly error: string }
  | {
      readonly kind: "reputation:known";
      readonly data: ReputationResponse;
      readonly host: string;
    }
  | {
      readonly kind: "reputation:unknown";
      readonly data: ReputationResponse;
      readonly url: string;
      readonly host: string;
    }
  // Sent by the popup (browser.tabs.sendMessage), not the background - the
  // popup's own toolbar-icon click never fires browser.action.onClicked
  // since default_popup is set, so "show the card again" has to be a
  // button inside the popup UI that messages this listener directly.
  | { readonly kind: "reputation:show-again" };

const INDICATOR_ID = "vulnradar-page-indicator";

// Only the live app instance itself (the host the extension talks to for
// its own API calls, e.g. sandbox.vulnradar.dev) is excluded here - never
// report page loads on the actual running dashboard, since that would fire
// the extension every time the user opens it. This is deliberately NOT the
// wider "vulnradar.dev" / "www.vulnradar.dev" marketing domain: that's an
// ordinary website like any other and can have its own genuine,
// already-scanned host-reputation record worth showing (the auto-scan
// pipeline still excludes it separately - see EXCLUDED_HOSTS in
// service-worker.ts - so this only affects the read-only reputation popup).
const OWN_APP_HOST = new URL(VULNRADAR.apiHost).hostname;

function reportPage(): void {
  if (!/^https?:/.test(location.protocol)) return;
  if (location.hostname === OWN_APP_HOST) return;
  if (
    location.href.startsWith("https://chrome.google.com/webstore") ||
    location.hostname === "addons.mozilla.org"
  ) {
    return;
  }
  const msg: PageLoadedMsg = {
    kind: "page:loaded",
    url: location.href,
    title: document.title || location.hostname,
  };
  browser.runtime.sendMessage(msg as unknown as string).catch(() => {
    // background SW may be inactive during page transitions; safe to ignore.
  });
}

function ensureIndicator(): HTMLElement | null {
  const existing = document.getElementById(INDICATOR_ID);
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = INDICATOR_ID;
  el.setAttribute("data-vulnradar", "true");
  el.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 2147483647;
    padding: 4px 10px;
    font: 600 11px/1 system-ui, -apple-system, sans-serif;
    color: #fff;
    background: #0babcc;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    pointer-events: none;
    display: none;
    letter-spacing: 0.02em;
  `;
  // <html> rather than <body>: a page that applies a transform/filter/
  // will-change to <body> (common for dark-mode-inversion tricks) would
  // otherwise become the containing block for this element's
  // position:fixed, making it track that element's box instead of the
  // viewport. <html> itself is transformed far less often in practice.
  (document.documentElement ?? document.body).appendChild(el);
  return el;
}

function showIndicator(text: string): void {
  const el = ensureIndicator();
  if (!el) return;
  el.textContent = text;
  el.style.display = "block";
}

function hideIndicator(): void {
  const el = document.getElementById(INDICATOR_ID);
  if (el) el.style.display = "none";
}

// Set while a scan the CARD itself triggered ("Scan this site" / "Try
// again") is in flight, so the scan:started/complete/error messages below
// know to update the big card in place instead of the small page-corner
// indicator, which is what auto-scan and other triggers still use since
// there's no card open for them to update.
let cardScanUrl: string | null = null;

function dismissCardScan(): void {
  cardScanUrl = null;
  hideCard();
}

function startCardScan(url: string): void {
  cardScanUrl = url;
  showScanningCard(url, dismissCardScan);
  browser.runtime.sendMessage({ kind: "reputation:scan", url }).catch(() => {
    // The background may be momentarily unreachable (service worker
    // waking up) -- scan:error normally reports a real failure, but a
    // dropped message never arrives at all, so surface the same error
    // card here rather than leaving the spinner up forever.
    if (cardScanUrl !== url) return;
    showScanErrorCard(
      "Could not reach the extension's background service. Try again.",
      () => startCardScan(url),
      dismissCardScan,
    );
  });
}

function cardActions(): CardActions {
  return {
    onScanNow: (url) => startCardScan(url),
    onMuteSite: () => {
      hideCard();
      // location.origin, not just the hostname: an exact-origin pattern
      // (e.g. "https://example.com") is what lib/url-patterns.ts's
      // matchesUrlPattern expects from mutedPatterns - this is the same
      // list the Settings > Site Alerts page's own add/remove UI writes
      // to, so a quick "Not this site" click and a manually-typed pattern
      // both land in one place.
      browser.runtime
        .sendMessage({ kind: "reputation:mute-site", pattern: location.origin })
        .catch(() => {});
    },
    onMuteGlobal: () => {
      hideCard();
      browser.runtime
        .sendMessage({ kind: "reputation:mute-global" })
        .catch(() => {});
    },
    onDismiss: hideCard,
  };
}

// The most recent reputation:known/reputation:unknown message this content
// script received, so the toolbar popup's "Show site alert" button
// (reputation:show-again) can re-render the same card without waiting on
// a fresh network round trip through the background. Null until the
// first one arrives for this page load.
let lastReputationMsg:
  | {
      readonly kind: "known";
      readonly data: ReputationResponse;
      readonly host: string;
    }
  | {
      readonly kind: "unknown";
      readonly data: ReputationResponse;
      readonly url: string;
      readonly host: string;
    }
  | null = null;

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as FromBackground;
  switch (m.kind) {
    case "scan:started":
      // A card-triggered scan already shows its own "Scanning…" state
      // (startCardScan), and must not be replaced by the corner indicator
      // or dismissed by the "don't leave a stale card up" rule below --
      // that rule only applies when this scan_started came from somewhere
      // OTHER than the card itself (auto-scan, extension icon, etc.).
      if (cardScanUrl === null) {
        showIndicator("Scanning…");
        hideCard();
      }
      break;
    case "scan:complete":
      if (cardScanUrl !== null) {
        cardScanUrl = null;
        showScanResultCard(m.result, dismissCardScan);
      } else {
        hideIndicator();
      }
      break;
    case "scan:skipped":
      hideIndicator();
      break;
    case "scan:error":
      if (cardScanUrl !== null) {
        const failedUrl = cardScanUrl;
        cardScanUrl = null;
        showScanErrorCard(
          m.error,
          () => startCardScan(failedUrl),
          dismissCardScan,
        );
      } else {
        showIndicator("⚠ Scan error");
        setTimeout(hideIndicator, 4000);
      }
      break;
    case "reputation:known":
      lastReputationMsg = { kind: "known", data: m.data, host: m.host };
      showKnownCard(m.data, cardActions());
      break;
    case "reputation:unknown":
      lastReputationMsg = {
        kind: "unknown",
        data: m.data,
        url: m.url,
        host: m.host,
      };
      showUnknownCard(m.url, cardActions());
      break;
    case "reputation:show-again":
      if (lastReputationMsg?.kind === "known") {
        showKnownCard(lastReputationMsg.data, cardActions());
      } else if (lastReputationMsg?.kind === "unknown") {
        showUnknownCard(lastReputationMsg.url, cardActions());
      } else {
        // Nothing cached yet (content script freshly injected, background
        // hasn't responded yet) -- re-run the same page-load check
        // reportPage() triggers, so the background walks its normal
        // policy/throttle/cache logic and pushes a reputation:known/
        // unknown message back here once it has an answer.
        reportPage();
      }
      break;
  }
  return undefined;
});

reportPage();
