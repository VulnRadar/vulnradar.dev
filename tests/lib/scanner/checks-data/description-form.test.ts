/**
 * A check's description is the sentence a scan result and a search snippet lead
 * with, so it states the finding. Six TLS and email pages opened with
 * "Async check:" and then described how the probe works, which told the reader
 * about the scanner instead of the site.
 */

import { describe, expect, it } from "vitest";

import { loadCheckPages } from "./_page-prose";

const pages = loadCheckPages();

describe("checks-data: description form", () => {
  it("never opens by describing the scanner's own mechanics", () => {
    const hits = pages
      .filter((page) => /^\s*async check\b/i.test(page.description))
      .map((page) => page.id);
    expect(hits).toEqual([]);
  });

  it("explains that OCSP stapling is reported only for certificates with a responder", () => {
    const page = pages.find((p) => p.id === "tls-ocsp-stapling-disabled");
    expect(page?.explanation).toMatch(/names an OCSP responder/);
    expect(page?.explanation).toContain("tls-must-staple-not-stapled");
  });
});
