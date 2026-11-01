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

  // The URL parser drops a tab, LF or CR anywhere and C0 controls or spaces at
  // either end before it looks at segments, so these resolve to the same
  // /api/v3/keys/5/revoke (or /api/v3/) as the plain spellings above. Built
  // from char codes so the test source carries no raw control characters.
  const TAB = String.fromCharCode(9);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const NUL = String.fromCharCode(0);
  it.each([
    ["a tab inside ..", `/api/v3/history/.${TAB}./keys/5/revoke`],
    ["a newline inside ..", `/api/v3/history/.${LF}./keys/5/revoke`],
    ["a CR after ..", `/api/v3/history/..${CR}/keys/5/revoke`],
    ["a tab inside %2e", `/api/v3/history/%2${TAB}e%2e/keys`],
    ["a trailing space", "/api/v3/history/.. "],
    ["a trailing NUL", `/api/v3/history/..${NUL}`],
    ["leading spaces", "  ../keys/5/revoke"],
    ["a leading NUL", `${NUL}../keys/5/revoke`],
  ])(
    "refuses a dot segment the parser only sees after cleanup (%s)",
    async (_label, url) => {
      expect(new URL(url, "https://vulnradar.test/history").pathname).toMatch(
        /^\/(?:api\/v3\/)?(?:keys(?:\/5\/revoke)?)?$/,
      );
      await expect(apiClient(url)).rejects.toBeInstanceOf(ApiError);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

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
