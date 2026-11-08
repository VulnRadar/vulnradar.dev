import { afterAll, beforeAll, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { applySchema } from "@/lib/database/schema/index.mjs";
import { describeIntegration } from "./_db";
import { getDatabaseSummary } from "../../scripts/_lib/_lib.schema.mjs";
import { getForeignKeys } from "../../scripts/_lib/_lib.schema-introspect.mjs";
import { moduleStepStatements } from "../../scripts/_lib/_lib.schema-parity.mjs";
import { planTableCopy } from "../../scripts/_lib/_lib.table-copy.mjs";
import {
  copyTableData,
  verifyCopiedCounts,
} from "../../scripts/create-fresh-db/copy-table-data.mjs";

/**
 * `npm run db:create` is the documented way to move to another database, and on
 * a real 3.x database it did not work. Both failures need Postgres to show:
 *
 *   - scan_history and host_badges have GENERATED columns. Inserting into one
 *     is an error, so every row failed, and then every row referencing them
 *     failed its foreign key.
 *   - node-pg sends a JavaScript array as a Postgres array literal. Into JSONB,
 *     `[]` becomes `{}` and a non-empty array fails the INSERT, and the row
 *     count alone cannot tell.
 *
 * Source and target are both scratch databases built by the real boot schema,
 * so the plan and the verify run over exactly the rows this file wrote and not
 * whatever the rest of the tier left in the shared one.
 */

const ssl =
  process.env.INTEGRATION_DATABASE_SSL === "true"
    ? { rejectUnauthorized: true }
    : false;

let admin: Client | undefined;
let source: Pool | undefined;
let target: Pool | undefined;
const scratchNames: string[] = [];
let shortfalls: unknown[] = [];
let refused: string[] = [];
let copiedTables: string[] = [];

/** The same application db:create performs. */
async function buildSchema(pool: Pool): Promise<void> {
  await applySchema(pool, {
    runModuleStep: async (step: unknown) => {
      const statements = moduleStepStatements(step) as string[];
      for (const stmt of statements) await pool.query(stmt);
      return statements;
    },
  });
}

async function createScratch(
  url: URL,
  base: string,
  suffix: string,
): Promise<Pool> {
  const name = `${base}_${suffix}_${randomBytes(4).toString("hex")}`;
  // Ours (a fixed prefix plus hex), but still an identifier in DDL, so quoted.
  await admin!.query(`CREATE DATABASE "${name}"`);
  scratchNames.push(name);
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${name}`;
  const pool = new Pool({
    connectionString: scratchUrl.toString(),
    ssl,
    max: 2,
  });
  // pool.end() resolves before its sockets have closed, so the forced drop in
  // afterAll can terminate a connection that is still on its way out. With no
  // listener the pool rethrows that FATAL as an uncaught exception, and the run
  // fails with every test passed.
  pool.on("error", () => {});
  return pool;
}

async function seedSource(pool: Pool): Promise<void> {
  const users = await pool.query<{ id: number }>(
    `INSERT INTO users (email, password_hash)
     VALUES ('one@example.test', 'not-a-real-hash'),
            ('two@example.test', 'not-a-real-hash')
     RETURNING id`,
  );
  const [first, second] = users.rows.map((r) => r.id);

  await pool.query(
    `INSERT INTO scan_history (user_id, url, findings, share_token, response_headers)
     VALUES ($1, 'https://a.example.test/', '[{"id":"x"}]', 'share-token-one', 'null'),
            ($1, 'https://b.example.test/', '[]', NULL, NULL)`,
    [first],
  );
  await pool.query(
    `INSERT INTO host_badges (user_id, url, badge_token)
     VALUES ($1, 'https://a.example.test/', 'badge-token-one')`,
    [first],
  );
  await pool.query(
    `INSERT INTO github_connections
       (user_id, github_user_id, github_username, access_token_encrypted, selected_repos)
     VALUES ($1, 11, 'one', 'cipher', '[]'),
            ($2, 22, 'two', 'cipher', '["a/b"]')`,
    [first, second],
  );
  await pool.query(
    `INSERT INTO api_keys (user_id, key_hash, key_prefix, scopes)
     VALUES ($1, 'hash-one', 'vr_one', '["scan:read","scan:write"]'),
            ($1, 'hash-two', 'vr_two', '[]'),
            ($1, 'hash-three', 'vr_thr', NULL)`,
    [first],
  );
  await pool.query(
    `INSERT INTO ai_conversations (session_id, user_id, messages)
     VALUES ($1, $3, '[{"role":"user","content":"hi"}]'),
            ($2, $3, '[]')`,
    [randomUUID(), randomUUID(), first],
  );
}

describeIntegration("db:create clones a 3.x database", () => {
  beforeAll(async () => {
    const url = new URL(process.env.INTEGRATION_DATABASE_URL as string);
    const base =
      decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
    admin = new Client({ connectionString: url.toString(), ssl });
    await admin.connect();

    source = await createScratch(url, base, "copy_src");
    target = await createScratch(url, base, "copy_dst");
    await buildSchema(source);
    await buildSchema(target);
    await seedSource(source);

    const summary = await getDatabaseSummary(source);
    const plan = planTableCopy({
      sourceTables: summary.tables,
      targetTables: summary.tables,
      counts: summary.counts as Record<string, number>,
      fkEdges: await getForeignKeys(target),
    });
    const copied: { table: string; count: number }[] = [];
    for (const { table, count } of plan.copy) {
      if (await copyTableData(source, target, table, count)) {
        copied.push({ table, count });
      } else {
        refused.push(table);
      }
    }
    copiedTables = copied.map((c) => c.table);
    shortfalls = await verifyCopiedCounts(source, target, copied);
  }, 180_000);

  afterAll(async () => {
    await source?.end().catch(() => {});
    await target?.end().catch(() => {});
    for (const name of scratchNames) {
      await admin
        ?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
        .catch(() => {});
    }
    await admin?.end().catch(() => {});
  }, 60_000);

  const db = (pool: Pool | undefined) => pool as Pool;

  async function rows(pool: Pool | undefined, sql: string) {
    return (await db(pool).query(sql)).rows;
  }

  it("copies every seeded table, with nothing refused and nothing short", () => {
    expect(refused).toEqual([]);
    expect(copiedTables).toEqual(
      expect.arrayContaining([
        "users",
        "scan_history",
        "host_badges",
        "github_connections",
        "api_keys",
        "ai_conversations",
      ]),
    );
    expect(shortfalls).toEqual([]);
  });

  it.each([
    ["scan_history", 2],
    ["host_badges", 1],
    ["github_connections", 2],
    ["api_keys", 3],
    ["ai_conversations", 2],
  ])("%s has the same rows in the target", async (table, expected) => {
    const [row] = await rows(target, `SELECT COUNT(*)::int AS n FROM ${table}`);
    expect(row.n).toBe(expected);
  });

  it("recomputes generated hashes from the tokens it copied", async () => {
    const [scan] = await rows(
      target,
      `SELECT share_token_hash, encode(sha256('share-token-one'::bytea), 'hex') AS expected
       FROM scan_history WHERE share_token = 'share-token-one'`,
    );
    expect(scan.share_token_hash).toBe(scan.expected);
    const [badge] = await rows(
      target,
      `SELECT badge_token_hash, encode(sha256('badge-token-one'::bytea), 'hex') AS expected
       FROM host_badges`,
    );
    expect(badge.badge_token_hash).toBe(badge.expected);
  });

  it.each([
    ["github_connections", "selected_repos", "github_user_id"],
    ["api_keys", "scopes", "key_hash"],
    ["ai_conversations", "messages", "jsonb_typeof(messages), id"],
    ["scan_history", "findings", "url"],
  ])(
    "%s.%s keeps its JSON exactly, arrays included",
    async (table, column, order) => {
      const query = `SELECT ${column}::text AS doc, jsonb_typeof(${column}) AS kind
                     FROM ${table} ORDER BY ${order}`;
      const before = await rows(source, query);
      expect(before.length).toBeGreaterThan(0);
      expect(await rows(target, query)).toEqual(before);
    },
  );

  it("clones a v1 scan_history with a renamed column and missing NOT NULL ones", async () => {
    const url = new URL(process.env.INTEGRATION_DATABASE_URL as string);
    const base =
      decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
    const v1 = await createScratch(url, base, "copy_v1");
    const clone = await createScratch(url, base, "copy_v1_dst");
    try {
      await buildSchema(v1);
      await buildSchema(clone);
      await v1.query(
        "ALTER TABLE scan_history RENAME COLUMN findings TO results",
      );
      await v1.query(
        "ALTER TABLE scan_history DROP COLUMN summary, DROP COLUMN source",
      );
      for (const pool of [v1, clone]) {
        await pool.query(
          `INSERT INTO users (id, email, password_hash)
           VALUES (7, 'v1@example.test', 'not-a-real-hash')`,
        );
      }
      await v1.query(
        `INSERT INTO scan_history (user_id, url, results)
         VALUES (7, 'https://v1.example.test/', '[{"id":"x"}]')`,
      );

      expect(await copyTableData(v1, clone, "scan_history", 1)).toBe(true);

      const copied = await clone.query(
        `SELECT findings::text AS findings, summary::text AS summary, source
         FROM scan_history`,
      );
      expect(copied.rows).toEqual([
        { findings: '[{"id": "x"}]', summary: "{}", source: "web" },
      ]);
    } finally {
      await v1.end().catch(() => {});
      await clone.end().catch(() => {});
    }
  }, 120_000);

  it("does not collapse a JSON null into SQL NULL", async () => {
    const query = `SELECT response_headers IS NULL AS sql_null,
                          jsonb_typeof(response_headers) AS kind
                   FROM scan_history ORDER BY url`;
    expect(await rows(target, query)).toEqual([
      { sql_null: false, kind: "null" },
      { sql_null: true, kind: null },
    ]);
  });
});
