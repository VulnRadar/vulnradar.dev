// Server-side content loader for the per-check and per-category SEO pages.
//
// Reads the 18 checks-data JSON files once (static imports, the same way
// lib/scanner/registry.ts bundles them) and exposes a small, page-friendly
// API: every documented check, lookup by id, grouping by category, and a
// count map. Deliberately JSON-only -- it does NOT pull in the detector
// modules the registry wires up, so an SEO page never drags scan-engine code
// into its render path.
//
// Every count here is derived from the same list the pages render, so a
// category page's "N checks" number always equals the number of links on it.
// (The 43 PageCheck-architecture checks in lib/scanner/checks/page-checks/**
// live outside these JSON files and are intentionally not surfaced as their
// own pages -- there is no dead link to a check that has no page.)

import type { Category, Severity } from "@/lib/scanner/types";
import { CATEGORY_META } from "@/lib/scanner/category-meta";

import headers from "@/lib/scanner/checks-data/headers.json";
import ssl from "@/lib/scanner/checks-data/ssl.json";
import tls from "@/lib/scanner/checks-data/tls.json";
import content from "@/lib/scanner/checks-data/content.json";
import cookies from "@/lib/scanner/checks-data/cookies.json";
import configuration from "@/lib/scanner/checks-data/configuration.json";
import informationDisclosure from "@/lib/scanner/checks-data/information-disclosure.json";
import dns from "@/lib/scanner/checks-data/dns.json";
import email from "@/lib/scanner/checks-data/email.json";
import api from "@/lib/scanner/checks-data/api.json";
import code from "@/lib/scanner/checks-data/code.json";
import secretsExtended from "@/lib/scanner/checks-data/secrets-extended.json";
import vibeCode from "@/lib/scanner/checks-data/vibe-code.json";
import clientSide from "@/lib/scanner/checks-data/client-side.json";
import supplyChain from "@/lib/scanner/checks-data/supply-chain.json";
import hostValidation from "@/lib/scanner/checks-data/host-validation.json";
import reputation from "@/lib/scanner/checks-data/reputation.json";
import activeProbes from "@/lib/scanner/checks-data/active-probes.json";

export interface CheckCodeExample {
  label: string;
  language: string;
  code: string;
}

/** One documented check, trimmed to the fields the SEO pages render. */
export interface SeoCheck {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  description: string;
  riskImpact: string;
  explanation: string;
  fixSteps: string[];
  codeExamples: CheckCodeExample[];
  references: string[];
  cwe?: string;
  owasp?: string;
}

// Raw JSON shape, before we normalise severity casing and drop engine-only
// fields (_idx, evidence, type). Kept loose on purpose: the JSON is the
// authority, this interface only names what we read out of it.
interface RawCheck {
  id: string;
  title: string;
  category: Category;
  severity: string;
  description: string;
  riskImpact: string;
  explanation: string;
  fixSteps?: string[];
  codeExamples?: CheckCodeExample[];
  references?: string[];
  cwe?: string;
  owasp?: string;
}

/** Category display order: the same order the JSON files load in the registry. */
export const SEO_CATEGORIES = Object.keys(CATEGORY_META) as Category[];

const RAW_BY_CATEGORY: Record<Category, RawCheck[]> = {
  headers: headers as RawCheck[],
  ssl: ssl as RawCheck[],
  tls: tls as RawCheck[],
  content: content as RawCheck[],
  cookies: cookies as RawCheck[],
  configuration: configuration as RawCheck[],
  "information-disclosure": informationDisclosure as RawCheck[],
  dns: dns as RawCheck[],
  email: email as RawCheck[],
  api: api as RawCheck[],
  code: code as RawCheck[],
  "secrets-extended": secretsExtended as RawCheck[],
  "vibe-code": vibeCode as RawCheck[],
  "client-side": clientSide as RawCheck[],
  "supply-chain": supplyChain as RawCheck[],
  "host-validation": hostValidation as RawCheck[],
  reputation: reputation as RawCheck[],
  "active-probes": activeProbes as RawCheck[],
};

function normalise(raw: RawCheck): SeoCheck {
  return {
    id: raw.id,
    title: raw.title,
    category: raw.category,
    severity: String(raw.severity).toLowerCase() as Severity,
    description: raw.description,
    riskImpact: raw.riskImpact,
    explanation: raw.explanation,
    fixSteps: raw.fixSteps ?? [],
    codeExamples: raw.codeExamples ?? [],
    references: raw.references ?? [],
    ...(raw.cwe ? { cwe: raw.cwe } : {}),
    ...(raw.owasp ? { owasp: raw.owasp } : {}),
  };
}

