import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import {
  checkDatabaseTls,
  databaseTlsStatus,
  databaseTlsWarning,
  pgConnectionString,
  pgSslConfig,
} from "@/lib/database/pg-ssl.mjs";

/**
 * The one TLS rule for the app pool and every script.
 *
 * The check that matters runs through node-pg's own ConnectionParameters and
 * not just over the returned strings. That class is why this module exists: it
 * assigns whatever it parses out of connectionString over the explicit `ssl`
 * option, so `?sslmode=require` used to erase DATABASE_SSL_CA without a word.
 */

const require = createRequire(import.meta.url);
const ConnectionParameters = require("pg/lib/connection-parameters") as new (
  config: Record<string, unknown>,
) => { ssl: unknown; host: string };

const CA = "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----";
const verified = { DATABASE_SSL: "true", DATABASE_SSL_CA: CA };
const BASE = "postgresql://user:pa%40ss@db.example.test:5432/app";

/** What node-pg actually connects with, given what the app passes it. */
function effectiveSsl(url: string, env: Record<string, string | undefined>) {
  return new ConnectionParameters({
    connectionString: pgConnectionString(url, env),
    ssl: pgSslConfig(env),
  }).ssl;
}

describe("pgSslConfig", () => {
  it("is off unless DATABASE_SSL is the literal 'true'", () => {
    expect(pgSslConfig({})).toBe(false);
    expect(pgSslConfig({ DATABASE_SSL: "false" })).toBe(false);
    expect(pgSslConfig({ DATABASE_SSL: "1" })).toBe(false);
  });

  it("verifies the certificate, and carries the CA only when one is set", () => {
    expect(pgSslConfig({ DATABASE_SSL: "true" })).toEqual({
      rejectUnauthorized: true,
    });
    expect(pgSslConfig(verified)).toEqual({ rejectUnauthorized: true, ca: CA });
  });
});

describe("with DATABASE_SSL=true the explicit config wins over the URL", () => {
  it.each([
    "sslmode=require",
    "sslmode=disable",
    "sslmode=no-verify",
    "sslmode=prefer",
    "sslmode=verify-ca",
    "ssl=false",
    "ssl=true",
    "ssl=no-verify",
    "sslnegotiation=direct",
    "uselibpqcompat=true&sslmode=require",
    // Reading this path is what node-pg would do if it stayed in the URL.
    "sslrootcert=/nonexistent/root.crt",
  ])("%s keeps the CA and rejectUnauthorized true", (query) => {
    expect(effectiveSsl(`${BASE}?${query}`, verified)).toEqual({
      rejectUnauthorized: true,
      ca: CA,
    });
  });

  it("removes only the TLS parameters and keeps the rest of the URL", () => {
    expect(
      pgConnectionString(
        `${BASE}?sslmode=require&application_name=vr&sslrootcert=/x`,
        verified,
      ),
    ).toBe(`${BASE}?application_name=vr`);
  });

  it("leaves no dangling '?' when the TLS parameter was the only one", () => {
    expect(pgConnectionString(`${BASE}?sslmode=require`, verified)).toBe(BASE);
  });

  it("returns a URL with no TLS parameters unchanged", () => {
    expect(pgConnectionString(BASE, verified)).toBe(BASE);
  });

  it.each(["sslcert=/c.crt", "sslkey=/c.key"])(
    "refuses %s rather than dropping a client certificate, and does not print the URL",
    (query) => {
      const attempt = () =>
        pgConnectionString(`${BASE}?sslmode=require&${query}`, verified);
      expect(attempt).toThrow(/sslcert or sslkey/);
      expect(attempt).not.toThrow(/pa%40ss/);
    },
  );

  it.each([
    // Both of these throw in `new URL`, and node-pg reads them anyway.
    "postgres://user:pa%40ss@/app?host=db.example.test&sslmode=disable",
    "postgres://user:pa%40ss@/app?host=db.example.test&sslmode=no-verify",
    "postgresql://user:pa%40ss@db exa.test:5432/app?sslmode=no-verify",
    // node-pg decodes the name, and its URL parser drops tabs before that.
    `${BASE}?%73slmode=disable`,
    `${BASE}?ssl\tmode=disable`,
    `${BASE}?sslmode=disable&sslmode=no-verify`,
  ])("%j cannot get past the rule", (url) => {
    expect(effectiveSsl(url, verified)).toEqual({
      rejectUnauthorized: true,
      ca: CA,
    });
  });

  it("refuses a client certificate in a URL the URL API cannot parse", () => {
    expect(() =>
      pgConnectionString(
        "postgres://user:pa%40ss@/app?host=db.example.test&sslcert=/c.crt",
        verified,
      ),
    ).toThrow(/sslcert or sslkey/);
  });

  it("leaves the encoding of what it keeps alone, because libpq reads + literally", () => {
    expect(
      pgConnectionString(
        `${BASE}?options=-c%20search_path%3Dapp&sslmode=require&application_name=my%20app`,
        verified,
      ),
    ).toBe(`${BASE}?options=-c%20search_path%3Dapp&application_name=my%20app`);
  });

  it("leaves a connection string with no query string alone", () => {
    expect(pgConnectionString("host=localhost dbname=x", verified)).toBe(
      "host=localhost dbname=x",
    );
    expect(pgConnectionString(undefined, verified)).toBeUndefined();
  });
});

