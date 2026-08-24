/**
 * Software inventory + version-to-CVE correlation.
 *
 * Competitors (Nessus, Qualys, Snyk) fingerprint the software a target is
 * actually running and then list the known CVEs for each detected version.
 * VulnRadar already enriches CVEs a detector NAMED (lib/scanner/cve-enrichment.ts)
 * and runs live OSV.dev lookups for detected CLIENT-SIDE JS libraries
 * (lib/scanner/osv-check.ts). This module adds the missing general angle:
 * "what software is this HOST running, and does any detected version have
 * known CVEs?"
 *
 * Two stages, both reusing what the scan already gathered -- no extra fetch:
 *
 *  1. fingerprintSoftware() reads the response the pipeline already has (the
 *     Server / X-Powered-By / Via / X-AspNet-Version / X-Generator headers,
 *     the <meta name="generator"> tag, a few well-known CMS body markers, and
 *     the client-side libraries osv-check.ts's own extractDetectedLibraries
 *     already recognizes) and builds a structured inventory of
 *     { name, version?, category, source }. A name with no version is still
 *     inventory -- it is listed, just not eligible for CVE correlation.
 *
 *  2. correlateSoftwareCves() takes only the version-bearing, catalogued,
 *     non-JS-library items and asks a CVE source whether that EXACT version
 *     has known CVEs. OSV.dev is preferred for packaged ecosystems it covers
 *     (reusing lib/scanner/osv-lookup.ts's queryOsv); server / language /
 *     runtime software that has no clean OSV package is looked up against
 *     NVD's CPE-matched REST API instead (keyless works at a lower rate
 *     limit; an optional NVD_API_KEY raises it). Client-side JS libraries are
 *     LISTED here but never CVE-correlated -- osv-check.ts already owns their
 *     findings, so re-querying them would only double-report.
 *
 * Best-effort by construction, exactly like the reputation / OSV / KEV
 * modules: every external call has its own try/catch and bounded timeout, a
 * per-host+per-item cache avoids re-querying, the number of external lookups
 * per scan is hard-capped (and the cap is logged when hit), and nothing here
 * ever throws or fails the scan. A vulnerable version raises ONE aggregated
 * finding listing its CVEs (not one finding per CVE); because that finding's
 * text names the CVE IDs, the existing cve-enrichment pass then annotates it
 * with CISA KEV / FIRST.org EPSS for free, with no change to that module.
 *
 * SSRF: a detected name/version is only ever DATA in a fixed OSV/NVD API URL
 * (a POST body, or a virtualMatchString query param), never a URL that gets
 * fetched. The external CVE lookups are additionally skipped for raw-IP and
 * private/internal hosts, the same guard the other host-based lookups use.
 */

import { isIP } from "net";
import { APP_NAME } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { generateId, getHeader } from "./_helpers";
import { isPrivateHostname } from "./safe-fetch";
import { queryOsv, type OsvVuln } from "./osv-lookup";
import { extractDetectedLibraries } from "./osv-check";
import { computeCvssBaseScore, type CvssMetrics } from "./cvss";
import type { Category, Severity, Vulnerability } from "./types";

const NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";

/** Hard cap on external CVE lookups per scan. A page can fingerprint several
 *  version-bearing components; this bounds how many turn into a network call
 *  so one scan can never hammer OSV/NVD. Reaching it is logged (see below). */
const MAX_CVE_LOOKUPS = 8;

/** CVE IDs listed on a single aggregated finding. A long-lived server
 *  component can carry dozens of historical CVEs against an old version;
 *  listing every one floods the finding, so the rest are summarized as a
 *  count. */
const MAX_CVES_LISTED = 15;

/** Defensive cap on total inventory items surfaced, so result_meta stays
 *  small even on a page that references many script tags. */
const MAX_INVENTORY_ITEMS = 40;

/** Per host+item cache TTL. Software fingerprints are stable across a rescan,
 *  so a repeat scan of the same host reuses the verdict instead of re-querying. */
const CVE_CACHE_TTL_MS = 30 * 60 * 1000;

// ── Public types ────────────────────────────────────────────────────────────

export type SoftwareCategory =
  "server" | "language" | "runtime" | "framework" | "cms" | "cdn" | "library";

export interface SoftwareItem {
  /** Canonical display name, e.g. "nginx", "Apache HTTP Server", "jQuery". */
  name: string;
  /** Exact version where the source disclosed one; absent otherwise. */
  version?: string;
  category: SoftwareCategory;
  /** Which header/marker this was read from, e.g. "Server header". */
  source: string;
}

/** Per-item CVE verdict distinct from "clean": "unknown" means we could not
 *  determine it (lookup capped or the source was unreachable), NEVER that the
 *  version is safe -- mirroring the reputation module's unavailable != clean. */
export type SoftwareCveStatus = "clean" | "vulnerable" | "unknown";

export interface SoftwareInventoryEntry extends SoftwareItem {
  /** Only set for a version-bearing, catalogued, correlated item. */
  cveStatus?: SoftwareCveStatus;
  /** Present only when cveStatus is "vulnerable". */
  cve?: {
    count: number;
    cveIds: string[];
    severity: Severity;
    source: "OSV.dev" | "NVD";
  };
}

