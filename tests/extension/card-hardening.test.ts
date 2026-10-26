import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { onlyTrusted } from "../../extension/src/lib/trusted-event";

/**
 * The site-alert card is drawn into a page the extension does not control, and
 * every button on it ends in a message to the background: scan, snooze, mute,
 * turn alerts off. Three rules keep a page from pressing them on the user's
 * behalf. The first is behaviour and is tested as such; the other two are
 * properties of reputation-card.ts and detector.ts that lit-html and the DOM
 * make impractical to render here, so they are asserted on the source.
 */

const EXT = resolve(__dirname, "../../extension/src/content");
const card = readFileSync(resolve(EXT, "reputation-card.ts"), "utf8");
const detector = readFileSync(resolve(EXT, "detector.ts"), "utf8");

describe("onlyTrusted", () => {
  it("runs the handler for a real, browser-made event", () => {
    const handler = vi.fn();
    onlyTrusted(handler)({ isTrusted: true } as Event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores an event a page script made up", () => {
    const handler = vi.fn();
    // element.click() and dispatchEvent(new MouseEvent("click")) both produce
    // isTrusted = false, and the page cannot set it.
    onlyTrusted(handler)({ isTrusted: false } as Event);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("the card's click handlers", () => {
  const bindings = [...card.matchAll(/@click=\$\{([^}]*)\}/g)].map((m) =>
    m[1]!.trim(),
  );

  // These three only close the card or follow a link; none sends a message.
  const NON_MESSAGING = new Set([
    "onDismiss",
    "reportLink.onDismiss",
    "actions.onDismiss",
  ]);

  it("finds the handlers it means to check", () => {
    expect(bindings.length).toBeGreaterThanOrEqual(8);
  });

  it("wraps every handler that sends a message in onlyTrusted", () => {
    const unguarded = bindings.filter(
      (b) => !b.startsWith("onlyTrusted(") && !NON_MESSAGING.has(b),
    );
    expect(unguarded).toEqual([]);
  });

  it("guards each of the five buttons that message the background", () => {
    for (const handler of [
      "actions.onSnooze",
      "actions.onMuteSite",
      "actions.onMuteGlobal",
      "actions.onScanNow(url)",
      "onRetry",
    ]) {
      expect(
        bindings.some(
          (b) => b.startsWith("onlyTrusted(") && b.includes(handler),
        ),
        handler,
      ).toBe(true);
    }
  });
});

describe("the card's shadow root", () => {
  it("is closed, so the page cannot reach in through host.shadowRoot", () => {
    expect(card).toMatch(/attachShadow\(\{\s*mode:\s*"closed"\s*\}\)/);
    expect(card).not.toMatch(/mode:\s*"open"/);
  });
});

describe("the content script's click messages", () => {
  it("sends no address with a scan request", () => {
    expect(detector).toMatch(
      /sendMessage\(\{\s*kind:\s*"reputation:scan"\s*\}\)/,
    );
    expect(detector).not.toMatch(/kind:\s*"reputation:scan",\s*url/);
  });

  it("does not send the page's URL or title with page:loaded", () => {
    expect(detector).toMatch(/sendMessage\(\{\s*kind:\s*"page:loaded"\s*\}\)/);
    expect(detector).not.toMatch(/url:\s*location\.href/);
    expect(detector).not.toMatch(/document\.title/);
  });

  it("refuses a second card scan while one is running", () => {
    const start = detector.indexOf("function startCardScan");
    expect(start).toBeGreaterThan(-1);
    const body = detector.slice(start, start + 400);
    expect(body).toMatch(/if \(cardScanUrl !== null\) return;/);
  });
});
