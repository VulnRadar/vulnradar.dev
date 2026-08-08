/**
 * Route-level tests for POST /api/v3/scan/verify-batch (AI verification of
 * client-supplied findings, not a stored scan). Auth (session or API key) is
 * mocked at the boundary; verifyFindingsBatch (lib/ai/verify-findings.ts) is
 * mocked outright since it is itself an LLM network boundary.
 *
 * Unlike verify/route.ts, this route never reads scan_history: the caller
 * supplies url + findings[] directly in the body, so there is no scan
 * ownership check to make (there's no scanId to own): userId is only used
 * to pick the caller's own AI provider config (BYOK).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const mockVerifyFindingsBatch = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  verifyFindingsBatch: (...args: unknown[]) => mockVerifyFindingsBatch(...args),
}));

const { POST } = await import("@/app/api/v3/scan/verify-batch/route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan/verify-batch", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const findings = [{ id: "f1", title: "Missing CSP" }];

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockValidateApiKey.mockReset();
  mockVerifyFindingsBatch.mockReset();
  mockVerifyFindingsBatch.mockResolvedValue(findings);
});

describe("POST /api/v3/scan/verify-batch: auth", () => {
  it("requires session or API key authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Authentication required.");
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { url: "https://example.com", findings },
        { Authorization: "Bearer vr_live_bad" },
      ),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid API key.");
  });

  it("authenticates via a valid API key and uses its userId", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({ userId: 77 });

    const res = await POST(
      postRequest(
        { url: "https://example.com", findings },
        { Authorization: "Bearer vr_live_good" },
      ),
    );
    expect(res.status).toBe(200);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      77,
    );
  });
});

describe("POST /api/v3/scan/verify-batch: request validation", () => {
  it("rejects invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/v3/scan/verify-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a missing url", async () => {
    const res = await POST(postRequest({ findings }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("url and findings[] are required.");
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });

  it("rejects findings that are not an array", async () => {
    const res = await POST(
      postRequest({ url: "https://example.com", findings: "nope" }),
    );
    expect(res.status).toBe(400);
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/verify-batch: happy path", () => {
  it("returns the AI-enriched findings for a session-authenticated caller", async () => {
    const enriched = [{ ...findings[0], aiVerdict: "confirmed" }];
    mockVerifyFindingsBatch.mockResolvedValue(enriched);

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.findings).toEqual(enriched);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      42,
    );
  });

  it("accepts an empty findings array and passes it straight through", async () => {
    mockVerifyFindingsBatch.mockResolvedValue([]);
    const res = await POST(
      postRequest({ url: "https://example.com", findings: [] }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.findings).toEqual([]);
  });

  it("does not catch a failure from the AI verification call: it propagates uncontrolled", async () => {
    mockVerifyFindingsBatch.mockRejectedValue(new Error("AI provider down"));

    await expect(
      POST(postRequest({ url: "https://example.com", findings })),
    ).rejects.toThrow("AI provider down");
  });
});
