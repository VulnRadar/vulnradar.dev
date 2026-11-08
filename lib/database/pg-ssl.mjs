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
