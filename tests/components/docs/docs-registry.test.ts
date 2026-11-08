import { describe, it, expect } from "vitest";

import {
  DOCS_NAV,
  DOCS_PAGES,
  docsPageContext,
} from "@/components/docs/docs-nav";
import { resolveMovedAnchor } from "@/lib/docs/moved-anchors";

describe("the registry", () => {
  it("keeps the flat list every other consumer reads", () => {
    expect(DOCS_PAGES.map((page) => page.href)).toContain("/docs/teams");
    expect(DOCS_PAGES.length).toBe(
      DOCS_NAV.reduce((total, section) => total + section.items.length, 0),
    );
  });

  it("fills every field for every page", () => {
    for (const page of DOCS_PAGES) {
      expect(page.template, page.href).toMatch(
        /^(quickstart|guide|reference|concept)$/,
      );
      expect(page.source, page.href).toMatch(/^app\/docs.*page\.tsx$/);
      expect(page.summary.length, page.href).toBeGreaterThan(0);
      expect(Array.isArray(page.toc), page.href).toBe(true);
    }
    for (const section of DOCS_NAV) {
      expect(section.audience, section.id).toMatch(/^(use|build|run|shared)$/);
    }
  });
});

describe("docsPageContext", () => {
  it("returns the page and the section it is in", () => {
    const { section, current } = docsPageContext("/docs/teams");
    expect(current?.href).toBe("/docs/teams");
    expect(section?.items).toContain(current);
  });

  it("never crosses a section", () => {
    for (const section of DOCS_NAV) {
      const first = docsPageContext(section.items[0].href);
      expect(first.previous, section.id).toBeUndefined();
      const last = docsPageContext(
        section.items[section.items.length - 1].href,
      );
      expect(last.next, section.id).toBeUndefined();
    }
  });

  it("walks within the section in order", () => {
    const section = DOCS_NAV.find((s) => s.items.length >= 3)!;
    const { previous, next } = docsPageContext(section.items[1].href);
    expect(previous).toBe(section.items[0]);
    expect(next).toBe(section.items[2]);
  });

  it("has no step number off a numbered path", () => {
    expect(DOCS_NAV.every((section) => !section.path)).toBe(true);
    expect(docsPageContext("/docs/teams").stepIndex).toBeUndefined();
  });

  it("is empty for a page the registry does not list", () => {
    expect(docsPageContext("/docs/nope")).toEqual({});
  });
});

describe("moved anchors", () => {
  const table = { "/docs/api": { "post-keys": "/docs/api/keys#post" } };

  it("forwards a mapped hash", () => {
    expect(resolveMovedAnchor("/docs/api", "#post-keys", table)).toBe(
      "/docs/api/keys#post",
    );
  });

  it("leaves anything else where it is", () => {
    expect(resolveMovedAnchor("/docs/api", "#other", table)).toBeUndefined();
    expect(
      resolveMovedAnchor("/docs/teams", "#post-keys", table),
    ).toBeUndefined();
    expect(resolveMovedAnchor("/docs/api", "", table)).toBeUndefined();
  });

  it("is not fooled by an inherited property name in the hash", () => {
    expect(
      resolveMovedAnchor("/docs/api", "#constructor", table),
    ).toBeUndefined();
  });
});
