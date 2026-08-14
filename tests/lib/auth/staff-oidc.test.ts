/**
 * Tests for lib/auth/staff-oidc.ts. This is a security-critical login path
 * (staff SSO), so signature verification runs for real -- a genuine RSA
 * keypair, a genuine JWKS document, and genuinely-signed ID tokens (via
 * jose's own SignJWT), not a mocked jwtVerify. Only the two HTTP calls
 * (discovery document, JWKS endpoint) are mocked, at the same network
 * boundary every other outbound-fetch suite in this repo mocks at.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";

const mockGetSettings = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const {
  getStaffOidcConfig,
  getDiscoveryDocument,
  verifyStaffOidcIdToken,
  exchangeStaffOidcCode,
} = await import("@/lib/auth/staff-oidc");

const CLIENT_ID = "vulnradar-staff";

// getDiscoveryDocument caches by issuer URL (module-level Map, 10-minute
// TTL) and staff-oidc.ts's own getJwksClient caches a createRemoteJWKSet
// instance per jwks_uri -- which ALSO does its own internal caching of the
// fetched key material inside jose. Both caches are keyed by URL and live
// for the lifetime of this test file's module instance, so reusing one
// fixed issuer URL across tests that sign with DIFFERENT keys would verify
// a later test's token against an earlier test's stale cached JWKS. Every
// test that actually exercises signature verification gets its own unique
// issuer URL (a per-test counter suffix) so no two tests ever share a
// cache entry.
let issuerCounter = 0;
function uniqueIssuer() {
  issuerCounter += 1;
  return `https://idp-${issuerCounter}.example.com`;
}

async function makeSigner() {
  const keyPair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keyPair.publicKey);
  const jwks = {
    keys: [{ ...publicJwk, kid: "test-key-1", alg: "RS256", use: "sig" }],
  };
  return { keyPair, jwks };
}

beforeEach(() => {
  mockGetSettings.mockReset();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function discoveryDoc(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
  };
}

async function signIdToken(
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>,
  issuer: string,
  claims: Record<string, unknown>,
  opts: { issuer?: string; audience?: string; expSeconds?: number } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer(opts.issuer ?? issuer)
    .setAudience(opts.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + (opts.expSeconds ?? 300))
    .sign(keyPair.privateKey);
}

function mockFetchSequence(
  responses: Array<{ ok: boolean; json?: unknown; status?: number }>,
) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const r = responses[Math.min(call, responses.length - 1)];
      call++;
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        json: async () => r.json,
      } as Response;
    }),
  );
}

describe("getStaffOidcConfig", () => {
  it("returns null when any of the three settings is missing", async () => {
    mockGetSettings.mockResolvedValue({
      STAFF_OIDC_ISSUER_URL: "",
      STAFF_OIDC_CLIENT_ID: "id",
      STAFF_OIDC_CLIENT_SECRET: "secret",
    });
    expect(await getStaffOidcConfig()).toBeNull();
  });

  it("returns the trimmed config when all three are set", async () => {
    const issuer = uniqueIssuer();
    mockGetSettings.mockResolvedValue({
      STAFF_OIDC_ISSUER_URL: `  ${issuer}  `,
      STAFF_OIDC_CLIENT_ID: " id ",
      STAFF_OIDC_CLIENT_SECRET: " secret ",
    });
    const config = await getStaffOidcConfig();
    expect(config).toEqual({
      issuerUrl: issuer,
      clientId: "id",
      clientSecret: "secret",
    });
  });
});

describe("getDiscoveryDocument", () => {
  it("fetches and returns the discovery document", async () => {
    const issuer = uniqueIssuer();
    mockFetchSequence([{ ok: true, json: discoveryDoc(issuer) }]);
    const doc = await getDiscoveryDocument(issuer);
    expect(doc.issuer).toBe(issuer);
    expect(doc.jwks_uri).toBe(`${issuer}/jwks`);
  });

  it("throws when the discovery endpoint responds non-2xx", async () => {
    const issuer = uniqueIssuer();
    mockFetchSequence([{ ok: false, status: 404 }]);
    await expect(getDiscoveryDocument(issuer)).rejects.toThrow(/404/);
  });

  it("throws when the discovery document is missing required fields", async () => {
    const issuer = uniqueIssuer();
    mockFetchSequence([{ ok: true, json: { issuer } }]);
    await expect(getDiscoveryDocument(issuer)).rejects.toThrow(
      /missing required fields/,
    );
  });

  it("caches the discovery document -- a second call within the TTL makes no new fetch", async () => {
    const issuer = uniqueIssuer();
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => discoveryDoc(issuer),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchSpy);

    await getDiscoveryDocument(issuer);
    await getDiscoveryDocument(issuer);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("verifyStaffOidcIdToken", () => {
  /** Each case gets its own issuer + signer so no test's JWKS cache
   * collides with another's (see uniqueIssuer's own comment above). */
  async function setup() {
    const issuer = uniqueIssuer();
    const { keyPair, jwks } = await makeSigner();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => jwks,
      })) as unknown as typeof fetch,
    );
    const config = {
      issuerUrl: issuer,
      clientId: CLIENT_ID,
      clientSecret: "s",
    };
    const doc = discoveryDoc(issuer);
    const sign = (
      claims: Record<string, unknown>,
      opts?: { issuer?: string; audience?: string; expSeconds?: number },
    ) => signIdToken(keyPair, issuer, claims, opts);
    return { issuer, keyPair, config, doc, sign };
  }

  it("verifies a correctly-signed token and returns its claims", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign({
      email: "Admin@Example.com",
      email_verified: true,
      name: "Admin User",
      sub: "idp-user-1",
      nonce: "abc123",
    });
    const claims = await verifyStaffOidcIdToken(token, config, doc, "abc123");
    expect(claims.email).toBe("admin@example.com"); // lowercased + trimmed
    expect(claims.emailVerified).toBe(true);
    expect(claims.name).toBe("Admin User");
    expect(claims.sub).toBe("idp-user-1");
  });

  it("rejects a token whose nonce doesn't match the expected value (replay defense)", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign({
      email: "a@example.com",
      sub: "u1",
      nonce: "correct-nonce",
    });
    await expect(
      verifyStaffOidcIdToken(token, config, doc, "wrong-nonce"),
    ).rejects.toThrow(/nonce/i);
  });

  it("rejects a token with no nonce claim at all", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign({ email: "a@example.com", sub: "u1" });
    await expect(
      verifyStaffOidcIdToken(token, config, doc, "expected"),
    ).rejects.toThrow(/nonce/i);
  });

  it("rejects a token with no email claim", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign({ sub: "u1", nonce: "n" });
    await expect(
      verifyStaffOidcIdToken(token, config, doc, "n"),
    ).rejects.toThrow(/email/i);
  });

  it("rejects a token with no sub claim", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign({ email: "a@example.com", nonce: "n" });
    await expect(
      verifyStaffOidcIdToken(token, config, doc, "n"),
    ).rejects.toThrow(/sub/i);
  });

  it("rejects a token signed for the wrong audience (a different client_id)", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign(
      { email: "a@example.com", sub: "u1", nonce: "n" },
      { audience: "some-other-client" },
    );
    await expect(
      verifyStaffOidcIdToken(token, config, doc, "n"),
    ).rejects.toThrow();
  });

  it("rejects a token from the wrong issuer", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign(
      { email: "a@example.com", sub: "u1", nonce: "n" },
      { issuer: "https://attacker.example.com" },
    );
    await expect(
      verifyStaffOidcIdToken(token, config, doc, "n"),
    ).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign(
      { email: "a@example.com", sub: "u1", nonce: "n" },
      { expSeconds: -10 },
    );
    await expect(
      verifyStaffOidcIdToken(token, config, doc, "n"),
    ).rejects.toThrow();
  });

  it("rejects a token signed by a key not in the issuer's JWKS (forged token)", async () => {
    const { issuer, config, doc } = await setup();
    const forgedKeyPair = await generateKeyPair("RS256");
    const token = await new SignJWT({
      email: "a@example.com",
      sub: "u1",
      nonce: "n",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(forgedKeyPair.privateKey); // signed by a DIFFERENT key than the JWKS advertises

    await expect(
      verifyStaffOidcIdToken(token, config, doc, "n"),
    ).rejects.toThrow();
  });

  it("treats email_verified: false as unverified (emailVerified: false)", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign({
      email: "a@example.com",
      email_verified: false,
      sub: "u1",
      nonce: "n",
    });
    const claims = await verifyStaffOidcIdToken(token, config, doc, "n");
    expect(claims.emailVerified).toBe(false);
  });

  it("treats a missing email_verified claim as verified (some IdPs omit it when true)", async () => {
    const { config, doc, sign } = await setup();
    const token = await sign({ email: "a@example.com", sub: "u1", nonce: "n" });
    const claims = await verifyStaffOidcIdToken(token, config, doc, "n");
    expect(claims.emailVerified).toBe(true);
  });
});

