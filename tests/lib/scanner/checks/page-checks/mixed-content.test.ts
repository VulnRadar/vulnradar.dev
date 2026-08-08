import { describe } from "vitest";
import { mixedContentChecks } from "@/lib/scanner/checks/page-checks/mixed-content";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-mixed-content-active": [
    {
      description: "script loaded over http on an https page",
      url: "https://example.com/",
      body: `<script src="http://cdn.example.net/lib.js"></script>`,
      expect: "fire",
      evidenceIncludes: "http",
    },
    {
      description:
        "markup-shaped text inside a JS string is not a real script tag",
      url: "https://example.com/",
      body: `<script>var t = '<script src="http://evil.example/x.js"></' + 'script>';</script>`,
      expect: "skip",
    },
    {
      description: "all resources are https",
      url: "https://example.com/",
      body: `<script src="https://cdn.example.com/lib.js"></script>`,
      expect: "skip",
    },
    {
      description: "http page is not held to the mixed-content rule",
      url: "http://example.com/",
      body: `<script src="http://cdn.example.net/lib.js"></script>`,
      expect: "skip",
    },
  ],
  "page-third-party-iframe-no-sandbox": [
    {
      description: "third-party iframe with no sandbox attribute",
      url: "https://example.com/",
      body: `<iframe src="https://ads.example.net/x"></iframe>`,
      expect: "fire",
      evidenceIncludes: "ads.example.net",
    },
    {
      description: "third-party iframe with a sandbox attribute",
      url: "https://example.com/",
      body: `<iframe src="https://ads.example.net/x" sandbox="allow-scripts"></iframe>`,
      expect: "skip",
    },
    {
      description: "first-party iframe never needs sandbox",
      url: "https://example.com/",
      body: `<iframe src="/embed/widget"></iframe>`,
      expect: "skip",
    },
  ],
  "page-mixed-content-passive": [
    {
      description: "image loaded over http on an https page",
      url: "https://example.com/",
      body: `<img src="http://cdn.example.net/logo.png">`,
      expect: "fire",
      evidenceIncludes: "http",
    },
    {
      description: "video source loaded over http",
      url: "https://example.com/",
      body: `<video><source src="http://cdn.example.net/clip.mp4"></video>`,
      expect: "fire",
    },
    {
      description: "image loaded over https",
      url: "https://example.com/",
      body: `<img src="https://cdn.example.com/logo.png">`,
      expect: "skip",
    },
    {
      description: "http page is not held to the mixed-content rule",
      url: "http://example.com/",
      body: `<img src="http://cdn.example.net/logo.png">`,
      expect: "skip",
    },
  ],
  "page-cross-origin-iframe-sensitive-path": [
    {
      description: "cross-origin iframe embeds an admin path",
      url: "https://example.com/",
      body: `<iframe src="https://partner.example.net/admin/settings"></iframe>`,
      expect: "fire",
      evidenceIncludes: "sensitive-looking",
    },
    {
      description: "cross-origin iframe embeds a login path",
      url: "https://example.com/",
      body: `<iframe src="https://partner.example.net/account/login"></iframe>`,
      expect: "fire",
    },
    {
      description: "cross-origin iframe embeds an ordinary widget path",
      url: "https://example.com/",
      body: `<iframe src="https://widget.example.net/embed/chat"></iframe>`,
      expect: "skip",
    },
    {
      description: "first-party iframe with an admin path is not flagged",
      url: "https://example.com/",
      body: `<iframe src="/admin/settings"></iframe>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/mixed-content", () => {
  runPageCheckTests(mixedContentChecks, fixtures);
});
