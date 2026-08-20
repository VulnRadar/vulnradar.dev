import { describe, it, expect } from "vitest";
import { splitDbUrlForEnv } from "../../../scripts/_lib/_lib.db-url.mjs";

/**
 * splitDbUrlForEnv keeps the DB password out of pg_dump/psql argv (visible via
 * `ps` on a shared host) by moving it into PGPASSWORD and stripping it from the
 * connection string. These lock in that the password never survives in the arg
 * and that password-less / non-URL inputs pass through untouched.
 */
const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe("splitDbUrlForEnv", () => {
  it("strips the password from the URL and moves it (decoded) to PGPASSWORD", () => {
    const { connArg, env: out } = splitDbUrlForEnv(
      "postgres://user:s3cr3t%40pw@host:5432/db",
      env({}),
    );
    expect(connArg).toBe("postgres://user@host:5432/db");
    expect(connArg).not.toContain("s3cr3t");
    expect(out.PGPASSWORD).toBe("s3cr3t@pw"); // %40 decoded for libpq
  });

  it("preserves the rest of the base env", () => {
    const { env: out } = splitDbUrlForEnv(
      "postgres://u:p@h/db",
      env({ FOO: "1" }),
    );
    expect(out.FOO).toBe("1");
    expect(out.PGPASSWORD).toBe("p");
  });

  it("leaves a password-less URL unchanged and sets no PGPASSWORD", () => {
    const base = env({ FOO: "1" });
    const { connArg, env: out } = splitDbUrlForEnv(
      "postgres://user@host/db",
      base,
    );
    expect(connArg).toBe("postgres://user@host/db");
    expect(out.PGPASSWORD).toBeUndefined();
    expect(out).toBe(base); // same object, untouched
  });

  it("leaves an unparseable DSN unchanged", () => {
    const { connArg, env: out } = splitDbUrlForEnv(
      "host=localhost dbname=db",
      env({}),
    );
    expect(connArg).toBe("host=localhost dbname=db");
    expect(out.PGPASSWORD).toBeUndefined();
  });

  it("returns the input unchanged for an empty value", () => {
    const { connArg } = splitDbUrlForEnv("", env({}));
    expect(connArg).toBe("");
  });
});
