#!/usr/bin/env node
// SEO and link checks over every page of the sitemap, against the app the
// job itself booted.
//
//   node scripts/ci/site-checks/check-site.mjs \
//     --base http://localhost:3000 --baseline .github/site-checks/baseline.json
//
// The sitemap is read from <base>/sitemap.xml. It names every page with the
// origin the image was built with, so each <loc> is fetched with its origin
// swapped for --base. Nothing else is ever requested: every request goes
// through one function that refuses a URL whose origin is not --base, and
// --base itself must be a loopback address. Redirects are not followed, so a
// page that sends a visitor elsewhere is reported, not visited.
//
// Per page: a 200; exactly one <title> inside <head>, unique across the site;
// a description of 50 to 160 characters; exactly one absolute canonical equal
// to the sitemap URL; no noindex; og:title, og:description, og:image, og:url
// and twitter:card, with the og:image answering 200 and image/*; JSON-LD that
// parses and names the page's own URL; exactly one <h1>. Every same-origin
// link found is requested once, and a 404, 410 or 5xx fails. Static pages are
// fetched a second time as Googlebot, which is how the regression where Next
// streamed the title and canonical into <body> shows up. robots.txt and the
// sitemap are checked as a whole.
//
// Known issues live in .github/site-checks/baseline.json as {page, rule,
// reason}. The baseline can only shrink: a finding that is not in it fails,
// and so does an entry that matches no finding ("remove it").
//
// No dependencies.

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 160;

/** Pages an unauthenticated visitor must never be handed as indexable. */
export const PRIVATE_PAGES = ["/dashboard", "/admin", "/history", "/profile"];

/** Per-check detail pages are generated from one template: a sample is enough for the second fetch. */
const GENERATED_PREFIX = "/checks/";
const GENERATED_SAMPLE = 3;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/* ------------------------------------------------------------------ */
/* Reading HTML without a parser                                        */
/* ------------------------------------------------------------------ */

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code =
        e[1].toLowerCase() === "x"
          ? Number.parseInt(e.slice(2), 16)
          : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The attributes of one tag, names lowercased, values decoded. */
export function attributesOf(tag) {
  const attrs = {};
  const re =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const m of tag.matchAll(re)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function withoutScriptsAndStyles(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "");
}

/** What the checks need from one HTML document. */
export function parsePage(html) {
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? "" : html.slice(0, headEnd);
  const body = headEnd === -1 ? html : html.slice(headEnd);
  const headText = withoutScriptsAndStyles(head);
  const bodyText = withoutScriptsAndStyles(body);
  // An <svg> may carry its own <title> for screen readers; that is not the
  // document's title streaming into the body.
  const bodyNoSvg = bodyText.replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, "");

  const titles = (text) =>
    [...text.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)].map((m) =>
      decodeEntities(m[1]).trim(),
    );
  const metas = (text) =>
    [...text.matchAll(/<meta\b[^>]*>/gi)].map((m) => attributesOf(m[0]));
  const links = (text) =>
    [...text.matchAll(/<link\b[^>]*>/gi)].map((m) => attributesOf(m[0]));

  const meta = (list, key) =>
    list.filter((a) =>
      [a.name, a.property].some((v) => (v ?? "").toLowerCase() === key),
    );
  const headMetas = metas(headText);
  const bodyMetas = metas(bodyText);

  const canonicalOf = (list) =>
    list
      .filter((a) =>
        (a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"),
      )
      .map((a) => a.href ?? "");

  const jsonLd = [
    ...html.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
    ),
  ].map((m) => m[1]);

  const anchors = [...bodyText.matchAll(/<a\b[^>]*>/gi)]
    .map((m) => attributesOf(m[0]).href)
    .filter((href) => typeof href === "string" && href !== "");

  return {
    titlesInHead: titles(headText),
    titlesInBody: titles(bodyNoSvg),
    descriptions: meta(headMetas, "description").map((a) => a.content ?? ""),
    descriptionsInBody: meta(bodyMetas, "description").length,
    canonicalsInHead: canonicalOf(links(headText)),
    canonicalsInBody: canonicalOf(links(bodyText)).length,
    robots: meta(headMetas, "robots")
      .map((a) => (a.content ?? "").toLowerCase())
      .join(","),
    og: Object.fromEntries(
      ["og:title", "og:description", "og:image", "og:url"].map((k) => [
        k,
        meta(headMetas, k)
          .map((a) => a.content ?? "")
          .filter((v) => v !== ""),
      ]),
    ),
    twitterCard: meta(headMetas, "twitter:card").map((a) => a.content ?? ""),
    jsonLd,
    h1Count: [...bodyText.matchAll(/<h1[\s>]/gi)].length,
    anchors,
  };
}

