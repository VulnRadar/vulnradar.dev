// Content script: runs on every page (<all_urls>). Reports the
// current page URL + title to the background service worker so it can
// decide whether to auto-scan. Deliberately tiny - no DOM scraping,
// no network calls. The popup and background do the heavy lifting.
//
// Message sent to background: { kind: "page:loaded", url, title }
//
// Listens for messages back from the background to update the page
// indicator (a small badge if the page is currently auto-scanning).

import browser from "webextension-polyfill";

interface PageLoadedMsg {
  readonly kind: "page:loaded";
  readonly url: string;
  readonly title: string;
}

interface ScanCompleteMsg {
  readonly kind: "scan:complete";
  readonly result: {
    readonly url: string;
    readonly findings: readonly unknown[];
  };
}
interface ScanSkippedMsg {
  readonly kind: "scan:skipped";
  readonly reason: string;
}
interface ScanErrorMsg {
  readonly kind: "scan:error";
  readonly error: string;
}

type FromBackground = ScanCompleteMsg | ScanSkippedMsg | ScanErrorMsg;

const INDICATOR_ID = "vulnradar-page-indicator";

function getTitle(): string {
  return document.title || location.hostname || "this page";
}

function reportPage(): void {
  // Skip chrome://, about:, devtools, extensions URLs entirely so we
  // never even think about scanning them. The manifest matches
  // <all_urls>, but we no-op here.
  if (
    !/^https?:/.test(location.protocol) ||
    location.href.startsWith("https://chrome.google.com/webstore") ||
    location.href.startsWith("https://addons.mozilla.org")
  ) {
    return;
  }
  const msg: PageLoadedMsg = {
    kind: "page:loaded",
    url: location.href,
    title: getTitle(),
  };
  // Cast through unknown to disambiguate from the (id?: string) overload.
  browser.runtime.sendMessage(msg as unknown as string).catch(() => {
    // background SW may be inactive during page transitions; ignore.
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
    padding: 4px 8px;
    font: 600 11px/1 system-ui, -apple-system, sans-serif;
    color: #fff;
    background: #6366f1;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    pointer-events: none;
    display: none;
  `;
  el.textContent = "Scanning\u2026";
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

browser.runtime.onMessage.addListener((msg) => {
  const m = msg as FromBackground;
  switch (m.kind) {
    case "scan:complete":
      hideIndicator();
      break;
    case "scan:skipped":
      hideIndicator();
      break;
    case "scan:error":
      showIndicator("\u26A0 Auth required");
      setTimeout(hideIndicator, 5000);
      break;
  }
  return undefined;
});

reportPage();