describe("exchangeStaffOidcCode", () => {
  function ctx() {
    const issuer = uniqueIssuer();
    return {
      doc: discoveryDoc(issuer),
      config: { issuerUrl: issuer, clientId: CLIENT_ID, clientSecret: "s" },
    };
  }

  it("posts the authorization_code grant and returns the id_token", async () => {
    const { doc, config } = ctx();
    let capturedBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id_token: "the-id-token" }),
        } as Response;
      }),
    );

    const result = await exchangeStaffOidcCode(
      doc,
      config,
      "auth-code-123",
      "https://app.example.com/callback",
    );

    expect(result.idToken).toBe("the-id-token");
    const params = new URLSearchParams(capturedBody);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code-123");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("client_secret")).toBe("s");
    expect(params.get("redirect_uri")).toBe("https://app.example.com/callback");
  });

  it("throws when the token endpoint responds non-2xx", async () => {
    const { doc, config } = ctx();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );
    await expect(
      exchangeStaffOidcCode(doc, config, "code", "uri"),
    ).rejects.toThrow(/401/);
  });

  it("throws when the token response has no id_token", async () => {
    const { doc, config } = ctx();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "at" }),
      })),
    );
    await expect(
      exchangeStaffOidcCode(doc, config, "code", "uri"),
    ).rejects.toThrow(/id_token/);
  });
});
