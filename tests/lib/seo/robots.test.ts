/**
 * The OpenAPI document is the one thing under /api/ meant to be read by
 * machines that are not API clients, and `Disallow: /api/` kept every crawler
 * off it. Crawlers take the longest matching rule, so one Allow line for that
 * exact path wins without opening anything else under /api/.
 */
import { describe, it, expect } from "vitest";
import robots from "@/app/robots";
import { API, APP_NAME } from "@/lib/config/constants";
import { DISALLOWED_PATHS } from "@/lib/seo/routes";

const groups = [robots().rules].flat();
const allowsOf = (group: (typeof groups)[number]) => [group.allow].flat();

describe("robots.txt and the OpenAPI document", () => {
  it("would be blocked without an explicit Allow", () => {
    expect(DISALLOWED_PATHS.some((p) => API.OPENAPI.startsWith(p))).toBe(true);
  });

  it("allows it for the wildcard group and the AI crawlers", () => {
    const readers = groups.filter((g) => g.userAgent !== APP_NAME);
    expect(readers.length).toBe(2);
    for (const group of readers) {
      expect(allowsOf(group), String(group.userAgent)).toEqual([
        "/",
        API.OPENAPI,
      ]);
    }
  });

  it("opens nothing else under /api/", () => {
    for (const group of groups) {
      const api = allowsOf(group).filter((p) => p?.startsWith("/api/"));
      expect(api.filter((p) => p !== API.OPENAPI)).toEqual([]);
    }
  });

  it("leaves our own scanner's group alone", () => {
    const own = groups.find((g) => g.userAgent === APP_NAME);
    expect(allowsOf(own!)).toEqual(["/"]);
  });
});
