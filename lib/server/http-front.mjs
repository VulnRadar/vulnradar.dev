/**
 * What server.mjs and the bundled app have to agree on.
 *
 * Plain JavaScript with no path aliases, because server.mjs runs under bare
 * node before Next is loaded, and there is no compiler in front of it. The IP
 * helpers live here for the same reason: lib/api/request-utils.ts imports them
 * too, so the code that decides a peer is trusted and the code that reads the
 * header it leaves behind cannot parse an address differently.
 */
import { isIP } from "node:net";

/**
 * @param {string} ip
 * @returns {number | null}
 */
export function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = acc * 256 + n;
  }
  return acc;
}

/**
 * @param {string} ip
 * @returns {bigint | null}
 */
export function ipv6ToBigInt(ip) {
  // Expand :: shorthand.
  const doubleColonIdx = ip.indexOf("::");
  let head;
  let tail;
  if (doubleColonIdx === -1) {
    head = ip.split(":");
    tail = [];
  } else {
    head = ip.slice(0, doubleColonIdx).split(":");
    tail = ip.slice(doubleColonIdx + 2).split(":");
    if (head.length === 1 && head[0] === "") head = [];
    if (tail.length === 1 && tail[0] === "") tail = [];
  }
  if (head.length + tail.length > 8) return null;
  const fillCount = 8 - (head.length + tail.length);
  const groups = [
    ...head,
    ...Array.from({ length: fillCount }, () => "0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;
  let acc = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    acc = (acc << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return acc;
}

/**
 * @param {string} ip
 * @param {string} base
 * @param {number} prefix
 * @param {4 | 6} version
 * @returns {boolean}
 */
function ipInCidr(ip, base, prefix, version) {
  if (prefix === 0) return true;
  if (version === 4) {
    const ipN = ipv4ToInt(ip);
    const baseN = ipv4ToInt(base);
    if (ipN === null || baseN === null) return false;
    const mask = prefix === 32 ? -1 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipN & mask) === (baseN & mask);
  }
  const ipB = ipv6ToBigInt(ip);
  const baseB = ipv6ToBigInt(base);
  if (ipB === null || baseB === null) return false;
  const shift = BigInt(128 - prefix);
  return ipB >> shift === baseB >> shift;
}

/**
 * Returns true if `ip` falls within any of the comma-separated CIDR ranges
 * listed in `cidrList` (e.g. "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16").
 *
 * Used to walk `x-forwarded-for` from the right and skip trusted hops when
 * TRUSTED_PROXY_CIDR is configured, and by the front server to decide whether
 * a connection's peer may set that header at all. An entry that does not parse
 * matches nothing, so a typo trusts less rather than more.
 *
 * @param {string} ip
 * @param {string} cidrList
 * @returns {boolean}
 */
export function ipInCidrList(ip, cidrList) {
  const version = isIP(ip);
  if (version !== 4 && version !== 6) return false;

  const cidrs = cidrList
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  for (const cidr of cidrs) {
    const [base, prefixStr] = cidr.split("/");
    if (!base || !prefixStr) continue;
    if (isIP(base) !== version) continue;
    const prefix = Number(prefixStr);
    if (
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > (version === 4 ? 32 : 128)
    ) {
      continue;
    }
    if (ipInCidr(ip, base, prefix, version)) return true;
  }
  return false;
}

/**
 * Normalize a raw address string into a canonical IP, or null if it is not a
 * valid IP. Proxies and runtimes hand us addresses that are "an IP with
 * extra": an appended `:port`, IPv6 wrapped in `[brackets]`, or an
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`), and occasionally something that is not
 * an IP at all. Anything that persists or displays the client IP (session and
 * device rows, API-key last-seen IP) must never store one of those, so this
 * strips the wrapping and validates with `isIP` before returning.
 *
 * A syntactically valid IP, including a compressed IPv6 like `2001:db8::1`, is
 * returned unchanged: there is nothing to fix about a real address.
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeIp(raw) {
  let s = raw.trim();
  if (!s) return null;

  if (s.startsWith("[")) {
    // Bracketed IPv6, optionally with a :port after the closing bracket.
    const end = s.indexOf("]");
    if (end === -1) return null;
    s = s.slice(1, end);
  } else if (s.split(":").length === 2) {
    // Exactly one colon means an IPv4 host with a :port. Unbracketed IPv6
    // always has more than one colon, so this never truncates an IPv6.
    const [host, port] = s.split(":");
    if (isIP(host) === 4 && /^\d+$/.test(port)) s = host;
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) -> the plain IPv4 it carries.
  if (s.toLowerCase().startsWith("::ffff:") && isIP(s.slice(7)) === 4) {
    s = s.slice(7);
  }

  return isIP(s) ? s : null;
}

/**
 * Believed whatever TRUSTED_PROXY_CIDR says, because a loopback peer can only
 * be a process on this machine. That variable predates the front server and
 * listed the hops to skip inside the header, and a same-host proxy's address
 * is never one of those: the documented example value leaves loopback out, so
 * requiring it here would have turned every visitor of such an install into
 * 127.0.0.1 and one rate-limit bucket.
 */
const LOOPBACK_CIDR = "127.0.0.0/8,::1/128";

/**
 * Who may set X-Forwarded-For when the operator has not said: the machine
 * itself, and the two ranges Docker hands bridge networks from by default. A
 * reverse proxy on the docker host reaches the container from its bridge
 * gateway, so without those a compose install behind nginx would see every
 * visitor as the gateway address and put them all in one rate-limit bucket.
 */
export const DEFAULT_TRUSTED_PROXY_CIDR = `${LOOPBACK_CIDR},172.16.0.0/12,192.168.0.0/16`;

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string}
 */
export function trustedProxyCidr(env) {
  return env.TRUSTED_PROXY_CIDR?.trim() || DEFAULT_TRUSTED_PROXY_CIDR;
}

/**
 * Make the client-address headers true before Next sees them.
 *
 * Next only fills in X-Forwarded-For when it is absent, so a value the client
 * sent reached getClientIp intact, and on any deployment with no appending
 * proxy one header chose the address that rate limits, session binding and
 * audit rows recorded. Only the socket knows who actually connected.
 *
 * A trusted peer's header is left exactly as it arrived: that proxy has
 * already appended the real client, and getClientIp reads from the right.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {string} cidrList
 * @returns {void}
 */
export function enforceForwardedFor(req, cidrList) {
  const peer = normalizeIp(req.socket.remoteAddress ?? "");
  if (peer && ipInCidrList(peer, `${LOOPBACK_CIDR},${cidrList}`)) return;

  delete req.headers["x-real-ip"];
  delete req.headers["cf-connecting-ip"];
  if (peer) req.headers["x-forwarded-for"] = peer;
  else delete req.headers["x-forwarded-for"];
}

/**
 * @param {string | undefined} host
 * @returns {boolean}
 */
function isLoopbackHost(host) {
  if (!host) return false;
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    h === "localhost" || h === "::1" || (isIP(h) === 4 && h.startsWith("127."))
  );
}

