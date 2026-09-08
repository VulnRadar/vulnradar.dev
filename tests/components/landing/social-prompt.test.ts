import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-text assertions, for the same reason
 * tests/components/shared/social-links.test.ts uses them: this Vitest config
 * runs a plain node environment with no jsdom, so a `.tsx` cannot be rendered.
 *
 * What is worth pinning here is the set of ways a floating, self-revealing
 * card goes wrong without anyone noticing on the machine it was built on: it
 * covers a control it should sit above, it renders an empty box on a
 * deployment with no accounts configured, it throws in a browser with storage
 * blocked, or its close button announces as nothing.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const COMPONENT = read("components/landing/landing-social-prompt.tsx");
const LANDING_PAGE = read("app/landing/page.tsx");
const COOKIE_NOTICE = read("components/shared/cookie-notice.tsx");

describe("landing social prompt", () => {
  it("is actually rendered on the landing page", () => {
    expect(LANDING_PAGE).toContain("LandingSocialPrompt");
    expect(LANDING_PAGE).toContain(
      'from "@/components/landing/landing-social-prompt"',
    );
  });

  it("renders nothing when a deployment has configured no social accounts", () => {
    // Self-hosters blank the social config. Without this the card still
    // appears, with an empty row where the icons would be.
    expect(COMPONENT).toMatch(/SOCIAL_LINKS\.length === 0/);
  });

  it("takes every URL from the registry rather than typing one in", () => {
    for (const domain of [
      "youtube.com",
      "tiktok.com",
      "instagram.com",
      "x.com",
      "discord.gg",
      "bsky.app",
      "linkedin.com",
      "reddit.com",
    ]) {
      expect(
        COMPONENT.includes(domain),
        `${domain} is typed into the component; it belongs in SOCIAL_LINKS so a deployment can turn it off`,
      ).toBe(false);
    }
    expect(COMPONENT).toContain("<SocialLinks");
  });

  it("survives a browser with storage blocked", () => {
    // localStorage throws outright in some privacy modes, not just on read.
    // Both accesses have to be guarded or the landing page crashes for those
    // visitors, which is a far worse outcome than the card showing twice.
    const guarded = COMPONENT.match(/try\s*\{[\s\S]*?\}\s*catch\s*\{/g) ?? [];
    expect(guarded.length).toBeGreaterThanOrEqual(2);
    expect(COMPONENT).toContain("localStorage.getItem");
    expect(COMPONENT).toContain("localStorage.setItem");
  });

  it("sits above the cookie notice instead of guessing an offset", () => {
    // The notice publishes its measured height for exactly this reason, and
    // it is roughly 125px tall on a phone. A hardcoded bottom would put this
    // card underneath it.
    expect(COOKIE_NOTICE).toContain("--vr-cookie-h");
    expect(COMPONENT).toContain("var(--vr-cookie-h");
    // And loses to it on paint order if they ever do overlap.
    expect(COOKIE_NOTICE).toMatch(/z-60/);
    expect(COMPONENT).toMatch(/z-40/);
  });

  it("can be closed by keyboard as well as by pointer", () => {
    expect(COMPONENT).toContain('event.key === "Escape"');
    expect(COMPONENT).toMatch(/aria-label="Dismiss[^"]*"/);
  });

  it("names itself for a screen reader without hardcoding the product name", () => {
    expect(COMPONENT).toContain("aria-label={`Follow ${APP_NAME}`}");
  });

  it("does not animate for someone who asked it not to", () => {
    expect(COMPONENT).toContain("motion-reduce:transition-none");
  });

  it("waits until the visitor has read some of the page", () => {
    // Revealing on load turns the first thing a visitor sees into a request.
    expect(COMPONENT).toMatch(/REVEAL_AT\s*=\s*0\.\d+/);
    // And a page too short to scroll must not divide by zero and appear at once.
    expect(COMPONENT).toContain("scrollable <= 0");
  });

  it("keeps the copy free of em dashes", () => {
    // CLAUDE.md: no em dashes in user-facing text.
    const strings = COMPONENT.split("\n").filter(
      (line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"),
    );
    expect(strings.join("\n")).not.toContain("—");
  });
});
