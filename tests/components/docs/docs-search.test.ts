import { describe, it, expect } from "vitest";

import { DOCS_PAGES } from "@/components/docs/docs-nav";
import {
  buildDocsSearchRecords,
  docsRecordLabel,
  parseDocsSearchIndex,
  searchDocs,
  type DocsSearchRecord,
} from "@/components/docs/docs-search-records";

const records = buildDocsSearchRecords();

describe("search records", () => {
  it("has one record per page, with label, summary, section and audience", () => {
    const pages = records.filter((record) => !record.heading);
    expect(pages.map((record) => record.href)).toEqual(
      DOCS_PAGES.map((page) => page.href),
    );
    for (const record of pages) {
      expect(record.summary, record.href).toBeTruthy();
      expect(record.section, record.href).toBeTruthy();
      expect(record.audience, record.href).toBeTruthy();
    }
  });

  it("has one record per toc entry, with the hash in the href", () => {
    const expected = DOCS_PAGES.flatMap((page) =>
      page.toc.map((entry) => `${page.href}#${entry.id}`),
    );
    expect(
      records.filter((record) => record.heading).map((record) => record.href),
    ).toEqual(expected);
  });

  it("labels a section as Page > Section", () => {
    const record = records.find((r) => r.href === "/docs/webhooks#events")!;
    expect(docsRecordLabel(record)).toBe(`${record.page} > ${record.heading}`);
    expect(
      docsRecordLabel(records.find((r) => r.href === "/docs/webhooks")!),
    ).toBe("Webhooks");
  });
});

const fixture: DocsSearchRecord[] = [
  {
    href: "/docs/run",
    page: "Run page",
    section: "Run",
    audience: "run",
    summary: "Install it",
  },
  {
    href: "/docs/run#webhooks",
    page: "Run page",
    section: "Run",
    audience: "run",
    heading: "Webhooks",
  },
  {
    href: "/docs/use",
    page: "Use page",
    section: "Use",
    audience: "use",
    summary: "Scans",
  },
  {
    href: "/docs/use#webhooks",
    page: "Use page",
    section: "Use",
    audience: "use",
    heading: "Webhooks",
  },
];

describe("searchDocs", () => {
  it("returns nothing for an empty query", () => {
    expect(searchDocs(fixture, "   ")).toEqual([]);
  });

  it("groups results by page", () => {
    const groups = searchDocs(fixture, "webhooks", "use");
    expect(groups.map((group) => group.href)).toEqual([
      "/docs/use",
      "/docs/run",
    ]);
    expect(groups[0].records.map((r) => r.href)).toEqual([
      "/docs/use#webhooks",
    ]);
  });

  it("puts the reader's audience first", () => {
    expect(searchDocs(fixture, "webhooks", "run")[0].href).toBe("/docs/run");
  });

  it("requires every word to match", () => {
    expect(searchDocs(fixture, "webhooks nonsense")).toEqual([]);
    expect(searchDocs(fixture, "run webhooks")[0].records).toHaveLength(1);
  });

  it("matches on a summary", () => {
    expect(searchDocs(fixture, "install")[0].href).toBe("/docs/run");
  });

  it("searches body text when a richer index supplies it", () => {
    const rich = [{ ...fixture[0], text: "uses pg_dump nightly" }];
    expect(searchDocs(rich, "pg_dump")).toHaveLength(1);
  });

  it("finds a real page from the registry", () => {
    const groups = searchDocs(records, "webhooks");
    expect(groups.some((group) => group.href === "/docs/webhooks")).toBe(true);
  });
});

describe("parseDocsSearchIndex", () => {
  it("accepts the knowledge compiler's shape", () => {
    const row = {
      href: "/docs/a#b",
      page: "A",
      section: "S",
      audience: "use",
      heading: "B",
      text: "words",
    };
    expect(parseDocsSearchIndex([row])).toEqual([row]);
  });

  it("drops malformed rows and rejects a useless index", () => {
    expect(parseDocsSearchIndex([{ href: "https://evil.example" }])).toBeNull();
    expect(parseDocsSearchIndex("nope")).toBeNull();
    expect(parseDocsSearchIndex([])).toBeNull();
  });
});
