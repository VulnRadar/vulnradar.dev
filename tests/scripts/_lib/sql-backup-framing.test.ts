import { describe, it, expect } from "vitest";
import {
  generateSqlDump,
  restoreSqlDump,
} from "../../../scripts/_lib/_lib.sql-backup.mjs";

/**
 * The dump file's FRAMING, proved without a database.
 *
 * Read tests/README.md's "Two tiers, two rules" before adding to this file.
 * `pool.query` is faked here, so nothing below proves anything about SQL: a
 * fake answers a query naming a column that does not exist exactly as it
 * answers a correct one. tests/integration/sql-backup.test.ts is where the
 * SQL is proved, against a real PostgreSQL.
 *
 * What a fake CAN prove is everything that is pure string handling, and for
 * this feature that is a large and dangerous surface:
 *
 *   - the generator emits a `--#VR:` marker for every executable statement,
 *     so the restore's splitter never has to guess where one ends (the schema
 *     contains dollar-quoted plpgsql, which split-on-semicolon would tear in
 *     half)
 *   - object order is pg_dump's: tables before data, foreign keys after it
 *   - a COPY block's rows survive encode -> file -> parse -> bind parameter
 *     unchanged, including the values that look like COPY's own delimiters
 *   - the restore refuses a truncated file instead of applying half of it
 *
 * A "client" here is an object with .query(), which is the only surface
 * either function uses.
 */

/** A row set shaped like node-postgres returns. */
const rows = (r: unknown[]) => ({ rows: r });

interface FakeSchema {
  tables: string[];
  columns: Record<
    string,
    {
      name: string;
      pgType: string;
      notNull: boolean;
      identity: string;
      generated: string;
      defaultExpr: string | null;
    }[]
  >;
  primaryKeys: Record<string, string[]>;
  data: Record<string, string[][]>;
}

const NASTY = 'a\'b"c\\d\\Ne\\.f\tg\nh\ri 🚀 汉字 {"j":[1,2]}';

const SCHEMA: FakeSchema = {
  tables: ["notes", "users"],
  columns: {
    users: [
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
        notNull: true,
        identity: "",
        generated: "",
        defaultExpr: null,
      },
      {
        name: "meta",
        pgType: "jsonb",
        notNull: false,
        identity: "",
        generated: "",
        defaultExpr: null,
      },
    ],
    // No primary key, so this one exercises the ctid pagination path.
    notes: [
      {
        name: "user_id",
        pgType: "integer",
        notNull: true,
        identity: "",
        generated: "",
        defaultExpr: null,
      },
      {
        name: "body",
        pgType: "text",
        notNull: false,
        identity: "",
        generated: "",
        defaultExpr: null,
      },
    ],
  },
  primaryKeys: { users: ["id"] },
  data: {
    users: [
      ["1", "a@b.c", '{"x": 1}'],
      // Empty string next to NULL, in the same two columns.
      ["2", "", null as unknown as string],
    ],
    // The trailing element is the ctid the query selects as its cursor; it is
    // pagination state and must not reach the file.
    notes: [
      ["1", NASTY, "(0,1)"],
      ["2", null as unknown as string, "(0,2)"],
    ],
  },
};

