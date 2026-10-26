import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fake,
  removeApis,
  reset,
  setCalls,
  storageData,
} from "./_polyfill-fake";
import {
  POPUP,
  contentSender,
  deliver,
  installFetch,
  seedAuth,
  settle,
} from "./_helpers";

vi.mock("webextension-polyfill", async () => ({
  default: (await import("./_polyfill-fake")).fake,
}));

import { DEFAULT_SETTINGS } from "../src/lib/types";

/**
 * The background service worker end to end, over the in-memory polyfill and a
 * stubbed fetch: the router's trust boundary, what a page load sends away, the
 * scan the card is allowed to start, and what auto-scan will and will not do.
 * The worker registers its listeners when the module loads, so every test
 * loads a fresh copy.
 */

type Router = (
  msg: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown;

async function boot(): Promise<Router> {
  vi.resetModules();
  await import("../src/background/service-worker");
  const router = fake.runtime.onMessage.listeners[0] as Router | undefined;
  expect(
    router,
    "service worker did not register a message listener",
  ).toBeTruthy();
  return router!;
}

beforeEach(() => {
  reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentToTab(kind: string) {
  return fake.tabs.sendMessage.mock.calls
    .map(
      ([, payload]) => payload as { kind: string; url?: string; host?: string },
    )
    .filter((p) => p.kind === kind);
}

describe("the router refuses what the sender may not send", () => {
  it("ignores scan:url and report:export from a web page's content script", async () => {
    seedAuth();
    const net = installFetch();
    const router = await boot();
    const page = contentSender("https://evil.example/");

    expect(
      await deliver(
        router,
        { kind: "scan:url", url: "https://victim.example/" },
        page,
      ),
    ).toBeUndefined();
    expect(
      await deliver(
        router,
        { kind: "report:export", id: 1, format: "pdf", host: "x" },
        page,
      ),
    ).toBeUndefined();

    expect(net.scans()).toHaveLength(0);
    expect(net.to("/api/v3/history/1/report")).toHaveLength(0);
    expect(fake.downloads.download).not.toHaveBeenCalled();
    expect(storageData.scanInProgress ?? null).toBeNull();
  });

  it("ignores page:loaded and reputation:* from the popup and from no sender", async () => {
    seedAuth();
    const net = installFetch();
    const router = await boot();

    for (const sender of [POPUP, {}]) {
      for (const message of [
        { kind: "page:loaded" },
        { kind: "reputation:scan" },
        { kind: "reputation:mute-global" },
        { kind: "reputation:mute-site", pattern: "https://example.com" },
        { kind: "reputation:snooze-site", host: "example.com" },
      ]) {
        expect(await deliver(router, message, sender)).toBeUndefined();
      }
    }
    expect(
      net.calls.filter((c) => c.url.pathname !== "/api/v3/auth/me"),
    ).toHaveLength(0);
    expect(storageData.settings ?? null).toBeNull();
    expect(storageData.mutedPatterns ?? null).toBeNull();
    expect(storageData.snoozedHosts ?? null).toBeNull();
  });

  it("answers an unknown kind with nothing, so the sender is not left waiting", async () => {
    const router = await boot();
    expect(await deliver(router, { kind: "nope" }, POPUP)).toBeUndefined();
    expect(await deliver(router, "scan:url", POPUP)).toBeUndefined();
  });

  it("starts a scan for the popup and records it", async () => {
    seedAuth();
    const net = installFetch();
    const router = await boot();
    const out = (await deliver(
      router,
      { kind: "scan:url", url: "https://example.com/page?q=1" },
      POPUP,
    )) as { ok: boolean };
    expect(out.ok).toBe(true);
    // A manual scan sends the address you asked for, query and all.
    expect(net.scans()[0]!.body).toMatchObject({
      url: "https://example.com/page?q=1",
    });
    expect(storageData.lastScanCompletion).toBeTruthy();
  });

  it("rejects a non-http address from the popup with a plain message", async () => {
    seedAuth();
    const net = installFetch();
    const router = await boot();
    const out = (await deliver(
      router,
      { kind: "scan:url", url: "chrome://settings" },
      POPUP,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/http or https/);
    expect(net.scans()).toHaveLength(0);
  });

  it("refuses a malformed report request even from the popup", async () => {
    seedAuth();
    const net = installFetch();
    const router = await boot();
    for (const message of [
      { kind: "report:export", id: "../../auth/me", format: "pdf", host: "x" },
      { kind: "report:export", id: 0, format: "pdf", host: "x" },
      { kind: "report:export", id: 4, format: "html", host: "x" },
    ]) {
      expect(await deliver(router, message, POPUP)).toBeUndefined();
    }
    expect(fake.downloads.download).not.toHaveBeenCalled();
    expect(net.calls.some((c) => c.url.pathname.includes("report"))).toBe(
      false,
    );
  });
});

describe("the card's mute actions", () => {
  it("turns both alerts off by rewriting the settings key and nothing else", async () => {
    seedAuth();
    storageData.lastAutoScanAt = 4242;
    storageData.historyCache = [{ id: "keep" }];
    storageData.settings = { ...DEFAULT_SETTINGS, theme: "dark" };
    installFetch();
    const router = await boot();
    await settle();
    setCalls.length = 0;

    const out = await deliver(
      router,
      { kind: "reputation:mute-global" },
      contentSender("https://example.com/"),
    );

    expect(out).toEqual({ ok: true });
    expect(storageData.settings).toMatchObject({
      showScanResults: false,
      showScanPrompts: false,
      theme: "dark",
    });
    expect(setCalls).toEqual([["settings"]]);
    expect(storageData.lastAutoScanAt).toBe(4242);
    expect(storageData.historyCache).toEqual([{ id: "keep" }]);
    expect(storageData.auth).toBeTruthy();
  });

  it("mutes the tab's own origin and nothing wider", async () => {
    const router = await boot();
    const page = contentSender("https://shop.example.com/cart?x=1");
    expect(
      await deliver(
        router,
        { kind: "reputation:mute-site", pattern: "https://shop.example.com" },
        page,
      ),
    ).toEqual({ ok: true });
    expect(storageData.mutedPatterns).toEqual(["https://shop.example.com"]);

    for (const pattern of [
      "https://*.example.com",
      "https://*.com",
      "https://other.example",
    ]) {
      expect(
        await deliver(router, { kind: "reputation:mute-site", pattern }, page),
      ).toBeUndefined();
    }
    expect(storageData.mutedPatterns).toEqual(["https://shop.example.com"]);
  });

  it("snoozes the tab's own host only", async () => {
    const router = await boot();
    const page = contentSender("https://shop.example.com/cart");
    await deliver(
      router,
      { kind: "reputation:snooze-site", host: "shop.example.com" },
      page,
    );
    expect(Object.keys(storageData.snoozedHosts as object)).toEqual([
      "shop.example.com",
    ]);
    expect(
      await deliver(
        router,
        { kind: "reputation:snooze-site", host: "other.example" },
        page,
      ),
    ).toBeUndefined();
  });
});

describe("Site Alerts: what a page load sends", () => {
  async function load(
    url: string,
    options: { incognito?: boolean; tabId?: number } = {},
  ) {
    const net = installFetch();
    seedAuth();
    const router = await boot();
    await settle();
    net.calls.length = 0;
    await deliver(router, { kind: "page:loaded" }, contentSender(url, options));
    return { net, router };
  }

  it("sends the host and the address without query or fragment", async () => {
    const { net } = await load(
      "https://app.example.com/reset-password?token=SECRET123&email=a%40b.c#access_token=ZZZ",
    );
    const [lookup] = net.reputation();
    expect(lookup).toBeTruthy();
    expect(lookup!.url.searchParams.get("host")).toBe("app.example.com");
    expect(lookup!.url.searchParams.get("url")).toBe(
      "https://app.example.com/reset-password",
    );
    expect(lookup!.url.href).not.toMatch(/SECRET123|ZZZ|token|email/);
  });

  it("keeps the query out of everything it stores and everything it tells the tab", async () => {
    await load("https://app.example.com/reset?token=SECRET123");
    expect(JSON.stringify(storageData)).not.toContain("SECRET123");
    expect(JSON.stringify(fake.tabs.sendMessage.mock.calls)).not.toContain(
      "SECRET123",
    );
    const [card] = sentToTab("reputation:unknown");
    expect(card).toMatchObject({
      url: "https://app.example.com/reset",
      host: "app.example.com",
    });
  });

  it("makes no request and shows no card for a private address", async () => {
    for (const url of [
      "http://localhost:3000/dashboard",
      "http://127.0.0.1:8080/",
      "http://[::1]/",
      "https://192.168.1.1/admin",
      "https://printer.local/",
      "https://wiki.internal/page",
      "http://nas.lan/",
      "https://app.test/",
      "https://router.home.arpa/",
      "https://intranet/",
    ]) {
      reset();
      const { net } = await load(url);
      expect(net.reputation(), url).toHaveLength(0);
      expect(sentToTab("reputation:unknown"), url).toHaveLength(0);
      expect(sentToTab("reputation:known"), url).toHaveLength(0);
    }
  });

  it("does nothing in a private window", async () => {
    const { net } = await load("https://example.com/page", { incognito: true });
    expect(net.reputation()).toHaveLength(0);
    expect(fake.tabs.sendMessage).not.toHaveBeenCalled();
    expect(storageData.reputationThrottleMap ?? null).toBeNull();
  });

  it("shows the unknown card for an ordinary public page and records the offer", async () => {
    await load("https://example.com/page?q=1", { tabId: 11 });
    expect(sentToTab("reputation:unknown")).toHaveLength(1);
    expect(storageData.offeredScans).toMatchObject({
      "11": { host: "example.com", url: "https://example.com/page" },
    });
  });
});

describe("the scan the card offers", () => {
  async function offered(url: string, tabId = 7) {
    const net = installFetch();
    seedAuth();
    const router = await boot();
    await settle();
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender(url, { tabId }),
    );
    net.calls.length = 0;
    return { net, router };
  }

  it("scans the address the worker recorded, not one the page sends", async () => {
    const { net, router } = await offered(
      "https://example.com/page?token=SECRET",
    );
    const out = (await deliver(
      router,
      { kind: "reputation:scan", url: "https://victim.example/internal" },
      contentSender("https://example.com/page?token=SECRET"),
    )) as { ok: boolean };

    expect(out.ok).toBe(true);
    expect(net.scans()).toHaveLength(1);
    expect(net.scans()[0]!.body).toMatchObject({
      url: "https://example.com/page",
    });
    expect(JSON.stringify(net.calls)).not.toMatch(/victim\.example|SECRET/);
  });

  it("refuses when nothing was offered in that tab", async () => {
    const { net, router } = await offered("https://example.com/page", 7);
    const out = (await deliver(
      router,
      { kind: "reputation:scan" },
      contentSender("https://example.com/page", { tabId: 99 }),
    )) as { ok: boolean; refused: boolean; error: string };
    expect(out).toMatchObject({ ok: false, refused: true });
    expect(out.error).toMatch(/expired/);
    expect(net.scans()).toHaveLength(0);
  });

  it("refuses once the tab has moved to another host", async () => {
    const { net, router } = await offered("https://example.com/page", 7);
    const out = await deliver(
      router,
      { kind: "reputation:scan" },
      contentSender("https://elsewhere.example/", { tabId: 7 }),
    );
    expect(out).toMatchObject({ ok: false, refused: true });
    expect(net.scans()).toHaveLength(0);
  });

  it("refuses an offer that has outlived its window", async () => {
    const { net, router } = await offered("https://example.com/page", 7);
    const offers = storageData.offeredScans as Record<
      string,
      { offeredAt: number }
    >;
    offers["7"]!.offeredAt = Date.now() - 31 * 60 * 1000;
    const out = await deliver(
      router,
      { kind: "reputation:scan" },
      contentSender("https://example.com/page"),
    );
    expect(out).toMatchObject({ ok: false, refused: true });
    expect(net.scans()).toHaveLength(0);
  });

  it("runs one card scan per tab at a time", async () => {
    const { net, router } = await offered("https://example.com/page");
    const sender = contentSender("https://example.com/page");
    const [a, b] = (await Promise.all([
      deliver(router, { kind: "reputation:scan" }, sender),
      deliver(router, { kind: "reputation:scan" }, sender),
    ])) as { ok: boolean; refused?: boolean; error?: string }[];
    expect([a!.ok, b!.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r!.ok)!.error).toMatch(/already running/);
    expect(net.scans()).toHaveLength(1);
  });

  it("lets Try again follow a failed scan", async () => {
    const { net, router } = await offered("https://example.com/page");
    const sender = contentSender("https://example.com/page");
    await deliver(router, { kind: "reputation:scan" }, sender);
    await deliver(router, { kind: "reputation:scan" }, sender);
    expect(net.scans()).toHaveLength(2);
  });
});

describe("auto-scan", () => {
  async function bootAuto(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
    storageData.settings = {
      ...DEFAULT_SETTINGS,
      autoScan: "onPageLoad",
      showScanPrompts: false,
      showScanResults: false,
      ...settings,
    };
    const net = installFetch();
    seedAuth();
    const router = await boot();
    await settle();
    net.calls.length = 0;
    return { net, router };
  }

  it("scans a public page, without its fragment", async () => {
    const { net, router } = await bootAuto();
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/docs?page=2#section-3"),
    );
    expect(net.scans()).toHaveLength(1);
    expect(net.scans()[0]!.body).toMatchObject({
      url: "https://example.com/docs?page=2",
    });
  });

  it("never sends active probing or the port sweep, whatever the settings say", async () => {
    const { net, router } = await bootAuto({
      portScan: true,
      families: { ...DEFAULT_SETTINGS.families, "active-probes": true },
    });
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/"),
    );
    const body = net.scans()[0]!.body as {
      scanners: string[];
      portScan?: boolean;
    };
    expect(body.scanners).not.toContain("active-probes");
    expect("portScan" in body).toBe(false);
  });

  it("skips private addresses, private windows and credential-bearing URLs", async () => {
    const { net, router } = await bootAuto();
    for (const url of [
      "http://localhost:3000/",
      "https://192.168.1.1/",
      "https://wiki.internal/",
      "https://example.com/cb?code=abc",
      "https://example.com/?access_token=abc",
    ]) {
      await deliver(router, { kind: "page:loaded" }, contentSender(url));
    }
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/", { incognito: true }),
    );
    expect(net.scans()).toHaveLength(0);
  });

  it("does not scan the same host twice inside the cooldown", async () => {
    const { net, router } = await bootAuto({ autoScanThrottleSeconds: 0 });
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/a"),
    );
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/b"),
    );
    expect(net.scans()).toHaveLength(1);
    // Another host is fine, with the global throttle out of the way.
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://other.example/"),
    );
    expect(net.scans()).toHaveLength(2);
  });

  it("scans a host again once its cooldown has been switched off", async () => {
    const { net, router } = await bootAuto({
      autoScanThrottleSeconds: 0,
      autoScanHostCooldownHours: 0,
    });
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/a"),
    );
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/b"),
    );
    expect(net.scans()).toHaveLength(2);
  });

  it("claims synchronously, so a burst of page loads starts one scan", async () => {
    const { net, router } = await bootAuto();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        deliver(
          router,
          { kind: "page:loaded" },
          contentSender(`https://site${i}.example/`, { tabId: 100 + i }),
        ),
      ),
    );
    expect(net.scans()).toHaveLength(1);
  });

  it("starts at most one scan when the same host loads in two tabs at once", async () => {
    const { net, router } = await bootAuto({ autoScanThrottleSeconds: 0 });
    await Promise.all([
      deliver(
        router,
        { kind: "page:loaded" },
        contentSender("https://example.com/", { tabId: 1 }),
      ),
      deliver(
        router,
        { kind: "page:loaded" },
        contentSender("https://example.com/x", { tabId: 2 }),
      ),
    ]);
    expect(net.scans()).toHaveLength(1);
  });

  it("releases its claim when the persisted check says no", async () => {
    const { net, router } = await bootAuto();
    storageData.lastAutoScanAt = Date.now() - 5_000;
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/"),
    );
    expect(net.scans()).toHaveLength(0);
    // The throttle lapses; the refused attempt did not leave a claim behind.
    storageData.lastAutoScanAt = Date.now() - 120_000;
    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/"),
    );
    expect(net.scans()).toHaveLength(1);
  });
});

