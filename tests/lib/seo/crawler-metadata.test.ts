import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config.mjs";

/**
 * Next streams page metadata (title, canonical, hreflang, icons) into the
 * <body> for user agents outside `htmlLimitedBots`, and its default list
 * leaves out Googlebot. Google reads the canonical and the favicon from the
 * <head> of the HTML it fetched, so the crawlers have to be on the list.
 */
describe("htmlLimitedBots", () => {
  const re = (nextConfig as { htmlLimitedBots?: RegExp }).htmlLimitedBots;

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.75 Safari/537.36 Google Favicon",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)",
    "Twitterbot/1.0",
  ])("sends metadata in the head to %s", (ua) => {
    expect(re?.test(ua)).toBe(true);
  });

  it("keeps streaming for an ordinary browser", () => {
    expect(
      re?.test(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});
