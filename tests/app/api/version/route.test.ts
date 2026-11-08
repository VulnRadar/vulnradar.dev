/**
 * GET /api/version: the release check, and the block that tells a client which
 * API versions this server speaks. Only the GitHub fetch and, where a test
 * needs a future state, the dormant constants are replaced.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockFetchLatestRelease = vi.fn();
vi.mock("@/lib/updater/github-release", () => ({
  fetchLatestRelease: (...args: unknown[]) => mockFetchLatestRelease(...args),
}));

const calendar = vi.hoisted(() => ({ deprecatedAt: "", sunset: "" }));
vi.mock("@/lib/config/config-values", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/config-values")>()),
  get CONFIG_API_V3_DEPRECATED_AT() {
    return calendar.deprecatedAt;
  },
  get CONFIG_API_V3_SUNSET() {
    return calendar.sunset;
  },
}));

import {
  CONFIG_API_CURRENT_VERSION,
  CONFIG_API_SUPPORTED_VERSIONS,
} from "@/lib/config/config-values";

async function loadGet() {
  vi.resetModules();
  return (await import("@/app/api/version/route")).GET;
}

const DORMANT_BLOCK = {
  current: CONFIG_API_CURRENT_VERSION,
  supported: [...CONFIG_API_SUPPORTED_VERSIONS],
  deprecated: {},
};

beforeEach(() => {
  calendar.deprecatedAt = "";
  calendar.sunset = "";
  mockFetchLatestRelease.mockReset();
});

describe("GET /api/version", () => {
  describe("the api block is on every answer", () => {
    it("when the release lookup succeeds", async () => {
      mockFetchLatestRelease.mockResolvedValue({
        version: "99.0.0",
        htmlUrl: "https://example.test/release",
      });
      const GET = await loadGet();

      const json = await (await GET()).json();

      expect(json.api).toEqual(DORMANT_BLOCK);
      expect(json.latest).toBe("99.0.0");
      expect(json.status).toBe("behind");
    });

    it("when GitHub has no answer", async () => {
      mockFetchLatestRelease.mockResolvedValue(null);
      const GET = await loadGet();

      const json = await (await GET()).json();

      expect(json.api).toEqual(DORMANT_BLOCK);
      expect(json.status).toBe("unknown");
    });

    it("when the release lookup throws", async () => {
      mockFetchLatestRelease.mockRejectedValue(new Error("offline"));
      const GET = await loadGet();

      const json = await (await GET()).json();

      expect(json.api).toEqual(DORMANT_BLOCK);
      expect(json.status).toBe("unknown");
    });
  });

  it("keeps every key installed extensions already parse", async () => {
    mockFetchLatestRelease.mockResolvedValue(null);
    const GET = await loadGet();

    const json = await (await GET()).json();

    for (const key of [
      "current",
      "engine",
      "latest",
      "status",
      "message",
      "release_url",
    ]) {
      expect(json).toHaveProperty(key);
    }
  });

  it("reports the v3 calendar once the release sets it", async () => {
    calendar.deprecatedAt = "2026-12-01T00:00:00.000Z";
    calendar.sunset = "2027-06-01T00:00:00.000Z";
    mockFetchLatestRelease.mockResolvedValue(null);
    const GET = await loadGet();

    const json = await (await GET()).json();

    expect(json.api.deprecated).toEqual({
      v3: {
        deprecatedAt: "2026-12-01T00:00:00.000Z",
        sunsetAt: "2027-06-01T00:00:00.000Z",
      },
    });
  });
});
