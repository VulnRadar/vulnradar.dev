/**
 * The /auth/me fetcher behind useAuth().
 *
 * Only a 401 means nobody is signed in. Anything else that is not a 2xx is a
 * failed read, and a failed read has to throw: SWR then keeps the last good
 * `me`, the effect in AuthProvider never runs against a user-less object, and
 * vr_auth_cache plus the data-vr-auth attributes survive a rate limit or a
 * deploy blip. The fetcher used to hand every JSON body to SWR as the user, so
 * a 429 or the maintenance 503 read as "signed out" and flipped the shell to
 * the logged-out chrome until the next five-minute revalidation.
 *
 * The provider is a React component and the suite has no DOM, so the SWR half
 * of the contract (previous data survives a rejected fetcher) is SWR's own and
 * is pinned here at the boundary the app controls: what the fetcher returns or
 * throws for each status, and the options it is mounted with.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  authFetcher,
  AUTH_SWR_OPTIONS,
} from "@/components/providers/auth-provider";
import { computeAuthPresence } from "@/lib/auth/auth-presence";
import { API } from "@/lib/config/client-constants";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ME = { userId: 7, role: "user", email: "a@example.com" };

function stubFetch(response: () => Response | Promise<Response>) {
  const mock = vi.fn(async () => response());
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authFetcher", () => {
  it("returns the user on a 200", async () => {
    const fetchMock = stubFetch(() => json(200, ME));
    await expect(authFetcher(API.AUTH.ME)).resolves.toEqual(ME);
    expect(fetchMock).toHaveBeenCalledWith(API.AUTH.ME);
  });

  it("turns a 401 into null, which is the signed-out answer", async () => {
    stubFetch(() => json(401, { error: "Authentication required" }));
    const me = await authFetcher(API.AUTH.ME);
    expect(me).toBeNull();
    expect(computeAuthPresence(me)).toEqual({
      cache: null,
      auth: false,
      staff: false,
    });
  });

  it.each([
    [429, { error: "Too many requests" }],
    [502, { error: "Bad gateway" }],
    [503, { error: "Down for maintenance", paused: true }],
    [500, { error: "Failed" }],
    [403, { error: "CSRF" }],
  ])("throws on a %i, so the previous user is kept", async (status, body) => {
    stubFetch(() => json(status, body));
    await expect(authFetcher(API.AUTH.ME)).rejects.toThrow(String(status));
  });

  it("throws on an HTML error page instead of reading it as a user", async () => {
    stubFetch(
      () =>
        new Response("<html><body>Bad gateway</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
    );
    await expect(authFetcher(API.AUTH.ME)).rejects.toThrow();
  });

  it("throws on a 200 that is not JSON, such as a captive portal page", async () => {
    stubFetch(
      () => new Response("<html>sign in to wifi</html>", { status: 200 }),
    );
    await expect(authFetcher(API.AUTH.ME)).rejects.toThrow();
  });

  it("lets a network failure reject", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(authFetcher(API.AUTH.ME)).rejects.toThrow("Failed to fetch");
  });

  it("never turns a failed read into a body the effect would call signed out", async () => {
    // The old behaviour, written out: the 429 body parsed as `me` has no
    // userId, so computeAuthPresence clears the cache. The fetcher must not
    // let that value out for any non-401 failure.
    expect(
      computeAuthPresence({ error: "Too many requests" } as never),
    ).toEqual({ cache: null, auth: false, staff: false });
    for (const status of [429, 502, 503]) {
      stubFetch(() => json(status, { error: "transient" }));
      await expect(authFetcher(API.AUTH.ME)).rejects.toBeInstanceOf(Error);
    }
  });
});

describe("AUTH_SWR_OPTIONS", () => {
  it("caps error retries at three", () => {
    expect(AUTH_SWR_OPTIONS.errorRetryCount).toBe(3);
  });

  it("keeps the previous data and does not refetch on focus or reconnect", () => {
    expect(AUTH_SWR_OPTIONS.keepPreviousData).toBe(true);
    expect(AUTH_SWR_OPTIONS.revalidateOnFocus).toBe(false);
    expect(AUTH_SWR_OPTIONS.revalidateOnReconnect).toBe(false);
  });

  it("dedupes for five minutes, as the cache comments say", () => {
    expect(AUTH_SWR_OPTIONS.dedupingInterval).toBe(5 * 60 * 1000);
  });
});
