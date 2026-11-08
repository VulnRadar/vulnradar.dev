import { it, expect, beforeAll, afterAll } from "vitest";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import { Client, Pool } from "pg";
import { describeIntegration } from "./_db";

/**
 * ops-3 and ops-5, end to end, with the real scripts against a real server.
 *
 * ops-3: the documented rollback was `db:restore --force`, and neither dump
 * format has a DROP statement, so a restore over the schema that is already
 * there stopped at its first CREATE. An operator mid-incident had no way back.
 * ops-5: the offsite copy was unreadable, because the IV and auth tag went to
 * a second URL that a presigned link does not authorise.
 *
 * The restore here is fed the bytes the upload delivered and nothing else, so
 * both are proved by the same round trip. The unit tier fakes pg and cannot
 * say whether Postgres really drops, recreates and refills the schema inside
 * one transaction.
 */
const { applySchema, META_TABLE_SQL } =
  await import("@/lib/database/schema/index.mjs");
const { moduleStepStatements } =
  await import("@/scripts/_lib/_lib.schema-parity.mjs");
const { marker, DUMP_FORMAT, DUMP_FORMAT_VERSION } =
  await import("@/scripts/_lib/_lib.sql-backup.mjs");
const { psqlRestoreInput, restorePsqlArgs } =
  await import("@/scripts/restore-db.mjs");

// The path a pg_dump backup takes, which is every install that has pg_dump.
// Conditional for a contributor without the client; CI fails on any skip.
const hasPsql = spawnSync("psql", ["--version"]).status === 0;

const ssl =
  process.env.INTEGRATION_DATABASE_SSL === "true"
    ? { rejectUnauthorized: true }
    : false;

const KEY = randomBytes(32).toString("hex");

let adminClient: Client | null = null;
let scratchName = "";
let scratchUrl = "";
let scratch: Pool | null = null;
let workDir = "";
let server: Server | null = null;
let offsiteUrl = "";
let uploads: { url: string; body: Buffer }[] = [];
let uploadStatus = 200;

function db(): Pool {
  if (!scratch) throw new Error("the scratch database was never created");
  return scratch;
}

function runScript(
  script: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        env: {
          ...process.env,
          DATABASE_URL: scratchUrl,
          DATABASE_SSL: ssl ? "true" : "false",
          BACKUP_DIR: join(workDir, "backups"),
          BACKUP_ENCRYPTION_KEY: KEY,
          ...env,
        },
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const code = err ? Number((err as { code?: number }).code ?? 1) : 0;
        done({ code, output: `${stdout}\n${stderr}` });
      },
    );
  });
}

async function insertUser(email: string): Promise<void> {
  await db().query(
    `INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-real-hash')`,
    [email],
  );
}

async function emails(): Promise<string[]> {
  const res = await db().query<{ email: string }>(
    `SELECT email FROM users ORDER BY email`,
  );
  return res.rows.map((r) => r.email);
}

async function tableExists(name: string): Promise<boolean> {
  const res = await db().query<{ found: string | null }>(
    `SELECT to_regclass($1) AS found`,
    [`public.${name}`],
  );
  return res.rows[0].found !== null;
}

