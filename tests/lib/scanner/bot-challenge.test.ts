import { describe, it, expect } from "vitest";
import { detectBotChallenge } from "@/lib/scanner/bot-challenge";

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
});