function stringsIn(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) stringsIn(v, out);
  }
  return out;
}

const noSlash = (url) => url.replace(/\/+$/, "");

/* ------------------------------------------------------------------ */
/* robots.txt and the sitemap                                           */
/* ------------------------------------------------------------------ */

/** The rules of the `*` group, and every Sitemap: line. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "sitemap") {
      sitemaps.push(value);
    } else if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if ((key === "disallow" || key === "allow") && current) {
      current.rules.push({ allow: key === "allow", path: value });
    }
    lastWasAgent = false;
  }
  const star = groups
    .filter((g) => g.agents.includes("*"))
    .flatMap((g) => g.rules);
  return { star, sitemaps };
}

function ruleMatches(rulePath, urlPath) {
  if (rulePath === "") return false;
  const pattern = rulePath
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  return new RegExp(`^${pattern}`).test(urlPath);
}

/** Longest matching rule wins, Allow on a tie, as crawlers read it. */
export function robotsAllows(star, urlPath) {
  let best = null;
  for (const rule of star) {
    if (!ruleMatches(rule.path, urlPath)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

export function parseSitemap(xml) {
  if (/<sitemapindex\b/i.test(xml)) return { index: true, urls: [] };
  const urls = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi)].map(
    (m) => ({
      loc: decodeEntities(
        /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i.exec(m[1])?.[1] ?? "",
      ).trim(),
      lastmod: /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod\s*>/i
        .exec(m[1])?.[1]
        ?.trim(),
    }),
  );
  return { index: false, urls, hasUrlset: /<urlset\b/i.test(xml) };
}

const LASTMOD =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/* ------------------------------------------------------------------ */
/* The check                                                            */
/* ------------------------------------------------------------------ */

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

export function baseOriginOf(base) {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`--base must be http or https: ${base}`);
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(
      `--base must be a loopback address (localhost, 127.0.0.1 or [::1]), not ${url.hostname}: these checks only ever run against the app the job booted.`,
    );
  }
  return url.origin;
}

/**
 * Runs every check. Returns the findings (page, rule, message) and counts;
 * judging them against the baseline is `judge`.
 */
