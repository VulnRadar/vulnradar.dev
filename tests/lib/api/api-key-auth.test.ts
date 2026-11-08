import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidate = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidate(...args),
}));
vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/auth/auth", () => ({ getSession: vi.fn() }));

const { authenticateApiKey, TERMS_ACCEPTANCE_REQUIRED_MESSAGE } =
  await import("@/lib/api/api-key-auth");
const { API_KEY_SCOPES } = await import("@/lib/api/api-key-scopes");

const KEY = {
  keyId: 3,
  userId: 9,
  email: "a@example.com",
  userName: "A",
  keyName: "ci",
  dailyLimit: 100,
  needsTermsAcceptance: false,
  scopes: [API_KEY_SCOPES.SCAN_READ],
};

function request(authorization?: string): Request {
  return new Request("https://x.test/api/v3/history", {
    headers: {
      "x-request-id": "req-abcdef12",
      ...(authorization ? { authorization } : {}),
    },
  });
}

beforeEach(() => {
  mockValidate.mockReset();
  mockValidate.mockResolvedValue(KEY);
});

describe("authenticateApiKey", () => {
  it("hands back the validated key", async () => {
    const result = await authenticateApiKey(request("Bearer vr_key"), {
      scope: API_KEY_SCOPES.SCAN_READ,
    });
    expect(result).toEqual({ ok: true, auth: KEY });
    expect(mockValidate).toHaveBeenCalledWith("vr_key");
  });

  it("takes the scheme in any case", async () => {
    const result = await authenticateApiKey(request("bEaReR  vr_key"));
    expect(result.ok).toBe(true);
    expect(mockValidate).toHaveBeenCalledWith("vr_key");
  });

  it("works with no scope to check", async () => {
    mockValidate.mockResolvedValue({ ...KEY, scopes: [] });
    expect((await authenticateApiKey(request("Bearer vr_key"))).ok).toBe(true);
  });

  it("never touches the database for a request with no key", async () => {
    const result = await authenticateApiKey(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).code).toBe("UNAUTHENTICATED");
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("refuses another scheme", async () => {
    const result = await authenticateApiKey(request("Basic abc"));
    expect(result.ok).toBe(false);
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("answers an unknown key with the one 401 sentence", async () => {
    mockValidate.mockResolvedValue(null);
    const result = await authenticateApiKey(request("Bearer nope"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({
      error: "Invalid or revoked API key.",
      code: "INVALID_API_KEY",
      requestId: "req-abcdef12",
      status: 401,
    });
  });

  it("refuses an account behind on the Terms", async () => {
    mockValidate.mockResolvedValue({ ...KEY, needsTermsAcceptance: true });
    const result = await authenticateApiKey(request("Bearer vr_key"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({
      error: TERMS_ACCEPTANCE_REQUIRED_MESSAGE,
      code: "TERMS_ACCEPTANCE_REQUIRED",
    });
  });

  // A key behind on the Terms learns about the Terms, not about what the key
  // may do, and the order is what the routes have always had.
  it("checks the Terms before the scope", async () => {
    mockValidate.mockResolvedValue({
      ...KEY,
      needsTermsAcceptance: true,
      scopes: [],
    });
    const result = await authenticateApiKey(request("Bearer vr_key"), {
      scope: API_KEY_SCOPES.SCAN_READ,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((await result.response.json()).code).toBe(
      "TERMS_ACCEPTANCE_REQUIRED",
    );
  });

  it("names the missing scope", async () => {
    mockValidate.mockResolvedValue({ ...KEY, scopes: [] });
    const result = await authenticateApiKey(request("Bearer vr_key"), {
      scope: API_KEY_SCOPES.SCAN_READ,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.code).toBe("SCOPE_MISSING");
    expect(body.error).toContain(API_KEY_SCOPES.SCAN_READ);
  });

  it("lets a validation failure reach the route's error handling", async () => {
    mockValidate.mockRejectedValue(new Error("pool exhausted"));
    await expect(authenticateApiKey(request("Bearer vr_key"))).rejects.toThrow(
      "pool exhausted",
    );
  });
});
