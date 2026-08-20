/**
 * Keep the database password out of the child process's argv.
 *
 * pg_dump / psql accept the connection string as a command-line argument, but
 * anything in argv is visible to other local users via `ps` and
 * /proc/<pid>/cmdline. Passing the full DATABASE_URL (which embeds the
 * password) that way leaks it on a shared host. libpq reads the password from
 * the PGPASSWORD env var instead, so this splits the URL: it returns the
 * connection string with the password stripped, plus a child `env` that
 * carries the password in PGPASSWORD. A URL with no password (peer/trust auth)
 * or an unparseable DSN is returned unchanged with no PGPASSWORD added.
 */
export function splitDbUrlForEnv(databaseUrl, baseEnv = process.env) {
  if (!databaseUrl) return { connArg: databaseUrl, env: baseEnv };
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Not a parseable URL (e.g. a libpq key=value DSN) -- leave it as-is.
    return { connArg: databaseUrl, env: baseEnv };
  }
  if (!url.password) return { connArg: databaseUrl, env: baseEnv };
  // libpq wants the raw (decoded) password in PGPASSWORD; the URL stored it
  // percent-encoded.
  const password = decodeURIComponent(url.password);
  url.password = "";
  return {
    connArg: url.toString(),
    env: { ...baseEnv, PGPASSWORD: password },
  };
}