export async function checkSite({ base, concurrency = 6, fetchImpl = fetch }) {
  const baseOrigin = baseOriginOf(base);
  const findings = [];
  const seen = new Set();
  const add = (page, rule, message) => {
    const key = JSON.stringify([page, rule]);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ page, rule, message });
  };

  /** The one place a request is made: nothing off --base gets through. */
  async function request(url, { method = "GET", ua = BROWSER_UA } = {}) {
    const target = new URL(url);
    if (target.origin !== baseOrigin) {
      throw new Error(`refused: ${target.origin} is not ${baseOrigin}`);
    }
    return fetchImpl(target, {
      method,
      redirect: "manual",
      headers: { "user-agent": ua, accept: "text/html,application/xml,*/*" },
      signal: AbortSignal.timeout(30_000),
    });
  }

  async function text(url, options) {
    const res = await request(url, options);
    return { res, body: await res.text() };
  }

  /* robots.txt */
  let star = [];
  try {
    const { res, body } = await text(`${baseOrigin}/robots.txt`);
    if (res.status !== 200) {
      add("/robots.txt", "robots-status", `robots.txt answered ${res.status}.`);
    } else {
      const robots = parseRobots(body);
      star = robots.star;
      if (robots.sitemaps.length === 0) {
        add(
          "/robots.txt",
          "robots-sitemap-line",
          "robots.txt has no Sitemap: line.",
        );
      }
      if (star.some((r) => !r.allow && r.path === "/")) {
        add(
          "/robots.txt",
          "robots-disallow-all",
          "robots.txt disallows / for every crawler.",
        );
      }
    }
  } catch (error) {
    add(
      "/robots.txt",
      "robots-status",
      `robots.txt could not be read: ${error.message}`,
    );
  }

  /* sitemap.xml */
  let entries = [];
  let siteOrigin = baseOrigin;
  try {
    const { res, body } = await text(`${baseOrigin}/sitemap.xml`);
    if (res.status !== 200) {
      add(
        "/sitemap.xml",
        "sitemap-status",
        `sitemap.xml answered ${res.status}.`,
      );
    } else {
      const sitemap = parseSitemap(body);
      if (sitemap.index || !sitemap.hasUrlset) {
        add(
          "/sitemap.xml",
          "sitemap-format",
          "sitemap.xml is not a <urlset> document.",
        );
      }
      const locs = new Set();
      for (const { loc, lastmod } of sitemap.urls) {
        let url;
        try {
          url = new URL(loc);
        } catch {
          add(
            "/sitemap.xml",
            "sitemap-format",
            `A <loc> is not a URL: ${loc.slice(0, 80)}`,
          );
          continue;
        }
        if (entries.length === 0) siteOrigin = url.origin;
        if (url.origin !== siteOrigin) {
          add(
            "/sitemap.xml",
            "sitemap-origin",
            `${loc} is not on ${siteOrigin}, the origin of the first entry.`,
          );
          continue;
        }
        if (locs.has(loc)) {
          add(
            "/sitemap.xml",
            "sitemap-duplicate",
            `${loc} is listed more than once.`,
          );
          continue;
        }
        locs.add(loc);
        if (
          lastmod !== undefined &&
          (!LASTMOD.test(lastmod) || Number.isNaN(Date.parse(lastmod)))
        ) {
          add(
            "/sitemap.xml",
            "sitemap-lastmod",
            `${loc} has the lastmod ${lastmod.slice(0, 40)}, which is not a date.`,
          );
        }
        entries.push({ loc, path: url.pathname + url.search });
      }
      if (entries.length === 0) {
        add("/sitemap.xml", "sitemap-format", "sitemap.xml lists no pages.");
      }
    }
  } catch (error) {
    add(
      "/sitemap.xml",
      "sitemap-status",
      `sitemap.xml could not be read: ${error.message}`,
    );
  }

  for (const { path } of entries) {
    if (!robotsAllows(star, path)) {
      add(
        path,
        "robots-disallows-sitemap-url",
        `robots.txt disallows ${path}, which the sitemap lists.`,
      );
    }
  }

  /* pages */
  const pageTitles = new Map();
  const ogImages = new Map();
  const linkTargets = new Map();
  const generatedSample = entries
    .filter((e) => e.path.startsWith(GENERATED_PREFIX))
    .slice(0, GENERATED_SAMPLE)
    .map((e) => e.path);
  const secondFetch = new Set(
    entries
      .filter((e) => !e.path.startsWith(GENERATED_PREFIX))
      .map((e) => e.path)
      .concat(generatedSample),
  );

  async function imageStatus(url) {
    if (!ogImages.has(url)) {
      ogImages.set(
        url,
        (async () => {
          try {
            const res = await request(url);
            await res.body?.cancel();
            return {
              status: res.status,
              type: res.headers.get("content-type") ?? "",
            };
          } catch (error) {
            return { status: 0, type: error.message };
          }
        })(),
      );
    }
    return ogImages.get(url);
  }

  async function checkPage({ loc, path }) {
    const pageUrl = `${baseOrigin}${path}`;
    let res;
    let body;
    try {
      ({ res, body } = await text(pageUrl));
    } catch (error) {
      add(path, "status", `The request failed: ${error.message}`);
      return;
    }
    if (res.status !== 200) {
      add(
        path,
        "status",
        `The page answered ${res.status}${res.status >= 300 && res.status < 400 ? ` to ${res.headers.get("location") ?? "somewhere"}` : ""}; a sitemap URL has to answer 200.`,
      );
      return;
    }
    const page = parsePage(body);

    if (page.titlesInHead.length !== 1) {
      add(
        path,
        "title",
        `${page.titlesInHead.length} <title> elements in <head>, expected 1.`,
      );
    } else {
      const title = page.titlesInHead[0];
      if (title === "") add(path, "title", "The <title> is empty.");
      else pageTitles.set(path, title);
    }
    if (
      page.titlesInBody.length > 0 ||
      page.canonicalsInBody > 0 ||
      page.descriptionsInBody > 0
    ) {
      add(
        path,
        "head-metadata-in-body",
        "A title, canonical or description sits after </head>, where a crawler that reads only the head does not see it.",
      );
    }

    if (page.descriptions.length !== 1) {
      add(
        path,
        "description",
        `${page.descriptions.length} meta descriptions, expected 1.`,
      );
    } else {
      const length = [...page.descriptions[0]].length;
      if (length < DESCRIPTION_MIN || length > DESCRIPTION_MAX) {
        add(
          path,
          "description",
          `The description is ${length} characters, expected ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX}.`,
        );
      }
    }

    if (page.canonicalsInHead.length !== 1) {
      add(
        path,
        "canonical",
        `${page.canonicalsInHead.length} canonical links in <head>, expected 1.`,
      );
    } else {
      const canonical = page.canonicalsInHead[0];
      if (!/^https?:[/][/]/i.test(canonical)) {
        add(
          path,
          "canonical",
          `The canonical ${canonical.slice(0, 80)} is not absolute.`,
        );
      } else if (canonical !== loc) {
        add(
          path,
          "canonical",
          `The canonical is ${canonical.slice(0, 100)}, the sitemap says ${loc}.`,
        );
      }
    }

    if (
      /noindex/.test(page.robots) ||
      /noindex/i.test(res.headers.get("x-robots-tag") ?? "")
    ) {
      add(path, "noindex", "A page the sitemap lists is marked noindex.");
    }

    for (const key of ["og:title", "og:description", "og:image", "og:url"]) {
      if (page.og[key].length === 0) add(path, "og", `${key} is missing.`);
    }
    if (page.twitterCard.length === 0)
      add(path, "og", "twitter:card is missing.");
    const image = page.og["og:image"][0];
    if (image) {
      let imageUrl = null;
      try {
        const parsed = new URL(image, loc);
        if (parsed.origin === siteOrigin || parsed.origin === baseOrigin) {
          imageUrl = `${baseOrigin}${parsed.pathname}${parsed.search}`;
        }
      } catch {
        add(path, "og-image", `og:image ${image.slice(0, 80)} is not a URL.`);
      }
      if (imageUrl) {
        const { status, type } = await imageStatus(imageUrl);
        if (status !== 200 || !/^image[/]/i.test(type)) {
          add(
            path,
            "og-image",
            `og:image ${new URL(imageUrl).pathname} answered ${status || "no response"} (${type.slice(0, 40)}), expected 200 and image/*.`,
          );
        }
      }
    }

    if (page.jsonLd.length === 0) {
      add(path, "json-ld", "No JSON-LD.");
    } else {
      const strings = [];
      let parsed = true;
      for (const block of page.jsonLd) {
        try {
          stringsIn(JSON.parse(block), strings);
        } catch {
          parsed = false;
        }
      }
      if (!parsed) add(path, "json-ld", "A JSON-LD block does not parse.");
      else if (!strings.some((s) => noSlash(s) === noSlash(loc))) {
        add(
          path,
          "json-ld",
          `No JSON-LD value names the page's own URL ${loc}.`,
        );
      }
    }

    if (page.h1Count !== 1)
      add(path, "h1", `${page.h1Count} <h1> elements, expected 1.`);

    for (const href of page.anchors) {
      let target;
      try {
        target = new URL(href, pageUrl);
      } catch {
        continue;
      }
      if (!["http:", "https:"].includes(target.protocol)) continue;
      if (target.origin !== baseOrigin && target.origin !== siteOrigin)
        continue;
      target.hash = "";
      const key = `${target.pathname}${target.search}`;
      if (!linkTargets.has(key)) linkTargets.set(key, path);
    }

    if (secondFetch.has(path)) {
      try {
        const g = await text(pageUrl, { ua: GOOGLEBOT_UA });
        if (g.res.status !== 200) {
          add(
            path,
            "googlebot",
            `As Googlebot the page answered ${g.res.status}.`,
          );
        } else {
          const gp = parsePage(g.body);
          if (
            gp.titlesInHead.length !== 1 ||
            gp.canonicalsInHead.length !== 1 ||
            gp.descriptions.length !== 1
          ) {
            add(
              path,
              "googlebot",
              "As Googlebot, the title, canonical or description is not in <head> exactly once.",
            );
          } else if (
            gp.titlesInHead[0] !== page.titlesInHead[0] ||
            gp.canonicalsInHead[0] !== page.canonicalsInHead[0]
          ) {
            add(
              path,
              "googlebot",
              "Googlebot is served a different title or canonical than a browser.",
            );
          }
        }
      } catch (error) {
        add(
          path,
          "googlebot",
          `The request as Googlebot failed: ${error.message}`,
        );
      }
    }
  }

  await pool(entries, concurrency, checkPage);

  // After the pool, in path order, so which page of a pair is the one named
  // does not depend on which request finished first.
  const byTitle = new Map();
  for (const path of [...pageTitles.keys()].sort()) {
    const title = pageTitles.get(path);
    if (!byTitle.has(title)) byTitle.set(title, path);
    else {
      add(
        path,
        "title-unique",
        `The title "${title.slice(0, 60)}" is also the title of ${byTitle.get(title)}.`,
      );
    }
  }

  /* links */
  const sitemapPaths = new Set(entries.map((e) => e.path));
  const toCheck = [...linkTargets.entries()].filter(
    ([p]) => !sitemapPaths.has(p),
  );
  await pool(toCheck, concurrency, async ([target, from]) => {
    const url = `${baseOrigin}${target}`;
    try {
      let res = await request(url, { method: "HEAD" });
      if (res.status === 405 || res.status === 501) {
        res = await request(url);
        await res.body?.cancel();
      }
      if (res.status === 404 || res.status === 410 || res.status >= 500) {
        add(
          target,
          "link-broken",
          `A link to it answers ${res.status} (linked from ${from}).`,
        );
      }
    } catch (error) {
      add(
        target,
        "link-broken",
        `A link to it failed: ${error.message} (linked from ${from}).`,
      );
    }
  });

  /* pages that are never indexable */
  for (const path of PRIVATE_PAGES) {
    try {
      const res = await request(`${baseOrigin}${path}`);
      let body = "";
      if (res.status === 200) body = await res.text();
      else await res.body?.cancel();
      const robots = res.status === 200 ? parsePage(body).robots : "";
      const header = res.headers.get("x-robots-tag") ?? "";
      const hidden =
        res.status >= 300 || /noindex/.test(robots) || /noindex/i.test(header);
      if (!hidden)
        add(
          path,
          "private-page-indexable",
          `${path} answers 200 to a visitor with neither a redirect nor noindex.`,
        );
    } catch (error) {
      add(
        path,
        "private-page-indexable",
        `${path} could not be read: ${error.message}`,
      );
    }
  }

  return {
    findings,
    pages: entries.length,
    links: toCheck.length,
    siteOrigin,
    baseOrigin,
  };
}

