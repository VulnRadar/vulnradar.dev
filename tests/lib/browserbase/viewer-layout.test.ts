import { describe, it, expect } from "vitest";

import {
  fitEmbed,
  readViewerFlag,
  writeViewerFlag,
  VIEWER_STORAGE_KEYS,
  type FlagStorage,
} from "@/lib/browserbase/viewer-layout";

/** The resolution POST /api/v3/browser/sessions creates the remote browser at. */
const REMOTE = { width: 1920, height: 1080 };

function fakeStorage(initial: Record<string, string> = {}): FlagStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("fitEmbed", () => {
  it("keeps the remote viewport's aspect ratio when the container is wider than it", () => {
    // 1600x600 is 2.67:1 around a 16:9 screen, so height is the binding limit.
    const fit = fitEmbed({ width: 1600, height: 600 }, REMOTE);
    expect(fit.height).toBe(600);
    expect(fit.width).toBe(1066);
    expect(fit.width / fit.height).toBeCloseTo(16 / 9, 2);
  });

  it("keeps the ratio when the container is taller than it, which is the case the viewer letterboxed", () => {
    // The shape the old layout actually produced on a 1920x1080 screen once the
    // header, the notice row, the fake browser chrome, the footer and a 420px
    // network rail had taken their share: about 1440x910, 1.58:1 around a
    // 1.78:1 screen. Browserbase filled the width and painted the leftover
    // height black.
    const fit = fitEmbed({ width: 1440, height: 910 }, REMOTE);
    expect(fit.width).toBe(1440);
    expect(fit.height).toBe(810);
    expect(fit.width / fit.height).toBeCloseTo(16 / 9, 2);
  });

  it("never returns a box larger than the container it was given", () => {
    for (const container of [
      { width: 1920, height: 1080 },
      { width: 1913, height: 1007 },
      { width: 377, height: 655 },
      { width: 1024, height: 768 },
    ]) {
      const fit = fitEmbed(container, REMOTE);
      expect(fit.width).toBeLessThanOrEqual(container.width);
      expect(fit.height).toBeLessThanOrEqual(container.height);
      expect(fit.width / fit.height).toBeCloseTo(16 / 9, 1);
    }
  });

  it("fits exactly, with no scaling, when the container matches the remote viewport", () => {
    const fit = fitEmbed(REMOTE, REMOTE);
    expect(fit).toEqual({ width: 1920, height: 1080, scale: 1 });
  });

  it("scales up rather than leaving the frame small when the container is larger", () => {
    const fit = fitEmbed({ width: 3840, height: 2160 }, REMOTE);
    expect(fit.scale).toBe(2);
    expect(fit).toMatchObject({ width: 3840, height: 2160 });
  });

  it("reports zeros before the container has been measured, so the caller can hold the frame back", () => {
    expect(fitEmbed({ width: 0, height: 0 }, REMOTE)).toEqual({
      width: 0,
      height: 0,
      scale: 0,
    });
  });

  it("reports zeros rather than NaN geometry for a nonsense viewport", () => {
    expect(
      fitEmbed({ width: 800, height: 600 }, { width: 0, height: 0 }),
    ).toEqual({ width: 0, height: 0, scale: 0 });
    expect(
      fitEmbed({ width: 800, height: 600 }, { width: NaN, height: 1080 }),
    ).toEqual({ width: 0, height: 0, scale: 0 });
  });
});

describe("viewer flags", () => {
  it("round-trips the network dock preference", () => {
    const storage = fakeStorage();
    writeViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, false);
    expect(readViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, true)).toBe(
      false,
    );

    writeViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, true);
    expect(
      readViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, false),
    ).toBe(true);
  });

  it("keeps the two toggles in separate keys", () => {
    const storage = fakeStorage();
    writeViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, false);
    expect(
      readViewerFlag(storage, VIEWER_STORAGE_KEYS.safetyNotice, true),
    ).toBe(true);
  });

  it("falls back per-device when nothing is stored", () => {
    const storage = fakeStorage();
    // Wide screen: the dock opens. Phone: it stays closed, because there it is
    // a sheet over the live view.
    expect(readViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, true)).toBe(
      true,
    );
    expect(
      readViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, false),
    ).toBe(false);
  });

  it("falls back for a stored value it does not recognise", () => {
    const storage = fakeStorage({
      [VIEWER_STORAGE_KEYS.networkDock]: "true",
    });
    expect(
      readViewerFlag(storage, VIEWER_STORAGE_KEYS.networkDock, false),
    ).toBe(false);
  });

  it("survives storage that throws, which is what a private window does", () => {
    const throwing: FlagStorage = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    };
    expect(
      readViewerFlag(throwing, VIEWER_STORAGE_KEYS.safetyNotice, true),
    ).toBe(true);
    expect(() =>
      writeViewerFlag(throwing, VIEWER_STORAGE_KEYS.safetyNotice, false),
    ).not.toThrow();
  });

  it("treats a missing storage as no preference rather than crashing", () => {
    expect(readViewerFlag(null, VIEWER_STORAGE_KEYS.networkDock, true)).toBe(
      true,
    );
    expect(() =>
      writeViewerFlag(undefined, VIEWER_STORAGE_KEYS.networkDock, true),
    ).not.toThrow();
  });
});
