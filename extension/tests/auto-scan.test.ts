import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reset, storageData } from "./_polyfill-fake";
import { installFetch, seedAuth } from "./_helpers";

vi.mock("webextension-polyfill", async () => ({
  default: (await import("./_polyfill-fake")).fake,
}));

import {
  canAutoScanNow,
  claimAutoScan,
  noteAutoScanRan,
  resetAutoScanClaims,
  runScan,
  shouldAutoScanPolicy,
} from "../src/lib/scan";
import { DEFAULT_SETTINGS } from "../src/lib/types";
import type { Settings } from "../src/lib/types";

const ON: Settings = { ...DEFAULT_SETTINGS, autoScan: "onPageLoad" };
const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

beforeEach(() => {
  reset();
  resetAutoScanClaims();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shouldAutoScanPolicy", () => {
  it("lets an ordinary public page through", () => {
    expect(shouldAutoScanPolicy("https://example.com/a?page=2", ON)).toBeNull();
  });

  it("is off when auto-scan is off or paused", () => {
    expect(
      shouldAutoScanPolicy("https://example.com/", DEFAULT_SETTINGS),
    ).toMatch(/off/i);
    expect(
      shouldAutoScanPolicy(
        "https://example.com/",
        { ...ON, pauseUntil: T0 + HOUR },
        T0,
      ),
    ).toMatch(/paused/i);
  });

  it("skips every address that is not a public host", () => {
    for (const url of [
      "http://localhost:3000/",
      "http://127.0.0.1/",
      "http://[::1]/",
      "https://192.168.0.1/admin",
      "https://printer.local/",
      "https://wiki.internal/",
      "https://nas.lan/",
      "https://app.test/",
      "https://router.home.arpa/",
      "https://intranet/",
      "not a url",
    ]) {
      expect(shouldAutoScanPolicy(url, ON), url).not.toBeNull();
    }
  });

  it("skips an address that carries a credential", () => {
    for (const url of [
      "https://example.com/reset?token=abc",
      "https://example.com/cb?code=abc&state=x",
      "https://example.com/?api_key=abc",
      "https://example.com/?secret=abc",
      "https://example.com/?sig=abc",
      "https://example.com/?otp=123456",
      "https://example.com/?reset=1",
      "https://example.com/?session=abc",
      "https://example.com/?access_token=abc",
      "https://example.com/?id_token=abc",
      "https://user:pw@example.com/",
    ]) {
      expect(shouldAutoScanPolicy(url, ON), url).toMatch(/credential/i);
    }
  });

  it("does not match the blacklist or whitelist on the fragment", () => {
    const blocked = { ...ON, blacklist: ["admin"] };
    expect(
      shouldAutoScanPolicy("https://example.com/home#admin", blocked),
    ).toBeNull();
    expect(shouldAutoScanPolicy("https://example.com/admin", blocked)).toMatch(
      /blacklist/,
    );
    const only = { ...ON, whitelist: ["staging"] };
    expect(shouldAutoScanPolicy("https://example.com/#staging", only)).toMatch(
      /whitelist/,
    );
  });

  it("matches the blacklist as a case-insensitive substring, not a pattern", () => {
    const s = { ...ON, blacklist: ["Internal.Corp"] };
    expect(
      shouldAutoScanPolicy("https://app.internal.corp.example/", s),
    ).toMatch(/blacklist/);
    // The old placeholder, "*.internal.corp", implied a wildcard that does not exist.
    const star = { ...ON, blacklist: ["*.internal.corp"] };
    expect(
      shouldAutoScanPolicy("https://app.internal.corp.example/", star),
    ).toBeNull();
  });
});

