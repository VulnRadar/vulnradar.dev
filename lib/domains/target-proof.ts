/**
 * Proof that the caller controls the SERVER a scan will hit, not only the name.
 *
 * Verifying a domain (lib/domains/verification.ts) proves control of its DNS
 * zone. That was treated as permission to port-sweep and actively probe every
 * host in the zone, and a zone owner chooses what every name in it resolves
 * to: publish `v1.attacker.example A <someone else's server>` and the sweep
 * went out from this service's IP at a server the caller has nothing to do
 * with (gap-domain-verification-active-gating-1).
 *
 * The binding is the same one ACME HTTP-01 uses. The server at the exact
 * address that will be swept has to answer
 * `GET /.well-known/vulnradar-verify/<token>` for the host with the domain's
 * own verification value, and that address is then pinned for the run: the
 * sweep connects to it and nothing else, so a DNS answer that changes after
 * the proof cannot move the sweep somewhere new.
 *
 * Two refusals come before the request, both from DNS alone:
 *   - a host whose CNAME chain leaves the verified zone. The addresses at the
 *     end of an out-of-zone hop belong to whoever runs that zone (a CDN, a
 *     SaaS, a stranger), and one tenant serving a file on a shared edge does
 *     not make sweeping the edge's address theirs to authorize.
 *   - a host that resolves to any non-public address, the same fail-closed
 *     rule the sweep itself applies.
 *
 * The plan also allowed a second route: accept a host that resolves inside an
 * A/AAAA set recorded at verification time. That is not built. The domains
 * table has no column for it, and recorded from DNS it would not bind to the
 * server anyway: point the apex at the victim before verifying and the
 * victim's address IS the recorded set.
 *
 * Every refusal carries DOMAIN_NOT_VERIFIED, the code the scan routes already
 * return for an unverified domain, so a client needs no new case.
 */

import { lookup, resolveCname } from "node:dns/promises";
import { isIP } from "node:net";
import { findVerifiedDomainForHost } from "./scope";
import { firstHopOutsideZone } from "./covering";
import { verificationRecordValue } from "./verification";
import pool from "@/lib/database/db";
import { globalSingleton } from "@/lib/runtime/global-singleton";
import { isPrivateIP, pinToResolvedIp } from "@/lib/scanner/safe-fetch";
import { readBoundedBody } from "@/lib/scanner/read-bounded-body";
import { SCANNER_UA } from "@/lib/scanner/user-agent";

export const TARGET_PROOF_PATH_PREFIX = "/.well-known/vulnradar-verify/";

/** The path the target serves its proof at, for one domain's token. */
export function targetProofPath(token: string): string {
  return `${TARGET_PROOF_PATH_PREFIX}${token}`;
}

/** A host the caller proved, and the one address the proof came from. */
export interface ProvenTarget {
  readonly host: string;
  readonly ip: string;
  readonly domainId: number;
  readonly domain: string;
}

export type TargetProofResult =
  | { ok: true; target: ProvenTarget }
  | { ok: false; code: "DOMAIN_NOT_VERIFIED"; reason: string };

// Only proveTargetControl adds to this, so a caller cannot hand the sweep an
// object literal with an address of its choosing and call it a proof. One set
// per process, not per bundled copy: a proof issued by the route's copy of
// this module has to be recognised by the copy port-scan.ts imports.
const issued = globalSingleton(
  "vulnradar.targetProof.issued",
  () => new WeakSet<object>(),
);

/** Whether `value` is a proof this module issued, rather than a look-alike. */
export function isProvenTarget(value: unknown): value is ProvenTarget {
  return typeof value === "object" && value !== null && issued.has(value);
}

// A chain longer than this is a loop or a misconfiguration, and either way
// nothing a proof should be built on.
const MAX_CNAME_HOPS = 8;
const PROOF_FETCH_TIMEOUT_MS = 5_000;
// The expected body is under 100 bytes. Anything far past that is a page, not
// a proof, and is not worth reading to the end.
const PROOF_BODY_MAX_BYTES = 4_096;

function refuse(reason: string): TargetProofResult {
  return { ok: false, code: "DOMAIN_NOT_VERIFIED", reason };
}

function isNoAnswer(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ENODATA" || code === "ENOTFOUND";
}

/**
 * The names `host` is an alias for, in order. `ok: false` when DNS could not
 * say: a resolver failure is not evidence the chain is clean.
 */
