/**
 * DNS TXT-based domain ownership verification.
 *
 * A user proves control of a domain by publishing a VulnRadar-generated
 * token in a TXT record at `_vulnradar-verify.<domain>` -- a dedicated
 * label, not the domain's own apex, so this never collides with or asks a
 * user to edit an existing SPF/DMARC/site-verification TXT record already
 * living at their apex.
 *
 * This is the prerequisite lib/domains/scope.ts checks before allowing
 * intrusive active-probing checks (real exploit-attempt payloads) against
 * a target -- see that file and app/api/v3/scan/route.ts for enforcement.
 */

import { randomBytes } from "crypto";
import { resolveTxt } from "dns/promises";

export const VERIFICATION_RECORD_PREFIX = "_vulnradar-verify";
export const VERIFICATION_VALUE_PREFIX = "vulnradar-verify";

const DNS_LOOKUP_TIMEOUT_MS = 8000;

/** A fresh, unique-enough token for one domain's verification row. Never
 *  reused across rows -- each (user, domain) pending attempt gets its own,
 *  so one user's stale/abandoned attempt can never be satisfied by a
 *  different user's real DNS record. */
export function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

export function verificationRecordName(domain: string): string {
  return `${VERIFICATION_RECORD_PREFIX}.${domain}`;
}

export function verificationRecordValue(token: string): string {
  return `${VERIFICATION_VALUE_PREFIX}=${token}`;
}

// A conservative hostname shape: labels of letters/digits/hyphens (never
// starting or ending with a hyphen), joined by single dots, 2+ labels, each
// label <=63 chars, total <=253 chars per RFC 1035. Deliberately stricter
// than "anything dns.resolveTxt would accept" -- this is a user-facing
// field, not scanner input, so reject anything that doesn't look like a
// real registrable domain or subdomain rather than trying to be lenient.
const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface NormalizeDomainResult {
  ok: boolean;
  domain?: string;
  error?: string;
}

/**
 * Normalizes user input (a bare domain, a "www."-prefixed domain, or a
 * full URL someone pasted) into a lowercase hostname suitable for
 * `domains.domain`. Deliberately does NOT collapse a subdomain down to its
 * registrable root: a user who only controls (and can only place a TXT
 * record under) `blog.example.com` must be able to verify exactly that,
 * not be forced through a check for `example.com` they may not control at
 * all. Adding the root domain still covers every subdomain underneath it
 * (see lib/domains/scope.ts) -- this only affects what a caller who wants
 * a narrower grant is allowed to type.
 */
export function normalizeDomainInput(input: string): NormalizeDomainResult {
  let raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, error: "Domain is required." };

  // Accept a pasted URL by extracting just its hostname; accept a bare
  // domain as-is. Prepending a scheme when one is missing lets the same
  // URL() parser handle both shapes identically.
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(raw)
      ? raw
      : `https://${raw}`;
    raw = new URL(withScheme).hostname;
  } catch {
    return { ok: false, error: "Not a valid domain." };
  }

  const domain = raw.replace(/^www\./, "").replace(/\.$/, "");

  if (domain.length === 0 || domain.length > 253) {
    return { ok: false, error: "Not a valid domain." };
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return {
      ok: false,
      error: "Enter a real domain, e.g. example.com or app.example.com.",
    };
  }
  if (!labels.every((label) => HOSTNAME_LABEL.test(label))) {
    return { ok: false, error: "Not a valid domain." };
  }
  // A bare IP address parses as a syntactically valid "hostname" through
  // the URL()-based extraction above (each octet is a valid label), but
  // domain ownership verification is meaningless for a raw IP -- there's
  // no DNS zone to publish a TXT record into.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
    return { ok: false, error: "Enter a domain name, not an IP address." };
  }
  // Same reasoning as safe-fetch.ts's DISALLOWED_HOSTNAME_SUFFIXES: these
  // can never resolve to a real, independently-owned DNS zone.
  if (
    domain === "localhost" ||
    /\.(local|internal|lan|localhost)$/.test(domain)
  ) {
    return { ok: false, error: "Not a publicly resolvable domain." };
  }

  return { ok: true, domain };
}

export interface DnsVerificationResult {
  verified: boolean;
  error?: string;
}

/**
 * Looks up `_vulnradar-verify.<domain>` and checks whether any TXT record
 * there matches this row's token exactly. A multi-string TXT record is
 * joined before comparing (DNS TXT records are split into <=255-byte
 * chunks by the protocol, not by the zone owner's intent -- resolveTxt
 * already reassembles each record's chunks into one array-of-strings per
 * record, so joining within a record, never across records, is correct).
 *
 * Every failure mode -- NXDOMAIN, no TXT records, a timeout, a transient
 * resolver error -- returns `verified: false` with a human-readable reason
 * rather than throwing, so callers can show it directly.
 */
export async function checkDnsVerification(
  domain: string,
  token: string,
): Promise<DnsVerificationResult> {
  const recordName = verificationRecordName(domain);
  const expected = verificationRecordValue(token);

  let records: string[][];
  try {
    records = await Promise.race([
      resolveTxt(recordName),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("DNS lookup timed out")),
          DNS_LOOKUP_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENODATA|ENOTFOUND/i.test(message)) {
      return {
        verified: false,
        error: `No TXT record found at ${recordName}. Add it and try again -- DNS changes can take a few minutes to propagate.`,
      };
    }
    if (/timed out/i.test(message)) {
      return {
        verified: false,
        error: "DNS lookup timed out. Try again in a moment.",
      };
    }
    return {
      verified: false,
      error: `Could not look up ${recordName}: ${message}`,
    };
  }

  const matches = records.some((chunks) => chunks.join("") === expected);
  if (!matches) {
    return {
      verified: false,
      error: `Found a TXT record at ${recordName}, but it doesn't match your verification token. Double-check you copied the full value.`,
    };
  }
  return { verified: true };
}
