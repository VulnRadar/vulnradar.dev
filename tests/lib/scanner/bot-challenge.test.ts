import { describe, it, expect } from "vitest";
import {
  CHALLENGE_TITLE_MARKERS,
  detectBotChallenge,
} from "@/lib/scanner/bot-challenge";

const page = (title: string, extra = "") =>
  `<html><head><title>${title}</title>${extra}</head><body></body></html>`;

describe("detectBotChallenge", () => {
  it("recognises Cloudflare's own challenge header", () => {
    const headers = new Headers({ "cf-mitigated": "challenge" });
    expect(detectBotChallenge(403, headers, "")).toBe(
      "cf-mitigated: challenge",
    );
  });

  it("recognises a challenge interstitial by its title on a blocking status", () => {
    expect(
      detectBotChallenge(503, new Headers(), page("Just a moment...")),
    ).not.toBeNull();
    expect(
      detectBotChallenge(
        403,
        new Headers(),
        page("Attention Required! | Cloudflare"),
      ),
    ).not.toBeNull();
  });

  it("recognises a challenge by its bootstrap script", () => {
    const body = page("Please wait", "<script>window._cf_chl_opt={}</script>");
    expect(detectBotChallenge(403, new Headers(), body)).not.toBeNull();
  });

  it("does not treat an ordinary page Cloudflare serves as a challenge", () => {
    // Cloudflare injects its challenge-platform script into normal pages.
    const body = page(
      "Home | Example",
      '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
    );
    expect(detectBotChallenge(200, new Headers(), body)).toBeNull();
  });

  it("does not treat a plain 403 as a challenge", () => {
    expect(
      detectBotChallenge(403, new Headers(), page("Forbidden")),
    ).toBeNull();
  });

  it("does not trust a challenge title on a successful page", () => {
    // A blog post titled "Just a moment" is a page, not an interstitial.
    expect(
      detectBotChallenge(200, new Headers(), page("Just a moment")),
    ).toBeNull();
  });

  it("reads a title with a raw < in it", () => {
    // `[^<]` stopped at the "<3", so the whole title read as empty.
    expect(
      detectBotChallenge(503, new Headers(), page("Please wait... <3")),
    ).toBe("HTTP 503 with a challenge page title");
  });

  it("does not trust a please-wait title on a successful page", () => {
    expect(
      detectBotChallenge(200, new Headers(), page("Please wait... <3")),
    ).toBeNull();
  });

  it("keeps the please-wait marker out of the list the login flow reads", () => {
    // auth/browser-login.ts matches this list with no status check, so an
    // SSO hand-off titled "Please wait" would fail a login as a bot wall.
    expect(
      CHALLENGE_TITLE_MARKERS.some((re) => re.test("Please wait...")),
    ).toBe(false);
  });

  it("recognises Vercel's checkpoint by its title", () => {
    expect(
      detectBotChallenge(
        429,
        new Headers(),
        page("Vercel Security Checkpoint"),
      ),
    ).not.toBeNull();
  });
});