// Built once at module load. Flat list in category order, plus an id index
// and per-category buckets so every accessor is O(1)/O(n-in-category).
// A handful of check entries are kept in the data files only as disabled,
// deduplicated placeholders (their title carries "(disabled duplicate)" and
// their description starts with "Disabled: ..."). They are not run by the
// scanner (that registry is separate) and must not surface as public /checks
// pages, sitemap entries, or the public check count, where the internal marker
// would otherwise leak into the title, H1, and OG card.
const ALL_CHECKS: SeoCheck[] = SEO_CATEGORIES.flatMap((cat) =>
  RAW_BY_CATEGORY[cat].map(normalise),
).filter((c) => !c.title.includes("(disabled duplicate)"));

const BY_ID = new Map<string, SeoCheck>(ALL_CHECKS.map((c) => [c.id, c]));

const BY_CATEGORY = new Map<Category, SeoCheck[]>();
for (const cat of SEO_CATEGORIES) {
  BY_CATEGORY.set(
    cat,
    ALL_CHECKS.filter((c) => c.category === cat),
  );
}

/** Every documented check, in category order. */
export function getAllChecks(): SeoCheck[] {
  return ALL_CHECKS;
}

/** One check by its stable id, or undefined if no such check exists. */
export function getCheckById(id: string): SeoCheck | undefined {
  return BY_ID.get(id);
}

/** Every check in one category, in file order. */
export function getChecksInCategory(category: Category): SeoCheck[] {
  return BY_CATEGORY.get(category) ?? [];
}

/** `{ category -> number of documented checks }`, matching what pages list. */
export function getSeoCategoryCounts(): Record<Category, number> {
  const out = {} as Record<Category, number>;
  for (const cat of SEO_CATEGORIES)
    out[cat] = BY_CATEGORY.get(cat)?.length ?? 0;
  return out;
}

export function getCategoryLabel(category: Category): string {
  return CATEGORY_META[category]?.label ?? category;
}

export function getCategoryBlurb(category: Category): string {
  return CATEGORY_META[category]?.blurb ?? "";
}

// ── Per-category SEO framing ────────────────────────────────────────────────
//
// Maps each category to the head term real people search for, plus a longer
// human intro. Honest and specific: the keyword is the phrase, the intro
// says what the category actually inspects. Used by the category pages'
// generateMetadata and heading copy.

export interface CategorySeo {
  /** H1 / metadata title lead-in, e.g. "Security Headers Scanner". */
  heading: string;
  /** Head keyword phrase people search for. */
  keywords: string[];
  /** One or two sentences of real, specific intro copy. No fluff. */
  intro: string;
}

