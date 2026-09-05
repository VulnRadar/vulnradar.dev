import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mkdtempSyncMock = vi.fn();
const rmSyncMock = vi.fn();
const existsSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  mkdtempSync: (p: string) => mkdtempSyncMock(p),
  rmSync: (p: string, o: unknown) => rmSyncMock(p, o),
  existsSync: (p: string) => existsSyncMock(p),
}));

import { isUpdaterSupported } from "@/lib/updater/environment";

describe("isUpdaterSupported", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mkdtempSyncMock.mockReset();
    rmSyncMock.mockReset();
    existsSyncMock.mockReset();
    // The default is a writable app directory: the probe creates its
    // directory and the caller removes it again.
    mkdtempSyncMock.mockImplementation((prefix: string) => `${prefix}abc123`);
    existsSyncMock.mockReturnValue(false);
    delete process.env.VERCEL;
    delete process.env.VULNRADAR_UPDATER_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("supports an ordinary bare-metal install", () => {
    expect(isUpdaterSupported()).toEqual({ supported: true });
  });

  it("refuses on Vercel", () => {
    process.env.VERCEL = "1";
    const result = isUpdaterSupported();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/Vercel/);
  });

  // AUDIT-014#host-08: the updater used to report itself available inside the
  // official image, where the copy fails with EACCES partway through and any
  // success is discarded by the next `docker compose pull`.
  it("refuses when the image says it updates by being replaced", () => {
    process.env.VULNRADAR_UPDATER_DISABLED = "true";
    const result = isUpdaterSupported();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/docker compose pull/);
  });

  it("refuses when the app directory cannot be written to", () => {
    mkdtempSyncMock.mockImplementation(() => {
      const err = new Error(
        "EACCES: permission denied",
      ) as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });
    const result = isUpdaterSupported();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/not writable/);
    // Naming the directory is the difference between an admin fixing the
    // ownership and an admin filing a bug.
    expect(result.reason).toContain(process.cwd());
  });

  it("probes the directory the update would be written into", () => {
    isUpdaterSupported();
    expect(mkdtempSyncMock).toHaveBeenCalledTimes(1);
    expect(mkdtempSyncMock.mock.calls[0][0]).toContain(process.cwd());
  });

  it("removes the directory it created to ask", () => {
    isUpdaterSupported();
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
    expect(rmSyncMock.mock.calls[0][0]).toBe(
      mkdtempSyncMock.mock.results[0].value,
    );
  });

  it("stays supported when the probe cannot clean up after itself", () => {
    rmSyncMock.mockImplementation(() => {
      throw new Error("EBUSY");
    });
    expect(isUpdaterSupported()).toEqual({ supported: true });
  });

  // The regression this file exists to hold. 3.8.0 read /.dockerenv as "this
  // deployment updates by pulling an image", which is true of our own image
  // and false of every source install that happens to run inside a container:
  // the Pterodactyl and Pelican eggs, unRAID, and hand-rolled setups, all of
  // which have a writable persistent app directory and had a working updater
  // for eight releases. Being in a container decides nothing on its own.
  it("stays supported in a container whose app directory is writable", () => {
    existsSyncMock.mockImplementation(
      (p: string) => p === "/.dockerenv" || p === "/run/.containerenv",
    );
    expect(isUpdaterSupported()).toEqual({ supported: true });
  });
});
