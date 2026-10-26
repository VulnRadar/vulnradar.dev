import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The pre-migration backup writes under BACKUP_DIR, not <root>/databases.
 *
 * It used to go to <project root>/databases, a directory nothing created. In
 * the Docker image /app is root-owned and the app runs as uid 1001, so the
 * mkdir failed with EACCES and `npm run db:migrate` died before any DDL ran,
 * with a stack trace as the only explanation. BACKUP_DIR is the directory the
 * image already makes writable and mounts as a volume.
 *
 * Nothing here needs Postgres or pg_dump: the child process is stubbed to
 * report pg_dump missing (so the built-in dumper runs), and the dumper and the
 * pool are stubbed to produce a fixed dump. What is real is the directory
 * choice, the file layout and the failure handling, which is what changed.
 */

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      setImmediate(() =>
        child.emit(
          "error",
          Object.assign(new Error("spawn pg_dump ENOENT"), { code: "ENOENT" }),
        ),
      );
      return child;
    }),
  };
});

vi.mock("pg", () => {
  class Pool {
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
    yield "-- VulnRadar test dump\n";
    yield "CREATE TABLE users (id integer);\n".repeat(40);
  },
}));

import {
  backupDatabase,
  describeBackupFailure,
  resolvePreMigrationRoot,
  runPreMigrationBackup,
} from "../../../scripts/_lib/_lib.backup.mjs";

const KEYS = [
  "BACKUP_DIR",
  "BACKUP_ENCRYPTION_KEY",
  "API_KEY_ENCRYPTION_KEY",
  "MIGRATION_BACKUP_RETENTION_DAYS",
] as const;

let saved: Record<string, string | undefined>;
let workDir: string;
let output: string[];

beforeEach(async () => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  workDir = await mkdtemp(join(tmpdir(), "vulnradar-premigration-"));
  output = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    output.push(String(line));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(workDir, { recursive: true, force: true });
});

describe("resolvePreMigrationRoot", () => {
  it("defaults to ./backups/pre-migration under the app root", () => {
    const root = resolve("/srv/vulnradar");
    const where = resolvePreMigrationRoot({ env: {}, root });
    expect(where.dir).toBe(resolve(root, "backups", "pre-migration"));
    expect(where.label).toBe("backups/pre-migration");
  });

  it("follows BACKUP_DIR, the directory the image mounts as a volume", () => {
    const where = resolvePreMigrationRoot({
      env: { BACKUP_DIR: "/data/vr-backups" },
      root: resolve("/srv/vulnradar"),
    });
    expect(where.dir).toBe(resolve("/data/vr-backups", "pre-migration"));
    expect(where.label).toBe("$BACKUP_DIR/pre-migration");
  });

  it("treats an empty BACKUP_DIR as unset, the way backup-db.mjs does", () => {
    const root = resolve("/srv/vulnradar");
    expect(resolvePreMigrationRoot({ env: { BACKUP_DIR: "" }, root }).dir).toBe(
      resolve(root, "backups", "pre-migration"),
    );
  });

  it("no longer points at <root>/databases", () => {
    const root = resolve("/srv/vulnradar");
    const dirs = [
      resolvePreMigrationRoot({ env: {}, root }).dir,
      resolvePreMigrationRoot({ env: { BACKUP_DIR: "/x" }, root }).dir,
    ];
    for (const dir of dirs) expect(dir).not.toContain("databases");
  });

  it("reads the environment when called, not when the module loaded", () => {
    process.env.BACKUP_DIR = join(workDir, "late");
    expect(resolvePreMigrationRoot().dir).toBe(
      resolve(workDir, "late", "pre-migration"),
    );
  });
});

describe("backupDatabase", () => {
  it("writes the dump under BACKUP_DIR/pre-migration/v{major}/{schema}/", async () => {
    process.env.BACKUP_DIR = workDir;

    const written = await backupDatabase("postgres://u:p@h:5432/db", "3.9.1");

    const folder = join(workDir, "pre-migration", "v3", "3.9.1");
    expect(resolve(written).startsWith(resolve(folder))).toBe(true);
    const files = await readdir(folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^vulnradar-backup-.*\.sql\.gz$/);
  });

  it("names the label, not the absolute path, in its log lines", async () => {
    process.env.BACKUP_DIR = workDir;

    await backupDatabase("postgres://u:p@h:5432/db", "3.9.1");

    const text = output.join("\n");
    expect(text).toContain("$BACKUP_DIR/pre-migration/v3/3.9.1/");
    expect(text).not.toContain(workDir);
    expect(text).toMatch(
      /npm run db:restore -- --file=\$BACKUP_DIR\/pre-migration\//,
    );
  });

  it("encrypts and writes the sidecar when a key is available", async () => {
    process.env.BACKUP_DIR = workDir;
    process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);

    await backupDatabase("postgres://u:p@h:5432/db", "3.9.1");

    const files = await readdir(join(workDir, "pre-migration", "v3", "3.9.1"));
    expect(files.sort()).toEqual([
      expect.stringMatching(/\.sql\.gz\.enc$/),
      expect.stringMatching(/\.sql\.gz\.enc\.json$/),
    ]);
  });

  it("leaves BACKUP_DIR's own files alone, so the admin list and retention never see these", async () => {
    process.env.BACKUP_DIR = workDir;

    await backupDatabase("postgres://u:p@h:5432/db", "3.9.1");

    const top = await readdir(workDir);
    expect(top).toEqual(["pre-migration"]);
    expect(top.some((n) => n.startsWith("vulnradar-backup-"))).toBe(false);
  });
});

