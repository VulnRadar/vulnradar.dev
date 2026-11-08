/**
 * app/not-found.tsx was a client component, and a client component cannot
 * export metadata, so every dead URL's tab, history entry and screen-reader
 * announcement read as the home page's tagline (WCAG 2.4.2, Page Titled).
 *
 * Source-text assertions, as elsewhere for .tsx: vitest runs `node` and
 * tsconfig keeps `jsx: preserve`, so a file with JSX cannot be imported here.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const route = read("app/not-found.tsx");
const view = read("components/shared/not-found-view.tsx");

describe("the 404 route", () => {
  it("is a server component, or it could not export metadata", () => {
    expect(route).not.toMatch(/^\s*["']use client["']/m);
    expect(route).toMatch(/export const metadata\b/);
  });

  it("has its own title and stays out of search", () => {
    expect(route).toMatch(/title:\s*"Page not found"/);
    expect(route).toMatch(
      /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/,
    );
  });

  it("renders the client view", () => {
    expect(route).toContain("<NotFoundView />");
    expect(view).toMatch(/^"use client";/);
    expect(view).toMatch(/export function NotFoundView\b/);
  });

  it("gives its three footer links a 24px target", () => {
    // At text-xs with no padding these were 16px tall.
    expect(view).toMatch(
      /const footerLinkClass = `-my-1\.5 block py-1\.5 [^`]*\$\{focus\.ring\}`/,
    );
    expect(view).toMatch(/<div className="flex gap-6 text-xs">/);
    expect(view.match(/className=\{footerLinkClass\}/g)).toHaveLength(3);
  });

  it("uses no middle-dot separators", () => {
    expect(view).not.toContain("·");
  });

  it("keeps the Tier C heading", () => {
    expect(view).toContain(
      '<h1 className="text-lg font-semibold text-foreground">',
    );
  });
});
