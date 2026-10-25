import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockFetchLatest = vi.fn();
vi.mock("@/lib/updater/github-release", () => ({
  fetchLatestRelease: (...args: unknown[]) => mockFetchLatest(...args),
}));

const { getCachedLatestRelease, resetCachedLatestRelease } =
  await import("@/lib/updater/release-summary");

const release = {
  tagName: "v4.0.0",
  version: "4.0.0",
  htmlUrl: "https://example.test/release",
  body: "notes",
  assets: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T10:00:00.000Z"));
  mockFetchLatest.mockReset();
  resetCachedLatestRelease();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCachedLatestRelease", () => {
  it("asks GitHub once for an hour of page loads", async () => {
    mockFetchLatest.mockResolvedValue(release);
    expect(await getCachedLatestRelease()).toBe(release);
    vi.advanceTimersByTime(59 * 60 * 1000);
    expect(await getCachedLatestRelease()).toBe(release);
    expect(mockFetchLatest).toHaveBeenCalledTimes(1);
  });

  it("asks again once the hour is up", async () => {
    mockFetchLatest.mockResolvedValue(release);
    await getCachedLatestRelease();
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    await getCachedLatestRelease();
    expect(mockFetchLatest).toHaveBeenCalledTimes(2);
  });

  it("remembers a failure for five minutes, not an hour, and not zero", async () => {
    mockFetchLatest.mockRejectedValueOnce(new Error("rate limited"));
    expect(await getCachedLatestRelease()).toBeNull();
    // Not hammered: another admin loading the panel a minute later reuses it.
    vi.advanceTimersByTime(60 * 1000);
    expect(await getCachedLatestRelease()).toBeNull();
    expect(mockFetchLatest).toHaveBeenCalledTimes(1);
    // But GitHub being down for a moment does not hide updates for an hour.
    mockFetchLatest.mockResolvedValue(release);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await getCachedLatestRelease()).toBe(release);
    expect(mockFetchLatest).toHaveBeenCalledTimes(2);
  });

  it("treats GitHub answering with nothing as a failure to retry soon", async () => {
    mockFetchLatest.mockResolvedValueOnce(null);
    expect(await getCachedLatestRelease()).toBeNull();
    mockFetchLatest.mockResolvedValue(release);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await getCachedLatestRelease()).toBe(release);
  });
});
