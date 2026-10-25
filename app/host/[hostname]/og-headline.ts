import { normalizeHostForReputation } from "@/lib/scanner/host-reputation";
import { decodeHostParam } from "./host-summary";

/** What the card says when the path is not a hostname at all. */
export const OG_GENERIC_HOST_HEADLINE = "Website security report";

// A DNS name tops out at 253 characters, which at 62px wraps over the rest of
// the card. Nothing a person actually scans is near this long.
const MAX_HEADLINE_LENGTH = 64;

// What a hostname is allowed to look like once URL has punycoded it. The
// normalizer accepts more than this: `foo://Your%20account%20is%20locked`
// parses as an opaque host and comes back as readable text with %20 in it.
const HOSTNAME_SHAPE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/**
 * The headline for a host nobody has scanned publicly.
 *
 * opengraph-image.tsx used to print the decoded path segment as-is, so
 * /host/Your%20account%20is%20locked%3A%20visit%20evil.example/opengraph-image
 * produced a VulnRadar-branded 62px card carrying that sentence, on our domain
 * and cheap to mint in bulk (each unique path is a fresh render that skips the
 * cache). A card for an unscanned host now says either a hostname or nothing
 * user-supplied at all.
 */
export function unscannedHostHeadline(rawHostname: string): string {
  const host = normalizeHostForReputation(decodeHostParam(rawHostname));
  if (!host || !HOSTNAME_SHAPE.test(host)) return OG_GENERIC_HOST_HEADLINE;
  return host.length > MAX_HEADLINE_LENGTH
    ? `${host.slice(0, MAX_HEADLINE_LENGTH - 3)}...`
    : host;
}