function fakeDumpClient() {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (config: any) => {
      const text = typeof config === "string" ? config : config.text;
      if (/^(BEGIN|ROLLBACK|COMMIT|SET LOCAL|RESET)/.test(text))
        return rows([]);
      if (text.includes("server_version_num")) return rows([{ num: 160004 }]);
      if (text.includes("'materialized view: '")) return rows([]);
      if (text.includes("nspname NOT IN ('public'")) return rows([]);
      if (text.includes("version() AS v"))
        return rows([{ v: "PostgreSQL 16" }]);
      if (text.includes("to_regclass")) return rows([{ oid: null }]);
      if (text.includes("information_schema.tables")) {
        return rows(SCHEMA.tables.map((t) => ({ table_name: t })));
      }
      if (text.includes("AS pg_type")) {
        return rows(
          SCHEMA.tables.flatMap((t) =>
            SCHEMA.columns[t].map((c) => ({
              table_name: t,
              column_name: c.name,
              pg_type: c.pgType,
              not_null: c.notNull,
              identity: c.identity,
              generated: c.generated,
              default_expr: c.defaultExpr,
            })),
          ),
        );
      }
      if (text.includes("'PRIMARY KEY'")) {
        return rows(
          Object.entries(SCHEMA.primaryKeys).flatMap(([t, cols]) =>
            cols.map((c) => ({ table_name: t, column_name: c })),
          ),
        );
      }
      if (text.includes("'FOREIGN KEY'")) {
        return rows([
          {
            constraint_name: "notes_user_fk",
            child_table: "notes",
            child_column: "user_id",
            parent_table: "users",
            parent_column: "id",
            delete_rule: "CASCADE",
          },
        ]);
      }
      if (text.includes("pg_extension")) return rows([]);
      if (text.includes("pg_sequence s")) {
        return rows([
          {
            name: "users_id_seq",
            data_type: "integer",
            seqstart: "1",
            seqincrement: "1",
            seqmin: "1",
            seqmax: "2147483647",
            seqcache: "1",
            seqcycle: false,
            last_value: "2",
            dep_type: "a",
            owner_table: "users",
            owner_column: "id",
          },
        ]);
      }
      if (text.includes("pg_get_constraintdef")) {
        return rows([
          {
            table_name: "users",
            name: "users_pkey",
            type: "p",
            def: "PRIMARY KEY (id)",
          },
          {
            table_name: "notes",
            name: "notes_user_fk",
            type: "f",
            def: "FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE",
          },
        ]);
      }
      if (text.includes("pg_get_indexdef")) {
        return rows([
          {
            table_name: "users",
            name: "users_email_idx",
            def: "CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)",
          },
        ]);
      }
      if (text.includes("pg_get_functiondef")) {
        return rows([
          {
            name: "vulnradar_set_updated_at",
            // The dollar-quoted body with an internal semicolon: the exact
            // shape a split-on-semicolon reader would tear in half.
            def:
              "CREATE OR REPLACE FUNCTION public.vulnradar_set_updated_at()\n" +
              " RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\n" +
              "BEGIN\n  NEW.updated_at = NOW();\n  RETURN NEW;\nEND;\n$function$\n",
          },
        ]);
      }
      if (text.includes("pg_get_triggerdef")) {
        return rows([
          {
            table_name: "users",
            name: "trg_users_updated_at",
            def: "CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.vulnradar_set_updated_at()",
          },
        ]);
      }
      if (text.includes("pg_get_viewdef")) return rows([]);

      const page = text.match(/FROM public\."([^"]+)"/);
      if (page && text.startsWith("SELECT")) {
        // One page holding every row: fewer rows than the limit ends the loop.
        return rows(SCHEMA.data[page[1]]);
      }
      throw new Error(`unexpected query: ${text.slice(0, 120)}`);
    },
  };
}

async function renderDump(): Promise<string> {
  let out = "";
  for await (const chunk of generateSqlDump({
    client: fakeDumpClient(),
    meta: { appVersion: "3.8.0" },
  })) {
    out += chunk;
  }
  return out;
}

/** Replays a file into a recorder, so the restore's parser can be inspected. */
function fakeRestoreClient() {
  const statements: string[] = [];
  const inserts: { text: string; values: unknown[] }[] = [];
  return {
    statements,
    inserts,
    query: async (text: string, values?: unknown[]) => {
      if (values) inserts.push({ text, values });
      else statements.push(text);
      return rows([]);
    },
  };
}

async function* linesOf(text: string) {
  // readline strips the trailing newline of the final line, and drops the
  // empty tail after a trailing newline; mirror that exactly.
  const all = text.split("\n");
  if (all.at(-1) === "") all.pop();
  for (const line of all) yield line;
}

