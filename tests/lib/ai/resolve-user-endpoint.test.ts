/**
 * resolveUserEndpoint (lib/ai/verify-findings.ts): which endpoint a user's own
 * AI settings give, and what an operator can learn when they give none.
 *
 * The database (pool.query) is mocked. The key encryption is the real
 * lib/auth/crypto, because the case that matters is a stored key that really
 * does not decrypt under the current API_KEY_ENCRYPTION_KEY, and a mocked
 * decrypt that throws on cue proves nothing about the recovery the log line
 * recommends.
 *
 * Every test uses its own user id: the unreadable-key report is deduplicated
 * per user for the life of the process, which is the behaviour under test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/lib/billing/ai-usage", () => ({
  recordAiTokens: vi.fn(),
}));

const { resolveUserEndpoint } = await import("@/lib/ai/verify-findings");
const { encryptApiKey } = await import("@/lib/auth/crypto");

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const USER_KEY = "sk-user-secret-key-value";

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const savedEnv = {
  current: process.env.API_KEY_ENCRYPTION_KEY,
  previous: process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY,
};

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockQuery.mockReset();
  setEnv("API_KEY_ENCRYPTION_KEY", KEY_A);
  setEnv("PREVIOUS_API_KEY_ENCRYPTION_KEY", undefined);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  setEnv("API_KEY_ENCRYPTION_KEY", savedEnv.current);
  setEnv("PREVIOUS_API_KEY_ENCRYPTION_KEY", savedEnv.previous);
});

function configRow(overrides: Record<string, unknown> = {}) {
  return {
    use_vulnradar_ai: false,
    model_id: "gpt-4o-mini",
    api_key_encrypted: encryptApiKey(USER_KEY),
    base_url: "https://api.example-llm.test/v1/",
    ...overrides,
  };
}

function lookupReturns(row: Record<string, unknown> | undefined): void {
  mockQuery.mockResolvedValue({ rows: row ? [row] : [] });
}

function loggedLines(): string[] {
  return errors.mock.calls.map((call: unknown[]) =>
    call.map((part) => String(part)).join(" "),
  );
}

describe("resolveUserEndpoint: a saved key that reads", () => {
  it("returns the user's endpoint with the key decrypted and the trailing slash dropped", async () => {
    lookupReturns(configRow());

    expect(await resolveUserEndpoint(100)).toEqual({
      baseUrl: "https://api.example-llm.test/v1",
      model: "gpt-4o-mini",
      apiKey: USER_KEY,
    });
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("resolveUserEndpoint: a saved key that does not decrypt", () => {
  /** A key saved under KEY_A, read after the instance moved to KEY_B with nothing to fall back to. */
  function rotatedWithoutPrevious(): void {
    lookupReturns(configRow());
    setEnv("API_KEY_ENCRYPTION_KEY", KEY_B);
  }

  it("still returns null, so the caller falls back to the instance's endpoint as before", async () => {
    rotatedWithoutPrevious();

    expect(await resolveUserEndpoint(101)).toBeNull();
  });

  it("names the user and the variable that recovers it", async () => {
    rotatedWithoutPrevious();

    await resolveUserEndpoint(102);

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[AI-ENDPOINT]");
    expect(lines[0]).toContain("user 102");
    expect(lines[0]).toContain("PREVIOUS_API_KEY_ENCRYPTION_KEY");
  });

  it("never writes the ciphertext, the key it protects, or either encryption key to the log", async () => {
    const row = configRow();
    lookupReturns(row);
    setEnv("API_KEY_ENCRYPTION_KEY", KEY_B);

    await resolveUserEndpoint(103);

    const everything = JSON.stringify(errors.mock.calls);
    expect(everything).not.toContain(String(row.api_key_encrypted));
    expect(everything).not.toContain(USER_KEY);
    expect(everything).not.toContain(KEY_A);
    expect(everything).not.toContain(KEY_B);
  });

  it("reports one user once per process, not once per request", async () => {
    rotatedWithoutPrevious();

    for (let i = 0; i < 4; i++) await resolveUserEndpoint(104);

    expect(loggedLines()).toHaveLength(1);
  });

  it("reports every affected user, each once", async () => {
    rotatedWithoutPrevious();

    await resolveUserEndpoint(105);
    await resolveUserEndpoint(106);
    await resolveUserEndpoint(105);
    await resolveUserEndpoint(106);

    const lines = loggedLines();
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes("user 105"))).toBe(true);
    expect(lines.some((l) => l.includes("user 106"))).toBe(true);
  });

  it("reports again when a key that read fine breaks a second time", async () => {
    lookupReturns(configRow());
    setEnv("API_KEY_ENCRYPTION_KEY", KEY_B);
    await resolveUserEndpoint(107);
    expect(loggedLines()).toHaveLength(1);

    // The operator fixes it: the same row reads again under the old key.
    setEnv("API_KEY_ENCRYPTION_KEY", KEY_A);
    expect(await resolveUserEndpoint(107)).not.toBeNull();
    expect(loggedLines()).toHaveLength(1);

    setEnv("API_KEY_ENCRYPTION_KEY", KEY_B);
    await resolveUserEndpoint(107);
    expect(loggedLines()).toHaveLength(2);
  });

  it("is fixed by exactly what the message says: PREVIOUS_API_KEY_ENCRYPTION_KEY set to the old value", async () => {
    lookupReturns(configRow());
    setEnv("API_KEY_ENCRYPTION_KEY", KEY_B);
    setEnv("PREVIOUS_API_KEY_ENCRYPTION_KEY", KEY_A);

    expect(await resolveUserEndpoint(108)).toMatchObject({
      apiKey: USER_KEY,
    });
    expect(errors).not.toHaveBeenCalled();
  });

  it("says so when the instance has no usable encryption key at all", async () => {
    lookupReturns(configRow());
    setEnv("API_KEY_ENCRYPTION_KEY", undefined);

    expect(await resolveUserEndpoint(109)).toBeNull();

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("API_KEY_ENCRYPTION_KEY must be set");
  });
});

describe("resolveUserEndpoint: a lookup that throws", () => {
  it("still returns null", async () => {
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    expect(await resolveUserEndpoint(110)).toBeNull();
  });

  it("names the user and the reason", async () => {
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    await resolveUserEndpoint(111);

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[AI-ENDPOINT]");
    expect(lines[0]).toContain("user 111");
    expect(lines[0]).toContain("connection terminated");
  });

  it("reports every failure, because each one is an event and not a standing fact", async () => {
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    await resolveUserEndpoint(112);
    await resolveUserEndpoint(112);

    expect(loggedLines()).toHaveLength(2);
  });
});

describe("resolveUserEndpoint: rows that simply mean the user has no AI of their own", () => {
  // Built on demand: configRow encrypts, which needs the key beforeEach sets.
  const cases: Array<[string, () => Record<string, unknown> | undefined]> = [
    ["no row at all", () => undefined],
    ["the VulnRadar AI option", () => configRow({ use_vulnradar_ai: true })],
    ["a row with no base URL", () => configRow({ base_url: "" })],
    ["a row with no model", () => configRow({ model_id: null })],
    ["a row with no saved key", () => configRow({ api_key_encrypted: null })],
  ];

  it.each(cases)("%s returns null and logs nothing", async (_label, build) => {
    lookupReturns(build());

    expect(await resolveUserEndpoint(120)).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
