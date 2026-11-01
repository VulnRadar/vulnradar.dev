import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// osv-check's import chain reaches a pool through the registry. Nothing here
// touches it, so it is faked the way inventory-perf.test.ts fakes it.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

const { fingerprintSoftware } =
  await import("@/lib/scanner/software-inventory");

/**
 * The inventory says which vendors a page loads from. It used to decide that
 * by searching the body for the vendor's hostname as text, so a page that
 * only mentioned the name, or loaded from a host that contains it, was
 * reported as using the vendor. The page is the scan target's own markup, so
 * the target chose what its inventory said.
 */

interface HostCase {
  name: string;
  /** The host a real page loads from. */
  host: string;
  /** The host the rule is keyed on: `host` itself, or the vendor's domain
   *  when any subdomain of it counts. */
  ruleHost: string;
  path: string;
}

const CASES: HostCase[] = [
  {
    name: "Tailwind CSS",
    host: "cdn.tailwindcss.com",
    ruleHost: "cdn.tailwindcss.com",
    path: "",
  },
  {
    name: "Bootstrap",
    host: "cdn.jsdelivr.net",
    ruleHost: "cdn.jsdelivr.net",
    path: "/npm/bootstrap@5.3.3/",
  },
  {
    name: "Stripe.js",
    host: "js.stripe.com",
    ruleHost: "js.stripe.com",
    path: "/v3/",
  },
  {
    name: "Google Analytics",
    host: "www.google-analytics.com",
    ruleHost: "google-analytics.com",
    path: "/analytics.js",
  },
  {
    name: "Google Analytics",
    host: "www.googletagmanager.com",
    ruleHost: "googletagmanager.com",
    path: "/gtag/js?id=G-ABC123",
  },
  {
    name: "Google Tag Manager",
    host: "www.googletagmanager.com",
    ruleHost: "googletagmanager.com",
    path: "/gtm.js?id=GTM-ABC123",
  },
  {
    name: "Cloudflare Web Analytics",
    host: "static.cloudflareinsights.com",
    ruleHost: "static.cloudflareinsights.com",
    path: "/beacon.min.js",
  },
  {
    name: "Cloudflare Turnstile",
    host: "challenges.cloudflare.com",
    ruleHost: "challenges.cloudflare.com",
    path: "/turnstile/v0/api.js",
  },
  {
    name: "Plausible",
    host: "plausible.io",
    ruleHost: "plausible.io",
    path: "/js/script.js",
  },
  {
    name: "Fathom Analytics",
    host: "cdn.usefathom.com",
    ruleHost: "cdn.usefathom.com",
    path: "/script.js",
  },
  {
    name: "PostHog",
    host: "app.posthog.com",
    ruleHost: "app.posthog.com",
    path: "/static/array.js",
  },
  {
    name: "Segment",
    host: "cdn.segment.com",
    ruleHost: "cdn.segment.com",
    path: "/analytics.js/v1/KEY/analytics.min.js",
  },
  {
    name: "Hotjar",
    host: "static.hotjar.com",
    ruleHost: "static.hotjar.com",
    path: "/c/hotjar-123.js",
  },
  {
    name: "Mixpanel",
    host: "cdn.mxpnl.com",
    ruleHost: "cdn.mxpnl.com",
    path: "/libs/mixpanel-2-latest.min.js",
  },
  {
    name: "Sentry",
    host: "browser.sentry-cdn.com",
    ruleHost: "browser.sentry-cdn.com",
    path: "/7.0.0/bundle.min.js",
  },
  {
    name: "Vercel Analytics",
    host: "va.vercel-scripts.com",
    ruleHost: "va.vercel-scripts.com",
    path: "/v1/script.debug.js",
  },
  {
    name: "Intercom",
    host: "widget.intercom.io",
    ruleHost: "widget.intercom.io",
    path: "/widget/abc123",
  },
  {
    name: "Intercom",
    host: "js.intercomcdn.com",
    ruleHost: "js.intercomcdn.com",
    path: "/shim.latest.js",
  },
  {
    name: "Google reCAPTCHA",
    host: "www.gstatic.com",
    ruleHost: "gstatic.com",
    path: "/recaptcha/releases/abc/recaptcha__en.js",
  },
  {
    name: "hCaptcha",
    host: "js.hcaptcha.com",
    ruleHost: "hcaptcha.com",
    path: "/1/api.js",
  },
];

function names(body: string, headers = new Headers()): string[] {
  return fingerprintSoftware(headers, body, "https://example.com/").map(
    (i) => i.name,
  );
}