export const CATEGORY_SEO: Record<Category, CategorySeo> = {
  headers: {
    heading: "Security Headers Scanner",
    keywords: [
      "security headers scanner",
      "http security headers checker",
      "csp checker",
      "hsts checker",
    ],
    intro:
      "Check a site's HTTP response headers: Content-Security-Policy, HSTS, X-Frame-Options, referrer and permissions policy, and the dozens of value-level mistakes that weaken each one.",
  },
  ssl: {
    heading: "SSL Certificate Scanner",
    keywords: [
      "ssl scanner",
      "ssl certificate checker",
      "tls certificate check",
      "https checker",
    ],
    intro:
      "Inspect the certificate chain, signature algorithm, issuer, and expiry, and catch the HTTPS mistakes that break the padlock: mixed content, Secure cookies set over HTTP, and non-standard ports.",
  },
  tls: {
    heading: "TLS Scanner",
    keywords: [
      "tls scanner",
      "ssl tls scanner",
      "cipher suite checker",
      "tls version check",
    ],
    intro:
      "Read the negotiated TLS protocol version, cipher suite, ALPN, and OCSP stapling, and flag downgrade-prone and deprecated configurations.",
  },
  content: {
    heading: "Web Content Vulnerability Scanner",
    keywords: [
      "xss scanner",
      "open redirect scanner",
      "web content security scanner",
      "reflected parameter check",
    ],
    intro:
      "Scan page content for XSS sinks, reflected parameters, open redirects, and mixed content: the injection surface that lives in the HTML and JavaScript a page actually ships.",
  },
  cookies: {
    heading: "Cookie Security Scanner",
    keywords: [
      "cookie security scanner",
      "cookie flags checker",
      "samesite cookie check",
      "secure httponly checker",
    ],
    intro:
      "Audit every Set-Cookie header for the Secure, HttpOnly, and SameSite attributes, cookie scope, and the __Host- and __Secure- prefixes that stop a cookie from being overwritten.",
  },
  configuration: {
    heading: "Server Configuration Scanner",
    keywords: [
      "server misconfiguration scanner",
      "exposed debug endpoint checker",
      "server banner check",
      "web server hardening scanner",
    ],
    intro:
      "Fingerprint the server banner and framework, and find the configuration leaks that hand an attacker a map: exposed debug endpoints, verbose version strings, and default routes.",
  },
  "information-disclosure": {
    heading: "Information Disclosure Scanner",
    keywords: [
      "information disclosure scanner",
      "exposed .env checker",
      "exposed .git scanner",
      "source map exposure check",
    ],
    intro:
      "Look for the files that should never be public: exposed .env and .git, published source maps, backup files, and stack traces that leak paths and secrets in error responses.",
  },
  dns: {
    heading: "DNS Security Checker",
    keywords: [
      "dns security checker",
      "spf dmarc checker",
      "dnssec check",
      "dangling cname scanner",
    ],
    intro:
      "Validate the DNS records that decide who can send mail as you and who can take over a subdomain: SPF, DMARC, DKIM, DNSSEC, CAA, and dangling CNAMEs.",
  },
  email: {
    heading: "Email Security Scanner",
    keywords: [
      "email security scanner",
      "spf dmarc dkim checker",
      "email spoofing check",
      "smtp tls checker",
    ],
    intro:
      "Measure a domain's email spoofing surface: MX records, SMTP TLS, and whether SPF, DKIM, and DMARC actually align rather than just existing.",
  },
  api: {
    heading: "API Security Scanner",
    keywords: [
      "api security scanner",
      "api scanner online",
      "cors misconfiguration checker",
      "graphql introspection scanner",
    ],
    intro:
      "Scan an API endpoint online with no agent to install: CORS policy, rate-limit headers, GraphQL introspection, and exposed OpenAPI documents that describe every route to an attacker.",
  },
  code: {
    heading: "Code Security Scanner",
    keywords: [
      "javascript security scanner",
      "client side code scanner",
      "vulnerable library scanner",
      "leaked token scanner",
    ],
    intro:
      "Read the JavaScript a page ships for dangerous inline patterns, known-vulnerable library versions, and tokens that were left in the bundle.",
  },
  "secrets-extended": {
    heading: "Secret Scanner",
    keywords: [
      "secret scanner",
      "api key leak scanner",
      "aws key scanner",
      "exposed credentials checker",
    ],
    intro:
      "Detect secrets exposed in a page or its assets: AWS, Stripe, GitHub, and OpenAI keys, plus generic high-entropy strings that look like credentials.",
  },
  "vibe-code": {
    heading: "AI-Generated Code Security Scanner",
    keywords: [
      "ai code security scanner",
      "ai generated code vulnerabilities",
      "vibe code scanner",
      "llm code security check",
    ],
    intro:
      "Catch the security gaps AI-generated code ships with: placeholder auth, disabled TLS verification, weak crypto, and hardcoded defaults that were never meant to reach production.",
  },
  "client-side": {
    heading: "Client-Side Security Scanner",
    keywords: [
      "dom xss scanner",
      "client side security scanner",
      "postmessage security check",
      "prototype pollution scanner",
    ],
    intro:
      "Find client-side weaknesses in the browser layer: DOM XSS sinks, missing postMessage origin checks, unsafe-inline CSP, and prototype pollution.",
  },
  "supply-chain": {
    heading: "Supply Chain Scanner",
    keywords: [
      "supply chain scanner",
      "exposed lock file checker",
      "dependency manifest exposure",
      "build artifact scanner",
    ],
    intro:
      "Spot supply-chain exposure that leaks your build: published lock files, dependency manifests, build artifacts, and source maps that reveal your whole dependency tree.",
  },
  "host-validation": {
    heading: "Host Header & SSRF Scanner",
    keywords: [
      "host header injection scanner",
      "ssrf checker",
      "open redirect scanner",
      "subdomain takeover scanner",
    ],
    intro:
      "Test how a site handles the Host header and redirects: open redirects, SSRF through the Host header, and the markers that signal a subdomain takeover.",
  },
  reputation: {
    heading: "Website Reputation Checker",
    keywords: [
      "website reputation checker",
      "malware url checker",
      "phishing site checker",
      "safe browsing lookup",
    ],
    intro:
      "Look a host up against Google Web Risk for known malware, phishing, and unwanted-software listings.",
  },
  "active-probes": {
    heading: "Active Vulnerability Probing",
    keywords: [
      "active vulnerability scanner",
      "sql injection scanner",
      "reflected xss test",
      "ssti scanner",
    ],
    intro:
      "Opt-in active testing that submits real values through discovered forms and checks for reflected XSS, error-based SQL injection, and server-side template injection.",
  },
};

export function getCategorySeo(category: Category): CategorySeo {
  return CATEGORY_SEO[category];
}
