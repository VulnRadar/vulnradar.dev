import { describe, it, expect } from "vitest";
import { summarizeUserAgent } from "@/lib/auth/user-agent-summary";

describe("summarizeUserAgent", () => {
  it("returns a generic label for missing/unknown input", () => {
    expect(summarizeUserAgent(null)).toBe("Unknown device");
    expect(summarizeUserAgent(undefined)).toBe("Unknown device");
    expect(summarizeUserAgent("")).toBe("Unknown device");
    expect(summarizeUserAgent("unknown")).toBe("Unknown device");
  });

  it("identifies Chrome on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(summarizeUserAgent(ua)).toBe("Chrome on Windows");
  });

  it("identifies Safari on Mac (not Chrome, despite sharing Safari/ token)", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(summarizeUserAgent(ua)).toBe("Safari on Mac");
  });

  it("identifies Firefox on Linux", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";
    expect(summarizeUserAgent(ua)).toBe("Firefox on Linux");
  });

  it("identifies Edge, not Chrome, on a Chromium-based Edge UA", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(summarizeUserAgent(ua)).toBe("Edge on Windows");
  });

  it("identifies Opera, not Chrome, on an Opera UA", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0";
    expect(summarizeUserAgent(ua)).toBe("Opera on Windows");
  });

  it("identifies Chrome on iOS (CriOS), not Safari", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
    expect(summarizeUserAgent(ua)).toBe("Chrome on iOS");
  });

  it("identifies Chrome on Android", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(summarizeUserAgent(ua)).toBe("Chrome on Android");
  });

  it("identifies curl with no OS suffix", () => {
    expect(summarizeUserAgent("curl/8.4.0")).toBe("curl");
  });

  it("falls back to an unknown-browser label for an unrecognized string", () => {
    expect(summarizeUserAgent("SomeWeirdClient/1.0")).toBe("Unknown browser");
  });
});
