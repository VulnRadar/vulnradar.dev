import { describe } from "vitest";
import { scriptChecks } from "@/lib/scanner/checks/page-checks/scripts";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-script-missing-sri": [
    {
      description: "third-party script with no integrity attribute",
      url: "https://example.com/",
      body: `<script src="https://cdn.other.com/lib.js"></script>`,
      expect: "fire",
      evidenceIncludes: "cdn.other.com",
    },
    {
      description: "third-party script with integrity set",
      url: "https://example.com/",
      body: `<script src="https://cdn.other.com/lib.js" integrity="sha384-abc" crossorigin="anonymous"></script>`,
      expect: "skip",
    },
    {
      description: "first-party script never needs SRI",
      url: "https://example.com/",
      body: `<script src="/assets/app.js"></script>`,
      expect: "skip",
    },
  ],
  "page-stylesheet-missing-sri": [
    {
      description: "third-party stylesheet with no integrity",
      url: "https://example.com/",
      body: `<link rel="stylesheet" href="https://fonts.example.net/a.css">`,
      expect: "fire",
    },
    {
      description: "third-party stylesheet with integrity",
      url: "https://example.com/",
      body: `<link rel="stylesheet" href="https://fonts.example.net/a.css" integrity="sha384-abc">`,
      expect: "skip",
    },
  ],
  "page-source-map-reference": [
    {
      description: "inline script references a .map file",
      body: `<script>//# sourceMappingURL=/static/app.js.map</script>`,
      expect: "fire",
      evidenceIncludes: "app.js.map",
    },
    {
      description: "inline script with no source map comment",
      body: `<script>console.log("hi");</script>`,
      expect: "skip",
    },
  ],
  "page-script-from-suspicious-host": [
    {
      description: "script loaded from a paste site",
      url: "https://example.com/",
      body: `<script src="https://pastebin.com/raw/abc123"></script>`,
      expect: "fire",
      evidenceIncludes: "pastebin",
    },
    {
      description: "script loaded from a normal CDN",
      url: "https://example.com/",
      body: `<script src="https://cdn.jsdelivr.net/npm/lib@1.0.0/lib.js"></script>`,
      expect: "skip",
    },
  ],
  "page-third-party-script-unconstrained-by-csp": [
    {
      description: "third-party script, no SRI, and no CSP at all",
      url: "https://example.com/",
      body: `<script src="https://cdn.other.com/lib.js"></script>`,
      expect: "fire",
      evidenceIncludes: "cdn.other.com",
    },
    {
      description:
        "third-party script, no SRI, and CSP script-src is a bare https: scheme",
      url: "https://example.com/",
      headers: { "content-security-policy": "script-src https:" },
      body: `<script src="https://cdn.other.com/lib.js"></script>`,
      expect: "fire",
    },
    {
      description: "third-party script with SRI is not flagged",
      url: "https://example.com/",
      body: `<script src="https://cdn.other.com/lib.js" integrity="sha384-abc"></script>`,
      expect: "skip",
    },
    {
      description:
        "third-party script with no SRI, but CSP tightly allowlists the origin",
      url: "https://example.com/",
      headers: {
        "content-security-policy": "script-src 'self' https://cdn.other.com",
      },
      body: `<script src="https://cdn.other.com/lib.js"></script>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/scripts", () => {
  runPageCheckTests(scriptChecks, fixtures);
});