export interface SoftwareInventorySummary {
  host: string;
  analyzedAt: string;
  items: SoftwareInventoryEntry[];
  itemCount: number;
  /** Items whose exact version has known CVEs (each also raises one finding). */
  vulnerableCount: number;
}

export interface SoftwareInventoryResult {
  inventory: SoftwareInventorySummary;
  findings: Vulnerability[];
}

// ── Fingerprint catalog: raw token -> canonical name + category ─────────────

interface Canonical {
  name: string;
  category: SoftwareCategory;
}

/** Lowercased product token (from a Server / X-Powered-By value) -> canonical. */
const PRODUCT_MAP: Record<string, Canonical> = {
  nginx: { name: "nginx", category: "server" },
  openresty: { name: "OpenResty", category: "server" },
  apache: { name: "Apache HTTP Server", category: "server" },
  "microsoft-iis": { name: "Microsoft IIS", category: "server" },
  litespeed: { name: "LiteSpeed", category: "server" },
  caddy: { name: "Caddy", category: "server" },
  jetty: { name: "Jetty", category: "server" },
  gunicorn: { name: "Gunicorn", category: "server" },
  waitress: { name: "Waitress", category: "server" },
  openssl: { name: "OpenSSL", category: "runtime" },
  php: { name: "PHP", category: "language" },
  python: { name: "Python", category: "runtime" },
  werkzeug: { name: "Werkzeug", category: "framework" },
  express: { name: "Express", category: "framework" },
  "next.js": { name: "Next.js", category: "framework" },
  nextjs: { name: "Next.js", category: "framework" },
  "asp.net": { name: "ASP.NET", category: "framework" },
  servlet: { name: "Servlet", category: "runtime" },
  passenger: { name: "Phusion Passenger", category: "server" },
  tomcat: { name: "Apache Tomcat", category: "server" },
};

/** Bare (versionless) tokens that identify a CDN/proxy in Server / Via. */
const CDN_TOKENS: Record<string, string> = {
  cloudflare: "Cloudflare",
  cloudfront: "Amazon CloudFront",
  varnish: "Varnish",
  fastly: "Fastly",
  akamaighost: "Akamai",
  sucuri: "Sucuri",
};

/** Leading token of a generator string -> canonical CMS name. */
const CMS_GENERATOR_MAP: Record<string, string> = {
  wordpress: "WordPress",
  drupal: "Drupal",
  "joomla!": "Joomla",
  joomla: "Joomla",
  typo3: "TYPO3",
  ghost: "Ghost",
  hugo: "Hugo",
  gatsby: "Gatsby",
  wix: "Wix",
  squarespace: "Squarespace",
  shopify: "Shopify",
  mediawiki: "MediaWiki",
  magento: "Magento",
  jekyll: "Jekyll",
  eleventy: "Eleventy",
  "11ty": "Eleventy",
  hexo: "Hexo",
  docusaurus: "Docusaurus",
  "craft cms": "Craft CMS",
  craftcms: "Craft CMS",
  webflow: "Webflow",
  hubspot: "HubSpot",
  pelican: "Pelican",
  middleman: "Middleman",
  nikola: "Nikola",
  vuepress: "VuePress",
  bookstack: "BookStack",
  concrete5: "Concrete CMS",
  "concrete cms": "Concrete CMS",
  prestashop: "PrestaShop",
  contao: "Contao",
  silverstripe: "SilverStripe",
};

// ── CVE lookup catalog: canonical name -> where to look it up ────────────────

interface CveLookup {
  /** OSV.dev ecosystem + package, when this maps to a packaged ecosystem. */
  osv?: { ecosystem: string; package: string };
  /** NVD CPE vendor:product, for server/runtime software OSV doesn't cover. */
  nvd?: { vendor: string; product: string };
}

/** Only version-bearing items whose canonical name is a key here are ever
 *  looked up. OSV is preferred where a real ecosystem package exists; NVD's
 *  CPE match is used for server/runtime/CMS software that has no clean OSV
 *  package. A wrong or missing mapping degrades to "no finding" (0 matches),
 *  never a false positive, so the table stays conservative. */
const CVE_CATALOG: Record<string, CveLookup> = {
  nginx: { nvd: { vendor: "f5", product: "nginx" } },
  "apache http server": { nvd: { vendor: "apache", product: "http_server" } },
  "apache tomcat": { nvd: { vendor: "apache", product: "tomcat" } },
  openssl: { nvd: { vendor: "openssl", product: "openssl" } },
  php: { nvd: { vendor: "php", product: "php" } },
  "microsoft iis": {
    nvd: { vendor: "microsoft", product: "internet_information_services" },
  },
  wordpress: { nvd: { vendor: "wordpress", product: "wordpress" } },
  drupal: { nvd: { vendor: "drupal", product: "drupal" } },
  werkzeug: { osv: { ecosystem: "PyPI", package: "werkzeug" } },
  gunicorn: { osv: { ecosystem: "PyPI", package: "gunicorn" } },
  express: { osv: { ecosystem: "npm", package: "express" } },
  "next.js": { osv: { ecosystem: "npm", package: "next" } },
  // Angular announces its exact version in markup (ng-version="..."), so a
  // version-to-CVE lookup is meaningful here; the other body-detected client
  // frameworks are versionless and so never reach a lookup.
  angular: { osv: { ecosystem: "npm", package: "@angular/core" } },
};

