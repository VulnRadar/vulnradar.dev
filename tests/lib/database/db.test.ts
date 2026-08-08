import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for lib/database/db.ts: pool construction, the `tunable()` env
 * override/validation logic, the SSL MITM-fix regression, the pool error
 * handler, and getPoolStats() (the thing /api/v3/health reads).
 *
 * db.ts is the file that constructs the `pg.Pool`, so it cannot be tested
 * by mocking `@/lib/database/db` (that would mock away the code under
 * test). Instead this mocks one level down, at `pg`'s `Pool` class itself
 * -- the real wire boundary -- so `tunable()`, the SSL branch, and
 * `getPoolStats()` all run for real against a captured config/instance.
 */

type PoolConfigArg = Record<string, unknown>;

let poolConstructorCalls: PoolConfigArg[] = [];
let lastPoolInstance: FakePool | null = null;

class FakePool {
  totalCount = 0;
  idleCount = 0;
  waitingCount = 0;
  config: PoolConfigArg;
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor(config: PoolConfigArg) {
    this.config = config;
    poolConstructorCalls.push(config);
    lastPoolInstance = this;
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  connect = vi.fn();
  query = vi.fn();
  end = vi.fn();
}

vi.mock("pg", () => ({
  Pool: FakePool,
}));

const ORIGINAL_ENV = { ...process.env };
const TUNABLE_KEYS = [
  "DATABASE_POOL_MAX",
  "DATABASE_POOL_MIN",
  "DATABASE_IDLE_TIMEOUT_MS",
  "DATABASE_CONNECTION_TIMEOUT_MS",
  "DATABASE_STATEMENT_TIMEOUT_MS",
  "DATABASE_QUERY_TIMEOUT_MS",
  "DATABASE_SSL",
  "DATABASE_SSL_CA",
];

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  for (const key of TUNABLE_KEYS) delete process.env[key];
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";
}

