import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reset, storageData } from "./_polyfill-fake";
import { API_KEY, installFetch } from "./_helpers";

vi.mock("webextension-polyfill", async () => ({
  default: (await import("./_polyfill-fake")).fake,
}));

import { VulnRadarApiError, fetchReport } from "../src/lib/api";
import {
  addMutePattern,
  cacheReputation,
  checkReputation,
  clearSnooze,
  getCachedReputation,
  removeMutePattern,
  snoozeHost,
  unmuteHost,
} from "../src/lib/reputation";
import { SHOWN_SUPPRESS_MS, VULNRADAR } from "../src/lib/constants";
import type { ReputationResponse } from "../src/lib/types";

beforeEach(() => {
  reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const KNOWN_EXACT: ReputationResponse = {
  known: true,
  host: "example.com",
  dangerScore: 3,
  verdict: "safe",
  severityCounts: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
  lastScannedAt: "2026-10-01T00:00:00.000Z",
  scanId: 9,
  matchType: "exact",
  scannedUrl: "https://example.com/a",
};

describe("the Site Alerts lookup request", () => {
  it("sends the host and the address without query or fragment", async () => {
    const net = installFetch();
    const rep = await checkReputation(
      API_KEY,
      "example.com",
      "https://example.com/reset?token=SECRET123&x=1#access_token=ZZZ",
    );
    expect(rep).toMatchObject({ known: false });
    const [call] = net.reputation();
    expect(call!.url.searchParams.get("host")).toBe("example.com");
    expect(call!.url.searchParams.get("url")).toBe("https://example.com/reset");
    expect(call!.url.href).not.toMatch(/SECRET123|ZZZ|token|access_token/);
  });

  it("strips the address even when a caller forgets to", async () => {
    // api.reputation is the choke point: nothing above it has to be right.
    const net = installFetch();
    const { api } = await import("../src/lib/api");
    await api.reputation(
      API_KEY,
      "example.com",
      "https://user:pw@example.com/p?code=abc",
    );
    const [call] = net.reputation();
    expect(call!.url.searchParams.get("url")).toBe("https://example.com/p");
    expect(call!.url.href).not.toMatch(/user|pw|code=/);
  });

  it("omits url entirely when the address is not a public one", async () => {
    const net = installFetch();
    const { api } = await import("../src/lib/api");
    await api.reputation(API_KEY, "example.com", "http://localhost:3000/x");
    expect(net.reputation()[0]!.url.searchParams.has("url")).toBe(false);
  });

  it("makes no request at all for a host that is not public", async () => {
    const net = installFetch();
    for (const host of [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "192.168.1.5",
      "printer.local",
      "wiki.internal",
      "intranet",
      "site.test",
    ]) {
      expect(
        await checkReputation(API_KEY, host, `http://${host}/`),
        host,
      ).toBeNull();
    }
    expect(net.reputation()).toHaveLength(0);
  });
});

describe("the reputation cache", () => {
  it("files an exact-page result under the stripped address", async () => {
    await cacheReputation(
      "example.com",
      KNOWN_EXACT,
      Date.now(),
      "https://example.com/a",
    );
    const cache = storageData.reputationCache as Record<string, unknown>;
    expect(Object.keys(cache)).toEqual(["https://example.com/a"]);
    expect(
      await getCachedReputation("example.com", "https://example.com/a"),
    ).toMatchObject({ scanId: 9 });
    // A different page on the same host does not inherit it.
    expect(
      await getCachedReputation("example.com", "https://example.com/b"),
    ).toBeNull();
  });

  it("drops entries 0.2.2 filed under a full URL, query string and all", async () => {
    const now = Date.now();
    storageData.reputationCache = {
      "https://app.example.com/reset?token=SECRET": {
        data: KNOWN_EXACT,
        cachedAt: now,
      },
      "https://app.example.com/page#frag": { data: KNOWN_EXACT, cachedAt: now },
      "app.example.com": { data: KNOWN_EXACT, cachedAt: now },
    };
    await cacheReputation(
      "other.example",
      { ...KNOWN_EXACT, matchType: "host" },
      now,
    );
    const keys = Object.keys(storageData.reputationCache as object);
    expect(keys.sort()).toEqual(["app.example.com", "other.example"]);
    expect(JSON.stringify(storageData.reputationCache)).not.toContain("SECRET");
  });

  it("keeps an exact-page entry whose path contains an @", async () => {
    const now = Date.now();
    storageData.reputationCache = {
      "https://mastodon.social/@someone": { data: KNOWN_EXACT, cachedAt: now },
      "https://user:pass@legacy.example/page": {
        data: KNOWN_EXACT,
        cachedAt: now,
      },
    };
    await cacheReputation(
      "other.example",
      { ...KNOWN_EXACT, matchType: "host" },
      now,
    );
    expect(Object.keys(storageData.reputationCache as object).sort()).toEqual([
      "https://mastodon.social/@someone",
      "other.example",
    ]);
  });

  it("states the suppression window as hours", () => {
    expect(SHOWN_SUPPRESS_MS / 3_600_000).toBe(4);
  });
});

describe("the mute list", () => {
  it("adds a valid pattern, once", async () => {
    expect(await addMutePattern("https://example.com")).toBe("added");
    expect(await addMutePattern("https://example.com")).toBe("exists");
    expect(storageData.mutedPatterns).toEqual(["https://example.com"]);
  });

  it("refuses a pattern the matcher cannot honour or that is too long", async () => {
    for (const bad of [
      "",
      "example.com",
      "https://ex*ample.com",
      "https://example.com/foo/*",
      "ftp://example.com",
      `https://${"a".repeat(600)}.com`,
    ]) {
      expect(await addMutePattern(bad), bad.slice(0, 40)).toBe("invalid");
    }
    expect(storageData.mutedPatterns).toBeUndefined();
  });

  it("stops at the cap and says so", async () => {
    storageData.mutedPatterns = Array.from(
      { length: VULNRADAR.mutePatternLimit },
      (_, i) => `https://site${i}.example`,
    );
    expect(await addMutePattern("https://one-too-many.example")).toBe("full");
    expect(storageData.mutedPatterns as string[]).toHaveLength(
      VULNRADAR.mutePatternLimit,
    );
    // A pattern already on the list is still "exists", not "full".
    expect(await addMutePattern("https://site3.example")).toBe("exists");
  });

  it("keeps both of two additions made in the same tick", async () => {
    await Promise.all([
      addMutePattern("https://a.example"),
      addMutePattern("https://b.example"),
    ]);
    expect((storageData.mutedPatterns as string[]).sort()).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("removes a pattern, a legacy host mute and a snooze by key", async () => {
    storageData.mutedPatterns = ["https://a.example", "https://b.example"];
    storageData.mutedHosts = { "old.example": true, "older.example": true };
    storageData.snoozedHosts = {
      "s.example": Date.now() + 1000,
      "t.example": Date.now() + 1000,
    };
    await removeMutePattern("https://a.example");
    await unmuteHost("old.example");
    await clearSnooze("s.example");
    expect(storageData.mutedPatterns).toEqual(["https://b.example"]);
    expect(storageData.mutedHosts).toEqual({ "older.example": true });
    expect(Object.keys(storageData.snoozedHosts as object)).toEqual([
      "t.example",
    ]);
  });
});

describe("snoozing", () => {
  it("snoozes for a day and drops entries that already lapsed", async () => {
    const now = 1_800_000_000_000;
    storageData.snoozedHosts = {
      "gone.example": now - 1,
      "live.example": now + 5,
    };
    await snoozeHost("new.example", now);
    expect(storageData.snoozedHosts).toEqual({
      "live.example": now + 5,
      "new.example": now + 24 * 3_600_000,
    });
  });

  it("is capped, dropping the entries nearest to lapsing first", async () => {
    const now = 1_800_000_000_000;
    const full: Record<string, number> = {};
    for (let i = 0; i < VULNRADAR.snoozedHostLimit; i++) {
      full[`h${i}.example`] = now + 1000 + i;
    }
    storageData.snoozedHosts = full;
    await snoozeHost("fresh.example", now);
    const after = storageData.snoozedHosts as Record<string, number>;
    expect(Object.keys(after)).toHaveLength(VULNRADAR.snoozedHostLimit);
    expect(after["fresh.example"]).toBe(now + 24 * 3_600_000);
    // h0 expired soonest, so it is the one that went.
    expect(after["h0.example"]).toBeUndefined();
    expect(after[`h${VULNRADAR.snoozedHostLimit - 1}.example`]).toBeDefined();
  });
});

describe("fetchReport", () => {
  it("refuses an id that is not a positive safe integer, without a request", async () => {
    const net = installFetch();
    for (const id of [0, -3, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(fetchReport(API_KEY, id, "pdf"), String(id)).rejects.toThrow(
        /cannot be requested/,
      );
    }
    expect(net.calls).toHaveLength(0);
  });

  it("refuses a format outside the whitelist, without a request", async () => {
    const net = installFetch();
    for (const format of ["html", "pdf&x=1", "../etc", "PDF", ""]) {
      await expect(
        fetchReport(API_KEY, 5, format as never),
        format,
      ).rejects.toThrow(/cannot be requested/);
    }
    expect(net.calls).toHaveLength(0);
  });

  it("requests a valid report with the id and format it was given", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        calls.push(String(input));
        return new Response("%PDF", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }),
    );
    const out = await fetchReport(API_KEY, 42, "sarif");
    expect(out.contentType).toBe("application/pdf");
    expect(calls).toEqual([
      "https://vulnradar.dev/api/v3/history/42/report?format=sarif",
    ]);
  });

  it("still surfaces the server's own error for a valid request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Not yours" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(fetchReport(API_KEY, 42, "pdf")).rejects.toBeInstanceOf(
      VulnRadarApiError,
    );
  });
});
