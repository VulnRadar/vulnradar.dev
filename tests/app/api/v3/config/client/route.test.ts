/**
 * GET /api/v3/config/client: the one place admin-editable settings cross to
 * the browser. Only the settings resolver is faked; the field mapping and the
 * keys asked for are the real route.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSettings = vi.fn();

vi.mock("@/lib/config/runtime-config", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const { GET } = await import("@/app/api/v3/config/client/route");

beforeEach(() => {
  mockGetSettings.mockReset();
  mockGetSettings.mockImplementation(async (keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, k])),
  );
});

describe("GET /api/v3/config/client", () => {
  it("sends the scan watchdog budgets the dashboard's wait is derived from", async () => {
    // The dashboard used to wait a fixed 6 or 16 minutes, so an admin who
    // raised either budget had running scans declared failed. It can only
    // follow them if the budgets cross to the browser.
    const res = await GET();
    const body = await res.json();

    expect(mockGetSettings.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        "SCAN_TIMEOUT_SECONDS",
        "CRAWL_SCAN_TIMEOUT_SECONDS",
      ]),
    );
    expect(body.scanTimeoutSeconds).toBe("SCAN_TIMEOUT_SECONDS");
    expect(body.crawlScanTimeoutSeconds).toBe("CRAWL_SCAN_TIMEOUT_SECONDS");
  });

  it("still sends the poll interval and the feature flags", async () => {
    const body = await (await GET()).json();
    expect(body.scanStatusPollIntervalMs).toBe("SCAN_STATUS_POLL_INTERVAL_MS");
    expect(body.featureBulkScans).toBe("FEATURE_BULK_SCANS");
  });

  it("is cacheable for a minute", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });
});
