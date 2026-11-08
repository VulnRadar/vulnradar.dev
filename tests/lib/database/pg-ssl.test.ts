import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { pgConnectionString, pgSslConfig } from "@/lib/database/pg-ssl.mjs";

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
) => { ssl: unknown };

const CA = "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----";
const verified = { DATABASE_SSL: "true", DATABASE_SSL_CA: CA };
const BASE = "postgresql://user:pa%40ss@db.example.test:5432/app";

/** What node-pg actually connects with, given what the app passes it. */
function effectiveSsl(url: string, env: Record<string, string>) {
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

  it("leaves a connection string it cannot parse alone", () => {
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
