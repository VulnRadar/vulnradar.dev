import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

import { detectors } from "@/lib/scanner/checks/content";

const LOGIN_URL = "https://example.com/login";

function trackers(body: string): string | null {
  return detectors["third-party-tracker-on-login-page"](
    LOGIN_URL,
    new Headers(),
    body,
  );
}

/**
 * "third-party-tracker-on-login-page" names the ad-tech vendors a login page
 * loads code from. It searched the page for each vendor's hostname as text,
 * so a host that only contains the name, or the name sitting in some other
 * URL's query string, was reported as that vendor's pixel.
 */
const PIXELS: { name: string; host: string; path: string }[] = [
  {
    name: "Meta Pixel",
    host: "connect.facebook.net",
    path: "/en_US/fbevents.js",
  },
  {
    name: "TikTok Pixel",
    host: "analytics.tiktok.com",
    path: "/i18n/pixel/events.js",
  },
  { name: "Snap Pixel", host: "sc-static.net", path: "/scevent.min.js" },
  {
    name: "LinkedIn Insight Tag",
    host: "snap.licdn.com",
    path: "/li.lms-analytics/insight.min.js",
  },
];

describe("third-party-tracker-on-login-page reads the pixel's host", () => {
  for (const p of PIXELS) {
    it(`${p.name}: a script tag loading it fires`, () => {
      const evidence = trackers(
        `<form><input type="password"></form><script src="https://${p.host}${p.path}"></script>`,
      );
      expect(evidence).toContain(p.name);
    });

    it(`${p.name}: the URL in the vendor's inline loader fires`, () => {
      const evidence = trackers(
        `<input type="password"><script>t.src='https://${p.host}${p.path}';</script>`,
      );
      expect(evidence).toContain(p.name);
    });

    it(`${p.name}: a host that only ends in the vendor's name does not fire`, () => {
      expect(
        trackers(
          `<input type="password"><script src="https://evil${p.host}${p.path}"></script>`,
        ),
      ).toBeNull();
    });

    it(`${p.name}: the name in another URL's query string does not fire`, () => {
      expect(
        trackers(
          `<input type="password"><script src="https://evil.example/?${p.host}${p.path}"></script>`,
        ),
      ).toBeNull();
      expect(
        trackers(
          `<input type="password"><img src="https://evil.example/r?u=https://${p.host}${p.path}">`,
        ),
      ).toBeNull();
    });
  }

  it("still lists every pixel the page loads", () => {
    const body =
      `<input type="password">` +
      PIXELS.map(
        (p) => `<script src="https://${p.host}${p.path}"></script>`,
      ).join("");
    expect(trackers(body)).toContain(
      "Meta Pixel, TikTok Pixel, Snap Pixel, LinkedIn Insight Tag",
    );
  });

  it("does not run off a login page", () => {
    expect(
      detectors["third-party-tracker-on-login-page"](
        "https://example.com/about",
        new Headers(),
        `<script src="https://connect.facebook.net/en_US/fbevents.js"></script>`,
      ),
    ).toBeNull();
  });
});

describe("slack-webhook-exposed compares the webhook URL's host", () => {
  // Assembled at runtime: push protection rejects a webhook-shaped literal.
  const path = ["", "services", "T0ABCDEFG", "B0HIJKLMN", "aBcDeFgHiJkL"].join(
    "/",
  );
  const slack = (body: string) =>
    detectors["slack-webhook-exposed"](
      "https://example.com",
      new Headers(),
      body,
    );

  it("fires on a Slack incoming webhook URL", () => {
    expect(
      slack(`<script>post("https://hooks.slack.com${path}")</script>`),
    ).toContain("Slack incoming webhook");
  });

  it("fires on one carried in another URL's query string: it is still leaked", () => {
    expect(
      slack(
        `<a href="https://evil.example/?u=https://hooks.slack.com${path}">`,
      ),
    ).not.toBeNull();
  });

  it("matches the scheme and host in any case, as before", () => {
    expect(slack(`HTTPS://HOOKS.SLACK.COM${path}`)).not.toBeNull();
  });

  it("does not fire on a host that only contains hooks.slack.com", () => {
    for (const host of [
      "xhooks.slack.com",
      "hooks.slack.com.evil.example",
      "hooks-slack.com",
    ]) {
      expect(slack(`https://${host}${path}`)).toBeNull();
    }
  });
});

describe("content.ts host checks are not regexes over the body", () => {
  // CodeQL's js/regex/missing-regexp-anchor raised #250 to #253 on these
  // literals; this keeps them from being pasted back.
  const source = readFileSync(
    join(process.cwd(), "lib/scanner/checks/content.ts"),
    "utf8",
  );
  for (const literal of [
    String.raw`/https:\/\/hooks\.slack\.com\/services\/`,
    String.raw`/analytics\.tiktok\.com\/i18n\/pixel/i`,
    String.raw`/sc-static\.net\/scevent\.min\.js/i`,
    String.raw`/snap\.licdn\.com\/li\.lms-analytics/i`,
  ]) {
    it(`does not contain ${literal}`, () => {
      expect(source).not.toContain(literal);
    });
  }
});