describe("the emitted file", () => {
  it("opens with a human header that names what it is and is not", async () => {
    const sql = await renderDump();
    expect(sql.startsWith("--\n-- VulnRadar database dump")).toBe(true);
    expect(sql).toContain("-- Format:          vulnradar-sql-dump v1");
    expect(sql).toContain("psql -v ON_ERROR_STOP=1 --single-transaction -f");
    expect(sql).toContain("not by pg_dump");
    expect(sql).toContain("does NOT contain roles");
  });

  it("declares that the target must be empty, and emits no DROP", () => {
    // The deliberate choice over `CREATE ... IF NOT EXISTS`: that would merge
    // the backup's rows into whatever is already in the target and call it a
    // restore. Failing on the first existing object, inside one transaction,
    // leaves the target untouched instead. scripts/restore-db.mjs's
    // non-empty-target preflight is the same policy, said earlier.
    return renderDump().then((sql) => {
      expect(sql).toContain("The target must be an EMPTY database");
      expect(sql).toContain("contains no DROP statements");
      expect(sql).not.toMatch(/^DROP /m);
      expect(sql).not.toContain("IF NOT EXISTS (");
    });
  });

  it("carries pg_dump's own SET preamble", async () => {
    const sql = await renderDump();
    expect(sql).toContain("SET standard_conforming_strings = on;");
    expect(sql).toContain(
      "SELECT pg_catalog.set_config('search_path', '', false);",
    );
    expect(sql).toContain("SET client_encoding = 'UTF8';");
  });

  it("orders objects the way a restore needs them", async () => {
    const sql = await renderDump();
    const at = (needle: string) => {
      const i = sql.indexOf(needle);
      expect(i, `${needle} missing from the dump`).toBeGreaterThan(-1);
      return i;
    };
    // The sequence has to exist before the DEFAULT that calls nextval on it,
    // and the table before the ALTER that sets that default.
    expect(at("CREATE SEQUENCE")).toBeLessThan(at("CREATE TABLE"));
    expect(at("CREATE TABLE")).toBeLessThan(at("SET DEFAULT nextval"));
    expect(at("SET DEFAULT nextval")).toBeLessThan(at("COPY public."));
    // Constraints and indexes after the data, foreign keys last of all, so no
    // row order can violate one.
    expect(at("COPY public.")).toBeLessThan(at("ADD CONSTRAINT"));
    expect(at('ADD CONSTRAINT "users_pkey"')).toBeLessThan(
      at('ADD CONSTRAINT "notes_user_fk"'),
    );
    expect(at("CREATE UNIQUE INDEX")).toBeLessThan(
      at('ADD CONSTRAINT "notes_user_fk"'),
    );
    expect(at('ADD CONSTRAINT "notes_user_fk"')).toBeLessThan(
      at("SELECT pg_catalog.setval("),
    );
  });

  it("writes the parent table's data before the child's", async () => {
    const sql = await renderDump();
    expect(sql.indexOf('COPY public."users"')).toBeLessThan(
      sql.indexOf('COPY public."notes"'),
    );
  });

  it("keeps a SERIAL default out of CREATE TABLE and in an ALTER", async () => {
    const sql = await renderDump();
    const from = sql.indexOf('CREATE TABLE public."users"');
    const create = sql.slice(from, sql.indexOf("\n);", from));
    expect(create).not.toContain("nextval");
    expect(sql).toContain(
      'ALTER TABLE ONLY public."users" ALTER COLUMN "id" SET DEFAULT ' +
        "nextval('public.users_id_seq'::regclass);",
    );
  });

  it("escapes a COPY row without letting it break the block", async () => {
    const sql = await renderDump();
    const block = sql.slice(
      sql.indexOf('COPY public."notes"'),
      sql.indexOf("\\.\n--#VR:COPYEND", sql.indexOf('COPY public."notes"')),
    );
    // NULL is \N and is not the empty string.
    expect(block).toContain("\\N");
    // No raw newline, tab or lone backslash escaped from the data survives as
    // a line break or a field break.
    // Line 0 is the COPY statement itself; the rest are rows.
    const dataLines = block.split("\n").slice(1).filter(Boolean);
    expect(dataLines).toHaveLength(2);
    for (const line of dataLines) {
      expect(line).not.toBe("\\.");
      expect(line.split("\t")).toHaveLength(2);
    }
  });

  it("drops the ctid cursor column from a table with no primary key", async () => {
    const sql = await renderDump();
    expect(sql).toContain('COPY public."notes" ("user_id", "body")');
    expect(sql).not.toContain("(0,1)");
  });

  it("ends with a marker that makes truncation detectable", async () => {
    const sql = await renderDump();
    expect(sql).toContain('--#VR:END {"tables":2,"rows":4}');
    expect(
      sql.trimEnd().endsWith("-- VulnRadar database dump complete\n--"),
    ).toBe(true);
  });

  it("puts a marker in front of every executable statement", async () => {
    const sql = await renderDump();
    // Anything that is neither a marker, a comment, blank, COPY data, nor
    // inside a marked statement would be SQL the restore could not frame.
    const markers = sql.split("\n").filter((l) => l.startsWith("--#VR:"));
    expect(markers.filter((l) => l.startsWith("--#VR:STMT")).length).toBe(
      // 10 preamble SETs + 1 function + 1 sequence + 2 tables + 1 OWNED BY
      // + 1 SET DEFAULT + 1 PK + 1 index + 1 FK + 1 trigger + 1 setval
      21,
    );
  });
});

