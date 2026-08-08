import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  signOAuthState,
  verifyOAuthState,
  OAUTH_STATE_TTL_MS,
} from "@/lib/auth/oauth-state";

/**
 * Tests for the HMAC-signed OAuth state used by the sign-up/sign-in flow
 * (app/api/v3/auth/oauth/[provider]/). Mirrors
 * tests/lib/auth/discord-state.test.ts's coverage since this module mirrors
 * that one's implementation, plus the provider-binding check that module
 * doesn't have (this one has no userId binding, but does bind to a
 * provider name).
 */

const SECRET = "a".repeat(64);

function withSecret<T>(fn: () => T): T {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = SECRET;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previous;
    }
  }
}

describe("signOAuthState / verifyOAuthState", () => {
  it("roundtrips a state token for the expected provider", () => {
    withSecret(() => {
      const state = signOAuthState("google");
      const result = verifyOAuthState(state, "google");
      expect(result).toEqual({
        ok: true,
        payload: expect.objectContaining({ provider: "google" }),
      });
    });
  });

  it("rejects verification against a different provider than it was signed for", () => {
    withSecret(() => {
      const state = signOAuthState("google");
      const result = verifyOAuthState(state, "github");
      expect(result).toEqual({ ok: false, reason: "provider-mismatch" });
    });
  });

  it("rejects a state with a tampered payload", () => {
    withSecret(() => {
      const state = signOAuthState("google");
      const [payload, sig] = state.split(".");
      const mutated = Buffer.from(payload!, "base64url")
        .toString("utf8")
        .replace("google", "github");
      const tampered = `${Buffer.from(mutated).toString("base64url")}.${sig}`;
      const result = verifyOAuthState(tampered, "google");
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });
  });

  it("rejects a state with a tampered signature", () => {
    withSecret(() => {
      const state = signOAuthState("google");
      const [payload, sig] = state.split(".");
      const sigBytes = Buffer.from(sig!, "base64url");
      sigBytes[10] ^= 0xff;
      const tampered = `${payload}.${sigBytes.toString("base64url")}`;
      const result = verifyOAuthState(tampered, "google");
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    });
  });

  it("rejects malformed state (no dot)", () => {
    withSecret(() => {
      expect(verifyOAuthState("nodot", "google")).toEqual({
        ok: false,
        reason: "malformed",
      });
    });
  });

  it("rejects malformed state (empty signature)", () => {
    withSecret(() => {
      const state = signOAuthState("google");
      const [payload] = state.split(".");
      expect(verifyOAuthState(`${payload}.`, "google")).toEqual({
        ok: false,
        reason: "malformed",
      });
    });
  });

  it("rejects an expired state", () => {
    withSecret(() => {
      const payload = JSON.stringify({
        nonce: "abc",
        provider: "google",
        ts: Date.now() - OAUTH_STATE_TTL_MS - 1000,
      });
      const json = Buffer.from(payload).toString("base64url");
      const sig = createHmac("sha256", process.env.AUTH_SECRET!)
        .update(json)
        .digest("base64url");
      const state = `${json}.${sig}`;
      expect(verifyOAuthState(state, "google")).toEqual({
        ok: false,
        reason: "expired",
      });
    });
  });

  it("rejects a state signed with a different secret", () => {
    const previousA = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    const state = signOAuthState("google");
    process.env.AUTH_SECRET = "b".repeat(64);
    try {
      const result = verifyOAuthState(state, "google");
      expect(result).toEqual({ ok: false, reason: "bad-signature" });
    } finally {
      if (previousA === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = previousA;
      }
    }
  });
});

describe("signing without a secret throws (fail-closed)", () => {
  it("throws when neither AUTH_SECRET nor API_KEY_ENCRYPTION_KEY is set", () => {
    const prevAuth = process.env.AUTH_SECRET;
    const prevKey = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.AUTH_SECRET;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      expect(() => signOAuthState("google")).toThrow(
        /AUTH_SECRET|API_KEY_ENCRYPTION_KEY/,
      );
    } finally {
      if (prevAuth !== undefined) process.env.AUTH_SECRET = prevAuth;
      if (prevKey !== undefined) process.env.API_KEY_ENCRYPTION_KEY = prevKey;
    }
  });
});
