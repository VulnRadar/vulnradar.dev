import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The shape of API key metering: which statements run, on which connection,
 * and how their result becomes the numbers the 429 body and the X-RateLimit
 * headers report.
 *
 * What this cannot prove is what Postgres does with them. Whether two callers
 * arriving together can both get past the cap is in
 * tests/integration/api-key-caps.test.ts, against a real database.
 */

type Row = Record<string, unknown>;

const clientStatements: { sql: string; params: unknown[] }[] = [];
let lockRows: Row[] = [{ id: 7 }];
let meterRow: Row = { used: 0, inserted: true, oldest: null };
let failOn: RegExp | null = null;

const mockRelease = vi.fn();
const mockPoolQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({
  rows: [meterRow],
}));
const mockConnect = vi.fn(async () => ({
  query: async (sql: string, params: unknown[] = []) => {
    clientStatements.push({ sql: sql.trim(), params });
    if (failOn?.test(sql)) throw new Error("connection lost");
    if (/FOR UPDATE/.test(sql)) return { rows: lockRows };
    if (/^\s*WITH/.test(sql)) return { rows: [meterRow] };
    return { rows: [] };
  },
  release: mockRelease,
}));

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockPoolQuery(sql, params),
    connect: () => mockConnect(),
  },
}));

vi.mock("@/lib/auth/crypto", () => ({
  isEncryptionConfigured: () => true,
  encryptApiKey: (raw: string) => `enc:${raw}`,
  decryptApiKey: (enc: string) => String(enc).replace(/^enc:/, ""),
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
}));

const { checkRateLimit, peekRateLimit } = await import("@/lib/api/api-keys");

const DAY_MS = 24 * 60 * 60 * 1000;
const OLDEST = new Date("2030-03-01T10:00:00.000Z");
const OLDEST_PLUS_A_DAY = new Date(OLDEST.getTime() + DAY_MS).toISOString();

function kinds(): string[] {
  return clientStatements.map(({ sql }) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return sql;
    if (/FOR UPDATE/.test(sql)) return "lock";
    if (sql.startsWith("WITH")) return "meter";
    if (/last_used_at/.test(sql)) return "last_used_at";
    return sql;
  });
}

beforeEach(() => {
  clientStatements.length = 0;
  lockRows = [{ id: 7 }];
  meterRow = { used: 0, inserted: true, oldest: OLDEST };
  failOn = null;
  mockRelease.mockClear();
  mockPoolQuery.mockClear();
  mockConnect.mockClear();
});

describe("checkRateLimit", () => {
  it("does all its work inside one transaction, in lock-then-count order", async () => {
    await checkRateLimit(7, 5);

    expect(kinds()).toEqual([
      "BEGIN",
      "lock",
      "meter",
      "last_used_at",
      "COMMIT",
    ]);
  });

  it("never asks the pool for a second connection while holding one", async () => {
    // Holding a client while awaiting pool.query is a deadlock the moment
    // every client in the pool is held by a caller doing the same thing.
    await checkRateLimit(7, 5);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("counts, finds the oldest request and conditionally inserts in one statement", async () => {
    await checkRateLimit(7, 5);

    const meter = clientStatements.find(({ sql }) => sql.startsWith("WITH"));
    expect(meter?.sql).toMatch(/COUNT\(\*\)/);
    expect(meter?.sql).toMatch(/MIN\(used_at\)/);
    expect(meter?.sql).toMatch(/INSERT INTO api_usage/);
    expect(meter?.sql).toMatch(/WHERE used < \$2/);
    expect(meter?.params).toEqual([7, 5]);
  });

  it("reports an allowed request with the new usage counted in", async () => {
    meterRow = { used: 2, inserted: true, oldest: OLDEST };

    expect(await checkRateLimit(7, 5)).toEqual({
      allowed: true,
      remaining: 2,
      limit: 5,
      used: 3,
      resetsAt: OLDEST_PLUS_A_DAY,
    });
  });

  it("reports a refused request without counting it", async () => {
    meterRow = { used: 5, inserted: false, oldest: OLDEST };

    expect(await checkRateLimit(7, 5)).toEqual({
      allowed: false,
      remaining: 0,
      limit: 5,
      used: 5,
      resetsAt: OLDEST_PLUS_A_DAY,
    });
  });

  it("still stamps last_used_at on a refused request", async () => {
    // A key hammering its cap is in use, and the profile list says so.
    meterRow = { used: 5, inserted: false, oldest: OLDEST };

    await checkRateLimit(7, 5);

    expect(kinds()).toContain("last_used_at");
  });

  it("gives a full window when nothing is in it and nothing was recorded", async () => {
    meterRow = { used: 0, inserted: false, oldest: null };
    const before = Date.now();

    const result = await checkRateLimit(7, 0);

    expect(result.allowed).toBe(false);
    expect(new Date(result.resetsAt).getTime()).toBeGreaterThanOrEqual(
      before + DAY_MS,
    );
  });

  it("refuses a key whose row is gone, recording nothing", async () => {
    lockRows = [];

    const result = await checkRateLimit(7, 5);

    expect(result).toMatchObject({ allowed: false, remaining: 0, used: 0 });
    expect(kinds()).toEqual(["BEGIN", "lock", "ROLLBACK"]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the metering statement", /^\s*WITH/],
    ["the last_used_at update", /last_used_at/],
  ])("rolls back and releases when %s fails", async (_name, pattern) => {
    failOn = pattern;

    await expect(checkRateLimit(7, 5)).rejects.toThrow("connection lost");

    expect(kinds()).toContain("ROLLBACK");
    expect(kinds()).not.toContain("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("peekRateLimit", () => {
  it("reads count and oldest in one statement on the pool, writing nothing", async () => {
    meterRow = { used: 3, oldest: OLDEST };

    await peekRateLimit(7, 5);

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/COUNT\(\*\)/);
    expect(sql).toMatch(/MIN\(used_at\)/);
    expect(sql).not.toMatch(/INSERT|UPDATE/);
    expect(params).toEqual([7]);
  });

  it("reports the same shape as checkRateLimit without counting itself", async () => {
    meterRow = { used: 3, oldest: OLDEST };

    expect(await peekRateLimit(7, 5)).toEqual({
      allowed: true,
      remaining: 2,
      limit: 5,
      used: 3,
      resetsAt: OLDEST_PLUS_A_DAY,
    });
  });

  it("says not allowed at the cap, with the moment a slot frees up", async () => {
    meterRow = { used: 5, oldest: OLDEST };

    expect(await peekRateLimit(7, 5)).toEqual({
      allowed: false,
      remaining: 0,
      limit: 5,
      used: 5,
      resetsAt: OLDEST_PLUS_A_DAY,
    });
  });

  it("gives a full window for a key with no usage yet", async () => {
    meterRow = { used: 0, oldest: null };
    const before = Date.now();

    const result = await peekRateLimit(7, 5);

    expect(result).toMatchObject({ allowed: true, remaining: 5, used: 0 });
    expect(new Date(result.resetsAt).getTime()).toBeGreaterThanOrEqual(
      before + DAY_MS,
    );
  });
});
