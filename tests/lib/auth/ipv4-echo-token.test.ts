import { describe, it, expect } from "vitest";

// The signing key must exist before the module computes any HMAC.
process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);

const { signIpv4Token, verifyIpv4Token, IPV4_ECHO_TOKEN_MAX_AGE_SECONDS } =
  await import("@/lib/auth/ipv4-echo-token");

describe("ipv4 echo token", () => {
  const NOW = 1_700_000_000_000;

  it("round-trips a signed IPv4 within the freshness window", () => {
    const token = signIpv4Token("203.0.113.9", NOW);
    expect(verifyIpv4Token(token, NOW + 1000)).toBe("203.0.113.9");
  });

  it("rejects a tampered payload that keeps the original signature", () => {
    const token = signIpv4Token("203.0.113.9", NOW);
    const forgedPayload = Buffer.from(
      JSON.stringify({ ip: "1.2.3.4", ts: NOW }),
      "utf8",
    ).toString("base64url");
    const forged = `${forgedPayload}.${token.slice(
      token.lastIndexOf(".") + 1,
    )}`;
    expect(verifyIpv4Token(forged, NOW)).toBeNull();
  });

  it("rejects a token past its max age", () => {
    const token = signIpv4Token("203.0.113.9", NOW);
    expect(
      verifyIpv4Token(token, NOW + IPV4_ECHO_TOKEN_MAX_AGE_SECONDS * 1000 + 1),
    ).toBeNull();
  });

  it("rejects a token minted implausibly far in the future", () => {
    const token = signIpv4Token("203.0.113.9", NOW + 5 * 60_000);
    expect(verifyIpv4Token(token, NOW)).toBeNull();
  });

  it("returns null for missing or malformed tokens", () => {
    expect(verifyIpv4Token(null, NOW)).toBeNull();
    expect(verifyIpv4Token("", NOW)).toBeNull();
    expect(verifyIpv4Token("nodot", NOW)).toBeNull();
    expect(verifyIpv4Token("only.", NOW)).toBeNull();
  });
});
