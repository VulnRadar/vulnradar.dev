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
const { ERROR_MESSAGES } = await import("@/lib/config/constants");

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

  // A bare "Unauthorized" reached the settings tab as the whole message when
  // a session expired, which said nothing about what to do.
  it.each([
    ["GET", () => GET()],
    ["PUT", () => PUT(putRequest({ aiDisabled: true }))],
    ["DELETE", () => DELETE()],
  ])("%s answers 401 with the shared sign-in message", async (_m, call) => {
    mockGetSession.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe(ERROR_MESSAGES.UNAUTHORIZED);
    expect(json.code).toBe("UNAUTHENTICATED");
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
    const stored = encryptApiKey("sk-old-key");
    mockQuery.mockResolvedValueOnce({
      rows: [{ provider: "anthropic", api_key_encrypted: stored }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PUT(
      putRequest({
        provider: "anthropic",
        modelId: "claude-haiku-4-5-20251001",
      }),
    );
    expect(res.status).toBe(200);
    const upsertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(upsertParams[3]).toBe(stored);
  });

  // The stored key was issued by the provider it was saved under. A keyless
  // save that switches provider used to keep it, so the next scan sent that
  // key to the new provider's endpoint.
  it("does not carry a stored key over to a different provider", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { provider: "openai", api_key_encrypted: encryptApiKey("sk-openai") },
      ],
    });
    const res = await PUT(
      putRequest({
        provider: "anthropic",
        modelId: "claude-haiku-4-5-20251001",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/API key is required/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("treats a key of only spaces on a provider switch as no key", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { provider: "openai", api_key_encrypted: encryptApiKey("sk-openai") },
      ],
    });
    const res = await PUT(
      putRequest({
        provider: "anthropic",
        modelId: "claude-haiku-4-5-20251001",
        apiKey: "   ",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not keep a key left on a row that has no provider", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ provider: null, api_key_encrypted: encryptApiKey("sk-stray") }],
    });
    const res = await PUT(
      putRequest({ provider: "openai", modelId: "gpt-4o" }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
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
    expect(json).toEqual({
      success: true,
      useVulnradarAi: true,
      aiDisabled: false,
    });
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [7]);
  });

  // Removing a provider used to delete the whole row, and the row is also
  // where "AI off" lives, so an account that had switched AI off came back
  // with it on and its findings went to the AI provider on the next scan,
  // while the tab still showed the switch off. The row here is held by a
  // small stand-in for the table; tests/integration/ai-config-reset.test.ts
  // runs the same sequence against Postgres.
  it("keeps the account's AI-off switch when the provider is removed", async () => {
    const table = new Map<number, Record<string, unknown>>([
      [
        7,
        {
          use_vulnradar_ai: false,
          ai_disabled: true,
          provider: "openai",
          model_id: "gpt-4o",
          api_key_encrypted: encryptApiKey("sk-live-0000abcd"),
          base_url: "https://api.openai.com/v1",
          updated_at: "2026-11-01T00:00:00.000Z",
        },
      ],
    ]);
    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      const userId = params[0] as number;
      const row = table.get(userId);
      if (/^\s*DELETE FROM user_ai_configs/.test(sql)) {
        table.delete(userId);
        return { rows: [] };
      }
      if (/^\s*UPDATE user_ai_configs/.test(sql)) {
        if (!row) return { rows: [] };
        Object.assign(row, {
          use_vulnradar_ai: true,
          provider: null,
          model_id: null,
          api_key_encrypted: null,
          base_url: null,
        });
        return { rows: [{ ai_disabled: row.ai_disabled }] };
      }
      if (/^\s*SELECT/.test(sql)) return { rows: row ? [row] : [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const del = await DELETE();
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({
      success: true,
      useVulnradarAi: true,
      aiDisabled: true,
    });

    const json = await (await GET()).json();
    expect(json.aiDisabled).toBe(true);
    expect(json.useVulnradarAi).toBe(true);
    expect(json.provider).toBeNull();
    expect(json.apiKeyLast4).toBeNull();
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});
