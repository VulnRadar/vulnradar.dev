/**
 * Tests for the Web Risk reputation check (lib/scanner/reputation-lookup.ts).
 *
 * Mocks global fetch so no real network call happens; WEB_RISK_API_KEY is
 * set/unset per test via process.env directly since this module reads it
 * fresh on every call (no module-level caching to work around).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkReputation,
  isReputationCheckConfigured,
} from "@/lib/scanner/reputation-lookup";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("isReputationCheckConfigured", () => {
  it("is false when WEB_RISK_API_KEY is unset", () => {
    delete process.env.WEB_RISK_API_KEY;
    expect(isReputationCheckConfigured()).toBe(false);
  });

  it("is true when WEB_RISK_API_KEY is set", () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    expect(isReputationCheckConfigured()).toBe(true);
  });
});

describe("checkReputation", () => {
  it("returns [] without calling fetch when no API key is configured", async () => {
    delete process.env.WEB_RISK_API_KEY;
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns [] when Web Risk reports no threat (empty response)", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
  });

  it("reports a finding for a single flagged threat type", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          threat: {
            threatTypes: ["MALWARE"],
            expireTime: "2026-08-13T00:00:00Z",
          },
        }),
        { status: 200 },
      ),
    );
    const findings = await checkReputation("https://evil.example.com");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toMatch(/^url-flagged-malware--/);
    expect(findings[0].category).toBe("reputation");
    expect(findings[0].severity).toBe("critical");
  });

  it("reports one finding per threat type when multiple are returned", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          threat: { threatTypes: ["MALWARE", "SOCIAL_ENGINEERING"] },
        }),
        { status: 200 },
      ),
    );
    const findings = await checkReputation("https://evil.example.com");
    expect(findings).toHaveLength(2);
    const ids = findings.map((f) => f.id.split("--")[0]).sort();
    expect(ids).toEqual([
      "url-flagged-malware",
      "url-flagged-social-engineering",
    ]);
  });

  it("produces the same finding id for the same URL across two calls (deterministic)", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    const threatResponse = () =>
      new Response(
        JSON.stringify({ threat: { threatTypes: ["UNWANTED_SOFTWARE"] } }),
        { status: 200 },
      );
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(threatResponse())
      .mockResolvedValueOnce(threatResponse());
    const first = await checkReputation("https://evil.example.com");
    const second = await checkReputation("https://evil.example.com");
    expect(first[0].id).toBe(second[0].id);
  });

  it("fails open (returns []) on a non-2xx response instead of throwing", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("quota exceeded", { status: 429 }),
    );
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
  });

  it("fails open (returns []) when the request throws (network error/timeout)", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network error"),
    );
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
  });

  it("ignores an unknown/future threatType instead of crashing", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ threat: { threatTypes: ["SOME_NEW_THREAT_TYPE"] } }),
        { status: 200 },
      ),
    );
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
  });

  it("sends the API key and all three threat types as query params", async () => {
    process.env.WEB_RISK_API_KEY = "secret-key-123";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await checkReputation("https://example.com/path");

    const [calledUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const parsed = new URL(calledUrl as string);
    expect(parsed.hostname).toBe("webrisk.googleapis.com");
    expect(parsed.searchParams.get("key")).toBe("secret-key-123");
    expect(parsed.searchParams.get("uri")).toBe("https://example.com/path");
    expect(parsed.searchParams.getAll("threatTypes").sort()).toEqual([
      "MALWARE",
      "SOCIAL_ENGINEERING",
      "UNWANTED_SOFTWARE",
    ]);
  });
});