describe("detectBotChallenge vendor markers", () => {
  it.each(["challenge", "captcha", "CAPTCHA "])(
    "recognises AWS WAF's %s action on any status",
    (action) => {
      // AWS answers a challenge with 202 and a CAPTCHA with 405, neither of
      // which is a blocking status.
      const headers = new Headers({ "x-amzn-waf-action": action });
      expect(detectBotChallenge(202, headers, "")).not.toBeNull();
      expect(detectBotChallenge(405, headers, "")).not.toBeNull();
    },
  );

  it("ignores an AWS WAF header naming some other action", () => {
    const headers = new Headers({ "x-amzn-waf-action": "allow" });
    expect(detectBotChallenge(200, headers, page("Home"))).toBeNull();
  });

  it("does not mistake a header that only names cf-mitigated", () => {
    const headers = new Headers({
      "access-control-expose-headers": "cf-mitigated, x-country",
    });
    expect(detectBotChallenge(200, headers, page("Home"))).toBeNull();
  });

  it("recognises DataDome's block page and its header on a blocking status", () => {
    expect(
      detectBotChallenge(
        403,
        new Headers(),
        '<html><script src="https://geo.captcha-delivery.com/captcha/"></script></html>',
      ),
    ).not.toBeNull();
    expect(
      detectBotChallenge(403, new Headers({ "x-dd-b": "1" }), ""),
    ).not.toBeNull();
  });

  it("leaves DataDome's markers alone on a page that was served", () => {
    // Every response from a protected site can carry them, and the CSP of an
    // ordinary page may name captcha-delivery.com.
    expect(
      detectBotChallenge(
        200,
        new Headers({ "x-dd-b": "1" }),
        '<html><a href="https://geo.captcha-delivery.com/">x</a></html>',
      ),
    ).toBeNull();
  });

  it("recognises HUMAN's captcha element on a blocking status only", () => {
    const body = '<html><body><div id="px-captcha"></div></body></html>';
    expect(detectBotChallenge(403, new Headers(), body)).not.toBeNull();
    expect(detectBotChallenge(200, new Headers(), body)).toBeNull();
  });

  it("recognises an Anubis challenge on any status", () => {
    // Its element id cannot appear on a page Anubis did not render, and
    // Anubis can be configured to send its gate with a 200.
    const body =
      '<html><script id="anubis_challenge" type="application/json">{}</script></html>';
    expect(detectBotChallenge(200, new Headers(), body)).not.toBeNull();
  });

  it("does not match an article showing Anubis's markup", () => {
    const body = '<html><pre>&lt;script id="anubis_challenge"&gt;</pre></html>';
    expect(detectBotChallenge(200, new Headers(), body)).toBeNull();
  });

  it.each([
    ["a comment", '<html><!-- <script id="anubis_challenge"> --></html>'],
    [
      "a string in a script",
      "<html><script>var a = '<script id=\"anubis_challenge\">'</script></html>",
    ],
    [
      "another attribute",
      '<html><script data-id="anubis_challenge"></script></html>',
    ],
    ["a longer id", '<html><script id="anubis_challenge-v2"></script></html>'],
  ])("does not take %s for the Anubis element", (_where, body) => {
    // On a 200 a match skips every page check, so quoted markup cannot count.
    expect(detectBotChallenge(200, new Headers(), body)).toBeNull();
  });
});

describe("detectBotChallenge structural signal", () => {
  const longScript = "x".repeat(1_500);

  it("recognises a gate that is one long script and almost no text", () => {
    const body = `<html><head><title>Loading</title></head><body><script>${longScript}</script><div>Loading...</div></body></html>`;
    expect(detectBotChallenge(503, new Headers(), body)).toBe(
      "HTTP 503 with a script-only page",
    );
  });

  it("counts a script Rocket Loader has retyped", () => {
    const body = `<html><body><script type="abc123-text/javascript">${longScript}</script></body></html>`;
    expect(detectBotChallenge(403, new Headers(), body)).not.toBeNull();
  });

  it("does not count noscript text a browser running the gate never shows", () => {
    const body = `<html><body><script>${longScript}</script><noscript>${"Please turn on JavaScript to continue to this website. ".repeat(3)}</noscript></body></html>`;
    expect(detectBotChallenge(403, new Headers(), body)).not.toBeNull();
  });

  it("leaves a maintenance page with words on it alone", () => {
    const body = `<html><body><script>${longScript}</script><p>${"We are down for scheduled maintenance until six this evening. ".repeat(2)}</p></body></html>`;
    expect(detectBotChallenge(503, new Headers(), body)).toBeNull();
  });

  it("leaves a script just under the threshold alone", () => {
    const body = `<html><body><script>${"x".repeat(1_499)}</script></body></html>`;
    expect(detectBotChallenge(503, new Headers(), body)).toBeNull();
  });

  it("does not count a data block as a script", () => {
    // A signed-out single page app's 403 can be one big JSON state blob.
    const body = `<html><body><script type="application/json">${longScript}</script></body></html>`;
    expect(detectBotChallenge(403, new Headers(), body)).toBeNull();
  });

  it("does not read the words after an empty script as its code", () => {
    const body = `<html><body><script/><p>${"word ".repeat(400)}</p></body></html>`;
    expect(detectBotChallenge(403, new Headers(), body)).toBeNull();
  });

  it("does not count an external script", () => {
    const body = `<html><body><script src="/app.js">${longScript}</script></body></html>`;
    expect(detectBotChallenge(403, new Headers(), body)).toBeNull();
  });

  it("leaves a single page app shell on a 200 alone", () => {
    const body = `<html><body><script>${longScript}</script></body></html>`;
    expect(detectBotChallenge(200, new Headers(), body)).toBeNull();
  });
});
