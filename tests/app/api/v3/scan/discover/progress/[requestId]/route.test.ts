import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/v3/scan/discover/progress/{token}: the poll a client runs while
 * its POST /scan/discover is in flight. The progress store is the real
 * in-memory one; only the session and the key lookup are replaced.
 */

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const { GET } =
  await import("@/app/api/v3/scan/discover/progress/[requestId]/route");
const { DISCOVERY_STAGES, setDiscoveryStage } =
  await import("@/lib/scanner/discovery-progress");

function call(token: string, authorization?: string) {
  return GET(
    new NextRequest(`http://localhost/api/v3/scan/discover/progress/${token}`, {
      headers: authorization ? { authorization } : {},
    }),
    { params: Promise.resolve({ requestId: token }) },
  );
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(null);
  mockValidateApiKey.mockReset();
});

describe("GET /api/v3/scan/discover/progress/[requestId]", () => {
  it("answers 401 with no session and no key", async () => {
    const res = await call("tok-none");
    expect(res.status).toBe(401);
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });

  it("answers the stage for a key holding scan:read", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 1,
      userId: 9,
      scopes: ["scan:read"],
    });
    setDiscoveryStage("tok-read", "done");

    const res = await call("tok-read", "Bearer vr_live_read");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stage: "done",
      stageIndex: DISCOVERY_STAGES.length,
      stagesTotal: DISCOVERY_STAGES.length,
    });
  });

  it("refuses a key without scan:read", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 1,
      userId: 9,
      scopes: ["scan:write"],
    });
    const res = await call("tok-scope", "Bearer vr_live_write");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("SCOPE_MISSING");
  });

  // New on this route in 4.0.0, and on v3 too: every other key-authenticated
  // route already refused a user behind on the Terms.
  it("refuses a key whose owner has not accepted the current Terms", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 1,
      userId: 9,
      scopes: ["scan:read"],
      needsTermsAcceptance: true,
    });
    setDiscoveryStage("tok-terms", "done");

    const res = await call("tok-terms", "Bearer vr_live_terms");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("TERMS_ACCEPTANCE_REQUIRED");
    expect(body.stage).toBeUndefined();
  });

  it("does not consult the key for a signed-in session", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    const res = await call("tok-session-unknown");
    expect(res.status).toBe(200);
    expect((await res.json()).stage).toBe("queued");
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });
});
