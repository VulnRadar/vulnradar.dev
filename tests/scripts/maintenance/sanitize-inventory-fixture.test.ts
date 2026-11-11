import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  finalHop,
  maskSecret,
  parseMust,
  reduceBody,
  replaceHost,
  run,
  sanitizeBody,
  sanitizeCapture,
  sanitizeHeaders,
  siteContext,
  stripSiteConfigurationConfig,
} from "../../../scripts/maintenance/sanitize-inventory-fixture.mjs";
import { detect } from "@/lib/scanner/inventory/engine";
import { buildInventoryInput } from "@/lib/scanner/inventory/input";
import type { Fingerprint } from "@/lib/scanner/inventory/types";
import { parseHeadersFile } from "../../lib/scanner/inventory/_fixture-harness";

/**
 * The sanitizer's one job is that nothing which identifies a site or opens a
 * session reaches a committed fixture, while everything a fingerprint rule
 * reads survives. Both halves are tested: a cookie value never comes out, and
 * a Laravel capture still fingerprints as Laravel afterwards.
 */

const URL_ =
  "https://billing.acme-hosting.com/login?next=/secret-path&token=abc";
const SITE = siteContext(URL_);

// 64 characters that would be obvious in any output.
const SECRET = "Zq9".repeat(21) + "Z";
const ENVELOPE = `eyJpdiI6${SECRET}`;

const HEADERS = [
  "HTTP/1.1 302 Found",
  "Location: https://billing.acme-hosting.com/login",
  "Set-Cookie: redirect_only=SHOULDNOTAPPEAR; path=/",
  "",
  "HTTP/2 200",
  "Date: Sat, 31 Oct 2026 20:36:53 GMT",
  "Server: cloudflare",
  'Report-To: {"group":"cf-nel","endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=abc"}]}',
  'Nel: {"report_to":"cf-nel"}',
  "CF-RAY: a535745249969435-MCI",
  "X-Request-Id: 0123456789abcdef0123456789abcdef",
  "Authorization: Bearer topsecrettokenvalue",
  `Set-Cookie: XSRF-TOKEN=${SECRET}; expires=Sat, 31 Oct 2026 22:36:52 GMT; Max-Age=7199; path=/; domain=.acme-hosting.com`,
  `Set-Cookie: acme-hosting-llc-session=${ENVELOPE}; path=/; httponly; samesite=lax`,
  'Link: <https://billing.acme-hosting.com/wp-json/>; rel="https://api.w.org/"',
  "X-Contact: admin@acme-hosting.com from 203.0.113.77",
  "",
].join("\r\n");

describe("siteContext", () => {
  it("finds the registrable domain and its label", () => {
    expect(SITE).toMatchObject({
      host: "billing.acme-hosting.com",
      registrable: "acme-hosting.com",
      label: "acme-hosting",
      path: "/login",
    });
    expect(siteContext("https://www.example.co.uk/x").registrable).toBe(
      "example.co.uk",
    );
    expect(siteContext("https://203.0.113.5/").label).toBe("");
  });
});

describe("maskSecret", () => {
  it("keeps the length and the Laravel envelope prefix", () => {
    expect(maskSecret("abcdef")).toBe("xxxxxx");
    expect(maskSecret(ENVELOPE)).toBe(`eyJpdiI6${"x".repeat(64)}`);
    expect(maskSecret(ENVELOPE)).toHaveLength(ENVELOPE.length);
  });
});

