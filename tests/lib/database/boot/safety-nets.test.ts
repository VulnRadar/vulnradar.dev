import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";
import {
  repairSequences,
  sequenceRepairSql,
} from "@/lib/database/boot/safety-nets";

/**
 * Sequence repair must never move a sequence backwards (bug-db-6).
 *
 * It used to read the sequence, then MAX(id), then call setval with a number
 * it computed in between. A deploy boots while the old instance is still
 * inserting, so the sequence could pass MAX(id) in that gap and setval pulled
 * it back to a value already handed out. The fake below models the live
 * sequence moving between queries, and checks the only setval the repair can
 * issue is the guarded one-statement form, whose value is read from the
 * sequence in the same statement.
 */

interface Seq {
  table: string;
  max: number | null;
  last: number | null;
}

/**
 * A pool over some sequences. Every query first lets "the other instance"
 * draw `drawPerQuery` ids from every sequence, so a value read by one query
 * is stale by the next. The repair statement itself is evaluated the way
 * PostgreSQL evaluates it: the WHERE and the GREATEST both read the sequence
 * as it is at that moment.
 */
function sequencePool(seqs: Seq[], drawPerQuery = 0) {
  const setvals: Array<{ table: string; from: number | null; to: number }> = [];
  const sent: string[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    for (const s of seqs) {
      if (drawPerQuery > 0) s.last = (s.last ?? 0) + drawPerQuery;
    }
    sent.push(text);
    if (/FROM pg_class s/.test(text)) {
      return {
        rows: seqs.map((s) => ({
          seq_ref: `${s.table}_id_seq`,
          tbl_ident: s.table,
          col_ident: "id",
          tbl_name: s.table,
        })),
      };
    }
    if (/setval/.test(text)) {
      expect(text).toMatch(
        /WHERE x\.m > COALESCE\(pg_sequence_last_value\(\$1::regclass\), 0\)/,
      );
      expect(text).toMatch(
        /setval\(\$1::regclass, GREATEST\(x\.m, COALESCE\(pg_sequence_last_value\(\$1::regclass\), 0\)\)\)/,
      );
      const s = seqs.find((q) => `${q.table}_id_seq` === values?.[0]);
      if (!s || s.max === null || !(s.max > (s.last ?? 0))) return { rows: [] };
      const from = s.last;
      const to = Math.max(s.max, s.last ?? 0);
      setvals.push({ table: s.table, from, to });
      s.last = to;
      return { rows: [{ prev_value: from, new_value: String(to) }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  return { pool: { query } as unknown as Pool, setvals, sent };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repairSequences", () => {
  it("moves a sequence that fell behind MAX(id) forward", async () => {
    const seqs = [{ table: "badges", max: 40, last: 12 }];
    const { pool, setvals } = sequencePool(seqs);
    await repairSequences(pool, "App");
    expect(setvals).toEqual([{ table: "badges", from: 12, to: 40 }]);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("badges (was 12, fixed to 40)"),
    );
  });

  it("repairs a sequence nothing has drawn from yet", async () => {
    const { pool, setvals } = sequencePool([
      { table: "teams", max: 7, last: null },
    ]);
    await repairSequences(pool, "App");
    expect(setvals).toEqual([{ table: "teams", from: null, to: 7 }]);
  });

  it("leaves a sequence ahead of MAX(id) and an empty table alone", async () => {
    const { pool, setvals } = sequencePool([
      { table: "scan_history", max: 900, last: 1200 },
      { table: "webhooks", max: null, last: null },
    ]);
    await repairSequences(pool, "App");
    expect(setvals).toEqual([]);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("never sets a value below the sequence while another instance keeps drawing ids", async () => {
    // MAX(id) was read as 100 while the sequence stood at 95; the old
    // instance keeps inserting, so by the time anything runs it is past 100.
    const seqs = [{ table: "scan_history", max: 100, last: 95 }];
    const before = () => seqs[0].last ?? 0;
    const { pool, setvals } = sequencePool(seqs, 3);
    const floor = before();
    await repairSequences(pool, "App");
    for (const s of setvals) {
      expect(s.to).toBeGreaterThanOrEqual(s.from ?? 0);
    }
    expect(seqs[0].last ?? 0).toBeGreaterThanOrEqual(floor);
  });

  it("issues one statement per sequence and never a bare setval with a computed number", async () => {
    const { pool, sent } = sequencePool([
      { table: "a", max: 5, last: 1 },
      { table: "b", max: 1, last: 5 },
    ]);
    await repairSequences(pool, "App");
    expect(sent).toHaveLength(3);
    expect(sent.some((t) => /SELECT setval\(\$1, \$2\)/.test(t))).toBe(false);
  });

  it("does not throw when the catalog query fails, so a boot is never stopped", async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error("permission denied");
      }),
    } as unknown as Pool;
    await expect(repairSequences(pool, "App")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("sequenceRepairSql", () => {
  it("quotes nothing itself: the identifiers come quote_ident'd from the catalog", () => {
    const { text, values } = sequenceRepairSql({
      seq_ref: '"Weird"_id_seq',
      tbl_ident: '"Weird"',
      col_ident: '"Id"',
      tbl_name: "Weird",
    });
    expect(text).toContain('MAX("Id")');
    expect(text).toContain('FROM "Weird"');
    expect(values).toEqual(['"Weird"_id_seq']);
  });
});
