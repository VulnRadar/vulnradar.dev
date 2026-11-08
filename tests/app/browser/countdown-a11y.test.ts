import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  countdownAnnouncement,
  countdownStage,
} from "@/lib/browserbase/countdown-announcement";
import { secondsRemaining } from "@/lib/browserbase/viewer-session";

/**
 * The viewer's clock used to be aria-live="polite" and changed every second, so
 * a screen reader read out every tick and still gave no warning at 30 or 10
 * seconds. The ticking digits are now a role="timer"; a separate status element
 * carries the announcements and its text is a function of a coarse stage.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the countdown's announcements", () => {
  it("changes across a full minute only at the 30 and 10 second marks and on expiry", () => {
    const start = 1_000_000;
    const expiresAt = start + 60_000;
    const changes: Array<{ at: number; text: string }> = [];
    let previous: string | null = null;
    for (let tick = 0; tick <= 60; tick++) {
      const remaining = secondsRemaining(expiresAt, start + tick * 1000);
      const text = countdownAnnouncement(remaining, 1);
      if (text !== previous) changes.push({ at: remaining, text });
      previous = text;
    }
    expect(changes).toEqual([
      { at: 60, text: "Session lasts 1 minute" },
      { at: 30, text: "30 seconds left in this session" },
      { at: 10, text: "10 seconds left in this session" },
      { at: 0, text: "Session ended" },
    ]);
  });

  it("says nothing new between the start and the 30 second mark", () => {
    const texts = new Set<string>();
    for (let remaining = 60; remaining > 30; remaining--) {
      texts.add(countdownAnnouncement(remaining, 1));
    }
    expect([...texts]).toEqual(["Session lasts 1 minute"]);
  });

  it("announces an extension, even while the clock is far from a threshold", () => {
    expect(countdownAnnouncement(100, 1)).toBe("Session lasts 1 minute");
    expect(countdownAnnouncement(100, 2)).toBe("Session extended to 2 minutes");
    // Extended from inside the warning window: back to the running stage.
    expect(countdownStage(20)).toBe("warning");
    expect(countdownAnnouncement(80, 2)).toBe("Session extended to 2 minutes");
  });

  it("puts the stage boundaries exactly on 30 and 10", () => {
    expect(countdownStage(31)).toBe("running");
    expect(countdownStage(30)).toBe("warning");
    expect(countdownStage(11)).toBe("warning");
    expect(countdownStage(10)).toBe("final");
    expect(countdownStage(1)).toBe("final");
    expect(countdownStage(0)).toBe("ended");
  });
});

describe("SessionCountdown's markup", () => {
  const src = code("components/browser/session-countdown.tsx");

  it("has no aria-live anywhere", () => {
    expect(src).not.toContain("aria-live");
  });

  it("marks the ticking digits as a timer", () => {
    expect(src).toMatch(/role="timer"[\s\S]*?formatMmSs\(remaining\)/);
  });

  it("renders no status element whose value is derived from the remaining seconds", () => {
    const status = src.match(/<span role="status"[^>]*>([\s\S]*?)<\/span>/);
    expect(status).not.toBeNull();
    const body = status![1];
    expect(body).toContain("{announced}");
    expect(body).not.toContain("remaining");
    expect(body).not.toContain("formatMmSs");
    expect(body).not.toContain("now");
    expect(src.match(/role="status"/g)).toHaveLength(1);
  });

  it("fills the status after mount, not on first render, so the first message is heard", () => {
    expect(src).toContain('useState("")');
    expect(src).toMatch(/setTimeout\(\(\) => setAnnounced\(message\), 0\)/);
    expect(src).toContain("[message]");
  });

  it("keeps the status visually hidden", () => {
    expect(src).toMatch(/role="status" className="sr-only"/);
  });
});
