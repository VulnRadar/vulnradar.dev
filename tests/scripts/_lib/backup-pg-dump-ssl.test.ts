import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The pre-migration dump is the whole database leaving the host, so it follows
 * the same TLS rule as everything else: pg_dump through libpq's environment
 * variables, the built-in dumper through the shared pool options.
 */

const harness = vi.hoisted(() => ({
  havePgDump: true,
  dumpExitCode: 0,
  dumps: [] as {
    args: string[];
    env: Record<string, string | undefined>;
    rootCert: string | null;
  }[],
  pools: [] as Record<string, unknown>[],
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fs = await import("node:fs");
  const { Readable } = await import("node:stream");
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: vi.fn(
      (
        _cmd: string,
        args: string[],
        options: { env: Record<string, string | undefined> },
      ) => {
        const child = Object.assign(new EventEmitter(), {
          stdout: Readable.from(["-- dump\n"]),
          stderr: new EventEmitter(),
        });
        if (!harness.havePgDump) {
          setImmediate(() =>
            child.emit(
              "error",
              Object.assign(new Error("spawn pg_dump ENOENT"), {
                code: "ENOENT",
              }),
            ),
          );
          return child;
        }
        if (args[0] === "--version") {
          setImmediate(() => child.emit("exit", 0));
          return child;
        }
        const cert = options.env.PGSSLROOTCERT;
        harness.dumps.push({
          args,
          env: options.env,
          rootCert: cert ? fs.readFileSync(cert, "utf8") : null,
        });
        setImmediate(() => child.emit("close", harness.dumpExitCode));
        return child;
      },
    ),
  };
});

vi.mock("pg", () => {
  class Pool {
    constructor(options: Record<string, unknown>) {
      harness.pools.push(options);
    }
    async connect() {
      return { release() {} };
    }
    async end() {}
  }
  return { default: { Pool }, Pool };
});

vi.mock("../../../scripts/_lib/_lib.sql-backup.mjs", () => ({
  DUMP_LIMITS_NOTICE: [],
  generateSqlDump: async function* () {
    yield "-- js dump\n";
  },
}));

import { backupDatabase } from "../../../scripts/_lib/_lib.backup.mjs";

const CA = "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----";
const URL_WITH_TLS =
  "postgresql://user:s3cret@db.example.test:5432/app?sslmode=require";
const SAVED = { ...process.env };
let backupDir: string;

beforeEach(async () => {
  backupDir = await mkdtemp(join(tmpdir(), "vr-backup-ssl-"));
  process.env.BACKUP_DIR = backupDir;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.API_KEY_ENCRYPTION_KEY;
  process.env.DATABASE_SSL = "true";
  process.env.DATABASE_SSL_CA = CA;
  harness.havePgDump = true;
  harness.dumpExitCode = 0;
  harness.dumps.length = 0;
  harness.pools.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  process.env = { ...SAVED };
  vi.restoreAllMocks();
  await rm(backupDir, { recursive: true, force: true });
});

describe("pre-migration backup under DATABASE_SSL=true", () => {
  it("runs pg_dump with verify-full, the CA in a temp file, and no sslmode to override them", async () => {
    await backupDatabase(URL_WITH_TLS, "3.0.0");
    const [dump] = harness.dumps;
    expect(dump.env.PGSSLMODE).toBe("verify-full");
    expect(dump.rootCert).toBe(CA);
    expect(dump.args.at(-1)).toBe("postgresql://user@db.example.test:5432/app");
    expect(existsSync(dump.env.PGSSLROOTCERT as string)).toBe(false);
  });

  it("gives the built-in dumper the same TLS config", async () => {
    harness.havePgDump = false;
    await backupDatabase(URL_WITH_TLS, "3.0.0");
    expect(harness.pools[0].ssl).toEqual({ rejectUnauthorized: true, ca: CA });
    expect(harness.pools[0].connectionString).toBe(
      "postgresql://user:s3cret@db.example.test:5432/app",
    );
  });

  it("removes the temp CA when the dump fails too", async () => {
    harness.dumpExitCode = 1;
    await expect(backupDatabase(URL_WITH_TLS, "3.0.0")).rejects.toThrow(
      /pg_dump exited with code 1/,
    );
    expect(existsSync(harness.dumps[0].env.PGSSLROOTCERT as string)).toBe(
      false,
    );
  });
});
