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