describe("Firefox for Android and a notifications API that fails", () => {
  const notifying = {
    ...DEFAULT_SETTINGS,
    autoScan: "onPageLoad",
    showScanPrompts: false,
    showScanResults: false,
    notifyThreshold: "all",
  };

  it("loads, routes messages and finishes a scan with no contextMenus or notifications", async () => {
    removeApis("contextMenus", "notifications");
    storageData.settings = notifying;
    const net = installFetch({ findings: true });
    seedAuth();
    const router = await boot();
    await settle();

    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/"),
    );
    expect(net.scans()).toHaveLength(1);
    // The result still reached the tab and the toolbar badge, past the point
    // where a desktop notification would have been raised.
    expect(sentToTab("scan:complete")).toHaveLength(1);
    expect(fake.action.setBadgeText).toHaveBeenCalledWith({
      text: "6",
      tabId: 7,
    });
  });

  it("survives a notifications API that rejects", async () => {
    storageData.settings = notifying;
    installFetch({ findings: true });
    seedAuth();
    const router = await boot();
    await settle();
    fake.notifications.create.mockRejectedValueOnce(new Error("blocked"));

    await deliver(
      router,
      { kind: "page:loaded" },
      contentSender("https://example.com/"),
    );

    expect(fake.notifications.create).toHaveBeenCalledTimes(1);
    expect(sentToTab("scan:complete")).toHaveLength(1);
    expect(sentToTab("scan:error")).toHaveLength(0);
  });
});
