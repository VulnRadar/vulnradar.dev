import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  fetchActiveNotifications,
  clearActiveNotificationsCache,
} from "@/components/shared/active-notifications";

/**
 * The notification bell and the site-notification banner are both mounted in
 * the root layout and both want /api/v3/notifications/active with the same two
 * audience params, so every page view issued two identical requests. These
 * assert the collapse holds, and, just as importantly, that it does not
 * over-collapse: a different audience is a different payload, and the bell's
 * poll timer must still be able to force a real refresh.
 */

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("fetchActiveNotifications", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearActiveNotificationsCache();
    fetchMock = vi.fn(async () =>
      okJson([{ type: "bell" }, { type: "banner" }]),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearActiveNotificationsCache();
  });

  it("issues one request for two concurrent callers with the same audience", async () => {
    const [a, b] = await Promise.all([
      fetchActiveNotifications(true, false),
      fetchActiveNotifications(true, false),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("serves the second, later caller from cache", async () => {
    await fetchActiveNotifications(true, false);
    await fetchActiveNotifications(true, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the audience params the server filters on", async () => {
    await fetchActiveNotifications(true, true);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("authenticated=true");
    expect(url).toContain("staff=true");
  });

  it("refetches when the audience changes, since the payload differs", async () => {
    await fetchActiveNotifications(false, false);
    await fetchActiveNotifications(true, false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches when the caller forces it, so the poll timer still polls", async () => {
    await fetchActiveNotifications(true, false);
    await fetchActiveNotifications(true, false, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed request", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response("nope", { status: 500 }),
    );
    await expect(fetchActiveNotifications(true, false)).rejects.toThrow();
    await fetchActiveNotifications(true, false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tolerates the { notifications: [...] } body shape", async () => {
    fetchMock.mockImplementationOnce(async () =>
      okJson({ notifications: [{ type: "bell" }] }),
    );
    const list = await fetchActiveNotifications(true, false);
    expect(list).toEqual([{ type: "bell" }]);
  });
});
