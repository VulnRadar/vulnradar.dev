import { describe, it, expect, afterAll } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GOOGLEBOT_UA,
  baseOriginOf,
  checkSite,
  decodeEntities,
  judge,
  main,
  parsePage,
  parseRobots,
  robotsAllows,
} from "../../../../scripts/ci/site-checks/check-site.mjs";

/**
 * scripts/ci/site-checks/check-site.mjs runs against the app the CI job booted,
 * and nothing else. These tests run it against a stand-in site on 127.0.0.1
 * with one good page and one bad page per rule, so a rule that stopped firing
 * (or one that fires on a page that is fine) is caught here and not by a
 * green job that checked nothing.
 */

const SITE = "https://site.example.test";
const DIR = mkdtempSync(path.join(tmpdir(), "vr-check-site-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const DESCRIPTION =
  "A description that is long enough to be useful in a search result, and short enough to fit.";

interface PageOptions {
  title?: string | null;
  titleCount?: number;
  description?: string | null;
  canonical?: string | null;
  robots?: string;
  og?: boolean;
  image?: string;
  jsonLd?: string | null;
  h1?: number;
  titleInBody?: boolean;
  links?: string[];
}

function page(urlPath: string, o: PageOptions = {}): string {
  const loc = `${SITE}${urlPath}`;
  const title = o.title === undefined ? `Page ${urlPath}` : o.title;
  const description = o.description === undefined ? DESCRIPTION : o.description;
  const canonical = o.canonical === undefined ? loc : o.canonical;
  const og = o.og ?? true;
  const jsonLd =
    o.jsonLd === undefined
      ? JSON.stringify({ "@type": "WebPage", url: loc })
      : o.jsonLd;
  const titles = Array.from(
    { length: o.titleCount ?? (title === null ? 0 : 1) },
    () => `<title>${title}</title>`,
  ).join("");
  return [
    "<!doctype html><html><head>",
    titles,
    description === null
      ? ""
      : `<meta name="description" content="${description}">`,
    canonical === null ? "" : `<link rel="canonical" href="${canonical}">`,
    o.robots ? `<meta name="robots" content="${o.robots}">` : "",
    og
      ? [
          `<meta property="og:title" content="t">`,
          `<meta property="og:description" content="d">`,
          `<meta property="og:image" content="${o.image ?? `${SITE}/og.png`}">`,
          `<meta property="og:url" content="${loc}">`,
          `<meta name="twitter:card" content="summary_large_image">`,
        ].join("")
      : "",
    jsonLd === null
      ? ""
      : `<script type="application/ld+json">${jsonLd}</script>`,
    "</head><body>",
    o.titleInBody ? "<title>late</title>" : "",
    "<svg><title>An icon</title></svg>",
    ...Array.from({ length: o.h1 ?? 1 }, () => "<h1>Heading</h1>"),
    ...(o.links ?? []).map((href) => `<a href="${href}">link</a>`),
    "</body></html>",
  ].join("");
}

interface Site {
  base: string;
  hits: { url: string; ua: string; method: string }[];
  close: () => Promise<void>;
}

async function serve(
  pages: Record<
    string,
    | string
    | ((req: IncomingMessage) => {
        status?: number;
        headers?: Record<string, string>;
        body?: string;
      })
  >,
  { robots, sitemapPaths }: { robots?: string; sitemapPaths?: string[] } = {},
): Promise<Site> {
  const hits: Site["hits"] = [];
  const listed =
    sitemapPaths ??
    Object.keys(pages).filter(
      (p) =>
        !["/dashboard", "/admin", "/history", "/profile", "/og.png"].includes(
          p,
        ),
    );
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    hits.push({
      url,
      ua: String(req.headers["user-agent"] ?? ""),
      method: req.method ?? "",
    });
    const send = (
      status: number,
      headers: Record<string, string>,
      body: string,
    ) => {
      res.writeHead(status, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (url === "/robots.txt") {
      return send(
        200,
        { "content-type": "text/plain" },
        robots ??
          `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`,
      );
    }
    if (url === "/sitemap.xml") {
      const body = `<?xml version="1.0"?><urlset>${listed.map((p) => `<url><loc>${SITE}${p}</loc><lastmod>2026-11-01</lastmod></url>`).join("")}</urlset>`;
      return send(200, { "content-type": "application/xml" }, body);
    }
    if (url === "/og.png")
      return send(200, { "content-type": "image/png" }, "png");
    const entry = pages[url.split("?")[0]];
    if (entry === undefined)
      return send(404, { "content-type": "text/html" }, "missing");
    if (typeof entry === "string")
      return send(200, { "content-type": "text/html" }, entry);
    const out = entry(req);
    return send(
      out.status ?? 200,
      { "content-type": "text/html", ...out.headers },
      out.body ?? "",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const PRIVATE_OK = {
  "/dashboard": () => ({ status: 307, headers: { location: "/login" } }),
  "/admin": () => ({ status: 307, headers: { location: "/login" } }),
  "/history": () => ({
    status: 200,
    body: page("/history", { robots: "noindex, nofollow" }),
  }),
  "/profile": () => ({ status: 307, headers: { location: "/login" } }),
};

const good = () => ({
  "/": page("/", { links: ["/good", "/other"] }),
  "/good": page("/good"),
  "/other": page("/other", {
    links: ["/", "#top", "mailto:a@b.test", "https://elsewhere.invalid/x"],
  }),
  ...PRIVATE_OK,
});

async function run(
  pages: Parameters<typeof serve>[0],
  options?: Parameters<typeof serve>[1],
) {
  const site = await serve(pages, options);
  try {
    const result = await checkSite({ base: site.base, concurrency: 3 });
    return { result, site };
  } finally {
    await site.close();
  }
}

const has = (
  findings: { page: string; rule: string }[],
  page: string,
  rule: string,
) => findings.some((f) => f.page === page && f.rule === rule);

describe("a site that is fine", () => {
  it("has no findings, checks every sitemap page and fetches Googlebot's copy", async () => {
    const { result, site } = await run(good());
    expect(result.findings).toEqual([]);
    expect(result.pages).toBe(3);
    expect(
      site.hits.some((h) => h.ua === GOOGLEBOT_UA && h.url === "/good"),
    ).toBe(true);
  });
});

describe("one bad page per rule", () => {
  const bad: [string, PageOptions, string][] = [
    ["/no-title", { title: null }, "title"],
    ["/two-titles", { titleCount: 2 }, "title"],
    ["/title-late", { titleInBody: true }, "head-metadata-in-body"],
    ["/short-description", { description: "Too short." }, "description"],
    ["/no-description", { description: null }, "description"],
    ["/wrong-canonical", { canonical: `${SITE}/elsewhere` }, "canonical"],
    ["/relative-canonical", { canonical: "/relative-canonical" }, "canonical"],
    ["/no-canonical", { canonical: null }, "canonical"],
    ["/hidden", { robots: "noindex" }, "noindex"],
    ["/no-og", { og: false }, "og"],
    ["/dead-image", { image: `${SITE}/gone.png` }, "og-image"],
    ["/broken-ld", { jsonLd: "{not json" }, "json-ld"],
    [
      "/other-ld",
      { jsonLd: JSON.stringify({ url: `${SITE}/another` }) },
      "json-ld",
    ],
    ["/no-ld", { jsonLd: null }, "json-ld"],
    ["/two-h1", { h1: 2 }, "h1"],
    ["/no-h1", { h1: 0 }, "h1"],
  ];

  it.each(bad)("%s is reported as %s", async (urlPath, options, rule) => {
    const pages = { ...good(), [urlPath]: page(urlPath, options) };
    const { result } = await run(pages);
    expect(
      has(result.findings, urlPath, rule),
      JSON.stringify(result.findings),
    ).toBe(true);
    // And the good pages stay clean next to it.
    expect(result.findings.filter((f) => f.page === "/good")).toEqual([]);
  });

  it("reports a title two pages share on the later path only", async () => {
    const pages = {
      ...good(),
      "/a": page("/a", { title: "Same" }),
      "/b": page("/b", { title: "Same" }),
    };
    const { result } = await run(pages);
    expect(has(result.findings, "/b", "title-unique")).toBe(true);
    expect(has(result.findings, "/a", "title-unique")).toBe(false);
  });

  it("reports a sitemap URL that redirects or is missing, without following it", async () => {
    const pages = {
      ...good(),
      "/moved": () => ({
        status: 308,
        headers: { location: "https://elsewhere.invalid/" },
      }),
    };
    const { result, site } = await run(pages, {
      sitemapPaths: ["/", "/good", "/moved", "/nowhere"],
    });
    expect(has(result.findings, "/moved", "status")).toBe(true);
    expect(has(result.findings, "/nowhere", "status")).toBe(true);
    expect(site.hits.every((h) => !h.url.includes("elsewhere"))).toBe(true);
  });

  it("reports the head metadata Googlebot is served in the body", async () => {
    const pages = {
      ...good(),
      "/streamed": (req: IncomingMessage) => ({
        body: String(req.headers["user-agent"]).includes("Googlebot")
          ? page("/streamed", {
              title: null,
              canonical: null,
              description: null,
              titleInBody: true,
            })
          : page("/streamed"),
      }),
    };
    const { result } = await run(pages);
    expect(has(result.findings, "/streamed", "googlebot")).toBe(true);
    expect(has(result.findings, "/streamed", "title")).toBe(false);
  });

  it("reports a broken same-origin link once, by its target, and never fetches an external one", async () => {
    const pages = {
      ...good(),
      "/links": page("/links", {
        links: [
          "/missing",
          "/missing#x",
          "https://evil.invalid/p",
          `http://127.0.0.1:1/other`,
        ],
      }),
    };
    const { result, site } = await run(pages);
    expect(result.findings.filter((f) => f.rule === "link-broken")).toEqual([
      expect.objectContaining({ page: "/missing" }),
    ]);
    expect(site.hits.every((h) => !h.url.includes("evil"))).toBe(true);
  });

  it("reports a private page that answers 200 with no noindex", async () => {
    const pages = { ...good(), "/profile": page("/profile") };
    const { result } = await run(pages);
    expect(has(result.findings, "/profile", "private-page-indexable")).toBe(
      true,
    );
    expect(has(result.findings, "/history", "private-page-indexable")).toBe(
      false,
    );
  });
});

describe("robots.txt and the sitemap", () => {
  it("reports a missing Sitemap line and a disallow-all", async () => {
    const { result } = await run(good(), {
      robots: "User-agent: *\nDisallow: /\n",
    });
    expect(has(result.findings, "/robots.txt", "robots-sitemap-line")).toBe(
      true,
    );
    expect(has(result.findings, "/robots.txt", "robots-disallow-all")).toBe(
      true,
    );
    expect(has(result.findings, "/good", "robots-disallows-sitemap-url")).toBe(
      true,
    );
  });

  it("reports a sitemap URL the longest matching rule disallows, and honours an Allow that is longer", async () => {
    const robots =
      "User-agent: *\nDisallow: /good\nDisallow: /other\nAllow: /other\nSitemap: x\n";
    const { result } = await run(good(), { robots });
    expect(has(result.findings, "/good", "robots-disallows-sitemap-url")).toBe(
      true,
    );
    expect(has(result.findings, "/other", "robots-disallows-sitemap-url")).toBe(
      false,
    );
  });

  it("reports a duplicate entry", async () => {
    const { result } = await run(good(), {
      sitemapPaths: ["/", "/good", "/good", "/other"],
    });
    expect(has(result.findings, "/sitemap.xml", "sitemap-duplicate")).toBe(
      true,
    );
  });
});

describe("what it will request", () => {
  it("refuses a base that is not a loopback address, before any request", async () => {
    const calls: string[] = [];
    await expect(
      checkSite({
        base: "https://vulnradar.dev",
        fetchImpl: (async (url: unknown) => {
          calls.push(String(url));
          return new Response("x");
        }) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/loopback/);
    expect(calls).toEqual([]);
    expect(() => baseOriginOf("http://192.168.1.5:3000")).toThrow(/loopback/);
    expect(() => baseOriginOf("ftp://localhost")).toThrow(/http or https/);
    expect(baseOriginOf("http://localhost:3000/ignored/path")).toBe(
      "http://localhost:3000",
    );
    expect(baseOriginOf("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("sends every request to --base, whatever the pages name", async () => {
    const seen: string[] = [];
    const site = await serve({
      ...good(),
      "/hostile": page("/hostile", {
        image: "https://evil.invalid/og.png",
        links: [
          "https://evil.invalid/",
          "//evil.invalid/x",
          "http://127.0.0.1:9/y",
        ],
      }),
    });
    try {
      await checkSite({
        base: site.base,
        fetchImpl: (async (url: URL, init: RequestInit) => {
          seen.push(url.origin);
          return fetch(url, init);
        }) as unknown as typeof fetch,
      });
    } finally {
      await site.close();
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(new Set(seen)).toEqual(new Set([site.base]));
  });
});

describe("the baseline", () => {
  const finding = { page: "/x", rule: "title", message: "m" };

  it("lets a baselined finding through and counts it", () => {
    const v = judge(
      [finding],
      [{ page: "/x", rule: "title", reason: "known" }],
    );
    expect(v.unexpected).toEqual([]);
    expect(v.accepted).toBe(1);
  });

  it("fails a finding that is not in it", () => {
    expect(judge([finding], []).unexpected).toEqual([finding]);
    expect(
      judge([finding], [{ page: "/x", rule: "h1", reason: "r" }]).unexpected,
    ).toEqual([finding]);
  });

  it("fails an entry that no longer occurs, so the baseline can only shrink", () => {
    const v = judge([], [{ page: "/gone", rule: "title", reason: "known" }]);
    expect(v.stale).toHaveLength(1);
  });

  it("fails an entry with no reason", () => {
    const v = judge([finding], [{ page: "/x", rule: "title", reason: " " }]);
    expect(v.problems).toHaveLength(1);
  });
});

describe("the command", () => {
  async function command(
    pages: Parameters<typeof serve>[0],
    baseline: unknown,
  ) {
    const site = await serve(pages);
    const file = path.join(
      DIR,
      `baseline-${Math.random().toString(36).slice(2)}.json`,
    );
    writeFileSync(file, JSON.stringify(baseline));
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      const code = await main(
        ["--base", site.base, "--baseline", file, "--concurrency", "2"],
        {},
      );
      return { code, lines };
    } finally {
      console.log = original;
      await site.close();
    }
  }

  it("exits 0 on a clean site and 1 on a new finding, naming it", async () => {
    expect((await command(good(), [])).code).toBe(0);
    const bad = await command(
      { ...good(), "/two-h1": page("/two-h1", { h1: 2 }) },
      [],
    );
    expect(bad.code).toBe(1);
    expect(bad.lines.join("\n")).toContain("::error::/two-h1 [h1]");
  });

  it("exits 0 when the finding is baselined, and 1 when the entry goes stale", async () => {
    const pages = { ...good(), "/two-h1": page("/two-h1", { h1: 2 }) };
    const entry = {
      page: "/two-h1",
      rule: "h1",
      reason: "two headings, fixed in wave 6",
    };
    expect((await command(pages, [entry])).code).toBe(0);
    const stale = await command(good(), [entry]);
    expect(stale.code).toBe(1);
    expect(stale.lines.join("\n")).toContain("Remove it");
  });
});

describe("the readers", () => {
  it("decodes the entities a description carries", () => {
    expect(
      decodeEntities("a &amp; b &#39;c&#x27; &quot;d&quot; &unknown;"),
    ).toBe(`a & b 'c' "d" &unknown;`);
  });

  it("finds head metadata whatever the attribute order or quoting", () => {
    const p = parsePage(
      `<html><head><meta content='x y' name=description><link href=/c rel="canonical"><title> T </title></head><body><h1>a</h1></body></html>`,
    );
    expect(p.descriptions).toEqual(["x y"]);
    expect(p.canonicalsInHead).toEqual(["/c"]);
    expect(p.titlesInHead).toEqual(["T"]);
    expect(p.h1Count).toBe(1);
  });

  it("does not count an h1 or a link that is only text inside a script", () => {
    const p = parsePage(
      `<head><title>t</title></head><body><script>"<h1>x</h1><a href='/z'>"</script></body>`,
    );
    expect(p.h1Count).toBe(0);
    expect(p.anchors).toEqual([]);
  });

  it("reads robots groups and the longest match", () => {
    const r = parseRobots(
      "User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\nSitemap: https://x/s.xml\n",
    );
    expect(r.sitemaps).toEqual(["https://x/s.xml"]);
    expect(robotsAllows(r.star, "/a/c")).toBe(false);
    expect(robotsAllows(r.star, "/a/b")).toBe(true);
    expect(robotsAllows(r.star, "/g")).toBe(true);
    expect(robotsAllows(r.star, "/doc.pdf")).toBe(false);
    expect(robotsAllows(r.star, "/doc.pdf?x=1")).toBe(true);
  });
});

describe("the committed baseline", () => {
  it("is a list of entries that each carry a page, a rule and a reason", () => {
    const baseline = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          "../../../../.github/site-checks/baseline.json",
        ),
        "utf8",
      ),
    );
    expect(Array.isArray(baseline)).toBe(true);
    expect(judge([], baseline).problems).toEqual([]);
  });
});
