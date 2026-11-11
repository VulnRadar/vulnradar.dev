/**
 * The SRI policy: one classifier deciding whose resource a URL is and whether
 * a hash could pin it, read by every detector this file names.
 *
 * Two ways the old detectors were wrong, both from real scans. None of them
 * compared the resource with the page, so a site writing its own assets as
 * absolute URLs (Moodle does, with the default port) was reported for not
 * hashing its own files. And "CDN" was a substring test on the hostname, so
 * `stripecdn.com` counted because it contains `cdn.`, and stripe.com was told
 * it loads "81 CDN scripts".
 *
 * The SRIn and EVn names are the fixtures the research measured on real
 * engine output, kept so a regression reads against that record.
 */

import { describe, expect, it } from "vitest";
import {
  SRI_EXEMPT_HOSTS,
  classifySubresource,
  integrityGapEvidence,
  needsIntegrity,
  pinnedCdnScriptsWithoutIntegrity,
} from "@/lib/scanner/checks/_subresource";
import { SRI_EXEMPT_HOSTS as REEXPORTED } from "@/lib/scanner/checks/client-side";
import { checkIdOf } from "@/lib/scanner/dedupe";
import { runSyncChecks } from "@/lib/scanner/engine";

const PAGE = "https://example.com/";

describe("classifySubresource", () => {
  it.each([
    ["a root-relative path", "/assets/app.js"],
    ["a relative path", "app.js"],
    ["the default port written out", "https://example.com:443/lib/app.js"],
    ["a protocol-relative URL to the page host", "//example.com/a.js"],
  ])("%s is same-origin", (_name, url) => {
    expect(classifySubresource(url, PAGE)).toBe("same-origin");
  });

  it.each([
    ["www on the resource", "https://www.example.com/a.js", PAGE],
    ["www on the page", "https://example.com/a.js", "https://www.example.com/"],
    ["the site's own CDN subdomain", "https://cdn.example.com/a.js", PAGE],
    ["the same host on another scheme", "http://example.com/a.js", PAGE],
    ["a non-default port", "https://example.com:8443/a.js", PAGE],
    [
      "a subdomain under a two-label suffix",
      "https://static.shop.co.uk/a.js",
      "https://www.shop.co.uk/",
    ],
    [
      "a subdomain under a suffix the root-domain table does not list",
      "https://static.shop.com.sg/a.js",
      "https://www.shop.com.sg/",
    ],
  ])("%s is same-site", (_name, url, page) => {
    expect(classifySubresource(url, page)).toBe("same-site");
  });

  describe("does not call strangers the same site", () => {
    it.each([
      ["blogspot", "https://b.blogspot.com/a.js", "https://a.blogspot.com/"],
      ["github.io", "https://b.github.io/a.js", "https://a.github.io/"],
      ["vercel.app", "https://b.vercel.app/a.js", "https://a.vercel.app/"],
      ["myshopify", "https://b.myshopify.com/a.js", "https://a.myshopify.com/"],
      [
        "cloudfront",
        "https://b.cloudfront.net/a.js",
        "https://a.cloudfront.net/",
      ],
      ["lovable.app", "https://b.lovable.app/a.js", "https://a.lovable.app/"],
      [
        "mysellauth",
        "https://b.mysellauth.com/a.js",
        "https://a.mysellauth.com/",
      ],
      ["carrd.co", "https://b.carrd.co/a.js", "https://a.carrd.co/"],
      ["notion.site", "https://b.notion.site/a.js", "https://a.notion.site/"],
      [
        "wordpress.com",
        "https://b.wordpress.com/a.js",
        "https://a.wordpress.com/",
      ],
      ["a public com.sg", "https://evil.com.sg/a.js", "https://shop.com.sg/"],
      ["two IP addresses", "https://10.0.0.2/a.js", "https://192.168.0.2/"],
      ["single-label names", "http://intranet/a.js", "http://localhost/"],
      ["a lookalike suffix", "https://example.com.evil.net/a.js", PAGE],
      ["a lookalike prefix", "https://notexample.com/a.js", PAGE],
    ])("%s", (_name, url, page) => {
      expect(classifySubresource(url, page)).toBe("third-party");
    });

    it("still recognises one tenant on a shared host as itself", () => {
      expect(
        classifySubresource(
          "https://www.acme.github.io/a.js",
          "https://acme.github.io/",
        ),
      ).toBe("same-site");
    });
  });

  it.each([
    "https://www.googletagmanager.com/gtag/js?id=G-XXXX",
    "https://maps.googleapis.com/maps/api/js",
    "https://maps.gstatic.com/a.js",
    "https://apis.google.com/js/api.js",
    "https://www.recaptcha.net/recaptcha/api.js",
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
    "https://js.hcaptcha.com/1/api.js",
    "https://js.stripe.com/v3/",
    "https://fonts.googleapis.com/css2?family=Inter&display=swap",
    "https://use.typekit.net/abc.css",
  ])("%s is an exempt vendor", (url) => {
    expect(classifySubresource(url, PAGE)).toBe("exempt-vendor");
  });

  it.each([
    "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
    "https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js",
    "https://cdn.jsdelivr.net/npm/mathjax@2.7.9/MathJax.js?delayStartupUntil=configured",
    "https://cdn.jsdelivr.net/npm/left-pad@1.3.0",
    "https://cdn.jsdelivr.net/npm/thing@1.2.3-beta.1/x.js",
    "https://cdn.jsdelivr.net/gh/user/repo@v1.2.3/x.js",
    "https://fastly.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
    "https://unpkg.com/@babel/standalone@7.26.4/babel.min.js",
    "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js",
    "https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js",
    "https://code.jquery.com/jquery-3.7.1.min.js",
    "https://code.jquery.com/ui/1.13.2/jquery-ui.min.js",
    "https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js",
    "https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/js/bootstrap.min.js",
    "//cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js",
    "https://cdn.jsdelivr.net/combine/npm/a@1.2.3,npm/@scope/b@4.5.6",
  ])("%s is a pinned library CDN", (url) => {
    expect(classifySubresource(url, PAGE)).toBe("library-cdn-pinned");
  });

  describe("a library CDN without an exact version is not pinned", () => {
    it.each([
      "https://cdn.jsdelivr.net/npm/lodash/lodash.min.js",
      "https://cdn.jsdelivr.net/npm/lodash@latest/lodash.min.js",
      "https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js",
      "https://cdn.jsdelivr.net/npm/lodash@4.17/lodash.min.js",
      "https://cdn.jsdelivr.net/npm/lodash@latest/dist-1.2.3/lodash.min.js",
      "https://cdn.jsdelivr.net/npm/lodash@latest/vendor@1.2.3/lodash.min.js",
      "https://unpkg.com/react/vendor@1.2.3/index.js",
      "https://cdn.jsdelivr.net/combine/npm/a@1,npm/b@1.2.3",
      "https://cdn.jsdelivr.net/combine/npm/a@1.2.3,npm/b@latest",
      "https://cdn.jsdelivr.net/npm/widget-1.2.3/index.js",
      "https://cdn.jsdelivr.net/gh/user/repo@main/x.js",
      "https://unpkg.com/react",
      "https://cdnjs.cloudflare.com/ajax/libs/jquery/3/jquery.min.js",
      "https://code.jquery.com/jquery-latest.min.js",
    ])("%s", (url) => {
      expect(classifySubresource(url, PAGE)).toBe("third-party");
    });
  });

  describe("a host is only a library CDN if it is that host", () => {
    it.each([
      "https://b.stripecdn.com/a@1.2.3/a.js",
      "https://assets.acmecdn.com/1.2.3/app.js",
      "https://cdn.some-random-vendor.com/1.2.3/widget.js",
      "https://unpkg.com.evil.net/lodash@4.17.21/lodash.js",
      "https://evilunpkg.com/lodash@4.17.21/lodash.js",
      "https://cdn.jsdelivr.net.evil.net/npm/lodash@4.17.21/lodash.js",
      "https://evilbootstrapcdn.com/bootstrap/4.5.2/b.js",
      "https://cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js",
    ])("%s", (url) => {
      expect(classifySubresource(url, PAGE)).toBe("third-party");
    });
  });

  it("the page's own origin outranks every list", () => {
    expect(
      classifySubresource(
        "https://unpkg.com/lodash@4.17.21/lodash.js",
        "https://unpkg.com/",
      ),
    ).toBe("same-origin");
    expect(
      classifySubresource(
        "https://js.stripe.com/v3/",
        "https://dashboard.stripe.com/",
      ),
    ).toBe("same-site");
  });

  it.each([
    ["a data: URI", "data:text/javascript,alert(1)", PAGE],
    ["a blob: URL", "blob:https://example.com/uuid", PAGE],
    ["javascript:", "javascript:void(0)", PAGE],
    ["an out-of-range port", "https://example.com:99999/a.js", PAGE],
    ["an unusable page URL", "/a.js", "not a url"],
    ["an empty page URL", "https://cdn.other.com/a.js", ""],
  ])("%s has no class", (_name, url, page) => {
    expect(classifySubresource(url, page)).toBeNull();
  });
});

