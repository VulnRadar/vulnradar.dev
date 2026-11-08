import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import pg from "pg";
import {
  buildConnectionString,
  createPool,
  parseDbUrl,
  pgPoolOptions,
  pgToolConnection,
} from "../../../scripts/_lib/_lib.db.mjs";
import { listDatabases } from "../../../scripts/_lib/_lib.target.mjs";

/**
 * Every script connection goes through the app's TLS rule.
 *
 * Before this, createPool passed no `ssl` at all and buildConnectionString
 * threw the query string away, so with DATABASE_SSL=true a migration, a backup
 * or a repair ran in plaintext against a database the app itself would only
 * reach over verified TLS.
 */

const CA = "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----";
const URL_WITH_TLS =
  "postgresql://user:s3cret@db.example.test:5432/app?sslmode=require";
const SAVED = { ...process.env };

beforeEach(() => {
  delete process.env.DATABASE_SSL;
  delete process.env.DATABASE_SSL_CA;
  delete process.env.PGSSLMODE;
  process.env.DATABASE_URL =
    "postgresql://user:s3cret@db.example.test:5432/app";
});

afterEach(() => {
  process.env = { ...SAVED };
  vi.restoreAllMocks();
});

function useTls() {
  process.env.DATABASE_SSL = "true";
  process.env.DATABASE_SSL_CA = CA;
}

describe("createPool", () => {
  it("applies DATABASE_SSL and DATABASE_SSL_CA", () => {
    useTls();
    expect(createPool().options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: CA,
    });
  });

  it("takes sslmode out of the URL so it cannot erase that config", () => {
    useTls();
    process.env.DATABASE_URL = URL_WITH_TLS;
    expect(createPool().options.connectionString).toBe(
      "postgresql://user:s3cret@db.example.test:5432/app",
    );
  });

  it("sets no ssl key when TLS is off, so PGSSLMODE still applies as it does for pg_dump", () => {
    expect("ssl" in createPool().options).toBe(false);
  });

  it("keeps its timeouts", () => {
    expect(createPool().options).toMatchObject({
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
    });
  });
});

describe("pgPoolOptions", () => {
  it("uses the connection string it is given, not DATABASE_URL", () => {
    expect(
      pgPoolOptions("postgresql://a:b@other.test:5432/other").connectionString,
    ).toBe("postgresql://a:b@other.test:5432/other");
  });
});

describe("listDatabases", () => {
  it("connects under the same rule", async () => {
    useTls();
    const built: Record<string, unknown>[] = [];
    vi.spyOn(pg, "Pool").mockImplementation(function FakePool(
      options: Record<string, unknown>,
    ) {
      built.push(options);
      return {
        query: async () => ({ rows: [] }),
        end: async () => {},
      };
    } as never);
    await listDatabases(parseDbUrl(URL_WITH_TLS));
    expect(built[0].ssl).toEqual({ rejectUnauthorized: true, ca: CA });
    expect(built[0].connectionString).not.toContain("sslmode");
  });
});

describe("buildConnectionString", () => {
  it("keeps the original query string", () => {
    const parsed = parseDbUrl(`${URL_WITH_TLS}&application_name=vr`);
    expect(buildConnectionString(parsed, "other")).toBe(
      "postgresql://user:s3cret@db.example.test:5432/other?sslmode=require&application_name=vr",
    );
  });

  it("changes only the database when the role and the database share a name", () => {
    const parsed = parseDbUrl(
      "postgresql://vulnradar:pw@postgres:5432/vulnradar",
    );
    expect(buildConnectionString(parsed, "vulnradar_v3")).toBe(
      "postgresql://vulnradar:pw@postgres:5432/vulnradar_v3",
    );
  });

  it("defaults to the parsed database and port", () => {
    expect(buildConnectionString(parseDbUrl("postgres://u:p@h/db?a=1"))).toBe(
      "postgresql://u:p@h:5432/db?a=1",
    );
  });

  it("leaves an already-encoded password encoded", () => {
    const parsed = parseDbUrl("postgresql://u:p%40ss%2Fw@h:5432/db");
    expect(buildConnectionString(parsed, "x")).toBe(
      "postgresql://u:p%40ss%2Fw@h:5432/x",
    );
  });

  it("encodes a database name that would otherwise start a query string", () => {
    const parsed = parseDbUrl("postgresql://u:p@h:5432/db");
    expect(buildConnectionString(parsed, "a?b")).toBe(
      "postgresql://u:p@h:5432/a%3Fb",
    );
  });
});

describe("pgToolConnection", () => {
  it("adds nothing when TLS is off and leaves the URL's own sslmode in place", async () => {
    const { connArg, env, cleanup } = await pgToolConnection(URL_WITH_TLS);
    expect(connArg).toBe(
      "postgresql://user@db.example.test:5432/app?sslmode=require",
    );
    expect(env.PGPASSWORD).toBe("s3cret");
    expect(env.PGSSLMODE).toBeUndefined();
    expect(env.PGSSLROOTCERT).toBeUndefined();
    await cleanup();
  });

  it("verifies against the CA from a temp file, and removes it afterwards", async () => {
    useTls();
    const { connArg, env, cleanup } = await pgToolConnection(URL_WITH_TLS);
    // libpq lets a URL parameter beat the environment, so it has to go.
    expect(connArg).toBe("postgresql://user@db.example.test:5432/app");
    expect(env.PGSSLMODE).toBe("verify-full");
    expect(readFileSync(env.PGSSLROOTCERT as string, "utf8")).toBe(CA);
    await cleanup();
    expect(existsSync(env.PGSSLROOTCERT as string)).toBe(false);
  });

  it("falls back to the roots Node trusts when no CA is set", async () => {
    process.env.DATABASE_SSL = "true";
    const { env, cleanup } = await pgToolConnection(URL_WITH_TLS);
    const pem = readFileSync(env.PGSSLROOTCERT as string, "utf8");
    expect(pem).toContain(rootCertificates[0]);
    await cleanup();
  });

  it("leaves the caller's environment object alone", async () => {
    const base = { DATABASE_SSL: "true", DATABASE_SSL_CA: CA };
    const { cleanup } = await pgToolConnection(URL_WITH_TLS, base);
    expect(Object.keys(base)).toEqual(["DATABASE_SSL", "DATABASE_SSL_CA"]);
    await cleanup();
  });
});
