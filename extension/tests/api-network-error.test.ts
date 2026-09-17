import { afterEach, describe, expect, it, vi } from "vitest";

import {
  api,
  apiErrorFallback,
  VulnRadarApiError,
  VulnRadarNetworkError,
} from "../src/lib/api";

/**
 * A request that never gets a response must reach the popup as an authored
 * sentence, not the browser's own exception text. The popup's error banner and
 * its screen-reader announcement both print `err.message` as-is, and before
 * this they printed "TypeError: Failed to fetch".
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("network failures", () => {
  it("turns a failed fetch into an authored connection error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await api.version().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VulnRadarNetworkError);
    expect((err as VulnRadarNetworkError).timedOut).toBe(false);
    expect((err as Error).message).toBe(
      "Could not reach VulnRadar. Check your connection and try again.",
    );
  });

  it("says when the request timed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("signal timed out", "TimeoutError");
      }),
    );
    const err = await api.version().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VulnRadarNetworkError);
    expect((err as VulnRadarNetworkError).timedOut).toBe(true);
    expect((err as Error).message).toMatch(/took too long/);
  });

  it("still reports an HTTP error as an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>bad gateway</html>", { status: 502 }),
      ),
    );
    const err = await api.version().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VulnRadarApiError);
    expect((err as VulnRadarApiError).status).toBe(502);
  });
});

describe("apiErrorFallback", () => {
  it("reads as a sentence rather than a status code", () => {
    expect(apiErrorFallback(502)).toBe(
      "VulnRadar had a problem answering (502). Try again in a moment.",
    );
    expect(apiErrorFallback(418)).toBe("VulnRadar refused the request (418).");
  });
});
