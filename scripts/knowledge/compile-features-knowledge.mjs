#!/usr/bin/env node
// Compile an inventory of every user-facing page in the app into a single
// knowledge file the AI assistant reads (via retrieval on every message, and
// wholesale via the /features slash command).
//
// Why this exists: the assistant knew the docs, the changelog, the checks and
// the legal pages, and nothing at all about the product's own surface. Asked
// "can we do GitHub repo scanning?" it said no, while /repos has shipped for
// releases. Nothing in lib/ai described what pages exist.
//
// Why it is generated rather than written: a hand-kept feature list drifts the
// moment somebody adds a route, and the failure is silent (the assistant just
// keeps saying no). Everything below is read out of the tree that actually
// renders, so a new page appears here on the next build with no second edit.
//
// What we extract (per route):
//   - The route path, from the app/ directory layout
//   - Title + description from pageMetadata()/privatePageMetadata() in the
//     route's layout.tsx or page.tsx
//   - The page's own <h1> and the subtitle <p> under it, when that prose is
//     static enough to quote verbatim
//   - The navigation label and search keywords the app itself uses for the
//     route (components/shared/command-palette.tsx, components/scanner/header.tsx)
//   - Whether the page is public or needs a session (lib/seo/routes.ts)
//
// A route whose purpose none of those sources gives up is still listed, with
// only what is known. Emitting less is the point: an invented description is
// worse than a bare route, because the assistant will repeat it.
//
// Run: `node scripts/knowledge/compile-features-knowledge.mjs`
// Auto-run: hooked as prebuild + predev in package.json.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..", "..");
const APP_DIR = join(ROOT, "app");
const OUTPUT = join(ROOT, "lib", "ai", "features-knowledge.md");

// Floor assertion, same reasoning as the other compilers: a broken walk used
// to shrink the output silently and the build stayed green. Well under the
// current route count so an intentional deletion does not trip it.
const MIN_ROUTES = 45;

/**
 * Route subtrees this file deliberately does not describe.
 *
 * - /api is not a page.
 * - /docs has its own compiler (compile-docs-knowledge.mjs) that extracts far
 *   more per page than this one could; listing the routes again would only
 *   duplicate it.
 * - The per-check and per-competitor SEO surfaces are ~750 and ~20 generated
 *   pages off one template each. Their content is checks-knowledge.md's job.
 *   The index pages above them (/checks, /alternatives) stay.
 * - /dev is a development-only workbench that calls notFound() in production.
 */
const SKIP_PREFIXES = [
  "/api",
  "/docs",
  "/checks/",
  "/alternatives/",
  "/dev",
];

/** Route -> the section it is grouped under in the output. First match wins. */
const GROUPS = [
  { prefix: "/legal", heading: "Legal and policy pages" },
  { prefix: "/checkout", heading: "Checkout and credit top-ups" },
  {
    match: (route) => /credits$/.test(route),
    heading: "Checkout and credit top-ups",
  },
  {
    match: (route) =>
      [
        "/login",
        "/signup",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
        "/unsubscribe",
        "/staff-invite/[token]",
      ].includes(route),
    heading: "Sign-in and account recovery",
  },
  { prefix: "/admin", heading: "Staff and admin" },
];
const DEFAULT_GROUP = "Product features";

/**
 * Identifiers that resolve to a fixed string everywhere they appear. Same idea
 * as compile-legal-knowledge.mjs's STATIC_SUBSTITUTIONS: inline the ones whose
 * value is genuinely constant so the prose reads normally, and leave every
 * other expression in place so the "did this resolve cleanly" check below can
 * see it and reject the sentence.
 *
 * The check counts are read out of check-stats.generated.ts rather than typed,
 * for the same reason every other surface reads them: they change on every
 * check that ships.
 */
const STATIC_SUBSTITUTIONS = {
  APP_NAME: "VulnRadar",
  ...readGeneratedCheckStats(),
};