/**
 * Sets the findings against the baseline: what fails is a finding not in the
 * baseline, an entry that matches no finding, and an entry with no reason.
 */
export function judge(findings, baseline) {
  const problems = [];
  const used = new Set();
  const unexpected = [];
  for (const f of findings) {
    const entry = baseline.find((b) => b.page === f.page && b.rule === f.rule);
    if (entry) used.add(entry);
    else unexpected.push(f);
  }
  const stale = [];
  for (const entry of baseline) {
    if (
      typeof entry.page !== "string" ||
      typeof entry.rule !== "string" ||
      typeof entry.reason !== "string" ||
      entry.reason.trim() === ""
    ) {
      problems.push(
        `A baseline entry needs a page, a rule and a reason: ${JSON.stringify(entry).slice(0, 100)}`,
      );
    } else if (!used.has(entry)) {
      stale.push(entry);
    }
  }
  return { unexpected, stale, problems, accepted: used.size };
}

/* ------------------------------------------------------------------ */
/* Command line                                                         */
/* ------------------------------------------------------------------ */

function plain(text) {
  return String(text)
    .split("")
    .map((ch) => (ch >= " " && ch <= "~" && ch !== "%" ? ch : "_"))
    .join("");
}

function argValue(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

export async function main(argv, env = process.env) {
  const base = argValue(argv, "--base");
  const baselineFile = argValue(argv, "--baseline");
  const concurrency = Number(argValue(argv, "--concurrency") ?? "6");
  if (
    !base ||
    !baselineFile ||
    !Number.isInteger(concurrency) ||
    concurrency < 1
  ) {
    console.error(
      "usage: check-site.mjs --base <origin> --baseline <file> [--concurrency 6]",
    );
    return 2;
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
    if (!Array.isArray(baseline)) throw new Error("not a list");
  } catch (error) {
    console.log(
      `::error::The baseline ${plain(baselineFile)} is not a JSON list (${plain(error.message)}).`,
    );
    return 1;
  }

  let result;
  try {
    result = await checkSite({ base, concurrency });
  } catch (error) {
    console.log(`::error::${plain(error.message)}`);
    return 1;
  }
  const verdict = judge(result.findings, baseline);

  const shown = verdict.unexpected.slice(0, 100);
  for (const f of shown) {
    console.log(
      `::error::${plain(f.page)} [${plain(f.rule)}] ${plain(f.message)}`,
    );
  }
  if (verdict.unexpected.length > shown.length) {
    console.log(
      `::error::...and ${verdict.unexpected.length - shown.length} more findings.`,
    );
  }
  for (const e of verdict.stale) {
    console.log(
      `::error::The baseline lists ${plain(e.page)} [${plain(e.rule)}], which no longer occurs. Remove it.`,
    );
  }
  for (const p of verdict.problems) console.log(`::error::${plain(p)}`);

  const byRule = new Map();
  for (const f of result.findings)
    byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const summary = [
    "### Sitemap SEO and link check",
    "",
    `${result.pages} sitemap pages and ${result.links} other same-origin links checked on ${result.baseOrigin}; ${verdict.accepted} baselined findings, ${verdict.unexpected.length} new, ${verdict.stale.length} stale baseline entries.`,
    "",
    ...(byRule.size > 0
      ? [
          "| Rule | Findings |",
          "|---|---|",
          ...[...byRule].sort().map(([r, n]) => `| ${plain(r)} | ${n} |`),
          "",
        ]
      : []),
  ];
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
  }
  console.log(summary[2]);

  return verdict.unexpected.length +
    verdict.stale.length +
    verdict.problems.length >
    0
    ? 1
    : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2));
}