// Client-side framework/tooling fingerprints read from the rendered HTML.
// Server headers and <meta generator> tags miss modern SPA/meta-frameworks
// (React, Vue, Svelte, Next, Nuxt, Astro, ...), which is what a Wappalyzer-style
// lookup surfaces. Kept to strong, low-false-positive markers; `versionRe`
// pulls a version when the markup carries one (only Angular's ng-version does).
// Every pattern is linear (no nested quantifiers) so this stays ReDoS-safe.
interface BodyMarker {
  name: string;
  category: SoftwareCategory;
  re: RegExp;
  versionRe?: RegExp;
}
const BODY_TECH_MARKERS: BodyMarker[] = [
  {
    name: "Next.js",
    category: "framework",
    re: /__NEXT_DATA__|\/_next\/static\//i,
  },
  { name: "Nuxt", category: "framework", re: /window\.__NUXT__|\/_nuxt\//i },
  {
    name: "Angular",
    category: "framework",
    re: /\sng-version=|_nghost-|_ngcontent-/i,
    versionRe: /ng-version=["']([\d.]+)["']/i,
  },
  {
    name: "Vue.js",
    category: "framework",
    re: /__VUE__|data-v-app|data-v-[0-9a-f]{6,10}=/i,
  },
  {
    name: "SvelteKit",
    category: "framework",
    re: /__sveltekit|\/_app\/immutable\//i,
  },
  { name: "Astro", category: "framework", re: /astro-island|\/_astro\//i },
  {
    name: "Remix",
    category: "framework",
    re: /__remixContext|__remixManifest/i,
  },
  { name: "Gatsby", category: "framework", re: /___gatsby|\/page-data\//i },
  {
    name: "React",
    category: "framework",
    re: /data-reactroot|react-dom(?:\.production|\.development|\.min)?\.js|_reactListening/i,
  },
  {
    name: "Preact",
    category: "framework",
    re: /preact(?:\.min)?\.js|__PREACT/i,
  },
  {
    name: "SolidJS",
    category: "framework",
    re: /_\$HY\b|solid-js/i,
  },
  { name: "Qwik", category: "framework", re: /q:container=|\/build\/q-/i },
  {
    name: "Ember.js",
    category: "framework",
    re: /\bember-application\b|id=["']ember\d/i,
  },
  {
    name: "Alpine.js",
    category: "framework",
    re: /\sx-data=|alpinejs(?:@|\/)/i,
  },
  {
    name: "htmx",
    category: "framework",
    re: /\shx-(?:get|post|target|swap)=|htmx(?:\.org|\.min)/i,
  },
  { name: "Backbone.js", category: "framework", re: /backbone(?:\.min)?\.js/i },
  { name: "Tailwind CSS", category: "library", re: /cdn\.tailwindcss\.com/i },
  {
    name: "Bootstrap",
    category: "library",
    re: /(?:cdn\.jsdelivr\.net\/npm\/bootstrap|\/bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css))/i,
  },
  {
    name: "jQuery",
    category: "library",
    re: /\/jquery(?:-\d[\d.]*)?(?:\.slim)?(?:\.min)?\.js/i,
  },
  { name: "Stripe.js", category: "library", re: /js\.stripe\.com\/v\d/i },
  {
    name: "Google Analytics",
    category: "library",
    re: /google-analytics\.com\/(?:analytics|ga)\.js|googletagmanager\.com\/gtag\/js/i,
  },
  {
    name: "Google Tag Manager",
    category: "library",
    re: /googletagmanager\.com\/gtm\.js/i,
  },
];

// Hosting/platform fingerprints keyed on a response header. Presence alone is
// the signal for the id-style headers (their value is opaque); the rest match a
// value. Surfaced as "cdn" -- the inventory's closest category for "where this
// site is served from" (Cloudflare, Vercel, Netlify, ...).
interface HostingMarker {
  name: string;
  header: string;
  valueRe?: RegExp;
}
const HOSTING_HEADER_MARKERS: HostingMarker[] = [
  { name: "Vercel", header: "x-vercel-id" },
  { name: "Netlify", header: "x-nf-request-id" },
  { name: "Fly.io", header: "fly-request-id" },
  { name: "Render", header: "x-render-origin-server" },
  { name: "GitHub Pages", header: "server", valueRe: /github\.com/i },
  { name: "Heroku", header: "via", valueRe: /vegur/i },
  { name: "bunny.net", header: "server", valueRe: /bunnycdn/i },
];

// Backend framework/runtime fingerprints keyed on a Set-Cookie name. The name
// alone is a strong, low-false-positive signal for the framework that set it.
interface CookieMarker {
  name: string;
  category: SoftwareCategory;
  re: RegExp;
}
const COOKIE_MARKERS: CookieMarker[] = [
  { name: "Laravel", category: "framework", re: /\blaravel_session=/i },
  { name: "Django", category: "framework", re: /\bcsrftoken=/i },
  { name: "Express", category: "framework", re: /\bconnect\.sid=/i },
  { name: "ASP.NET", category: "framework", re: /\bASP\.NET_SessionId=/i },
  { name: "Java", category: "runtime", re: /\bJSESSIONID=/i },
  { name: "PHP", category: "language", re: /\bPHPSESSID=/i },
];

// ── Fingerprinting (pure, no network) ───────────────────────────────────────

// The trailing optional [a-z] keeps OpenSSL/Apache-style patch letters
// (e.g. "1.1.1f"), which are a DISTINCT release from the bare "1.1.1" and
// so matter for an accurate version-to-CVE match.
const NAME_VERSION_RE = /([A-Za-z][A-Za-z0-9._+-]*)\/(\d+(?:\.\d+)*[a-z]?)/g;
const META_GENERATOR_RE =
  /<meta\b[^>]*\bname=["']generator["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i;
const META_GENERATOR_RE_ALT =
  /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']generator["'][^>]*>/i;

function pushItem(
  out: SoftwareItem[],
  seen: Map<string, number>,
  item: SoftwareItem,
): void {
  const key = item.name.toLowerCase();
  const existingIdx = seen.get(key);
  if (existingIdx === undefined) {
    seen.set(key, out.length);
    out.push(item);
    return;
  }
  // Same software seen twice: keep whichever carries a version (a generator
  // tag's "WordPress 6.1" beats a versionless /wp-content/ body marker).
  const existing = out[existingIdx];
  if (!existing.version && item.version) out[existingIdx] = item;
}

/** Parse "Name/1.2.3 Other/4.5" style values into canonical items. */
function parseProductTokens(
  value: string,
  source: string,
  out: SoftwareItem[],
  seen: Map<string, number>,
): void {
  let matched = false;
  for (const m of value.matchAll(NAME_VERSION_RE)) {
    const canonical = PRODUCT_MAP[m[1].toLowerCase()];
    if (!canonical) continue;
    matched = true;
    pushItem(out, seen, {
      name: canonical.name,
      version: m[2],
      category: canonical.category,
      source,
    });
  }
  // Bare CDN/proxy tokens (no version), e.g. Server: cloudflare.
  const lower = value.toLowerCase();
  for (const [token, name] of Object.entries(CDN_TOKENS)) {
    if (lower.includes(token)) {
      pushItem(out, seen, { name, category: "cdn", source });
      matched = true;
    }
  }
  // A versionless but recognized product token (e.g. X-Powered-By: Express).
  if (!matched) {
    const canonical = PRODUCT_MAP[value.trim().toLowerCase()];
    if (canonical) {
      pushItem(out, seen, {
        name: canonical.name,
        category: canonical.category,
        source,
      });
    }
  }
}

function parseGenerator(
  value: string,
  source: string,
  out: SoftwareItem[],
  seen: Map<string, number>,
): void {
  const trimmed = value.trim();
  const firstToken = trimmed.split(/[\s]+/)[0]?.toLowerCase() ?? "";
  const name = CMS_GENERATOR_MAP[firstToken];
  if (!name) return;
  // Version: first x or x.y(.z) after the name.
  const vMatch = trimmed.match(/(\d+(?:\.\d+){0,2})/);
  pushItem(out, seen, {
    name,
    version: vMatch ? vMatch[1] : undefined,
    category: "cms",
    source,
  });
}

/**
 * Build the software inventory from the response the scan already has. Pure
 * and synchronous -- no network, no throw. `body` may be empty (e.g. a
 * non-HTML or raw-IP target), in which case only header-derived items appear.
 */
export function fingerprintSoftware(
  headers: Headers,
  body: string,
  url: string,
): SoftwareItem[] {
  const out: SoftwareItem[] = [];
  const seen = new Map<string, number>();

  const server = getHeader(headers, "server");
  if (server) parseProductTokens(server, "Server header", out, seen);

  const powered = getHeader(headers, "x-powered-by");
  if (powered) {
    for (const part of powered.split(",")) {
      parseProductTokens(part, "X-Powered-By header", out, seen);
    }
  }

  const aspNet = getHeader(headers, "x-aspnet-version");
  if (aspNet && /\d/.test(aspNet)) {
    pushItem(out, seen, {
      name: "ASP.NET",
      version: aspNet.trim(),
      category: "framework",
      source: "X-AspNet-Version header",
    });
  }

  const via = getHeader(headers, "via");
  if (via) {
    const lower = via.toLowerCase();
    for (const [token, name] of Object.entries(CDN_TOKENS)) {
      if (lower.includes(token)) {
        pushItem(out, seen, { name, category: "cdn", source: "Via header" });
      }
    }
  }

  for (const marker of HOSTING_HEADER_MARKERS) {
    const value = getHeader(headers, marker.header);
    if (value && (!marker.valueRe || marker.valueRe.test(value))) {
      pushItem(out, seen, {
        name: marker.name,
        category: "cdn",
        source: `${marker.header} header`,
      });
    }
  }

  const setCookie = getHeader(headers, "set-cookie");
  if (setCookie) {
    for (const marker of COOKIE_MARKERS) {
      if (marker.re.test(setCookie)) {
        pushItem(out, seen, {
          name: marker.name,
          category: marker.category,
          source: "Set-Cookie",
        });
      }
    }
  }

  const xGenerator = getHeader(headers, "x-generator");
  if (xGenerator) parseGenerator(xGenerator, "X-Generator header", out, seen);

  // WordPress often only announces itself via X-Pingback / wp-json Link.
  if (getHeader(headers, "x-pingback") || getHeader(headers, "x-wp-total")) {
    pushItem(out, seen, {
      name: "WordPress",
      category: "cms",
      source: "WordPress response header",
    });
  }

  if (body) {
    const genMatch =
      body.match(META_GENERATOR_RE) ?? body.match(META_GENERATOR_RE_ALT);
    if (genMatch) parseGenerator(genMatch[1], "meta generator", out, seen);

    if (/\/wp-(?:content|includes)\//i.test(body)) {
      pushItem(out, seen, {
        name: "WordPress",
        category: "cms",
        source: "wp-content markup",
      });
    }
    if (
      /Drupal\.settings|data-drupal-|\/sites\/(?:default|all)\//i.test(body)
    ) {
      pushItem(out, seen, {
        name: "Drupal",
        category: "cms",
        source: "Drupal markup",
      });
    }

    // Client-side framework/tooling markers (React/Vue/Angular/Next/etc.).
    for (const marker of BODY_TECH_MARKERS) {
      if (marker.re.test(body)) {
        const version = marker.versionRe
          ? body.match(marker.versionRe)?.[1]
          : undefined;
        pushItem(out, seen, {
          name: marker.name,
          version,
          category: marker.category,
          source: "page markup",
        });
      }
    }

    // Reuse osv-check.ts's own client-side library detection so the same
    // libraries it may raise OSV findings for also appear in the inventory
    // listing. These are LISTED only; osv-check owns their CVE findings.
    try {
      for (const lib of extractDetectedLibraries(body, url)) {
        pushItem(out, seen, {
          name: lib.name,
          version: lib.version,
          category: "library",
          source: "script src",
        });
      }
    } catch {
      /* detection is best-effort; a parse hiccup just drops library rows */
    }
  }

  return out.slice(0, MAX_INVENTORY_ITEMS);
}

// ── CVE correlation ─────────────────────────────────────────────────────────

const CVE_ID_RE = /^CVE-\d{4}-\d{4,}$/i;

const CVSS_METRIC_VALUES: Record<string, string[]> = {
  AV: ["N", "A", "L", "P"],
  AC: ["L", "H"],
  PR: ["N", "L", "H"],
  UI: ["N", "R"],
  S: ["U", "C"],
  C: ["N", "L", "H"],
  I: ["N", "L", "H"],
  A: ["N", "L", "H"],
};

/** Parse a CVSS 3.x vector into computeCvssBaseScore's input, or null. Same
 *  shape osv-check.ts uses for its own OSV advisories. */
function parseCvssVector(vector: string): CvssMetrics | null {
  const values: Record<string, string> = {};
  for (const part of vector.split("/")) {
    const [key, value] = part.split(":");
    if (key && value) values[key] = value;
  }
  for (const [key, allowed] of Object.entries(CVSS_METRIC_VALUES)) {
    if (!allowed.includes(values[key])) return null;
  }
  return {
    av: values.AV as CvssMetrics["av"],
    ac: values.AC as CvssMetrics["ac"],
    pr: values.PR as CvssMetrics["pr"],
    ui: values.UI as CvssMetrics["ui"],
    scope: values.S as CvssMetrics["scope"],
    c: values.C as CvssMetrics["c"],
    i: values.I as CvssMetrics["i"],
    a: values.A as CvssMetrics["a"],
  };
}

/** Same NVD severity bands used across this codebase (see lib/scanner/cvss.ts). */
function severityFromScore(score: number): Severity {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  if (score > 0) return "low";
  return "info";
}

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

interface CveMatch {
  cveIds: string[];
  count: number;
  severity: Severity;
  source: "OSV.dev" | "NVD";
}

/** "clean"/"vulnerable"/"unknown" is meaningful; null means "not looked up". */
type CorrelationOutcome =
  | { status: "clean" }
  | { status: "vulnerable"; match: CveMatch }
  | { status: "unknown" };

/**
 * OSV.dev lookup for a packaged ecosystem. Reuses queryOsv (its own timeout,
 * fail-open, non-throwing contract). queryOsv cannot tell "none" from
 * "failed", so an empty result is reported as "clean" here -- acceptable
 * because it only ever suppresses a finding, never invents one.
 */
async function correlateViaOsv(
  ecosystem: string,
  pkg: string,
  version: string,
): Promise<CorrelationOutcome> {
  const vulns = await queryOsv(ecosystem, pkg, version);
  if (vulns.length === 0) return { status: "clean" };

  const cveIds = collectOsvCveIds(vulns);
  let severity: Severity = "info";
  let scored = false;
  for (const v of vulns) {
    for (const sev of v.severity) {
      if (sev.type !== "CVSS_V3") continue;
      const metrics = parseCvssVector(sev.score);
      if (!metrics) continue;
      severity = maxSeverity(
        severity,
        severityFromScore(computeCvssBaseScore(metrics)),
      );
      scored = true;
    }
  }
  // A confirmed exact-version advisory with no parseable CVSS is treated as
  // "high", the same uniform floor osv-check.ts uses for that case.
  if (!scored) severity = "high";

  return {
    status: "vulnerable",
    match: {
      cveIds,
      count: cveIds.length > 0 ? cveIds.length : vulns.length,
      severity,
      source: "OSV.dev",
    },
  };
}

function collectOsvCveIds(vulns: OsvVuln[]): string[] {
  const ids = new Set<string>();
  for (const v of vulns) {
    for (const alias of v.aliases) {
      if (CVE_ID_RE.test(alias)) ids.add(alias.toUpperCase());
    }
  }
  return Array.from(ids);
}

interface NvdCveItem {
  cve?: {
    id?: string;
    metrics?: {
      cvssMetricV31?: Array<{ cvssData?: { baseScore?: number } }>;
      cvssMetricV30?: Array<{ cvssData?: { baseScore?: number } }>;
      cvssMetricV2?: Array<{ cvssData?: { baseScore?: number } }>;
    };
  };
}

function nvdItemScore(item: NvdCveItem): number | null {
  const m = item.cve?.metrics;
  const score =
    m?.cvssMetricV31?.[0]?.cvssData?.baseScore ??
    m?.cvssMetricV30?.[0]?.cvssData?.baseScore ??
    m?.cvssMetricV2?.[0]?.cvssData?.baseScore;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/**
 * NVD CPE-matched lookup for server/runtime software OSV doesn't cover. The
 * vendor:product:version become a virtualMatchString cpe -- pure data in a
 * fixed API URL, never a fetched host. Keyless works at a low rate limit; an
 * optional NVD_API_KEY (read fresh, like WEB_RISK_API_KEY) raises it. Any
 * error/timeout is "unknown" (never a false "clean"); a reached-but-empty
 * result is "clean".
 */
async function correlateViaNvd(
  vendor: string,
  product: string,
  version: string,
  timeoutMs: number,
): Promise<CorrelationOutcome> {
  // Guard the CPE components to a safe charset so a weird version string can
  // never break out of the fixed query shape.
  if (!/^[A-Za-z0-9._+-]+$/.test(version)) return { status: "unknown" };
  const cpe = `cpe:2.3:a:${vendor}:${product}:${version}:*:*:*:*:*:*:*`;
  const params = new URLSearchParams({
    virtualMatchString: cpe,
    resultsPerPage: "50",
  });

  try {
    const headers: Record<string, string> = {
      "User-Agent": `${APP_NAME}/1.0 (Software Inventory CVE Lookup)`,
    };
    const apiKey = process.env.NVD_API_KEY;
    if (apiKey) headers.apiKey = apiKey;

    const res = await fetch(`${NVD_API_URL}?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { status: "unknown" };
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return { status: "unknown" };
    const record = data as {
      totalResults?: number;
      vulnerabilities?: NvdCveItem[];
    };
    const vulns = Array.isArray(record.vulnerabilities)
      ? record.vulnerabilities
      : [];
    const total =
      typeof record.totalResults === "number"
        ? record.totalResults
        : vulns.length;
    if (total === 0 || vulns.length === 0) return { status: "clean" };

    const cveIds: string[] = [];
    let severity: Severity = "info";
    let scored = false;
    for (const item of vulns) {
      const id = item.cve?.id;
      if (typeof id === "string" && CVE_ID_RE.test(id)) {
        cveIds.push(id.toUpperCase());
      }
      const score = nvdItemScore(item);
      if (score !== null) {
        severity = maxSeverity(severity, severityFromScore(score));
        scored = true;
      }
    }
    if (cveIds.length === 0) return { status: "clean" };
    if (!scored) severity = "high";

    return {
      status: "vulnerable",
      match: {
        cveIds: Array.from(new Set(cveIds)),
        count: total,
        severity,
        source: "NVD",
      },
    };
  } catch (err) {
    console.error(
      `[${APP_NAME}] software-inventory: NVD lookup failed for ${product}@${version} (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return { status: "unknown" };
  }
}

// ── Per host+item correlation cache ─────────────────────────────────────────

interface CacheEntry {
  outcome: CorrelationOutcome;
  at: number;
}
const correlationCache = new Map<string, CacheEntry>();

function cacheKey(host: string, item: SoftwareItem): string {
  return `${host.toLowerCase()}|${item.name.toLowerCase()}@${item.version}`;
}

function readCache(key: string): CorrelationOutcome | undefined {
  const entry = correlationCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CVE_CACHE_TTL_MS) {
    correlationCache.delete(key);
    return undefined;
  }
  return entry.outcome;
}

function writeCache(key: string, outcome: CorrelationOutcome): void {
  const now = Date.now();
  for (const [k, entry] of correlationCache) {
    if (now - entry.at > CVE_CACHE_TTL_MS) correlationCache.delete(k);
  }
  correlationCache.set(key, { outcome, at: now });
}

// ── Finding builder ─────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<SoftwareCategory, string> = {
  server: "web server",
  language: "language runtime",
  runtime: "runtime component",
  framework: "framework",
  cms: "content management system",
  cdn: "CDN/proxy",
  library: "library",
};

function buildSoftwareFinding(
  host: string,
  entry: SoftwareInventoryEntry,
): Vulnerability {
  const { name, version, cve } = entry;
  const match = cve!;
  const listed = match.cveIds.slice(0, MAX_CVES_LISTED);
  const moreCount = match.count - listed.length;
  const cveText =
    listed.length > 0
      ? `${listed.join(", ")}${moreCount > 0 ? `, and ${moreCount} more` : ""}`
      : `${match.count} known CVE(s)`;
  const refs =
    match.source === "OSV.dev"
      ? listed.map((id) => `https://osv.dev/vulnerability/${id}`)
      : listed.map((id) => `https://nvd.nist.gov/vuln/detail/${id}`);

  return {
    // Keyed on host + software (not the page URL), so the id is stable across
    // paths on the host and across rescans -- its remediation status carries.
    id: generateId("software-known-cve", host, `${name}@${version}`),
    title: `${name} ${version} has known vulnerabilities`,
    severity: match.severity,
    category: "supply-chain" as Category,
    description: `The host is running ${name} ${version}, detected via ${entry.source}. ${match.source} reports ${match.count} known CVE(s) affecting exactly this version.`,
    evidence: `Detected ${name} ${version} (${CATEGORY_LABEL[entry.category]}) via ${entry.source}. ${match.count} known CVE(s) affect this version per ${match.source}: ${cveText}.`,
    riskImpact:
      "Running a version with published CVEs gives an attacker a precise, pre-written target: they can match the disclosed version straight to a public exploit instead of probing blind. Internet-facing components are scanned for exactly this at scale.",
    explanation: `The version was read from the response the scan already had (${entry.source}) and matched against ${match.source} for CVEs affecting this exact release. This lists the known CVEs for the detected version; confirm each one applies to your build and configuration before prioritizing, since backported vendor patches can leave the version string unchanged.`,
    fixSteps: [
      `Upgrade ${name} to the latest patched release for your supported line.`,
      "If your distribution backports security fixes without changing the version string, confirm the specific CVEs above are patched in your build.",
      "Where the exact version does not need to be public, remove or generalize the disclosing header or generator tag to reduce fingerprinting.",
    ],
    codeExamples: [],
    references: Array.from(new Set(refs)),
    confidence: 80,
    detectionMethod: `Software inventory version-to-CVE correlation (${match.source})`,
    cwe: "CWE-1104",
    owasp: "A06:2021",
    ...(listed.length > 0 ? { cveIds: listed } : {}),
  };
}

// ── Correlation entry point ─────────────────────────────────────────────────

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Correlate a fingerprinted inventory to CVEs and build the summary + any
 * findings. Best-effort and non-throwing: bounded external lookups (capped at
 * MAX_CVE_LOOKUPS, logged when hit), per host+item cache, and every network
 * call fail-open. External lookups are skipped entirely for raw-IP and
 * private/internal hosts (the inventory is still listed).
 */
export async function correlateSoftwareCves(
  url: string,
  items: SoftwareItem[],
  cancelSignal?: AbortSignal,
): Promise<SoftwareInventoryResult | null> {
  try {
    if (items.length === 0) return null;
    const host = hostFromUrl(url) ?? url;

    // SSRF / self-hosted guard: a raw IP has no domain and a private host is
    // internal -- skip the external CVE lookups the way the other host-based
    // lookups do, but still surface the fingerprint listing.
    const externalAllowed = !isIP(host) && !isPrivateHostname(host);

    let timeoutMs = 5000;
    try {
      timeoutMs = await getSetting("SCANNER_THREAT_INTEL_API_TIMEOUT_MS");
    } catch {
      /* runtime-config unavailable: fall back to the compiled default above */
    }

    let lookupsUsed = 0;
    let cappedLogged = false;
    const entries: SoftwareInventoryEntry[] = [];
    const findings: Vulnerability[] = [];

    for (const item of items) {
      const lookup =
        item.version && item.category !== "library"
          ? CVE_CATALOG[item.name.toLowerCase()]
          : undefined;

      // Not eligible for correlation: list it as-is (name/version/category).
      if (!lookup || !externalAllowed) {
        entries.push({ ...item });
        continue;
      }

      const key = cacheKey(host, item);
      let outcome = readCache(key);

      if (outcome === undefined) {
        if (cancelSignal?.aborted) {
          entries.push({ ...item, cveStatus: "unknown" });
          continue;
        }
        if (lookupsUsed >= MAX_CVE_LOOKUPS) {
          if (!cappedLogged) {
            console.error(
              `[${APP_NAME}] software-inventory: reached the ${MAX_CVE_LOOKUPS}-lookup cap for ${host}; remaining version-bearing items were listed but not CVE-correlated.`,
            );
            cappedLogged = true;
          }
          entries.push({ ...item, cveStatus: "unknown" });
          continue;
        }
        lookupsUsed++;
        outcome = lookup.osv
          ? await correlateViaOsv(
              lookup.osv.ecosystem,
              lookup.osv.package,
              item.version!,
            )
          : lookup.nvd
            ? await correlateViaNvd(
                lookup.nvd.vendor,
                lookup.nvd.product,
                item.version!,
                timeoutMs,
              )
            : { status: "unknown" };
        writeCache(key, outcome);
      }

      if (outcome.status === "vulnerable") {
        const entry: SoftwareInventoryEntry = {
          ...item,
          cveStatus: "vulnerable",
          cve: {
            count: outcome.match.count,
            cveIds: outcome.match.cveIds.slice(0, MAX_CVES_LISTED),
            severity: outcome.match.severity,
            source: outcome.match.source,
          },
        };
        entries.push(entry);
        findings.push(buildSoftwareFinding(host, entry));
      } else {
        entries.push({ ...item, cveStatus: outcome.status });
      }
    }

    const vulnerableCount = entries.filter(
      (e) => e.cveStatus === "vulnerable",
    ).length;

    return {
      inventory: {
        host,
        analyzedAt: new Date().toISOString(),
        items: entries,
        itemCount: entries.length,
        vulnerableCount,
      },
      findings,
    };
  } catch (err) {
    console.error(
      `[${APP_NAME}] software-inventory: correlation failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Fingerprint + correlate in one call, for the single-URL scan path where the
 * response headers and body are in scope. Returns null when nothing was
 * detected (a clean host renders no panel). Never throws.
 */
export async function analyzeSoftwareInventory(
  url: string,
  headers: Headers,
  body: string,
  cancelSignal?: AbortSignal,
): Promise<SoftwareInventoryResult | null> {
  try {
    const items = fingerprintSoftware(headers, body, url);
    if (items.length === 0) return null;
    return await correlateSoftwareCves(url, items, cancelSignal);
  } catch (err) {
    console.error(
      `[${APP_NAME}] software-inventory: analysis failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── Per-host fingerprint side channel (crawl path) ──────────────────────────
//
// The single-URL path has headers+body in scope and calls
// analyzeSoftwareInventory directly. The crawl path scans each page inside
// scanSingleUrl, whose only return channel is a flat result -- so, exactly
// like lib/scanner/reputation-lookup.ts's summary side channel, each page's
// pure fingerprint is stashed here keyed by host (merged across pages, so a
// CMS marker on any page counts), and execute-crawl-scan.ts reads the merged
// set once for the main host and correlates it. Entries expire by TTL on
// write so the map can never grow unbounded.

const FINGERPRINT_TTL_MS = 5 * 60 * 1000;
const fingerprintStore = new Map<
  string,
  { items: SoftwareItem[]; at: number }
>();

function mergeItems(
  existing: SoftwareItem[],
  incoming: SoftwareItem[],
): SoftwareItem[] {
  const out = [...existing];
  const seen = new Map<string, number>();
  existing.forEach((it, i) => seen.set(it.name.toLowerCase(), i));
  for (const item of incoming) pushItem(out, seen, item);
  return out.slice(0, MAX_INVENTORY_ITEMS);
}

/** Record a page's fingerprint for `host`, merged with anything already seen. */
export function recordSoftwareFingerprint(
  host: string,
  items: SoftwareItem[],
): void {
  if (items.length === 0) return;
  const now = Date.now();
  for (const [key, entry] of fingerprintStore) {
    if (now - entry.at > FINGERPRINT_TTL_MS) fingerprintStore.delete(key);
  }
  const h = host.toLowerCase();
  const prev = fingerprintStore.get(h);
  const merged = prev ? mergeItems(prev.items, items) : items;
  fingerprintStore.set(h, { items: merged, at: now });
}

/** Read back the merged fingerprint for `host`, or undefined if none/stale. */
export function readSoftwareFingerprint(
  host: string,
): SoftwareItem[] | undefined {
  const entry = fingerprintStore.get(host.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.at > FINGERPRINT_TTL_MS) {
    fingerprintStore.delete(host.toLowerCase());
    return undefined;
  }
  return entry.items;
}

/** Test-only: clear the correlation cache and the fingerprint side channel. */
export function __resetSoftwareInventoryForTests(): void {
  correlationCache.clear();
  fingerprintStore.clear();
}