describe("without DATABASE_SSL=true a URL that asks for TLS is not downgraded", () => {
  it.each([{}, { DATABASE_SSL: "false" }])(
    "keeps sslmode in the URL for %j, the shipped .env.example default",
    (env) => {
      const url = `${BASE}?sslmode=verify-full`;
      expect(pgConnectionString(url, env)).toBe(url);
      expect(effectiveSsl(url, env)).toEqual({});
    },
  );

  it("is plaintext only when neither the variable nor the URL asks for TLS", () => {
    expect(effectiveSsl(BASE, {})).toBe(false);
  });
});

/**
 * enc-6: DATABASE_SSL defaults to false and nothing said so when a production
 * install sent its password and every query across a network in plaintext.
 */
describe("databaseTlsWarning", () => {
  const REMOTE = "postgresql://vr:secret@db.example.com:5432/vulnradar";
  const prod = (url: string, extra: Record<string, string> = {}) => ({
    NODE_ENV: "production",
    DATABASE_URL: url,
    ...extra,
  });

  it("warns for production against a remote host with no TLS, naming both variables", () => {
    const warning = databaseTlsWarning(prod(REMOTE));
    expect(warning).toMatch(/DATABASE_SSL\b/);
    expect(warning).toMatch(/DATABASE_SSL_CA/);
    expect(warning).not.toMatch(/\n/);
  });

  it("never prints the URL, the password or the host", () => {
    const warning = databaseTlsWarning(prod(REMOTE)) ?? "";
    expect(warning).not.toContain("secret");
    expect(warning).not.toContain("db.example.com");
  });

  it.each([
    [{ DATABASE_SSL: "true" }, REMOTE],
    [{}, `${REMOTE}?sslmode=require`],
    [{}, `${REMOTE}?sslmode=verify-ca`],
    [{}, `${REMOTE}?sslmode=verify-full`],
    [{}, `${REMOTE}?application_name=vr&sslmode=verify-full`],
    [{}, `${REMOTE}?ssl=true`],
    [{ DATABASE_SSL: "false" }, `${REMOTE}?sslmode=require`],
  ])("is quiet when TLS is on (%j, %s)", (extra, url) => {
    expect(databaseTlsWarning(prod(url, extra))).toBeNull();
  });

  it.each([
    [{ DATABASE_SSL: "false" }, REMOTE],
    [{ DATABASE_SSL: "1" }, REMOTE],
    [{}, `${REMOTE}?sslmode=disable`],
    // libpq falls back to plaintext on these, and the scripts hand the URL to
    // libpq, so they are not the operator asking for an encrypted connection.
    [{}, `${REMOTE}?sslmode=prefer`],
    [{}, `${REMOTE}?sslmode=allow`],
    // node-pg keeps the last value, so a trailing disable wins.
    [{}, `${REMOTE}?sslmode=require&sslmode=disable`],
    [{}, `${REMOTE}?ssl=true&sslmode=disable`],
    [{}, `${REMOTE}?ssl=false`],
  ])("still warns for %j, %s", (extra, url) => {
    expect(databaseTlsWarning(prod(url, extra))).not.toBeNull();
  });

  // [url, the host node-pg connects to, remote]
  it.each([
    ["postgresql://vr:p@postgres:5432/vulnradar", "postgres", false],
    ["postgresql://vr:p@vr-db:5432/vulnradar", "vr-db", false],
    ["postgresql://vr:p@localhost:5432/vulnradar", "localhost", false],
    ["postgresql://vr:p@LOCALHOST/vulnradar", "LOCALHOST", false],
    ["postgresql://vr:p@127.0.0.1:5432/vulnradar", "127.0.0.1", false],
    ["postgresql://vr:p@127.0.0.53/vulnradar", "127.0.0.53", false],
    ["postgresql://vr:p@[::1]:5432/vulnradar", "::1", false],
    [
      "postgresql://vr:p@/vulnradar?host=/var/run/postgresql",
      "/var/run/postgresql",
      false,
    ],
    [
      "postgresql:///vulnradar?host=%2Fvar%2Frun%2Fpostgresql",
      "/var/run/postgresql",
      false,
    ],
    [
      "postgresql://vr:p@%2Fvar%2Frun%2Fpostgresql/vulnradar",
      "/var/run/postgresql",
      false,
    ],
    ["socket:/var/run/postgresql?db=vulnradar", "/var/run/postgresql", false],
    ["/var/run/postgresql vulnradar", "/var/run/postgresql", false],
    ["postgresql:///vulnradar", "localhost", false],
    [REMOTE, "db.example.com", true],
    ["postgresql://vr:p@10.0.0.5:5432/vulnradar", "10.0.0.5", true],
    ["postgresql://vr:p@[2001:db8::1]:5432/vulnradar", "2001:db8::1", true],
    [
      "postgresql://vr:p@postgres.default.svc.cluster.local/vulnradar",
      "postgres.default.svc.cluster.local",
      true,
    ],
    // The query parameter is what node-pg connects to, not the authority.
    [
      "postgresql://vr:p@localhost/vulnradar?host=db.example.com",
      "db.example.com",
      true,
    ],
    ["postgres://vr:p@/vulnradar?host=db.example.com", "db.example.com", true],
  ] as const)("%s connects to %s, remote: %s", (url, host, remote) => {
    expect(new ConnectionParameters({ connectionString: url }).host).toBe(host);
    expect(databaseTlsStatus(prod(url)).remote).toBe(remote);
    expect(databaseTlsWarning(prod(url)) !== null).toBe(remote);
  });

  it("follows PGHOST when the URL names no host, as node-pg does", () => {
    const env = prod("postgresql:///vulnradar", { PGHOST: "db.example.com" });
    expect(databaseTlsStatus(env).remote).toBe(true);
    expect(databaseTlsWarning(env)).not.toBeNull();
  });

  it("treats a DATABASE_URL it cannot read as remote rather than going quiet", () => {
    expect(databaseTlsStatus(prod("postgresql://vr:p@[bad/x")).remote).toBe(
      true,
    );
  });

  it.each([undefined, "development", "test"])(
    "never warns when NODE_ENV is %s",
    (nodeEnv) => {
      expect(
        databaseTlsWarning({ NODE_ENV: nodeEnv, DATABASE_URL: REMOTE }),
      ).toBeNull();
    },
  );

  it("says nothing without a DATABASE_URL, which validateEnv already refuses", () => {
    expect(databaseTlsWarning({ NODE_ENV: "production" })).toBeNull();
  });

  it("only calls a URL encrypted when node-pg really does encrypt it", () => {
    for (const query of [
      "sslmode=require",
      "sslmode=verify-ca",
      "sslmode=verify-full",
      "ssl=true",
      "ssl=1",
    ]) {
      const url = `${REMOTE}?${query}`;
      expect(databaseTlsStatus(prod(url)).encrypted).toBe(true);
      expect(effectiveSsl(url, {})).toBeTruthy();
    }
  });
});

