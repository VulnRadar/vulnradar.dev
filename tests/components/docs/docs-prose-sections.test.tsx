import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { DocsSection, DocsSubSection } from "@/components/docs/docs-section";
import { DOCS_PROSE, slugifyHeading } from "@/components/docs/docs-prose";

const ROOT = path.resolve(__dirname, "../../..");

describe("slugifyHeading", () => {
  it.each([
    ["Runtime vs. build tier", "runtime-vs-build-tier"],
    ["Rate limits & quotas", "rate-limits-quotas"],
    ["  Spaces  ", "spaces"],
  ])("%s", (title, slug) => {
    expect(slugifyHeading(title)).toBe(slug);
  });
});

describe("DocsSubSection", () => {
  it("derives an id from the title when none is passed", () => {
    const html = renderToStaticMarkup(
      <DocsSubSection title="Runtime vs. build tier">x</DocsSubSection>,
    );
    expect(html).toContain('id="runtime-vs-build-tier"');
    expect(html).toContain('href="#runtime-vs-build-tier"');
  });

  it("uses the id it is given", () => {
    const html = renderToStaticMarkup(
      <DocsSubSection id="smtp" title="Email">
        x
      </DocsSubSection>,
    );
    expect(html).toContain('id="smtp"');
    expect(html).toContain('href="#smtp"');
    expect(html).not.toContain('id="email"');
  });
});

describe("DocsSection", () => {
  const html = renderToStaticMarkup(
    <DocsSection id="teams" title="Teams">
      <p>Body</p>
    </DocsSection>,
  );

  it("carries the prose rules", () => {
    expect(html).toContain("[&amp;_p_a]:underline");
  });

  it("drops the rule under the heading", () => {
    expect(html).not.toContain("border-b");
  });

  it("uses the corrected anchor offset", () => {
    expect(html).toContain("scroll-mt-4");
    expect(html).not.toContain("scroll-mt-24");
  });
});

describe("DOCS_PROSE", () => {
  it("underlines running-text links at rest", () => {
    expect(DOCS_PROSE).toContain("[&_p_a]:underline");
    expect(DOCS_PROSE).toContain("[&_li_a]:underline");
    expect(DOCS_PROSE).toContain("[&_p_a]:decoration-primary/40");
    expect(DOCS_PROSE).toContain("[&_p_a:hover]:decoration-primary");
  });

  it("colours links with the AA token, which a text-primary variant misses", () => {
    expect(DOCS_PROSE).toContain("[&_p_a]:text-[hsl(var(--primary-text))]");
    expect(DOCS_PROSE).toContain("[&_li_a]:text-[hsl(var(--primary-text))]");
    expect(DOCS_PROSE).not.toContain("_a]:text-primary");
  });

  it("sets body text at 15px without touching a callout's own <p>", () => {
    expect(DOCS_PROSE).toContain(
      "[&_p:not(aside_p,figure_p,.text-xs)]:text-[15px]",
    );
    expect(DOCS_PROSE).not.toContain("[&_p]:text-[15px]");
  });
});

describe("globals.css", () => {
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

  it("sets the base paragraph to a unitless line height", () => {
    expect(css).toMatch(/\n\s*p \{\s*line-height: 1\.625;\s*\}/);
  });

  it("stopped claiming a scroll-margin replaces the root's scroll-padding", () => {
    expect(css).not.toContain("those still");
    expect(css).toContain("added to this");
  });
});
