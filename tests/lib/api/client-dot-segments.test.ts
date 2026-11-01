/**
 * apiClient sends the signed-in user's cookies to whatever path it is given,
 * and the browser resolves dot segments before the request leaves, so
 * "/api/v3/history/../keys/5/revoke" is a request for /api/v3/keys/5/revoke
 * that the Origin-based CSRF check accepts. Its callers build paths from ids,
 * and one of them took its id from the address bar. A path that climbs out of
 * where it was built is refused here, before any request is made, so a caller
 * that forgets to validate an id cannot be pointed at another endpoint.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  apiClient,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ApiError,
} from "@/lib/api/client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, text: async () => "{}" });
});

describe("apiClient and a path with a dot segment", () => {
  it.each([
    "/api/v3/history/../keys/5/revoke",
    "/api/v3/history/../keys/5/revoke?/summary",
    "/api/v3/history/..",
    "/api/v3/history/./x",
    "/api/v3/history/%2e%2e/keys",
    "/api/v3/history/.%2E/keys",
    "/api/v3/history/%2E./keys",
    "/api/v3/history/..\\keys",
    "https://vulnradar.test/api/v3/history/../keys",
  ])("refuses %s without making the request", async (url) => {
    await expect(apiClient(url)).rejects.toBeInstanceOf(ApiError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses through every verb helper", async () => {
    const bad = "/api/v3/history/../keys/5/revoke";
    await expect(apiGet(bad)).rejects.toBeInstanceOf(ApiError);
    await expect(apiPost(bad)).rejects.toBeInstanceOf(ApiError);
    await expect(apiPatch(bad, {})).rejects.toBeInstanceOf(ApiError);
    await expect(apiDelete(bad)).rejects.toBeInstanceOf(ApiError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    "/api/v3/history/0123456789abcdef0123456789abcdef/summary",
    "/api/v3/history/..%2Fkeys/share",
    "/api/v3/history/a..b/x",
    "/api/v3/history/.well-known",
    "/api/v3/history/456/summary?next=../x",
    "/api/v3/history/456#../x",
  ])("still sends %s", async (url) => {
    await apiClient(url);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(url);
  });
});
