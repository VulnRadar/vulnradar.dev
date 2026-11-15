#!/usr/bin/env node
// Run by the Self-host smoke test job in .github/workflows/ci.yml against the
// image it booted, after the health checks pass. It probes behaviour Next and
// its bundler take part in, which no unit test sees because unit tests never
// run a build:
//
// 1. Script nonces. Every script Next renders takes its nonce from the CSP
//    header middleware sets, through a copy Next makes onto the request, and
//    Turbopack emits the bootstrap scripts differently from webpack. Every
//    executable script on the probed public pages must carry the header's
//    nonce. The one exception is next-themes' theme script, which
//    components/providers/theme-provider.tsx passes no nonce: CSP blocks it,
//    and the class="dark" app/layout.tsx puts on <html> stands. It is allowed
//    once per page, and only as the exact call this app's props produce.
// 2. Escaped API prefixes. A write whose /api prefix is spelled with escapes
//    must meet the same refusal as the plain spelling (middleware.ts, the
//    escaped-prefix checks). The same-origin pair is the positive control: it
//    shows the escaped spelling gets the plain spelling's answer once the
//    Origin is right, so the 403s are about the Origin.
// 3. Route types the page loop does not reach: metadata routes and
//    force-static handlers, config rewrites, the redirects middleware builds,
//    Next's trailing-slash redirect, RSC responses, the plain-text 404 for
//    subresource requests (Next 16.3), the header overrides middleware applies
//    after NextResponse.next(), and the hashed static assets a page names.
//
// Every page probed is public (lib/config/public-paths.ts), because a
// signed-out request for any other page is redirected to /login. The
// not-found page is reached through /docs/no-such-page-here for that reason.
// Requests go over node:http rather than fetch so paths are sent exactly as
// written: fetch would resolve the %2e%2e segment before sending it.
//
// Run: `node scripts/ci/next16-runtime-probes.mjs [baseUrl]`
// (default http://localhost:3000).

import http from "node:http";
import { pathToFileURL } from "node:url";

export const NONCE_PAGES = [
  "/landing",
  "/login",
  "/docs",
  "/changelog",
  "/checks",
  // The generateStaticParams routes. If Next ever prerendered one at build
  // time, its scripts would carry no request nonce.
  "/checks/hsts-missing",
  "/checks/category/headers",
  "/alternatives/detectify",
  // The public route with a loading.tsx; loading and template scripts only got
  // nonces in Next 16.3.5.
  "/pricing",
  "/docs/no-such-page-here",
];

/** The tail of the theme script next-themes 0.4.6 renders for app/layout.tsx's props. */
export const NEXT_THEMES_CALL =
  '("class","theme","system",null,["light","dark"],null,true,true)</script>';

const NONCE_RE = new RegExp("nonce-([A-Za-z0-9+/=_-]+)");
const SCRIPT_TAG_RE = new RegExp("<script[^>]*>", "g");
const NONCE_ATTR_RE = new RegExp('nonce="[^"]*"', "g");
const STATIC_ASSET_RE = new RegExp('(?:src|href)="(/_next/static/[^"]+)"', "g");

/** The nonce a Content-Security-Policy header carries, or null. */
export function cspNonce(csp) {
  const m = NONCE_RE.exec(csp ?? "");
  return m ? m[1] : null;
}

/**
 * Whether every executable script in `html` carries the nonce in `csp`.
 *
 * @returns {{ ok: boolean, message: string }}
 */
export function checkPageScripts(html, csp) {
  const nonce = cspNonce(csp);
  if (!nonce) return { ok: false, message: "no nonce in the CSP header" };
  // JSON data blocks never execute, so CSP does not govern them.
  const tags = (html.match(SCRIPT_TAG_RE) ?? []).filter(
    (t) =>
      !t.includes("application/ld+json") && !t.includes("application/json"),
  );
  if (tags.length === 0)
    return { ok: false, message: "no script tags to check" };
  const bare = tags.filter((t) => t === "<script>").length;
  const themes = html.split(NEXT_THEMES_CALL).length - 1;
  if (bare !== themes || themes > 1) {
    return {
      ok: false,
      message: `${bare} bare script tags, ${themes} of them the next-themes script`,
    };
  }
  const unnonced = tags.filter(
    (t) => t !== "<script>" && !t.includes("nonce="),
  );
  if (unnonced.length > 0) {
    return {
      ok: false,
      message: `${unnonced.length} scripts carry no nonce: ${unnonced.join(" ")}`,
    };
  }
  const values = new Set(tags.flatMap((t) => t.match(NONCE_ATTR_RE) ?? []));
  if (values.size !== 1 || !values.has(`nonce="${nonce}"`)) {
    return {
      ok: false,
      message: `script nonces differ from the header: ${[...values].join(" ")}`,
    };
  }
  return {
    ok: true,
    message: `${tags.length} scripts, all but ${themes} next-themes script carry the header nonce`,
  };
}

/** The /_next/static URLs a page names, each once. */
export function staticAssets(html) {
  const found = new Set();
  for (const m of html.matchAll(STATIC_ASSET_RE)) {
    found.add(m[1].replaceAll("&amp;", "&"));
  }
  return [...found].sort();
}

