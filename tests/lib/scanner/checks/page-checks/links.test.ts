import { describe, expect, it } from "vitest";
import { buildPageContext } from "@/lib/scanner/page-context";
import type { CheckHit } from "@/lib/scanner/check-types";
import { linkChecks } from "@/lib/scanner/checks/page-checks/links";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-open-redirect-param-shape": [
    {
      description:
        "anchor href carries a next= parameter pointing at an absolute off-domain URL",
      url: "https://example.com/",
      body: `<a href="/logout?next=https://evil.example/phish">Logout</a>`,
      expect: "fire",
      evidenceIncludes: "next",
    },
    {
      description:
        "form action carries a returnUrl parameter with a protocol-relative off-domain target",
      url: "https://example.com/",
      body: `<form action="/login?returnUrl=//evil.example/phish" method="post"><input name="u"></form>`,
      expect: "fire",
    },
    {
      description: "ordinary link with no redirect-shaped parameter",
      url: "https://example.com/",
      body: `<a href="/pricing?utm_source=newsletter">Pricing</a>`,
      expect: "skip",
    },
    {
      description:
        "next= parameter is a bare same-domain relative path — no external destination in the value at all, cannot be an open-redirect vector (walmart.com's returnUrl=/account/delete-account shape)",
      url: "https://example.com/",
      body: `<a href="/logout?next=/dashboard">Logout</a>`,
      expect: "skip",
    },
    {
      description:
        "returnUrl parameter is a same-domain relative path from a form action",
      url: "https://example.com/",
      body: `<form action="/login?returnUrl=/account" method="post"><input name="u"></form>`,
      expect: "skip",
    },
  ],
  "page-anchor-target-blank-no-noopener": [
    {
      description: "rel=opener on a cross-origin target=_blank link",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank" rel="opener">Partner</a>`,
      expect: "fire",
      evidenceIncludes: "window.opener",
    },
    {
      description: "a named target on a cross-origin link",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/help" target="popup">Help</a>`,
      expect: "fire",
      evidenceIncludes: "https://partner.example.net/help",
    },
    {
      description: "rel=opener with noopener: noopener wins",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank" rel="opener noopener">Partner</a>`,
      expect: "skip",
    },
    {
      description: "a named target with rel=noopener",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="popup" rel="noopener">Partner</a>`,
      expect: "skip",
    },
    {
      description: "a named target with rel=noreferrer",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="popup" rel="noreferrer">Partner</a>`,
      expect: "skip",
    },
    {
      description:
        "plain cross-origin target=_blank with no rel is safe in every current browser",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank">Partner</a>`,
      expect: "skip",
    },
    {
      description: "cross-origin target=_blank with rel=noopener",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank" rel="noopener">Partner</a>`,
      expect: "skip",
    },
    {
      description: "cross-origin target=_blank with rel=noreferrer",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank" rel="noreferrer">Partner</a>`,
      expect: "skip",
    },
    {
      description: "data-rel does not stand in for rel",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank" data-rel="opener">Partner</a>`,
      expect: "skip",
    },
    {
      description: "the keyword targets are not named windows",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_self">a</a><a href="https://partner.example.net/" target="_top">b</a><a href="https://partner.example.net/" target="_parent">c</a>`,
      expect: "skip",
    },
    {
      description: "same-origin link with rel=opener",
      url: "https://example.com/",
      body: `<a href="/docs" target="_blank" rel="opener">Docs</a>`,
      expect: "skip",
    },
    {
      description: "a named target to the same site on www",
      url: "https://example.com/",
      body: `<a href="https://www.example.com/help" target="popup">Help</a>`,
      expect: "skip",
    },
    {
      description: "a named target to a subdomain of the same site",
      url: "https://example.com/",
      body: `<a href="https://help.example.com/" target="popup">Help</a>`,
      expect: "skip",
    },
    {
      description: "a named target on a mailto link has no destination site",
      url: "https://example.com/",
      body: `<a href="mailto:a@partner.example.net" target="popup">Mail</a>`,
      expect: "skip",
    },
    {
      description: "cross-origin link without a target",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" rel="opener">Partner</a>`,
      expect: "skip",
    },
    {
      description: "an empty target attribute",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="">Partner</a>`,
      expect: "skip",
    },
  ],
  "page-sensitive-file-link-same-origin": [
    {
      description: "same-origin link to a .env file",
      url: "https://example.com/",
      body: `<a href="/.env">env</a>`,
      expect: "fire",
      evidenceIncludes: "same-origin",
    },
    {
      description: "same-origin link to a .sql backup",
      url: "https://example.com/",
      body: `<a href="/backups/dump.sql">backup</a>`,
      expect: "fire",
    },
    {
      description: "same-origin archive named as a backup",
      url: "https://example.com/",
      body: `<a href="/files/site-backup-2024.zip">backup</a>`,
      expect: "fire",
    },
    {
      description: "same-origin tarball named as a database dump",
      url: "https://example.com/",
      body: `<a href="/exports/db_dump.tar.gz">dump</a>`,
      expect: "fire",
    },
    {
      description:
        "same-origin archive offered as an ordinary download is not flagged",
      url: "https://example.com/",
      body: `<a href="/brand/example-brand-kit.zip" download>Brand kit</a>`,
      expect: "skip",
    },
    {
      description: "same-origin archive inside a backups directory",
      url: "https://example.com/",
      body: `<a href="/backups/2024-11-01.zip">Archive</a>`,
      expect: "fire",
    },
    {
      description: "third-party link ending in .git is not flagged",
      url: "https://example.com/",
      body: `<a href="https://github.com/example/project.git">source</a>`,
      expect: "skip",
    },
    {
      description: "same-origin link to an ordinary page",
      url: "https://example.com/",
      body: `<a href="/about">About</a>`,
      expect: "skip",
    },
  ],
};

describe("page-anchor-target-blank-no-noopener evidence", () => {
  const check = linkChecks.find(
    (c) => c.id === "page-anchor-target-blank-no-noopener",
  )!;
  const runOn = (body: string) =>
    check.run(
      buildPageContext("https://example.com/", new Headers(), body),
    ) as CheckHit;

  it("lists each address once, caps excerpts at five, and counts every link", () => {
    const links = Array.from(
      { length: 7 },
      (_, i) => `<a href="https://p${i}.example.net/" target="x">a</a>`,
    ).join("");
    const dup = '<a href="https://p0.example.net/" target="x">again</a>';
    const found = runOn(links + dup);
    expect(found.evidence).toContain(
      "8 links to 7 other addresses keep window.opener",
    );
    expect(found.excerpts).toHaveLength(5);
  });

  it("agrees with one link", () => {
    const found = runOn('<a href="https://p.example.net/" target="x">a</a>');
    expect(found.evidence).toContain(
      "1 link to 1 other address keeps window.opener",
    );
  });
});

describe("page-checks/links", () => {
  runPageCheckTests(linkChecks, fixtures);
});
