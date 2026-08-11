/**
 * Tests for lib/api/client.ts's fetch wrapper -- specifically that apiPost
 * threads an AbortSignal through to the underlying fetch call, since that's
 * the plumbing the "Verify with AI" modal's close (X) button relies on to
 * actually cancel the in-flight request rather than just hiding the UI
 * while it keeps running in the background.
 *
 * Mocks global fetch, same pattern as tests/lib/scanner/cve-enrichment.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiClient, apiPost, ApiError } from "@/lib/api/client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function okResponse(body: unknown) {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
  };
}

describe("apiPost", () => {
  it("forwards a signal passed in options to the underlying fetch call", async () => {
    mockFetch.mockResolvedValue(okResponse({ ok: true }));
    const controller = new AbortController();

    await apiPost(
      "/api/v3/scan/verify",
      { scanHistoryId: 1 },
      {
        signal: controller.signal,
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });

  it("still works with no third argument (existing call sites)", async () => {
    mockFetch.mockResolvedValue(okResponse({ ok: true }));

    await apiPost("/api/v3/scan/verify", { scanHistoryId: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeUndefined();
  });

  it("rejects with an AbortError, not an ApiError, when the request is aborted", async () => {
    const controller = new AbortController();
    const abortError = new DOMException(
      "The user aborted a request.",
      "AbortError",
    );
    mockFetch.mockImplementation(() => Promise.reject(abortError));

    const promise = apiPost(
      "/api/v3/scan/verify",
      { scanHistoryId: 1 },
      {
        signal: controller.signal,
      },
    );

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await expect(promise).rejects.not.toBeInstanceOf(ApiError);
  });
});

describe("apiClient", () => {
  it("passes signal through when supplied directly", async () => {
    mockFetch.mockResolvedValue(okResponse({ ok: true }));
    const controller = new AbortController();

    await apiClient("/api/v3/scan/verify", { signal: controller.signal });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});