/**
 * One request, with the path sent exactly as given. Every request says it
 * arrived over TLS, as the deployed app sees it behind its proxy, so the
 * plain-HTTP redirect does not answer in place of the route.
 *
 * @param {string} base
 * @param {{ method?: string, path: string, headers?: Record<string, string>, body?: string }} spec
 * @returns {Promise<{ status: number | undefined, headers: import("node:http").IncomingHttpHeaders, rawHeaders: string[], body: string }>}
 */
export function request(base, { method = "GET", path, headers = {}, body }) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port || 80,
        method,
        path,
        agent: false,
        // "localhost" resolves to ::1 and 127.0.0.1, and Node tries them in turn
        // with 250 ms per attempt by default, which a busy runner can miss.
        autoSelectFamilyAttemptTimeout: 2_000,
        timeout: 20_000,
        headers: { "X-Forwarded-Proto": "https", ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            rawHeaders: res.rawHeaders,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Every value of one response header, duplicates included. */
export function headerValues(res, name) {
  const out = [];
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    if (res.rawHeaders[i].toLowerCase() === name)
      out.push(res.rawHeaders[i + 1]);
  }
  return out;
}

const contentType = (res) => String(res.headers["content-type"] ?? "");
const hasHeader = (res, name) => headerValues(res, name).length > 0;

async function probeNonces(base, report) {
  for (const path of NONCE_PAGES) {
    const res = await request(base, { path });
    const csp = headerValues(res, "content-security-policy").join(", ");
    const { ok, message } = checkPageScripts(res.body, csp);
    report(ok, `${path} (${res.status}): ${message}`);
  }
}

async function probeEscapedWrites(base, report) {
  const self = `https://${new URL(base).host}`;
  const evil = "https://evil.example";
  const json = { "Content-Type": "application/json" };
  const cases = [
    [
      403,
      "CSRF_REJECTED",
      { method: "POST", path: "/api/v3/scan", headers: json, body: "{}" },
    ],
    [
      403,
      "CSRF_REJECTED",
      { method: "POST", path: "/%61pi/v3/scan", headers: json, body: "{}" },
    ],
    [
      403,
      "CSRF_REJECTED",
      {
        method: "POST",
        path: "/%61pi/v3/scan",
        headers: { ...json, Origin: evil },
        body: "{}",
      },
    ],
    [
      401,
      "UNAUTHENTICATED",
      {
        method: "POST",
        path: "/api/v3/scan",
        headers: { ...json, Origin: self },
        body: "{}",
      },
    ],
    [
      401,
      "UNAUTHENTICATED",
      {
        method: "POST",
        path: "/%61pi/v3/scan",
        headers: { ...json, Origin: self },
        body: "{}",
      },
    ],
    [
      403,
      "CSRF_REJECTED",
      {
        method: "PATCH",
        path: "/api/v3/support-tickets/12.png",
        headers: { Origin: evil },
      },
    ],
    [
      403,
      "CSRF_REJECTED",
      {
        method: "POST",
        path: "/api/v3/x/%2e%2e/scan",
        headers: { ...json, Origin: evil },
        body: "{}",
      },
    ],
    [404, "NOT_FOUND", { path: "/api%2Fv3%2Fhealth" }],
    // Middleware caps the declared Content-Length, but the server copies the
    // body for middleware and does not answer until that copy has ended, so
    // the whole declared body is sent. An empty code accepts a 413 from
    // server.mjs's front server too.
    [
      413,
      "",
      {
        method: "POST",
        path: "/%61pi/v3/scan",
        headers: { ...json, "Content-Length": "2000000" },
        body: " ".repeat(2_000_000),
      },
    ],
  ];
  for (const [want, code, spec] of cases) {
    const res = await request(base, spec);
    const ok = res.status === want && (code === "" || res.body.includes(code));
    const what = `${spec.method ?? "GET"} ${spec.path}${spec.headers?.Origin ? ` (Origin ${spec.headers.Origin})` : ""}`;
    report(
      ok,
      ok
        ? `${want} ${code}: ${what}`
        : `expected ${want} ${code} for ${what}, got ${res.status}: ${res.body.slice(0, 300)}`,
    );
  }
  const health = await request(base, { path: "/%61pi/v3/health" });
  report(
    true,
    `GET /%61pi/v3/health: ${health.status} (recorded, not asserted)`,
  );
}

