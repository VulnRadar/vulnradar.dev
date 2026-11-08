import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DOCS_PAGES } from "@/components/docs/docs-nav";
import { MAX_SPEC_TARGETS } from "@/lib/scanner/spec-import";

const read = (file: string) => readFileSync(file, "utf8");
const page = read("app/docs/scanning/page.tsx");
const flat = page.replace(/\s+/g, " ");

describe("/docs/scanning", () => {
  it("is a real page with its own metadata", () => {
    expect(existsSync("app/docs/scanning/layout.tsx")).toBe(true);
    expect(read("app/docs/scanning/layout.tsx")).toContain(
      'path: "/docs/scanning"',
    );
  });

  it("has a nav entry whose label is the page's own title", () => {
    const entry = DOCS_PAGES.find((item) => item.href === "/docs/scanning");
    expect(entry?.label).toBe("Scanning a Site");
    expect(flat).toContain('title="Scanning a Site"');
  });

  it.each(["modes", "options", "panels", "authentication", "spec-import"])(
    "has the %s section the table of contents links to",
    (id) => {
      expect(page).toContain(`{ id: "${id}"`);
      expect(flat).toContain(`id="${id}"`);
    },
  );

  it("quotes the spec target cap from the importer", () => {
    expect(MAX_SPEC_TARGETS).toBeGreaterThan(0);
    expect(flat).toContain("{MAX_SPEC_TARGETS} targets");
    expect(flat).not.toMatch(/\b50 targets\b/);
  });

  it("states the same file limit the form enforces", () => {
    expect(read("components/scanner/scan-form.tsx")).toContain(
      "SPEC_MAX_BYTES = 5 * 1024 * 1024",
    );
    expect(flat).toContain("at most 5 MB");
  });

  it("names the sign-in methods the form offers", () => {
    const form = read("components/scanner/inline-auth-form.tsx");
    for (const label of ["Form login", "Header / token", "Cookie"]) {
      expect(form).toContain(`label: "${label}"`);
      expect(flat).toContain(`method: "${label}"`);
    }
  });

  it("sends readers to billing for plan numbers instead of restating them", () => {
    expect(flat).toContain('href="/docs/billing#plans"');
    expect(page).not.toMatch(
      /\b(Free|Core Supporter|Pro Supporter|Elite Supporter)\b/,
    );
  });

  it("has no em dash, en dash or middle dot in the copy", () => {
    expect(page).not.toMatch(/[\u2014\u2013\u00b7]/);
  });
});