async function walkCnameChain(
  host: string,
): Promise<{ ok: true; chain: string[] } | { ok: false }> {
  const chain: string[] = [];
  let name = host;
  for (let hop = 0; hop < MAX_CNAME_HOPS; hop++) {
    let answer: string[];
    try {
      answer = await resolveCname(name);
    } catch (err) {
      return isNoAnswer(err) ? { ok: true, chain } : { ok: false };
    }
    const next = answer[0]?.toLowerCase().replace(/\.$/, "");
    if (!next) return { ok: true, chain };
    if (next === host || chain.includes(next)) return { ok: false };
    chain.push(next);
    name = next;
  }
  return { ok: false };
}

function bodyCarriesProof(body: string, expected: string): boolean {
  return body.split(/\r?\n/).some((line) => line.trim() === expected);
}

/**
 * Whether the server at `ip` serves the proof for `host`. HTTPS first, since
 * most hosts redirect port 80 there, then plain HTTP. Redirects are never
 * followed: a 3xx would hand the answer to another server, possibly at another
 * address, and the point is what THIS address says.
 */
async function serverAnswersProof(
  host: string,
  ip: string,
  token: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const expected = verificationRecordValue(token);
  for (const scheme of ["https", "http"]) {
    const timeout = AbortSignal.timeout(PROOF_FETCH_TIMEOUT_MS);
    const pinned = pinToResolvedIp(
      `${scheme}://${host}${targetProofPath(token)}`,
      ip,
      {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": SCANNER_UA },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    try {
      const res = await fetch(pinned.url, pinned.init);
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        continue;
      }
      const body = await readBoundedBody(
        res,
        PROOF_BODY_MAX_BYTES,
        PROOF_FETCH_TIMEOUT_MS,
      );
      if (bodyCarriesProof(body.text, expected)) return true;
    } catch {
      // Refused, reset, timed out or a bad certificate: no proof on this
      // scheme, so try the next one.
    }
  }
  return false;
}

/**
 * Prove that `userId` controls the server `host` resolves to, and pin it.
 *
 * Call this immediately before the intrusive work and use `target.ip` for it.
 * Never throws: every failure, including a database or resolver error, is a
 * refusal with a reason a person can act on.
 */
export async function proveTargetControl(
  host: string,
  userId: number,
  options: { signal?: AbortSignal } = {},
): Promise<TargetProofResult> {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  if (!name) return refuse("The target has no hostname.");
  if (isIP(name.replace(/^\[|\]$/g, "")) !== 0) {
    return refuse(
      "A raw IP address has no domain to verify. Scan it by a hostname inside a domain you have verified.",
    );
  }

  let match: { id: number; domain: string } | null;
  let token: string | undefined;
  try {
    match = await findVerifiedDomainForHost(name, userId);
    if (match) {
      const row = await pool.query<{ verification_token: string }>(
        `SELECT verification_token FROM domains
          WHERE id = $1 AND status = 'verified'`,
        [match.id],
      );
      token = row.rows[0]?.verification_token;
    }
  } catch (err) {
    console.error(
      "[domains] Target proof lookup failed (failing closed):",
      err,
    );
    return refuse(
      "Domain verification could not be checked right now. Try again in a moment.",
    );
  }
  if (!match || !token) {
    return refuse(
      `No verified domain covers ${name}. Verify ownership of this domain (or its parent) on the Attack surface page (/attack-surface).`,
    );
  }

  const cnames = await walkCnameChain(name);
  if (!cnames.ok) {
    return refuse(
      `Could not follow the DNS aliases for ${name}, so the server behind it could not be confirmed. Try again in a moment.`,
    );
  }
  const outside = firstHopOutsideZone(cnames.chain, match.domain);
  if (outside) {
    return refuse(
      `${name} is an alias for ${outside}, which is outside ${match.domain}. Port sweeps and active probes only run against servers inside the domain you verified.`,
    );
  }

  let addresses: string[];
  try {
    addresses = (await lookup(name, { all: true })).map((a) => a.address);
  } catch {
    addresses = [];
  }
  if (addresses.length === 0) {
    return refuse(`${name} did not resolve to any address.`);
  }
  if (addresses.some((a) => isPrivateIP(a))) {
    return refuse(`${name} resolves to an internal address.`);
  }
  const ip = addresses[0];

  if (!(await serverAnswersProof(name, ip, token, options.signal))) {
    return refuse(
      `Verifying ${match.domain} proves you control its DNS, not the server ${name} points to. Prove the server at ${ip} is yours: serve the text ${verificationRecordValue(token)} at https://${name}${targetProofPath(token)} (or over http), then try again.`,
    );
  }

  const target: ProvenTarget = Object.freeze({
    host: name,
    ip,
    domainId: match.id,
    domain: match.domain,
  });
  issued.add(target);
  return { ok: true, target };
}
