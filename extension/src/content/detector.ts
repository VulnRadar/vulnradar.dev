// Content script: runs on every page (<all_urls>). Reports the
// current page URL to the background service worker on load.
// The background uses sender.tab.url (not msg.url) as the authoritative
// URL — but we still send url+title for completeness.
//
// Receives scan lifecycle messages back from the background to show/hide
// the page indicator badge.

import browser from "webextension-polyfill";

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
  | { readonly kind: "scan:error"; readonly error: string };

const INDICATOR_ID = "vulnradar-page-indicator";

const EXCLUDED_HOSTS = [
  "sandbox.vulnradar.dev",
  "vulnradar.dev",
  "www.vulnradar.dev",
];

function reportPage(): void {
  if (!/^https?:/.test(location.protocol)) return;
  // Never report the VulnRadar app itself — scanning it is pointless and
  // would cause the extension to fire whenever the user opens their dashboard.
  if (EXCLUDED_HOSTS.includes(location.hostname)) return;
  if (
    location.href.startsWith("https://chrome.google.com/webstore") ||
    location.href.startsWith("https://addons.mozilla.org")
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

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as FromBackground;
  switch (m.kind) {
    case "scan:started":
      showIndicator("Scanning…");
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
  }
  return undefined;
});

reportPage();