describe("databaseTlsStatus", () => {
  it("reports the facts in every environment and the warning only in production", () => {
    const env = { DATABASE_URL: "postgresql://vr:p@db.example.com/app" };
    expect(databaseTlsStatus({ ...env, NODE_ENV: "development" })).toEqual({
      encrypted: false,
      remote: true,
      warning: null,
    });
    const prodStatus = databaseTlsStatus({ ...env, NODE_ENV: "production" });
    expect(prodStatus.encrypted).toBe(false);
    expect(prodStatus.remote).toBe(true);
    expect(prodStatus.warning).toBe(
      databaseTlsWarning({ ...env, NODE_ENV: "production" }),
    );
  });

  it("is encrypted with DATABASE_SSL=true whatever the URL says", () => {
    expect(
      databaseTlsStatus({
        NODE_ENV: "production",
        DATABASE_SSL: "true",
        DATABASE_URL: "postgresql://vr:p@db.example.com/app?sslmode=disable",
      }),
    ).toEqual({ encrypted: true, remote: true, warning: null });
  });
});

describe("checkDatabaseTls (the boot path)", () => {
  const plaintext = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://vr:p@db.example.com/app",
  };

  it("returns the warning for register() to log", () => {
    expect(checkDatabaseTls(plaintext)).toBe(databaseTlsWarning(plaintext));
  });

  it("throws the same text with DATABASE_SSL_REQUIRED=true", () => {
    const warning = databaseTlsWarning(plaintext) as string;
    expect(() =>
      checkDatabaseTls({ ...plaintext, DATABASE_SSL_REQUIRED: "true" }),
    ).toThrow(warning);
  });

  it.each([
    { ...plaintext, DATABASE_SSL: "true" },
    { ...plaintext, DATABASE_URL: "postgresql://vr:p@postgres/app" },
    { ...plaintext, NODE_ENV: "development" },
  ])(
    "boots with DATABASE_SSL_REQUIRED=true when there is nothing to refuse (%j)",
    (env) => {
      expect(
        checkDatabaseTls({ ...env, DATABASE_SSL_REQUIRED: "true" }),
      ).toBeNull();
    },
  );

  it("only refuses on the literal 'true', like DATABASE_SSL", () => {
    expect(
      checkDatabaseTls({ ...plaintext, DATABASE_SSL_REQUIRED: "1" }),
    ).not.toBeNull();
  });
});
