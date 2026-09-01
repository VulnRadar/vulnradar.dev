/**
 * Tests for lib/scanner/scan-target-classify.ts.
 *
 * The module had no dedicated suite: 37% statements and 16% branches, the
 * weakest numbers in lib/scanner, despite being imported directly by
 * components/scanner/scan-form.tsx (it decides whether the user sees a "this
 * is a search engine" warning before a scan runs) and by execute-scan.ts (it
 * decides the redirect notice stored on every result). ref: AUDIT-013#cov-18
 *
 * The cases are written as tables because the browser extension keeps its own
 * copy of classifyScanTarget (extension/src/lib/scan-target.ts, exercised by
 * tests/extension/pure-modules.test.ts). Keeping both suites' inputs in the
 * same shape is what makes a divergence between the two copies visible.
 */

import { describe, it, expect } from "vitest";
import {
  classifyScanTarget,
  classifyRedirect,
} from "@/lib/scanner/scan-target-classify";

describe("classifyScanTarget", () => {
  // Every host form the matcher has to handle: an exact single-host entry, a
  // subdomain of one, and the "family" entries ending in a dot, which have
  // three separate arms (bare host, host starting with the prefix, and the
  // prefix appearing after a subdomain label).
  const searchEngines: Array<[string, string]> = [
    ["bare family host", "google.com"],
    ["family host with www", "www.google.com"],
    ["family host on a country TLD", "www.google.co.uk"],
    ["family host, bare, no TLD suffix beyond the prefix", "google.de"],
    ["second family entry", "yandex.ru"],
    ["exact single host", "bing.com"],
    ["subdomain of an exact single host", "www.bing.com"],
    ["multi-label exact entry", "search.yahoo.com"],
    ["duckduckgo", "duckduckgo.com"],
    ["brave", "search.brave.com"],
    ["baidu", "baidu.com"],
    ["ecosia", "ecosia.org"],
    ["startpage", "startpage.com"],
    ["qwant", "qwant.com"],
    ["ask", "ask.com"],
    ["aol", "search.aol.com"],
  ];

  it.each(searchEngines)("flags a search engine host: %s", (_label, host) => {
    const result = classifyScanTarget(`https://${host}/`);
    expect(result.scannable).toBe(false);
    expect(result.category).toBe("search-engine");
    expect(result.reason).toContain("search engine");
  });

  // These must NOT match. "googleapis.com" and "googletagmanager.com" start
  // with "google" but not with "google." -- a family entry is a dotted prefix
  // precisely so it cannot swallow them.
  const notSearchEngines = [
    "https://googleapis.com/",
    "https://www.googletagmanager.com/gtm.js",
    "https://notbing.com/",
    "https://bing.com.evil.example/",
    "https://example.com/search?q=hello",
    "https://shop.example.com/results?query=shoes",
  ];

  it.each(notSearchEngines)("does not flag %s", (url) => {
    expect(classifyScanTarget(url)).toEqual({ scannable: true });
  });

  it("distinguishes a results page from the engine's home page", () => {
    const home = classifyScanTarget("https://www.google.com/");
    const results = classifyScanTarget("https://www.google.com/search?q=cats");

    expect(home.reason).toContain("not a site you're likely trying to assess");
    expect(results.reason).toContain("search engine results page");
  });

  // A results page is recognised either by its path or by carrying one of the
  // query-parameter names search engines put the query in.
  const resultsUrls = [
    "https://www.google.com/search?q=cats",
    "https://www.google.com/results",
    "https://duckduckgo.com/?q=cats",
    "https://yandex.ru/?text=cats",
    "https://baidu.com/?wd=cats",
    "https://search.yahoo.com/?p=cats",
    "https://bing.com/?query=cats",
    "https://ecosia.org/?search=cats",
  ];

  it.each(resultsUrls)("recognises %s as a results page", (url) => {
    expect(classifyScanTarget(url).reason).toContain(
      "search engine results page",
    );
  });

  it("accepts a bare host with no scheme (what the scan form passes)", () => {
    expect(classifyScanTarget("google.com").scannable).toBe(false);
    expect(classifyScanTarget("example.com").scannable).toBe(true);
  });

  it("treats a malformed URL as scannable and leaves it to the validator", () => {
    // The normal URL validator owns the "this is not a URL" message; this
    // classifier must not pre-empt it with a search-engine warning.
    expect(classifyScanTarget("http://")).toEqual({ scannable: true });
    expect(classifyScanTarget("")).toEqual({ scannable: true });
  });

  it("matches case-insensitively", () => {
    expect(classifyScanTarget("https://WWW.GOOGLE.COM/").scannable).toBe(false);
  });
});

describe("classifyRedirect", () => {
  it("returns null when the two URLs are the same page", () => {
    expect(
      classifyRedirect("https://example.com/a", "https://example.com/a"),
    ).toBeNull();
  });

  // Trailing slash and scheme are deliberately ignored: neither is a redirect
  // a user would want a notice about.
  const equivalentPairs: Array<[string, string]> = [
    ["https://example.com/a", "https://example.com/a/"],
    ["http://example.com/a", "https://example.com/a"],
    ["https://example.com", "https://example.com/"],
    ["https://example.com/a?b=1", "https://example.com/a/?b=1"],
  ];

  it.each(equivalentPairs)(
    "treats %s -> %s as no redirect worth reporting",
    (from, to) => {
      expect(classifyRedirect(from, to)).toBeNull();
    },
  );

  it("returns null when either URL is malformed", () => {
    expect(classifyRedirect("not a url", "https://example.com/")).toBeNull();
    expect(classifyRedirect("https://example.com/", "not a url")).toBeNull();
  });

  const loginPaths = [
    "https://example.com/login",
    "https://example.com/log-in",
    "https://example.com/sign_in",
    "https://example.com/signin/",
    "https://example.com/signon",
    "https://example.com/sso",
    "https://example.com/auth",
    "https://example.com/authenticate",
    "https://example.com/authorize",
    "https://example.com/account/login",
    "https://example.com/users/sign_in",
    "https://example.com/session/new",
    "https://example.com/oauth/start",
  ];

  it.each(loginPaths)("classifies a redirect to %s as a login", (finalUrl) => {
    const info = classifyRedirect("https://example.com/dashboard", finalUrl);
    expect(info?.kind).toBe("login");
    expect(info?.reason).toContain("login page");
    expect(info?.requestedUrl).toBe("https://example.com/dashboard");
    expect(info?.finalUrl).toBe(finalUrl);
  });

  // A return-to parameter is the other half of the login signal: plenty of
  // sign-in pages live on a path this regex would not recognise, but almost
  // all of them carry the URL to come back to.
  const returnParams = [
    "next",
    "redirect",
    "redirect_uri",
    "return",
    "returnurl",
    "returnto",
    "continue",
    "rd",
    "ref",
  ];

  it.each(returnParams)(
    "classifies a redirect carrying ?%s= as a login",
    (param) => {
      const info = classifyRedirect(
        "https://example.com/dashboard",
        `https://example.com/portal?${param}=%2Fdashboard`,
      );
      expect(info?.kind).toBe("login");
    },
  );

  it("classifies an unrelated redirect as 'other'", () => {
    const info = classifyRedirect(
      "https://example.com/old",
      "https://example.com/new-home",
    );
    expect(info?.kind).toBe("other");
    expect(info?.reason).toContain("redirected elsewhere");
  });

  it("reports a cross-host redirect", () => {
    const info = classifyRedirect(
      "https://example.com/",
      "https://www.example.org/",
    );
    expect(info?.kind).toBe("other");
  });
});
