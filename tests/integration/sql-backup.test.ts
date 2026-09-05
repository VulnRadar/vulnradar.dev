import { afterAll, beforeAll, expect, it } from "vitest";
import { createGzip, gunzipSync } from "node:zlib";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pool from "@/lib/database/db";
import { describeIntegration } from "./_db";
import {
  generateSqlDump,
  restoreSqlDump,
  readDumpLines,
  detectBackupFormat,
} from "../../scripts/_lib/_lib.sql-backup.mjs";

/**
 * The gate on the pure-JavaScript SQL dumper.
 *
 * Nothing in the unit tier can prove this feature. That tier fakes
 * `pool.query`, so it can prove the escaping is self-consistent and the SQL
 * strings look right, and nothing at all about whether PostgreSQL agrees. The
 * question that matters here -- does a value put into the database come back
 * out of a dump/restore cycle byte for byte -- is only answerable against a
 * real server, so this is where it is answered.
 *
 * It matters more than usual because of who this feature is for. Pterodactyl
 * and Pelican panel installs run VulnRadar from source on a Node egg with no
 * postgresql-client and no way to add one, so `pg_dump` has never worked
 * there and this dumper is their only backup. A backup that restores wrong is
 * worse than no backup, because it is trusted.
 *
 * Shape of the run
 * ----------------
 * Seed a table holding every type and the values that break hand-rolled
 * dumpers, dump the WHOLE database, drop the public schema, restore from the
 * file alone, and compare per column. Row counts are deliberately not the
 * assertion: a row count passes happily while a jsonb value has been mangled
 * or a numeric has lost precision through a float.
 *
 * Dropping and rebuilding the schema is what the tier's own bootstrap does
 * (tests/integration/_global-setup.ts), and this restores it from the dump,
 * so the database ends the test in the state it started. If the restore
 * fails, afterAll rebuilds the schema through the real boot path so the rest
 * of the run reports its own failures rather than this one's aftermath.
 */

const FIXTURE_TABLE = "js_backup_types";

/**
 * Every column is nullable so that one row can be entirely NULL, which is
 * what makes "NULL is not the empty string" testable in the same column that
 * holds an empty string in the row above it.
 */
const FIXTURE_DDL = `
  CREATE TABLE ${FIXTURE_TABLE} (
    id            SERIAL PRIMARY KEY,
    t_text        TEXT,
    t_varchar     VARCHAR(64),
    t_bool        BOOLEAN,
    t_int         INTEGER,
    t_bigint      BIGINT,
    t_smallint    SMALLINT,
    t_numeric     NUMERIC,
    t_real        REAL,
    t_double      DOUBLE PRECISION,
    t_json        JSON,
    t_jsonb       JSONB,
    t_bytea       BYTEA,
    t_uuid        UUID,
    t_date        DATE,
    t_time        TIME,
    t_timestamp   TIMESTAMP,
    t_timestamptz TIMESTAMPTZ,
    t_interval    INTERVAL,
    t_inet        INET,
    t_text_arr    TEXT[],
    t_int_arr     INTEGER[],
    t_nested_arr  INTEGER[][]
  )
`;

const FIXTURE_COLUMNS = [
  "id",
  "t_text",
  "t_varchar",
  "t_bool",
  "t_int",
  "t_bigint",
  "t_smallint",
  "t_numeric",
  "t_real",
  "t_double",
  "t_json",
  "t_jsonb",
  "t_bytea",
  "t_uuid",
  "t_date",
  "t_time",
  "t_timestamp",
  "t_timestamptz",
  "t_interval",
  "t_inet",
  "t_text_arr",
  "t_int_arr",
  "t_nested_arr",
];

/**
 * Every character that has ever broken a hand-rolled dumper, in one value.
 *
 * A literal NUL (0x00) is deliberately absent: PostgreSQL rejects it in any
 * text value ("invalid byte sequence for encoding UTF8: 0x00"), so it cannot
 * reach a text column from any client. It IS covered, in t_bytea below, which
 * is the only place a zero byte can legally live.
 */
const NASTY_TEXT = [
  "single ' quote",
  'double " quote',
  "backslash \\ here",
  "null-marker \\N here",
  "copy-end \\. here",
  "tab\there",
  "newline\nhere",
  "carriage\rreturn",
  "backspace\bform\ffeed\vvtab",
  "unicode: é 汉字 🚀   ​",
  "sql-ish: '); DROP TABLE users; --",
  'json-ish: {"a": [1, 2]}',
].join(" | ");

