/**
 * The one TLS rule for every PostgreSQL connection: the app pool and every
 * script. Plain .mjs because scripts/ runs under Node with no TypeScript step,
 * the same reason lib/database/schema is.
 *
 * node-pg assigns whatever it parses out of connectionString over the `ssl`
 * option, so a URL carrying `?sslmode=require` (Neon's and most providers'
 * default copy-paste) used to replace { rejectUnauthorized: true, ca } and
 * DATABASE_SSL_CA was dropped without a word. Meanwhile the scripts read
 * neither variable, so a migration or a backup could move the whole database
 * in plaintext against a server the app only reaches over verified TLS.
 *
 * So there are two inputs and one outcome:
 *
 *   DATABASE_SSL=true: verified TLS, with DATABASE_SSL_CA when it is set, and
 *   the URL's TLS parameters are removed so nothing can loosen that. This
 *   includes sslmode=disable: the variable is the explicit statement.
 *
 *   Anything else: the URL is left exactly as written, so a URL that asks for
 *   TLS still gets it. Stripping it here would be a plaintext downgrade, and
 *   DATABASE_SSL=false is the shipped .env.example default, so that value
 *   cannot be read as "the operator refuses TLS".
 *
 * A conflict between the two therefore never turns TLS off.
 */
import { isIP } from "node:net";

/**
 * Everything node-pg turns into `config.ssl` when it reads the URL. Listed in
 * full because any one of them would replace the explicit config, not just
 * sslmode: sslnegotiation=direct, for instance, sets it to a bare `true`.
 */
const URL_TLS_PARAMS = [
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslnegotiation",
  "uselibpqcompat",
];

/**
 * Also read into `config.ssl`, but removing these would silently drop the
 * operator's client certificate and fail later as an authentication error.
 */
const URL_CLIENT_CERT_PARAMS = ["sslcert", "sslkey"];

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {false | { rejectUnauthorized: boolean, ca?: string }}
 */
export function pgSslConfig(env = process.env) {
  if (env.DATABASE_SSL !== "true") return false;
  return {
    rejectUnauthorized: true,
    ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA } : {}),
  };
}

/**
 * The sslmode values that mean "encrypt or fail". prefer and allow are left
 * out on purpose: libpq falls back to plaintext on both, and the scripts hand
 * this same URL to libpq.
 */
const ENCRYPTING_SSLMODES = ["require", "verify-ca", "verify-full"];

const DATABASE_TLS_WARNING =
  "DATABASE_URL points at a database across the network and the connection is not encrypted, so the database password and every query cross it in plaintext. Set DATABASE_SSL=true, with DATABASE_SSL_CA holding the CA certificate when the server's is not publicly signed, or add sslmode=verify-full to DATABASE_URL.";

/**
 * The host node-pg will connect to, and the TLS parameters it will read, taken
 * from the connection string the way pg-connection-string takes them: a
 * leading "/" is a socket directory, `socket:` URLs carry it in the path, a
 * `host` query parameter beats the authority, an empty authority is retried
 * the way node-pg retries it, and the last copy of a repeated parameter wins.
 * Mirrored rather than imported because pg-connection-string is node-pg's
 * dependency, not ours. Null when it cannot be read at all.
 *
 * @param {string} connectionString
 * @returns {{ host: string, sslmode: string | undefined, ssl: string | undefined } | null}
 */
function readConnectionTarget(connectionString) {
  if (connectionString.startsWith("/")) {
    return {
      host: connectionString.split(" ")[0],
      sslmode: undefined,
      ssl: undefined,
    };
  }
  let str = connectionString;
  if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(str)) {
    str = encodeURI(str).replace(/%25(\d\d)/g, "%$1");
  }
  try {
    let url;
    let noHost = false;
    try {
      url = new URL(str, "postgres://base");
    } catch {
      url = new URL(str.replace("@/", "@___DUMMY___/"), "postgres://base");
      noHost = true;
    }
    /** @param {string} name */
    const last = (name) => {
      const all = url.searchParams.getAll(name);
      return all.length > 0 ? all[all.length - 1] : undefined;
    };
    const tls = { sslmode: last("sslmode"), ssl: last("ssl") };
    if (url.protocol === "socket:") {
      return { host: decodeURI(url.pathname), ...tls };
    }
    const hostname = (noHost ? "" : url.hostname).replace(/^\[(.+)\]$/, "$1");
    return { host: last("host") || decodeURIComponent(hostname), ...tls };
  } catch {
    return null;
  }
}

/**
 * Whether the connection stays on this machine or its private network
 * namespace: a socket directory, loopback, or a single-label name, which is
 * what a compose service such as `postgres` resolves through. Anything with a
 * dot in it may be anywhere, a private 10.x address included.
 *
 * @param {string} host
 * @returns {boolean}
 */