describe("software inventory: a vendor is read from the URL's host, not from text", () => {
  for (const c of CASES) {
    const label = `${c.name} (${c.host}${c.path})`;

    it(`${label}: a script loaded from the vendor's host is listed`, () => {
      expect(
        names(`<script src="https://${c.host}${c.path}"></script>`),
      ).toContain(c.name);
    });

    it(`${label}: the URL inside an inline loader snippet is listed`, () => {
      expect(
        names(`<script>s.src='https://${c.host}${c.path}'+k;</script>`),
      ).toContain(c.name);
    });

    it(`${label}: a protocol-relative or JSON-escaped URL is listed`, () => {
      expect(names(`<script src="//${c.host}${c.path}"></script>`)).toContain(
        c.name,
      );
      // Every slash escaped, as a Next.js flight payload writes it. A backslash
      // is escaped as well, so the string stays valid JSON whatever it holds.
      const escaped = `https://${c.host}${c.path}`.replace(/[\\/]/g, "\\$&");
      expect(
        names(`<script>self.__next_f.push(["${escaped}"])</script>`),
      ).toContain(c.name);
    });

    // A <link> rather than a <script>: osv-check also lists a library from a
    // script's file name on any host (/npm/bootstrap@5.3.3/ is Bootstrap
    // wherever it is served), which is a path signal and not under test here.
    it(`${label}: a host that continues past the vendor's name is not listed`, () => {
      expect(
        names(
          `<link rel="preload" as="script" href="https://${c.ruleHost}.evil.example${c.path}">`,
        ),
      ).not.toContain(c.name);
    });

    it(`${label}: a host that only ends in the vendor's name is not listed`, () => {
      expect(
        names(
          `<link rel="preload" as="script" href="https://evil${c.ruleHost}${c.path}">`,
        ),
      ).not.toContain(c.name);
    });

    it(`${label}: the vendor's host as user info before another host is not listed`, () => {
      expect(
        names(
          `<link rel="preload" as="script" href="https://${c.host}@evil.example${c.path}">`,
        ),
      ).not.toContain(c.name);
    });

    it(`${label}: the name in another URL's query string is not listed`, () => {
      expect(
        names(`<a href="https://evil.example/?${c.host}${c.path}">x</a>`),
      ).not.toContain(c.name);
      expect(
        names(
          `<a href="https://evil.example/?u=https://${c.host}${c.path}">x</a>`,
        ),
      ).not.toContain(c.name);
      expect(
        names(`<p>We stopped using ${c.host}${c.path}.</p>`),
      ).not.toContain(c.name);
    });
  }

  it("an unquoted src attribute, as minifiers write it, is still listed", () => {
    expect(
      names(`<script src=https://cdn.usefathom.com/script.js defer></script>`),
    ).toContain("Fathom Analytics");
  });

  it("the markers that were never host based still match the page anywhere", () => {
    const listed = names(
      `<script>posthog.init('phc_x')</script>
       <script src="/static/@sentry/browser/bundle.js"></script>
       <script src="/_vercel/insights/script.js"></script>
       <script src="/assets/bootstrap.bundle.min.js"></script>
       <script src="https://www.google.com/recaptcha/api.js"></script>`,
    );
    expect(listed).toEqual(
      expect.arrayContaining([
        "PostHog",
        "Sentry",
        "Vercel Analytics",
        "Bootstrap",
        "Google reCAPTCHA",
      ]),
    );
  });
});

describe("software inventory: reading every URL on the page stays linear", () => {
  // The URL scan runs over the whole body, so it gets the same treatment as
  // the shapes in inventory-perf.test.ts: markup built to make it backtrack.
  const SHAPES: Record<string, string> = {
    hostWithoutDot: "//" + "a".repeat(1_000_000),
    dashRun: "https://" + "a-".repeat(500_000),
    labelRun: "//" + "a.".repeat(500_000),
    slashRun: "/".repeat(1_000_000),
    shortUrls: "//a.b ".repeat(170_000),
    escapedSlashes: "https:\\/\\/a.b\\/".repeat(70_000),
    // The authority-end lookahead fails on each of these and gives the host
    // back one label at a time.
    labelRunThenUserInfo: "//" + "a.".repeat(500_000) + "@",
    shortUserInfoUrls: "//a.b@".repeat(170_000),
  };
  for (const [shape, body] of Object.entries(SHAPES)) {
    it(`is not slowed by: ${shape}`, () => {
      const started = Date.now();
      names(body);
      expect(Date.now() - started).toBeLessThan(2_000);
    });
  }
});

describe("software inventory: GitHub Pages is read from the whole Server value", () => {
  it("lists GitHub Pages for the value GitHub Pages sends", () => {
    expect(names("", new Headers({ Server: "GitHub.com" }))).toContain(
      "GitHub Pages",
    );
  });

  it("does not list it for a Server value that only contains github.com", () => {
    for (const server of [
      "github.com.evil.example",
      "notgithub.com",
      "nginx (proxy for github.com)",
    ]) {
      expect(names("", new Headers({ Server: server }))).not.toContain(
        "GitHub Pages",
      );
    }
  });
});

describe("software inventory: host fingerprints are not regexes over the body", () => {
  // CodeQL's js/regex/missing-regexp-anchor raised #255 to #268 on these
  // literals. Each was a hostname searched for as text; the behaviour tests
  // above are why they are gone, this keeps them from being pasted back.
  const source = readFileSync(
    join(process.cwd(), "lib/scanner/software-inventory.ts"),
    "utf8",
  );
  const removed = [
    String.raw`/cdn\.tailwindcss\.com/i`,
    String.raw`/js\.stripe\.com\/v\d/i`,
    String.raw`google-analytics\.com\/(?:analytics|ga)\.js|googletagmanager\.com\/gtag\/js/i`,
    String.raw`/googletagmanager\.com\/gtm\.js/i`,
    String.raw`/static\.cloudflareinsights\.com/i`,
    String.raw`/challenges\.cloudflare\.com\/turnstile/i`,
    String.raw`/plausible\.io\/js\//i`,
    String.raw`/cdn\.usefathom\.com/i`,
    String.raw`/cdn\.segment\.com\/analytics/i`,
    String.raw`/static\.hotjar\.com/i`,
    String.raw`/cdn\.mxpnl\.com/i`,
    String.raw`/widget\.intercom\.io|js\.intercomcdn\.com/i`,
    String.raw`/hcaptcha\.com\/1\/api\.js/i`,
    String.raw`valueRe: /github\.com/i`,
  ];
  for (const literal of removed) {
    it(`does not contain ${literal}`, () => {
      expect(source).not.toContain(literal);
    });
  }
});
