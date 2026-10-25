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

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

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

/**
 * What a DNS check concluded, in three states because two of the "not
 * verified" cases mean opposite things to a caller.
 *
 * - `verified`: the token is published.
 * - `not_found`: DNS ANSWERED and the token is not there (NXDOMAIN, no TXT
 *   records, or records that do not match). The record is gone or wrong.
 * - `lookup_error`: DNS did NOT answer (a timeout, SERVFAIL, a refused or
 *   reset connection). The check reached no verdict about the domain at all.
 *
 * They used to share `verified: false`, so a resolver outage during the
 * re-verification worker's pass was indistinguishable from a domain that had
 * changed hands, and the worker revoked active-probes permission for every
 * domain it asked about while the resolver was down.
 */
export type DnsVerificationResult =
  | { outcome: "verified" }
  | { outcome: "not_found"; error: string }
  | {
      outcome: "lookup_error";
      error: string;
      /** The resolver error itself, so a caller can log it with its stack. */
      cause: unknown;
    };

/**
 * Looks up `_vulnradar-verify.<domain>` and checks whether any TXT record
 * there matches this row's token exactly. A multi-string TXT record is
 * joined before comparing (DNS TXT records are split into <=255-byte
 * chunks by the protocol, not by the zone owner's intent -- resolveTxt
 * already reassembles each record's chunks into one array-of-strings per
 * record, so joining within a record, never across records, is correct).
 *
 * Never throws. Every failure comes back as `not_found` or `lookup_error`
 * (see DnsVerificationResult) with a human-readable reason, so callers can
 * show it directly.
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
    // The code is on the error itself (`err.code`) and is also the middle
    // word of its message, so a resolver wrapper that keeps only the text
    // still classifies. The message also names the host that was asked about,
    // and a hostname can spell "enodata", so it is only read when there is no
    // code and never with the record name left in it: this decides whether a
    // domain is downgraded, and SERVFAIL for enotfound.example.com must stay a
    // lookup_error.
    const code = (err as { code?: unknown } | null)?.code;
    const verdictText =
      typeof code === "string" ? code : message.split(recordName).join(" ");
    if (/ENODATA|ENOTFOUND/i.test(verdictText)) {
      return {
        outcome: "not_found",
        error: `No TXT record found at ${recordName}. Add it and try again -- DNS changes can take a few minutes to propagate.`,
      };
    }
    if (/timed out/i.test(message)) {
      return {
        outcome: "lookup_error",
        error: "DNS lookup timed out. Try again in a moment.",
        cause: err,
      };
    }
    return {
      outcome: "lookup_error",
      error: `Could not look up ${recordName}: ${message}`,
      cause: err,
    };
  }

  const matches = records.some((chunks) => chunks.join("") === expected);
  if (!matches) {
    return {
      outcome: "not_found",
      error: `Found a TXT record at ${recordName}, but it doesn't match your verification token. Double-check you copied the full value.`,
    };
  }
  return { outcome: "verified" };
}