/**
 * Bytes chosen to look like COPY's own delimiters: NUL, tab, newline,
 * carriage return, backslash, the ASCII for "\\N", and a high byte that is
 * not valid UTF-8 on its own.
 */
const NASTY_BYTES = Buffer.from([
  0x00, 0x09, 0x0a, 0x0d, 0x5c, 0x5c, 0x4e, 0x5c, 0x2e, 0x7f, 0xff, 0xfe, 0x80,
]);

/** Read every column of the fixture as PostgreSQL's own text, under the same
 *  GUCs the dump pins, so before and after are directly comparable. */
async function readFixtureAsText(): Promise<string[][]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL DateStyle = 'ISO, MDY'");
    await client.query("SET LOCAL TimeZone = 'UTC'");
    await client.query("SET LOCAL IntervalStyle = 'postgres'");
    await client.query("SET LOCAL bytea_output = 'hex'");
    await client.query("SET LOCAL extra_float_digits = 3");
    const select = FIXTURE_COLUMNS.map((c) => `"${c}"::text`).join(", ");
    const res = await client.query({
      text: `SELECT ${select} FROM ${FIXTURE_TABLE} ORDER BY id`,
      rowMode: "array",
    });
    await client.query("ROLLBACK");
    return res.rows as string[][];
  } finally {
    client.release();
  }
}

