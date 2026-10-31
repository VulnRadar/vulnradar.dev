import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  fetchAiInfo,
  isAiAvailable,
  clearAiInfoCache,
} from "@/components/shared/ai-info";
import { API } from "@/lib/config/client-constants";

/**
 * The chat widget (root layout, so every page), the dashboard page and the
 * scan actions menu each asked /ai/info for the same payload, so opening the
 * dashboard issued two or three identical requests in its first second. These
 * assert the collapse holds and, just as importantly, that it does not
 * over-collapse: the payload carries the signed-in user's own opt-out, so one
 * viewer's answer must never be served to another.
 */

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const INFO = { configured: true, model: "m", provider: "p", aiDisabled: false };

describe("fetchAiInfo", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearAiInfoCache();
    fetchMock = vi.fn(async () => okJson(INFO));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearAiInfoCache();
  });

  it("asks the info route", async () => {
    await fetchAiInfo(7);
    expect(String(fetchMock.mock.calls[0][0])).toBe(API.AI_INFO);
  });

  it("issues one request for concurrent callers asking as the same viewer", async () => {
    const [a, b, c] = await Promise.all([
      fetchAiInfo(7),
      fetchAiInfo(7),
      fetchAiInfo(7),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(INFO);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("serves a later caller from the cache", async () => {
    await fetchAiInfo(7);
    await fetchAiInfo(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never hands one viewer's answer to another", async () => {
    // The anonymous answer says AI is on; user 7 has switched it off.
    fetchMock.mockImplementationOnce(async () => okJson(INFO));
    fetchMock.mockImplementationOnce(async () =>
      okJson({ ...INFO, aiDisabled: true }),
    );
    const anonymous = await fetchAiInfo(null);
    const signedIn = await fetchAiInfo(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isAiAvailable(anonymous)).toBe(true);
    expect(isAiAvailable(signedIn)).toBe(false);
  });

  it("does not share an in-flight request across viewers", async () => {
    await Promise.all([fetchAiInfo(null), fetchAiInfo(7)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches when the caller forces it", async () => {
    await fetchAiInfo(7);
    await fetchAiInfo(7, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches once the short window has passed, so a changed opt-out is seen", async () => {
    vi.useFakeTimers();
    await fetchAiInfo(7);
    vi.advanceTimersByTime(9_000);
    await fetchAiInfo(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await fetchAiInfo(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed request", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response("nope", { status: 500 }),
    );
    await expect(fetchAiInfo(7)).rejects.toThrow();
    await fetchAiInfo(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("isAiAvailable", () => {
  it("needs a configured provider and no personal opt-out", () => {
    expect(isAiAvailable({ ...INFO })).toBe(true);
    expect(isAiAvailable({ ...INFO, configured: false })).toBe(false);
    expect(isAiAvailable({ ...INFO, aiDisabled: true })).toBe(false);
    expect(isAiAvailable({ configured: true, model: "m", provider: "p" })).toBe(
      true,
    );
  });
});

describe("the three callers", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it.each([
    "components/ai-chat/chat-widget.tsx",
    "app/dashboard/page.tsx",
    "components/scanner/scan-actions-menu.tsx",
  ])("%s shares the request instead of making its own", (file) => {
    const src = read(file);
    expect(src).toContain("fetchAiInfo(");
    expect(src).not.toContain("fetch(API.AI_INFO)");
  });
});