beforeEach(() => {
  vi.resetModules();
  poolConstructorCalls = [];
  lastPoolInstance = null;
  resetEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function loadDb() {
  return import("@/lib/database/db");
}

describe("DATABASE_URL requirement", () => {
  it("throws a clear error when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;
    await expect(loadDb()).rejects.toThrow(/DATABASE_URL/);
  });
});

describe("connection pool tuning (tunable)", () => {
  it("uses the compiled defaults when no env override is set", async () => {
    const { POOL_CONFIG } = await loadDb();
    expect(POOL_CONFIG).toEqual({
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
    });
  });

  it("honors a DATABASE_POOL_MAX override", async () => {
    process.env.DATABASE_POOL_MAX = "25";
    const { POOL_CONFIG } = await loadDb();
    expect(POOL_CONFIG.max).toBe(25);
  });

  it("honors overrides for every tunable, not just pool max", async () => {
    process.env.DATABASE_POOL_MIN = "2";
    process.env.DATABASE_IDLE_TIMEOUT_MS = "1000";
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = "2000";
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = "3000";
    process.env.DATABASE_QUERY_TIMEOUT_MS = "4000";
    const { POOL_CONFIG } = await loadDb();
    expect(POOL_CONFIG.min).toBe(2);
    expect(POOL_CONFIG.idleTimeoutMillis).toBe(1000);
    expect(POOL_CONFIG.connectionTimeoutMillis).toBe(2000);
    expect(POOL_CONFIG.statement_timeout).toBe(3000);
    expect(POOL_CONFIG.query_timeout).toBe(4000);
  });

  it("treats an empty-string override as unset and falls back to the default", async () => {
    process.env.DATABASE_POOL_MIN = "";
    const { POOL_CONFIG } = await loadDb();
    expect(POOL_CONFIG.min).toBe(0);
  });

  it("rejects a non-numeric tunable loudly instead of silently coercing it", async () => {
    process.env.DATABASE_POOL_MAX = "not-a-number";
    await expect(loadDb()).rejects.toThrow(/DATABASE_POOL_MAX/);
  });

  it("rejects a negative tunable", async () => {
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = "-1";
    await expect(loadDb()).rejects.toThrow(/DATABASE_CONNECTION_TIMEOUT_MS/);
  });

  it("accepts zero as a valid tunable value", async () => {
    process.env.DATABASE_POOL_MIN = "0";
    const { POOL_CONFIG } = await loadDb();
    expect(POOL_CONFIG.min).toBe(0);
  });
});

describe("SSL configuration (MITM-fix regression)", () => {
  it("disables SSL entirely when DATABASE_SSL is unset (local-dev default)", async () => {
    await loadDb();
    expect(poolConstructorCalls[0].ssl).toBe(false);
  });

  it("disables SSL when DATABASE_SSL is any value other than the literal 'true'", async () => {
    process.env.DATABASE_SSL = "1";
    await loadDb();
    expect(poolConstructorCalls[0].ssl).toBe(false);
  });

  it("enables SSL with rejectUnauthorized true -- never false -- when DATABASE_SSL=true", async () => {
    // Regression: rejectUnauthorized used to be hardcoded false even with
    // DATABASE_SSL=true, letting an on-path attacker MITM the DB
    // connection. It must never regress back to `false` here.
    process.env.DATABASE_SSL = "true";
    await loadDb();
    const ssl = poolConstructorCalls[0].ssl as {
      rejectUnauthorized: boolean;
      ca?: string;
    };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBeUndefined();
  });

  it("includes the CA bundle when DATABASE_SSL_CA is set", async () => {
    process.env.DATABASE_SSL = "true";
    process.env.DATABASE_SSL_CA =
      "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----";
    await loadDb();
    const ssl = poolConstructorCalls[0].ssl as {
      rejectUnauthorized: boolean;
      ca?: string;
    };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe(process.env.DATABASE_SSL_CA);
  });

  it("omits the CA bundle key entirely when DATABASE_SSL_CA is not set", async () => {
    process.env.DATABASE_SSL = "true";
    await loadDb();
    const ssl = poolConstructorCalls[0].ssl as Record<string, unknown>;
    expect("ca" in ssl).toBe(false);
  });
});

describe("pool construction", () => {
  it("passes the connection string and a fixed application_name through", async () => {
    await loadDb();
    expect(poolConstructorCalls[0].connectionString).toBe(
      process.env.DATABASE_URL,
    );
    expect(poolConstructorCalls[0].application_name).toBe("vulnradar");
  });

  it("logs but does not throw on an unexpected pool error (Error instance)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadDb();
    expect(() =>
      lastPoolInstance!.emit(
        "error",
        new Error("connection terminated unexpectedly"),
      ),
    ).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected database pool error"),
      "connection terminated unexpectedly",
    );
    errSpy.mockRestore();
  });

  it("logs a safe fallback message when a non-Error is thrown on the error event", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadDb();
    lastPoolInstance!.emit("error", "raw string failure");
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected database pool error"),
      "non-Error thrown",
    );
    errSpy.mockRestore();
  });
});

describe("getPoolStats", () => {
  it("reflects live pool counters plus the configured max", async () => {
    const { getPoolStats } = await loadDb();
    lastPoolInstance!.totalCount = 7;
    lastPoolInstance!.idleCount = 3;
    lastPoolInstance!.waitingCount = 2;
    expect(getPoolStats()).toEqual({
      total: 7,
      idle: 3,
      waiting: 2,
      max: 10,
    });
  });

  it("reflects a configured max override", async () => {
    process.env.DATABASE_POOL_MAX = "50";
    const { getPoolStats } = await loadDb();
    expect(getPoolStats().max).toBe(50);
  });

  it("starts at zero for a freshly constructed pool", async () => {
    const { getPoolStats } = await loadDb();
    expect(getPoolStats()).toEqual({ total: 0, idle: 0, waiting: 0, max: 10 });
  });
});

describe("default export", () => {
  it("exports the constructed pool instance", async () => {
    const dbModule = await loadDb();
    expect(dbModule.default).toBe(lastPoolInstance);
  });
});