describe("replaceHost", () => {
  it("maps the host, its subdomains and the apex apart so origins keep their shape", () => {
    const text =
      "https://billing.acme-hosting.com/a https://cdn.acme-hosting.com/b https://acme-hosting.com/c ACME-HOSTING.COM";
    expect(replaceHost(text, SITE)).toBe(
      "https://example.test/a https://cdn.example.test/b https://apex.example.test/c apex.example.test",
    );
  });

  it("leaves a longer name that merely contains the domain", () => {
    expect(
      replaceHost("notacme-hosting.com acme-hosting.community", SITE),
    ).toBe("notacme-hosting.com acme-hosting.community");
  });

  it("replaces the apex with the placeholder when the apex is the host", () => {
    const apex = siteContext("https://acme-hosting.com/");
    expect(
      replaceHost("https://acme-hosting.com/x www.acme-hosting.com", apex),
    ).toBe("https://example.test/x www.example.test");
  });

  it("stays fast on a long run of dotted labels", () => {
    const text = "a.".repeat(500_000);
    const started = Date.now();
    replaceHost(text, SITE);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("sanitizeHeaders", () => {
  const out = sanitizeHeaders(HEADERS, SITE);

  it("keeps only the final hop", () => {
    expect(out.startsWith("HTTP/2 200\n")).toBe(true);
    expect(out).not.toContain("redirect_only");
    expect(out).not.toContain("Location:");
  });

  it("never lets a cookie value out, and keeps the cookie names", () => {
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("Zq9");
    expect(out).toContain(
      `acme-hosting-llc-session=eyJpdiI6${"x".repeat(64)};`,
    );
    expect(out).toMatch(/Set-Cookie: XSRF-TOKEN=x{64};/);
  });

  it("drops reporting and credential headers", () => {
    expect(out).not.toMatch(/report-to|nel:|authorization/i);
    expect(out).not.toContain("topsecrettokenvalue");
  });

  it("flattens cf-ray and masks request ids", () => {
    expect(out).toContain("CF-RAY: 0000000000000000-XXX");
    expect(out).not.toContain("0123456789abcdef");
  });

  it("replaces the host, emails and IPs, including a cookie Domain", () => {
    expect(out).not.toContain("acme-hosting.com");
    expect(out).toContain("domain=.apex.example.test");
    expect(out).toContain("X-Contact: user@example.test from 192.0.2.1");
    expect(out).toContain(
      'Link: <https://example.test/wp-json/>; rel="https://api.w.org/"',
    );
  });

  it("keeps the header lines rules read", () => {
    expect(out).toContain("Server: cloudflare");
  });

  it("refuses text with no response in it", () => {
    expect(() => sanitizeHeaders("not headers", SITE)).toThrow(
      /No HTTP response/,
    );
  });

  it("still fingerprints Laravel from what is left", () => {
    const table: Fingerprint[] = [
      {
        name: "Laravel",
        category: "framework",
        rules: [
          {
            in: "cookie",
            name: /[-_]session$/,
            valueMatch: /^eyJpdiI6/,
            weight: 95,
            provenance: "fixture",
          },
        ],
      },
    ];
    const found = detect(
      buildInventoryInput(
        parseHeadersFile(out),
        "",
        "https://example.test/login",
      ),
      table,
    );
    expect(found[0]).toMatchObject({ name: "Laravel", confidence: 95 });
    expect(JSON.stringify(found)).not.toContain("eyJpdiI6");
  });
});

describe("finalHop", () => {
  it("returns an empty string when no block starts with HTTP", () => {
    expect(finalHop("a: b")).toBe("");
  });
});

const BODY = [
  "<!DOCTYPE html>",
  '<html lang="en"><head><title>Sign in</title>',
  '<meta name="csrf-token" content="' + SECRET + '">',
  '<meta name="generator" content="FOSSBilling 0.7.0">',
  '<link rel="stylesheet" href="https://billing.acme-hosting.com/themes/huraga/assets/app.css">',
  '<script src="/livewire-3f8a23f8/livewire.min.js?id=1"></script>',
  "</head><body>",
  "<p>" + "lorem ipsum ".repeat(400) + "</p>",
  '<form method="post" action="https://billing.acme-hosting.com/login"><input type="hidden" name="_token" value="' +
    SECRET +
    '"><input type="text" name="email" value="bob@acme-hosting.com"><input type="password" name="password" value="hunter2"></form>',
  '<script nonce="' +
    SECRET +
    '">window.SiteConfiguration = {"name":"Pterodactyl","extensions":[{"id":"demo","config":{"login_username":"demo","login_password":"pterodactyl-demo","nested":{"a":1}},"screens":[]}]};</script>',
  '<script>var cfg = {"apiKey":"' +
    SECRET +
    '","siteKey":"public-recaptcha-key","token":"abc"};</script>',
  '<img src="/logo@2x.png"><a href="mailto:ops@acme-hosting.com">mail</a>',
  "<p>last paragraph that is far from the top</p>",
  "</body></html>",
].join("\n");

describe("sanitizeBody", () => {
  const out = sanitizeBody(BODY, SITE);

  it("never lets a token, an email, a credential or the host out", () => {
    for (const leaked of [
      SECRET,
      "Zq9",
      "hunter2",
      "bob@",
      "ops@",
      "acme-hosting.com",
      "pterodactyl-demo",
    ]) {
      expect(out, `leaked ${leaked}`).not.toContain(leaked);
    }
  });

  it("keeps the product signals", () => {
    expect(out).toContain(
      '<meta name="generator" content="FOSSBilling 0.7.0">',
    );
    expect(out).toContain("/livewire-3f8a23f8/livewire.min.js?id=1");
    expect(out).toContain('name="_token"');
    expect(out).toContain('"name":"Pterodactyl"');
    expect(out).toContain("/themes/huraga/assets/app.css");
    expect(out).toContain("https://example.test/themes/huraga/assets/app.css");
  });

  it("masks a CSRF meta and a hidden token input but keeps their shape", () => {
    expect(out).toContain(
      `<meta name="csrf-token" content="${"x".repeat(SECRET.length)}">`,
    );
    expect(out).toContain(`name="_token" value="${"x".repeat(SECRET.length)}"`);
  });

  it("masks a nonce and sensitive JSON keys but not a public one", () => {
    expect(out).toContain(`nonce="${"x".repeat(SECRET.length)}"`);
    expect(out).toContain('"siteKey":"public-recaptcha-key"');
    expect(out).toContain('"apiKey":"' + "x".repeat(SECRET.length) + '"');
    expect(out).toContain('"token":"xxx"');
  });

  it("does not take an image name for an email", () => {
    expect(sanitizeBody('<p><img src="/logo@2x.png"></p>', SITE)).toContain(
      "/logo@2x.png",
    );
  });

  it("cuts the body down but keeps the head and every script, link, meta and form", () => {
    expect(out.length).toBeLessThan(BODY.length);
    expect(out).not.toContain("last paragraph");
    expect(out).toContain("<title>Sign in</title>");
    expect(out).toContain("<form ");
  });

  it("ends with exactly one newline", () => {
    expect(out.endsWith("</html>\n")).toBe(true);
  });
});

describe("stripSiteConfigurationConfig", () => {
  it("removes the config object, with nested braces, and keeps the rest", () => {
    const html =
      'window.SiteConfiguration = {"name":"Pterodactyl","x":[{"config":{"a":{"b":"}"},"c":1},"after":true}]};';
    expect(stripSiteConfigurationConfig(html)).toBe(
      'window.SiteConfiguration = {"name":"Pterodactyl","x":[{"config":{},"after":true}]};',
    );
  });

  it("leaves a page with no SiteConfiguration alone", () => {
    expect(stripSiteConfigurationConfig('{"config":{"a":1}}')).toBe(
      '{"config":{"a":1}}',
    );
  });

  it("leaves an unbalanced object alone", () => {
    const html = 'window.SiteConfiguration = {"config":{"a":1';
    expect(stripSiteConfigurationConfig(html)).toBe(html);
  });
});

describe("reduceBody", () => {
  it("keeps the first 2 KB of the body and drops the rest of the prose", () => {
    const out = reduceBody(
      `<html><head></head><body>${"a".repeat(3000)}<p>MARKER</p></body></html>`,
    );
    expect(out).toContain("a".repeat(2048));
    expect(out).not.toContain("a".repeat(2049));
    expect(out).not.toContain("MARKER");
  });

  it("keeps hidden inputs but not other inputs", () => {
    const out = reduceBody(
      `<html><head></head><body>${"a".repeat(3000)}<input type="hidden" name="h"><input type="text" name="t"></body></html>`,
    );
    expect(out).toContain('name="h"');
    expect(out).not.toContain('name="t"');
  });

  it("keeps the first 4 KB of an inline script and closes it", () => {
    const out = reduceBody(
      `<html><head></head><body>${"a".repeat(3000)}<script>${"b".repeat(9000)}</script></body></html>`,
    );
    expect(out).toContain("b".repeat(4096));
    expect(out).not.toContain("b".repeat(4097));
  });

  it("works on a page with no head or body", () => {
    expect(reduceBody('<script src="/a.js"></script><p>hi</p>')).toContain(
      "/a.js",
    );
  });

  it("stays fast on hostile markup", () => {
    for (const body of [
      "<".repeat(1_048_576),
      "<script>".repeat(130_000),
      "eyJ".repeat(350_000),
    ]) {
      const started = Date.now();
      sanitizeBody(body, SITE);
      expect(Date.now() - started).toBeLessThan(3_000);
    }
  });
});

describe("parseMust", () => {
  it("reads a name with and without a confidence", () => {
    expect(parseMust("Laravel:95")).toEqual({
      name: "Laravel",
      minConfidence: 95,
    });
    expect(parseMust("PHP")).toEqual({ name: "PHP" });
  });

  it("rejects a confidence that is not a whole number from 1 to 100", () => {
    expect(() => parseMust("Laravel:0")).toThrow(/whole number/);
    expect(() => parseMust("Laravel:abc")).toThrow(/whole number/);
    expect(() => parseMust(":90")).toThrow(/names no product/);
  });
});

describe("sanitizeCapture", () => {
  const base = { headersText: HEADERS, bodyHtml: BODY, url: URL_ };

  it("writes the expectation with the placeholder host and no query", () => {
    const { expect: json } = sanitizeCapture({
      ...base,
      slug: "laravel-livewire-billing-portal",
      capturedAt: "2026-10-31",
      must: [{ name: "Laravel", minConfidence: 95 }],
    });
    expect(JSON.parse(json)).toEqual({
      kind: "real",
      capturedAt: "2026-10-31",
      url: "https://example.test/login",
      must: [{ name: "Laravel", minConfidence: 95 }],
      mustNot: [],
    });
  });

  it("refuses a slug that names the customer", () => {
    expect(() =>
      sanitizeCapture({ ...base, slug: "acme-hosting-panel" }),
    ).toThrow(/name of the site/);
  });

  it("accepts a slug that names the site when told it is the product's own demo", () => {
    expect(() =>
      sanitizeCapture({
        ...base,
        slug: "acme-hosting-panel",
        allowSiteName: true,
      }),
    ).not.toThrow();
  });

  it("refuses a malformed slug, kind and date", () => {
    expect(() => sanitizeCapture({ ...base, slug: "Bad Slug" })).toThrow(
      /lowercase/,
    );
    expect(() =>
      sanitizeCapture({ ...base, slug: "ok", kind: "fake" }),
    ).toThrow(/--kind/);
    expect(() =>
      sanitizeCapture({ ...base, slug: "ok", capturedAt: "yesterday" }),
    ).toThrow(/--captured-at/);
  });
});

describe("run", () => {
  let dir: string;
  const logs: string[] = [];
  const errors: string[] = [];
  const io = {
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "inventory-fixture-"));
    writeFileSync(path.join(dir, "h.txt"), HEADERS);
    writeFileSync(path.join(dir, "b.html"), BODY);
    logs.length = 0;
    errors.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const args = (extra: string[] = []) => [
    "--headers",
    path.join(dir, "h.txt"),
    "--body",
    path.join(dir, "b.html"),
    "--url",
    URL_,
    "--slug",
    "laravel-billing-portal",
    "--captured-at",
    "2026-10-31",
    "--out",
    path.join(dir, "out"),
    ...extra,
  ];

  it("writes the three files and none of them holds a cookie value", () => {
    expect(
      run(args(["--must", "Laravel:95", "--must-not", "WordPress"]), io),
    ).toBe(0);
    const written = path.join(dir, "out", "laravel-billing-portal");
    expect(readdirSync(written).sort()).toEqual([
      "body.html",
      "expect.json",
      "headers.txt",
    ]);
    for (const file of readdirSync(written)) {
      const text = readFileSync(path.join(written, file), "utf8");
      expect(text, file).not.toContain(SECRET);
      expect(text, file).not.toContain("acme-hosting.com");
    }
    expect(
      JSON.parse(readFileSync(path.join(written, "expect.json"), "utf8"))
        .mustNot,
    ).toEqual(["WordPress"]);
  });

  it("does not overwrite without --force", () => {
    expect(run(args(), io)).toBe(0);
    expect(run(args(), io)).toBe(1);
    expect(errors.join("\n")).toContain("already exists");
    expect(run(args(["--force"]), io)).toBe(0);
  });

  it("writes nothing on --dry-run", () => {
    expect(run(args(["--dry-run"]), io)).toBe(0);
    expect(existsSync(path.join(dir, "out"))).toBe(false);
  });

  it("reminds the author when must is empty", () => {
    run(args(), io);
    expect(logs.join("\n")).toContain("no `must` entries");
  });

  it("reports a missing argument and an unknown flag without throwing", () => {
    expect(run(["--slug", "x"], io)).toBe(1);
    expect(errors.join("\n")).toContain("Missing --headers");
    expect(run(["--nope"], io)).toBe(1);
  });
});
