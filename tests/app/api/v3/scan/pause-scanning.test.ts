/**
 * PAUSE_SCANNING, one test per scan entry point.
 *
 * This file exists because of a specific failure mode: a kill switch that
 * covers the obvious path and misses the rest is worse than no kill switch,
 * since the operator reads "scanning paused" in the admin panel and believes
 * it. There are five independent scan pipelines in this codebase and only
 * three of them go through lib/scanner/execute-*.ts, so a gate placed in the
 * executor would silently miss the authenticated scan, the demo scan and the
 * GitHub repository scan.
 *
 * The list below is therefore the point of the suite, not incidental
 * coverage. Adding a sixth way to start a scan means adding a case here.
 *
 * Everything is driven through the real lib/admin/service-state.ts with only
 * the settings resolver faked, so these prove the route is actually wired to
 * the switch rather than that a mocked guard returns what it was told to.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

type SettingOverrides = Record<string, string | number | boolean>;
const overrides: SettingOverrides = {};

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const resolve = (key: string) =>
    key in overrides
      ? overrides[key]
      : (SETTINGS_REGISTRY as Record<string, { default: unknown }>)[key]
          ?.default;
  return {
    getSetting: vi.fn(async (key: string) => resolve(key)),
    getSettings: vi.fn(async (keys: readonly string[]) =>
      Object.fromEntries(keys.map((k) => [k, resolve(k)])),
    ),
    invalidateSettingsCache: vi.fn(),
    resolveAppUrl: vi.fn(async () => "https://vulnradar.dev"),
  };
});

const mockQuery = vi.fn(async (..._args: unknown[]) => ({
  rows: [],
  rowCount: 0,
}));
// The scheduled-scan worker claims its batch through pool.connect(), not
// pool.query(), so the fake pool needs both for "did the worker touch the
// database at all" to mean anything.
const mockConnect = vi.fn(async () => ({
  query: mockQuery,
  release: () => {},
}));
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
  getPoolStats: () => ({}),
}));

// No session, no API key: every one of these handlers would fall through to a
// 401 if the pause gate were missing, which is what the "not paused" control
// at the bottom checks for.
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => null),
  createSession: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  createOAuthUser: vi.fn(),
}));

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: vi.fn(async () => "203.0.113.9"),
    getUserAgent: vi.fn(async () => "vitest"),
  };
});

// Imported once at module scope rather than inside each test: pulling in the
// single-URL scan route drags the whole check registry through the
// transformer, which alone is slower than the default 5s per-test timeout.
const scanRoute = await import("@/app/api/v3/scan/route");
const crawlRoute = await import("@/app/api/v3/scan/crawl/route");
const bulkRoute = await import("@/app/api/v3/scan/bulk/route");
const authenticatedRoute =
  await import("@/app/api/v3/scan/authenticated/route");
const githubRoute = await import("@/app/api/v3/scan/github/route");
const demoRoute = await import("@/app/api/v3/demo-scan/route");
const discoverRoute = await import("@/app/api/v3/scan/discover/route");
const crawlDiscoverRoute =
  await import("@/app/api/v3/scan/crawl/discover/route");
const portsRoute = await import("@/app/api/v3/history/[id]/ports/route");
const { runDueSchedules } =
  await import("@/lib/scanner/scheduled-scans-worker");

function post(path: string, body: unknown = {}) {
  return new NextRequest(`https://vulnradar.dev${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Every refusal looks the same, whichever pipeline produced it. */
async function expectPaused(res: Response) {
  expect(res.status).toBe(503);
  expect(res.headers.get("Retry-After")).toBe("300");
  await expect(res.json()).resolves.toMatchObject({
    paused: true,
    error: PAUSE_MESSAGE,
  });
}

const PAUSE_MESSAGE = "Scanner maintenance, back within the hour.";

beforeEach(() => {
  for (const key of Object.keys(overrides)) delete overrides[key];
  mockQuery.mockClear();
  mockConnect.mockClear();
});

