import { describe } from "vitest";
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
      description: "cross-origin target=_blank link with no rel attribute",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank">Partner</a>`,
      expect: "fire",
      evidenceIncludes: "target",
    },
    {
      description: "cross-origin target=_blank link with rel=noopener",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank" rel="noopener">Partner</a>`,
      expect: "skip",
    },
    {
      description: "cross-origin target=_blank link with rel=noreferrer",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/" target="_blank" rel="noreferrer">Partner</a>`,
      expect: "skip",
    },
    {
      description: "same-origin target=_blank link needs no noopener",
      url: "https://example.com/",
      body: `<a href="/docs" target="_blank">Docs</a>`,
      expect: "skip",
    },
    {
      description: "cross-origin link without target=_blank",
      url: "https://example.com/",
      body: `<a href="https://partner.example.net/">Partner</a>`,
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

describe("page-checks/links", () => {
  runPageCheckTests(linkChecks, fixtures);
});
