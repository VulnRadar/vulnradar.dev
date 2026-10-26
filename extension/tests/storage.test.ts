import { beforeEach, describe, expect, it, vi } from "vitest";

import { fake, reset, setCalls, storageData } from "./_polyfill-fake";

vi.mock("webextension-polyfill", async () => ({
  default: (await import("./_polyfill-fake")).fake,
}));

import {
  DEFAULT,
  DERIVED_CACHE_KEYS,
  STORAGE_SCHEMA_VERSION,
  loadAll,
  normalizeSettings,
  patchSettings,
  update,
} from "../src/lib/storage";
import { DEFAULT_SETTINGS } from "../src/lib/types";

/**
 * loadAll used to answer a stored schemaVersion below the current one by
 * clearing ALL of storage, which signs the user out and throws away their
 * settings and mute lists. The next bump of STORAGE_SCHEMA_VERSION would have
 * done that to everyone who had configured the extension. A schema bump now
 * removes only what can be rebuilt.
 */

beforeEach(() => {
  reset();
});

const OLD = STORAGE_SCHEMA_VERSION - 1;

function seedUserState() {
  storageData.auth = {
    apiKey: `vr_live_${"b".repeat(64)}`,
    me: { email: "dev@example.com" },
  };
  storageData.settings = { ...DEFAULT_SETTINGS, autoScan: "onPageLoad" };
  storageData.mutedHosts = { "old.example": true };
  storageData.mutedPatterns = ["https://muted.example"];
  storageData.snoozedHosts = { "snoozed.example": 4_102_444_800_000 };
}

function seedDerivedCaches() {
  storageData.historyCache = [{ id: "x" }];
  storageData.historyFetchedAt = 123;
  storageData.lastResult = { url: "https://example.com/" };
  storageData.lastScanCompletion = { url: "https://example.com/" };
  storageData.reputationCache = { "example.com": { cachedAt: 1 } };
  storageData.reputationThrottleMap = { "example.com": 1 };
  storageData.lastShownReputation = { "example.com": { shownAt: 1 } };
  storageData.rateLimitInfo = { remaining: 3, limit: 25, resetsAt: null };
  storageData.autoScannedAt = { "example.com": 1 };
  storageData.offeredScans = { "7": { host: "example.com" } };
}

describe("loadAll after a schema bump", () => {
  it("removes the derived caches and keeps everything the user owns", async () => {
    seedUserState();
    seedDerivedCaches();
    storageData.schemaVersion = OLD;

    const loaded = await loadAll();

    for (const key of DERIVED_CACHE_KEYS) {
      expect(key in storageData, `${key} should be gone`).toBe(false);
    }
    expect(storageData.auth).toBeTruthy();
    expect(storageData.settings).toMatchObject({ autoScan: "onPageLoad" });
    expect(storageData.mutedHosts).toEqual({ "old.example": true });
    expect(storageData.mutedPatterns).toEqual(["https://muted.example"]);
    expect(storageData.snoozedHosts).toEqual({
      "snoozed.example": 4_102_444_800_000,
    });

    // And the snapshot it hands back says the same.
    expect(loaded.auth).toBeTruthy();
    expect(loaded.settings.autoScan).toBe("onPageLoad");
    expect(loaded.mutedPatterns).toEqual(["https://muted.example"]);
    expect(loaded.historyCache).toEqual([]);
    expect(loaded.reputationCache).toEqual({});
    expect(loaded.lastResult).toBeNull();
  });

  it("never clears storage", async () => {
    seedUserState();
    storageData.schemaVersion = OLD;
    await loadAll();
    expect(fake.storage.local.clear).not.toHaveBeenCalled();
  });

  it("stamps the current version, so the bump runs once", async () => {
    seedUserState();
    seedDerivedCaches();
    storageData.schemaVersion = OLD;
    await loadAll();
    expect(storageData.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);

    fake.storage.local.remove.mockClear();
    await loadAll();
    expect(fake.storage.local.remove).not.toHaveBeenCalled();
  });

  it("lists exactly the caches the plan names, plus the two this release adds", () => {
    expect([...DERIVED_CACHE_KEYS].sort()).toEqual(
      [
        "historyCache",
        "historyFetchedAt",
        "lastResult",
        "lastScanCompletion",
        "reputationCache",
        "reputationThrottleMap",
        "lastShownReputation",
        "rateLimitInfo",
        "autoScannedAt",
        "offeredScans",
      ].sort(),
    );
    // The things a person typed or chose must never be on the list.
    for (const owned of [
      "auth",
      "settings",
      "mutedHosts",
      "mutedPatterns",
      "snoozedHosts",
    ]) {
      expect(DERIVED_CACHE_KEYS as readonly string[]).not.toContain(owned);
    }
  });
});