describe("the exempt list", () => {
  it("is the one list, still importable from where headers.ts reads it", () => {
    expect(REEXPORTED).toBe(SRI_EXEMPT_HOSTS);
  });
});

describe("needsIntegrity", () => {
  it("is true only where a missing hash is worth saying anything about", () => {
    expect(needsIntegrity("library-cdn-pinned")).toBe(true);
    expect(needsIntegrity("third-party")).toBe(true);
    expect(needsIntegrity("same-origin")).toBe(false);
    expect(needsIntegrity("same-site")).toBe(false);
    expect(needsIntegrity("exempt-vendor")).toBe(false);
    expect(needsIntegrity(null)).toBe(false);
  });
});

describe("integrityGapEvidence", () => {
  const urls = ["https://a.test/1", "https://a.test/2", "https://a.test/3"];

  it("names one URL and gets the noun right", () => {
    expect(integrityGapEvidence("third-party script", [urls[0]])).toBe(
      "1 third-party script without integrity: https://a.test/1",
    );
  });

  it("names up to three without an 'and more'", () => {
    expect(integrityGapEvidence("third-party script", urls)).toBe(
      "3 third-party scripts without integrity: https://a.test/1, https://a.test/2, https://a.test/3",
    );
  });

  it("caps at three and counts the rest", () => {
    expect(
      integrityGapEvidence("third-party script", [
        ...urls,
        "https://a.test/4",
        "https://a.test/5",
      ]),
    ).toBe(
      "5 third-party scripts without integrity: https://a.test/1, https://a.test/2, https://a.test/3 and 2 more",
    );
  });

  it("shortens a URL long enough to swamp the finding", () => {
    const long = `https://a.test/${"x".repeat(600)}`;
    const evidence = integrityGapEvidence("third-party script", [long]);
    expect(evidence.length).toBeLessThan(300);
    expect(evidence).toContain("https://a.test/xxx");
  });
});

