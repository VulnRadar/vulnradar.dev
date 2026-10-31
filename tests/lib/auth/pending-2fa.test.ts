import { describe, it, expect, beforeAll } from "vitest";
import { signPendingToken, verifyPendingToken } from "@/lib/auth/pending-2fa";

// The helper signs with API_KEY_ENCRYPTION_KEY (64 hex chars = 32 bytes).
beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
});

describe("pending-2fa signed token", () => {
  it("round-trips a payload", () => {
    const token = signPendingToken({ userId: 42, ts: 1000 });
    expect(verifyPendingToken(token)).toEqual({ userId: 42, ts: 1000 });
  });

  it("rejects a forged bare-userId cookie (the original vulnerability)", () => {
    // What an attacker used to send: Cookie=<victimId>. It is not a signed
    // token, so verification must return null.
    expect(verifyPendingToken("42")).toBeNull();
    expect(verifyPendingToken(String(1))).toBeNull();
  });

  it("rejects an unsigned JSON blob (the old OAuth/Discord cookie shape)", () => {
    const forged = Buffer.from(
      JSON.stringify({ userId: 42, ts: Date.now() }),
      "utf8",
    ).toString("base64url");
    // No valid signature appended.
    expect(verifyPendingToken(forged)).toBeNull();
    expect(verifyPendingToken(`${forged}.deadbeef`)).toBeNull();
  });

  it("rejects a token whose payload was tampered after signing", () => {
    const token = signPendingToken({ userId: 42, ts: 1000 });
    const [, sig] = token.split(".");
    // Swap in a different userId's payload but keep the original signature.
    const tamperedPayload = Buffer.from(
      JSON.stringify({ userId: 999, ts: 1000 }),
      "utf8",
    ).toString("base64url");
    expect(verifyPendingToken(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  it("rejects a signature made with a different key", () => {
    const token = signPendingToken({ userId: 42, ts: 1000 });
    process.env.API_KEY_ENCRYPTION_KEY = "b".repeat(64);
    expect(verifyPendingToken(token)).toBeNull();
    process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
    // Same key again -> valid.
    expect(verifyPendingToken(token)).toEqual({ userId: 42, ts: 1000 });
  });

  it("rejects a signature re-spelled so that it decodes to the same bytes", () => {
    const [payload, sig] = signPendingToken({ userId: 42, ts: 1000 }).split(
      ".",
    );
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const spareBits =
      sig!.slice(0, -1) + alphabet[alphabet.indexOf(sig!.slice(-1)) ^ 1];
    for (const respelled of [spareBits, `${sig}=`]) {
      expect(verifyPendingToken(`${payload}.${respelled}`)).toBeNull();
    }
  });

  it("keeps the wire format: a fixed payload signs to the same string it always did", () => {
    process.env.API_KEY_ENCRYPTION_KEY = "ab".repeat(32);
    try {
      expect(
        signPendingToken({ userId: 7, method: "email", ts: 1_700_000_000_000 }),
      ).toBe(
        "eyJ1c2VySWQiOjcsIm1ldGhvZCI6ImVtYWlsIiwidHMiOjE3MDAwMDAwMDAwMDB9.VsV1NXz4ZhPhV0wWAfMYuty16gl00H3cBl5e6KK79dI",
      );
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
    }
  });

  it("names what it was signing when the key is not configured", () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      expect(() => signPendingToken({ userId: 1 })).toThrow(
        "API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to sign 2FA pending tokens.",
      );
      // A cookie that is not even shaped like a token is still just null,
      // not a server error.
      expect(verifyPendingToken("42")).toBeNull();
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
    }
  });

  it("returns null for missing / malformed input", () => {
    expect(verifyPendingToken(undefined)).toBeNull();
    expect(verifyPendingToken(null)).toBeNull();
    expect(verifyPendingToken("")).toBeNull();
    expect(verifyPendingToken("nodot")).toBeNull();
    expect(verifyPendingToken(".")).toBeNull();
    expect(verifyPendingToken("payload.")).toBeNull();
  });

  it("preserves extra payload fields (OAuth carries method + email)", () => {
    const token = signPendingToken({
      userId: 7,
      method: "email",
      email: "a@b.com",
      ts: 500,
    });
    expect(verifyPendingToken(token)).toEqual({
      userId: 7,
      method: "email",
      email: "a@b.com",
      ts: 500,
    });
  });
});
