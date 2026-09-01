/**
 * Which endpoint a dashboard submission goes to, and what it sends.
 *
 * The regression this locks down (AUDIT-011#drift-21): the dashboard sent ANY
 * request carrying an `auth` block to POST /api/v3/scan/authenticated, which is
 * single-page only. Picking "Deep" AND filling in a login therefore produced a
 * one-page scan, with no error and nothing on screen to say the crawl had been
 * dropped, while POST /api/v3/scan/crawl had accepted the same auth block all
 * along.
 */
import { describe, it, expect } from "vitest";
import { buildScanRequest } from "@/app/dashboard/scan-request";
import { API } from "@/lib/config/client-constants";
import type { EphemeralAuthInput } from "@/lib/scanner/auth/types";

const COOKIE_AUTH: EphemeralAuthInput = {
  method: "cookie",
  cookies: [{ name: "session_id", value: "abc123" }],
};

describe("buildScanRequest: endpoint routing", () => {
  it("sends a plain single-page scan to /api/v3/scan", () => {
    const req = buildScanRequest({ url: "example.com" });

    expect(req.endpoint).toBe(API.SCAN);
    expect(req.isInlineAuthScan).toBe(false);
    expect(req.payload).toEqual({ url: "example.com" });
  });

  it("sends a single-page scan WITH a login to the ephemeral endpoint", () => {
    const req = buildScanRequest({ url: "example.com", auth: COOKIE_AUTH });

    expect(req.endpoint).toBe(API.SCAN_AUTHENTICATED);
    expect(req.isInlineAuthScan).toBe(true);
    expect(req.payload.auth).toEqual(COOKIE_AUTH);
  });

  it("sends a signed-out crawl to /api/v3/scan/crawl with the picked pages", () => {
    const req = buildScanRequest({
      url: "example.com",
      crawlUrls: ["https://example.com/", "https://example.com/docs"],
    });

    expect(req.endpoint).toBe(API.SCAN_CRAWL);
    expect(req.isInlineAuthScan).toBe(false);
    expect(req.payload.urls).toEqual([
      "https://example.com/",
      "https://example.com/docs",
    ]);
    expect(req.payload.auth).toBeUndefined();
  });

  it("sends an AUTHENTICATED crawl to the crawl endpoint, carrying both the pages and the login", () => {
    const req = buildScanRequest({
      url: "example.com",
      crawlUrls: ["https://example.com/", "https://example.com/app"],
      auth: COOKIE_AUTH,
    });

    // The bug: this used to be API.SCAN_AUTHENTICATED, whose schema has no
    // `urls` field, so the crawl silently became a one-page scan.
    expect(req.endpoint).toBe(API.SCAN_CRAWL);
    expect(req.payload.urls).toEqual([
      "https://example.com/",
      "https://example.com/app",
    ]);
    expect(req.payload.auth).toEqual(COOKIE_AUTH);
  });

  it("marks an authenticated crawl as needing polling, not a synchronous result", () => {
    // Only the single-page ephemeral endpoint replies with a finished scan.
    // Treating an authenticated crawl as synchronous would read { scanId,
    // status: "running" } as the result and render an empty report.
    const crawl = buildScanRequest({
      url: "example.com",
      crawlUrls: ["https://example.com/"],
      auth: COOKIE_AUTH,
    });
    const single = buildScanRequest({ url: "example.com", auth: COOKIE_AUTH });

    expect(crawl.isInlineAuthScan).toBe(false);
    expect(single.isInlineAuthScan).toBe(true);
  });
});

describe("buildScanRequest: payload options", () => {
  it("omits isPublic entirely when the caller made no choice", () => {
    const req = buildScanRequest({ url: "example.com" });
    expect("isPublic" in req.payload).toBe(false);
  });

  it("passes isPublic through in both directions once chosen", () => {
    expect(
      buildScanRequest({ url: "example.com", isPublic: false }).payload
        .isPublic,
    ).toBe(false);
    expect(
      buildScanRequest({ url: "example.com", isPublic: true }).payload.isPublic,
    ).toBe(true);
  });

  it("drops an empty scanners array rather than sending it", () => {
    const req = buildScanRequest({ url: "example.com", scanners: [] });
    expect("scanners" in req.payload).toBe(false);
  });

  it("carries the picked check families into an authenticated crawl", () => {
    const req = buildScanRequest({
      url: "example.com",
      crawlUrls: ["https://example.com/"],
      scanners: ["headers", "tls"],
      auth: COOKIE_AUTH,
    });
    expect(req.payload.scanners).toEqual(["headers", "tls"]);
  });

  it("only mentions the opt-in extras when they were requested", () => {
    const off = buildScanRequest({ url: "example.com" });
    expect("captureScreenshot" in off.payload).toBe(false);
    expect("portScan" in off.payload).toBe(false);

    const on = buildScanRequest({
      url: "example.com",
      captureScreenshot: true,
      portScan: true,
    });
    expect(on.payload.captureScreenshot).toBe(true);
    expect(on.payload.portScan).toBe(true);
  });

  it("never sends captureScreenshot or portScan to the single-page authenticated endpoint", () => {
    // That route's schema does not accept them.
    const req = buildScanRequest({
      url: "example.com",
      auth: COOKIE_AUTH,
      captureScreenshot: true,
      portScan: true,
    });

    expect(req.endpoint).toBe(API.SCAN_AUTHENTICATED);
    expect("captureScreenshot" in req.payload).toBe(false);
    expect("portScan" in req.payload).toBe(false);
  });
});