describe("pinnedCdnScriptsWithoutIntegrity", () => {
  const pinned = "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js";

  it("returns the absolute URL, once, for a repeated protocol-relative tag", () => {
    expect(
      pinnedCdnScriptsWithoutIntegrity(
        `<script src="//cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>
         <script src="//cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>`,
        PAGE,
      ),
    ).toEqual([pinned]);
  });

  it("reads the attribute whole, so data-src and data-integrity are not it", () => {
    expect(
      pinnedCdnScriptsWithoutIntegrity(
        `<script data-src="${pinned}"></script>`,
        PAGE,
      ),
    ).toEqual([]);
    expect(
      pinnedCdnScriptsWithoutIntegrity(
        `<script src="${pinned}" data-integrity="sha384-abc"></script>`,
        PAGE,
      ),
    ).toEqual([pinned]);
  });

  it("does not take an empty integrity attribute as a hash", () => {
    expect(
      pinnedCdnScriptsWithoutIntegrity(
        `<script src="${pinned}" integrity=""></script>`,
        PAGE,
      ),
    ).toEqual([pinned]);
  });

  it("accepts an unquoted src", () => {
    expect(
      pinnedCdnScriptsWithoutIntegrity(`<script src=${pinned}></script>`, PAGE),
    ).toEqual([pinned]);
  });
});

