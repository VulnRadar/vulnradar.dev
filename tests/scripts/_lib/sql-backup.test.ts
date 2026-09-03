import { describe, it, expect } from "vitest";
import {
  encodeCopyValue,
  encodeCopyRow,
  decodeCopyValue,
  decodeCopyRow,
  quoteIdent,
  quoteLiteral,
  qualify,
  planDumpTables,
  nextPageRows,
  maxRowsPerInsert,
  buildPageQuery,
  buildInsertQuery,
  renderCreateTable,
  renderCreateSequence,
  renderSetval,
  renderCopyHeader,
  marker,
  parseMarker,
  MARKER_PREFIX,
  PAGE_BYTE_BUDGET,
  MAX_PAGE_ROWS,
  MIN_PAGE_ROWS,
} from "../../../scripts/_lib/_lib.sql-backup.mjs";
import { TRANSIENT_TABLES } from "../../../scripts/_lib/_lib.table-copy.mjs";

/**
 * The escaping is where a hand-rolled dumper lives or dies. It does not
 * usually fail on structure, it fails on one value in one row, so every case
 * below is a value that has broken a real dumper somewhere.
 *
 * The round trip asserted here is encode -> decode, which is our own restore
 * path. What it cannot prove is that PostgreSQL's COPY parser agrees with our
 * encoder, because that needs a server; tests/integration/sql-backup.test.ts
 * proves that half against a real one.
 */
describe("COPY text encoding", () => {
  it("writes NULL as \\N and an empty string as an empty field", () => {
    expect(encodeCopyValue(null)).toBe("\\N");
    expect(encodeCopyValue("")).toBe("");
    // The distinction survives, which is the single most important property
    // of this encoding: a NULL restored as "" (or vice versa) is silent data
    // corruption that no row count would ever catch.
    expect(decodeCopyValue("\\N")).toBeNull();
    expect(decodeCopyValue("")).toBe("");
  });

  it("escapes exactly the seven characters COPY treats as special", () => {
    expect(encodeCopyValue("a\\b")).toBe("a\\\\b");
    expect(encodeCopyValue("a\tb")).toBe("a\\tb");
    expect(encodeCopyValue("a\nb")).toBe("a\\nb");
    expect(encodeCopyValue("a\rb")).toBe("a\\rb");
    expect(encodeCopyValue("a\bb")).toBe("a\\bb");
    expect(encodeCopyValue("a\fb")).toBe("a\\fb");
    expect(encodeCopyValue("a\vb")).toBe("a\\vb");
  });

  it("leaves everything else alone, including quotes, braces and emoji", () => {
    const value = `it's "quoted" {a:1} 100% <ok> émoji 🚀 汉字`;
    expect(encodeCopyValue(value)).toBe(value);
    expect(decodeCopyValue(encodeCopyValue(value))).toBe(value);
  });

  it("escapes a backslash once, not twice (single-pass replacement)", () => {
    // A chain of .replace() calls would escape the backslash, then re-escape
    // the backslashes it had just introduced, and \t would come back as \\t.
    expect(encodeCopyValue("\\t")).toBe("\\\\t");
    expect(decodeCopyValue("\\\\t")).toBe("\\t");
  });

  it("round-trips a value that is literally the NULL marker", () => {
    // `\N` as DATA, which must not come back as SQL NULL.
    expect(encodeCopyValue("\\N")).toBe("\\\\N");
    expect(decodeCopyValue(encodeCopyValue("\\N"))).toBe("\\N");
    expect(decodeCopyValue(encodeCopyValue("\\N"))).not.toBeNull();
  });

  it("round-trips a value that is literally the end-of-copy marker", () => {
    // A row whose only field is `\.` must not terminate the COPY block. The
    // backslash escape is what guarantees the emitted line is `\\.`, never
    // `\.` on its own.
    expect(encodeCopyRow(["\\."])).toBe("\\\\.");
    expect(encodeCopyRow(["\\."])).not.toBe("\\.");
    expect(decodeCopyRow(encodeCopyRow(["\\."]))).toEqual(["\\."]);
  });

  it("round-trips a bytea hex rendering unchanged", () => {
    // \x... is what bytea_output = 'hex' produces. The leading backslash is
    // escaped, so the line carries \\x48... and decodes back to \x48...
    const hex = "\\x00097f5c0a48656c6c6f";
    expect(encodeCopyValue(hex)).toBe("\\\\x00097f5c0a48656c6c6f");
    expect(decodeCopyValue(encodeCopyValue(hex))).toBe(hex);
  });

  it("round-trips JSON containing quotes, braces, tabs and newlines", () => {
    const json = '{"a": "he said \\"hi\\"", "b": [1, 2], "c": "x\ty\nz"}';
    expect(decodeCopyValue(encodeCopyValue(json))).toBe(json);
  });

  it("keeps numeric and timestamp text exactly as PostgreSQL rendered it", () => {
    for (const value of [
      "12345678901234567890.000000000000001",
      "NaN",
      "Infinity",
      "-Infinity",
      "2026-09-02 03:04:05.678901+00",
      "infinity",
      "-infinity",
      "1 day 02:03:04",
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "t",
      "f",
      "{}",
      '{NULL,"a,b"}',
    ]) {
      expect(decodeCopyValue(encodeCopyValue(value))).toBe(value);
    }
  });

  it("splits and rejoins a row on tabs without losing empty fields", () => {
    const row = ["a", "", null, "b\tc"];
    const line = encodeCopyRow(row);
    expect(line).toBe("a\t\t\\N\tb\\tc");
    expect(decodeCopyRow(line)).toEqual(row);
  });

  it("refuses numeric backslash escapes rather than guessing at them", () => {
    // Legal COPY input that this writer never produces, so meeting one means
    // the file is not ours. Decoding it wrongly would write corrupted bytes.
    expect(() => decodeCopyValue("\\x41")).toThrow(/numeric escape/);
    expect(() => decodeCopyValue("\\101")).toThrow(/numeric escape/);
    expect(() => decodeCopyValue("abc\\")).toThrow(/dangling backslash/);
  });

  it("drops the backslash from an unrecognised escape, as PostgreSQL does", () => {
    expect(decodeCopyValue("\\q")).toBe("q");
  });
});

