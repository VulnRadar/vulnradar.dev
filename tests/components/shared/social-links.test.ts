import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { SOCIAL_PLATFORM_IDS } from "@/lib/config/client-constants";

/**
 * Source-text assertions, on purpose, and for the same reason
 * tests/lib/config/client-server-split.test.ts uses them: this Vitest config
 * runs a plain node environment with no jsdom, so a `.tsx` cannot be imported
 * (its JSX is left as JSX by the tsconfig's `jsx: "preserve"`), let alone
 * rendered. What these pin down is the wiring, which is exactly where this
 * feature can silently break: a hardcoded profile URL at a render site would
 * survive a self-hoster blanking the config, and an icon-only anchor with no
 * accessible name announces as its own URL.
 *
 * The behaviour of the registry itself (which platforms render, what reaches
 * sameAs) is tested against real values in
 * tests/lib/config/client-constants.test.ts.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const COMPONENT = read("components/shared/social-links.tsx");
const FOOTER = read("components/scanner/footer.tsx");
const LANDING = read("components/landing/landing-open-source.tsx");
const STRUCTURED_DATA = read("components/seo/structured-data.tsx");

/** Domains a platform link must never be typed straight into a render site.
 *  Every one of them belongs to a configurable platform, so a literal here
 *  is a link a deployment cannot turn off. */
const PLATFORM_DOMAINS = [
  "youtube.com",
  "tiktok.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "discord.gg",
  "discord.com",
  "bsky.app",
  "linkedin.com",
  "reddit.com",
];

describe("SocialLinks component", () => {
  it("maps every declared platform id to a mark", () => {
    for (const id of SOCIAL_PLATFORM_IDS) {
      expect(COMPONENT, id).toMatch(new RegExp(`^\\s+${id}: Fa\\w+,$`, "m"));
    }
  });

  it("names no platform the registry does not declare", () => {
    const mapped = [...COMPONENT.matchAll(/^\s+(\w+): Fa\w+,$/gm)].map(
      (match) => match[1],
    );

    expect(mapped.sort()).toEqual([...SOCIAL_PLATFORM_IDS].sort());
  });

  it("opens every link in a new tab without leaking the referrer", () => {
    expect(COMPONENT).toContain('target="_blank"');
    expect(COMPONENT).toContain('rel="noopener noreferrer"');
  });

  it("gives each icon-only link an accessible name and hides the mark from it", () => {
    expect(COMPONENT).toContain("aria-label={label}");
    expect(COMPONENT).toContain('aria-hidden="true"');
  });

  it("embeds nothing from the platforms themselves", () => {
    // Plain anchors only. A platform embed, follow button, or pixel would be
    // a third-party script on every page of the site and would need the CSP
    // in middleware.ts widened to load at all.
    expect(COMPONENT).not.toMatch(/<(script|iframe|img)\b/);
  });

  it("reads its URLs from the registry rather than hardcoding any", () => {
    expect(COMPONENT).toContain("SOCIAL_LINKS");
    for (const domain of PLATFORM_DOMAINS) {
      expect(COMPONENT, domain).not.toContain(domain);
    }
  });
});

describe("social links at the render sites", () => {
  it("renders the footer row through the registry, with no hardcoded profile", () => {
    expect(FOOTER).toContain("<SocialLinks");
    for (const domain of PLATFORM_DOMAINS) {
      expect(FOOTER, domain).not.toContain(domain);
    }
  });

  it("renders the landing row through the registry, with no hardcoded profile", () => {
    expect(LANDING).toContain("<SocialLinks");
    for (const domain of PLATFORM_DOMAINS) {
      expect(LANDING, domain).not.toContain(domain);
    }
  });

  it("hides the landing group entirely when nothing is configured", () => {
    // The footer needs no such guard: its row holds the repo mark and the
    // support address whatever the social config says, so an empty registry
    // simply contributes no anchors.
    expect(LANDING).toContain("SOCIAL_LINKS.length > 0 &&");
  });

  it("gives every icon link a 44px touch target below sm", () => {
    for (const [name, source] of [
      ["footer", FOOTER],
      ["landing", LANDING],
    ] as const) {
      expect(source, name).toMatch(/h-11 w-11 sm:h-9 sm:w-9/);
    }
  });
});

describe("Organization sameAs", () => {
  /** The `const sameAs = ...` initialiser. It contains no semicolon of its
   *  own, so the first one ends it however prettier lays the lines out. */
  function sameAsInitialiser(): string {
    const match = STRUCTURED_DATA.match(/const sameAs =([\s\S]*?);/);
    expect(match, "structured-data.tsx no longer declares sameAs").toBeTruthy();
    return match![1];
  }

  it("is built from the repo, the social registry, and the store listings", () => {
    const sources = [...sameAsInitialiser().matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)]
      .map((match) => match[0])
      .filter((name) => name !== "URL");

    expect(sources).toEqual([
      "SEO_GITHUB_URL",
      "SOCIAL_PROFILE_URLS",
      "CHROME_WEB_STORE_URL",
      "FIREFOX_ADDON_URL",
    ]);
  });

  it("no longer names the Discord invite separately", () => {
    // Discord is a registry platform now, so listing it here as well would
    // publish the same URL twice in one sameAs array.
    expect(STRUCTURED_DATA).not.toContain("DISCORD_INVITE_URL");
  });

  it("hardcodes no profile URL of its own", () => {
    for (const domain of PLATFORM_DOMAINS) {
      expect(STRUCTURED_DATA, domain).not.toContain(domain);
    }
  });
});
