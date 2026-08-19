/**
 * Contract tests for the opt-in page screenshot module
 * (lib/scanner/page-screenshot.ts).
 *
 * Deliberately DB-free (the database is NOT mocked): both properties under
 * test are decided before any database or network work happens.
 *
 *   1. shouldCaptureScreenshot -- the pure gate executeScan /
 *      executeCrawlScan use to decide whether to even attempt a capture.
 *      Proves a screenshot is only attempted when the user opted in AND the
 *      target is a real HTTP web host.
 *
 *   2. The best-effort contract: with BrowserBase not configured (the
 *      self-hosted-with-no-creds case), capturePageScreenshot /
 *      captureAndStoreScreenshot return null and never throw -- and short-
 *      circuit at the config check, before touching the meter, the
 *      concurrency queue, the network, or the database.
 *
 * A dummy DATABASE_URL is set before the module (whose transitive imports
 * construct the pg pool) is dynamically loaded -- the same approach
 * tests/lib/database/db.test.ts uses. This provides a connection string, not
 * a database mock; no assertion below ever issues a query.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://user:pass@localhost:5432/vulnradar_test";

type Mod = typeof import("@/lib/scanner/page-screenshot");
let mod: Mod;

beforeAll(async () => {
  mod = await import("@/lib/scanner/page-screenshot");
});

describe("shouldCaptureScreenshot (opt-in threading gate)", () => {
  it("attempts a capture only when opted in on a real HTTP host", () => {
    expect(
      mod.shouldCaptureScreenshot({
        optedIn: true,
        protocolType: "http",
        isRawIpTarget: false,
      }),
    ).toBe(true);
  });

  it("never attempts a capture when the user did not opt in", () => {
    expect(
      mod.shouldCaptureScreenshot({
        optedIn: false,
        protocolType: "http",
        isRawIpTarget: false,
      }),
    ).toBe(false);
  });

  it("skips a raw-IP target even when opted in (no page to render)", () => {
    expect(
      mod.shouldCaptureScreenshot({
        optedIn: true,
        protocolType: "http",
        isRawIpTarget: true,
      }),
    ).toBe(false);
  });

  it("skips a non-HTTP protocol even when opted in", () => {
    for (const protocolType of ["ssh", "smtp", "mongodb", "websocket", "ftp"]) {
      expect(
        mod.shouldCaptureScreenshot({
          optedIn: true,
          protocolType,
          isRawIpTarget: false,
        }),
      ).toBe(false);
    }
  });
});

describe("capturePageScreenshot best-effort contract (BrowserBase unconfigured)", () => {
  const savedApiKey = process.env.BROWSERBASE_API_KEY;
  const savedProjectId = process.env.BROWSERBASE_PROJECT_ID;

  beforeEach(() => {
    // Force the not-configured path. isBrowserBaseConfigured() reads these at
    // call time, so clearing them here is enough to short-circuit before any
    // meter/queue/network/database work.
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_PROJECT_ID;
  });

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = savedApiKey;
    if (savedProjectId === undefined) delete process.env.BROWSERBASE_PROJECT_ID;
    else process.env.BROWSERBASE_PROJECT_ID = savedProjectId;
  });

  it("returns null and never throws when BrowserBase is not configured", async () => {
    await expect(
      mod.capturePageScreenshot("https://example.com", { userId: 1 }),
    ).resolves.toBeNull();
  });

  it("returns null for a garbage URL rather than throwing", async () => {
    await expect(
      mod.capturePageScreenshot("not a url", { userId: 1 }),
    ).resolves.toBeNull();
  });

  it("captureAndStoreScreenshot returns null (never reaches storage) when unconfigured", async () => {
    await expect(
      mod.captureAndStoreScreenshot(123, "https://example.com", { userId: 1 }),
    ).resolves.toBeNull();
  });
});
