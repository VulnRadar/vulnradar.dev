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
import { hideCard, showKnownCard, showUnknownCard } from "./reputation-card";
import type { CardActions } from "./reputation-card";
import { VULNRADAR } from "../lib/constants";
import type { ReputationResponse } from "../lib/types";

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
    };

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
  (document.body ?? document.documentElement).appendChild(el);
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

function cardActions(host: string): CardActions {
  return {
    onScanNow: (url) => {
      hideCard();
      browser.runtime
        .sendMessage({ kind: "reputation:scan", url })
        .catch(() => {});
    },
    onMuteSite: () => {
      hideCard();
      browser.runtime
        .sendMessage({ kind: "reputation:mute-site", host })
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

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as FromBackground;
  switch (m.kind) {
    case "scan:started":
      showIndicator("Scanning…");
      // A scan (auto or triggered from the site-alert card) is now the
      // more relevant signal; don't leave a stale reputation card up.
      hideCard();
      break;
    case "scan:complete":
      hideIndicator();
      break;
    case "scan:skipped":
      hideIndicator();
      break;
    case "scan:error":
      showIndicator("⚠ Scan error");
      setTimeout(hideIndicator, 4000);
      break;
    case "reputation:known":
      showKnownCard(m.data, cardActions(m.host));
      break;
    case "reputation:unknown":
      showUnknownCard(m.url, cardActions(m.host));
      break;
  }
  return undefined;
});

reportPage();