async function seedFixture(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${FIXTURE_TABLE}`);
  await pool.query(FIXTURE_DDL);

  // Row 1: the adversarial one. Values are passed as bind parameters, so what
  // lands in the database is exactly what is written here.
  await pool.query(
    `INSERT INTO ${FIXTURE_TABLE} (
       t_text, t_varchar, t_bool, t_int, t_bigint, t_smallint, t_numeric,
       t_real, t_double, t_json, t_jsonb, t_bytea, t_uuid, t_date, t_time,
       t_timestamp, t_timestamptz, t_interval, t_inet,
       t_text_arr, t_int_arr, t_nested_arr
     ) VALUES (
       $1, $2, true, -2147483648, 9223372036854775807, -32768,
       $3::numeric, $4::real, $5::double precision, $6::json, $7::jsonb, $8,
       'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2026-09-02', '03:04:05.678901',
       '2026-09-02 03:04:05.678901', '2026-09-02 03:04:05.678901+05:30',
       '1 year 2 mons 3 days 04:05:06.789', '2001:db8::1/128',
       ARRAY['a', 'b,c', 'd"e', NULL, '', 'tab\there'],
       '{}'::integer[], '{{1,2},{3,4}}'::integer[][]
     )`,
    [
      NASTY_TEXT,
      "",
      // Far more digits than a double can hold. If this ever came back
      // rounded, the value went through a JS float somewhere.
      "123456789012345678901234567890.12345678901234567890123456789",
      "0.1",
      "1.2345678901234567e-300",
      JSON.stringify({
        a: 'it\'s "x"',
        b: [1, 2, { c: null }],
        d: "tab\there",
      }),
      JSON.stringify({ z: 1, a: { nested: ["'", '"', "\\", "\n"] } }),
      NASTY_BYTES,
    ],
  );

  // Row 2: every nullable column NULL.
  await pool.query(`INSERT INTO ${FIXTURE_TABLE} DEFAULT VALUES`);

  // Row 3: empty strings and empty containers, immediately after the all-NULL
  // row so a NULL/"" confusion shows up as a diff between two adjacent rows.
  await pool.query(
    `INSERT INTO ${FIXTURE_TABLE} (t_text, t_varchar, t_jsonb, t_bytea, t_text_arr, t_int_arr)
     VALUES ('', '', '{}'::jsonb, ''::bytea, ARRAY[]::text[], ARRAY[NULL]::integer[])`,
  );

  // Row 4: the special values every numeric and date type carries.
  await pool.query(
    `INSERT INTO ${FIXTURE_TABLE} (
       t_numeric, t_real, t_double, t_timestamp, t_timestamptz, t_bool
     ) VALUES (
       'NaN'::numeric, 'Infinity'::real, '-Infinity'::double precision,
       '-infinity'::timestamp, 'infinity'::timestamptz, false
     )`,
  );
}

describeIntegration("pure-JavaScript SQL dump and restore", () => {
  let tempDir = "";
  let dumpPath = "";
  let dumpText = "";
  let before: string[][] = [];
  let beforeTables = 0;
  let seededEmail = "";
  let restored = false;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vulnradar-dump-"));
    dumpPath = join(tempDir, "dump.sql.gz");

    await seedFixture();

    // A row in a real application table, so the round trip covers the actual
    // schema and not only the fixture.
    seededEmail = `dump-${process.pid}-${Date.now().toString(36)}@example.test`;
    await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-real-hash')`,
      [seededEmail],
    );

    before = await readFixtureAsText();
    beforeTables = (
      await pool.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
      )
    ).rows[0].n;

    // Dumped through exactly the pipeline scripts/backup-db.mjs uses:
    // the generator wrapped in a byte-mode Readable, gzipped to a file.
    const client = await pool.connect();
    try {
      await pipeline(
        Readable.from(
          generateSqlDump({ client, meta: { appVersion: "test" } }),
          { objectMode: false },
        ),
        createGzip(),
        createWriteStream(dumpPath),
      );
    } finally {
      client.release();
    }
    dumpText = gunzipSync(await readFile(dumpPath)).toString("utf8");
  }, 180_000);

  afterAll(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    // Leave the schema whole for whatever runs next. A successful restore
    // already did, so this only fires when the round trip failed part way
    // through, which is exactly when a later suite would otherwise report a
    // confusing "relation does not exist" instead of this file's failure.
    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    if (rows[0].n < 40) {
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
      await pool.query("CREATE SCHEMA public");
      await pool.query(
        `CREATE TABLE vulnradar_integration_fixture (
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      );
      await pool.query(
        "INSERT INTO vulnradar_integration_fixture DEFAULT VALUES",
      );
      const { applyBootSchema } =
        await import("@/lib/database/boot/apply-boot-schema");
      await applyBootSchema(pool, "integration-recovery");
    }
    await pool.query(`DROP TABLE IF EXISTS ${FIXTURE_TABLE} CASCADE`);
  }, 180_000);

  it("writes a file that reads as pg_dump plain SQL", () => {
    // Structure first, because everything below depends on the file being
    // the thing it claims to be.
    expect(dumpText.startsWith("--\n-- VulnRadar database dump")).toBe(true);
    expect(dumpText).toContain("SET standard_conforming_strings = on;");
    expect(dumpText).toContain(
      "SELECT pg_catalog.set_config('search_path', '', false);",
    );
    expect(dumpText).toContain('CREATE TABLE public."users" (');
    expect(dumpText).toContain('COPY public."users" (');
    expect(dumpText).toContain(" FROM stdin;");
    expect(dumpText).toContain("\n\\.\n");
    expect(dumpText).toContain("ALTER TABLE ONLY public.");
    expect(dumpText).toContain("SELECT pg_catalog.setval(");
    expect(dumpText).toContain("-- VulnRadar database dump complete");
  });

  it("states what it does not contain, in the file itself", () => {
    // An operator must never be left believing this is a full pg_dump.
    expect(dumpText).toContain("not by pg_dump");
    expect(dumpText).toContain("does NOT contain roles");
  });

  it("says the target must be empty, and why there are no DROPs", () => {
    // The decision an operator restoring into a non-empty database needs to
    // find in the file rather than in a stack trace.
    expect(dumpText).toContain("The target must be an EMPTY database");
    expect(dumpText).toContain("contains no DROP statements");

    // Asserted against STATEMENTS, not against the substring anywhere in the
    // file. A plain `not.toContain("DROP TABLE")` fails on this suite's own
    // adversarial row, `sql-ish: '); DROP TABLE users; --`, which is seeded
    // precisely so the dump has to carry it safely as data. Matching it there
    // would mean the test fails hardest exactly when the escaping works.
    const statements = dumpText
      .split("\n")
      .filter((line) => /^\s*DROP\s/i.test(line));
    expect(
      statements,
      "the dump must contain no DROP statements: restoring over an existing " +
        "schema has to stop on the first collision rather than clear it away",
    ).toEqual([]);
  });

  it("is recognised by content, not by filename", async () => {
    await expect(detectBackupFormat(dumpPath)).resolves.toBe("vulnradar-sql");
  });

  it("emits every foreign key after the data, so row order cannot break one", () => {
    const firstCopy = dumpText.indexOf("COPY public.");
    const firstFk = dumpText.indexOf("ADD CONSTRAINT");
    const lastCopyEnd = dumpText.lastIndexOf("\n\\.\n");
    expect(firstCopy).toBeGreaterThan(-1);
    const fkClause = dumpText.indexOf("FOREIGN KEY");
    expect(fkClause).toBeGreaterThan(lastCopyEnd);
    expect(firstFk).toBeGreaterThan(firstCopy);
  });

  it("restores into an empty database and every column survives byte for byte", async () => {
    // The destructive half. Everything the database holds now has to come
    // back out of the file alone.
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");

    const client = await pool.connect();
    let result;
    try {
      result = await restoreSqlDump({
        client,
        lines: readDumpLines(dumpPath),
      });
    } finally {
      client.release();
    }
    restored = true;

    expect(result.statements).toBeGreaterThan(100);
    expect(result.tables).toBeGreaterThan(40);

    const afterTables = (
      await pool.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
      )
    ).rows[0].n;
    expect(afterTables).toBe(beforeTables);

    const after = await readFixtureAsText();
    expect(after.length).toBe(before.length);

    // Per column, not per row and certainly not per count: a diff here names
    // the type that broke instead of saying "something changed".
    for (let c = 0; c < FIXTURE_COLUMNS.length; c++) {
      expect(
        after.map((r) => r[c]),
        `column ${FIXTURE_COLUMNS[c]} did not survive the round trip`,
      ).toEqual(before.map((r) => r[c]));
    }
  }, 180_000);

  it("distinguishes NULL from the empty string", async () => {
    expect(restored).toBe(true);
    const { rows } = await pool.query<{
      id: number;
      text_is_null: boolean;
      text_is_empty: boolean;
    }>(
      `SELECT id, t_text IS NULL AS text_is_null, t_text = '' AS text_is_empty
         FROM ${FIXTURE_TABLE} ORDER BY id`,
    );
    // Row 2 is the all-NULL row, row 3 the all-empty-string row.
    expect(rows[1].text_is_null).toBe(true);
    expect(rows[2].text_is_null).toBe(false);
    expect(rows[2].text_is_empty).toBe(true);
  });

  it("keeps bytea byte-exact, including NUL and the COPY delimiters", async () => {
    const { rows } = await pool.query<{ t_bytea: Buffer }>(
      `SELECT t_bytea FROM ${FIXTURE_TABLE} ORDER BY id LIMIT 1`,
    );
    expect(Buffer.compare(rows[0].t_bytea, NASTY_BYTES)).toBe(0);
  });

  it("keeps numeric precision without passing through a float", async () => {
    const { rows } = await pool.query<{ v: string }>(
      `SELECT t_numeric::text AS v FROM ${FIXTURE_TABLE} ORDER BY id LIMIT 1`,
    );
    expect(rows[0].v).toBe(
      "123456789012345678901234567890.12345678901234567890123456789",
    );
  });

  it("preserves the instant of a timestamptz written at a non-UTC offset", async () => {
    // Asserted as exact text rather than as an epoch float, and that is not a
    // stylistic preference. The first version of this compared
    // extract(epoch) against a JS Date, and it failed: the round trip had
    // returned 1788298445.678901 where the expectation could only express
    // 1788298445.678, because a JS Date has millisecond resolution and
    // PostgreSQL stores microseconds. The dump was right and the assertion
    // was lossy, which is the same class of mistake as passing a value
    // through a float on the way into a backup. to_char reads the value out
    // at full precision with no arithmetic in JavaScript at all.
    const { rows } = await pool.query<{ utc: string }>(
      `SELECT to_char(t_timestamptz AT TIME ZONE 'UTC',
                      'YYYY-MM-DD HH24:MI:SS.US') AS utc
         FROM ${FIXTURE_TABLE} ORDER BY id LIMIT 1`,
    );
    // Inserted as 2026-09-02 03:04:05.678901+05:30, which is this instant.
    // The dump pins TimeZone = UTC (DUMP_SESSION_GUCS) so the file carries an
    // explicit +00 offset; the restoring server's own timezone cannot shift
    // it, and the microseconds are not rounded away on the way through.
    expect(rows[0].utc).toBe("2026-09-01 21:34:05.678901");
  });

  it("keeps jsonb, json and arrays intact, including NULL and empty ones", async () => {
    const { rows } = await pool.query<{
      j: Record<string, unknown>;
      arr: (string | null)[];
      empty: number[];
      nested: number[][];
    }>(
      `SELECT t_jsonb AS j, t_text_arr AS arr, t_int_arr AS empty,
              t_nested_arr AS nested
         FROM ${FIXTURE_TABLE} ORDER BY id LIMIT 1`,
    );
    expect(rows[0].j).toEqual({ z: 1, a: { nested: ["'", '"', "\\", "\n"] } });
    expect(rows[0].arr).toEqual(["a", "b,c", 'd"e', null, "", "tab\there"]);
    expect(rows[0].empty).toEqual([]);
    expect(rows[0].nested).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("restores the real application schema, not only its tables", async () => {
    // Constraints, indexes, triggers and the function they call: the parts a
    // data-only dump would silently drop and nobody would notice until an
    // ON DELETE CASCADE failed to fire months later.
    const fk = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname = 'sessions' AND con.contype = 'f' AND con.confdeltype = 'c'`,
    );
    expect(fk.rows[0].n).toBeGreaterThan(0);

    const fn = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'vulnradar_set_updated_at'`,
    );
    expect(fn.rows[0].n).toBe(1);

    const triggers = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`,
    );
    expect(triggers.rows[0].n).toBeGreaterThan(0);

    const indexes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_indexes WHERE schemaname = 'public'`,
    );
    expect(indexes.rows[0].n).toBeGreaterThan(40);

    const pk = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname = 'users' AND con.contype = 'p'`,
    );
    expect(pk.rows[0].n).toBe(1);

    const unique = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname = 'users' AND con.contype = 'u'`,
    );
    expect(unique.rows[0].n).toBeGreaterThan(0);
  });

  it("brings the application's own rows back", async () => {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM users WHERE email = $1",
      [seededEmail],
    );
    expect(rows[0].n).toBe(1);
  });

  it("leaves every sequence usable, so the next insert does not collide", async () => {
    // The failure that shows up a day after a restore rather than during it.
    const maxBefore = await pool.query<{ m: number }>(
      `SELECT COALESCE(MAX(id), 0)::int AS m FROM ${FIXTURE_TABLE}`,
    );
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO ${FIXTURE_TABLE} (t_text) VALUES ('after-restore') RETURNING id`,
    );
    expect(inserted.rows[0].id).toBeGreaterThan(maxBefore.rows[0].m);

    const userMax = await pool.query<{ m: number }>(
      "SELECT COALESCE(MAX(id), 0)::int AS m FROM users",
    );
    const newUser = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, 'not-a-real-hash') RETURNING id`,
      [`seq-${process.pid}-${Date.now().toString(36)}@example.test`],
    );
    expect(newUser.rows[0].id).toBeGreaterThan(userMax.rows[0].m);
    await pool.query("DELETE FROM users WHERE id = $1", [newUser.rows[0].id]);
  });

  it("applies nothing at all when the file is truncated", async () => {
    // One transaction, all or nothing: the same guarantee psql
    // --single-transaction gives, which is what stops a half-loaded database
    // from being reported as a successful restore.
    //
    // The head is cut before the FIRST section, so it carries the dump marker
    // and the SET preamble and no DDL at all. That matters: an earlier cut
    // (before the data section) dragged the whole schema along, which the
    // restore above had already created, and the run then failed on
    // `relation "access_rules_id_seq" already exists` instead of on the
    // truncation. It still threw, so the assertion still passed, but for the
    // wrong reason -- which is worse than failing. The one statement appended
    // here creates an object that does not exist anywhere, so the only thing
    // this test can fail on now is the missing end marker, and the only thing
    // the rollback has to undo is that statement.
    const truncated = join(tempDir, "truncated.sql.gz");

    // Both of these are asserted rather than assumed, because getting either
    // wrong degrades this test silently instead of failing it. dumpText is
    // populated by an earlier test in this file, and indexOf returns -1 when
    // the marker is absent, which makes slice(0, -1) an EMPTY head: the file
    // then has no dump marker at all and the restore rejects with "no
    // VulnRadar dump marker" long before it can reach the end-marker check
    // this test exists to prove. It still throws, so a bare rejects.toThrow()
    // would have passed while testing nothing.
    expect(dumpText, "the dump from the earlier test must be in hand").not.toBe(
      "",
    );
    const cut = dumpText.indexOf("--#VR:SECTION");
    expect(
      cut,
      "the dump must contain a section marker to cut at",
    ).toBeGreaterThan(0);

    const head = dumpText.slice(0, cut);
    expect(head, "the cut must land before any DDL").not.toContain(
      "CREATE SEQUENCE",
    );
    expect(head, "the head must still carry the dump marker").toContain(
      "--#VR:DUMP",
    );
    await pipeline(
      Readable.from([
        head + '--#VR:STMT\nCREATE TABLE public."half_applied" (a int);\n',
      ]),
      createGzip(),
      createWriteStream(truncated),
    );

    const client = await pool.connect();
    try {
      await expect(
        restoreSqlDump({ client, lines: readDumpLines(truncated) }),
      ).rejects.toThrow(/no end marker/);
    } finally {
      client.release();
    }

    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'half_applied'`,
    );
    expect(rows[0].n).toBe(0);
  }, 120_000);
});
