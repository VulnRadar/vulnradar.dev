import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const existsSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (p: string) => existsSyncMock(p),
}));

import { isUpdaterSupported } from "@/lib/updater/environment";

describe("isUpdaterSupported", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false);
    delete process.env.VERCEL;
    delete process.env.CONTAINER;
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
  it("refuses inside a Docker container and names the real update path", () => {
    existsSyncMock.mockImplementation((p: string) => p === "/.dockerenv");
    const result = isUpdaterSupported();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/docker compose pull/);
  });

  it("refuses inside a Podman container", () => {
    existsSyncMock.mockImplementation(
      (p: string) => p === "/run/.containerenv",
    );
    expect(isUpdaterSupported().supported).toBe(false);
  });

  it("refuses when the image sets VULNRADAR_UPDATER_DISABLED", () => {
    process.env.VULNRADAR_UPDATER_DISABLED = "true";
    expect(isUpdaterSupported().supported).toBe(false);
  });

  it("stays supported when the filesystem probe throws", () => {
    existsSyncMock.mockImplementation(() => {
      throw new Error("EPERM");
    });
    expect(isUpdaterSupported()).toEqual({ supported: true });
  });
});