describe("describeBackupFailure", () => {
  const where = {
    dir: resolve("/data/b/pre-migration"),
    label: "$BACKUP_DIR/pre-migration",
  };
  const failure = (code: string, message = "boom") =>
    Object.assign(new Error(message), { code });

  it("says nothing was changed and how to get past it", () => {
    const [headline, ...rest] = describeBackupFailure(failure("EIO"), where);
    expect(headline).toContain("stopped before it changed anything");
    expect(rest.at(-1)).toContain("--skip-backup");
  });

  it("tells the operator a permission failure is about the directory", () => {
    const lines = describeBackupFailure(failure("EACCES"), where).join("\n");
    expect(lines).toContain("$BACKUP_DIR/pre-migration is not writable");
    expect(lines).toContain("BACKUP_DIR");
  });

  it.each(["EPERM", "EROFS"])("treats %s the same way", (code) => {
    expect(describeBackupFailure(failure(code), where).join("\n")).toContain(
      "is not writable",
    );
  });

  it("recognises a full disk", () => {
    expect(
      describeBackupFailure(failure("ENOSPC"), where).join("\n"),
    ).toContain("is full");
  });

  it("recognises a file where the directory should be", () => {
    expect(
      describeBackupFailure(failure("ENOTDIR"), where).join("\n"),
    ).toContain("A file is in the way");
  });

  it("falls back to pointing at the output above for anything else", () => {
    expect(
      describeBackupFailure(
        new Error("pg_dump exited with code 1"),
        where,
      ).join("\n"),
    ).toContain("Check the output above");
  });

  it("does not print the absolute backup path an fs error quotes", () => {
    const abs = join(where.dir, "v3", "3.9.1");
    const message = `EACCES: permission denied, mkdir '${abs}'`;
    const [headline] = describeBackupFailure(failure("EACCES", message), where);
    expect(headline).not.toContain(where.dir);
    expect(headline).toContain("$BACKUP_DIR/pre-migration");
  });

  it("copes with a thrown value that is not an Error", () => {
    expect(describeBackupFailure("nope", where)[0]).toContain("nope");
  });
});

describe("runPreMigrationBackup", () => {
  it("takes the backup and lets the migration go on", async () => {
    process.env.BACKUP_DIR = workDir;

    const ok = await runPreMigrationBackup({
      connectionString: "postgres://u:p@h:5432/db",
      schemaVersion: "3.9.1",
    });

    expect(ok).toBe(true);
    expect(existsSync(join(workDir, "pre-migration", "v3", "3.9.1"))).toBe(
      true,
    );
  });

  it("with skip, takes no backup, warns, and lets the migration go on", async () => {
    process.env.BACKUP_DIR = workDir;

    const ok = await runPreMigrationBackup({
      connectionString: "postgres://u:p@h:5432/db",
      schemaVersion: "3.9.1",
      skip: true,
    });

    expect(ok).toBe(true);
    expect(await readdir(workDir)).toEqual([]);
    expect(output.join("\n")).toContain("--skip-backup");
  });

  it("stops the migration, with a fix, when the backup directory cannot be made", async () => {
    // A regular file where BACKUP_DIR's parent should be: mkdir cannot succeed
    // on any platform or as any user, unlike a chmod'd directory, which root
    // (the CI container) walks straight through.
    const blocker = join(workDir, "not-a-directory");
    await writeFile(blocker, "x");
    process.env.BACKUP_DIR = join(blocker, "backups");

    const ok = await runPreMigrationBackup({
      connectionString: "postgres://u:p@h:5432/db",
      schemaVersion: "3.9.1",
    });

    expect(ok).toBe(false);
    const text = output.join("\n");
    expect(text).toContain("The pre-migration backup failed");
    expect(text).toContain("stopped before it changed anything");
    expect(text).toContain("--skip-backup");
  });
});

describe("migrate.mjs", () => {
  // migrate.mjs runs main() on import, so it cannot be loaded here without a
  // database. These pin the three lines of glue that connect it to the tested
  // backup step above.
  const source = readFileSync(
    join(process.cwd(), "scripts", "migrate", "migrate.mjs"),
    "utf8",
  );

  it("reads --skip-backup and hands it to the backup step", () => {
    expect(source).toMatch(
      /const SKIP_BACKUP = process\.argv\.includes\("--skip-backup"\)/,
    );
    expect(source).toMatch(/skip: SKIP_BACKUP/);
  });

  it("exits non-zero before any DDL when the backup step says to stop", () => {
    const backup = source.indexOf("runPreMigrationBackup({");
    const stop = source.indexOf("if (!mayProceed) process.exit(1)");
    const execute = source.indexOf('section("Step 6: Execute")');
    expect(backup).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(backup);
    expect(execute).toBeGreaterThan(stop);
  });

  it("lists the flag in --help", () => {
    expect(source).toMatch(/npm run db:migrate -- --skip-backup\n\s+# do not/);
  });
});
