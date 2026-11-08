import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * /shared/[token] is a client page, so its data request used to wait for the
 * JavaScript. The layout names it in the HTML instead. The URL has to be the one
 * the page fetches, and crossOrigin "anonymous" is what lets a same-origin
 * fetch() reuse the preloaded response.
 */
const DIR = path.resolve(__dirname, "../../../app/shared/[token]");
const layout = fs.readFileSync(path.join(DIR, "layout.tsx"), "utf8");
const page = fs.readFileSync(path.join(DIR, "page.tsx"), "utf8");

describe("/shared/[token] preload", () => {
  it("is declared by a server component", () => {
    expect(layout).not.toMatch(/^\s*["']use client["']/m);
    expect(layout).toContain('from "react-dom"');
  });

  it("preloads exactly the URL the page fetches", () => {
    const url = "`${API.SHARED}/${encodeURIComponent(token)}`";
    expect(layout).toContain(`preload(${url}`);
    expect(page).toContain(`fetch(${url})`);
    expect(layout).toContain('as: "fetch"');
    expect(layout).toContain('crossOrigin: "anonymous"');
  });

  it("no longer reads the numeric scan id from the response", () => {
    expect(page).not.toContain("scanId ?? ");
    expect(page).not.toContain("setScanId");
    expect(page).not.toContain("data.scanId");
    expect(page).toMatch(/<ScanTags\s+scanId=\{token\}/);
  });

  it("tells a domain owner how to take the report down", () => {
    expect(page).toContain("<DomainTakedownLine />");
  });
});