describe("claimAutoScan: the in-memory half of the throttle", () => {
  const settings = (over: Partial<Settings> = {}): Settings => ({
    ...ON,
    autoScanThrottleSeconds: 60,
    autoScanHostCooldownHours: 6,
    ...over,
  });

  it("grants the first claim and refuses the same host again", () => {
    expect(claimAutoScan("a.example", settings(), T0)).not.toBeNull();
    expect(claimAutoScan("a.example", settings(), T0 + 61_000)).toBeNull();
  });

  it("refuses a different host inside the global throttle", () => {
    expect(claimAutoScan("a.example", settings(), T0)).not.toBeNull();
    expect(claimAutoScan("b.example", settings(), T0 + 30_000)).toBeNull();
    expect(claimAutoScan("b.example", settings(), T0 + 61_000)).not.toBeNull();
  });

  it("lets the same host back in once its cooldown has passed", () => {
    claimAutoScan("a.example", settings(), T0);
    expect(claimAutoScan("a.example", settings(), T0 + 5 * HOUR)).toBeNull();
    expect(
      claimAutoScan("a.example", settings(), T0 + 6 * HOUR + 1),
    ).not.toBeNull();
  });

  it("hands the claim back on release", () => {
    const claim = claimAutoScan("a.example", settings(), T0)!;
    claim.release();
    expect(claimAutoScan("a.example", settings(), T0 + 1)).not.toBeNull();
  });

  it("a released claim restores the earlier one rather than erasing it", () => {
    claimAutoScan("a.example", settings({ autoScanThrottleSeconds: 0 }), T0);
    const second = claimAutoScan(
      "a.example",
      settings({ autoScanThrottleSeconds: 0, autoScanHostCooldownHours: 0 }),
      T0 + 10,
    )!;
    second.release();
    // The first scan of a.example at T0 still counts.
    expect(
      claimAutoScan(
        "a.example",
        settings({ autoScanThrottleSeconds: 0 }),
        T0 + 20,
      ),
    ).toBeNull();
  });

  it("zero turns each limit off", () => {
    const off = settings({
      autoScanThrottleSeconds: 0,
      autoScanHostCooldownHours: 0,
    });
    expect(claimAutoScan("a.example", off, T0)).not.toBeNull();
    expect(claimAutoScan("a.example", off, T0)).not.toBeNull();
    expect(claimAutoScan("b.example", off, T0)).not.toBeNull();
  });

  it("treats a restored session's burst of page loads as one scan", () => {
    // Twenty tabs finish loading in the same tick. Each handler would read the
    // same stale storage; the synchronous claim is what lets only one through.
    const granted = Array.from({ length: 20 }, (_, i) =>
      claimAutoScan(`site${i}.example`, settings(), T0),
    ).filter(Boolean);
    expect(granted).toHaveLength(1);
  });

  it("clamps a cooldown hand-edited past the day the history is kept for", () => {
    claimAutoScan(
      "a.example",
      settings({ autoScanHostCooldownHours: 9999 }),
      T0,
    );
    expect(
      claimAutoScan(
        "a.example",
        settings({ autoScanHostCooldownHours: 9999 }),
        T0 + 24 * HOUR + 1,
      ),
    ).not.toBeNull();
  });
});

describe("canAutoScanNow and noteAutoScanRan: the persisted half", () => {
  const s = {
    ...ON,
    autoScanThrottleSeconds: 60,
    autoScanHostCooldownHours: 6,
  };

  it("allows a first scan", async () => {
    expect(await canAutoScanNow("a.example", s, T0)).toBe(true);
  });

  it("holds a host for its cooldown and other hosts for the global throttle", async () => {
    await noteAutoScanRan("a.example", T0);
    expect(await canAutoScanNow("a.example", s, T0 + 5 * HOUR)).toBe(false);
    expect(await canAutoScanNow("b.example", s, T0 + 30_000)).toBe(false);
    expect(await canAutoScanNow("b.example", s, T0 + 61_000)).toBe(true);
    expect(await canAutoScanNow("a.example", s, T0 + 6 * HOUR)).toBe(true);
  });

  it("is keyed by hostname, so another page on the same host is held too", async () => {
    await noteAutoScanRan("a.example", T0);
    expect(await canAutoScanNow("a.example", s, T0 + 2 * HOUR)).toBe(false);
  });

  it("prunes hosts older than a day when it writes", async () => {
    await noteAutoScanRan("old.example", T0);
    await noteAutoScanRan("new.example", T0 + 25 * HOUR);
    expect(Object.keys(storageData.autoScannedAt as object)).toEqual([
      "new.example",
    ]);
  });

  it("stamps the global time as well", async () => {
    await noteAutoScanRan("a.example", T0);
    expect(storageData.lastAutoScanAt).toBe(T0);
  });
});

describe("runScan: what an unattended scan may ask for", () => {
  const everything: Settings = {
    ...ON,
    portScan: true,
    families: { ...DEFAULT_SETTINGS.families, "active-probes": true },
  };

  async function bodyOf(unattended: boolean) {
    seedAuth();
    const net = installFetch();
    await runScan({
      url: "https://example.com/a",
      settings: everything,
      ...(unattended ? { unattended: true } : {}),
    });
    return net.scans()[0]!.body as {
      url: string;
      scanners: string[];
      portScan?: boolean;
    };
  }

  it("never sends active probing or the port sweep", async () => {
    const body = await bodyOf(true);
    expect(body.scanners).not.toContain("active-probes");
    expect(body.scanners.length).toBeGreaterThan(10);
    expect("portScan" in body).toBe(false);
  });

  it("still sends them for a scan the user started", async () => {
    const body = await bodyOf(false);
    expect(body.scanners).toContain("active-probes");
    expect(body.portScan).toBe(true);
  });

  it("refuses rather than run a full scan when only active probing was ticked", async () => {
    seedAuth();
    installFetch();
    const onlyProbes: Settings = {
      ...ON,
      families: Object.fromEntries(
        Object.keys(DEFAULT_SETTINGS.families).map((k) => [
          k,
          k === "active-probes",
        ]),
      ) as Settings["families"],
    };
    await expect(
      runScan({
        url: "https://example.com/",
        settings: onlyProbes,
        unattended: true,
      }),
    ).rejects.toThrow(/No check families/);
  });
});
