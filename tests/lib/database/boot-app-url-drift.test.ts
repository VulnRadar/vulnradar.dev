import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Next inlines NEXT_PUBLIC_APP_URL at build time, so a pulled image keeps the
 * origin it was built with. Server links read the runtime value now, but the
 * browser bundle cannot, and an operator had no way of finding out the two
 * disagreed.
 */

const serverAppUrl = vi.fn<() => Promise<string>>();
vi.mock("@/lib/config/server-app-url", () => ({
  serverAppUrl: () => serverAppUrl(),
}));

const { reportAppUrlDrift } = await import("@/lib/database/boot/app-url-drift");

beforeEach(() => {
  serverAppUrl.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reportAppUrlDrift", () => {
  it("logs an error naming both origins when they differ", async () => {
    serverAppUrl.mockResolvedValue("https://scan.example.com");
    await reportAppUrlDrift("App", "https://vulnradar.dev");
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(console.error).mock.calls[0][0]);
    expect(line).toContain("https://vulnradar.dev");
    expect(line).toContain("https://scan.example.com");
    expect(line).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("is quiet when they match, trailing slash or not", async () => {
    serverAppUrl.mockResolvedValue("https://scan.example.com");
    await reportAppUrlDrift("App", "https://scan.example.com/");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("is quiet for an image built with no URL at all", async () => {
    await reportAppUrlDrift("App", "");
    await reportAppUrlDrift("App", undefined);
    expect(serverAppUrl).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never stops the boot when the comparison itself fails", async () => {
    serverAppUrl.mockRejectedValue(new Error("no settings table"));
    await expect(
      reportAppUrlDrift("App", "https://vulnradar.dev"),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