function pauseScanning() {
  overrides.PAUSE_SCANNING = true;
  overrides.PAUSE_SCANNING_MESSAGE = PAUSE_MESSAGE;
}
describe("PAUSE_SCANNING refuses every scan entry point", () => {
  it("POST /api/v3/scan (single URL)", async () => {
    pauseScanning();
    await expectPaused(
      await scanRoute.POST(post("/api/v3/scan", { url: "https://a.b" })),
    );
  });

  it("POST /api/v3/scan/crawl (crawl)", async () => {
    pauseScanning();
    await expectPaused(
      await crawlRoute.POST(post("/api/v3/scan/crawl", { url: "https://a.b" })),
    );
  });

  it("POST /api/v3/scan/bulk (bulk)", async () => {
    pauseScanning();
    await expectPaused(
      await bulkRoute.POST(
        post("/api/v3/scan/bulk", { urls: ["https://a.b"] }),
      ),
    );
  });

  // Inline pipeline: never calls executeScan, so it needs its own gate.
  it("POST /api/v3/scan/authenticated (authenticated)", async () => {
    pauseScanning();
    await expectPaused(
      await authenticatedRoute.POST(
        post("/api/v3/scan/authenticated", { url: "https://a.b" }),
      ),
    );
  });

  // Static + AI pipeline against repository source: also no executeScan.
  it("POST /api/v3/scan/github (GitHub repository)", async () => {
    pauseScanning();
    await expectPaused(
      await githubRoute.POST(
        post("/api/v3/scan/github", { repoFullName: "a/b" }),
      ),
    );
  });

  // Unauthenticated and IP-limited only, so the highest-volume way in.
  it("POST /api/v3/demo-scan (signed-out demo)", async () => {
    pauseScanning();
    await expectPaused(
      await demoRoute.POST(post("/api/v3/demo-scan", { url: "https://a.b" })),
    );
  });

  it("POST /api/v3/scan/discover (subdomain discovery)", async () => {
    pauseScanning();
    await expectPaused(
      await discoverRoute.POST(
        post("/api/v3/scan/discover", { url: "https://a.b" }),
      ),
    );
  });

  it("POST /api/v3/scan/crawl/discover (crawl page discovery)", async () => {
    pauseScanning();
    await expectPaused(
      await crawlDiscoverRoute.POST(
        post("/api/v3/scan/crawl/discover", { url: "https://a.b" }),
      ),
    );
  });

  it("POST /api/v3/history/[id]/ports (live port sweep refresh)", async () => {
    pauseScanning();
    await expectPaused(
      await portsRoute.POST(post("/api/v3/history/1/ports"), {
        params: Promise.resolve({ id: "1" }),
      }),
    );
  });

  // The background half. Gated in runDueSchedules rather than per-schedule so
  // nothing is claimed: claiming and then declining would move next_run_at
  // forward and quietly eat every schedule due during the pause.
  it("the scheduled-scan worker claims nothing", async () => {
    pauseScanning();
    await expect(runDueSchedules()).resolves.toEqual({
      processed: 0,
      scanned: 0,
      blocked: 0,
      planGated: 0,
      quotaGated: 0,
      concurrencyGated: 0,
      errors: 0,
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe("MAINTENANCE_MODE alone pauses scanning", () => {
  it("refuses a scan with the maintenance message, without PAUSE_SCANNING set", async () => {
    overrides.MAINTENANCE_MODE = true;
    overrides.MAINTENANCE_MESSAGE = "Migrating the database.";
    const res = await scanRoute.POST(
      post("/api/v3/scan", { url: "https://a.b" }),
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Migrating the database.",
    });
  });
});

describe("control: the gate is off by default", () => {
  // Without this, every assertion above would still pass if the gate were
  // wired to refuse unconditionally.
  it("lets an unauthenticated scan reach the normal 401 instead of a 503", async () => {
    const res = await scanRoute.POST(
      post("/api/v3/scan", { url: "https://a.b" }),
    );
    expect(res.status).not.toBe(503);
  });

  it("lets the scheduled-scan worker get as far as claiming schedules", async () => {
    await runDueSchedules();
    expect(mockConnect).toHaveBeenCalled();
  });
});
