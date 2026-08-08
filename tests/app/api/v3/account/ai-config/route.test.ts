/**
 * Route-level tests for GET/PUT/DELETE /api/v3/account/ai-config.
 *
 * The database is mocked (network/DB boundary). encryptApiKey/decryptApiKey
 * (lib/auth/crypto.ts, AES-256-GCM) run for real per this repo's rule of
 * mocking at the network/DB boundary and not below it — the pasted-hashPassword
 * regression in tests/README.md is exactly the failure mode that mocking
 * crypto here would risk reintroducing.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET, PUT, DELETE } =
  await import("@/app/api/v3/account/ai-config/route");
const { encryptApiKey } = await import("@/lib/auth/crypto");

const ENCRYPTION_KEY = "b".repeat(64);
let previousKey: string | undefined;

beforeAll(() => {
  previousKey = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = ENCRYPTION_KEY;
});

afterAll(() => {
  if (previousKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = previousKey;
});

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/account/ai-config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v3/account/ai-config", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the VulnRadar-AI default when no row exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ useVulnradarAi: true, aiDisabled: false });
  });

  it("decrypts the stored key and returns only its last 4 characters", async () => {
    const encrypted = encryptApiKey("sk-live-abcd1234wxyz");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          use_vulnradar_ai: false,
          ai_disabled: false,
          provider: "openai",
          model_id: "gpt-4o",
          api_key_encrypted: encrypted,
          base_url: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.apiKeyLast4).toBe("wxyz");
    expect(json.provider).toBe("openai");
    expect(json.useVulnradarAi).toBe(false);
  });

  it("returns a null apiKeyLast4 instead of throwing when the stored ciphertext cannot be decrypted", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          use_vulnradar_ai: false,
          ai_disabled: false,
          provider: "openai",
          model_id: "gpt-4o",
          api_key_encrypted: "not-valid-ciphertext",
          base_url: null,
          updated_at: null,
        },
      ],
    });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.apiKeyLast4).toBeNull();
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/v3/account/ai-config", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PUT(putRequest({ aiDisabled: true }));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid JSON body", async () => {
    const req = new Request("http://localhost/api/v3/account/ai-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("toggles aiDisabled without requiring provider/model", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PUT(putRequest({ aiDisabled: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, aiDisabled: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual([7, true]);
  });

  it("resets to VulnRadar AI when useVulnradarAi is true", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PUT(putRequest({ useVulnradarAi: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, useVulnradarAi: true });
  });

  it("requires provider and modelId for a custom AI config", async () => {
    const res = await PUT(putRequest({ provider: "openai" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("requires an API key when none is stored yet", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existing lookup: no key
    const res = await PUT(
      putRequest({ provider: "openai", modelId: "gpt-4o" }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/API key is required/);
  });

  it("saves a custom provider config, encrypting the supplied key", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existing lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await PUT(
      putRequest({
        provider: "openai",
        modelId: "gpt-4o",
        apiKey: "sk-live-newkey0000",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, useVulnradarAi: false });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const upsertParams = mockQuery.mock.calls[1][1] as unknown[];
    // apiKey stored is the encrypted form, never the plaintext.
    expect(upsertParams[3]).not.toBe("sk-live-newkey0000");
  });

  it("keeps the existing encrypted key when no new key is supplied", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ api_key_encrypted: encryptApiKey("sk-old-key") }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PUT(
      putRequest({
        provider: "anthropic",
        modelId: "claude-haiku-4-5-20251001",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a provider not in the catalog", async () => {
    const res = await PUT(
      putRequest({ provider: "not-a-real-provider", modelId: "whatever" }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Unknown AI provider/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a modelId not in the provider's catalog entry", async () => {
    const res = await PUT(
      putRequest({ provider: "openai", modelId: "gpt-3.5-turbo" }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Unknown model/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied baseUrl that doesn't match the provider", async () => {
    const res = await PUT(
      putRequest({
        provider: "openai",
        modelId: "gpt-4o",
        baseUrl: "http://169.254.169.254/latest/meta-data",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/baseUrl/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("stores the catalog's baseUrl for the provider regardless of what the client sent", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existing lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upsert
    const res = await PUT(
      putRequest({
        provider: "openai",
        modelId: "gpt-4o",
        apiKey: "sk-live-newkey0000",
      }),
    );
    expect(res.status).toBe(200);
    const upsertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(upsertParams[4]).toBe("https://api.openai.com/v1");
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await PUT(putRequest({ aiDisabled: false }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v3/account/ai-config", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("resets the config back to the VulnRadar default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, useVulnradarAi: true });
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [7]);
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});