function readGeneratedCheckStats() {
  const path = join(ROOT, "lib", "config", "check-stats.generated.ts");
  if (!existsSync(path)) return {};
  const src = readFileSync(path, "utf8");
  const out = {};
  for (const m of src.matchAll(
    /export const (EXACT_[A-Z_]+)\s*=\s*(\d+)/g,
  ))
    out[m[1]] = m[2];
  const label = src.match(/export const GENERATED_CHECKS_LABEL\s*=\s*"([^"]+)"/);
  // TOTAL_CHECKS_LABEL is client-constants' re-export of the same value; pages
  // import it under that name, so both spellings have to resolve.
  if (label) out.TOTAL_CHECKS_LABEL = label[1];
  return out;
}

/**
 * Module-level `const NAME = "..."` / `` const NAME = `...` `` declarations in
 * one page's own source, as a substitution table.
 *
 * Several pages build their metadata out of a local constant
 * (`description: `${COUNT_SENTENCE} Every one has a page...``), and without
 * this the whole sentence is discarded for one unresolved name. Bounded to
 * single-line literals on purpose: anything computed is exactly the kind of
 * value that must NOT be guessed at.
 */
function readLocalConstants(source) {
  const out = {};
  for (const m of source.matchAll(
    /^const ([A-Z][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`);$/gm,
  )) {
    out[m[1]] = (m[2] ?? m[3]).replace(/\\(.)/g, "$1");
  }
  return out;
}

function substituteBareExpressions(s, locals = {}) {
  return s.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (full, name) => {
    if (name in STATIC_SUBSTITUTIONS) return STATIC_SUBSTITUTIONS[name];
    if (name in locals) return locals[name];
    return full;
  });
}

/**
 * Resolve the `${...}` interpolations in a template literal, from the same two
 * tables. Repeated because a local constant can itself be a template that
 * names another one; three passes is well past anything in the tree and
 * terminates regardless.
 */
function resolveTemplate(text, locals = {}) {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(/\$\{([A-Za-z][A-Za-z0-9_.]*)\}/g, (full, name) => {
      if (name in STATIC_SUBSTITUTIONS) return STATIC_SUBSTITUTIONS[name];
      if (name in locals) return locals[name];
      if (name === "BILLING_PLAN_LIMITS.free") return String(readFreeScanLimit());
      return full;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Turn a fragment of JSX into plain prose. Deliberately narrower than the
 * docs/legal compilers' versions: those have to salvage whole pages, this only
 * has to decide whether one paragraph is quotable, and anything it cannot
 * flatten is meant to fail `isCleanProse` below rather than be patched up.
 */
function jsxToProse(s, locals = {}) {
  let out = substituteBareExpressions(
    s
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
      .replace(/\{"\s*"\}/g, " ")
      .replace(/\{'\s*'\}/g, " "),
    locals,
  );
  // Loop until stable: one pass of /<[^>]*>/g can reassemble a tag out of a
  // nested sequence, the same reason the other compilers loop.
  let prev;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  } while (out !== prev);
  return out
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this flattened prose safe to publish as a page's description?
 *
 * A leftover brace means an expression this script could not resolve
 * ({status?.githubUsername ? ... : "your"}), and a sentence built around a
 * value we do not have is exactly the kind of thing the assistant would repeat
 * as fact. Reject it and let a later candidate, or none, win.
 */
function isCleanProse(text) {
  if (!text) return false;
  if (/[{}]/.test(text)) return false;
  if (text.length < 25 || text.length > 700) return false;
  // Needs at least one sentence's worth of words, not a stray label.
  return text.split(/\s+/).length >= 6;
}

/**
 * Every `<h1>...</h1>` immediately followed by a `<p>...</p>`, flattened.
 *
 * Pages carry more than one such pair (a loaded state and an empty state, for
 * instance) and the first is not always the quotable one, so this returns all
 * of them in source order and the caller takes the first that survives
 * isCleanProse.
 */
function extractHeadingPairs(source) {
  const locals = readLocalConstants(source);
  const pairs = [];
  const re =
    /<h1\b[^>]*>([\s\S]*?)<\/h1>\s*(?:\{\s*\/\*[\s\S]*?\*\/\s*\}\s*)*(?:<p\b[^>]*>([\s\S]*?)<\/p>)?/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    pairs.push({
      heading: jsxToProse(m[1] ?? "", locals),
      body: jsxToProse(m[2] ?? "", locals),
    });
  }
  return pairs;
}

/**
 * Local component files a page imports, in import order.
 *
 * Roughly half the app pages render their own title, and the other half hand
 * it to a component (/dashboard is <ScanHero />, the credit pages are one
 * <CreditTopUpRoute />). Following the import one hop reaches those. One hop
 * only: past that we are no longer reading the page's own header, we are
 * reading whatever heading happens to exist somewhere downstream, and this
 * file must not describe a page from a component it does not actually own.
 */
function importedComponentFiles(source) {
  const files = [];
  for (const m of source.matchAll(/from "@\/(components\/[^"]+)"/g)) {
    for (const ext of [".tsx", ".ts"]) {
      const candidate = join(ROOT, `${m[1]}${ext}`);
      if (existsSync(candidate)) {
        files.push(candidate);
        break;
      }
    }
  }
  return files;
}

/**
 * The route this page redirects to, when it is nothing but a redirect.
 * "/" is the obvious one: it renders no content of its own, and describing it
 * as an undocumented page would be worse than saying where it sends people.
 */
function extractRedirect(source, routesTable) {
  const m = source.match(
    /\b(?:permanentRedirect|redirect)\(\s*(?:ROUTES\.([A-Z0-9_]+)|"([^"]+)")\s*\)/,
  );
  if (!m) return null;
  return m[1] ? (routesTable[m[1]] ?? null) : m[2];
}

/**
 * The `title:` and `description:` passed to pageMetadata(), and the first
 * argument of privatePageMetadata().
 *
 * privatePageMetadata's description is APP_DESCRIPTION for every page that
 * uses it, so it is deliberately not read: repeating the site-wide tagline
 * under 15 different routes would tell a reader nothing and cost budget.
 */
function extractMetadata(source) {
  const priv = source.match(/privatePageMetadata\(\s*"([^"]+)"/);
  if (priv) return { title: priv[1], description: null, isPrivate: true };

  const block = source.match(/pageMetadata\(\{([\s\S]*?)\n\}\)/);
  if (!block) return { title: null, description: null, isPrivate: false };

  const body = block[1];
  const locals = readLocalConstants(source);
  const titleLiteral =
    body.match(/\btitle:\s*"([^"]+)"/) ||
    body.match(/\btitle:\s*([A-Z][A-Za-z0-9_]*),/);
  const title = titleLiteral
    ? (locals[titleLiteral[1]] ?? titleLiteral[1])
    : null;
  // Plain string, template literal, or a bare local constant. A template is
  // only usable when every ${} in it resolves, which the caller checks via
  // isCleanProse after substitution.
  const desc =
    body.match(/\bdescription:\s*"((?:[^"\\]|\\.)*)"/) ||
    body.match(/\bdescription:\s*`((?:[^`\\]|\\.)*)`/) ||
    body.match(/\bdescription:\s*([A-Z][A-Za-z0-9_]*),/);
  const rawDesc = desc
    ? (locals[desc[1]] ?? desc[1].replace(/\\(.)/g, "$1"))
    : null;
  return {
    title,
    description: rawDesc ? resolveTemplate(rawDesc, locals) : null,
    isPrivate: /\bnoIndex:\s*true/.test(body),
  };
}

let freeScanLimit = null;
/** CONFIG_BILLING_FREE_LIMIT, read once from config-values.ts. */
function readFreeScanLimit() {
  if (freeScanLimit !== null) return freeScanLimit;
  const src = readFileSync(join(ROOT, "lib", "config", "config-values.ts"), "utf8");
  const m = src.match(/CONFIG_BILLING_FREE_LIMIT\s*=\s*(\d+)/);
  freeScanLimit = m ? Number(m[1]) : 0;
  return freeScanLimit;
}

/**
 * ROUTES from lib/config/client-constants.ts, as constant name -> path.
 * Only the plain string entries; the function-valued ones (BROWSER, HOST) are
 * per-entity URLs with no fixed path to key a nav label on.
 */
function readRoutesTable() {
  const src = readFileSync(
    join(ROOT, "lib", "config", "client-constants.ts"),
    "utf8",
  );
  const block = src.match(/export const ROUTES = \{([\s\S]*?)\n\} as const;/);
  if (!block) {
    console.error(
      "[compile-features-knowledge] could not find the ROUTES table in lib/config/client-constants.ts.",
    );
    process.exit(1);
  }
  const out = {};
  for (const m of block[1].matchAll(/^\s*([A-Z0-9_]+):\s*"([^"]+)",/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

/**
 * Navigation labels the app already gives each route, keyed by path.
 *
 * Two sources, both real UI: the signed-in header's tab strip and the
 * Cmd-K palette. The palette is the richer of the two (it carries the
 * `keywords` list, which is literally a hand-written set of the other words
 * people call the feature) and it wins on a conflict, because those keywords
 * are the whole reason to read it.
 */
function readNavLabels(routes) {
  const labels = new Map();

  const addFromSource = (file, withKeywords) => {
    const path = join(ROOT, file);
    if (!existsSync(path)) return;
    const src = readFileSync(path, "utf8");
    for (const m of src.matchAll(
      /label:\s*"([^"]+)",\s*\n\s*href:\s*ROUTES\.([A-Z0-9_]+),(?:[\s\S]{0,160}?keywords:\s*"([^"]+)",)?/g,
    )) {
      const route = routes[m[2]];
      if (!route) continue;
      const existing = labels.get(route);
      if (existing && !withKeywords) continue;
      labels.set(route, {
        label: m[1],
        keywords: withKeywords && m[3] ? m[3] : (existing?.keywords ?? null),
      });
    }
    // The header writes the pair the other way round: { href, label }.
    for (const m of src.matchAll(
      /href:\s*ROUTES\.([A-Z0-9_]+),\s*label:\s*"([^"]+)"/g,
    )) {
      const route = routes[m[1]];
      if (!route || labels.has(route)) continue;
      labels.set(route, { label: m[2], keywords: null });
    }
  };

  addFromSource("components/shared/command-palette.tsx", true);
  addFromSource("components/scanner/header.tsx", false);
  return labels;
}

/** DISALLOWED_PATHS from lib/seo/routes.ts: the crawler-blocked prefixes,
 *  which for our purposes is the closest thing in code to "needs a session or
 *  a token". */
function readDisallowedPaths() {
  const src = readFileSync(join(ROOT, "lib", "seo", "routes.ts"), "utf8");
  const block = src.match(
    /export const DISALLOWED_PATHS: readonly string\[\] = \[([\s\S]*?)\n\] as const;/,
  );
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Walk app/ for every page.tsx, returning { route, dir }. */
function listRoutes(dir = APP_DIR, route = "") {
  const found = [];
  if (existsSync(join(dir, "page.tsx"))) {
    found.push({ route: route || "/", dir });
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name === "node_modules") continue;
    // Next route groups "(marketing)" do not appear in the URL.
    const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
    found.push(...listRoutes(join(dir, entry.name), route + segment));
  }
  return found;
}

function groupFor(route) {
  for (const g of GROUPS) {
    if (g.prefix && (route === g.prefix || route.startsWith(`${g.prefix}/`)))
      return g.heading;
    if (g.match && g.match(route)) return g.heading;
  }
  return DEFAULT_GROUP;
}

function describeRoute({ route, dir }, navLabels, disallowed) {
  const pageSrc = readFileSync(join(dir, "page.tsx"), "utf8");
  const layoutPath = join(dir, "layout.tsx");
  const layoutSrc = existsSync(layoutPath)
    ? readFileSync(layoutPath, "utf8")
    : "";

  // Metadata may live in either file: a server page exports it directly, a
  // "use client" page cannot and puts it in a sibling layout.
  const meta = layoutSrc.includes("Metadata")
    ? extractMetadata(layoutSrc)
    : extractMetadata(pageSrc);
  const fallbackMeta =
    meta.title || meta.description ? null : extractMetadata(pageSrc);

  const title = meta.title ?? fallbackMeta?.title ?? null;
  const rawDescription = meta.description ?? fallbackMeta?.description ?? null;
  const description = rawDescription
    ? resolveTemplate(rawDescription).replace(/\s+/g, " ").trim()
    : null;

  const pairs = extractHeadingPairs(pageSrc);
  const onPage = pairs.find(
    (p) => isCleanProse(p.body) && p.heading && !/[{}]/.test(p.heading),
  );

  const nav = navLabels.get(route) ?? null;
  const needsSession = disallowed.some(
    (p) => route === p || route.startsWith(p.endsWith("/") ? p : `${p}/`),
  );

  return {
    route,
    title,
    description: description && isCleanProse(description) ? description : null,
    heading: onPage?.heading ?? null,
    onPage: onPage?.body ?? null,
    nav,
    needsSession,
  };
}

function renderRoute(entry) {
  const lines = [`### ${entry.nav?.label ?? entry.heading ?? entry.title ?? entry.route}`];
  lines.push(`Route: ${entry.route}`);
  lines.push(
    `Access: ${entry.needsSession ? "signed in (or a share token)" : "public, no account needed"}`,
  );
  if (entry.title) lines.push(`Page title: ${entry.title}`);
  if (entry.nav?.label) lines.push(`In-app navigation label: ${entry.nav.label}`);
  if (entry.nav?.keywords)
    lines.push(`Also called: ${entry.nav.keywords.split(/\s+/).join(", ")}`);
  lines.push("");
  // The page's own subtitle first: it is written for someone standing on the
  // page and says what the thing does. The meta description is written for a
  // search result and repeats the product pitch more often.
  if (entry.onPage) lines.push(entry.onPage);
  else if (entry.description) lines.push(entry.description);
  else
    lines.push(
      `No description could be read from the source for this page. Say you are not sure what it covers rather than guessing, and point the user at ${entry.route}.`,
    );
  lines.push("");
  return lines.join("\n");
}

function build() {
  const routesTable = readRoutesTable();
  const navLabels = readNavLabels(routesTable);
  const disallowed = readDisallowedPaths();

  const routes = listRoutes()
    .filter(
      ({ route }) =>
        !SKIP_PREFIXES.some(
          (p) => route === p || route.startsWith(p.endsWith("/") ? p : `${p}/`),
        ),
    )
    .sort((a, b) => a.route.localeCompare(b.route));

  if (routes.length < MIN_ROUTES) {
    console.error(
      `[compile-features-knowledge] found only ${routes.length} routes under app/, expected at least ${MIN_ROUTES}. The walk is broken, not the app.`,
    );
    process.exit(1);
  }

  const described = routes.map((r) => describeRoute(r, navLabels, disallowed));

  // A run where nothing resolved means the metadata/JSX shapes moved and every
  // route would be published as "no description available". Fail instead.
  const withProse = described.filter((e) => e.onPage || e.description).length;
  if (withProse < routes.length / 3) {
    console.error(
      `[compile-features-knowledge] only ${withProse} of ${routes.length} routes yielded any description. The extractors no longer match the current page shapes.`,
    );
    process.exit(1);
  }

  const byGroup = new Map();
  for (const entry of described) {
    const heading = groupFor(entry.route);
    if (!byGroup.has(heading)) byGroup.set(heading, []);
    byGroup.get(heading).push(entry);
  }
  // DEFAULT_GROUP first: it holds the features people actually ask about.
  const orderedHeadings = [
    DEFAULT_GROUP,
    ...[...byGroup.keys()].filter((h) => h !== DEFAULT_GROUP).sort(),
  ].filter((h) => byGroup.has(h));

  const now = new Date();
  const out = [
    "# VulnRadar Product Features: AI Knowledge",
    "",
    `_Auto-compiled from the routes under \`app/\` on ${now.toISOString().slice(0, 10)}._`,
    "",
    "Every user-facing page this deployment ships, with the purpose read out",
    "of the page's own metadata, heading and subtitle. If a feature is not",
    "listed here, this build does not have it. If it is listed here, it",
    "exists and the route shown is where it lives.",
    "",
    "Where a page says no description could be read, that means the source",
    "did not state one in a form this compiler could quote. It does NOT mean",
    "the page is unimportant, and it is not licence to invent what it does.",
    "",
    "---",
    "",
  ];

  for (const heading of orderedHeadings) {
    out.push(`## ${heading}`, "");
    for (const entry of byGroup.get(heading)) out.push(renderRoute(entry));
  }

  writeFileSync(OUTPUT, out.join("\n"), "utf8");
  console.log(
    `[compile-features-knowledge] wrote ${relative(ROOT, OUTPUT)} (${routes.length} routes, ${withProse} with prose)`,
  );
}

build();