/**
 * @param {string | undefined} host
 * @returns {boolean}
 */
function isWildcardHost(host) {
  const h = host?.trim();
  return h === "0.0.0.0" || h === "::" || h === "[::]";
}

/**
 * The line to log when clients can probably reach this process with no proxy
 * in front of it, or null. The default trust list covers the Docker bridge,
 * and a published port can present an outside client as the bridge gateway, so
 * on such a deployment X-Forwarded-For may still be the client's to choose.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function proxyTrustWarning(env) {
  if (env.TRUSTED_PROXY_CIDR?.trim()) return null;
  const trigger = isWildcardHost(env.HOST_BIND)
    ? `HOST_BIND=${env.HOST_BIND?.trim()}`
    : env.ALLOW_INSECURE_HTTP === "1" && !isLoopbackHost(env.HOST_BIND)
      ? "ALLOW_INSECURE_HTTP=1"
      : null;
  if (!trigger) return null;
  return `${trigger} is set and TRUSTED_PROXY_CIDR is not. Loopback and Docker bridge peers are trusted by default, and a published port can make an outside client look like one, so X-Forwarded-For may be forged and rate limits, session binding and audit IPs may record the wrong address. Set TRUSTED_PROXY_CIDR to your proxy's range.`;
}

/**
 * Whether this is the compose quick start: the port is published on loopback
 * and the configured URL is plain HTTP on loopback. Compose cannot express
 * that (its interpolation has no comparison), so it passes HOST_BIND in and
 * server.mjs sets ALLOW_INSECURE_HTTP=1 before Next loads.
 *
 * Both halves are needed. A loopback bind alone is also the documented
 * production shape, nginx terminating TLS on the host, and plain HTTP there
 * would take the Secure flag off every session cookie and stop sending HSTS.
 * Without this the quick start 301s every browser to an https://localhost that
 * nothing is listening on.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function localPlainHttpApplies(env) {
  if (env.ALLOW_INSECURE_HTTP) return false;
  if (!isLoopbackHost(env.HOST_BIND)) return false;
  try {
    const url = new URL(env.APP_URL || env.NEXT_PUBLIC_APP_URL || "");
    return url.protocol === "http:" && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Where server.mjs leaves its http.Server for the shutdown sequence, which
 * runs inside the Next bundle and so cannot import anything from server.mjs.
 * Symbol.for because the two sides are separate module graphs in one realm.
 */
export const HTTP_SERVER_SLOT = Symbol.for("vulnradar.httpServer");