/** What the engine reports for a page, by check id, after dedupe. */
function ran(url: string, inner: string, head = ""): Map<string, string> {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>t</title>${head}</head><body>${inner}</body></html>`;
  const { findings } = runSyncChecks(
    url,
    new Headers({ "content-type": "text/html" }),
    body,
  );
  const out = new Map<string, string>();
  for (const f of findings) {
    out.set(checkIdOf(f), f.severity);
    for (const also of f.alsoReportedBy ?? []) out.set(also, f.severity);
  }
  return out;
}

/** The detectors this policy owns. sri-missing and sri-stylesheet-missing in
 *  headers.ts move onto the classifier in their own change. */
const MEDIUM = [
  "third-party-script-no-sri",
  "supply-chain-sri-external-script",
];
const LOW_SCRIPT = "page-script-missing-sri";
const LOW_STYLE = "page-stylesheet-missing-sri";
const CSP_COMBO = "page-third-party-script-unconstrained-by-csp";
const ALL = [...MEDIUM, LOW_SCRIPT, LOW_STYLE, CSP_COMBO];

function expectSilent(found: Map<string, string>, ids: string[]): void {
  expect(ids.filter((id) => found.has(id))).toEqual([]);
}

describe("research fixtures through the real engine", () => {
  it("SRI1: a first-party absolute URL with :443 is the site's own file", () => {
    expectSilent(
      ran(
        "https://example.com/",
        `<script src="https://example.com:443/lib/app.js"></script><link rel="stylesheet" href="https://example.com:443/theme.css">`,
      ),
      ALL,
    );
  });

  it("SRI2: a pinned jsdelivr library without integrity stays medium", () => {
    const found = ran(
      "https://example.com/",
      `<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>`,
    );
    expect(found.get("supply-chain-sri-external-script")).toBe("medium");
    expect(found.get("third-party-script-no-sri")).toBe("medium");
    expect(found.has(CSP_COMBO)).toBe(true);
  });

  it("SRI3: a pinned library with integrity is silent", () => {
    expectSilent(
      ran(
        "https://example.com/",
        `<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js" integrity="sha384-abc" crossorigin="anonymous"></script>`,
      ),
      ALL,
    );
  });

  it("SRI4: Google Fonts CSS differs per browser, so no hash can pin it", () => {
    expectSilent(
      ran(
        "https://example.com/",
        "",
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">`,
      ),
      ALL,
    );
  });

  it("SRI5: the Maps API is exempt in every detector, not just some", () => {
    expectSilent(
      ran(
        "https://example.com/",
        `<script src="https://maps.googleapis.com/maps/api/js?key=abc"></script>`,
      ),
      ALL,
    );
  });

  it("SRI6: Tag Manager is exempt in the page checks too", () => {
    expectSilent(
      ran(
        "https://example.com/",
        `<script src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>`,
      ),
      ALL,
    );
  });

  it("SRI7: the site's own CDN subdomain is not a third party", () => {
    expectSilent(
      ran(
        "https://example.com/",
        `<script src="https://cdn.example.com/app.abc123.js"></script>`,
      ),
      ALL,
    );
  });

  it("SRI8: a host with cdn in its name is no longer a library CDN", () => {
    const found = ran(
      "https://acme.com/",
      `<script src="https://assets.acmecdn.com/app.js"></script>`,
    );
    expectSilent(found, MEDIUM);
    expect(found.has(LOW_SCRIPT)).toBe(true);
  });

  it("stripe.com's own asset host does not count as a library CDN", () => {
    const found = ran(
      "https://stripe.com/",
      `<script src="https://b.stripecdn.com/site-statics/1.2.3/a.js"></script>`,
    );
    expectSilent(found, MEDIUM);
  });

  it("SRI9: a pinned cdnjs library without integrity fires", () => {
    const found = ran(
      "https://example.com/",
      `<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>`,
    );
    expect(found.get("supply-chain-sri-external-script")).toBe("medium");
  });

  it("a pinned unpkg library without integrity fires", () => {
    const found = ran(
      "https://example.com/",
      `<script src="https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"></script>`,
    );
    expect(found.get("third-party-script-no-sri")).toBe("medium");
  });

  it("a protocol-relative pinned library is seen, which https?:// never did", () => {
    const found = ran(
      "https://example.com/",
      `<script src="//cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script>`,
    );
    expect(found.get("supply-chain-sri-external-script")).toBe("medium");
  });

  it("an unknown vendor is low, never the 'you could have pinned it' medium", () => {
    const found = ran(
      "https://example.com/",
      `<script src="https://cdn.some-random-vendor.com/widget.js"></script>`,
    );
    expectSilent(found, MEDIUM);
    expect(found.has(LOW_SCRIPT)).toBe(true);
  });

  it("www and protocol-relative spellings of the page host are silent", () => {
    expectSilent(
      ran(
        "https://example.com/",
        `<script src="https://www.example.com/a.js"></script><script src="//example.com/b.js"></script>`,
      ),
      ALL,
    );
  });

  it("a stylesheet gap is no longer absorbed by a script gap", () => {
    const { findings } = runSyncChecks(
      "https://example.com/",
      new Headers({ "content-type": "text/html" }),
      `<html><body><script src="https://cdn.other.com/a.js"></script><link rel="stylesheet" href="https://cdn.other.com/a.css"></body></html>`,
    );
    const scriptGroup = findings.find((f) => {
      const ids = [checkIdOf(f), ...(f.alsoReportedBy ?? [])];
      return ids.includes(LOW_SCRIPT);
    });
    expect(scriptGroup).toBeDefined();
    expect([
      checkIdOf(scriptGroup!),
      ...(scriptGroup!.alsoReportedBy ?? []),
    ]).not.toContain(LOW_STYLE);
    expect(findings.some((f) => checkIdOf(f) === LOW_STYLE)).toBe(true);
  });
});

describe("eval fixtures through the real engine", () => {
  const evalCheck = "eval-in-client-script";

  it("EV1: eval of a constant string, the bundler's hidden require, is silent", () => {
    expect(
      ran(
        "https://example.com/",
        `<script>var h=eval("require('crypto')");</script>`,
      ).has(evalCheck),
    ).toBe(false);
  });

  it("EV2: eval of the URL fragment fires", () => {
    expect(
      ran(
        "https://example.com/",
        `<script>eval(decodeURIComponent(location.hash.slice(1)))</script>`,
      ).has(evalCheck),
    ).toBe(true);
  });

  it("EV3: eval of a variable fires", () => {
    expect(
      ran("https://example.com/", `<script>var x=getIt();eval(x)</script>`).has(
        evalCheck,
      ),
    ).toBe(true);
  });

  it("EV4: new Function over concatenated data fires", () => {
    expect(
      ran(
        "https://example.com/",
        `<script>new Function("return "+data)()</script>`,
      ).has(evalCheck),
    ).toBe(true);
  });
});
