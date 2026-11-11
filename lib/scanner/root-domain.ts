/**
 * Best-effort "organizational domain" extraction: the registrable domain a
 * hostname belongs to, e.g. "sandbox.vulnradar.dev" -> "vulnradar.dev", or
 * "shop.example.co.uk" -> "example.co.uk". Real registrable-domain
 * detection needs the full Public Suffix List; this covers the common
 * multi-label TLDs correctly and falls back to "last two labels" for
 * everything else, which is right for the overwhelming majority of real
 * domains and good enough for the scanner heuristics that use it
 * (subdomain enumeration, DMARC/CAA organizational-domain fallback).
 */
const DOUBLE_LABEL_TLDS = [
  "co.uk",
  "co.jp",
  "com.au",
  "com.br",
  "co.nz",
  "co.za",
  "org.uk",
  "net.au",
  "ac.uk",
  "gov.uk",
  "co.in",
  "co.kr",
  "com.mx",
  "com.ar",
  "com.cn",
  "com.tw",
  "co.il",
  "co.th",
];

/**
 * `com.sg`, `co.id`, `org.tr`: a public second level that the table above does
 * not list, so extractRootDomain returns it as if it were someone's domain.
 * Dropped by wave 8 when tldts replaces this file's table.
 */
const COUNTRY_SECOND_LEVEL = /^(?:ac|co|com|edu|gov|ne|net|or|org)\.[a-z]{2}$/;

export function extractRootDomain(hostname: string): string {
  const stripped = hostname.replace(/^www\./, "");
  const parts = stripped.split(".");
  const lastTwo = parts.slice(-2).join(".");
  if (DOUBLE_LABEL_TLDS.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  } else if (parts.length >= 2) {
    return parts.slice(-2).join(".");
  }
  return stripped;
}

/**
 * extractRootDomain, corrected for a country second level it does not list:
 * `example.com.sg` is a registrable domain, `com.sg` is not. Use this wherever
 * the answer decides what DNS zone or site a name belongs to.
 */
export function registrableDomain(hostname: string): string {
  const root = extractRootDomain(hostname);
  return COUNTRY_SECOND_LEVEL.test(root)
    ? hostname.split(".").slice(-3).join(".")
    : root;
}
