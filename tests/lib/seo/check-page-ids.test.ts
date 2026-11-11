/**
 * From a finding id to its /checks page. The page route 404s anything the SEO
 * catalogue does not list, so a link built here is only worth showing if the
 * page behind it exists.
 */
import { describe, it, expect } from "vitest";
import { getAllChecks, getCheckById } from "@/lib/seo/checks-content";
import { ASYNC_CHECKS } from "@/lib/scanner/async-check-catalog";
import {
  ASYNC_CHECK_PAGE_IDS,
  CHECK_PAGE_IDS,
} from "@/lib/seo/check-page-ids.generated";
import { checkPageHref, checkPageId } from "@/lib/seo/check-page-href";

describe("CHECK_PAGE_IDS", () => {
  it("is exactly the id space the check pages render", () => {
    expect([...CHECK_PAGE_IDS].sort()).toEqual(
      getAllChecks()
        .map((c) => c.id)
        .sort(),
    );
  });

  it("is sorted and has no duplicates", () => {
    expect([...CHECK_PAGE_IDS]).toEqual([...CHECK_PAGE_IDS].sort());
    expect(new Set(CHECK_PAGE_IDS).size).toBe(CHECK_PAGE_IDS.length);
  });
});

describe("ASYNC_CHECK_PAGE_IDS", () => {
  it("maps real async checks to pages that exist", () => {
    const entries = Object.entries(ASYNC_CHECK_PAGE_IDS);
    expect(entries.length).toBeGreaterThanOrEqual(40);
    const asyncIds = new Set(Object.values(ASYNC_CHECKS).map((d) => d.checkId));
    for (const [asyncId, pageId] of entries) {
      expect(asyncIds.has(asyncId), asyncId).toBe(true);
      expect(getCheckById(pageId), `${asyncId} -> ${pageId}`).toBeDefined();
    }
  });
});

describe("checkPageHref", () => {
  it("links a finding from the registry to its own page", () => {
    expect(checkPageHref("hsts-missing--a1b2c3")).toBe("/checks/hsts-missing");
  });

  it("links a bare check id too", () => {
    expect(checkPageHref("hsts-missing")).toBe("/checks/hsts-missing");
  });

  it("sends an async finding to the write-up that documents it", () => {
    expect(
      checkPageHref(`${ASYNC_CHECKS.missingSpfRecord.checkId}--k3j9x1`),
    ).toBe("/checks/spf-record");
    expect(
      checkPageHref(`${ASYNC_CHECKS.expiredTlsCertificate.checkId}--k3j9x1`),
    ).toBe("/checks/tls-certificate-expiry");
  });

  it("finds the page for a title slug that ends in a dash", () => {
    // "MX Hostname Is a CNAME (RFC Violation)" slugs to `...-violation-`, so
    // the finding id carries three dashes before the hash.
    const id = `${ASYNC_CHECKS.mxHostnameIsACnameRfcViolation.checkId}--k3j9x1`;
    expect(id).toContain("---");
    expect(checkPageHref(id)).toBe("/checks/email-mx-hostname-cname");
  });

  it("gives every mapped async check a working link", () => {
    for (const asyncId of Object.keys(ASYNC_CHECK_PAGE_IDS)) {
      const href = checkPageHref(`${asyncId}--h4sh`);
      expect(href, asyncId).toMatch(/^\/checks\/[a-z0-9-]+$/);
      expect(getCheckById(href!.replace("/checks/", "")), asyncId).toBeTruthy();
    }
  });

  it("returns null for a check with no page rather than a link that 404s", () => {
    expect(checkPageHref("async-environment-file-exposed--k3j9")).toBeNull();
    expect(checkPageHref("page-not-a-real-check--k3j9")).toBeNull();
    expect(checkPageHref("")).toBeNull();
  });

  it("does not treat an object prototype key as an async check", () => {
    expect(checkPageId("constructor--k3j9")).toBeNull();
    expect(checkPageId("__proto__")).toBeNull();
    expect(checkPageId("toString")).toBeNull();
  });

  it("tolerates a stored finding with no id", () => {
    expect(checkPageId(undefined as unknown as string)).toBeNull();
  });
});