describe("loadAll otherwise", () => {
  it("treats a missing schemaVersion as a fresh install and keeps what is there", async () => {
    storageData.auth = { apiKey: `vr_live_${"c".repeat(64)}`, me: {} };
    const loaded = await loadAll();
    expect(loaded.auth).toBeTruthy();
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
    expect(fake.storage.local.remove).not.toHaveBeenCalled();
    expect(fake.storage.local.clear).not.toHaveBeenCalled();
  });

  it("leaves a current-version store alone", async () => {
    seedUserState();
    seedDerivedCaches();
    storageData.schemaVersion = STORAGE_SCHEMA_VERSION;
    await loadAll();
    expect(fake.storage.local.remove).not.toHaveBeenCalled();
    expect(storageData.historyCache).toEqual([{ id: "x" }]);
  });

  it("defaults the setting this release adds for a blob saved before it", async () => {
    const { autoScanHostCooldownHours: _omitted, ...old } = DEFAULT_SETTINGS;
    storageData.settings = old;
    const loaded = await loadAll();
    expect(loaded.settings.autoScanHostCooldownHours).toBe(
      DEFAULT_SETTINGS.autoScanHostCooldownHours,
    );
  });
});

describe("normalizeSettings", () => {
  it("lays a stored blob over the defaults, families included", () => {
    const stored = {
      ...DEFAULT_SETTINGS,
      theme: "dark",
      families: { headers: false },
    } as unknown as Parameters<typeof normalizeSettings>[0];
    const out = normalizeSettings(stored);
    expect(out.theme).toBe("dark");
    expect(out.families.headers).toBe(false);
    // A family the blob predates comes back at its default.
    expect(out.families.ssl).toBe(DEFAULT_SETTINGS.families.ssl);
  });

  it("returns the defaults for nothing", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("patchSettings", () => {
  it("writes the settings key and nothing else", async () => {
    seedUserState();
    storageData.lastAutoScanAt = 999;
    setCalls.length = 0;

    const next = await patchSettings({ theme: "dark" });

    expect(next.theme).toBe("dark");
    expect(next.autoScan).toBe("onPageLoad");
    expect(setCalls).toEqual([["settings"]]);
    // What a whole-snapshot save would have rewritten from a stale copy.
    expect(storageData.lastAutoScanAt).toBe(999);
    expect(storageData.auth).toBeTruthy();
  });

  it("merges families instead of replacing them", async () => {
    const next = await patchSettings({
      families: { headers: false } as typeof DEFAULT_SETTINGS.families,
    });
    expect(next.families.headers).toBe(false);
    expect(next.families.ssl).toBe(true);
  });

  it("does not undo a change another writer made in between", async () => {
    storageData.settings = { ...DEFAULT_SETTINGS };
    // The background turns both alerts off while the options page, which read
    // its copy earlier, saves an unrelated toggle.
    storageData.settings = {
      ...DEFAULT_SETTINGS,
      showScanResults: false,
      showScanPrompts: false,
    };
    const next = await patchSettings({ compactMode: true });
    expect(next.showScanResults).toBe(false);
    expect(next.showScanPrompts).toBe(false);
    expect(next.compactMode).toBe(true);
  });
});

describe("update", () => {
  it("serialises writers to one key so none is lost", async () => {
    storageData.mutedPatterns = [];
    await Promise.all(
      ["https://a.example", "https://b.example", "https://c.example"].map((p) =>
        update("mutedPatterns", (current) => [...(current ?? []), p]),
      ),
    );
    expect(storageData.mutedPatterns).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
  });

  it("keeps the chain alive after a writer throws", async () => {
    await expect(
      update("mutedPatterns", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await update("mutedPatterns", () => ["https://ok.example"]);
    expect(storageData.mutedPatterns).toEqual(["https://ok.example"]);
  });

  it("starts from DEFAULT's shape for a key that was never written", async () => {
    expect(DEFAULT.mutedPatterns).toEqual([]);
    const seen: unknown[] = [];
    await update("mutedPatterns", (current) => {
      seen.push(current);
      return [];
    });
    expect(seen).toEqual([null]);
  });
});