describe("identifier and literal quoting", () => {
  it("doubles an embedded double quote in an identifier", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(qualify("users")).toBe('public."users"');
  });

  it("doubles an embedded single quote in a literal", () => {
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });

  it("leaves a backslash alone, because the preamble sets standard_conforming_strings", () => {
    expect(quoteLiteral("a\\b")).toBe("'a\\b'");
  });
});

describe("planDumpTables", () => {
  const fkEdges = [
    { childTable: "sessions", parentTable: "users" },
    { childTable: "api_keys", parentTable: "users" },
  ];

  it("orders parents before children", () => {
    const { order } = planDumpTables({
      tables: ["sessions", "users", "api_keys"],
      fkEdges,
    });
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("sessions"));
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("api_keys"));
  });

  it("skips the data of transient tables, with the shared reason", () => {
    // TRANSIENT_TABLES is a `Readonly<{...}>` of literal keys, so a plain
    // `string` cannot index it. Narrowing to its own key union keeps the
    // lookup typed rather than widening the table to Record<string, string>,
    // which would drop the compile-time check that a name is really in it.
    const name = Object.keys(
      TRANSIENT_TABLES,
    )[0] as keyof typeof TRANSIENT_TABLES;
    const { order, skipped } = planDumpTables({ tables: ["users", name] });
    expect(order).not.toContain(name);
    expect(skipped).toEqual([{ table: name, reason: TRANSIENT_TABLES[name] }]);
  });

  it("keeps the schema-version meta table, unlike a clone", () => {
    // db:create writes the NEW database's own meta row, so copying the
    // source's would stamp the wrong version. A backup is the opposite case:
    // reproducing the database it came from is the entire job.
    const { order } = planDumpTables({ tables: ["vulnradar_schema_meta"] });
    expect(order).toContain("vulnradar_schema_meta");
  });

  it("keeps empty tables in the plan", () => {
    // planTableCopy drops zero-row tables, which is right for a clone and
    // wrong here: pg_dump emits a COPY block for every table, and so must we.
    const { order } = planDumpTables({ tables: ["a", "b", "c"] });
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("page sizing", () => {
  it("halves the page when it blew the byte budget", () => {
    expect(nextPageRows(100, PAGE_BYTE_BUDGET + 1)).toBe(50);
  });

  it("doubles the page when it used well under the budget", () => {
    expect(nextPageRows(100, 1000)).toBe(200);
  });

  it("holds steady in between", () => {
    expect(nextPageRows(100, PAGE_BYTE_BUDGET / 2)).toBe(100);
  });

  it("never goes below one row or above the ceiling", () => {
    expect(nextPageRows(1, PAGE_BYTE_BUDGET * 10)).toBe(MIN_PAGE_ROWS);
    expect(nextPageRows(MAX_PAGE_ROWS, 1)).toBe(MAX_PAGE_ROWS);
  });
});

describe("maxRowsPerInsert", () => {
  it("keeps a batch under PostgreSQL's 65535 bind-parameter ceiling", () => {
    expect(maxRowsPerInsert(50) * 50).toBeLessThan(65535);
    expect(maxRowsPerInsert(1600) * 1600).toBeLessThan(65535);
  });

  it("never returns zero, however wide the table", () => {
    expect(maxRowsPerInsert(100000)).toBe(1);
    expect(maxRowsPerInsert(0)).toBe(1);
  });
});

describe("buildPageQuery", () => {
  const base = {
    table: "scan_history",
    columns: ["id", "url"],
    keyColumns: ["id"],
    keyTypes: ["integer"],
  };

  it("selects every column as text, which is what makes the round trip the type's own", () => {
    const sql = buildPageQuery({ ...base, hasCursor: false, limit: 25 });
    expect(sql).toContain('"id"::text');
    expect(sql).toContain('"url"::text');
  });

  it("uses keyset pagination, never OFFSET", () => {
    const sql = buildPageQuery({ ...base, hasCursor: true, limit: 25 });
    expect(sql).toContain('WHERE "id" > $1::integer');
    expect(sql).toContain('ORDER BY "id" ASC');
    expect(sql).not.toMatch(/OFFSET/i);
  });

  it("compares composite keys row-wise, with a cast per column", () => {
    const sql = buildPageQuery({
      table: "team_members",
      columns: ["team_id", "user_id", "role"],
      keyColumns: ["team_id", "user_id"],
      keyTypes: ["integer", "integer"],
      hasCursor: true,
      limit: 10,
    });
    expect(sql).toContain(
      'WHERE ("team_id", "user_id") > ($1::integer, $2::integer)',
    );
  });

  it("falls back to ctid when there is no usable primary key", () => {
    const sql = buildPageQuery({
      table: "no_pk",
      columns: ["a"],
      keyColumns: [],
      keyTypes: [],
      hasCursor: true,
      limit: 10,
    });
    expect(sql).toContain("ctid::text");
    expect(sql).toContain("WHERE ctid > $1::tid");
    expect(sql).toContain("ORDER BY ctid ASC");
  });

  it("refuses a limit that is not a positive integer", () => {
    // The limit is interpolated, not bound, so it is the one value in this
    // SQL that has to be proved numeric.
    for (const limit of ["1; DROP TABLE users", 0, -5, 1.5, NaN]) {
      expect(() =>
        buildPageQuery({ ...base, hasCursor: false, limit }),
      ).toThrow(/positive integer/);
    }
  });
});

describe("buildInsertQuery", () => {
  it("builds one multi-row INSERT with sequential placeholders", () => {
    const sql = buildInsertQuery({
      table: "users",
      columns: ["id", "email"],
      rowCount: 2,
    });
    expect(sql).toBe(
      'INSERT INTO public."users" ("id", "email") VALUES ($1, $2), ($3, $4)',
    );
  });

  it("puts no cast on the placeholders", () => {
    // An unspecified parameter type lets the server resolve each one from the
    // target column, which is the exact inverse of the col::text the dump
    // wrote. A cast would add a second opinion, and casting to a
    // length-limited character type truncates silently.
    const sql = buildInsertQuery({
      table: "users",
      columns: ["email"],
      rowCount: 1,
    });
    expect(sql).not.toContain("::");
  });
});

describe("DDL rendering", () => {
  it("writes NOT NULL but leaves ordinary defaults out of CREATE TABLE", () => {
    // Defaults are emitted later, as ALTER TABLE ... SET DEFAULT, after the
    // sequences they may reference exist. Inline, a SERIAL column's
    // nextval('..._id_seq') would name a sequence that does not exist yet.
    const sql = renderCreateTable("users", [
      {
        name: "id",
        pgType: "integer",
        notNull: true,
        identity: "",
        generated: "",
        defaultExpr: "nextval('public.users_id_seq'::regclass)",
      },
      {
        name: "email",
        pgType: "character varying(255)",
        notNull: false,
        identity: "",
        generated: "",
        defaultExpr: null,
      },
    ]);
    expect(sql).toContain('CREATE TABLE public."users" (');
    expect(sql).toContain('    "id" integer NOT NULL');
    expect(sql).toContain('    "email" character varying(255)');
    expect(sql).not.toContain("nextval");
  });

  it("renders identity and generated columns inline, since they are part of the type", () => {
    const sql = renderCreateTable("t", [
      {
        name: "a",
        pgType: "integer",
        notNull: true,
        identity: "d",
        generated: "",
        defaultExpr: null,
      },
      {
        name: "b",
        pgType: "integer",
        notNull: false,
        identity: "",
        generated: "s",
        defaultExpr: "(a * 2)",
      },
    ]);
    expect(sql).toContain("GENERATED BY DEFAULT AS IDENTITY");
    expect(sql).toContain("GENERATED ALWAYS AS ((a * 2)) STORED");
  });

  it("writes both sequence bounds explicitly", () => {
    const sql = renderCreateSequence({
      name: "users_id_seq",
      dataType: "integer",
      start: "1",
      increment: "1",
      min: "1",
      max: "2147483647",
      cache: "1",
      cycle: false,
    });
    expect(sql).toContain('CREATE SEQUENCE public."users_id_seq"');
    expect(sql).toContain("    MINVALUE 1");
    expect(sql).toContain("    MAXVALUE 2147483647");
    expect(sql).not.toContain("CYCLE");
    expect(sql.endsWith(";")).toBe(true);
  });

  it("marks a used sequence as called and an untouched one as not", () => {
    // is_called is the difference between the next nextval() returning
    // last_value + 1 and returning last_value itself. Getting it wrong hands
    // out an id that is already taken, which is the failure that shows up a
    // day after the restore rather than during it.
    expect(renderSetval({ name: "s", start: "1", lastValue: "42" })).toBe(
      `SELECT pg_catalog.setval('public."s"', 42, true);`,
    );
    expect(renderSetval({ name: "s", start: "1", lastValue: null })).toBe(
      `SELECT pg_catalog.setval('public."s"', 1, false);`,
    );
  });

  it("emits a COPY header psql understands", () => {
    expect(renderCopyHeader("users", ["id", "email"])).toBe(
      'COPY public."users" ("id", "email") FROM stdin;',
    );
  });
});

describe("markers", () => {
  it("are SQL comments, so every other tool ignores them", () => {
    expect(marker("STMT").startsWith("--")).toBe(true);
    expect(marker("COPY", { table: "users" }).startsWith("--")).toBe(true);
  });

  it("round-trip their payload", () => {
    const line = marker("COPY", { table: "users", columns: ["id"] });
    expect(parseMarker(line)).toEqual({
      kind: "COPY",
      payload: { table: "users", columns: ["id"] },
    });
    expect(parseMarker(marker("STMT"))).toEqual({
      kind: "STMT",
      payload: null,
    });
  });

  it("do not match an ordinary SQL comment", () => {
    expect(parseMarker("-- VulnRadar database dump")).toBeNull();
    expect(parseMarker("CREATE TABLE x ();")).toBeNull();
    expect(MARKER_PREFIX.startsWith("--")).toBe(true);
  });
});