describe("the file replays through the restore reader", () => {
  it("splits dollar-quoted plpgsql without tearing it in half", async () => {
    const sql = await renderDump();
    const client = fakeRestoreClient();
    await restoreSqlDump({ client, lines: linesOf(sql) });
    const fn = client.statements.find((s) => s.includes("CREATE OR REPLACE"));
    expect(fn).toBeDefined();
    expect(fn).toContain("$function$");
    expect(fn).toContain("NEW.updated_at = NOW();");
    // One statement, ending at the closing dollar quote, not at the semicolon
    // inside the body.
    expect(fn!.endsWith("$function$;")).toBe(true);
  });

  it("runs every statement inside one transaction", async () => {
    const sql = await renderDump();
    const client = fakeRestoreClient();
    await restoreSqlDump({ client, lines: linesOf(sql) });
    expect(client.statements[0]).toBe("BEGIN");
    expect(client.statements.at(-1)).toBe("RESET ALL");
    expect(client.statements.at(-2)).toBe("COMMIT");
  });

  it("never lets a marker line reach the database", async () => {
    const sql = await renderDump();
    const client = fakeRestoreClient();
    await restoreSqlDump({ client, lines: linesOf(sql) });
    for (const statement of client.statements) {
      expect(statement).not.toContain("--#VR:");
    }
  });

  it("returns every COPY value to the exact string the dump wrote", async () => {
    // The round trip that matters: value -> COPY escape -> file -> parse ->
    // bind parameter. Anything mangled in between shows up here.
    const sql = await renderDump();
    const client = fakeRestoreClient();
    const result = await restoreSqlDump({ client, lines: linesOf(sql) });

    const users = client.inserts.find((i) => i.text.includes('"users"'));
    expect(users!.values).toEqual(["1", "a@b.c", '{"x": 1}', "2", "", null]);

    const notes = client.inserts.find((i) => i.text.includes('"notes"'));
    expect(notes!.values).toEqual(["1", NASTY, "2", null]);

    expect(result.rows).toBe(4);
    expect(result.tables).toBe(2);
  });

  it("refuses a truncated file rather than applying part of it", async () => {
    const sql = await renderDump();
    const cut = sql.slice(0, sql.indexOf("--#VR:SECTION"));
    const client = fakeRestoreClient();
    await expect(
      restoreSqlDump({ client, lines: linesOf(cut) }),
    ).rejects.toThrow(/no end marker/);
    expect(client.statements).toContain("ROLLBACK");
    expect(client.statements).not.toContain("COMMIT");
  });

  it("refuses a file whose row count does not match its data", async () => {
    const sql = await renderDump();
    const tampered = sql.replace(
      '--#VR:COPYEND {"table":"users","rows":2}',
      '--#VR:COPYEND {"table":"users","rows":3}',
    );
    const client = fakeRestoreClient();
    await expect(
      restoreSqlDump({ client, lines: linesOf(tampered) }),
    ).rejects.toThrow(/truncated or corrupt/);
    expect(client.statements).not.toContain("COMMIT");
  });

  it("refuses SQL that sits outside any frame", async () => {
    // Not a tamper defence -- the file is executable SQL and anyone who can
    // edit it can add their own `--#VR:STMT` block. It is a "this file is not
    // what it claims to be" check: guessing at SQL the framing does not
    // account for is how a restore half-applies something nobody wrote.
    const sql = await renderDump().then((s) =>
      s.replace(
        '--#VR:SECTION "data"\n',
        '--#VR:SECTION "data"\nDELETE FROM public.users WHERE true;\n',
      ),
    );
    const client = fakeRestoreClient();
    await expect(
      restoreSqlDump({ client, lines: linesOf(sql) }),
    ).rejects.toThrow(/Unexpected SQL outside a marked statement/);
    expect(client.statements).not.toContain("COMMIT");
    expect(
      client.statements.some((s) => s.includes("DELETE FROM")),
      "the unframed statement must never be executed",
    ).toBe(false);
  });

  it("refuses a file that is not one of ours at all", async () => {
    const client = fakeRestoreClient();
    await expect(
      restoreSqlDump({
        client,
        lines: linesOf("-- PostgreSQL database dump\nSET foo = 1;\n"),
      }),
    ).rejects.toThrow(/Unexpected SQL outside a marked statement/);
  });
});
