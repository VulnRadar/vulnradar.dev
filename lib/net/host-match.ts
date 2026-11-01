/**
 * Whether a hostname is a given domain, or a subdomain of it.
 *
 * The webhook type detector and the scanner's vendor host rules both need
 * this, and each used to carry its own copy under its own name. Matching the
 * whole name, or a whole-label suffix after a ".", is what keeps
 * discord.com.evil.example and notdiscord.com from passing as discord.com.
 * The hostname is expected already parsed (new URL().hostname, or a
 * detector's captured host), not a raw URL.
 */

export interface HostSpec {
  /** Lower-case domain to match. */
  host: string;
  /** Also accept any subdomain of `host`. */
  subdomains?: boolean;
}

/** True when `host` is the spec's host, or a subdomain of it if allowed. */
export function hostMatches(host: string, spec: HostSpec): boolean {
  const h = host.toLowerCase();
  return (
    h === spec.host || (spec.subdomains === true && h.endsWith(`.${spec.host}`))
  );
}