function isLocalDatabaseHost(host) {
  if (host.startsWith("/")) return true;
  const h = host.toLowerCase();
  const version = isIP(h);
  if (version === 4) return h.startsWith("127.");
  if (version === 6) {
    // The URL parser writes every spelling of ::1 the same way. A zone id
    // (fe80::1%eth0) does not parse, and is not loopback either.
    try {
      return new URL(`http://[${h}]`).hostname === "[::1]";
    } catch {
      return false;
    }
  }
  return h === "localhost" || !h.includes(".");
}

/**
 * Whether the app's connection to Postgres is encrypted, whether it leaves
 * the machine, and the line to log when a production install sends its
 * password and queries across a network in plaintext (null otherwise). The
 * admin health view reads the same object, so the boot log and the panel
 * cannot disagree. Nothing in it echoes the URL or the host.
 *
 * A DATABASE_URL this cannot read counts as remote: a parser gap must not
 * make the check go quiet.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ encrypted: boolean, remote: boolean, warning: string | null }}
 */
export function databaseTlsStatus(env = process.env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    return {
      encrypted: pgSslConfig(env) !== false,
      remote: false,
      warning: null,
    };
  }
  const target = readConnectionTarget(connectionString);
  const urlEncrypts =
    target !== null &&
    (target.sslmode
      ? ENCRYPTING_SSLMODES.includes(target.sslmode)
      : target.ssl === "true" || target.ssl === "1");
  const encrypted = pgSslConfig(env) !== false || urlEncrypts;
  // node-pg falls back to PGHOST, then localhost, when the URL names no host.
  const remote =
    target === null ||
    !isLocalDatabaseHost(target.host || env.PGHOST || "localhost");
  const warning =
    env.NODE_ENV === "production" && remote && !encrypted
      ? DATABASE_TLS_WARNING
      : null;
  return { encrypted, remote, warning };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function databaseTlsWarning(env = process.env) {
  return databaseTlsStatus(env).warning;
}

/**
 * The boot step: the warning for register() to log, or, with
 * DATABASE_SSL_REQUIRED=true, a refusal to start carrying the same text.
 * register() runs it before anything touches the pool, so a refused boot
 * never sends the password over the connection it is refusing.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function checkDatabaseTls(env = process.env) {
  const warning = databaseTlsWarning(env);
  if (warning && env.DATABASE_SSL_REQUIRED === "true") {
    throw new Error(warning);
  }
  return warning;
}

/**
 * A query pair's name as node-pg's URL parser will read it: tabs and newlines
 * are dropped before anything else happens, then the name is percent-decoded.
 *
 * @param {string} pair
 * @returns {string | undefined}
 */
function paramName(pair) {
  const [name] = new URLSearchParams(pair.replace(/[\t\r\n]/g, "")).keys();
  return name;
}

/**
 * The connection string to hand node-pg or libpq alongside pgSslConfig().
 * Returned unchanged when TLS is not explicitly on, or when there is nothing
 * to remove, so a URL this rule has no opinion on is never re-serialised.
 *
 * The query string is edited as text rather than through the URL API, for two
 * reasons. node-pg accepts forms `new URL` rejects, such as
 * `postgres://u:p@/db?host=db.example.com&sslmode=disable`, so a parse failure
 * here would leave the parameter in place for node-pg to honour. And
 * URLSearchParams re-encodes whatever it keeps, turning %20 into a + that
 * libpq reads literally.
 *
 * @param {string | undefined} connectionString
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function pgConnectionString(connectionString, env = process.env) {
  if (!pgSslConfig(env) || !connectionString) return connectionString;
  const queryStart = connectionString.indexOf("?");
  if (queryStart === -1) return connectionString;
  const fragmentStart = connectionString.indexOf("#", queryStart);
  const queryEnd =
    fragmentStart === -1 ? connectionString.length : fragmentStart;

  const pairs = connectionString.slice(queryStart + 1, queryEnd).split("&");
  const names = pairs.map(paramName);
  if (names.some((name) => URL_CLIENT_CERT_PARAMS.includes(name))) {
    throw new Error(
      "[db] DATABASE_URL sets sslcert or sslkey, which DATABASE_SSL=true would discard. " +
        "Remove them, or leave DATABASE_SSL unset and keep the whole TLS setup in the URL.",
    );
  }

  const kept = pairs.filter((_, i) => !URL_TLS_PARAMS.includes(names[i]));
  if (kept.length === pairs.length) return connectionString;
  return (
    connectionString.slice(0, queryStart) +
    (kept.length > 0 ? `?${kept.join("&")}` : "") +
    connectionString.slice(queryEnd)
  );
}