async function probeRouteTypes(base, report) {
  // Metadata routes, the force-static handlers and the security.txt rewrites.
  for (const [path, want] of [
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "application/xml"],
    ["/manifest.webmanifest", "application/manifest+json"],
    ["/security.txt", "text/plain"],
    ["/.well-known/security.txt", "text/plain"],
    ["/llms.txt", "text/plain"],
  ]) {
    const res = await request(base, { path });
    const ok =
      res.status === 200 &&
      contentType(res).startsWith(want) &&
      hasHeader(res, "content-security-policy");
    report(
      ok,
      `${path}: ${res.status} ${contentType(res)}${hasHeader(res, "content-security-policy") ? "" : ", no CSP header"}${ok ? "" : `, expected 200 ${want} with a CSP header`}`,
    );
  }

  // Redirects middleware builds: a short link (lib/config/client-constants.ts),
  // a retired check (lib/seo/retired-checks.ts) and the signed-out redirect to
  // /login. Each carries the config headers.
  for (const [want, target, path] of [
    [307, "https://github.com/", "/github"],
    [301, "/checks/category/headers", "/checks/age-header-reveals-cdn"],
    [307, "/login", "/dashboard"],
  ]) {
    const res = await request(base, { path });
    const loc = String(res.headers.location ?? "");
    const ok =
      res.status === want &&
      loc.includes(target) &&
      hasHeader(res, "x-frame-options");
    report(
      ok,
      `${path}: ${res.status} to ${loc}${hasHeader(res, "x-frame-options") ? "" : ", no X-Frame-Options"}${ok ? "" : `, expected ${want} to ${target}`}`,
    );
  }

  // Next's own trailing-slash redirect, which runs before middleware.
  {
    const res = await request(base, { path: "/pricing/" });
    const loc = String(res.headers.location ?? "");
    report(
      res.status === 308 && loc.endsWith("/pricing"),
      `/pricing/: ${res.status} to ${loc}${res.status === 308 && loc.endsWith("/pricing") ? "" : ", expected 308 to /pricing"}`,
    );
  }

  // An RSC response, what every client navigation fetches. With no router
  // headers the expected _rsc hash is empty, so an empty _rsc is the value
  // Next 16 accepts; without it, Next 16.3 and later answer a 307 that adds it.
  {
    const first = await request(base, {
      path: "/landing",
      headers: { RSC: "1" },
    });
    const res = await request(base, {
      path: "/landing?_rsc=",
      headers: { RSC: "1" },
    });
    const ok =
      res.status === 200 &&
      contentType(res).startsWith("text/x-component") &&
      hasHeader(res, "content-security-policy");
    report(
      ok,
      `RSC /landing: without _rsc ${first.status} (recorded), with it ${res.status} ${contentType(res)}${hasHeader(res, "content-security-policy") ? "" : ", no CSP header"}`,
    );
  }

  // A subresource request for a path nothing routes: plain-text 404 since
  // Next 16.3, the HTML not-found page before. The headers still apply.
  {
    const res = await request(base, {
      path: "/docs/no-such-page-here",
      headers: { "Sec-Fetch-Dest": "image" },
    });
    const ok = res.status === 404 && hasHeader(res, "content-security-policy");
    report(
      ok,
      `subresource 404: ${res.status} ${contentType(res)}${hasHeader(res, "content-security-policy") ? "" : ", no CSP header"} (content type recorded)`,
    );
  }

  // Header overrides middleware applies after NextResponse.next(), decided
  // on the path alone, so made-up tokens still get them.
  {
    const badge = await request(base, {
      path: "/api/v3/badge/not-a-real-token",
    });
    const corp = headerValues(badge, "cross-origin-resource-policy");
    report(
      corp.length === 1 && corp[0] === "cross-origin",
      `badge CORP: ${JSON.stringify(corp)}, expected exactly ["cross-origin"]`,
    );
    const shot = await request(base, {
      path: "/api/v3/shared/not-a-real-token/screenshot",
    });
    const csp = headerValues(shot, "content-security-policy");
    report(
      csp.length === 1 && csp[0] === "default-src 'none'; sandbox",
      `screenshot CSP: ${JSON.stringify(csp)}, expected exactly ["default-src 'none'; sandbox"]`,
    );
  }

  // The hashed static assets a page names.
  {
    const page = await request(base, { path: "/landing" });
    const assets = staticAssets(page.body);
    report(
      assets.length > 0,
      `/landing names ${assets.length} /_next/static assets`,
    );
    for (const asset of assets) {
      const bare = asset.split("?")[0];
      const want = bare.endsWith(".css")
        ? "text/css"
        : bare.endsWith(".js")
          ? "javascript"
          : "";
      const res = await request(base, { path: asset });
      const cache = String(res.headers["cache-control"] ?? "");
      const ok =
        res.status === 200 &&
        contentType(res).includes(want) &&
        cache.includes("immutable");
      if (!ok) {
        report(
          false,
          `${asset}: ${res.status} ${contentType(res)}, cache-control ${cache}`,
        );
      }
    }
    if (assets.length > 0) {
      report(
        true,
        `/landing: checked ${assets.length} static assets for 200, type and immutable`,
      );
    }
  }
}

export async function runProbes(base) {
  const failures = [];
  const report = (ok, line) => {
    if (ok) {
      console.log(`ok    ${line}`);
    } else {
      console.error(`FAIL  ${line}`);
      failures.push(line);
    }
  };
  await probeNonces(base, report);
  await probeEscapedWrites(base, report);
  await probeRouteTypes(base, report);
  return failures;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const base = process.argv[2] ?? "http://localhost:3000";
  runProbes(base).then(
    (failures) => {
      if (failures.length > 0) {
        console.error(`${failures.length} probe(s) failed against ${base}`);
        process.exit(1);
      }
      console.log(`every probe passed against ${base}`);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
