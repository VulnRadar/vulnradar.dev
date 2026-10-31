import { describe, it, expect } from "vitest";

// The signing key must exist before the module computes any HMAC.
process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);

const { signIpv4Token, verifyIpv4Token, IPV4_ECHO_TOKEN_MAX_AGE_SECONDS } =
  await import("@/lib/auth/ipv4-echo-token");
const { signPendingToken } = await import("@/lib/auth/pending-2fa");

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

  it("rejects a signature re-spelled so that it decodes to the same bytes", () => {
    const [payload, sig] = signIpv4Token("203.0.113.9", NOW).split(".");
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const spareBits =
      sig!.slice(0, -1) + alphabet[alphabet.indexOf(sig!.slice(-1)) ^ 1];
    for (const respelled of [spareBits, `${sig}=`]) {
      expect(verifyIpv4Token(`${payload}.${respelled}`, NOW)).toBeNull();
    }
  });

  it("does not accept a token minted for another purpose under the same key", () => {
    const forged = signPendingToken({ ip: "203.0.113.9", ts: NOW });
    expect(verifyIpv4Token(forged, NOW)).toBeNull();
  });

  it("returns null for a correctly signed payload that is not an echo payload", () => {
    const wrongShape = signPendingToken({ ip: 12345, ts: "now" });
    expect(verifyIpv4Token(wrongShape, NOW)).toBeNull();
  });

  it("keeps the wire format: a fixed payload signs to the same string it always did", () => {
    const previous = process.env.API_KEY_ENCRYPTION_KEY;
    process.env.API_KEY_ENCRYPTION_KEY = "ab".repeat(32);
    try {
      expect(signIpv4Token("203.0.113.9", 1_700_000_000_000)).toBe(
        "eyJpcCI6IjIwMy4wLjExMy45IiwidHMiOjE3MDAwMDAwMDAwMDB9.W2BmlicgA1rQ1FPxdZihRtZp0HJm2mvyt8iNXwqfVEw",
      );
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = previous;
    }
  });

  it("names what it was signing when the key is not configured", () => {
    const previous = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      expect(() => signIpv4Token("203.0.113.9", NOW)).toThrow(
        "API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to sign IPv4 echo tokens.",
      );
      expect(verifyIpv4Token("garbage", NOW)).toBeNull();
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = previous;
    }
  });

  it("returns null for missing or malformed tokens", () => {
    expect(verifyIpv4Token(null, NOW)).toBeNull();
    expect(verifyIpv4Token("", NOW)).toBeNull();
    expect(verifyIpv4Token("nodot", NOW)).toBeNull();
    expect(verifyIpv4Token("only.", NOW)).toBeNull();
  });
});