describeIntegration("db:backup then db:restore --replace", () => {
  beforeAll(async () => {
    const url = new URL(process.env.INTEGRATION_DATABASE_URL as string);
    const base =
      decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
    scratchName = `${base}_replace_${randomBytes(4).toString("hex")}`;

    adminClient = new Client({ connectionString: url.toString(), ssl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${scratchName}"`);

    url.pathname = `/${scratchName}`;
    scratchUrl = url.toString();
    scratch = new Pool({ connectionString: scratchUrl, ssl, max: 2 });
    scratch.on("error", () => {});

    // The boot path itself, as `npm run db:create` runs it from plain Node.
    await db().query(META_TABLE_SQL);
    await applySchema(db(), {
      runModuleStep: async (step: unknown) => {
        for (const statement of moduleStepStatements(step)) {
          await db().query(statement);
        }
      },
    });

    workDir = await mkdtemp(join(tmpdir(), "vulnradar-replace-"));
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        uploads.push({ url: req.url ?? "", body: Buffer.concat(chunks) });
        res.statusCode = uploadStatus;
        res.end();
      });
    });
    await new Promise<void>((done) =>
      (server as Server).listen(0, "127.0.0.1", done),
    );
    const { port } = (server as Server).address() as AddressInfo;
    offsiteUrl = `http://127.0.0.1:${port}/bucket/nightly?X-Amz-Signature=abc`;
  }, 180_000);

  afterAll(async () => {
    if (server) await new Promise((done) => (server as Server).close(done));
    if (workDir) await rm(workDir, { recursive: true, force: true });
    if (scratch) await scratch.end().catch(() => {});
    if (adminClient) {
      if (scratchName) {
        await adminClient
          .query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`)
          .catch(() => {});
      }
      await adminClient.end().catch(() => {});
    }
  }, 60_000);

  let uploadedCopy = "";

  it("takes a backup whose single uploaded object is the whole backup", async () => {
    await insertUser("kept@example.test");
    const { code, output } = await runScript(
      "scripts/backup-db.mjs",
      ["--js"],
      { BACKUP_OFFSITE_UPLOAD_URL: offsiteUrl },
    );
    expect(output).toContain("Backup complete.");
    expect(code).toBe(0);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe("/bucket/nightly?X-Amz-Signature=abc");

    // No sidecar next to this one: only what the receiver was sent.
    uploadedCopy = join(workDir, "from-offsite.sql.gz.enc");
    await writeFile(uploadedCopy, uploads[0].body);
  }, 120_000);

  it("exits non-zero when the offsite upload fails", async () => {
    uploadStatus = 403;
    try {
      const { code, output } = await runScript(
        "scripts/backup-db.mjs",
        ["--js"],
        { BACKUP_OFFSITE_UPLOAD_URL: offsiteUrl },
      );
      expect(code).toBe(1);
      expect(output).toContain("403");
    } finally {
      uploadStatus = 200;
    }
  }, 120_000);

  it("keeps the local backup's sidecar", async () => {
    const names = await readdir(join(workDir, "backups"));
    expect(names.some((n) => n.endsWith(".enc.json"))).toBe(true);
  });

  it("refuses a populated database without --replace or --force", async () => {
    const { code, output } = await runScript("scripts/restore-db.mjs", [
      `--file=${uploadedCopy}`,
      "--yes",
    ]);
    expect(code).toBe(1);
    expect(output).toContain("Refusing to restore");
  }, 120_000);

  it("leaves the database as it was when --force meets the existing schema", async () => {
    await insertUser("added-after-backup@example.test");
    const { code, output } = await runScript("scripts/restore-db.mjs", [
      `--file=${uploadedCopy}`,
      "--yes",
      "--force",
    ]);
    expect(code).toBe(1);
    expect(output).toContain("--force only lets the attempt start");
    expect(await emails()).toEqual([
      "added-after-backup@example.test",
      "kept@example.test",
    ]);
  }, 120_000);

  it("rolls the reset back when the backup does not apply", async () => {
    const broken = join(workDir, "broken.sql.gz");
    await writeFile(
      broken,
      gzipSync(
        [
          marker("DUMP", {
            format: DUMP_FORMAT,
            version: DUMP_FORMAT_VERSION,
          }),
          marker("STMT"),
          "SELECT nonsense FROM nowhere;",
          marker("END", { rows: 0 }),
          "",
        ].join("\n"),
      ),
    );
    const { code } = await runScript("scripts/restore-db.mjs", [
      `--file=${broken}`,
      "--yes",
      "--replace",
    ]);
    expect(code).toBe(1);
    expect(await emails()).toEqual([
      "added-after-backup@example.test",
      "kept@example.test",
    ]);
  }, 120_000);

  it.skipIf(!hasPsql)(
    "rolls the reset back on the psql path when a statement fails",
    async () => {
      const broken = join(workDir, "broken-plain.sql.gz");
      await writeFile(
        broken,
        gzipSync(
          "CREATE TABLE half_restored (id int);\nSELECT nonsense FROM nowhere;\n",
        ),
      );
      const { code, output } = await runScript("scripts/restore-db.mjs", [
        `--file=${broken}`,
        "--yes",
        "--replace",
      ]);
      expect(output).toContain("psql exited with code");
      expect(code).toBe(1);
      expect(await emails()).toEqual([
        "added-after-backup@example.test",
        "kept@example.test",
      ]);
      expect(await tableExists("half_restored")).toBe(false);
    },
    120_000,
  );

  it.skipIf(!hasPsql)(
    "keeps nothing when psql's input stops before the end of the dump",
    async () => {
      // What a killed process or a failed read looks like from psql's side.
      // With --single-transaction this is a COMMIT: the schema is gone and
      // half a backup is in its place.
      const psql = spawn("psql", restorePsqlArgs(scratchUrl), {
        stdio: ["pipe", "ignore", "ignore"],
      });
      const closed = new Promise((done) => psql.on("close", done));
      async function* dumpThatStops() {
        yield Buffer.from("CREATE TABLE half_restored (id int);\n");
        throw new Error("the read failed here");
      }
      await expect(
        pipeline(
          () => psqlRestoreInput(dumpThatStops(), { replace: true }),
          psql.stdin,
        ),
      ).rejects.toThrow("the read failed here");
      await closed;

      expect(await emails()).toEqual([
        "added-after-backup@example.test",
        "kept@example.test",
      ]);
      expect(await tableExists("half_restored")).toBe(false);
    },
    120_000,
  );

  it("replaces the contents with --replace", async () => {
    const { code, output } = await runScript("scripts/restore-db.mjs", [
      `--file=${uploadedCopy}`,
      "--yes",
      "--replace",
    ]);
    expect(output).toContain("Restore complete.");
    expect(code).toBe(0);
    expect(await emails()).toEqual(["kept@example.test"]);
  }, 120_000);

  it("leaves a usable schema with working sequences", async () => {
    await insertUser("after-restore@example.test");
    expect(await emails()).toEqual([
      "after-restore@example.test",
      "kept@example.test",
    ]);
    const grant = await db().query<{ usable: boolean }>(
      `SELECT has_schema_privilege('public', 'public', 'USAGE') AS usable`,
    );
    expect(grant.rows[0].usable).toBe(true);
  });

  it.skipIf(!hasPsql)(
    "replaces the contents from a pg_dump-format file through psql",
    async () => {
      // Last, because this leaves a one-table database behind.
      const plain = join(workDir, "plain.sql.gz");
      await writeFile(
        plain,
        gzipSync(
          [
            "CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL);",
            "COPY users (id, email, password_hash) FROM stdin;",
            ["1", "from-psql@example.test", "not-a-real-hash"].join("\t"),
            "\\.",
            "",
          ].join("\n"),
        ),
      );
      const { code, output } = await runScript("scripts/restore-db.mjs", [
        `--file=${plain}`,
        "--yes",
        "--replace",
      ]);
      expect(output).toContain("Restore complete.");
      expect(code).toBe(0);
      expect(await emails()).toEqual(["from-psql@example.test"]);
      expect(await tableExists("api_keys")).toBe(false);
    },
    120_000,
  );
});
